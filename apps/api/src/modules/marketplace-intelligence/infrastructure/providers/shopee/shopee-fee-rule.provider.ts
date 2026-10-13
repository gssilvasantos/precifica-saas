import { Injectable, Logger } from '@nestjs/common';
import { FeeRuleCapableProvider, FetchContext, ProviderCapability, ProviderHealthStatus, RawRuleCandidate } from '../../../../../shared/contracts/marketplace-provider.contract';

// AVISO DE HONESTIDADE (13/10/2026): diferente do Mercado Livre
// (mercado-livre-fee-rule.provider.ts), a Shopee Open Platform NÃO expõe um
// endpoint público equivalente a `listing_prices` para sondar a tabela de
// comissão por categoria/preço — o client hoje (shopee-api-client.ts) não
// tem nenhuma chamada de taxa/comissão, só catálogo/pedido/categoria. A
// comissão da Shopee Brasil é publicada como tabela por FAIXA DE PREÇO (não
// por categoria, ao contrário do Mercado Livre) no Seller Center e em
// materiais de terceiros que citam o Seller Center — não foi confirmada
// contra uma chamada de API real.
//
// Por isso este provider é `sourceType: 'OFFICIAL_DOCS'`: uma tabela ESTÁTICA,
// digitada a partir de documentação pública (não uma sondagem ao vivo como o
// ML). `fetchFeeRules` sempre devolve a MESMA tabela até alguém atualizar
// esta constante — o pipeline de sync (RuleSyncOrchestrator) só grava de
// novo quando o conteúdo muda (contentHash), então rodar isso repetidamente
// não duplica nada.
//
// A tabela entra como PENDENTE_VALIDACAO (autoTrust=false no seed, mesma
// governança do Mercado Livre) — alguém com acesso ao Seller Center real da
// Rita Mazzei Beauty precisa confirmar os valores antes de validar em
// /governanca-marketplace. Fonte usada para a tabela abaixo: "Comissão de
// marketplace em 2026: ML, Amazon, Shopee e Magalu com as taxas atualizadas"
// (ruacep.com.br, citando o Shopee Seller Center, vigência 01/03/2026) — ver
// `SOURCE_REF`. NÃO é a fonte primária (Shopee), e pode estar desatualizada;
// corrija a tabela se o Seller Center mostrar valores diferentes.
const SOURCE_REF =
  'https://www.ruacep.com.br/guias/ecommerce/comissao-marketplace-ml-amazon-shopee-magalu-2026/ ' +
  '(terceiro, citando o Shopee Seller Center — vigência informada: 01/03/2026; NÃO confirmado contra a API/Seller Center real da conta)';

// Faixas por PREÇO do produto (não por categoria — diferença explícita do
// Mercado Livre). Teto de comissão (que existia até R$100) foi removido —
// por isso `commissionCapAmount: null` no payload abaixo.
const PRICE_TIERS = [
  { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4.0 },
  { minPrice: 80, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 16.0 },
  { minPrice: 100, maxPrice: 200, commissionPct: 0.14, fixedFeeAmount: 20.0 },
  { minPrice: 200, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 26.0 },
];

// A Shopee não diferencia comissão por categoria nem por tipo de anúncio —
// por isso um único escopo 'GLOBAL' (mesma convenção de fallback que
// PricingDecisionService já usa para canais sem categoria), nunca
// buildFeeScopeKey(categoria, tipo) como o Mercado Livre.
export const SHOPEE_FEE_RULE_SCOPE = 'GLOBAL';

@Injectable()
export class ShopeeFeeRuleProvider implements FeeRuleCapableProvider {
  readonly code = 'SHOPEE_FEE_SCHEDULE_DOCS_V1';
  readonly marketplaceCode = 'SHOPEE';
  readonly sourceType = 'OFFICIAL_DOCS' as const;
  readonly capabilities = [ProviderCapability.FEE_RULES];

  private readonly logger = new Logger(ShopeeFeeRuleProvider.name);

  async healthCheck(): Promise<ProviderHealthStatus> {
    // Não há chamada de rede nesta capacidade (tabela estática) — sempre UP.
    return { status: 'UP' };
  }

  async fetchFeeRules(_ctx: FetchContext): Promise<RawRuleCandidate[]> {
    this.logger.debug('Fee rule da Shopee: tabela estática por faixa de preço (OFFICIAL_DOCS) — sem chamada de API.');
    return [
      {
        scopeKey: SHOPEE_FEE_RULE_SCOPE,
        payload: {
          tiers: PRICE_TIERS,
          commissionBase: 'ITEM_PRICE',
          commissionCapAmount: null,
        },
        sourceEvidenceRef: SOURCE_REF,
        fetchedAt: new Date(),
      },
    ];
  }
}
