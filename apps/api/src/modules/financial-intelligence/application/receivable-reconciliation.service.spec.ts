import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReceivableReconciliationService } from './receivable-reconciliation.service';
import { SettlementParserRegistry } from './settlement-parser-registry.service';
import { ReceivableRecordRepository } from './ports/receivable-record-repository.port';
import { SettlementReportParser } from '../../../shared/contracts/settlement-report-parser.contract';
import { ReceivableRecord } from '../domain/receivable-record.entity';

describe('ReceivableReconciliationService', () => {
  const pendingReceivable: ReceivableRecord = {
    id: 'rec-1',
    tenantId: 'tenant-1',
    amount: 150.5,
    status: 'PENDING',
    expectedDate: new Date('2026-07-10'),
    paidAt: null,
    marketplaceSource: 'NUVEMSHOP',
    externalReference: 'ORDER-1',
    skuCode: 'SKU-001',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildService(parser: SettlementReportParser | undefined, receivable: ReceivableRecord | null) {
    const registry = { findByMarketplaceCode: jest.fn().mockReturnValue(parser) } as unknown as jest.Mocked<SettlementParserRegistry>;
    const repository: jest.Mocked<ReceivableRecordRepository> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByStatus: jest.fn(),
      findByExternalReference: jest.fn().mockResolvedValue(receivable),
      markPaid: jest.fn().mockResolvedValue({ ...pendingReceivable, status: 'PAID', paidAt: new Date() }),
      cancel: jest.fn(),
    };
    const events = new EventEmitter2();
    const emitSpy = jest.spyOn(events, 'emit');
    const service = new ReceivableReconciliationService(registry, repository, events);
    return { service, registry, repository, emitSpy };
  }

  it('sem parser registrado para o marketplace: não reconcilia nada, não lança exceção', async () => {
    const { service, repository } = buildService(undefined, null);

    const result = await service.reconcile('tenant-1', 'DESCONHECIDO', '[]', 'JSON');

    expect(result).toEqual({ matched: 0, alreadyReconciled: 0, unmatchedReferences: [] });
    expect(repository.findByExternalReference).not.toHaveBeenCalled();
  });

  it('casa um repasse PENDING e marca PAID, emitindo RECEIVABLE_PAID', async () => {
    const parser: SettlementReportParser = {
      marketplaceCode: 'NUVEMSHOP',
      parse: jest.fn().mockReturnValue([{ externalReference: 'ORDER-1', amount: 150.5, settledAt: new Date('2026-07-11') }]),
    };
    const { service, repository, emitSpy } = buildService(parser, pendingReceivable);

    const result = await service.reconcile('tenant-1', 'NUVEMSHOP', 'raw', 'JSON');

    expect(repository.markPaid).toHaveBeenCalledWith('rec-1', { status: 'PAID', paidAt: new Date('2026-07-11') });
    expect(emitSpy).toHaveBeenCalledWith(
      'financial-intelligence.receivable-paid',
      expect.objectContaining({ tenantId: 'tenant-1', receivableId: 'rec-1', marketplaceSource: 'NUVEMSHOP' }),
    );
    expect(result).toEqual({ matched: 1, alreadyReconciled: 0, unmatchedReferences: [] });
  });

  it('entrada sem ReceivableRecord correspondente: conta como não casado, não lança exceção', async () => {
    const parser: SettlementReportParser = {
      marketplaceCode: 'NUVEMSHOP',
      parse: jest.fn().mockReturnValue([{ externalReference: 'ORDER-SEM-MATCH', amount: 10, settledAt: new Date() }]),
    };
    const { service, repository } = buildService(parser, null);

    const result = await service.reconcile('tenant-1', 'NUVEMSHOP', 'raw', 'JSON');

    expect(result.unmatchedReferences).toEqual(['ORDER-SEM-MATCH']);
    expect(repository.markPaid).not.toHaveBeenCalled();
  });

  it('é idempotente: reconciliar um repasse já PAID não reprocessa nem reemite o evento', async () => {
    const alreadyPaid: ReceivableRecord = { ...pendingReceivable, status: 'PAID', paidAt: new Date('2026-07-05') };
    const parser: SettlementReportParser = {
      marketplaceCode: 'NUVEMSHOP',
      parse: jest.fn().mockReturnValue([{ externalReference: 'ORDER-1', amount: 150.5, settledAt: new Date('2026-07-11') }]),
    };
    const { service, repository, emitSpy } = buildService(parser, alreadyPaid);

    const result = await service.reconcile('tenant-1', 'NUVEMSHOP', 'raw', 'JSON');

    expect(repository.markPaid).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ matched: 0, alreadyReconciled: 1, unmatchedReferences: [] });
  });
});
