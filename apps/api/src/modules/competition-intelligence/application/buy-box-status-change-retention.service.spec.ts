import { BuyBoxStatusChangeRetentionService } from './buy-box-status-change-retention.service';
import {
  BuyBoxStatusChangeCreateData,
  BuyBoxStatusChangeRecord,
  BuyBoxStatusChangeRepository,
  FindBuyBoxTransitionsFilter,
} from './ports/buy-box-status-change-repository.port';

class FakeBuyBoxStatusChangeRepository implements BuyBoxStatusChangeRepository {
  public lastCutoff: Date | null = null;
  constructor(private readonly deleteCountToReturn: number = 0) {}

  async create(_data: BuyBoxStatusChangeCreateData): Promise<void> {
    throw new Error('não usado neste teste');
  }

  async findByTenant(_filter: FindBuyBoxTransitionsFilter): Promise<BuyBoxStatusChangeRecord[]> {
    throw new Error('não usado neste teste');
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    this.lastCutoff = cutoff;
    return this.deleteCountToReturn;
  }
}

describe('BuyBoxStatusChangeRetentionService', () => {
  it('calcula o corte em 365 dias antes de "now" e repassa ao repositório', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxStatusChangeRetentionService(fake);
    const now = new Date('2026-10-14T16:00:00.000Z');

    await service.runRetentionCleanup(now);

    expect(fake.lastCutoff?.toISOString()).toBe('2025-10-14T16:00:00.000Z');
  });

  it('repassa a contagem de apagados devolvida pelo repositório', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository(42);
    const service = new BuyBoxStatusChangeRetentionService(fake);

    const result = await service.runRetentionCleanup(new Date());

    expect(result).toEqual({ deletedCount: 42 });
  });

  it('não lança quando não há nada para apagar (zero é resultado válido, não erro)', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository(0);
    const service = new BuyBoxStatusChangeRetentionService(fake);

    const result = await service.runRetentionCleanup(new Date());

    expect(result).toEqual({ deletedCount: 0 });
  });

  it('usa a data corrente real quando "now" não é informado', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxStatusChangeRetentionService(fake);
    const before = Date.now();

    await service.runRetentionCleanup();

    const after = Date.now();
    const cutoffMs = fake.lastCutoff!.getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - oneYearMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - oneYearMs + 1000);
  });
});
