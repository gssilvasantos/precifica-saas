// O "Hub de Provas" — um registro por evento de saída de estoque (despacho
// Full ou envio de varejo). Este arquivo contém só o TIPO e as funções
// PURAS que decidem o que é permitido fazer com ele — nenhuma chamada a
// Prisma/HTTP aqui, para que a regra de ouro ("sem mídia aprovada, sem
// movimento de estoque") seja testável sem mock de banco.
export type StockMovementEventType = 'FULL_DISPATCH' | 'RETAIL_SHIPMENT';
export type ConferenceStatus = 'PENDENTE' | 'APROVADO' | 'DIVERGENTE';

export interface StockMovementAuditEvent {
  id: string;
  tenantId: string;
  eventType: StockMovementEventType;
  sourceWarehouseId: string; // sempre o físico, em ambos os tipos de evento
  // Nulo em RETAIL_SHIPMENT (venda ao consumidor final não credita depósito
  // nenhum nosso) — preenchido só em FULL_DISPATCH.
  destinationWarehouseId: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  conferenceStatus: ConferenceStatus;
  conferredByUserId: string | null;
  conferredAt: Date | null;
  divergenceNotes: string | null;
  invoiceNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Resolvido a partir de StockMovementAuditEventOrder — vazio em
  // FULL_DISPATCH de reabastecimento preventivo (sem pedido nenhum atrás),
  // exatamente 1 item em RETAIL_SHIPMENT, N itens em um lote Full normal.
  orderIds: string[];
}

export interface StockMovementAuditEventCreateData {
  tenantId: string;
  eventType: StockMovementEventType;
  sourceWarehouseId: string;
  destinationWarehouseId?: string | null;
  orderIds?: string[];
  invoiceNumber?: string | null;
}

// Quantidade sempre positiva — a DIREÇÃO (débito no físico / crédito no
// virtual) é decidida por buildLedgerEntries, nunca pelo chamador.
export interface StockMovementLine {
  skuCode: string;
  quantity: number;
}

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

