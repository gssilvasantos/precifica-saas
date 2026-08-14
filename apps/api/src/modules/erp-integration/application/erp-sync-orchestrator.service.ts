import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OLIST_CONNECTION_REPOSITORY,
  OlistConnectionRepository,
} from './ports/olist-connection-repository.port';
import {
  ERP_SYNC_CHANGE_EVENT_REPOSITORY,
  ErpSyncChangeEventRepository,
} from './ports/erp-sync-change-event-repository.port';
import { PRODUCT_CATALOG_WRITER } from '../../../shared/contracts/tokens';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ERP_PRODUCT_EVENTS, ErpProductImportedEvent } from '../domain/erp-product-events';
import { ProductCatalogWriter } from '../../../shared/contracts/product-catalog-writer.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { computeContentHash } from '../../../shared/domain/content-hash';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { OlistApiClient, isRateLimitError } from '../infrastructure/olist/olist-api.client';
import { ProductPhotoMirrorService } from './product-photo-mirror.service';
import {
  InvalidOlistProductError,
  OlistVariationRef,
  extractVariationRefs,
  normalizeOlistProduct,
} from '../domain/olist-product-normalizer';

export const PROVIDER_CODE = 'OLIST_TINY_API_V2';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 8000, 32000];

// Pipeline (docs/erp-integration-architecture.md, seção 6): Fetch -> Normalize
// -> Hash & Diff -> Upsert via porta do Catalog -> Log -> (fotos espelhadas
// à parte, só quando o hash mudou, para não rebaixar toda foto a cada sync).
//
// Diferença estrutural em relação ao RuleSyncOrchestrator (Marketplace
// Intelligence): lá existe UM provider compartilhado por todos os tenants
// (dados públicos de mercado). Aqui cada tenant tem sua própria credencial
// e seu próprio catálogo — o orquestrador itera sobre todas as
// OlistConnection ativas, uma sincronização por tenant, isoladas entre si
// (uma conta com token inválido não impede as demais).
@Injectable()
export class ErpSyncOrchestrator {
  private readonly logger = new Logger(ErpSyncOrchestrator.name);

  // Tenants com sync em andamento AGORA, neste processo (09/08/2026).
  //
  // Um sync completo do catálogo real levou 54 minutos (1.804 SKUs a 1 req/s);
  // o scheduler acorda a cada 30. Sem trava, a segunda rodada começava com a
  // primeira ainda correndo e as duas dividiam a mesma cota de 60 req/min da
  // conta — dobrando a taxa efetiva e garantindo "API Bloqueada". O botão
  // "Sincronizar agora" some no mesmo caldo: nada impedia N cliques, N syncs.
  //
  // LIMITAÇÃO CONHECIDA E DELIBERADA: a trava é por PROCESSO. Com mais de uma
  // instância da API no Render, duas instâncias ainda podem sincronizar o
  // mesmo tenant em paralelo. A trava correta seria um lock no Postgres
  // (advisory lock ou linha com owner+expiração), e isso exige tabela nova com
  // RLS + grants — fatia própria, não escondida dentro de uma correção de
  // rate limit. Hoje a API roda em instância única, então isto resolve o caso
  // real; se o serviço escalar horizontalmente, esta trava vira insuficiente.
  private readonly syncsEmAndamento = new Set<string>();

  constructor(
    @Inject(OLIST_CONNECTION_REPOSITORY) private readonly connections: OlistConnectionRepository,
    @Inject(ERP_SYNC_CHANGE_EVENT_REPOSITORY) private readonly changeEvents: ErpSyncChangeEventRepository,
    @Inject(PRODUCT_CATALOG_WRITER) private readonly catalogWriter: ProductCatalogWriter,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: OlistApiClient,
    private readonly photoMirror: ProductPhotoMirrorService,
    // Classificação fiscal derivada do NCM (13/08/2026). O importador não
    // conhece norma nenhuma — passa NCM e UF, o Tax Intelligence aplica.
    private readonly events: EventEmitter2,
  ) {}

