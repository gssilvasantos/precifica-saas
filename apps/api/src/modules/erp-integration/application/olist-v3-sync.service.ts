import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OlistV3ConnectionService } from './olist-v3-connection.service';
import { ErpSyncOrchestrator, motivoVisivelDeRejeicao, buildPartialSyncWarning } from './erp-sync-orchestrator.service';
import { OLIST_CONNECTION_REPOSITORY, OlistConnectionRepository } from './ports/olist-connection-repository.port';
import {
  ERP_SYNC_CHANGE_EVENT_REPOSITORY,
  ErpSyncChangeEventRepository,
} from './ports/erp-sync-change-event-repository.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { OlistV3ApiClient } from '../infrastructure/olist/olist-v3-api.client';
import { extractListItems, extractListTotal, formatOlistV3Date } from '../domain/olist-v3-product-summary';
import {
  extractV3ParentId,
  extractV3StockItems,
  extractV3VariationRefs,
  normalizeOlistV3Product,
} from '../domain/olist-v3-product-normalizer';
import { InvalidOlistProductError } from '../domain/olist-product-normalizer';

export const OLIST_V3_PROVIDER_CODE = 'OLIST_TINY_API_V3';

const PAGE_SIZE = 100;
const MAX_PAGES = 60; // teto de segurança: 6.000 itens por listagem
// O Olist pode interpretar o filtro `dataAlteracao` em UTC ou no horário de
// Brasília (3 h de diferença) — a verificação da fatia 1 não distingue. A janela
// recua 4 h para cobrir os dois casos; reprocessar o que já estava igual é barato
// (o hash de conteúdo evita regravar).
const OVERLAP_MS = 4 * 60 * 60 * 1000;
const FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Teto por rodada: cada produto custa 1–2 chamadas a ~1,3 s e o processo no plano
// free só fica acordado enquanto há tráfego. O que não couber continua pendente
// (não grava hash nem avança o cursor) e entra na rodada seguinte.
const MAX_PRODUCTS_PER_RUN = 120;
const MAX_RUN_MS = 8 * 60 * 1000;

export interface OlistV3SyncResult {
  success: boolean;
  error?: string;
}

interface Candidate {
  id: string;
  sku: string | null;
  tipoVariacao: string | null;
}

// Sync do catálogo pela API v3 do Olist, incremental (ADR 0003, fatia 2). A cada
// rodada:
//   1. lista TODOS os produtos ativos (id, sku, tipo) — ~18 chamadas;
//   2. descobre o que precisa de detalhe: (a) nunca importado, (b) alterado desde
//      o cursor, (c) com saldo de estoque alterado desde o cursor;
//   3. busca o detalhe só desses e grava pelo MESMO caminho do sync v2
//      (ErpSyncOrchestrator.importNormalized), pais antes das variações.
// O cursor só avança em rodada sem falha nem pendência: nada alterado se perde, e
// o que falhou é retentado sozinho na rodada seguinte.
@Injectable()
export class OlistV3SyncService {
  private readonly logger = new Logger(OlistV3SyncService.name);
  // Mesma limitação do v2 (trava por processo): instância única no Render.
  private readonly running = new Set<string>();

