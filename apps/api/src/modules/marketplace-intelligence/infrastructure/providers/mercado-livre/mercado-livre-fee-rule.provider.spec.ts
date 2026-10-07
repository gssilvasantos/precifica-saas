import { groupProbesIntoTiers, MercadoLivreFeeRuleProvider } from './mercado-livre-fee-rule.provider';
import { validateFeeRulePayload } from '../../../domain/rule-payload-validators';

// A sondagem de preços transforma pontos amostrados numa tabela contínua —
// ver docs/marketplace-fee-model-architecture.md, §4.1. Função pura,
// testável sem rede (a API do ML não é chamada aqui).
describe('groupProbesIntoTiers', () => {
  it('agrupa sondagens com a mesma taxa numa faixa só', () => {
    const tiers = groupProbesIntoTiers([
      { price: 15, commissionPct: 0.14, fixedFeeAmount: 0 },
      { price: 25, commissionPct: 0.14, fixedFeeAmount: 0 },
      { price: 50, commissionPct: 0.14, fixedFeeAmount: 0 },
    ]);

    expect(tiers).toEqual([{ minPrice: 0, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 0 }]);
  });

  it('quebra em faixas quando a taxa muda — é o ponto do exercício', () => {
    const tiers = groupProbesIntoTiers([
      { price: 25, commissionPct: 0.14, fixedFeeAmount: 6 },
      { price: 50, commissionPct: 0.14, fixedFeeAmount: 6 },
      { price: 100, commissionPct: 0.14, fixedFeeAmount: 0 }, // acima de R$79 some a tarifa por unidade
      { price: 200, commissionPct: 0.14, fixedFeeAmount: 0 },
    ]);

    expect(tiers).toEqual([
      { minPrice: 0, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 6 },
      { minPrice: 100, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 0 },
    ]);
  });

  it('a primeira faixa sempre começa em 0, mesmo sondando a partir de R$15', () => {
    const tiers = groupProbesIntoTiers([{ price: 15, commissionPct: 0.11, fixedFeeAmount: 3 }]);
    expect(tiers[0].minPrice).toBe(0);
  });

  it('a última faixa sempre fica sem teto', () => {
    const tiers = groupProbesIntoTiers([
      { price: 15, commissionPct: 0.2, fixedFeeAmount: 0 },
      { price: 500, commissionPct: 0.1, fixedFeeAmount: 0 },
    ]);
    expect(tiers[tiers.length - 1].maxPrice).toBeNull();
  });

  it('ordena sondagens que chegarem fora de ordem', () => {
    const tiers = groupProbesIntoTiers([
      { price: 200, commissionPct: 0.1, fixedFeeAmount: 0 },
      { price: 25, commissionPct: 0.2, fixedFeeAmount: 5 },
    ]);

    expect(tiers[0].commissionPct).toBe(0.2);
    expect(tiers[1].commissionPct).toBe(0.1);
  });

  // O contrato de verdade entre provider e domínio: o que a sondagem produz
  // tem que passar no validador. Se estas duas peças divergirem, toda
  // importação vira candidato rejeitado — falha barulhenta, mas inútil.
  it('produz sempre uma tabela que o validador aceita', () => {
    const tiers = groupProbesIntoTiers([
      { price: 15, commissionPct: 0.2, fixedFeeAmount: 6 },
      { price: 78, commissionPct: 0.2, fixedFeeAmount: 6 },
      { price: 100, commissionPct: 0.14, fixedFeeAmount: 0 },
      { price: 1000, commissionPct: 0.12, fixedFeeAmount: 0 },
    ]);

    expect(() => validateFeeRulePayload({ tiers, commissionBase: 'ITEM_PRICE' })).not.toThrow();
  });
});

// Bug de produção (07/10/2026): a API de categorias e de listing_prices do
// Mercado Livre passou a responder 403 para chamada anônima — o mesmo
// comportamento que quebrou o radar em 19/09. Desde julho nenhuma regra de
// comissão do ML foi importada, e sem regra o motor de preço se recusa a
// decidir. As regras do ML são globais (não dependem do vendedor), então
// basta o token de QUALQUER conexão ativa.
describe('MercadoLivreFeeRuleProvider — autenticação da importação de taxas', () => {
  function build(tenantTokens: Record<string, string | Error>) {
    const client = {
      fetchTopLevelCategories: jest.fn().mockResolvedValue([{ id: 'MLB1000', name: 'Eletrônicos' }]),
      fetchListingPrices: jest.fn().mockResolvedValue([
        { listing_type_id: 'gold_special', sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } },
      ]),
    };
    const connections = {
      listActiveTenantIds: jest.fn().mockResolvedValue(Object.keys(tenantTokens)),
      getValidAccessToken: jest.fn(async (tenantId: string) => {
        const token = tenantTokens[tenantId];
        if (token instanceof Error) throw token;
        return token;
      }),
    };
    const provider = new MercadoLivreFeeRuleProvider(client as never, connections as never);
    return { provider, client, connections };
  }

  it('usa o token de uma conexão ativa em categorias e em listing_prices', async () => {
    const { provider, client } = build({ 'tenant-a': 'token-a' });

    const candidates = await provider.fetchFeeRules({ marketplaceCode: 'MERCADO_LIVRE' });

    expect(client.fetchTopLevelCategories).toHaveBeenCalledWith('token-a');
    expect(client.fetchListingPrices).toHaveBeenCalledWith('MLB1000', expect.any(Number), 'token-a');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('pula a conexão cujo token não renova e usa a próxima', async () => {
    const { provider, client } = build({ 'tenant-a': new Error('refresh_token expirado'), 'tenant-b': 'token-b' });

    await provider.fetchFeeRules({ marketplaceCode: 'MERCADO_LIVRE' });

    expect(client.fetchTopLevelCategories).toHaveBeenCalledWith('token-b');
  });

  it('sem nenhuma conexão ativa, segue sem token (comportamento anterior)', async () => {
    const { provider, client } = build({});

    await provider.fetchFeeRules({ marketplaceCode: 'MERCADO_LIVRE' });

    expect(client.fetchTopLevelCategories).toHaveBeenCalledWith(undefined);
  });
});