  // Simplificação consciente: o intervalo é o mesmo para todos os tenants
  // (governado por um único ProviderSyncSchedule global, providerCode
  // OLIST_TINY_API_V2) — due-check por tenant usa OlistConnection.lastSyncedAt,
  // não um agendamento individual. Suficiente para o volume atual; virar
  // intervalo por tenant é uma evolução de configuração, não de arquitetura,
  // quando/se algum tenant precisar de uma cadência diferente.
  async syncAllTenants(intervalMinutes: number): Promise<void> {
    const activeConnections = await this.connections.findAllActive();
    const now = Date.now();
    const due = activeConnections.filter(
      (c) => !c.lastSyncedAt || now - c.lastSyncedAt.getTime() >= intervalMinutes * 60_000,
    );
    if (due.length === 0) return;
    this.logger.log(`${due.length} conta(s) com Olist conectado vencida(s) — iniciando sync.`);
    for (const connection of due) {
      await this.syncTenant(connection.tenantId);
    }
  }

  // 31/07/2026 — bug relatado ("Olist não está importando os anúncios"):
  // este método engolia TODO erro internamente (log + ProviderHealth +
  // ProviderSyncLog) e retornava void mesmo em falha — nem o scheduler nem o
  // clique manual em "Sincronizar agora" (OlistConnectionController.syncNow)
  // tinham como saber que algo deu errado. Agora retorna um resultado
  // explícito E grava lastSyncStatus/lastSyncError em OlistConnection (visível
  // em getStatus, mesmo para falhas do scheduler que ninguém clicou para
  // disparar). syncAllTenants continua isolando falha de um tenant das
  // demais (não rethrow aqui) — só syncNow (chamada manual) precisa saber na
  // hora, e faz isso lendo o retorno.
  async syncTenant(tenantId: string): Promise<{ success: boolean; error?: string }> {
    // Trava ANTES de abrir ProviderSyncLog: uma tentativa recusada por já
    // haver sync rodando não é uma execução, e registrá-la só encheria o
    // histórico de ruído (foi o que aconteceu com as 135 linhas de falha).
    if (this.syncsEmAndamento.has(tenantId)) {
      const message = 'Já existe uma sincronização do Olist em andamento para esta conta.';
      this.logger.warn(`${message} (tenant ${tenantId}) — nova execução ignorada.`);
      return { success: false, error: message };
    }
    this.syncsEmAndamento.add(tenantId);

    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(PROVIDER_CODE, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      const record = await this.connections.findByTenant(tenantId);
      if (!record || !record.isActive) throw new Error('Conexão com o Olist inativa ou não encontrada.');
      const apiToken = this.credentials.decrypt(record.apiTokenEnc);

      const { details: rawProducts, failedCount } = await this.withRetry(() =>
        this.client.fetchAllActiveProductDetails(apiToken),
      );
      candidatesFound = rawProducts.length + failedCount;
      await this.health.recordSuccess(PROVIDER_CODE);

      // Produto REJEITADO pelo normalizador (cadastro incompleto no Olist)
      // é coletado, não só logado — antes disso o usuário via "sincronizou"
      // sem nenhuma pista de que N SKUs ficaram de fora nem quais. Ver
      // docs/olist-import-design.md.
      const rejected: string[] = [];
      // Produto importado, mas sem peso/dimensão no cadastro do Olist — entra
      // no catálogo e é contado para o aviso. Ver buildPartialSyncWarning.
      let semDimensoes = 0;

      // Variações (02/08/2026): o Olist só devolve os PAIS em
      // produtos.pesquisa.php — as variações vêm dentro do detalhe de cada
      // pai, e precisam de uma chamada própria para trazer custo, estoque,
      // peso e dimensões. Era por isso que o catálogo importado ficava em
      // ~340 itens contra as ~937 SKUs reais da conta.
      //
      // A ordem importa: o PAI é processado primeiro, para que a variação
      // encontre o parentProductId já criado. Fora isso, uma variação que
      // falhe não derruba nem o pai nem as irmãs.
      for (const raw of rawProducts) {
        // O pai é processado à parte das variações de propósito. Cadastro
        // incompleto do PAI no Olist (peso/dimensão faltando) é comum, já que
        // ele costuma ser só uma casca — e não pode levar junto 20 variações
        // que estão perfeitamente cadastradas. Antes, com tudo num try só,
        // uma casca mal preenchida apagava toda a linha do catálogo.
        let paiImportado = false;
        try {
          const resultado = await this.processProduct(tenantId, raw);
          if (resultado.changed) candidatesApplied++;
          if (resultado.semDimensoes) semDimensoes++;
          paiImportado = true;
        } catch (error) {
          // Log completo no servidor, motivo traduzido para o usuário.
          this.logger.warn(`Falha ao processar produto do tenant ${tenantId}: ${(error as Error).message}`);
          rejected.push(motivoVisivelDeRejeicao(descreverProduto(raw), error));
        }

        const variacoes = extractVariationRefs(raw);
        if (variacoes.length === 0) continue;

        try {
          const parentExternalId = String((raw as { produto?: { id?: unknown } })?.produto?.id ?? '');
          const resultado = await this.processVariations(
            tenantId,
            apiToken,
            parentExternalId,
            variacoes,
            paiImportado,
          );
          candidatesFound += variacoes.length;
          candidatesApplied += resultado.applied;
          semDimensoes += resultado.semDimensoes;
          rejected.push(...resultado.rejected);
        } catch (error) {
          this.logger.error(`Falha ao processar variações do tenant ${tenantId}: ${(error as Error).message}`);
          rejected.push((error as Error).message);
        }
      }

      // Sync com rejeição é SUCESSO PARCIAL, não falha: os produtos bons
      // foram importados e o usuário precisa saber dos dois fatos. FAILED
      // esconderia o que funcionou (e sugeriria que nada entrou); SUCCESS
      // silencioso esconderia o que não funcionou.
      const warning =
        rejected.length > 0 || failedCount > 0 || semDimensoes > 0
          ? buildPartialSyncWarning(rejected, failedCount, candidatesApplied, candidatesFound, semDimensoes)
          : null;

      const syncedAt = new Date();
      if (warning) {
        await this.connections.markSyncedWithWarning(tenantId, syncedAt, warning);
      } else {
        await this.connections.markSynced(tenantId, syncedAt);
      }

      await this.syncLogs.finish(logId, {
        status: 'SUCCESS',
        candidatesFound,
        candidatesApplied,
        errorDetails: warning ?? undefined,
      });
      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      const consecutiveFailures = await this.health.recordFailure(PROVIDER_CODE, message);
      await this.connections.markSyncFailed(tenantId, message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: message,
      });
      this.logger.error(
        `Sync do Olist falhou para o tenant ${tenantId} (${consecutiveFailures} falhas consecutivas): ${message}`,
      );
      return { success: false, error: message };
    } finally {
      // Libera SEMPRE — sucesso, falha de negócio ou exceção inesperada. Um
      // finally esquecido aqui deixaria o tenant travado até o próximo
      // restart do processo, que é uma falha pior que a corrida original.
      this.syncsEmAndamento.delete(tenantId);
    }
  }

  // Busca o detalhe de cada variação e a grava vinculada ao pai.
  //
  // Uma chamada por variação é inevitável: o bloco `variacoes` do pai traz só
  // id, código e grade — custo, estoque, peso e dimensões (tudo que o motor de
  // preço usa) só existem no detalhe individual. Com ~600 variações a 1 req/s
  // do RateLimiter, isso alonga o sync; é o preço de ter o catálogo real em vez
  // de um terço dele.
  private async processVariations(
    tenantId: string,
    apiToken: string,
    parentExternalId: string,
    variacoes: OlistVariationRef[],
    paiImportado: boolean,
  ): Promise<{ applied: number; rejected: string[]; semDimensoes: number }> {
    let applied = 0;
    let semDimensoes = 0;
    const rejected: string[] = [];

    for (const variacao of variacoes) {
      try {
        const detalhe = await this.withRetry(() => this.client.obterProduto(apiToken, variacao.externalId));
        const resultado = await this.processProduct(tenantId, detalhe, {
          parentExternalId,
          variantAttributes: variacao.variantAttributes,
          paiImportado,
        });
        if (resultado.changed) applied++;
        if (resultado.semDimensoes) semDimensoes++;
      } catch (error) {
        this.logger.warn(
          `Falha ao processar variação ${variacao.externalId} do tenant ${tenantId}: ${(error as Error).message}`,
        );
        rejected.push(motivoVisivelDeRejeicao(`Variação ${variacao.skuCode} (id ${variacao.externalId})`, error));
      }
    }

    return { applied, rejected, semDimensoes };
  }

  private async processProduct(
    tenantId: string,
    raw: unknown,
    variacao?: { parentExternalId: string; variantAttributes: Record<string, string>; paiImportado: boolean },
  ): Promise<{ changed: boolean; semDimensoes: boolean }> {
    const normalized = normalizeOlistProduct(raw);

    // Hash sobre os dados ORIGINAIS do Olist (antes de espelhar fotos) —
    // assim uma foto que só trocou de URL no Olist mas é visualmente igual
    // não dispara re-download; e mudanças reais (preço, estoque, etc.)
    // sempre disparam, mesmo que as fotos não tenham mudado.
    // `paiImportado` entra no hash, e não o `parentExternalId`.
    //
    // O externalId do pai é o mesmo esteja o pai importado ou não, então ele
    // não distinguiria nada. Já o FATO de o pai ter entrado neste sync muda:
    // uma variação gravada órfã (porque o pai falhou a normalização) tem hash
    // diferente da mesma variação com o pai já existente. Quando o cadastro do
    // pai é corrigido no Olist, o hash muda, a variação é reprocessada e o
    // writer a adota — sem isso o atalho abaixo a pularia para sempre, já que
    // os dados dela no ERP nunca mudaram.
    // `hasCompleteDimensions` fica FORA do hash (09/08/2026). Ela é derivada
    // de weightKg/lengthCm/widthCm/heightCm, que já estão aqui dentro — não
    // acrescenta um bit de informação ao hash. Incluí-la, porém, mudaria o
    // hash de TODOS os SKUs já sincronizados de uma vez, e o próximo sync
    // reprocessaria o catálogo inteiro: 1.804 upserts e o re-espelhamento de
    // toda foto, justo na volta de uma conta que acabou de sair de bloqueio
    // por cota. Excluir a flag mantém cada hash existente válido.
    const { hasCompleteDimensions: _derivadaDoResto, ...paraHash } = normalized;
    const contentHash = computeContentHash({ ...paraHash, paiImportado: variacao?.paiImportado ?? null });
    const previous = await this.changeEvents.findByExternalId(tenantId, normalized.externalId);

    const semDimensoes = !normalized.hasCompleteDimensions;

    if (previous && previous.contentHash === contentHash) {
      // Nada mudou — não baixa foto de novo, não toca no Catalog. Mas o SKU
      // continua sem dimensão, e o aviso precisa refletir o estado do
      // catálogo, não só o que foi escrito nesta passada.
      return { changed: false, semDimensoes };
    }

    const { urls: photoUrls, houveFalha: fotoFalhou } = await this.photoMirror.mirrorAll(
      tenantId,
      normalized.skuCode,
      normalized.photoUrls,
    );

    const { changed, productId } = await this.catalogWriter.upsertFromExternalSource({
      tenantId,
      skuCode: normalized.skuCode,
      name: normalized.name,
      costPrice: normalized.costPrice,
      stockQuantity: normalized.stockQuantity,
      weightKg: normalized.weightKg,
      packagingWeightKg: normalized.packagingWeightKg,
      lengthCm: normalized.lengthCm,
      widthCm: normalized.widthCm,
      heightCm: normalized.heightCm,
      photoUrls,
      erpSalePrice: normalized.erpSalePrice,
      sourceSystem: 'ERP_OLIST',
      externalId: normalized.externalId,
      ncm: normalized.ncm,
      cest: normalized.cest,
      gtin: normalized.gtin,
      fiscalOriginCode: normalized.fiscalOriginCode,
      parentExternalId: variacao?.parentExternalId ?? null,
      variantAttributes: variacao?.variantAttributes ?? null,
      erpCategoryPath: normalized.categoryPath.length > 0 ? normalized.categoryPath.join(' > ') : null,
    });

    await this.changeEvents.upsert({
      tenantId,
      externalId: normalized.externalId,
      skuCode: normalized.skuCode,
      changeSummary: previous ? 'Produto atualizado a partir do Olist.' : 'Produto importado do Olist pela primeira vez.',
      action: previous ? 'UPDATED' : 'CREATED',
      // FOTO PENDENTE (09/08/2026): quando alguma foto falhou, grava um hash
      // que nunca vai bater com o hash limpo calculado no próximo sync. O
      // produto é reprocessado e a foto retentada, em vez de ficar perdida
      // para sempre atrás do atalho de "hash igual, pula". O sufixo é estável,
      // então uma falha que se repete continua forçando nova tentativa — não
      // vira um hash novo a cada passada.
      contentHash: fotoFalhou ? `${contentHash}:fotos-pendentes` : contentHash,
    });

    // Anuncia o produto importado (13/08/2026). O Tax Intelligence escuta e
    // classifica a partir do NCM — o Olist traz NCM em 100% dos produtos, e
    // sem isso o lojista teria que reclassificar centenas de SKUs à mão.
    //
    // Evento e não chamada direta: ver o comentário em erp-product-events.ts.
    // `productId` é o do CATÁLOGO, devolvido pelo writer — não o externalId do
    // Olist.
    this.events.emit(ERP_PRODUCT_EVENTS.IMPORTED, {
      tenantId,
      productId,
      skuCode: normalized.skuCode,
      ncm: normalized.ncm,
    } satisfies ErpProductImportedEvent);

    return { changed, semDimensoes };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // AMPLIFICAÇÃO DE BLOQUEIO (corrigido em 09/08/2026). O OlistApiClient
        // já re-tenta bloqueio de cota por conta própria, 4 vezes, com
        // 10s→30s→60s. Quando o erro chega aqui, a conta continuou bloqueada
        // depois de ~100s de espera. Re-tentar a busca INTEIRA neste ponto
        // fazia até 12 varreduras completas do catálogo contra uma conta já
        // suspensa — cada uma gastando mais cota e renovando o bloqueio.
        //
        // Foi assim que a integração ficou fora do ar: 135 syncs entre 31/07 e
        // 09/08, os recentes todos em "API Bloqueada", zero produto importado.
        // Cota é o único erro em que insistir PIORA o problema; desiste rápido
        // e deixa a próxima janela do scheduler tentar com a conta liberada.
        if (isRateLimitError(error)) throw error;

        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        }
      }
    }
    throw lastError;
  }
}

