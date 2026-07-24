import { ProductAuditLogService } from './product-audit-log.service';
import { ProductAuditLogRepository, ProductAuditLogEntry } from './ports/product-audit-log-repository.port';
import { ProductAuditEntryInput } from '../domain/product-audit';

// Sem Prisma (repo é uma PORTA/interface, injetada como mock) — totalmente
// verificável neste sandbox. Foco: o serviço só serializa (número -> string,
// preservando null) e delega, nenhuma decisão de "o que auditar" mora aqui.
describe('ProductAuditLogService', () => {
  function buildService() {
    const repo: jest.Mocked<ProductAuditLogRepository> = {
      create: jest.fn().mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'audit-1', changedAt: new Date() } as ProductAuditLogEntry),
      ),
      findAllForProduct: jest.fn().mockResolvedValue([]),
    };
    const service = new ProductAuditLogService(repo);
    return { service, repo };
  }

  it('record(): serializa cada entrada (número -> string) e grava via o repositório', async () => {
    const { service, repo } = buildService();
    const entries: ProductAuditEntryInput[] = [
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: 50, newValue: 65 },
    ];

    await service.record('tenant-1', entries, { userId: 'user-1', source: 'MANUAL' });

    expect(repo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      skuCode: 'SKU-001',
      field: 'mapPrice',
      oldValue: '50',
      newValue: '65',
      changedByUserId: 'user-1',
      source: 'MANUAL',
    });
  });

  it('record(): preserva null (não serializa "null" como string)', async () => {
    const { service, repo } = buildService();
    const entries: ProductAuditEntryInput[] = [
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: 50, newValue: null },
    ];

    await service.record('tenant-1', entries, { userId: 'user-1', source: 'MANUAL' });

    const callArg = repo.create.mock.calls[0][0];
    expect(callArg.oldValue).toBe('50');
    expect(callArg.newValue).toBeNull();
  });

  it('record(): grava uma entrada por item, cada uma com o source do actor', async () => {
    const { service, repo } = buildService();
    const entries: ProductAuditEntryInput[] = [
      { productId: 'prod-1', skuCode: 'SKU-001', field: 'mapPrice', oldValue: null, newValue: 40 },
    ];

    await service.record('tenant-1', entries, { userId: 'user-2', source: 'BULK_IMPORT' });

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create.mock.calls[0][0].source).toBe('BULK_IMPORT');
  });

  it('record(): lista vazia de entradas não chama o repositório', async () => {
    const { service, repo } = buildService();

    await service.record('tenant-1', [], { userId: 'user-1', source: 'MANUAL' });

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('listForProduct(): delega ao repositório com tenantId e productId', async () => {
    const { service, repo } = buildService();

    await service.listForProduct('tenant-1', 'prod-1');

    expect(repo.findAllForProduct).toHaveBeenCalledWith('tenant-1', 'prod-1');
  });
});