// Sprint 27 (Pick & Pack) — checklist de bipagem por SKU, montado a partir
// dos itens dos pedidos vinculados no momento da criação (createPending).
// Ver docs/pick-pack-architecture.md, seção 1.
export interface StockMovementAuditEventItem {
  id: string;
  tenantId: string;
  auditEventId: string;
  skuCode: string;
  expectedQuantity: number;
  scannedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementAuditEventItemCreateData {
  tenantId: string;
  auditEventId: string;
  skuCode: string;
  expectedQuantity: number;
}

// Itens de pedido, na forma mínima que este módulo precisa (evita importar
// o domínio de Orders — mesma disciplina de DTO autocontido do resto da
// plataforma, ver OrderFinancialLineItem).
export interface FulfillmentOrderItemInput {
  skuCode: string | null;
  quantity: number;
}

// Agrega itens de N pedidos (um lote Full pode ter o mesmo SKU em pedidos
// diferentes) numa linha por SKU — o checklist que a tela de conferência
// exibe. Itens com skuCode nulo (SKU do canal ainda não casado com um
// Product — mesma tolerância de OrderItem.skuCode em todo o resto da
// plataforma) são EXCLUÍDOS do checklist, porque não há código de barras
// interno para bipar. Gap conhecido, documentado em
// docs/pick-pack-architecture.md, seção 1: um pedido 100% com SKUs não
// resolvidos geraria um checklist vazio, que isFullyScanned trata como
// vacuamente aprovado — por isso o chamador (createPending) deve sempre
// reportar quantos itens ficaram de fora, nunca descartar isso em silêncio.
export function buildChecklistFromOrderItems(
  items: FulfillmentOrderItemInput[],
): { skuCode: string; expectedQuantity: number }[] {
  const bySku = new Map<string, number>();
  for (const item of items) {
    if (!item.skuCode) continue;
    bySku.set(item.skuCode, (bySku.get(item.skuCode) ?? 0) + item.quantity);
  }
  return Array.from(bySku.entries()).map(([skuCode, expectedQuantity]) => ({ skuCode, expectedQuantity }));
}

// O "juiz" pedido pelo usuário: só devolve ok quando TODA linha do
// checklist está com scannedQuantity === expectedQuantity. Uma lista vazia
// é considerada vacuamente aprovada de propósito — é o que preserva o
// fluxo legado de FULL_DISPATCH de reabastecimento preventivo (orderIds:
// [], sem checklist nenhum, aprovação seguindo só a regra de mídia
// pré-existente da Sprint 24). Para RETAIL_SHIPMENT e FULL_DISPATCH COM
// pedidos, o checklist nunca fica vazio (a menos que todo SKU seja
// irresolvido — gap documentado acima), então o gate se aplica de fato.
export function isFullyScanned(
  items: Pick<StockMovementAuditEventItem, 'expectedQuantity' | 'scannedQuantity'>[],
): GateCheck {
  const pending = items.filter((i) => i.scannedQuantity < i.expectedQuantity);
  if (pending.length > 0) {
    return {
      ok: false,
      reason: `${pending.length} SKU(s) do checklist ainda não totalmente bipado(s) — conferência incompleta.`,
    };
  }
  return { ok: true };
}

// Gate de UMA bipagem individual, aplicado ANTES de incrementar
// scannedQuantity — nunca deixa passar de expectedQuantity (bipagem extra
// por engano) nem aceita um SKU fora do checklist deste evento.
export function canScanItem(
  item: Pick<StockMovementAuditEventItem, 'expectedQuantity' | 'scannedQuantity'> | undefined,
  skuCode: string,
): GateCheck {
  if (!item) {
    return { ok: false, reason: `SKU ${skuCode} não está no checklist deste evento.` };
  }
  if (item.scannedQuantity >= item.expectedQuantity) {
    return {
      ok: false,
      reason: `SKU ${skuCode} já atingiu a quantidade esperada (${item.expectedQuantity}) — bipagem extra rejeitada.`,
    };
  }
  return { ok: true };
}

// A regra de ouro em forma de função pura: só pode aprovar um evento que
// ainda esteja PENDENTE, que já tenha mídia anexada E (Sprint 27) cujo
// checklist de bipagem esteja 100% completo. Chamado pelo
// StockMovementAuditEventService ANTES de abrir a transação que grava o
// ledger — é este retorno, não uma checagem espalhada pelo service, que
// decide se a aprovação prossegue.
export function canApprove(
  event: Pick<StockMovementAuditEvent, 'conferenceStatus' | 'mediaUrl'>,
  items: Pick<StockMovementAuditEventItem, 'expectedQuantity' | 'scannedQuantity'>[] = [],
): GateCheck {
  if (event.conferenceStatus !== 'PENDENTE') {
    return { ok: false, reason: `Evento já está ${event.conferenceStatus} — não pode ser aprovado de novo.` };
  }
  if (!event.mediaUrl) {
    return {
      ok: false,
      reason: 'Nenhuma mídia (foto/vídeo) anexada — a verificação visual é obrigatória antes da aprovação.',
    };
  }
  const checklist = isFullyScanned(items);
  if (!checklist.ok) {
    return checklist;
  }
  return { ok: true };
}

export function canMarkDivergent(event: Pick<StockMovementAuditEvent, 'conferenceStatus'>): GateCheck {
  if (event.conferenceStatus !== 'PENDENTE') {
    return { ok: false, reason: `Evento já está ${event.conferenceStatus} — não pode ser marcado como divergente de novo.` };
  }
  return { ok: true };
}

// Traduz o evento JÁ APROVADO + as quantidades por SKU nas linhas de
// StockLedgerEntry a gravar. Não decide SE deve gravar (isso é canApprove,
// chamado antes) — só COMO gravar, uma vez decidido que sim. RETAIL_SHIPMENT
// (destinationWarehouseId nulo) gera só o débito do físico; FULL_DISPATCH
// gera o débito do físico E o crédito simétrico no CD virtual, com o MESMO
// auditEventId nas duas linhas.
export function buildLedgerEntries(
  event: Pick<StockMovementAuditEvent, 'id' | 'tenantId' | 'sourceWarehouseId' | 'destinationWarehouseId'>,
  lines: StockMovementLine[],
): Array<{ tenantId: string; warehouseId: string; skuCode: string; quantityDelta: number; auditEventId: string }> {
  const entries: Array<{ tenantId: string; warehouseId: string; skuCode: string; quantityDelta: number; auditEventId: string }> = [];

  for (const line of lines) {
    entries.push({
      tenantId: event.tenantId,
      warehouseId: event.sourceWarehouseId,
      skuCode: line.skuCode,
      quantityDelta: -Math.abs(line.quantity),
      auditEventId: event.id,
    });

    if (event.destinationWarehouseId) {
      entries.push({
        tenantId: event.tenantId,
        warehouseId: event.destinationWarehouseId,
        skuCode: line.skuCode,
        quantityDelta: Math.abs(line.quantity),
        auditEventId: event.id,
      });
    }
  }

  return entries;
}
