import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKETPLACE_REPOSITORY, MarketplaceRepository } from './ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY, MarketplaceRuleRepository } from './ports/marketplace-rule-repository.port';
import { FeeRuleResolver, ResolvedFeeRule } from '../../../shared/contracts/fee-rule-resolver.port';
import { FeeRulePayload, MarketplaceRule } from '../domain/marketplace-rule.entity';

interface CacheEntry {
  value: ResolvedFeeRule | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// Implementação em memória, de processo único — suficiente enquanto a API
// roda em uma instância. Vira Redis (mesma interface, cache-aside) quando a
// plataforma escalar horizontalmente; nenhum consumidor desta classe precisa
// mudar quando isso acontecer, porque dependem só da porta FeeRuleResolver
// (docs/platform-architecture.md, seção 7).
@Injectable()
export class RuleRegistryService implements FeeRuleResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplaces: MarketplaceRepository,
    @Inject(MARKETPLACE_RULE_REPOSITORY) private readonly rules: MarketplaceRuleRepository,
  ) {}

  async resolveFeeRule(params: {
    marketplaceCode: string;
    categoryCode: string;
    tenantId: string;
    atDate?: Date;
  }): Promise<ResolvedFeeRule | null> {
    const atDate = params.atDate ?? new Date();
    const cacheKey = this.buildCacheKey(params.marketplaceCode, params.categoryCode, params.tenantId, atDate);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const marketplace = await this.marketplaces.findByCode(params.marketplaceCode);
    if (!marketplace) return null;

    const rule = await this.rules.resolveEffective(
      marketplace.id,
      'FEE_RULE',
      params.categoryCode,
      params.tenantId,
      atDate,
    );

    const resolved = rule ? this.toResolvedFeeRule(rule) : null;
    this.cache.set(cacheKey, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  }

  // Invalidação ativa: quando uma regra é promovida a VALIDADA, o cache
  // correspondente cai na hora, em vez de esperar o TTL vencer.
  @OnEvent('marketplace-rule.validated')
  handleRuleValidated(payload: { scopeKey: string }) {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${payload.scopeKey}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private toResolvedFeeRule(rule: MarketplaceRule): ResolvedFeeRule {
    const payload = rule.payload as FeeRulePayload;
    return {
      commissionPct: payload.commissionPct,
      fixedFeeAmount: payload.fixedFeeAmount,
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  }

  private buildCacheKey(marketplaceCode: string, categoryCode: string, tenantId: string, atDate: Date): string {
    const dateBucket = atDate.toISOString().slice(0, 10);
    return `feerule:${marketplaceCode}:${categoryCode}:${tenantId}:${dateBucket}`;
  }
}
