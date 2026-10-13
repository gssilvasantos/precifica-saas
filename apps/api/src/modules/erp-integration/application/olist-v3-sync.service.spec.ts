import { OlistV3SyncService } from './olist-v3-sync.service';
import { OlistV3ConnectionService } from './olist-v3-connection.service';
import { ErpSyncOrchestrator } from './erp-sync-orchestrator.service';
import { OlistConnectionRepository } from './ports/olist-connection-repository.port';
import { ErpSyncChangeEventRepository } from './ports/erp-sync-change-event-repository.port';
import { ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { OlistV3ApiClient } from '../infrastructure/olist/olist-v3-api.client';

const RL = { limit: 60, remaining: 50, resetSeconds: 5 };
const page = (itens: unknown[]) => ({ data: { itens, paginacao: { total: itens.length } }, rateLimit: RL });
const item = (id: number, sku: string, tipoVariacao = 'N') => ({ id, sku, tipoVariacao });
const detail = (id: number, sku: string, extra: Record<string, unknown> = {}) => ({
  data: {
    id,
    sku,
    descricao: `Produto ${sku}`,
    dimensoes: { pesoLiquido: 1, largura: 1, altura: 1, comprimento: 1 },
    ...extra,
  },
  rateLimit: RL,
});

interface Setup {
  active?: unknown[];
  changed?: unknown[];
  stock?: unknown[];
  imported?: string[];
  details?: Record<string, unknown>;
  cursor?: Date | null;
}

function build(setup: Setup = {}) {
  const connection = { getValidAccessToken: jest.fn().mockResolvedValue('tok') };
  const client = {
    isEnabled: jest.fn().mockReturnValue(true),
    listarProdutos: jest.fn().mockImplementation((_t: string, params: { dataAlteracao?: string }) =>
      Promise.resolve(page(params.dataAlteracao ? (setup.changed ?? []) : (setup.active ?? []))),
    ),
    listarEstoque: jest.fn().mockResolvedValue(page(setup.stock ?? [])),
    obterProduto: jest.fn().mockImplementation((_t: string, id: string) => {
      const d = setup.details?.[id];
      if (d instanceof Error) return Promise.reject(d);
      return Promise.resolve(d ?? detail(Number(id), `SKU${id}`));
    }),
  };
  const importer = { importNormalized: jest.fn().mockResolvedValue({ changed: true, semDimensoes: false }) };
  const connections = {
    findTenantIdsWithV3Tokens: jest.fn().mockResolvedValue(['t1']),
    findByTenant: jest.fn().mockResolvedValue({ isActive: true, lastSyncedAt: null }),
    getV3SyncCursor: jest.fn().mockResolvedValue(setup.cursor ?? new Date('2026-10-12T10:00:00Z')),
    setV3SyncCursor: jest.fn().mockResolvedValue(undefined),
    markSynced: jest.fn().mockResolvedValue(undefined),
    markSyncedWithWarning: jest.fn().mockResolvedValue(undefined),
    markSyncFailed: jest.fn().mockResolvedValue(undefined),
  };
  const changeEvents = { findAllExternalIds: jest.fn().mockResolvedValue(new Set(setup.imported ?? [])) };
  const syncLogs = { start: jest.fn().mockResolvedValue('log1'), finish: jest.fn().mockResolvedValue(undefined) };
  const health = { recordSuccess: jest.fn().mockResolvedValue(undefined), recordFailure: jest.fn().mockResolvedValue(1) };
  const service = new OlistV3SyncService(
    connection as unknown as OlistV3ConnectionService,
    client as unknown as OlistV3ApiClient,
    importer as unknown as ErpSyncOrchestrator,
    connections as unknown as OlistConnectionRepository,
    changeEvents as unknown as ErpSyncChangeEventRepository,
    syncLogs as unknown as ProviderSyncLogRepository,
    health as unknown as ProviderHealthRepository,
  );
  return { service, connection, client, importer, connections, syncLogs, health };
}

describe('OlistV3SyncService.syncTenant', () => {
  it('rodada sem novidade: não busca detalhe, marca sincronizado e avança o cursor', async () => {
    const { service, client, connections } = build({ active: [item(1, 'A')], imported: ['1'] });
    const result = await service.syncTenant('t1');
    expect(result.success).toBe(true);
    expect(client.obterProduto).not.toHaveBeenCalled();
    expect(connections.markSynced).toHaveBeenCalled();
    expect(connections.setV3SyncCursor).toHaveBeenCalledWith('t1', expect.any(Date));
  });

  it('importa produto nunca importado, alterado e com estoque alterado — e só esses', async () => {
    const { service, client, importer } = build({
      active: [item(1, 'A'), item(2, 'B'), item(3, 'C'), item(4, 'D')],
      imported: ['2', '3', '4'],
      changed: [item(2, 'B')],
      stock: [{ idProduto: 3, sku: 'C' }],
    });
    await service.syncTenant('t1');
    const ids = client.obterProduto.mock.calls.map((c) => c[1]).sort();
    expect(ids).toEqual(['1', '2', '3']);
    expect(importer.importNormalized).toHaveBeenCalledTimes(3);
  });

  it('ignora alteração de produto que não está mais ativo', async () => {
    const { service, client } = build({ active: [], imported: ['9'], changed: [item(9, 'Z')] });
    await service.syncTenant('t1');
    expect(client.obterProduto).not.toHaveBeenCalled();
  });

  it('pai é importado antes da variação, e a variação recebe o pai e a grade', async () => {
    const { service, importer } = build({
      active: [item(20, 'P-1', 'V'), item(10, 'P', 'P')],
      details: {
        '20': detail(20, 'P-1', { produtoPai: { id: 10 } }),
        '10': detail(10, 'P', { variacoes: [{ id: 20, sku: 'P-1', grade: [{ chave: 'Cor', valor: 'Rosa' }] }] }),
      },
    });
    await service.syncTenant('t1');
    const calls = importer.importNormalized.mock.calls;
    expect(calls[0][1].externalId).toBe('10');
    expect(calls[1][1].externalId).toBe('20');
    expect(calls[1][2]).toEqual({ parentExternalId: '10', variantAttributes: { Cor: 'Rosa' }, paiImportado: true });
  });

  it('falha transitória mantém o cursor, marca aviso e segue com os demais', async () => {
    const { service, importer, connections } = build({
      active: [item(1, 'A'), item(2, 'B')],
      details: { '1': new Error('falha de rede') },
    });
    const result = await service.syncTenant('t1');
    expect(result.success).toBe(true);
    expect(importer.importNormalized).toHaveBeenCalledTimes(1);
    expect(connections.markSyncedWithWarning).toHaveBeenCalled();
    expect(connections.setV3SyncCursor).not.toHaveBeenCalled();
  });

  it('cadastro inválido no Olist aparece no aviso mas NÃO trava o cursor', async () => {
    const { service, connections } = build({
      active: [item(1, 'A')],
      details: { '1': { data: { id: 1, sku: 'A' }, rateLimit: RL } }, // sem descricao
    });
    await service.syncTenant('t1');
    expect(connections.markSyncedWithWarning).toHaveBeenCalled();
    expect(connections.setV3SyncCursor).toHaveBeenCalled();
  });

  it('429 interrompe a rodada, adia o resto e mantém o cursor', async () => {
    const { service, client, connections } = build({
      active: [item(1, 'A'), item(2, 'B'), item(3, 'C')],
      details: { '1': new Error('Olist v3 /produtos/1 retornou HTTP 429') },
    });
    await service.syncTenant('t1');
    expect(client.obterProduto).toHaveBeenCalledTimes(1);
    expect(connections.setV3SyncCursor).not.toHaveBeenCalled();
    const warning = connections.markSyncedWithWarning.mock.calls[0][2] as string;
    expect(warning).toMatch(/limitou as consultas/);
  });

  it('respeita o teto de produtos por rodada e deixa o resto pendente', async () => {
    const active = Array.from({ length: 130 }, (_, i) => item(i + 1, `S${i + 1}`));
    const { service, importer, connections } = build({ active });
    await service.syncTenant('t1');
    expect(importer.importNormalized).toHaveBeenCalledTimes(120);
    expect(connections.setV3SyncCursor).not.toHaveBeenCalled();
    expect(connections.markSyncedWithWarning.mock.calls[0][2]).toMatch(/10 produto\(s\) ficaram/);
  });

  it('teto por rodada é configurável por ambiente (catch-up) e o cursor avança ao completar', async () => {
    process.env.OLIST_V3_SYNC_MAX_PRODUCTS = '200';
    try {
      const active = Array.from({ length: 130 }, (_, i) => item(i + 1, `S${i + 1}`));
      const { service, importer, connections } = build({ active });
      await service.syncTenant('t1');
      expect(importer.importNormalized).toHaveBeenCalledTimes(130);
      expect(connections.setV3SyncCursor).toHaveBeenCalled();
      process.env.OLIST_V3_SYNC_MAX_PRODUCTS = 'abc';
      const again = build({ active });
      await again.service.syncTenant('t1');
      expect(again.importer.importNormalized).toHaveBeenCalledTimes(120);
    } finally {
      delete process.env.OLIST_V3_SYNC_MAX_PRODUCTS;
    }
  });

  it('produto sem dimensões gera aviso mas o cursor avança', async () => {
    const { service, importer, connections } = build({ active: [item(1, 'A')] });
    importer.importNormalized.mockResolvedValue({ changed: true, semDimensoes: true });
    await service.syncTenant('t1');
    expect(connections.markSyncedWithWarning).toHaveBeenCalled();
    expect(connections.setV3SyncCursor).toHaveBeenCalled();
  });

  it('janela incremental recua 4 h do cursor', async () => {
    const { service, client } = build({ cursor: new Date('2026-10-12T10:00:00Z') });
    await service.syncTenant('t1');
    const withFilter = client.listarProdutos.mock.calls.find((c) => c[1].dataAlteracao)!;
    const since = withFilter[1].dataAlteracao as string;
    // formatOlistV3Date usa UTC: cursor 10:00Z - 4 h de sobreposição.
    expect(since).toBe('2026-10-12 06:00:00');
  });

  it('erro fatal (ex.: token) marca falha, grava log FAILED e devolve success=false', async () => {
    const { service, connection, connections, syncLogs, health } = build();
    connection.getValidAccessToken.mockRejectedValue(new Error('refresh expirado'));
    const result = await service.syncTenant('t1');
    expect(result).toEqual({ success: false, error: 'refresh expirado' });
    expect(connections.markSyncFailed).toHaveBeenCalledWith('t1', 'refresh expirado');
    expect(health.recordFailure).toHaveBeenCalled();
    expect(syncLogs.finish).toHaveBeenCalledWith('log1', expect.objectContaining({ status: 'FAILED' }));
  });

  it('não roda duas vezes ao mesmo tempo para o mesmo tenant', async () => {
    const { service, connection } = build();
    let release!: () => void;
    connection.getValidAccessToken.mockImplementation(() => new Promise((r) => { release = () => r('tok'); }));
    const first = service.syncTenant('t1');
    const second = await service.syncTenant('t1');
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/em andamento/);
    connection.getValidAccessToken.mockResolvedValue('tok');
    release();
    await first;
    const third = await service.syncTenant('t1');
    expect(third.success).toBe(true);
  });
});

