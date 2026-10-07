import { CompetitionMonitorOrchestrator } from './competition-monitor-orchestrator.service';
import { MonitoredListing } from './ports/monitored-listing-repository.port';

const listing = (tenantId: string, id: string): MonitoredListing => ({
  id,
  tenantId,
  skuCode: `SKU-${id}`,
  competitorLabel: 'auto',
  targetRef: `MLB${id}`,
  radarCode: 'RADAR',
  channelCode: 'MERCADO_LIVRE',
  isActive: true,
});

function build(active: MonitoredListing[], fetchOffers: jest.Mock) {
  const listings = { findAllActive: jest.fn().mockResolvedValue(active) };
  const radars = { findByCode: jest.fn().mockReturnValue({ code: 'RADAR', fetchOffers }) };
  const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn().mockResolvedValue(undefined) };
  const health = { recordSuccess: jest.fn(), recordFailure: jest.fn() };
  const orchestrator = new CompetitionMonitorOrchestrator(
    radars as never,
    listings as never,
    {} as never,
    {} as never,
    {} as never,
    syncLogs as never,
    health as never,
    { emit: jest.fn() } as never,
  );
  return { orchestrator, listings, syncLogs };
}

describe('CompetitionMonitorOrchestrator.runAll', () => {
  // Caso de produção (07/10/2026): com 1.710 monitoramentos, um ciclo leva
  // mais que os 10 minutos do cron. Sem trava, um ciclo novo começava por
  // cima do anterior, os dois disputavam a mesma cota da API do ML e nenhum
  // terminava — nenhum ciclo concluído desde 23/09.
  it('não inicia um ciclo novo enquanto o anterior ainda está rodando', async () => {
    let release!: () => void;
    const fetchOffers = jest.fn(() => new Promise<never[]>((resolve) => (release = () => resolve([]))));
    const { orchestrator, listings, syncLogs } = build([listing('a', '1')], fetchOffers);

    const first = orchestrator.runAll();
    await new Promise((resolve) => setImmediate(resolve));
    await orchestrator.runAll();

    expect(listings.findAllActive).toHaveBeenCalledTimes(1);
    expect(syncLogs.start).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('libera a trava quando o ciclo termina, mesmo com erro', async () => {
    const fetchOffers = jest.fn().mockResolvedValue([]);
    const { orchestrator, listings } = build([listing('a', '1')], fetchOffers);
    listings.findAllActive.mockRejectedValueOnce(new Error('banco fora'));

    await expect(orchestrator.runAll()).rejects.toThrow('banco fora');
    await orchestrator.runAll();

    expect(listings.findAllActive).toHaveBeenCalledTimes(2);
  });

  it('processa os tenants intercalados, não na ordem de cadastro', async () => {
    const fetchOffers = jest.fn().mockResolvedValue([]);
    const { orchestrator } = build(
      [listing('demo', 'd1'), listing('demo', 'd2'), listing('rita', 'r1'), listing('rita', 'r2')],
      fetchOffers,
    );

    await orchestrator.runAll();

    expect(fetchOffers.mock.calls.map(([ctx]) => ctx.tenantId)).toEqual(['demo', 'rita', 'demo', 'rita']);
  });
});
