import { buildStatusChangeRecord } from './status-change-recorder';
import { OpportunityResult } from './opportunity-calculator';

function result(overrides: Partial<OpportunityResult> = {}): OpportunityResult {
  return {
    bestCompetitorPrice: 10,
    bestCompetitorLabel: 'Concorrente X',
    priceGapPct: 0,
    buyBoxStatus: 'WINNING',
    rank: 1,
    ...overrides,
  };
}

describe('buildStatusChangeRecord', () => {
  const base = {
    tenantId: 'tenant-1',
    skuCode: 'SKU-1',
    channelCode: 'MERCADO_LIVRE',
    ourPrice: 9,
    detectedAt: new Date('2026-10-14T12:00:00Z'),
  };

  it('retorna null quando o status se mantém igual (WINNING -> WINNING)', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: 'WINNING',
      result: result({ buyBoxStatus: 'WINNING' }),
    });
    expect(record).toBeNull();
  });

  it('retorna null quando o status se mantém igual (LOSING -> LOSING)', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: 'LOSING',
      result: result({ buyBoxStatus: 'LOSING' }),
    });
    expect(record).toBeNull();
  });

  it('registra transição WINNING -> LOSING', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: 'WINNING',
      result: result({ buyBoxStatus: 'LOSING', bestCompetitorPrice: 8, priceGapPct: 0.125, rank: 2 }),
    });
    expect(record).toEqual({
      tenantId: 'tenant-1',
      skuCode: 'SKU-1',
      channelCode: 'MERCADO_LIVRE',
      previousStatus: 'WINNING',
      newStatus: 'LOSING',
      ourPrice: 9,
      bestCompetitorPrice: 8,
      bestCompetitorLabel: 'Concorrente X',
      priceGapPct: 0.125,
      rank: 2,
      detectedAt: base.detectedAt,
    });
  });

  it('registra transição LOSING -> WINNING (recuperação do buy box)', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: 'LOSING',
      result: result({ buyBoxStatus: 'WINNING' }),
    });
    expect(record?.previousStatus).toBe('LOSING');
    expect(record?.newStatus).toBe('WINNING');
  });

  it('registra a primeira leitura processável (previousStatus null -> algo)', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: null,
      result: result({ buyBoxStatus: 'LOSING' }),
    });
    expect(record?.previousStatus).toBeNull();
    expect(record?.newStatus).toBe('LOSING');
  });

  it('registra transição envolvendo UNKNOWN', () => {
    const record = buildStatusChangeRecord({
      ...base,
      previousStatus: 'UNKNOWN',
      result: result({ buyBoxStatus: 'LOSING' }),
    });
    expect(record?.previousStatus).toBe('UNKNOWN');
    expect(record?.newStatus).toBe('LOSING');
  });
});
