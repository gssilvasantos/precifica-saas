import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FiscalInvoiceRepository } from './ports/fiscal-invoice-repository.port';
import { FiscalSettingsService } from './fiscal-settings.service';
import { FiscalMarketplaceIntermediaryService } from './fiscal-marketplace-intermediary.service';
import { NaturezaOperacaoService } from './natureza-operacao.service';
import { FocusNfeApiClient } from '../infrastructure/focus-nfe-api.client';
import { FiscalInvoice } from '../domain/fiscal-invoice.entity';
import { OrderFiscalReader, OrderFiscalData } from '../../../shared/contracts/order-fiscal-reader.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { FiscalSettingsRecord } from './ports/fiscal-settings-repository.port';
import { NaturezaOperacaoRecord } from './ports/natureza-operacao-repository.port';

function buildSettingsRecord(overrides: Partial<FiscalSettingsRecord> = {}): FiscalSettingsRecord {
  return {
    tenantId: 'tenant-1',
    cnpj: '12345678000199',
    razaoSocial: 'Empresa X',
    nomeFantasia: null,
    inscricaoEstadual: '123',
    regimeTributario: 1,
    logradouro: 'Rua A',
    numero: '100',
    bairro: 'Centro',
    municipio: 'SP',
    uf: 'SP',
    cep: '01000000',
    telefone: null,
    focusNfeTokenEnc: 'enc',
    environment: 'HOMOLOGACAO',
    autoEmitOnApproval: false,
    nfeSerie: null,
    defaultNaturezaOperacaoId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildNaturezaOperacao(overrides: Partial<NaturezaOperacaoRecord> = {}): NaturezaOperacaoRecord {
  return {
    id: 'natureza-1',
    tenantId: 'tenant-1',
    nome: 'Venda customizada',
    cfopVendaInterno: '5405',
    cfopVendaInterestadual: '6404',
    cfopDevolucaoInterno: null,
    cfopDevolucaoInterestadual: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildOrder(overrides: Partial<OrderFiscalData> = {}): OrderFiscalData {
  return {
    orderId: 'order-1',
    channelCode: 'MERCADO_LIVRE',
    externalOrderId: 'ext-1',
    status: 'APROVADO',
    buyerTaxId: '12345678900',
    totalAmount: 100,
    shippingAmount: 10,
    discountAmount: 0,
    items: [{ skuCode: 'SKU-1', productName: 'Produto X', quantity: 1, unitPrice: 90, totalPrice: 90 }],
    ...overrides,
  };
}

function buildProduct(overrides: Partial<ProductCatalogSummary> = {}): ProductCatalogSummary {
  return {
    productId: 'prod-1',
    skuCode: 'SKU-1',
    name: 'Produto X',
    costPrice: 40,
    productCostPrice: 40,
    packagingCostPrice: null,
    desiredMarginPct: 30,
    minimumMarginPct: 10,
    autoRepricingEnabled: false,
    packagingId: null,
    isKit: false,
    mapPrice: null,
    ncm: '12345678',
    fiscalOriginCode: 0,
    cest: null,
    categoryId: null,
    photoUrls: [],
    weightKg: 1,
    ...overrides,
  };
}

function buildInvoice(overrides: Partial<FiscalInvoice> = {}): FiscalInvoice {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
    focusRef: 'tenant1-order1-1',
    status: 'PENDENTE',
    environment: 'HOMOLOGACAO',
    destNome: 'Cliente Y',
    destDocumento: '12345678900',
    destEndereco: { logradouro: 'Rua B', numero: '1', bairro: 'B', municipio: 'M', uf: 'SP', cep: '01000000' },
    destTelefone: null,
    nfeNumber: null,
    nfeSeries: null,
    accessKey: null,
    xmlUrl: null,
    danfeUrl: null,
    errorCode: null,
    errorMessage: null,
    cancelReason: null,
    requestedAt: new Date(),
    authorizedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('FiscalInvoiceService', () => {
  function buildService() {
    const invoices: jest.Mocked<FiscalInvoiceRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByFocusRef: jest.fn(),
      findAllByOrder: jest.fn(),
      findAllByTenant: jest.fn(),
      markProcessing: jest.fn(),
      markAuthorized: jest.fn(),
      markError: jest.fn(),
      markCancelled: jest.fn(),
    };
    const orderReader: jest.Mocked<OrderFiscalReader> = {
      getForFiscalEmission: jest.fn(),
    };
    const catalog: jest.Mocked<ProductCatalogReader> = {
      findBySku: jest.fn(),
    };
    const fiscalSettings = {
      requireForEmission: jest.fn(),
    } as unknown as jest.Mocked<FiscalSettingsService>;
    const intermediaries = {
      findForChannel: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<FiscalMarketplaceIntermediaryService>;
    const naturezasOperacao = {
      requireActiveForEmission: jest.fn(),
    } as unknown as jest.Mocked<NaturezaOperacaoService>;
    const focusApi = {
      emit: jest.fn(),
      consult: jest.fn(),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<FocusNfeApiClient>;

    const service = new FiscalInvoiceService(invoices, orderReader, catalog, fiscalSettings, intermediaries, naturezasOperacao, focusApi);
    return { service, invoices, orderReader, catalog, fiscalSettings, intermediaries, naturezasOperacao, focusApi };
  }

  const destinatario = {
    nome: 'Cliente Y',
    endereco: { logradouro: 'Rua B', numero: '1', bairro: 'B', municipio: 'M', uf: 'SP', cep: '01000000' },
  };

  describe('emit', () => {
    it('pedido inexistente: lança NotFoundException', async () => {
      const { service, orderReader } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(null);

      await expect(service.emit('tenant-1', 'order-x', { destinatario })).rejects.toThrow();
    });

    it('pedido EM_ABERTO: rejeita pelo gate', async () => {
      const { service, orderReader, invoices } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder({ status: 'EM_ABERTO' }));
      invoices.findAllByOrder.mockResolvedValue([]);

      await expect(service.emit('tenant-1', 'order-1', { destinatario })).rejects.toThrow();
      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('já existe nota autorizada: rejeita pelo gate (sem reemissão)', async () => {
      const { service, orderReader, invoices } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([buildInvoice({ status: 'AUTORIZADA' })]);

      await expect(service.emit('tenant-1', 'order-1', { destinatario })).rejects.toThrow();
      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('sem documento (nem no input, nem buyerTaxId do pedido): rejeita', async () => {
      const { service, orderReader, invoices } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder({ buyerTaxId: null }));
      invoices.findAllByOrder.mockResolvedValue([]);

      await expect(service.emit('tenant-1', 'order-1', { destinatario })).rejects.toThrow();
      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('item sem NCM cadastrado: rejeita e nunca chama o Focus NFe', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct({ ncm: null }));
      // requireForEmission é chamado ANTES da checagem de NCM (busca o
      // emitente antes de montar os itens) — precisa resolver para o teste
      // chegar até o gate que estamos validando aqui.
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });

      await expect(service.emit('tenant-1', 'order-1', { destinatario })).rejects.toThrow(/NCM/);
      expect(focusApi.emit).not.toHaveBeenCalled();
      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('emissão bem-sucedida: cria a nota, monta o payload e chama o Focus NFe', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      const result = await service.emit('tenant-1', 'order-1', { destinatario });

      expect(invoices.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', orderId: 'order-1', destDocumento: '12345678900' }),
      );
      expect(focusApi.emit).toHaveBeenCalledWith('token-123', 'HOMOLOGACAO', 'tenant1-order1-1', expect.any(Object));
      expect(result.status).toBe('PROCESSANDO');
    });

    it('Grupo G: sem config de intermediador para o canal, emite sem o grupo', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, intermediaries, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      intermediaries.findForChannel.mockResolvedValue(null);
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      await service.emit('tenant-1', 'order-1', { destinatario });

      expect(intermediaries.findForChannel).toHaveBeenCalledWith('tenant-1', 'MERCADO_LIVRE');
      const payload = focusApi.emit.mock.calls[0][3] as Record<string, unknown>;
      expect(payload.indicador_intermediario).toBe(0);
      expect(payload.cnpj_intermediario).toBeUndefined();
    });

    it('Grupo G: com config de intermediador, envia CNPJ da plataforma + idCadIntTran do vendedor', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, intermediaries, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      intermediaries.findForChannel.mockResolvedValue({
        id: 'int-1',
        tenantId: 'tenant-1',
        channelCode: 'MERCADO_LIVRE',
        cnpj: '03007331000141',
        idCadIntTran: 'meu-nickname-ml',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      await service.emit('tenant-1', 'order-1', { destinatario });

      const payload = focusApi.emit.mock.calls[0][3] as Record<string, unknown>;
      expect(payload.indicador_intermediario).toBe(1);
      expect(payload.cnpj_intermediario).toBe('03007331000141');
      expect(payload.id_intermediario).toBe('meu-nickname-ml');
    });

    // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
    // 29/07/2026) — resolução do CFOP via natureza explícita/padrão do
    // tenant, com fallback pro hardcoded quando nenhuma é usada.
    describe('naturezaOperacaoId (Projeto Estruturante 4)', () => {
      it('sem naturezaOperacaoId no input nem defaultNaturezaOperacaoId nas settings: usa o CFOP hardcoded (comportamento histórico)', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, naturezasOperacao, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
        invoices.create.mockResolvedValue(buildInvoice());
        focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
        invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

        await service.emit('tenant-1', 'order-1', { destinatario });

        expect(naturezasOperacao.requireActiveForEmission).not.toHaveBeenCalled();
        const payload = focusApi.emit.mock.calls[0][3] as { items: { cfop: string }[] };
        expect(payload.items[0].cfop).toBe('5102'); // emitente e destinatário ambos SP nos fixtures
      });

      it('naturezaOperacaoId explícito no input: usa o CFOP customizado da natureza', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, naturezasOperacao, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
        naturezasOperacao.requireActiveForEmission.mockResolvedValue(buildNaturezaOperacao());
        invoices.create.mockResolvedValue(buildInvoice());
        focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
        invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

        await service.emit('tenant-1', 'order-1', { destinatario, naturezaOperacaoId: 'natureza-1' });

        expect(naturezasOperacao.requireActiveForEmission).toHaveBeenCalledWith('tenant-1', 'natureza-1');
        const payload = focusApi.emit.mock.calls[0][3] as { items: { cfop: string }[] };
        expect(payload.items[0].cfop).toBe('5405');
      });

      it('sem naturezaOperacaoId no input, mas com defaultNaturezaOperacaoId nas settings: usa a natureza padrão do tenant', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, naturezasOperacao, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({
          record: buildSettingsRecord({ defaultNaturezaOperacaoId: 'natureza-padrao' }),
          token: 'token-123',
        });
        naturezasOperacao.requireActiveForEmission.mockResolvedValue(buildNaturezaOperacao({ id: 'natureza-padrao' }));
        invoices.create.mockResolvedValue(buildInvoice());
        focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
        invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

        await service.emit('tenant-1', 'order-1', { destinatario });

        expect(naturezasOperacao.requireActiveForEmission).toHaveBeenCalledWith('tenant-1', 'natureza-padrao');
        const payload = focusApi.emit.mock.calls[0][3] as { items: { cfop: string }[] };
        expect(payload.items[0].cfop).toBe('5405');
      });
    });

    it('CEST (benchmark Bling): produto sem CEST, item vai sem o campo', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct({ cest: null }));
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      await service.emit('tenant-1', 'order-1', { destinatario });

      const payload = focusApi.emit.mock.calls[0][3] as { items: Record<string, unknown>[] };
      expect(payload.items[0].cest).toBeUndefined();
    });

    it('CEST (benchmark Bling): produto com CEST cadastrado, propaga para o item da NF-e', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct({ cest: '2803800' }));
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      await service.emit('tenant-1', 'order-1', { destinatario });

      const payload = focusApi.emit.mock.calls[0][3] as { items: Record<string, unknown>[] };
      expect(payload.items[0].cest).toBe('2803800');
    });

    it('resposta autorizada: marca como AUTORIZADA', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({
        status: 201,
        body: { status: 'autorizado', numero: '123', serie: '1', chave_nfe: 'chave', caminho_xml_nota_fiscal: 'x.xml', caminho_danfe: 'd.pdf' },
      });
      invoices.markAuthorized.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));

      const result = await service.emit('tenant-1', 'order-1', { destinatario });

      expect(invoices.markAuthorized).toHaveBeenCalledWith(
        'inv-1',
        expect.objectContaining({ nfeNumber: '123', accessKey: 'chave' }),
      );
      expect(result.status).toBe('AUTORIZADA');
    });

    it('resposta de erro (status>=400): marca como ERRO', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockResolvedValue({ status: 422, body: { codigo: 'erro_x', mensagem: 'CNPJ inválido' } });
      invoices.markError.mockResolvedValue(buildInvoice({ status: 'ERRO' }));

      const result = await service.emit('tenant-1', 'order-1', { destinatario });

      expect(invoices.markError).toHaveBeenCalledWith('inv-1', { errorCode: 'erro_x', errorMessage: 'CNPJ inválido' });
      expect(result.status).toBe('ERRO');
    });

    it('falha de comunicação (client lança): marca como ERRO sem propagar', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice());
      focusApi.emit.mockRejectedValue(new Error('timeout'));
      invoices.markError.mockResolvedValue(buildInvoice({ status: 'ERRO' }));

      const result = await service.emit('tenant-1', 'order-1', { destinatario });

      expect(invoices.markError).toHaveBeenCalledWith('inv-1', { errorCode: 'ERRO_COMUNICACAO', errorMessage: 'timeout' });
      expect(result.status).toBe('ERRO');
    });

    // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
    // seção 2) — finalidade da emissão + documento referenciado.
    describe('finalidade + documentoReferenciado (Quick Win 7)', () => {
      it('finalidade DEVOLUCAO sem documentoReferenciado: rejeita antes de chamar o Focus NFe', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });

        await expect(
          service.emit('tenant-1', 'order-1', { destinatario, finalidade: 'DEVOLUCAO' }),
        ).rejects.toThrow(/documentoReferenciado/);
        expect(focusApi.emit).not.toHaveBeenCalled();
        expect(invoices.create).not.toHaveBeenCalled();
      });

      it('finalidade DEVOLUCAO com chave de acesso inválida (não tem 44 dígitos): rejeita', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });

        await expect(
          service.emit('tenant-1', 'order-1', { destinatario, finalidade: 'DEVOLUCAO', documentoReferenciado: ['123'] }),
        ).rejects.toThrow(/documentoReferenciado/);
        expect(focusApi.emit).not.toHaveBeenCalled();
      });

      it('finalidade DEVOLUCAO com chave válida: monta o payload com finalidade_emissao 4 e notas_referenciadas', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
        const chave = '1'.repeat(44);
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
        invoices.create.mockResolvedValue(buildInvoice());
        focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
        invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

        await service.emit('tenant-1', 'order-1', { destinatario, finalidade: 'DEVOLUCAO', documentoReferenciado: [chave] });

        const payload = focusApi.emit.mock.calls[0][3] as { finalidade_emissao: number; notas_referenciadas: unknown };
        expect(payload.finalidade_emissao).toBe(4);
        expect(payload.notas_referenciadas).toEqual([{ chave_nfe: chave }]);
      });

      it('sem finalidade informada: default NORMAL, sem exigir documentoReferenciado', async () => {
        const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
        orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
        invoices.findAllByOrder.mockResolvedValue([]);
        catalog.findBySku.mockResolvedValue(buildProduct());
        fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
        invoices.create.mockResolvedValue(buildInvoice());
        focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
        invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

        await service.emit('tenant-1', 'order-1', { destinatario });

        const payload = focusApi.emit.mock.calls[0][3] as { finalidade_emissao: number };
        expect(payload.finalidade_emissao).toBe(1);
      });
    });

    it('nota anterior em ERRO permite reemissão (novo attempt)', async () => {
      const { service, orderReader, invoices, catalog, fiscalSettings, focusApi } = buildService();
      orderReader.getForFiscalEmission.mockResolvedValue(buildOrder());
      invoices.findAllByOrder.mockResolvedValue([buildInvoice({ status: 'ERRO' })]);
      catalog.findBySku.mockResolvedValue(buildProduct());
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      invoices.create.mockResolvedValue(buildInvoice({ focusRef: 'tenant1-order1-2' }));
      focusApi.emit.mockResolvedValue({ status: 202, body: { status: 'processando_autorizacao' } });
      invoices.markProcessing.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));

      await service.emit('tenant-1', 'order-1', { destinatario });

      expect(invoices.create).toHaveBeenCalledWith(expect.objectContaining({ focusRef: 'tenant1-order1-2' }));
    });
  });

  describe('checkStatus', () => {
    it('consulta o Focus NFe e atualiza o status', async () => {
      const { service, invoices, fiscalSettings, focusApi } = buildService();
      invoices.findById.mockResolvedValue(buildInvoice({ status: 'PROCESSANDO' }));
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      focusApi.consult.mockResolvedValue({ status: 200, body: { status: 'autorizado', numero: '1', serie: '1', chave_nfe: 'c', caminho_xml_nota_fiscal: 'x', caminho_danfe: 'd' } });
      invoices.markAuthorized.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));

      const result = await service.checkStatus('tenant-1', 'inv-1');

      expect(result.status).toBe('AUTORIZADA');
    });

    it('nota inexistente: lança NotFoundException', async () => {
      const { service, invoices } = buildService();
      invoices.findById.mockResolvedValue(null);

      await expect(service.checkStatus('tenant-1', 'inv-x')).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    it('nota não autorizada: rejeita pelo gate', async () => {
      const { service, invoices, focusApi } = buildService();
      invoices.findById.mockResolvedValue(buildInvoice({ status: 'PENDENTE' }));

      await expect(service.cancel('tenant-1', 'inv-1', 'Justificativa longa o suficiente')).rejects.toThrow();
      expect(focusApi.cancel).not.toHaveBeenCalled();
    });

    it('justificativa curta demais: rejeita pelo gate', async () => {
      const { service, invoices, focusApi } = buildService();
      invoices.findById.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));

      await expect(service.cancel('tenant-1', 'inv-1', 'curta')).rejects.toThrow();
      expect(focusApi.cancel).not.toHaveBeenCalled();
    });

    it('cancelamento bem-sucedido: marca como CANCELADA', async () => {
      const { service, invoices, fiscalSettings, focusApi } = buildService();
      invoices.findById.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      focusApi.cancel.mockResolvedValue({ status: 200, body: {} });
      invoices.markCancelled.mockResolvedValue(buildInvoice({ status: 'CANCELADA' }));

      const result = await service.cancel('tenant-1', 'inv-1', 'Justificativa longa o suficiente para passar no gate');

      expect(invoices.markCancelled).toHaveBeenCalledWith('inv-1', 'Justificativa longa o suficiente para passar no gate');
      expect(result.status).toBe('CANCELADA');
    });

    it('Focus NFe recusa o cancelamento (status>=400): rejeita sem marcar', async () => {
      const { service, invoices, fiscalSettings, focusApi } = buildService();
      invoices.findById.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));
      fiscalSettings.requireForEmission.mockResolvedValue({ record: buildSettingsRecord(), token: 'token-123' });
      focusApi.cancel.mockResolvedValue({ status: 422, body: { mensagem: 'Fora do prazo' } });

      await expect(service.cancel('tenant-1', 'inv-1', 'Justificativa longa o suficiente para passar no gate')).rejects.toThrow(/Fora do prazo/);
      expect(invoices.markCancelled).not.toHaveBeenCalled();
    });
  });

  describe('handleFocusNfeWebhook', () => {
    it('ref ausente: ignora silenciosamente', async () => {
      const { service, invoices } = buildService();

      await service.handleFocusNfeWebhook({});

      expect(invoices.findByFocusRef).not.toHaveBeenCalled();
      expect(invoices.markAuthorized).not.toHaveBeenCalled();
    });

    it('ref desconhecida: ignora silenciosamente', async () => {
      const { service, invoices } = buildService();
      invoices.findByFocusRef.mockResolvedValue(null);

      await service.handleFocusNfeWebhook({ ref: 'ref-x' });

      expect(invoices.markAuthorized).not.toHaveBeenCalled();
      expect(invoices.markProcessing).not.toHaveBeenCalled();
    });

    it('ref conhecida: atualiza o status da nota correspondente', async () => {
      const { service, invoices } = buildService();
      invoices.findByFocusRef.mockResolvedValue(buildInvoice());
      invoices.markAuthorized.mockResolvedValue(buildInvoice({ status: 'AUTORIZADA' }));

      await service.handleFocusNfeWebhook({ ref: 'tenant1-order1-1', status: 'autorizado', numero: '1', serie: '1', chave_nfe: 'c', caminho_xml_nota_fiscal: 'x', caminho_danfe: 'd' });

      expect(invoices.markAuthorized).toHaveBeenCalledWith('inv-1', expect.objectContaining({ nfeNumber: '1' }));
    });
  });
});
