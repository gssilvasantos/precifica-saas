import { EventEmitter2 } from '@nestjs/event-emitter';
import { PackagingsService } from './packaging.service';
import { PackagingRepository } from './ports/packaging-repository.port';
import { Packaging } from '../domain/packaging.entity';

describe('PackagingsService (evento de mudança de custo)', () => {
  const existing: Packaging = {
    id: 'pack-1',
    tenantId: 'tenant-1',
    name: 'Caixa 20x15x10',
    weightG: 300,
    heightCm: 10,
    widthCm: 15,
    lengthCm: 20,
    costPrice: 5,
    stockQuantity: 50,
    isActive: true,
    purpose: 'STANDARD',
    maxCapacityKg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildService(updated: Packaging) {
    const repository: jest.Mocked<PackagingRepository> = {
      create: jest.fn(),
      findAllActive: jest.fn(),
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(updated),
      deactivate: jest.fn(),
      findSafetyDefault: jest.fn(),
      findAllMaster: jest.fn(),
    };
    const events = new EventEmitter2();
    const emitSpy = jest.spyOn(events, 'emit');
    const service = new PackagingsService(repository, events);
    return { service, repository, emitSpy };
  }

  it('costPrice mudou: emite catalog.packaging-cost-changed com os dois valores', async () => {
    const { service, emitSpy } = buildService({ ...existing, costPrice: 8 });

    await service.update('tenant-1', 'pack-1', { costPrice: 8 });

    expect(emitSpy).toHaveBeenCalledWith('catalog.packaging-cost-changed', {
      tenantId: 'tenant-1',
      packagingId: 'pack-1',
      previousCostPrice: 5,
      newCostPrice: 8,
    });
  });

  it('costPrice não mudou (outro campo alterado): não emite evento', async () => {
    const { service, emitSpy } = buildService({ ...existing, name: 'Caixa renomeada' });

    await service.update('tenant-1', 'pack-1', { name: 'Caixa renomeada' });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('costPrice enviado igual ao atual: não emite evento', async () => {
    const { service, emitSpy } = buildService({ ...existing });

    await service.update('tenant-1', 'pack-1', { costPrice: 5 });

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
