import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FISCAL_INVOICE_REPOSITORY, FiscalInvoiceRepository } from './ports/fiscal-invoice-repository.port';
import { FiscalSettingsService } from './fiscal-settings.service';
import { FiscalMarketplaceIntermediaryService } from './fiscal-marketplace-intermediary.service';
import { NaturezaOperacaoService } from './natureza-operacao.service';
import { FiscalAddress, FiscalInvoice, buildFocusRef, canCancel, canEmit } from '../domain/fiscal-invoice.entity';
import { buildNfePayload, hasRequiredItemFields, NfePayloadItemInput } from '../domain/nfe-payload-builder';
import { isValidReferencedDocuments, NaturezaOperacaoCfopConfig, NfeFinalidade } from '../domain/tax-code-resolver';
import { FocusNfeApiClient } from '../infrastructure/focus-nfe-api.client';
import { ORDER_FISCAL_READER } from '../../../shared/contracts/order-fiscal-reader.port';
import type { OrderFiscalReader } from '../../../shared/contracts/order-fiscal-reader.port';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';

export interface EmitInvoiceDestinatarioInput {
  nome: string;
  documento?: string; // se ausente, usa Order.buyerTaxId
  endereco: FiscalAddress;
  telefone?: string;
}

export interface EmitInvoiceInput {
  destinatario: EmitInvoiceDestinatarioInput;
  naturezaOperacao?: string;
  // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2) — omitido = NORMAL (comportamento de antes deste quick win).
  // Complementar/Ajuste/Devolução exigem documentoReferenciado (validado
  // via isValidReferencedDocuments antes de montar o payload).
  finalidade?: NfeFinalidade;
  documentoReferenciado?: string[];
  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026, ver docs/naturezas-operacao-architecture.md) — id de uma
  // NaturezaOperacao cadastrada por este tenant, usada SÓ para resolver o
  // CFOP. Ausente = usa FiscalSettings.defaultNaturezaOperacaoId (se
  // configurado) ou, na ausência de ambos, o fallback hardcoded histórico
  // (resolveCfop, Simples Nacional revenda simples) — zero mudança de
  // comportamento para quem nunca configurou nada.
  naturezaOperacaoId?: string;
}

// Orquestra a emissão de NF-e (Fase 3, benchmark Tiny ERP) — monta o
// contexto (pedido via ORDER_FISCAL_READER, dados fiscais do produto via
// PRODUCT_CATALOG_READER, emitente via FiscalSettingsService), delega o
// gate/payload para o domínio puro, e fala com o Focus NFe via
// FocusNfeApiClient. Nenhuma regra de negócio fiscal vive aqui — só
// orquestração, mesma disciplina do resto desta base
// (PricingDecisionService, StockMovementAuditEventService etc.).
@Injectable()
export class FiscalInvoiceService {
  private readonly logger = new Logger(FiscalInvoiceService.name);

  constructor(
    @Inject(FISCAL_INVOICE_REPOSITORY) private readonly invoices: FiscalInvoiceRepository,
    @Inject(ORDER_FISCAL_READER) private readonly orderReader: OrderFiscalReader,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    private readonly fiscalSettings: FiscalSettingsService,
    private readonly intermediaries: FiscalMarketplaceIntermediaryService,
    private readonly naturezasOperacao: NaturezaOperacaoService,
    private readonly focusApi: FocusNfeApiClient,
  ) {}

