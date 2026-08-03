import { validateFeeRulePayload, InvalidRulePayloadError } from './rule-payload-validators';

// O validador é a última linha de defesa entre uma API de marketplace e o
// motor de preço. Ver docs/marketplace-fee-model-architecture.md, §3.2 — a
// versão anterior aceitava commissionPct entre 0 e 100, o que deixava um
// percentual cru (14) passar como se fosse fração (1400%).
describe('validateFeeRulePayload', () => {
  const validTier = { minPrice: 0, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 0 };

  describe('unidade de commissionPct', () => {
    it('aceita fração', () => {
      const result = validateFeeRulePayload({ tiers: [validTier] });
      expect(result.tiers[0].commissionPct).toBe(0.14);
    });

    it('REJEITA percentual cru — o bug que motivou esta mudança', () => {
      expect(() =>
        validateFeeRulePayload({ tiers: [{ ...validTier, commissionPct: 14 }] }),
      ).toThrow(InvalidRulePayloadError);
    });

    it('a mensagem de erro diz o que o provider precisa fazer', () => {
      expect(() => validateFeeRulePayload({ tiers: [{ ...validTier, commissionPct: 11.5 }] })).toThrow(
        /dividir por 100/,
      );
    });
  });

  describe('continuidade das faixas', () => {
    it('aceita faixas contíguas cobrindo de 0 ao infinito (tabela real da Shopee)', () => {
      const result = validateFeeRulePayload({
        tiers: [
          { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4 },
          { minPrice: 80, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 16 },
          { minPrice: 100, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 20 },
        ],
      });
      expect(result.tiers).toHaveLength(3);
    });

    it('rejeita buraco entre faixas — existiria preço sem comissão definida', () => {
      expect(() =>
        validateFeeRulePayload({
          tiers: [
            { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4 },
            { minPrice: 90, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 16 },
          ],
        }),
      ).toThrow(/contíguas/);
    });

    it('rejeita tabela que não começa em 0', () => {
      expect(() =>
        validateFeeRulePayload({ tiers: [{ minPrice: 10, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 0 }] }),
      ).toThrow(/começar em 0/);
    });

    it('rejeita tabela sem faixa final aberta', () => {
      expect(() =>
        validateFeeRulePayload({ tiers: [{ minPrice: 0, maxPrice: 100, commissionPct: 0.14, fixedFeeAmount: 0 }] }),
      ).toThrow(/maxPrice null/);
    });

    it('ordena as faixas mesmo se vierem fora de ordem', () => {
      const result = validateFeeRulePayload({
        tiers: [
          { minPrice: 80, maxPrice: null, commissionPct: 0.14, fixedFeeAmount: 16 },
          { minPrice: 0, maxPrice: 80, commissionPct: 0.2, fixedFeeAmount: 4 },
        ],
      });
      expect(result.tiers[0].minPrice).toBe(0);
    });
  });

  describe('compatibilidade com o payload escalar antigo', () => {
    it('normaliza escalar para tabela de uma faixa só, sem exigir migração', () => {
      const result = validateFeeRulePayload({ commissionPct: 0.11, fixedFeeAmount: 5, referencePrice: 100 });

      expect(result.tiers).toEqual([{ minPrice: 0, maxPrice: null, commissionPct: 0.11, fixedFeeAmount: 5 }]);
      expect(result.referencePrice).toBe(100);
    });

    it('regra antiga com unidade ambígua falha alto, em vez de virar preço errado', () => {
      // 11.5 poderia ser 11,5% ou 1150%. Adivinhar seria pior que falhar —
      // o provider reimporta no próximo sync com a unidade certa.
      expect(() => validateFeeRulePayload({ commissionPct: 11.5, fixedFeeAmount: 0 })).toThrow(
        InvalidRulePayloadError,
      );
    });
  });

  describe('commissionBase', () => {
    it('assume ITEM_PRICE quando ausente (6 dos 7 canais)', () => {
      expect(validateFeeRulePayload({ tiers: [validTier] }).commissionBase).toBe('ITEM_PRICE');
    });

    it('aceita ITEM_PRICE_PLUS_SHIPPING (Amazon cobra sobre produto + frete)', () => {
      const result = validateFeeRulePayload({ tiers: [validTier], commissionBase: 'ITEM_PRICE_PLUS_SHIPPING' });
      expect(result.commissionBase).toBe('ITEM_PRICE_PLUS_SHIPPING');
    });

    it('rejeita valor desconhecido', () => {
      expect(() => validateFeeRulePayload({ tiers: [validTier], commissionBase: 'QUALQUER_COISA' })).toThrow(
        InvalidRulePayloadError,
      );
    });
  });
});
