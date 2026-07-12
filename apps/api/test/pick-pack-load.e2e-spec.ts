// Sprint 27 — Validação em Produção, Item 3 da fila: "simule uma carga de
// 20 pedidos sendo processados simultaneamente na expedição" + "analise se
// há algum gargalo oculto... no VideoCaptureSession ou na fila de uploads".
//
// AVISO DE HONESTIDADE (igual ao de pick-pack.e2e-spec.ts): este arquivo
// roda contra os MESMOS fakes em memória do item 1 (Postgres real segue
// bloqueado neste sandbox). Isso significa que o teste abaixo prova
// CORRETUDE de orquestração sob concorrência (nenhum dado vaza entre os 20
// pedidos, todo incremento aritmético fecha certo, nenhuma exceção
// não-tratada) — mas os tempos medidos aqui são os do Map em memória, não
// os de Postgres/disco reais, e por isso NÃO são usados como "prova de
// performance". A análise de gargalo real (pool do Prisma, threadpool do
// libuv por trás de fs.appendFile, payload base64 em JSON) está em
// docs/pick-pack-architecture.md, seção 10, fundamentada na leitura direta
// do código de infraestrutura (Prisma repos + LocalVideoChunkStorageService),
// não neste teste. O que ESTE arquivo prova empiricamente é o achado mais
// sério do item 3: uma falha definitiva de upload de chunk deixa uma
// lacuna de sequência que o servidor nunca fecha sozinho — ver o segundo
// `describe` abaixo.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import request from 'supertest';

import { StockMovementAuditEventController } from '../src/modules/logistics-fulfillment/interface/controllers/stock-movement-audit-event.controller';
import { StockMovementAuditEventService } from '../src/modules/logistics-fulfillment/application/stock-movement-audit-event.service';
import { VideoCaptureService } from '../src/modules/logistics-fulfillment/application/video-capture.service';
import { WarehouseService } from '../src/modules/logistics-fulfillment/application/warehouse.service';

import { STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY } from '../src/modules/logistics-fulfillment/application/ports/stock-movement-audit-event-repository.port';
import { STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY } from '../src/modules/logistics-fulfillment/application/ports/stock-movement-audit-event-item-repository.port';
import { VIDEO_CAPTURE_SESSION_REPOSITORY } from '../src/modules/logistics-fulfillment/application/ports/video-capture-session-repository.port';
import { VIDEO_CHUNK_STORAGE } from '../src/modules/logistics-fulfillment/application/ports/video-chunk-storage.port';
import { WAREHOUSE_REPOSITORY } from '../src/modules/logistics-fulfillment/application/ports/warehouse-repository.port';
import { ORDER_FINANCIALS_READER, FILE_STORAGE } from '../src/shared/contracts/tokens';
import { ALERT_SERVICE } from '../src/shared/observability/ports/alert-service.port';
import { FileStorage, StoredFile } from '../src/shared/contracts/file-storage.port';

import { JwtAuthGuard, RolesGuard, UserRole, AuthenticatedUser } from '../src/modules/identity-access/public-api';

import {
  FakeStockMovementAuditEventRepository,
  FakeStockMovementAuditEventItemRepository,
  FakeVideoCaptureSessionRepository,
  FakeVideoChunkStorage,
  FakeWarehouseRepository,
  FakeOrderFinancialsReader,
  FakeAlertService,
} from './fakes/pick-pack-fakes';

class FakeFileStorage implements FileStorage {
  async upload(key: string, _content: Buffer, _contentType: string): Promise<StoredFile> {
    return { url: `https://fake-storage.local/${key}`, key };
  }
}

const CURRENT_USER: AuthenticatedUser = { userId: 'op-load-test', tenantId: 'tenant-1', role: UserRole.ADMIN };