  async emit(tenantId: string, orderId: string, input: EmitInvoiceInput): Promise<FiscalInvoice> {
    const order = await this.orderReader.getForFiscalEmission(tenantId, orderId);
    if (!order) {
      throw new NotFoundException(`Pedido ${orderId} não encontrado.`);
    }

    const existing = await this.invoices.findAllByOrder(tenantId, orderId);
    const gate = canEmit(order.status, existing);
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    const documento = input.destinatario.documento ?? order.buyerTaxId ?? undefined;
    if (!documento) {
      throw new BadRequestException(
        'Documento (CPF/CNPJ) do destinatário é obrigatório — este pedido não tem buyerTaxId; informe destinatario.documento.',
      );
    }

    // Quick Win 7 — Complementar/Ajuste/Devolução exigem referenciar a NF-e
    // de origem (exigência da SEFAZ, não uma regra do Kyneti) — validado
    // ANTES de gastar uma chamada à Focus NFe com um payload que seria
    // rejeitado de qualquer forma.
    const finalidade = input.finalidade ?? 'NORMAL';
    if (!isValidReferencedDocuments(finalidade, input.documentoReferenciado)) {
      throw new BadRequestException(
        `Finalidade ${finalidade} exige ao menos uma chave de acesso (44 dígitos) da NF-e de origem em documentoReferenciado.`,
      );
    }

    const { record: settings, token } = await this.fiscalSettings.requireForEmission(tenantId);

    // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
    // 29/07/2026) — explícito no input > padrão configurado em
    // FiscalSettings > ausência de ambos (undefined, buildNfePayload cai no
    // fallback hardcoded resolveCfop). Nunca resolve silenciosamente uma
    // natureza de outro tenant nem uma inativa (requireActiveForEmission).
    const naturezaOperacaoId = input.naturezaOperacaoId ?? settings.defaultNaturezaOperacaoId ?? undefined;
    const cfopConfig: NaturezaOperacaoCfopConfig | undefined = naturezaOperacaoId
      ? await this.naturezasOperacao.requireActiveForEmission(tenantId, naturezaOperacaoId)
      : undefined;

    const { items, missingNcmSkus } = await this.resolveItems(tenantId, order.items);
    if (missingNcmSkus.length > 0) {
      throw new BadRequestException(
        `Não é possível emitir NF-e: os seguintes itens não têm NCM cadastrado no produto: ${missingNcmSkus.join(', ')}. Cadastre o NCM em Catálogo antes de emitir.`,
      );
    }
    if (!hasRequiredItemFields(items)) {
      throw new BadRequestException('Este pedido não tem itens elegíveis para NF-e (nenhum item com SKU resolvido).');
    }

    // Grupo G (NT 2020.006) — benchmark Bling, seção 1.4: ausência de config
    // para este canal (ex.: Nuvemshop, ou tenant que ainda não configurou)
    // é um caso válido, indicador_intermediario vai 0 no payload.
    const intermediaryConfig = await this.intermediaries.findForChannel(tenantId, order.channelCode);

    const attempt = existing.length + 1;
    const focusRef = buildFocusRef(tenantId, orderId, attempt);

    const invoice = await this.invoices.create({
      tenantId,
      orderId,
      focusRef,
      environment: settings.environment,
      destNome: input.destinatario.nome,
      destDocumento: documento,
      destEndereco: input.destinatario.endereco,
      destTelefone: input.destinatario.telefone ?? null,
    });

    const payload = buildNfePayload({
      naturezaOperacao: input.naturezaOperacao ?? 'Venda de mercadoria',
      dataEmissao: new Date(),
      emitente: {
        cnpj: settings.cnpj,
        razaoSocial: settings.razaoSocial,
        nomeFantasia: settings.nomeFantasia,
        inscricaoEstadual: settings.inscricaoEstadual,
        regimeTributario: settings.regimeTributario,
        logradouro: settings.logradouro,
        numero: settings.numero,
        bairro: settings.bairro,
        municipio: settings.municipio,
        uf: settings.uf,
        cep: settings.cep,
      },
      destinatario: {
        nome: input.destinatario.nome,
        documento,
        endereco: input.destinatario.endereco,
        telefone: input.destinatario.telefone,
      },
      items,
      valorFrete: order.shippingAmount,
      valorDesconto: order.discountAmount,
      intermediador: intermediaryConfig
        ? { cnpj: intermediaryConfig.cnpj, idCadIntTran: intermediaryConfig.idCadIntTran }
        : undefined,
      finalidade,
      documentoReferenciado: input.documentoReferenciado,
      cfopConfig,
    });

    try {
      const response = await this.focusApi.emit(token, settings.environment, focusRef, payload);
      return await this.handleFocusResponse(invoice.id, response);
    } catch (error) {
      this.logger.error(`Falha de comunicação ao emitir NF-e (pedido ${orderId}, tenant ${tenantId}): ${(error as Error).message}`);
      return this.invoices.markError(invoice.id, { errorCode: 'ERRO_COMUNICACAO', errorMessage: (error as Error).message });
    }
  }

  async checkStatus(tenantId: string, id: string): Promise<FiscalInvoice> {
    const invoice = await this.requireInvoice(tenantId, id);
    const { token } = await this.fiscalSettings.requireForEmission(tenantId);
    const response = await this.focusApi.consult(token, invoice.environment, invoice.focusRef);
    return this.handleFocusResponse(invoice.id, response);
  }

  async cancel(tenantId: string, id: string, justificativa: string): Promise<FiscalInvoice> {
    const invoice = await this.requireInvoice(tenantId, id);
    const gate = canCancel(invoice, justificativa);
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    const { token } = await this.fiscalSettings.requireForEmission(tenantId);
    const response = await this.focusApi.cancel(token, invoice.environment, invoice.focusRef, justificativa.trim());
    if (response.status >= 400) {
      throw new BadRequestException(String(response.body.mensagem ?? 'Falha ao cancelar a NF-e no Focus NFe.'));
    }
    return this.invoices.markCancelled(invoice.id, justificativa.trim());
  }