// Mensagem que o usuário lê no card de Integrações quando parte do catálogo
// não entrou. Precisa responder três coisas de uma vez: quantos entraram,
// quantos ficaram de fora e POR QUE — sem isso o lojista vê "340 produtos no
// Olist, 205 no Kyneti" e não tem como agir.
//
// Mostra só os primeiros motivos para caber na tela; o log completo do
// servidor continua tendo todos.
const MAX_REASONS_SHOWN = 3;

// Motivo que o USUÁRIO vê no card de Integrações (09/08/2026).
//
// InvalidOlistProductError é nossa, foi escrita para o lojista e diz o que
// fazer — passa inteira. Qualquer outro erro é de infraestrutura, e a
// mensagem crua não serve para ele nem deveria sair do servidor: a de
// violação de unicidade do Prisma, por exemplo, carrega o CAMINHO ABSOLUTO
// do arquivo, o nome do model e o da constraint, e isso ia direto para
// OlistConnection.lastSyncError, devolvido pela API e renderizado na tela.
// O texto completo continua no log do servidor, que é onde se investiga.
export function motivoVisivelDeRejeicao(identificacao: string, error: unknown): string {
  if (error instanceof InvalidOlistProductError) return error.message;
  return `${identificacao}: falha interna ao gravar — registrada no log do servidor.`;
}