describe('OlistV3SyncService.syncAllTenants / keepAliveAll', () => {
  it('só sincroniza quem está vencido pelo intervalo e ativo', async () => {
    const { service, connections } = build();
    connections.findTenantIdsWithV3Tokens.mockResolvedValue(['due', 'fresh', 'off']);
    connections.findByTenant.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'due'
          ? { isActive: true, lastSyncedAt: new Date(Date.now() - 120 * 60_000) }
          : id === 'fresh'
            ? { isActive: true, lastSyncedAt: new Date() }
            : { isActive: false, lastSyncedAt: null },
      ),
    );
    const spy = jest.spyOn(service, 'syncTenant').mockResolvedValue({ success: true });
    await service.syncAllTenants(60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('due');
  });

  it('keep-alive renova token de todos e tolera falha individual', async () => {
    const { service, connection, connections } = build();
    connections.findTenantIdsWithV3Tokens.mockResolvedValue(['a', 'b']);
    connection.getValidAccessToken.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('tok');
    await expect(service.keepAliveAll()).resolves.toBeUndefined();
    expect(connection.getValidAccessToken).toHaveBeenCalledTimes(2);
  });

  it('keep-alive não faz nada com a flag v3 desligada', async () => {
    const { service, client, connections } = build();
    client.isEnabled.mockReturnValue(false);
    await service.keepAliveAll();
    expect(connections.findTenantIdsWithV3Tokens).not.toHaveBeenCalled();
  });
});
