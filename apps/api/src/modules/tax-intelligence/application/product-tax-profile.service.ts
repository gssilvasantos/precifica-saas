import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NovoPerfilDeProduto,
  PRODUCT_TAX_PROFILE_REPOSITORY,
  ProductTaxProfileRecord,
  ProductTaxProfileRepository,
  TENANT_TAX_PROFILE_REPOSITORY,
  TenantTaxProfileRepository,
} from './ports/tax-repositories.port';
import { isUf } from '../domain/tenant-tax-profile-rules';
import { derivarPerfilFiscal } from '../domain/derivacao-fiscal';
import { ClassificacaoDeProdutoInput } from '../../../shared/contracts/product-tax-classifier.port';

// Perfil fiscal do produto (12/08/2026) — o último bloqueio do Simples.
//
// Mesmo com regime e RBT12 completos, o resolver para em
// PERFIL_DO_PRODUTO_AUSENTE: a alíquota varia POR PRODUTO, porque ST e
// monofásico são atributos do item, não do tenant. Um cosmético em ST e uma
// caneta comum, no mesmo CNPJ e no mesmo mês, têm alíquotas diferentes.
//
// A chave é (produto, UF, data): ST é regime ESTADUAL — o mesmo NCM pode estar
// em ST no PR e fora dela em SP — e muda por portaria, então o mesmo SKU tem
// classificações diferentes antes e depois de uma data.

// Normas que fundamentam a classificação. Fonte livre seria um campo de texto
// que ninguém preenche direito; fonte fechada obriga a apontar a norma — que é
// o que um contador precisa quando pergunta "por que este SKU mudou de
// alíquota?". MANUAL existe para o caso legítimo de classificação própria, e
// aparece na UI como o que é: uma decisão de alguém, não uma norma.
export const FONTES_DE_CLASSIFICACAO = [
  'MANUAL',
  'ERP_OLIST',
  'PORTARIA_SRE_94_2025',
  'LEI_10147_2000',
  'CONVENIO_ICMS_142_2018',
] as const;

export type FonteDeClassificacao = (typeof FONTES_DE_CLASSIFICACAO)[number];

@Injectable()
export class ProductTaxProfileService {
  private readonly logger = new Logger(ProductTaxProfileService.name);

  constructor(
    @Inject(PRODUCT_TAX_PROFILE_REPOSITORY) private readonly repository: ProductTaxProfileRepository,
    // Só para descobrir a UF do estabelecimento — ST é regime estadual.
    @Inject(TENANT_TAX_PROFILE_REPOSITORY) private readonly tenantProfiles: TenantTaxProfileRepository,
  ) {}

  async listarPorProduto(tenantId: string, productId: string): Promise<ProductTaxProfileRecord[]> {
    return this.repository.listarPorProduto(tenantId, productId);
  }

