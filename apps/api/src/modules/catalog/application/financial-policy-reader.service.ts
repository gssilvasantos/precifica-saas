import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CatalogSettingsService } from './catalog-settings.service';
import { CATALOG_SETTINGS_EVENTS, FinancialPolicyUpdatedEvent } from '../domain/catalog-settings-events';
import { DEFAULT_TARGET_ROAS, FinancialPolicy, FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';

// Resposta à pergunta "como buscar isso de forma eficiente sem consulta
// pesada a cada cálculo": CatalogSettings já é uma linha por tenant (lookup
// por chave primária — não é, tecnicamente, uma consulta pesada), mas
// PricingDecisionService pode chamar isso MUITAS vezes por segundo num
// motor de repricing em lote. Em vez de introduzir uma dependência nova
// (Redis) só para isso — o resto da stack não usa cache distribuído ainda —
// um cache em memória, por processo, com TTL curto resolve o volume atual
// sem custo de infraestrutura:
//
// - Leitura: cache-aside simples (Map por tenantId, expiração por timestamp).
// - Invalidação: em vez de confiar só no TTL (que deixaria uma mudança de
//   política valendo só depois de alguns minutos), CatalogSettingsService
//   emite um evento quando a política muda (mesmo EventEmitter2 usado em
//   todo o resto da plataforma) e este serviço assina para limpar a entrada
//   na hora — muda de "eventualmente correto" para "correto no próximo
//   cálculo depois da atualização".
//
// LIMITAÇÃO HONESTA: este cache é local ao processo. Se um dia a API rodar
// em múltiplas instâncias (horizontal scaling), cada instância teria sua
// própria cópia, e a invalidação por EventEmitter2 (in-process) não
// alcançaria as outras — nesse cenário, a invalidação precisaria virar um
// evento publicado (Redis pub/sub, ou o broker que a Etapa de extração de
// serviço adotar, ver docs/platform-architecture.md, seção 9). Não
// resolvido aqui porque a plataforma ainda roda como monólito de um
// processo só.
const CACHE_TTL_MS = 5 * 60_000; // 5 minutos — política financeira não muda com alta frequência

interface CacheEntry {
  policy: FinancialPolicy;
  expiresAt: number;
}

@Injectable()
export class FinancialPolicyReaderService implements FinancialPolicyReader {
  private readonly logger = new Logger(FinancialPolicyReaderService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly settingsService: CatalogSettingsService) {}

  async getPolicy(tenantId: string): Promise<FinancialPolicy> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policy;
    }

    const { taxRatePct, minProfitMarginPct, targetRoas } = await this.settingsService.getFinancialPolicy(tenantId);
    // targetRoas é o único campo desta política que NÃO é percentual-para-fração
    // (já é um múltiplo, ex. 3 = "3x o gasto") — só o fallback acontece aqui,
    // nenhuma conversão de unidade.
    const policy: FinancialPolicy = {
      taxRate: taxRatePct / 100,
      minProfitMargin: minProfitMarginPct / 100,
      targetRoas: targetRoas ?? DEFAULT_TARGET_ROAS,
    };
    this.cache.set(tenantId, { policy, expiresAt: Date.now() + CACHE_TTL_MS });
    return policy;
  }

  @OnEvent(CATALOG_SETTINGS_EVENTS.FINANCIAL_POLICY_UPDATED)
  handlePolicyUpdated(payload: FinancialPolicyUpdatedEvent): void {
    this.cache.delete(payload.tenantId);
    this.logger.log(`Cache de política financeira invalidado para o tenant ${payload.tenantId} (política atualizada).`);
  }
}