  async findOne(tenantId: string, id: string): Promise<FiscalInvoice> {
    return this.requireInvoice(tenantId, id);
  }

  async listByOrder(tenantId: string, orderId: string): Promise<FiscalInvoice[]> {
    return this.invoices.findAllByOrder(tenantId, orderId);
  }

  async listAll(tenantId: string, status?: string): Promise<FiscalInvoice[]> {
    return this.invoices.findAllByTenant(tenantId, status);
  }

  // Consumido pelo webhook Focus NFe (gatilho) — mesmo tratamento de
  // resposta usado por emit/checkStatus, só que o "response" aqui é o corpo
  // que a Focus NFe empurrou de forma ativa, não uma resposta de request
  // nosso. `ref` ausente ou desconhecido é ignorado silenciosamente (loga
  // warn) — nunca lança erro para a Focus NFe, que reenviaria indefinidamente.
  async handleFocusNfeWebhook(payload: Record<string, unknown>): Promise<void> {
    const ref = String(payload.ref ?? '');
    if (!ref) {
      this.logger.warn('Webhook Focus NFe recebido sem campo "ref" — ignorado.');
      return;
    }
    const invoice = await this.invoices.findByFocusRef(ref);
    if (!invoice) {
      this.logger.warn(`Webhook Focus NFe recebido para ref "${ref}" desconhecida — ignorado.`);
      return;
    }
    await this.handleFocusResponse(invoice.id, { status: 200, body: payload });
  }

  private async requireInvoice(tenantId: string, id: string): Promise<FiscalInvoice> {
    const invoice = await this.invoices.findById(tenantId, id);
    if (!invoice) {
      throw new NotFoundException(`NF-e ${id} não encontrada.`);
    }
    return invoice;
  }

  // Item sem skuCode ou sem NCM cadastrado no produto é reportado como gap
  // de dados, NUNCA emitido com um NCM "chutado" — ver
  // docs/fiscal-nfe-architecture.md.
  private async resolveItems(
    tenantId: string,
    orderItems: { skuCode: string | null; productName: string; quantity: number; unitPrice: number; totalPrice: number }[],
  ): Promise<{ items: NfePayloadItemInput[]; missingNcmSkus: string[] }> {
    const items: NfePayloadItemInput[] = [];
    const missingNcmSkus: string[] = [];
    let numeroItem = 1;

    for (const item of orderItems) {
      if (!item.skuCode) {
        missingNcmSkus.push(item.productName);
        continue;
      }
      const product = await this.catalog.findBySku(tenantId, item.skuCode);
      if (!product?.ncm) {
        missingNcmSkus.push(item.skuCode);
        continue;
      }
      items.push({
        numeroItem: numeroItem++,
        codigoProduto: item.skuCode,
        descricao: item.productName,
        ncm: product.ncm,
        icmsOrigem: product.fiscalOriginCode,
        cest: product.cest,
        quantidade: item.quantity,
        valorUnitario: item.unitPrice,
        valorBruto: item.totalPrice,
      });
    }

    return { items, missingNcmSkus };
  }

  private async handleFocusResponse(invoiceId: string, response: { status: number; body: Record<string, unknown> }): Promise<FiscalInvoice> {
    if (response.status >= 400) {
      return this.invoices.markError(invoiceId, {
        errorCode: String(response.body.codigo ?? response.status),
        errorMessage: String(response.body.mensagem ?? 'Erro desconhecido retornado pela Focus NFe.'),
      });
    }

    if (response.body.status === 'autorizado') {
      return this.invoices.markAuthorized(invoiceId, {
        nfeNumber: String(response.body.numero ?? ''),
        nfeSeries: String(response.body.serie ?? ''),
        accessKey: String(response.body.chave_nfe ?? ''),
        xmlUrl: String(response.body.caminho_xml_nota_fiscal ?? ''),
        danfeUrl: String(response.body.caminho_danfe ?? ''),
      });
    }

    if (response.body.status === 'erro_autorizacao' || response.body.status === 'cancelado') {
      return this.invoices.markError(invoiceId, {
        errorCode: String(response.body.codigo ?? response.body.status),
        errorMessage: String(response.body.mensagem_sefaz ?? response.body.mensagem ?? 'Falha na autorização da NF-e.'),
      });
    }

    // "processando_autorizacao" ou qualquer status intermediário desconhecido
    // — mantém como PROCESSANDO, aguardando próxima consulta/webhook.
    return this.invoices.markProcessing(invoiceId);
  }
}