  // Classificação derivada do NCM que o ERP já importa (13/08/2026).
  //
  // Chamada pelo sync do Olist a cada produto. NÃO sobrescreve classificação
  // manual: se já existe vigência para aquele produto/UF, sai sem tocar em
  // nada — o lojista que classificou um caso atípico continua mandando.
  //
  // Idempotente: rodar de novo com o mesmo NCM não abre vigência duplicada.
  async classificarDoErp(input: ClassificacaoDeProdutoInput): Promise<boolean> {
    const perfilDoTenant = await this.tenantProfiles.findVigente(input.tenantId, input.at);
    // Sem regime configurado não sabemos a UF do estabelecimento, e ST é
    // estadual. Não classifica — e não é erro: é ordem de configuração.
    if (!perfilDoTenant) return false;

    const derivado = derivarPerfilFiscal({ ncm: input.ncm, uf: perfilDoTenant.uf, at: input.at });
    // Sem norma aplicável, NADA é gravado. O motor continua bloqueando aquele
    // SKU, que é melhor que precificar sobre um palpite.
    if (!derivado) return false;

    const vigente = await this.repository.findVigente(
      input.tenantId,
      input.productId,
      perfilDoTenant.uf,
      input.at,
    );

    // Já classificado. Só reabre vigência se a NORMA mudou o resultado —
    // comparar o conteúdo é o que torna a chamada idempotente sem precisar de
    // chave de controle.
    if (vigente) {
      const igual =
        vigente.icmsSt === derivado.icmsSt &&
        vigente.monofasico === derivado.monofasico &&
        vigente.fonte === derivado.fonte;
      if (igual) return false;

      // Classificação MANUAL não é sobrescrita por derivação: quem assumiu a
      // decisão continua com ela.
      if (vigente.fonte === 'MANUAL') return false;
    }

    await this.repository.abrirNovaVigencia({
      tenantId: input.tenantId,
      productId: input.productId,
      uf: perfilDoTenant.uf,
      icmsSt: derivado.icmsSt,
      monofasico: derivado.monofasico,
      ncm: input.ncm?.replace(/\D/g, '') || null,
      fonte: derivado.fonte,
      // Vigência a partir de hoje, nunca retroativa: a classificação de um mês
      // já apurado não muda porque o sync rodou.
      vigenciaInicio: input.at,
    });

    return true;
  }

  async classificar(
    tenantId: string,
    entrada: Omit<NovoPerfilDeProduto, 'tenantId'>,
  ): Promise<ProductTaxProfileRecord> {
    const uf = entrada.uf.trim().toUpperCase();
    const ncm = entrada.ncm?.replace(/\D/g, '') || null;
    const problemas: { campo: string; mensagem: string }[] = [];

    if (!isUf(uf)) {
      problemas.push({ campo: 'uf', mensagem: `UF inválida: "${entrada.uf}".` });
    }

    // NCM tem 8 dígitos. Aceitamos com ou sem pontuação (a normalização acima
    // tira), mas não aceitamos um número truncado — NCM pela metade classifica
    // o produto errado, e o erro só aparece na apuração.
    if (ncm !== null && ncm.length !== 8) {
      problemas.push({ campo: 'ncm', mensagem: 'NCM deve ter 8 dígitos.' });
    }

    if (!FONTES_DE_CLASSIFICACAO.includes(entrada.fonte as FonteDeClassificacao)) {
      problemas.push({
        campo: 'fonte',
        mensagem: `fonte deve ser uma de: ${FONTES_DE_CLASSIFICACAO.join(', ')}.`,
      });
    }

    if (problemas.length > 0) {
      throw new BadRequestException({
        code: 'PERFIL_DE_PRODUTO_INVALIDO',
        message: 'Classificação fiscal do produto inconsistente.',
        problemas,
      });
    }

    // Vigência não pode retroagir sobre a classificação em vigor NAQUELA UF —
    // mesmo motivo do regime do tenant: reescreveria um período já apurado.
    const vigenteNaUf = await this.repository.findVigente(tenantId, entrada.productId, uf, new Date());
    if (vigenteNaUf && entrada.vigenciaInicio <= vigenteNaUf.vigenciaInicio) {
      throw new BadRequestException({
        code: 'VIGENCIA_RETROATIVA',
        message:
          `Já existe classificação vigente em ${uf} desde ` +
          `${vigenteNaUf.vigenciaInicio.toISOString().slice(0, 10)}. A nova precisa começar depois disso.`,
        problemas: [{ campo: 'vigenciaInicio', mensagem: 'Deve ser posterior ao início da vigência atual desta UF.' }],
      });
    }

    const criado = await this.repository.abrirNovaVigencia({ ...entrada, uf, ncm, tenantId });

    this.logger.log(
      `Perfil fiscal classificado — tenant ${tenantId}, produto ${criado.productId}, UF ${criado.uf}: ` +
        `ST=${criado.icmsSt}, monofásico=${criado.monofasico}, fonte ${criado.fonte}, ` +
        `vigente desde ${criado.vigenciaInicio.toISOString().slice(0, 10)}.`,
    );

    return criado;
  }
}