  constructor(
    private readonly connection: OlistV3ConnectionService,
    private readonly client: OlistV3ApiClient,
    private readonly importer: ErpSyncOrchestrator,
    @Inject(OLIST_CONNECTION_REPOSITORY) private readonly connections: OlistConnectionRepository,
    @Inject(ERP_SYNC_CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ErpSyncChangeEventRepository,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
  ) {}

  // Keep-alive do token (fatia 2): renova quando está perto de vencer. Chamado a
  // cada tick do agendador para todas as contas conectadas — sem isso, 24 h sem
  // renovar derrubam a conexão e exigem reconectar.
  async keepAliveAll(): Promise<void> {
    if (!this.client.isEnabled()) return;
    const tenantIds = await this.connections.findTenantIdsWithV3Tokens();
    for (const tenantId of tenantIds) {
      try {
        await this.connection.getValidAccessToken(tenantId);
      } catch (error) {
        // getValidAccessToken já emitiu alerta quando a renovação falhou.
        this.logger.warn(`Keep-alive do token Olist v3 falhou para o tenant ${tenantId}: ${(error as Error).message}`);
      }
    }
  }

  async syncAllTenants(intervalMinutes: number): Promise<void> {
    const tenantIds = await this.connections.findTenantIdsWithV3Tokens();
    for (const tenantId of tenantIds) {
      const record = await this.connections.findByTenant(tenantId);
      if (!record || !record.isActive) continue;
      const due = !record.lastSyncedAt || Date.now() - record.lastSyncedAt.getTime() >= intervalMinutes * 60_000;
      if (due) await this.syncTenant(tenantId);
    }
  }

  async syncTenant(tenantId: string): Promise<OlistV3SyncResult> {
    if (this.running.has(tenantId)) {
      return { success: false, error: 'Já existe uma sincronização do Olist em andamento para esta conta.' };
    }
    this.running.add(tenantId);

    const startedAt = new Date();
    const logId = await this.syncLogs.start(OLIST_V3_PROVIDER_CODE, randomUUID());
    let found = 0;
    let applied = 0;

    try {
      const token = await this.connection.getValidAccessToken(tenantId);
      const record = await this.connections.findByTenant(tenantId);
      const stored = await this.connections.getV3SyncCursor(tenantId);
      const baseline = stored ?? record?.lastSyncedAt ?? new Date(startedAt.getTime() - FALLBACK_WINDOW_MS);
      const sinceStr = formatOlistV3Date(new Date(baseline.getTime() - OVERLAP_MS));

      // 1. universo ativo
      const active = await this.listAll((offset) => this.client.listarProdutos(token, { situacao: 'A', limit: PAGE_SIZE, offset }));
      const activeById = new Map<string, Candidate>();
      for (const item of active.flatMap((r) => extractListItems(r))) {
        activeById.set(item.id, { id: item.id, sku: item.sku, tipoVariacao: item.tipoVariacao });
      }

      // 2. o que precisa de detalhe
      const imported = await this.changeEvents.findAllExternalIds(tenantId);
      const changedPages = await this.listAll((offset) =>
        this.client.listarProdutos(token, { situacao: 'A', dataAlteracao: sinceStr, limit: PAGE_SIZE, offset }),
      );
      const stockPages = await this.listAll((offset) =>
        this.client.listarEstoque(token, { dataAlteracao: sinceStr, limit: PAGE_SIZE, offset }),
      );

      const work = new Map<string, Candidate>();
      for (const [id, c] of activeById) if (!imported.has(id)) work.set(id, c); // nunca importado
      for (const item of changedPages.flatMap((r) => extractListItems(r))) {
        const c = activeById.get(item.id);
        if (c) work.set(item.id, c);
      }
      for (const item of stockPages.flatMap((r) => extractV3StockItems(r))) {
        const c = activeById.get(item.externalId);
        if (c) work.set(item.externalId, c);
      }
      found = work.size;

      // 3. pais antes das variações
      const ordered = [...work.values()].sort((a, b) => Number(a.tipoVariacao === 'V') - Number(b.tipoVariacao === 'V'));
      const parentDetails = new Map<string, unknown>();
      const importedNow = new Set<string>();
      const rejected: string[] = [];
      let semDimensoes = 0;
      let deferred = 0;
      // Falha transitória (rede, cota, banco) vs cadastro inválido no Olist (sem sku/nome):
      // só a primeira segura o cursor — a segunda se repetiria para sempre e travaria o
      // avanço; ela aparece no aviso do card até alguém corrigir o cadastro.
      let transientFailures = 0;
      let abortedByQuota = false;

      for (let i = 0; i < ordered.length; i++) {
        const candidate = ordered[i];
        if (abortedByQuota || i >= MAX_PRODUCTS_PER_RUN || Date.now() - startedAt.getTime() > MAX_RUN_MS) {
          deferred++;
          continue;
        }
        const label = `${candidate.tipoVariacao === 'V' ? 'Variação' : 'Produto'} ${candidate.sku ?? candidate.id} (id ${candidate.id})`;
        try {
          const detail = (await this.client.obterProduto(token, candidate.id)).data;
          const normalized = normalizeOlistV3Product(detail);

          let variacao: { parentExternalId: string; variantAttributes: Record<string, string>; paiImportado: boolean } | undefined;
          if (candidate.tipoVariacao === 'V') {
            const parentId = extractV3ParentId(detail);
            if (parentId) {
              let parent = parentDetails.get(parentId);
              if (parent === undefined) {
                parent = (await this.client.obterProduto(token, parentId)).data;
                parentDetails.set(parentId, parent);
              }
              const ref = extractV3VariationRefs(parent).find((v) => v.externalId === candidate.id);
              variacao = {
                parentExternalId: parentId,
                variantAttributes: ref?.variantAttributes ?? {},
                paiImportado: imported.has(parentId) || importedNow.has(parentId),
              };
            } else {
              this.logger.warn(`Variação ${candidate.id} sem produtoPai no detalhe da v3 — importada como produto avulso.`);
            }
          }

          const result = await this.importer.importNormalized(tenantId, normalized, variacao);
          importedNow.add(candidate.id);
          if (result.changed) applied++;
          if (result.semDimensoes) semDimensoes++;
        } catch (error) {
          this.logger.warn(`Falha ao importar ${label} pela v3 (tenant ${tenantId}): ${(error as Error).message}`);
          if (isV3QuotaError(error)) {
            abortedByQuota = true;
            deferred++;
            transientFailures++;
            rejected.push(`${label}: o Olist limitou as consultas — será retomado na próxima rodada.`);
          } else if (error instanceof InvalidOlistProductError) {
            rejected.push(error.message);
          } else {
            transientFailures++;
            rejected.push(motivoVisivelDeRejeicao(label, error));
          }
        }
      }

      await this.health.recordSuccess(OLIST_V3_PROVIDER_CODE);
      const syncedAt = new Date();
      const clean = rejected.length === 0 && deferred === 0;
      if (clean && semDimensoes === 0) {
        await this.connections.markSynced(tenantId, syncedAt);
      } else {
        let warning = buildPartialSyncWarning(rejected, 0, applied, found, semDimensoes);
        if (deferred > 0 && rejected.length === 0) {
          warning += `\n• ${deferred} produto(s) ficaram para a próxima rodada (limite por execução).`;
        }
        await this.connections.markSyncedWithWarning(tenantId, syncedAt, warning);
      }
      // Cursor só avança sem falha transitória nem pendência. Sem dimensão no cadastro
      // não conta como falha: o produto entrou, e reprocessá-lo não corrigiria o cadastro.
      if (transientFailures === 0 && deferred === 0) await this.connections.setV3SyncCursor(tenantId, startedAt);

      await this.syncLogs.finish(logId, {
        status: clean ? 'SUCCESS' : 'PARTIAL',
        candidatesFound: found,
        candidatesApplied: applied,
        errorDetails: clean ? undefined : rejected.join('\n') || `${deferred} pendente(s)`,
      });
      this.logger.log(
        `Sync Olist v3 do tenant ${tenantId}: ${found} candidato(s), ${applied} gravado(s), ${rejected.length} falha(s), ${deferred} adiado(s).`,
      );
      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      const failures = await this.health.recordFailure(OLIST_V3_PROVIDER_CODE, message);
      await this.connections.markSyncFailed(tenantId, message);
      await this.syncLogs.finish(logId, { status: 'FAILED', candidatesFound: found, candidatesApplied: applied, errorDetails: message });
      this.logger.error(`Sync Olist v3 falhou para o tenant ${tenantId} (${failures} falhas consecutivas): ${message}`);
      return { success: false, error: message };
    } finally {
      this.running.delete(tenantId);
    }
  }

  private async listAll(fetchPage: (offset: number) => Promise<{ data: unknown }>): Promise<unknown[]> {
    const pages: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data } = await fetchPage(page * PAGE_SIZE);
      pages.push(data);
      const returned = extractAnyItems(data);
      const total = extractListTotal(data);
      if (returned < PAGE_SIZE) break;
      if (total !== null && (page + 1) * PAGE_SIZE >= total) break;
    }
    return pages;
  }
}

function extractAnyItems(data: unknown): number {
  const itens = (data as { itens?: unknown })?.itens;
  return Array.isArray(itens) ? itens.length : 0;
}

function isV3QuotaError(error: unknown): boolean {
  return error instanceof Error && /HTTP 429/.test(error.message);
}
