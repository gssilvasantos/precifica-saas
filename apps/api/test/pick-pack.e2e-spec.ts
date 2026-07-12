// Sprint 27 — Validação em Produção, item 1 da fila pedida pelo usuário:
// "Script de Teste de Integração (End-to-End) que simule o fluxo completo:
// criação de um pedido, bipagem de 100% dos itens, disparos de gravação de
// vídeo, finalização da embalagem e verificação da persistência do arquivo
// de vídeo."
//
// Estratégia (ver test/fakes/pick-pack-fakes.ts para o racional completo):
// monta um TestingModule ISOLADO contendo só o StockMovementAuditEventController
// + os três application services que ele usa, com TODO port ligado a um fake
// em memória (nunca Prisma real — bloqueado neste sandbox). Isso permite
// exercitar HTTP real (supertest) -> ValidationPipe real -> guards reais
// (RolesGuard genuíno; só o JwtAuthGuard é substituído, para injetar um
// usuário autenticado canned sem precisar de JWT/passport de verdade) ->
// application services reais -> domain (funções puras de gate) reais.
//
// Itens 2 (log dedicado) e 3 (análise de gargalo) ficam para depois —
// pedido explícito do usuário foi "vamos um por um". Os console.log abaixo
// são só a narração natural DESTE script de teste (nunca alteram logging de
// produção) e cobrem os três eventos de exemplo dados pelo usuário.
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

// Fake mínimo de FILE_STORAGE — não exercido neste fluxo (o Pick & Pack usa
// VIDEO_CHUNK_STORAGE para o vídeo, não FILE_STORAGE), mas o controller
// exige a dependência no construtor, então precisa existir no grafo de DI.
class FakeFileStorage implements FileStorage {
  async upload(key: string, _content: Buffer, _contentType: string): Promise<StoredFile> {
    return { url: `https://fake-storage.local/${key}`, key };
  }
}

// Usuário canned injetado pelo fake do JwtAuthGuard — ADMIN, então passa
// livremente pelo RolesGuard REAL (que continua no grafo, sem ser
// sobrescrito) em todos os endpoints @Roles(ADMIN, PRICING_EDITOR).
const CURRENT_USER: AuthenticatedUser = {
  userId: 'op-1',
  tenantId: 'tenant-1',
  role: UserRole.ADMIN,
};

