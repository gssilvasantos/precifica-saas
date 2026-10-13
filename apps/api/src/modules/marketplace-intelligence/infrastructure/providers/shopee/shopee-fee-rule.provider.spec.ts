import { ShopeeFeeRuleProvider, SHOPEE_FEE_RULE_SCOPE } from './shopee-fee-rule.provider';
import { validateFeeRulePayload } from '../../../domain/rule-payload-validators';
import { resolveFeeAtPrice } from '../../../../../shared/contracts/fee-rule-resolver.port';

describe('ShopeeFeeRuleProvider', () => {
  const provider = new ShopeeFeeRuleProvider();

  it('não declara capacidade de nada além de FEE_RULES (tabela estática, sem OAuth/listing)', () => {
    expect(provider.capabilities).toEqual(['FEE_RULES']);
    expect(provider.sourceType).toBe('OFFICIAL_DOCS'); // honestidade: não é sondagem de API real, ver comentário no provider
  });

  it('fetchFeeRules devolve um único candidato no escopo GLOBAL (Shopee não diferencia por categoria)', async () => {
    const candidates = await provider.fetchFeeRules({ marketplaceCode: 'SHOPEE' });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].scopeKey).toBe(SHOPEE_FEE_RULE_SCOPE);
    expect(candidates[0].sourceEvidenceRef).toContain('ruacep.com.br');
  });

  it('o payload passa pelo validador real de FEE_RULE (nunca seria persistido se não passasse)', async () => {
    const [candidate] = await provider.fetchFeeRules({ marketplaceCode: 'SHOPEE' });
    const validated = validateFeeRulePayload(candidate.payload);

    expect(validated.tiers).toHaveLength(4);
    expect(validated.commissionBase).toBe('ITEM_PRICE');
    expect(validated.commissionCapAmount).toBeNull(); // teto de R$100 removido (vigência 01/03/2026)
  });

  it.each([
    [50, 0.2 * 50 + 4], // abaixo de R$80
    [90, 0.14 * 90 + 16], // R$80-99,99
    [150, 0.14 * 150 + 20], // R$100-199,99
    [500, 0.14 * 500 + 26], // acima de R$200, sem teto de comissão
  ])('resolve a taxa correta para o preço %p', async (price, expectedFeeAmount) => {
    const [candidate] = await provider.fetchFeeRules({ marketplaceCode: 'SHOPEE' });
    const validated = validateFeeRulePayload(candidate.payload);
    const resolved = { ...validated, commissionCapAmount: validated.commissionCapAmount ?? null, ruleId: 'r', ruleVersion: 1 };

    const fee = resolveFeeAtPrice(resolved, price);

    expect(fee.totalFeeAmount).toBeCloseTo(expectedFeeAmount, 2);
  });
});