async function buildApp(): Promise<{
  app: INestApplication;
  fakeEvents: FakeStockMovementAuditEventRepository;
  fakeVideoStorage: FakeVideoChunkStorage;
  fakeOrderReader: FakeOrderFinancialsReader;
}> {
  const CHECKLIST_SEED = new Map<string, { orderId: string; skuCode: string; quantity: number }[]>();
  // 20 "pedidos" (PEDIDO-1..PEDIDO-20), cada um com 2 SKUs PRÓPRIOS
  // (SKU-<n>-A / SKU-<n>-B) — nomes exclusivos de propósito, para que
  // qualquer vazamento de dado entre pedidos concorrentes (ex.: um scan
  // incrementando o checklist do pedido errado) apareça imediatamente como
  // uma contagem errada, em vez de se disfarçar atrás de um SKU compartilhado.
  for (let i = 1; i <= 20; i += 1) {
    CHECKLIST_SEED.set(`PEDIDO-${i}`, [
      { orderId: `PEDIDO-${i}`, skuCode: `SKU-${i}-A`, quantity: 2 },
      { orderId: `PEDIDO-${i}`, skuCode: `SKU-${i}-B`, quantity: 1 },
    ]);
  }

  const fakeEvents = new FakeStockMovementAuditEventRepository();
  const fakeItems = new FakeStockMovementAuditEventItemRepository();
  const fakeVideoSessions = new FakeVideoCaptureSessionRepository();
  const fakeVideoStorage = new FakeVideoChunkStorage();
  const fakeWarehouses = new FakeWarehouseRepository();
  const fakeOrderReader = new FakeOrderFinancialsReader(CHECKLIST_SEED);
  const fakeAlerts = new FakeAlertService();

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [StockMovementAuditEventController],
    providers: [
      StockMovementAuditEventService,
      VideoCaptureService,
      WarehouseService,
      RolesGuard,
      { provide: STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY, useValue: fakeEvents },
      { provide: STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY, useValue: fakeItems },
      { provide: VIDEO_CAPTURE_SESSION_REPOSITORY, useValue: fakeVideoSessions },
      { provide: VIDEO_CHUNK_STORAGE, useValue: fakeVideoStorage },
      { provide: WAREHOUSE_REPOSITORY, useValue: fakeWarehouses },
      { provide: ORDER_FINANCIALS_READER, useValue: fakeOrderReader },
      { provide: ALERT_SERVICE, useValue: fakeAlerts },
      { provide: FILE_STORAGE, useValue: new FakeFileStorage() },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        req.user = CURRENT_USER;
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.init();
  // Escuta explicitamente ANTES de qualquer teste rodar — sem isso, o
  // supertest só chama .listen(0) sob demanda na PRIMEIRA requisição, e as
  // 20 requisições iniciais deste arquivo disparam praticamente juntas
  // (Promise.all), o que corre risco de competir com esse listen()
  // sob-demanda (observado neste sandbox como ECONNRESET intermitente).
  // Isso é uma particularidade do harness de teste, não do servidor de
  // produção (que já escuta antes de aceitar qualquer tráfego).
  await app.listen(0);

  return { app, fakeEvents, fakeVideoStorage, fakeOrderReader };
}

// Roda o fluxo completo de UM pedido (criação -> checklist -> bipagem 100%
// -> vídeo em N chunks -> finalize -> approve) contra o app compartilhado —
// simula um operador de bancada entre os 20 rodando ao mesmo tempo.
async function runFullDispatchFlow(
  server: import('http').Server,
  pedidoId: string,
  chunkCount: number,
): Promise<{ auditEventId: string; totalBytesSent: number; elapsedMs: number }> {
  const start = Date.now();

  const createRes = await request(server)
    .post('/api/logistics-fulfillment/audit-events')
    .send({ channelCode: 'MERCADO_LIVRE', orderIds: [pedidoId] })
    .expect(201);
  const auditEventId: string = createRes.body.id;

  const checklistRes = await request(server)
    .get(`/api/logistics-fulfillment/audit-events/${auditEventId}/checklist`)
    .expect(200);

  for (const item of checklistRes.body) {
    for (let i = 0; i < item.expectedQuantity; i += 1) {
      await request(server)
        .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/scan`)
        .send({ skuCode: item.skuCode })
        .expect(201);
    }
  }

  const videoSessionRes = await request(server)
    .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions`)
    .expect(201);
  const sessionId: string = videoSessionRes.body.id;

  let totalBytesSent = 0;
  for (let sequence = 0; sequence < chunkCount; sequence += 1) {
    const chunk = Buffer.from(`${pedidoId}-chunk-${sequence}-${'x'.repeat(300)}`);
    totalBytesSent += chunk.length;
    await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/chunks`)
      .send({ sequence, contentBase64: chunk.toString('base64') })
      .expect(201);
  }

  await request(server)
    .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/finalize`)
    .expect(201);

  const lines = checklistRes.body.map((item: { skuCode: string; expectedQuantity: number }) => ({
    skuCode: item.skuCode,
    quantity: item.expectedQuantity,
  }));
  await request(server)
    .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/approve`)
    .send({ lines })
    .expect(201);

  return { auditEventId, totalBytesSent, elapsedMs: Date.now() - start };
}

describe('Pick & Pack — carga de 20 pedidos simultâneos (Sprint 27, Item 3)', () => {
  let app: INestApplication;
  let fakeEvents: FakeStockMovementAuditEventRepository;
  let fakeVideoStorage: FakeVideoChunkStorage;

  beforeAll(async () => {
    const built = await buildApp();
    app = built.app;
    fakeEvents = built.fakeEvents;
    fakeVideoStorage = built.fakeVideoStorage;
  });

  afterAll(async () => {
    await app.close();
  });

  it('processa 20 pedidos em paralelo sem corrupção cross-evento (checklist, vídeo, ledger)', async () => {
    const server = app.getHttpServer();
    const PEDIDO_COUNT = 20;
    const CHUNKS_PER_PEDIDO = 5;

    console.log(`[LOAD] Disparando ${PEDIDO_COUNT} fluxos completos de expedição em paralelo...`);
    const wallClockStart = Date.now();

    const results = await Promise.all(
      Array.from({ length: PEDIDO_COUNT }, (_, i) => runFullDispatchFlow(server, `PEDIDO-${i + 1}`, CHUNKS_PER_PEDIDO)),
    );

    const totalWallClockMs = Date.now() - wallClockStart;
    const avgFlowMs = results.reduce((sum, r) => sum + r.elapsedMs, 0) / results.length;
    const slowestFlowMs = Math.max(...results.map((r) => r.elapsedMs));
    console.log(
      `[LOAD] 20 pedidos concluídos em ${totalWallClockMs}ms de parede (fake em memória) — ` +
        `média por fluxo ${avgFlowMs.toFixed(1)}ms, mais lento ${slowestFlowMs}ms.`,
    );

    // --- Isolamento entre pedidos concorrentes ---------------------------
    const uniqueEventIds = new Set(results.map((r) => r.auditEventId));
    expect(uniqueEventIds.size).toBe(PEDIDO_COUNT); // nenhum ID de evento colidiu/foi reaproveitado

    for (const result of results) {
      const event = fakeEvents.events.get(result.auditEventId)!;
      expect(event.conferenceStatus).toBe('APROVADO');
    }

    // --- Nenhum incremento (scan / chunk) vazou para o checklist errado ---
    // Cada pedido tem SKUs exclusivos (SKU-<n>-A/B) — se um scan concorrente
    // tivesse incrementado o item do pedido vizinho por engano, o total de
    // linhas de ledger não bateria com 20 pedidos x 2 SKUs x 2 linhas
    // (débito físico + crédito CD virtual, FULL_DISPATCH).
    expect(fakeEvents.ledgerEntries).toHaveLength(PEDIDO_COUNT * 2 * 2);

    // --- Persistência de vídeo: bytes do fake batem por sessão -----------
    let totalBytesAcrossAllSessions = 0;
    for (const [, buffer] of fakeVideoStorage.files) {
      totalBytesAcrossAllSessions += buffer.length;
    }
    const expectedTotalBytes = results.reduce((sum, r) => sum + r.totalBytesSent, 0);
    expect(totalBytesAcrossAllSessions).toBe(expectedTotalBytes);

    console.log(
      `[LOAD] Verificado: ${PEDIDO_COUNT} eventos únicos, todos APROVADO, ` +
        `${fakeEvents.ledgerEntries.length} linhas de ledger, ${totalBytesAcrossAllSessions} bytes de vídeo consolidados — ` +
        'sem nenhum vazamento de estado entre pedidos concorrentes.',
    );
  }, 30000);
});

describe('Pick & Pack — achado de risco: lacuna de sequência de chunk (Sprint 27, Item 3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const built = await buildApp();
    app = built.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('um chunk definitivamente perdido trava PERMANENTEMENTE todo chunk seguinte (nunca se autorrecupera)', async () => {
    const server = app.getHttpServer();

    // Reabastecimento preventivo (orderIds vazio) — checklist vazio, foco
    // exclusivo no protocolo de vídeo, sem ruído de bipagem.
    const createRes = await request(server)
      .post('/api/logistics-fulfillment/audit-events')
      .send({ channelCode: 'MERCADO_LIVRE', orderIds: [] })
      .expect(201);
    const auditEventId: string = createRes.body.id;

    const sessionRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions`)
      .expect(201);
    const sessionId: string = sessionRes.body.id;

    // Chunk 0 chega normalmente.
    await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/chunks`)
      .send({ sequence: 0, contentBase64: Buffer.from('chunk-0').toString('base64') })
      .expect(201);

    // Chunk 1 é o que se perde na rede (nunca chega ao servidor) — o
    // navegador, no entanto, já avançou seu contador de sequência local e
    // segue enviando o chunk 2 normalmente (é exatamente o que o código do
    // frontend fazia ANTES da correção deste item: sequenceRef.current
    // incrementa antes de saber se o upload teve sucesso).
    const rejectedRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/chunks`)
      .send({ sequence: 2, contentBase64: Buffer.from('chunk-2').toString('base64') });

    expect(rejectedRes.status).toBe(400); // canAcceptChunk rejeita: "fora de ordem"
    expect(rejectedRes.body.message).toMatch(/fora de ordem/i);

    // A lacuna NUNCA se fecha sozinha — todo chunk daqui pra frente (3, 4,
    // 5...) também seria rejeitado, porque receivedChunkCount ficou travado
    // em 1 para sempre. Confirmando com o chunk 3:
    const stillRejectedRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/chunks`)
      .send({ sequence: 3, contentBase64: Buffer.from('chunk-3').toString('base64') });
    expect(stillRejectedRes.status).toBe(400);

    const sessionAfterGap = await request(server)
      .get(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions`)
      .expect(200);
    expect(sessionAfterGap.body.receivedChunkCount).toBe(1); // só o chunk 0 — travado

    // O ACHADO CRÍTICO: canFinalize só exige receivedChunkCount >= 1, não
    // "todos os chunks esperados" (que nem existe como conceito — é um
    // stream ao vivo, sem tamanho conhecido de antemão). Isso significa que
    // finalize() SUCEDE mesmo com o vídeo truncado no primeiro chunk —
    // silenciosamente, sem qualquer sinal de erro pro backend detectar.
    const finalizeRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/finalize`)
      .expect(201);
    expect(finalizeRes.body.status).toBe('FINALIZED');
    expect(finalizeRes.body.receivedChunkCount).toBe(1);

    console.log(
      '[RISCO CONFIRMADO] Sessão finalizada com sucesso (201) tendo recebido só 1 de ~4 chunks esperados — ' +
        'o backend não tem como saber que o vídeo está truncado. A correção fica no cliente: ' +
        'retry antes de desistir de um chunk + parar a gravação e bloquear "Finalizar Embalagem" ' +
        'se o retry se esgotar (ver ConferenciaDetalhePage.tsx, startRecording/ondataavailable).',
    );
  });
});
