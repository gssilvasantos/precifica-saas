import { BuyBoxTransitionsQueryService } from './buy-box-transitions-query.service';
import {
  BuyBoxStatusChangeRecord,
  BuyBoxStatusChangeRepository,
  FindBuyBoxTransitionsFilter,
} from './ports/buy-box-status-change-repository.port';

class FakeBuyBoxStatusChangeRepository implements BuyBoxStatusChangeRepository {
  public lastFilter: FindBuyBoxTransitionsFilter | null = null;
  constructor(private readonly records: BuyBoxStatusChangeRecord[] = []) {}

  async create(): Promise<void> {
    throw new Error('não usado neste teste');
  }

  async findByTenant(filter: FindBuyBoxTransitionsFilter): Promise<BuyBoxStatusChangeRecord[]> {
    this.lastFilter = filter;
    return this.records;
  }
}

describe('BuyBoxTransitionsQueryService', () => {
  it('repassa tenantId, filtros e limite padrão para o repositório', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxTransitionsQueryService(fake);

    await service.findByTenant({ tenantId: 'tenant-1' });

    expect(fake.lastFilter).toEqual({
      tenantId: 'tenant-1',
      newStatus: undefined,
      skuCode: undefined,
      detectedSince: undefined,
      limit: 100,
    });
  });

  it('aplica o teto máximo no servidor mesmo que o cliente peça mais', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxTransitionsQueryService(fake);

    await service.findByTenant({ tenantId: 'tenant-1', limit: 999999 });

    expect(fake.lastFilter?.limit).toBe(500);
  });

  it('repassa filtro por newStatus e skuCode quando informados', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxTransitionsQueryService(fake);

    await service.findByTenant({ tenantId: 'tenant-1', newStatus: 'LOSING', skuCode: 'RM0019' });

    expect(fake.lastFilter?.newStatus).toBe('LOSING');
    expect(fake.lastFilter?.skuCode).toBe('RM0019');
  });

  it('nunca vaza dado de outro tenant — usa só o tenantId recebido', async () => {
    const fake = new FakeBuyBoxStatusChangeRepository();
    const service = new BuyBoxTransitionsQueryService(fake);

    await service.findByTenant({ tenantId: 'tenant-A' });

    expect(fake.lastFilter?.tenantId).toBe('tenant-A');
  });
});
