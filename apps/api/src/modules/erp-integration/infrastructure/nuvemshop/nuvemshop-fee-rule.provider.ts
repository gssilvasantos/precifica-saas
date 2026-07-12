import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FeeRuleCapableProvider,
  FetchContext,
  ProviderCapability,
  ProviderHealthStatus,
  RawRuleCandidate,
} from '../../../../shared/contracts/marketplace-provider.contract';
import { NuvemshopApiClient } from './nuvemshop-api.client';
import { NuvemshopConnectionService } from '../../application/nuvemshop-connection.service';
import {
  NUVEMSHOP_CONNECTION_REPOSITORY,
  NuvemshopConnectionRepository,
} from '../../application/ports/nuvemshop-connection-repository.port';

// Provider de taxa de gateway da Nuvemshop — reaproveita 100% da máquina de
// versionamento/governança/cache do Marketplace Intelligence (RuleSyncOrchestrator,
// MarketplaceRule, RuleRegistryService) em vez de inventar um mecanismo
// paralelo só porque o "marketplace" aqui é a loja própria. Única diferença
// estrutural real: este provider é TENANT-SCOPED (cada loja tem seu próprio
// contrato de gateway), diferente do MercadoLivreFeeRuleProvider (dado
// público, mesmo valor para todo mundo) — por isso RuleSyncOrchestrator.syncFeeRules
// ganhou um parâmetro `tenantId` opcional, e as MarketplaceRule geradas aqui
// sempre têm tenantId preenchido (nunca null/global).
//
// scopeKey usado: `${installments}x_${receivingWindowDays}d` (ex.: "3x_14d")
// — o mesmo campo `categoryCode` que o FeeRuleResolver já usa para Mercado
// Livre vira, aqui, "a combinação parcelas x janela de recebimento". Reuso
// literal da porta, sem precisar de um conceito novo.
@Injectable()
export class NuvemshopFeeRuleProvider implements FeeRuleCapableProvider {
  readonly code = 'NUVEMSHOP_GATEWAY_FEES';
  readonly marketplaceCode = 'NUVEMSHOP';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.FEE_RULES];

  private readonly logger = new Logger(NuvemshopFeeRuleProvider.name);

  constructor(
    private readonly client: NuvemshopApiClient,
    private readonly connection: NuvemshopConnectionService,
    @Inject(NUVEMSHOP_CONNECTION_REPOSITORY) private readonly connections: NuvemshopConnectionRepository,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — ver fetchFeeRules
  }

  // Faz o RuleSyncOrchestrator sincronizar uma vez por loja conectada, em
  // vez de uma única vez global — é isso que declara este provider como
  // "por tenant" (ver comentário na interface MarketplaceProvider).
  async listTenantIdsToSync(): Promise<string[]> {
    const active = await this.connections.findAllActive();
    return active.map((c) => c.tenantId);
  }

  async fetchFeeRules(ctx: FetchContext): Promise<RawRuleCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('NuvemshopFeeRuleProvider chamado sem tenantId — taxa de gateway é por loja, não há candidato global a buscar.');
      return [];
    }

    const credentials = await this.connection.getDecryptedCredentials(ctx.tenantId);
    if (!credentials) {
      this.logger.warn(`Tenant ${ctx.tenantId} não tem conexão ativa com a Nuvemshop — pulando sync de taxa de gateway.`);
      return [];
    }

    const rawTable = await this.client.fetchGatewayFeeTable(credentials.storeId, credentials.accessToken);
    if (rawTable.length === 0) {
      // Mensagem já foi logada pelo client (best-effort) — aqui só confirma
      // o caminho esperado: sem dado da API, o caminho é cadastro manual
      // via POST /marketplace-intelligence/rules/manual.
      return [];
    }

    const fetchedAt = new Date();
    const candidates: RawRuleCandidate[] = [];
    for (const entry of rawTable) {
      const normalized = this.tryNormalize(entry);
      if (!normalized) continue;
      candidates.push({
        scopeKey: `${normalized.installments}x_${normalized.receivingWindowDays}d`,
        payload: {
          commissionPct: normalized.feePct,
          fixedFeeAmount: 0,
        },
        fetchedAt,
      });
    }

    if (candidates.length === 0) {
      this.logger.warn(
        `Resposta da API de taxas da Nuvemshop veio em formato não reconhecido para o tenant ${ctx.tenantId} — ` +
          'nenhum candidato extraído. Cadastro manual continua disponível via POST /marketplace-intelligence/rules/manual.',
      );
    }
    return candidates;
  }

  private tryNormalize(entry: unknown): { installments: number; receivingWindowDays: number; feePct: number } | null {
    if (!entry || typeof entry !== 'object') return null;
    const obj = entry as Record<string, unknown>;
    const installments = Number(obj.installments ?? obj.parcelas ?? NaN);
    const receivingWindowDays = Number(obj.receiving_window_days ?? obj.dias_recebimento ?? NaN);
    const feePct = Number(obj.fee_percentage ?? obj.percentual_taxa ?? obj.fee ?? NaN);
    if (!Number.isFinite(installments) || !Number.isFinite(receivingWindowDays) || !Number.isFinite(feePct)) {
      return null;
    }
    return { installments, receivingWindowDays, feePct };
  }
}