// Identifica o produto na mensagem sem confiar no formato da resposta: aqui o
// payload já falhou de alguma forma, então qualquer campo pode faltar.
function descreverProduto(raw: unknown): string {
  const envelope = (raw ?? {}) as Record<string, unknown>;
  const produto = (envelope.produto ?? envelope) as Record<string, unknown>;
  const id = produto.id ?? produto.codigo;
  return id ? `Produto Olist ${String(id)}` : 'Produto Olist sem identificador na resposta';
}

export function buildPartialSyncWarning(
  rejected: string[],
  failedCount: number,
  applied: number,
  found: number,
  semDimensoes = 0,
): string {
  const parts = [`Importados ${applied} de ${found} produtos do Olist.`];

  // Produto SEM DIMENSÃO é importado, não rejeitado (03/08/2026) — mas o
  // usuário precisa saber, porque sem dimensão não há peso cubado e o frete
  // deixa de ser estimável para esses SKUs. Antes desta mudança eles eram
  // descartados: no primeiro sync real, 1.803 de 1.804.
  if (semDimensoes > 0) {
    parts.push(
      `${semDimensoes} produto(s) importado(s) SEM peso ou dimensões no cadastro do Olist. ` +
        'Eles entraram no catálogo com os demais dados, mas o frete não pode ser estimado ' +
        'enquanto as medidas não forem preenchidas — preencha no Olist e sincronize de novo, ' +
        'ou edite direto no cadastro do produto.',
    );
  }

  if (rejected.length > 0) {
    parts.push(`${rejected.length} não pôde(puderam) ser processado(s):`);
    parts.push(...rejected.slice(0, MAX_REASONS_SHOWN).map((r) => `• ${r}`));
    if (rejected.length > MAX_REASONS_SHOWN) {
      parts.push(`• ...e mais ${rejected.length - MAX_REASONS_SHOWN}. Ver log completo do servidor.`);
    }
  }

  if (failedCount > 0) {
    parts.push(`${failedCount} produto(s) não puderam ser lidos da API do Olist nesta tentativa.`);
  }

  return parts.join(' ');
}
