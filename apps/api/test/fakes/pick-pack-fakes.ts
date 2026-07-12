// Fakes em memória para o E2E do Pick & Pack (Sprint 27 — validação em
// produção, item 1 da fila pedida pelo usuário). Cada fake implementa a
// MESMA interface de porta que o adapter Prisma real — nada de "mock" que
// só devolve valor canned: o estado é real (Maps/arrays), então o teste
// pode fazer asserções genuínas (ex.: bytes concatenados no storage de
// vídeo == soma dos chunks enviados). Nenhum destes fakes é usado fora de
// test/ — em produção, tudo isso é Prisma (ver infrastructure/ do módulo).
//
// Por que fakes em vez de Postgres real: `npx prisma generate/migrate` está
// bloqueado por rede neste sandbox (nenhum acesso ao binário do engine) —
// documentado em docs/pick-pack-architecture.md e reafirmado aqui para quem
// ler este arquivo isoladamente. Assim que o ambiente de CI/produção tiver
// acesso real ao Postgres, o ideal é ter TAMBÉM uma suíte e2e apontando para
// um banco de teste real (test containers) — este arquivo não substitui
// isso, só destrava a validação funcional do fluxo agora.
import {
  LedgerEntryInput,
  StockMovementAuditEventRepository,
} from '../../src/modules/logistics-fulfillment/application/ports/stock-movement-audit-event-repository.port';
import { StockMovementAuditEventItemRepository } from '../../src/modules/logistics-fulfillment/application/ports/stock-movement-audit-event-item-repository.port';
import { VideoCaptureSessionRepository } from '../../src/modules/logistics-fulfillment/application/ports/video-capture-session-repository.port';
import { VideoChunkAppendResult, VideoChunkStorage } from '../../src/modules/logistics-fulfillment/application/ports/video-chunk-storage.port';
import { WarehouseRepository } from '../../src/modules/logistics-fulfillment/application/ports/warehouse-repository.port';
import {
  StockMovementAuditEvent,
  StockMovementAuditEventCreateData,
  StockMovementAuditEventItem,
  StockMovementAuditEventItemCreateData,
} from '../../src/modules/logistics-fulfillment/domain/stock-movement-audit-event.entity';
import { VideoCaptureSession, VideoCaptureSessionCreateData } from '../../src/modules/logistics-fulfillment/domain/video-capture.entity';
import { Warehouse, WarehouseUpsertData } from '../../src/modules/logistics-fulfillment/domain/warehouse.entity';
import { AlertService, TechnicalAlert } from '../../src/shared/observability/ports/alert-service.port';
import { OrderFinancialsReader, OrderFinancialLine, OrderItemForFulfillment } from '../../src/shared/contracts/order-financials-reader.port';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeStockMovementAuditEventRepository implements StockMovementAuditEventRepository {
  readonly events = new Map<string, StockMovementAuditEvent>();
  // Exposto para a asserção final do e2e (nunca parte da interface real de
  // porta — é só o "olho" do teste sobre o estado interno do fake).
  readonly ledgerEntries: LedgerEntryInput[] = [];

  async create(data: StockMovementAuditEventCreateData): Promise<StockMovementAuditEvent> {
    const now = new Date();
    const event: StockMovementAuditEvent = {
      id: nextId('audit-event'),
      tenantId: data.tenantId,
      eventType: data.eventType,
      sourceWarehouseId: data.sourceWarehouseId,
      destinationWarehouseId: data.destinationWarehouseId ?? null,
      mediaUrl: null,
      mediaType: null,
      conferenceStatus: 'PENDENTE',
      conferredByUserId: null,
      conferredAt: null,
      divergenceNotes: null,
      invoiceNumber: data.invoiceNumber ?? null,
      createdAt: now,
      updatedAt: now,
      orderIds: data.orderIds ?? [],
    };
    this.events.set(event.id, event);
    return event;
  }

  async findById(tenantId: string, id: string): Promise<StockMovementAuditEvent | null> {
    const event = this.events.get(id);
    if (!event || event.tenantId !== tenantId) return null;
    return event;
  }

  async findByOrderId(
    tenantId: string,
    orderId: string,
    eventType: StockMovementAuditEvent['eventType'],
  ): Promise<StockMovementAuditEvent | null> {
    for (const event of this.events.values()) {
      if (event.tenantId === tenantId && event.eventType === eventType && event.orderIds.includes(orderId)) {
        return event;
      }
    }
    return null;
  }

  async attachMedia(id: string, mediaUrl: string, mediaType: string): Promise<StockMovementAuditEvent> {
    const event = this.requireEvent(id);
    event.mediaUrl = mediaUrl;
    event.mediaType = mediaType;
    event.updatedAt = new Date();
    return event;
  }

  async approveWithLedger(
    id: string,
    conferredByUserId: string,
    ledgerEntries: LedgerEntryInput[],
  ): Promise<StockMovementAuditEvent> {
    const event = this.requireEvent(id);
    event.conferenceStatus = 'APROVADO';
    event.conferredByUserId = conferredByUserId;
    event.conferredAt = new Date();
    event.updatedAt = new Date();
    this.ledgerEntries.push(...ledgerEntries);
    return event;
  }

  async markDivergent(id: string, conferredByUserId: string, divergenceNotes: string): Promise<StockMovementAuditEvent> {
    const event = this.requireEvent(id);
    event.conferenceStatus = 'DIVERGENTE';
    event.conferredByUserId = conferredByUserId;
    event.conferredAt = new Date();
    event.divergenceNotes = divergenceNotes;
    event.updatedAt = new Date();
    return event;
  }

  async findPending(tenantId: string): Promise<StockMovementAuditEvent[]> {
    return Array.from(this.events.values())
      .filter((e) => e.tenantId === tenantId && e.conferenceStatus === 'PENDENTE')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private requireEvent(id: string): StockMovementAuditEvent {
    const event = this.events.get(id);
    if (!event) throw new Error(`[fake] evento ${id} não existe`);
    return event;
  }
}

export class FakeStockMovementAuditEventItemRepository implements StockMovementAuditEventItemRepository {
  readonly items = new Map<string, StockMovementAuditEventItem>();

  async createMany(items: StockMovementAuditEventItemCreateData[]): Promise<StockMovementAuditEventItem[]> {
    const now = new Date();
    const created = items.map((data) => {
      const item: StockMovementAuditEventItem = {
        id: nextId('checklist-item'),
        tenantId: data.tenantId,
        auditEventId: data.auditEventId,
        skuCode: data.skuCode,
        expectedQuantity: data.expectedQuantity,
        scannedQuantity: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.items.set(item.id, item);
      return item;
    });
    return created;
  }

  async findByAuditEvent(tenantId: string, auditEventId: string): Promise<StockMovementAuditEventItem[]> {
    return Array.from(this.items.values()).filter((i) => i.tenantId === tenantId && i.auditEventId === auditEventId);
  }

  async findOneBySku(tenantId: string, auditEventId: string, skuCode: string): Promise<StockMovementAuditEventItem | null> {
    return (
      Array.from(this.items.values()).find(
        (i) => i.tenantId === tenantId && i.auditEventId === auditEventId && i.skuCode === skuCode,
      ) ?? null
    );
  }

  async incrementScanned(id: string): Promise<StockMovementAuditEventItem> {
    const item = this.items.get(id);
    if (!item) throw new Error(`[fake] checklist item ${id} não existe`);
    item.scannedQuantity += 1;
    item.updatedAt = new Date();
    return item;
  }
}

export class FakeVideoCaptureSessionRepository implements VideoCaptureSessionRepository {
  readonly sessions = new Map<string, VideoCaptureSession>();

  async create(data: VideoCaptureSessionCreateData): Promise<VideoCaptureSession> {
    const now = new Date();
    const session: VideoCaptureSession = {
      id: nextId('video-session'),
      tenantId: data.tenantId,
      auditEventId: data.auditEventId,
      storageKey: data.storageKey,
      status: 'RECORDING',
      receivedChunkCount: 0,
      totalBytes: 0,
      startedAt: now,
      finalizedAt: null,
      videoDeletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findById(tenantId: string, id: string): Promise<VideoCaptureSession | null> {
    const session = this.sessions.get(id);
    if (!session || session.tenantId !== tenantId) return null;
    return session;
  }

  async findByAuditEvent(tenantId: string, auditEventId: string): Promise<VideoCaptureSession | null> {
    return (
      Array.from(this.sessions.values()).find((s) => s.tenantId === tenantId && s.auditEventId === auditEventId) ?? null
    );
  }

  async recordChunkReceived(id: string, chunkSize: number): Promise<VideoCaptureSession> {
    const session = this.requireSession(id);
    session.receivedChunkCount += 1;
    session.totalBytes += chunkSize;
    session.updatedAt = new Date();
    return session;
  }

  async finalize(id: string): Promise<VideoCaptureSession> {
    const session = this.requireSession(id);
    session.status = 'FINALIZED';
    session.finalizedAt = new Date();
    session.updatedAt = new Date();
    return session;
  }

  async markVideoDeleted(id: string): Promise<VideoCaptureSession> {
    const session = this.requireSession(id);
    session.videoDeletedAt = new Date();
    session.updatedAt = new Date();
    return session;
  }

  async findExpiredForCleanup(cutoff: Date): Promise<VideoCaptureSession[]> {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'FINALIZED' && s.finalizedAt !== null && s.finalizedAt <= cutoff && !s.videoDeletedAt,
    );
  }

  private requireSession(id: string): VideoCaptureSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`[fake] sessão de vídeo ${id} não existe`);
    return session;
  }
}

// Stateful de propósito (ver cabeçalho do arquivo): concatena os bytes reais
// de cada chunk num Buffer por chave de storage, para que o e2e possa
// verificar "persistência do arquivo de vídeo" comparando o tamanho final
// contra a soma dos chunks enviados — nunca um no-op que só finge sucesso.
export class FakeVideoChunkStorage implements VideoChunkStorage {
  readonly files = new Map<string, Buffer>();

  async createSession(key: string): Promise<void> {
    this.files.set(key, Buffer.alloc(0));
  }

  async appendChunk(key: string, content: Buffer): Promise<VideoChunkAppendResult> {
    const existing = this.files.get(key);
    if (!existing) throw new Error(`[fake] chave de storage ${key} não foi inicializada (createSession não chamado)`);
    const merged = Buffer.concat([existing, content]);
    this.files.set(key, merged);
    return { totalBytes: merged.length };
  }

  async finalizeSession(key: string): Promise<string> {
    return this.getPublicUrl(key);
  }

  getPublicUrl(key: string): string {
    return `https://fake-storage.local/${key}`;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

export class FakeWarehouseRepository implements WarehouseRepository {
  readonly warehouses = new Map<string, Warehouse>();

  async findById(id: string): Promise<Warehouse | null> {
    return this.warehouses.get(id) ?? null;
  }

  async findByCode(tenantId: string, code: string): Promise<Warehouse | null> {
    return (
      Array.from(this.warehouses.values()).find((w) => w.tenantId === tenantId && w.code === code) ?? null
    );
  }

  async findAllByTenant(tenantId: string): Promise<Warehouse[]> {
    return Array.from(this.warehouses.values()).filter((w) => w.tenantId === tenantId);
  }

  async upsert(data: WarehouseUpsertData): Promise<Warehouse> {
    const existing = await this.findByCode(data.tenantId, data.code);
    if (existing) return existing;
    const now = new Date();
    const warehouse: Warehouse = {
      id: nextId('warehouse'),
      tenantId: data.tenantId,
      code: data.code,
      type: data.type,
      channelCode: data.channelCode ?? null,
      isActive: true,
      leadTimeDays: 15,
      logisticsCostPerUnit: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.warehouses.set(warehouse.id, warehouse);
    return warehouse;
  }

  async updateLeadTimeDays(tenantId: string, warehouseId: string, leadTimeDays: number): Promise<Warehouse> {
    const warehouse = this.requireOwned(tenantId, warehouseId);
    warehouse.leadTimeDays = leadTimeDays;
    warehouse.updatedAt = new Date();
    return warehouse;
  }

  async updateLogisticsCostPerUnit(tenantId: string, warehouseId: string, logisticsCostPerUnit: number): Promise<Warehouse> {
    const warehouse = this.requireOwned(tenantId, warehouseId);
    warehouse.logisticsCostPerUnit = logisticsCostPerUnit;
    warehouse.updatedAt = new Date();
    return warehouse;
  }

  private requireOwned(tenantId: string, warehouseId: string): Warehouse {
    const warehouse = this.warehouses.get(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) throw new Error(`[fake] depósito ${warehouseId} não encontrado`);
    return warehouse;
  }
}

// Simula "criação de um pedido" (item 1 do pedido do usuário): devolve os
// itens canned de um "Pedido X", exatamente como o Orders real devolveria
// para StockMovementAuditEventService.createPending montar o checklist —
// sem precisar wire-ar o módulo Orders/Prisma inteiro.
export class FakeOrderFinancialsReader implements OrderFinancialsReader {
  constructor(private readonly itemsByOrderId: Map<string, OrderItemForFulfillment[]>) {}

  async listForPeriod(): Promise<OrderFinancialLine[]> {
    return [];
  }

  async findItemsForOrders(_tenantId: string, orderIds: string[]): Promise<OrderItemForFulfillment[]> {
    const result: OrderItemForFulfillment[] = [];
    for (const orderId of orderIds) {
      result.push(...(this.itemsByOrderId.get(orderId) ?? []));
    }
    return result;
  }
}

export class FakeAlertService implements AlertService {
  readonly alerts: TechnicalAlert[] = [];

  emitAlert(alert: TechnicalAlert): void {
    this.alerts.push(alert);
  }
}