describe('Pick & Pack — fluxo E2E completo (Sprint 27, validação em produção)', () => {
  let app: INestApplication;
  let fakeEvents: FakeStockMovementAuditEventRepository;
  let fakeItems: FakeStockMovementAuditEventItemRepository;
  let fakeVideoSessions: FakeVideoCaptureSessionRepository;
  let fakeVideoStorage: FakeVideoChunkStorage;

  const PEDIDO_X = 'pedido-x';
  const CHECKLIST_SEED = new Map([
    [
      PEDIDO_X,
      [
        { orderId: PEDIDO_X, skuCode: 'SKU-CAMISETA-M', quantity: 2 },
        { orderId: PEDIDO_X, skuCode: 'SKU-BONE-UNICO', quantity: 1 },
      ],
    ],
  ]);

  beforeAll(async () => {
    fakeEvents = new FakeStockMovementAuditEventRepository();
    fakeItems = new FakeStockMovementAuditEventItemRepository();
    fakeVideoSessions = new FakeVideoCaptureSessionRepository();
    fakeVideoStorage = new FakeVideoChunkStorage();
    const fakeWarehouses = new FakeWarehouseRepository();
    const fakeOrderReader = new FakeOrderFinancialsReader(CHECKLIST_SEED);
    const fakeAlerts = new FakeAlertService();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [StockMovementAuditEventController],
      providers: [
        StockMovementAuditEventService,
        VideoCaptureService,
        WarehouseService,
        RolesGuard, // guard REAL — exercita a checagem de role de verdade
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

    app = moduleRef.createNestApplication();
    // Mesma configuração de main.ts (ValidationPipe real) — sem isso o e2e
    // não estaria testando o mesmo comportamento de validação de produção.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('simula o fluxo completo de expedição: criação -> bipagem 100% -> vídeo em chunks -> finalize -> aprovação', async () => {
    const server = app.getHttpServer();

    // ---- 1. Criação do pedido / lote de despacho ----------------------
    console.log(`[E2E Pick&Pack] Iniciando gravação para Pedido ${PEDIDO_X}`);
    console.log(`[E2E Pick&Pack] Criando lote de despacho FULL_DISPATCH para o canal MERCADO_LIVRE (pedido ${PEDIDO_X})...`);

    const createRes = await request(server)
      .post('/api/logistics-fulfillment/audit-events')
      .send({ channelCode: 'MERCADO_LIVRE', orderIds: [PEDIDO_X] })
      .expect(201);

    const auditEventId: string = createRes.body.id;
    expect(auditEventId).toBeTruthy();
    expect(createRes.body.conferenceStatus).toBe('PENDENTE');
    console.log(`[E2E Pick&Pack] Evento de auditoria criado: ${auditEventId}`);

    // ---- 2. Checklist inicial (0% bipado) -------------------------------
    const checklistRes = await request(server)
      .get(`/api/logistics-fulfillment/audit-events/${auditEventId}/checklist`)
      .expect(200);

    expect(checklistRes.body).toHaveLength(2);
    const totalExpected = checklistRes.body.reduce((sum: number, item: any) => sum + item.expectedQuantity, 0);
    expect(totalExpected).toBe(3); // 2x SKU-CAMISETA-M + 1x SKU-BONE-UNICO

    // ---- 3. Bipagem de 100% dos itens -----------------------------------
    console.log('[E2E Pick&Pack] Iniciando bipagem do checklist...');
    for (const item of checklistRes.body) {
      for (let i = 0; i < item.expectedQuantity; i += 1) {
        await request(server)
          .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/scan`)
          .send({ skuCode: item.skuCode })
          .expect(201);
      }
    }

    const checklistAfterScan = await request(server)
      .get(`/api/logistics-fulfillment/audit-events/${auditEventId}/checklist`)
      .expect(200);
    const fullyScanned = checklistAfterScan.body.every((item: any) => item.scannedQuantity === item.expectedQuantity);
    expect(fullyScanned).toBe(true);
    console.log('[E2E Pick&Pack] Bipagem atingiu 100%');

    // ---- 4. Sessão de gravação de vídeo ----------------------------------
    const videoSessionRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions`)
      .expect(201);

    const sessionId: string = videoSessionRes.body.id;
    expect(videoSessionRes.body.status).toBe('RECORDING');
    console.log(`[E2E Pick&Pack] Sessão de captura de vídeo iniciada: ${sessionId}`);

    // ---- 5. Envio de chunks de vídeo (simulando MediaRecorder.timeslice) --
    const CHUNK_COUNT = 5;
    const chunkBuffers: Buffer[] = [];
    for (let sequence = 0; sequence < CHUNK_COUNT; sequence += 1) {
      // Conteúdo determinístico (não precisa ser um vídeo real de verdade —
      // o que o teste verifica é PERSISTÊNCIA/CONTAGEM de bytes, não
      // decodificação de codec).
      const chunk = Buffer.from(`chunk-${sequence}-${'x'.repeat(1000)}`);
      chunkBuffers.push(chunk);

      await request(server)
        .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/chunks`)
        .send({ sequence, contentBase64: chunk.toString('base64') })
        .expect(201);

      console.log(`[E2E Pick&Pack] Upload de chunk de vídeo concluído (sequence=${sequence}, bytes=${chunk.length})`);
    }

    const totalBytesSent = chunkBuffers.reduce((sum, buf) => sum + buf.length, 0);

    // ---- 6. Finalização da embalagem (finaliza a sessão de vídeo) --------
    const finalizeRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions/${sessionId}/finalize`)
      .expect(201);

    expect(finalizeRes.body.status).toBe('FINALIZED');
    expect(finalizeRes.body.receivedChunkCount).toBe(CHUNK_COUNT);
    expect(finalizeRes.body.totalBytes).toBe(totalBytesSent);
    console.log(`[E2E Pick&Pack] Embalagem finalizada — vídeo com ${finalizeRes.body.totalBytes} bytes em ${CHUNK_COUNT} chunks.`);

    // ---- 7. Verificação de persistência do arquivo de vídeo (fake storage) --
    const storedFile = fakeVideoStorage.files.get(finalizeRes.body.storageKey ?? '');
    // storageKey não vem no DTO de resposta do finalize por padrão — busca
    // pela sessão via GET para confirmar a key real gravada no fake.
    const sessionAfterFinalize = await request(server)
      .get(`/api/logistics-fulfillment/audit-events/${auditEventId}/video-sessions`)
      .expect(200);
    const persistedBuffer = fakeVideoStorage.files.get(sessionAfterFinalize.body.storageKey);
    expect(persistedBuffer).toBeDefined();
    expect(persistedBuffer!.length).toBe(totalBytesSent);
    expect(Buffer.concat(chunkBuffers).equals(persistedBuffer!)).toBe(true);
    console.log(
      `[E2E Pick&Pack] Persistência do vídeo verificada: ${persistedBuffer!.length} bytes no storage == ${totalBytesSent} bytes enviados.`,
    );

    // ---- 8. Aprovação final do evento (mídia + checklist 100% -> ledger) --
    const approveRes = await request(server)
      .post(`/api/logistics-fulfillment/audit-events/${auditEventId}/approve`)
      .send({ lines: [{ skuCode: 'SKU-CAMISETA-M', quantity: 2 }, { skuCode: 'SKU-BONE-UNICO', quantity: 1 }] })
      .expect(201);

    expect(approveRes.body.conferenceStatus).toBe('APROVADO');
    expect(approveRes.body.mediaType).toBe('VIDEO');
    console.log(`[E2E Pick&Pack] Evento ${auditEventId} APROVADO — pedido ${PEDIDO_X} liberado para expedição.`);

    // Ledger: FULL_DISPATCH gera débito no físico + crédito no CD virtual —
    // 2 SKUs x 2 linhas cada = 4 entradas.
    expect(fakeEvents.ledgerEntries).toHaveLength(4);
  });

  it('confirma que o RolesGuard real bloqueia papéis sem permissão de escrita', async () => {
    // Reabre um módulo novo com um usuário VIEWER injetado no lugar de
    // ADMIN, para provar que o RolesGuard (não sobrescrito) está realmente
    // ativo — não é só o JwtAuthGuard fake dando acesso livre a tudo.
    const fakeEventsForViewerTest = new FakeStockMovementAuditEventRepository();
    const fakeItemsForViewerTest = new FakeStockMovementAuditEventItemRepository();
    const fakeVideoSessionsForViewerTest = new FakeVideoCaptureSessionRepository();
    const fakeVideoStorageForViewerTest = new FakeVideoChunkStorage();
    const fakeWarehousesForViewerTest = new FakeWarehouseRepository();
    const fakeOrderReaderForViewerTest = new FakeOrderFinancialsReader(CHECKLIST_SEED);
    const fakeAlertsForViewerTest = new FakeAlertService();

    const viewerModuleRef = await Test.createTestingModule({
      controllers: [StockMovementAuditEventController],
      providers: [
        StockMovementAuditEventService,
        VideoCaptureService,
        WarehouseService,
        RolesGuard,
        { provide: STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY, useValue: fakeEventsForViewerTest },
        { provide: STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY, useValue: fakeItemsForViewerTest },
        { provide: VIDEO_CAPTURE_SESSION_REPOSITORY, useValue: fakeVideoSessionsForViewerTest },
        { provide: VIDEO_CHUNK_STORAGE, useValue: fakeVideoStorageForViewerTest },
        { provide: WAREHOUSE_REPOSITORY, useValue: fakeWarehousesForViewerTest },
        { provide: ORDER_FINANCIALS_READER, useValue: fakeOrderReaderForViewerTest },
        { provide: ALERT_SERVICE, useValue: fakeAlertsForViewerTest },
        { provide: FILE_STORAGE, useValue: new FakeFileStorage() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: 'viewer-1', tenantId: 'tenant-1', role: UserRole.VIEWER };
          return true;
        },
      })
      .compile();

    const viewerApp = viewerModuleRef.createNestApplication();
    viewerApp.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    viewerApp.setGlobalPrefix('api');
    await viewerApp.init();

    await request(viewerApp.getHttpServer())
      .post('/api/logistics-fulfillment/audit-events')
      .send({ channelCode: 'MERCADO_LIVRE', orderIds: [] })
      .expect(403);

    await viewerApp.close();
  });
});
