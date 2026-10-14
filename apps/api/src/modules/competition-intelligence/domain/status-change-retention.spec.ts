import { BUY_BOX_STATUS_CHANGE_RETENTION_DAYS, buyBoxStatusChangeRetentionCutoff } from './status-change-retention';

describe('buyBoxStatusChangeRetentionCutoff', () => {
  it('calcula o corte exatamente 365 dias antes de "now"', () => {
    const now = new Date('2026-10-14T16:00:00.000Z');

    const cutoff = buyBoxStatusChangeRetentionCutoff(now);

    expect(cutoff.toISOString()).toBe('2025-10-14T16:00:00.000Z');
  });

  it('é consistente com a constante de dias exportada (sem valor mágico duplicado)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    const cutoff = buyBoxStatusChangeRetentionCutoff(now);
    const diffDays = (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);

    expect(diffDays).toBe(BUY_BOX_STATUS_CHANGE_RETENTION_DAYS);
  });

  it('não muta a data recebida', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const originalTime = now.getTime();

    buyBoxStatusChangeRetentionCutoff(now);

    expect(now.getTime()).toBe(originalTime);
  });
});
