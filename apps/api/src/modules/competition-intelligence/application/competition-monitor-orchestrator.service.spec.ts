import { EventEmitter2 } from '@nestjs/event-emitter';
import { CompetitionMonitorOrchestrator } from './competition-monitor-orchestrator.service';
import { CompetitionRadarRegistry } from './competition-radar-registry.service';
import { MonitoredListing, MonitoredListingRepository } from './ports/monitored-listing-repository.port';
import { CompetitorOfferSnapshotRepository } from './ports/competitor-offer-snapshot-repository.port';
import { CompetitiveOpportunityRepository } from './ports/competitive-opportunity-repository.port';
import { BuyBoxStatusChangeRepository } from './ports/buy-box-status-change-repository.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { CompetitionRadar } from '../../../shared/contracts/competition-radar.contract';

// Bug de produção (25/11/2026) reproduzido aqui: runAll() era chamado tanto
// pelo cron (EVERY_10_MINUTES) quanto pelo botão ATUALIZAR
// (POST /competition-intelligence/run-now) sem nenhuma trava contra
// execuções sobrepostas. Com 1748 listagens ativas e 1 req/s de rate limit
// pro Mercado Livre, um ciclo levava mais que os 10min do cron — ciclos se
// empilhavam indefinidamente, gerando o volume de chamadas que o Mercado
// Livre passou a bloquear com 403 (ver comentário em runAll()). O segundo
// bug reproduzido: falha de listagem individual nunca chegava ao nível que
// decide SUCCESS/FAILED, então 100% de falha ainda reportava SUCCESS — é
// por isso que o bloqueio ficou 2 dias sem gerar nenhum alerta.
describe('CompetitionMonitorOrchestrator', () => {
  function fakeListing(overrides: Partial<MonitoredListing> = {}): MonitoredListing {
    return {
      id: 'listing-1',
      tenantId: 'tenant-1',
      skuCode: 'SKU-1',
      competitorLabel: 'Concorrente',
      targetRef: 'MLB123',
      radarCode: 'MERCADO_LIVRE_CATALOG_V1',
      channelCode: null,
      isActive: true,
      ...overrides,
    };
  }

  function buildOrchestrator() {
    const radar = { code: 'MERCADO_LIVRE_CATALOG_V1', sourceType: 'PARTNER_API', fetchOffers: jest.fn(), healthCheck: jest.fn() } as unknown as jest.Mocked<CompetitionRadar>;
    const radars = { findByCode: jest.fn().mockReturnValue(radar), getAll: jest.fn() } as unknown as jest.Mocked<CompetitionRadarRegistry>;
    const listings = { create: jest.fn(), findAllActive: jest.fn(), findAllActiveByTenant: jest.fn(), setActive: jest.fn() } as unknown as jest.Mocked<MonitoredListingRepository>;
    const snapshots = { createMany: jest.fn() } as unknown as jest.Mocked<CompetitorOfferSnapshotRepository>;
    const opportunities = {
      upsert: jest.fn(),
      findByTenantAndSku: jest.fn().mockResolvedValue(null),
      findAllByTenant: jest.fn(),
    } as unknown as jest.Mocked<CompetitiveOpportunityRepository>;
    const statusChanges = { create: jest.fn(), findByTenant: jest.fn(), deleteOlderThan: jest.fn() } as unknown as jest.Mocked<BuyBoxStatusChangeRepository>;
    const channelListings = { findBySku: jest.fn().mockResolvedValue(null), findSkusByExternalIds: jest.fn() } as unknown as jest.Mocked<ChannelListingReader>;
    const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn() } as unknown as jest.Mocked<ProviderSyncLogRepository>;
    const health = { recordSuccess: jest.fn(), recordFailure: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<ProviderHealthRepository>;
    const events = { emit: jest.fn() } as unknown as jest.Mocked<EventEmitter2>;

    const orchestrator = new CompetitionMonitorOrchestrator(
      radars,
      listings,
      snapshots,
      opportunities,
      statusChanges,
      channelListings,
      syncLogs,
      health,
      events,
    );

    return { orchestrator, radar, radars, listings, snapshots, opportunities, statusChanges, channelListings, syncLogs, health, events };
  }

  it('ignora uma segunda chamada enquanto o ciclo anterior ainda está rodando, sem empilhar', async () => {
    const { orchestrator, radar, listings, syncLogs } = buildOrchestrator();
    listings.findAllActive.mockResolvedValue([fakeListing()]);

    let resolveFetch!: (offers: ReturnType<typeof Array>) => void;
    radar.fetchOffers.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve as unknown as (offers: ReturnType<typeof Array>) => void;
      }),
    );

    const firstRun = orchestrator.runAll(); // não espera — ciclo ainda "em andamento"
    await Promise.resolve(); // deixa o microtask de runAll() chegar até o fetchOffers pendente

    await orchestrator.runAll(); // segunda chamada (cron OU botão ATUALIZAR) enquanto a primeira roda

    // A segunda chamada não deve ter começado um novo ciclo: só 1 log iniciado.
    expect(syncLogs.start).toHaveBeenCalledTimes(1);
    expect(listings.findAllActive).toHaveBeenCalledTimes(1);

    resolveFetch([]);
    await firstRun;

    // Depois que o primeiro ciclo termina, a trava libera para o próximo.
    await orchestrator.runAll();
    expect(syncLogs.start).toHaveBeenCalledTimes(2);
  });

  it('reporta FAILED (e aciona ProviderHealth.recordFailure) quando 100% das listagens falham, em vez de SUCCESS vazio', async () => {
    const { orchestrator, radar, listings, syncLogs, health } = buildOrchestrator();
    listings.findAllActive.mockResolvedValue([fakeListing({ id: 'a' }), fakeListing({ id: 'b', skuCode: 'SKU-2' })]);
    radar.fetchOffers.mockRejectedValue(new Error('Mercado Livre products/items API retornou 403 para MLB123'));

    await expect(orchestrator.runAll()).rejects.toThrow('403');

    expect(health.recordFailure).toHaveBeenCalledWith('COMPETITION_RADAR_MONITOR', expect.stringContaining('403'));
    expect(syncLogs.finish).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ status: 'FAILED', candidatesFound: 2, candidatesApplied: 0 }),
    );
    expect(health.recordSuccess).not.toHaveBeenCalled();
  });

  it('continua reportando SUCCESS quando só parte das listagens falha (falha parcial não é falha total)', async () => {
    const { orchestrator, radar, listings, syncLogs, health } = buildOrchestrator();
    listings.findAllActive.mockResolvedValue([fakeListing({ id: 'a' }), fakeListing({ id: 'b', skuCode: 'SKU-2' })]);
    radar.fetchOffers
      .mockRejectedValueOnce(new Error('Mercado Livre products/items API retornou 403 para MLB123'))
      .mockResolvedValueOnce([{ competitorLabel: 'Vendedor 9', price: 50, isBuyBoxWinner: false, collectedAt: new Date() }]);

    await orchestrator.runAll();

    expect(health.recordSuccess).toHaveBeenCalledWith('COMPETITION_RADAR_MONITOR');
    expect(syncLogs.finish).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ status: 'SUCCESS', candidatesFound: 2, candidatesApplied: 1 }),
    );
  });

  // Disjuntor (25/11/2026, segunda parte do mesmo incidente): depois do fix
  // acima (guarda contra empilhamento), o deploy em produção confirmou que a
  // trava funcionou (log "runAll() ignorado..."), mas os 403 do Mercado Livre
  // continuavam ocorrendo ininterruptamente DENTRO de um único ciclo — um
  // ciclo sozinho ainda percorre todas as listagens ativas a 1 req/s mesmo
  // sabendo, depois de poucas tentativas, que o provider está fora do ar.
  it('interrompe o ciclo após MAX_CONSECUTIVE_FAILURES falhas seguidas, em vez de tentar todas as listagens', async () => {
    const { orchestrator, radar, listings, syncLogs, health } = buildOrchestrator();
    const manyListings = Array.from({ length: 15 }, (_, i) => fakeListing({ id: `listing-${i}`, skuCode: `SKU-${i}` }));
    listings.findAllActive.mockResolvedValue(manyListings);
    radar.fetchOffers.mockRejectedValue(new Error('Mercado Livre products/items API retornou 403 para MLB123'));

    await expect(orchestrator.runAll()).rejects.toThrow(/[Dd]isjuntor/);

    // Só as primeiras 10 (MAX_CONSECUTIVE_FAILURES) devem ter sido tentadas —
    // não as 15 listagens ativas.
    expect(radar.fetchOffers).toHaveBeenCalledTimes(10);
    expect(health.recordFailure).toHaveBeenCalledWith('COMPETITION_RADAR_MONITOR', expect.stringContaining('isjuntor'));
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED', candidatesFound: 10 }));
  });

  it('não aciona o disjuntor quando falhas e sucessos se intercalam (sem sequência longa de falhas)', async () => {
    const { orchestrator, radar, listings, syncLogs, health } = buildOrchestrator();
    const manyListings = Array.from({ length: 12 }, (_, i) => fakeListing({ id: `listing-${i}`, skuCode: `SKU-${i}` }));
    listings.findAllActive.mockResolvedValue(manyListings);
    radar.fetchOffers.mockImplementation((ctx: { skuCode: string }) =>
      Number(ctx.skuCode.replace('SKU-', '')) % 2 === 0
        ? Promise.reject(new Error('Mercado Livre products/items API retornou 403 para MLB123'))
        : Promise.resolve([{ competitorLabel: 'Vendedor 9', price: 50, isBuyBoxWinner: false, collectedAt: new Date() }]),
    );

    await orchestrator.runAll();

    expect(radar.fetchOffers).toHaveBeenCalledTimes(12);
    expect(health.recordSuccess).toHaveBeenCalledWith('COMPETITION_RADAR_MONITOR');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS', candidatesFound: 12 }));
  });
});
