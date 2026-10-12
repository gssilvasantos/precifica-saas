import { Injectable, Logger } from '@nestjs/common';
import { OlistV3ConnectionService } from './olist-v3-connection.service';
import { OlistV3ApiClient, OlistV3RateLimitInfo } from '../infrastructure/olist/olist-v3-api.client';
import {
  OlistV3ProductSummary,
  extractListItems,
  extractListTotal,
  formatOlistV3Date,
  summarizeV3Product,
} from '../domain/olist-v3-product-summary';

export const MAX_VERIFY_SKUS = 3;
const INCREMENTAL_PROBE_DAYS = 7;

export interface OlistV3SkuVerification {
  sku: string;
  found: boolean;
  tipoVariacao: string | null;
  produto: OlistV3ProductSummary | null;
  // Mensagem já traduzida/truncada (sem segredo); null quando deu certo.
  error: string | null;
}

export interface OlistV3VerificationResult {
  checkedAt: Date;
  // Última leitura de x-ratelimit-* (null = a v3 não devolveu os cabeçalhos).
  rateLimit: OlistV3RateLimitInfo | null;
  // Prova do filtro incremental: quantos produtos o Olist diz ter mudado na janela.
  incrementalProbe: { windowDays: number; since: string; totalChanged: number | null; returned: number; error: string | null };
  skus: OlistV3SkuVerification[];
  callsMade: number;
}

// Verificação SOMENTE DE LEITURA da API v3 contra a conta real (ADR 0003).
// Responde, antes de qualquer sync v3, às perguntas que o OpenAPI não responde:
// uma variação consultada pelo próprio id traz peso e dimensões? o filtro
// dataAlteracao funciona? qual é a cota? No máximo 1 + 2×3 = 7 chamadas.
@Injectable()
export class OlistV3VerificationService {
  private readonly logger = new Logger(OlistV3VerificationService.name);

  constructor(
    private readonly connection: OlistV3ConnectionService,
    private readonly client: OlistV3ApiClient,
  ) {}

  async verify(tenantId: string, skus: string[]): Promise<OlistV3VerificationResult> {
    const accessToken = await this.connection.getValidAccessToken(tenantId);
    let rateLimit: OlistV3RateLimitInfo | null = null;
    let callsMade = 0;

    const since = new Date(Date.now() - INCREMENTAL_PROBE_DAYS * 24 * 60 * 60 * 1000);
    const incrementalProbe: OlistV3VerificationResult['incrementalProbe'] = {
      windowDays: INCREMENTAL_PROBE_DAYS,
      since: formatOlistV3Date(since),
      totalChanged: null,
      returned: 0,
      error: null,
    };
    try {
      callsMade++;
      const probe = await this.client.listarProdutos(accessToken, {
        dataAlteracao: incrementalProbe.since,
        situacao: 'A',
        limit: 5,
      });
      rateLimit = probe.rateLimit;
      incrementalProbe.returned = extractListItems(probe.data).length;
      incrementalProbe.totalChanged = extractListTotal(probe.data);
    } catch (error) {
      incrementalProbe.error = (error as Error).message;
    }

    const results: OlistV3SkuVerification[] = [];
    for (const sku of skus.slice(0, MAX_VERIFY_SKUS)) {
      const result: OlistV3SkuVerification = { sku, found: false, tipoVariacao: null, produto: null, error: null };
      try {
        callsMade++;
        const list = await this.client.listarProdutos(accessToken, { codigo: sku, limit: 5 });
        rateLimit = list.rateLimit;
        const match = extractListItems(list.data).find((item) => item.sku?.toLowerCase() === sku.toLowerCase());
        if (match) {
          result.found = true;
          result.tipoVariacao = match.tipoVariacao;
          callsMade++;
          const detail = await this.client.obterProduto(accessToken, match.id);
          rateLimit = detail.rateLimit;
          result.produto = summarizeV3Product(detail.data);
        }
      } catch (error) {
        result.error = (error as Error).message;
      }
      results.push(result);
    }

    this.logger.log(`Verificação Olist v3 para tenant ${tenantId}: ${callsMade} chamada(s), ${results.length} SKU(s).`);
    return { checkedAt: new Date(), rateLimit, incrementalProbe, skus: results, callsMade };
  }
}
