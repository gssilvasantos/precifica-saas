import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKETPLACE_REPOSITORY, MarketplaceRepository } from './ports/marketplace-repository.port';
import { MARKETPLACE_RULE_REPOSITORY, MarketplaceRuleRepository } from './ports/marketplace-rule-repository.port';
import { FeeRuleResolver, ResolvedFeeRule } from '../../../shared/contracts/fee-rule-resolver.port';
import { buildFeeScopeKey, FeeRulePayload, MarketplaceRule } from '../domain/marketplace-rule.entity';
import { validateFeeRulePayload, validateShippingPolicyPayload } from '../domain/rule-payload-validators';
import {
  ResolvedShippingPolicy,
  ShippingPolicyResolver,
} from '../../../shared/contracts/shipping-policy-resolver.port';

// A política de frete é UMA por canal — não varia por categoria como a
// comissão. O scopeKey fixo deixa isso explícito em vez de reaproveitar a
// convenção 'GLOBAL' da FEE_RULE, que ali significa "vale para qualquer
// categoria" (um fallback) e aqui significaria outra coisa.
const SHIPPING_POLICY_SCOPE = 'CHANNEL';

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
export class RuleRegistryService implements FeeRuleResolver, ShippingPolicyResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(MARKETPLACE_REPOSITORY) private readonly marketplaces: MarketplaceRepository,
    @Inject(MARKETPLACE_RULE_REPOSITORY) private readonly rules: MarketplaceRuleRepository,
  ) {}

  async resolveFeeRule(params: {
    marketplaceCode: string;
    categoryCode: string;
    tenantId: string;
    listingTypeId?: string;
    atDate?: Date;
  }): Promise<ResolvedFeeRule | null> {
    const atDate = params.atDate ?? new Date();
    // O tipo de anúncio entra na chave de cache: no Mercado Livre, Clássico
    // e Premium na MESMA categoria diferem em até 5 pontos percentuais —
    // reaproveitar cache entre eles devolveria a taxa do outro.
    const cacheKey = this.buildCacheKey(
      params.marketplaceCode,
      params.categoryCode,
      params.tenantId,
      atDate,
      params.listingTypeId,
    );

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const marketplace = await this.marketplaces.findByCode(params.marketplaceCode);
    if (!marketplace) return null;

    // Do mais específico para o mais genérico. `categoria#tipoDeAnúncio` é
    // como o provider do ML grava desde 01/08/2026; `categoria` sozinha
    // atende os canais que não diferenciam tipo de anúncio (Shopee, Shein,
    // Magalu, TikTok) e as regras importadas antes dessa mudança.
    const scopeKeysToTry = params.listingTypeId
      ? [buildFeeScopeKey(params.categoryCode, params.listingTypeId), params.categoryCode]
      : [params.categoryCode];

    let resolved: ResolvedFeeRule | null = null;
    for (const scopeKey of scopeKeysToTry) {
      const rule = await this.rules.resolveEffective(marketplace.id, 'FEE_RULE', scopeKey, params.tenantId, atDate);
      if (rule) {
        resolved = this.toResolvedFeeRule(rule);
        break;
      }
    }

    this.cache.set(cacheKey, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  }

  // Política de frete do canal — quem paga a entrega e a partir de qual
  // preço. Sem cache próprio: é consultada uma vez por decisão de preço,
  // muito menos que a de comissão (que é por categoria), e o ganho não
  // pagaria a complexidade de mais uma invalidação para manter.
  async resolveShippingPolicy(params: {
    marketplaceCode: string;
    tenantId: string;
    atDate?: Date;
  }): Promise<ResolvedShippingPolicy | null> {
    const atDate = params.atDate ?? new Date();

    const marketplace = await this.marketplaces.findByCode(params.marketplaceCode);
    if (!marketplace) return null;

    const rule = await this.rules.resolveEffective(
      marketplace.id,
      'SHIPPING_POLICY',
      SHIPPING_POLICY_SCOPE,
      params.tenantId,
      atDate,
    );
    if (!rule) return null;

    const payload = validateShippingPolicyPayload(rule.payload);
    return { bands: payload.bands, ruleId: rule.id, ruleVersion: rule.version };
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

  // Normaliza pelo validador antes de expor: regras gravadas no formato
  // escalar antigo viram uma tabela de uma faixa só, e a unidade de
  // commissionPct é conferida aqui também. Assim nenhum consumidor precisa
  // saber que existiu um formato anterior — e uma regra antiga com unidade
  // ambígua falha na leitura, alto e claro, em vez de virar preço errado.
  private toResolvedFeeRule(rule: MarketplaceRule): ResolvedFeeRule {
    const payload = validateFeeRulePayload(rule.payload) as FeeRulePayload;
    return {
      tiers: payload.tiers,
      commissionBase: payload.commissionBase,
      commissionCapAmount: payload.commissionCapAmount ?? null,
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  }

  private buildCacheKey(
    marketplaceCode: string,
    categoryCode: string,
    tenantId: string,
    atDate: Date,
    listingTypeId?: string,
  ): string {
    const dateBucket = atDate.toISOString().slice(0, 10);
    return `feerule:${marketplaceCode}:${categoryCode}:${listingTypeId ?? '-'}:${tenantId}:${dateBucket}`;
  }
}
