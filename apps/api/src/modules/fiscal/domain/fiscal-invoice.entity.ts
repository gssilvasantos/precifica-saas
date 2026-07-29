// Emissão de NF-e (Fase 3, benchmark Tiny ERP, 28/07/2026) — ver
// docs/tiny-erp-benchmark-analysis.md, seção 1.1, e
// docs/fiscal-nfe-architecture.md. Este arquivo contém só o TIPO e as
// funções PURAS de validação/gate — nenhuma chamada a Prisma ou ao Focus
// NFe aqui, mesma disciplina do resto do domínio nesta base.

// Espelha 1:1 o enum FiscalInvoiceStatus do Prisma.
export type FiscalInvoiceStatus = 'PENDENTE' | 'PROCESSANDO' | 'AUTORIZADA' | 'ERRO' | 'CANCELADA';

export type FiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

export interface FiscalAddress {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  pais?: string;
}

export interface FiscalInvoice {
  id: string;
  tenantId: string;
  orderId: string;
  focusRef: string;
  status: FiscalInvoiceStatus;
  environment: FiscalEnvironment;
  destNome: string;
  destDocumento: string;
  destEndereco: FiscalAddress;
  destTelefone: string | null;
  nfeNumber: string | null;
  nfeSeries: string | null;
  accessKey: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelReason: string | null;
  requestedAt: Date;
  authorizedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FiscalInvoiceCreateData {
  tenantId: string;
  orderId: string;
  focusRef: string;
  environment: FiscalEnvironment;
  destNome: string;
  destDocumento: string;
  destEndereco: FiscalAddress;
  destTelefone?: string | null;
}

// Resultado da autorização (vindo da resposta do Focus NFe, seja por
// consulta manual ou por gatilho/webhook) — usado por
// FiscalInvoiceService.markAuthorized.
export interface FiscalAuthorizationResult {
  nfeNumber: string;
  nfeSeries: string;
  accessKey: string;
  xmlUrl: string;
  danfeUrl: string;
}

export interface FiscalErrorResult {
  errorCode: string;
  errorMessage: string;
}

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

// Status de pedido (orders/domain/order.entity.ts, OrderStatus) que
// NUNCA podem receber emissão de NF-e: EM_ABERTO (venda ainda não
// confirmada) e CANCELADO (venda desfeita — emitir nota aqui seria emitir
// documento fiscal para uma venda que não existe mais).
const NON_EMITTABLE_ORDER_STATUSES = new Set(['EM_ABERTO', 'CANCELADO']);

// Gate de emissão — pura, recebe o status do pedido (string solta, não o
// enum de Orders: fiscal não importa o domínio interno de outro módulo,
// mesma disciplina de Ports & Adapters usada em todo o resto desta base) e
// as notas JÁ EXISTENTES para este pedido. Reemissão só é permitida se a
// tentativa mais recente terminou em ERRO (ou não existe nenhuma ainda) —
// nunca reemite em cima de uma nota PENDENTE/PROCESSANDO/AUTORIZADA.
export function canEmit(orderStatus: string, existingInvoices: Pick<FiscalInvoice, 'status'>[]): GateCheck {
  if (NON_EMITTABLE_ORDER_STATUSES.has(orderStatus)) {
    return { ok: false, reason: `Pedido em status ${orderStatus} não pode gerar NF-e.` };
  }

  const blocking = existingInvoices.find((inv) => inv.status === 'PENDENTE' || inv.status === 'PROCESSANDO' || inv.status === 'AUTORIZADA');
  if (blocking) {
    return {
      ok: false,
      reason:
        blocking.status === 'AUTORIZADA'
          ? 'Este pedido já tem uma NF-e autorizada.'
          : 'Este pedido já tem uma emissão de NF-e em andamento.',
    };
  }

  return { ok: true };
}

// Cancelamento só é permitido para nota AUTORIZADA — mesma regra da API
// Focus NFe (nfe_nao_autorizada é devolvido caso contrário). A janela legal
// de cancelamento (tipicamente limitada a poucas horas após autorização,
// varia por UF) NÃO é validada aqui de propósito: é responsabilidade da
// própria SEFAZ/Focus NFe rejeitar fora do prazo — ver
// docs/fiscal-nfe-architecture.md, seção de gaps conhecidos.
export function canCancel(invoice: Pick<FiscalInvoice, 'status'>, justificativa: string): GateCheck {
  if (invoice.status !== 'AUTORIZADA') {
    return { ok: false, reason: 'Só é possível cancelar uma NF-e autorizada.' };
  }
  const trimmed = justificativa.trim();
  if (trimmed.length < 15 || trimmed.length > 255) {
    return { ok: false, reason: 'A justificativa deve ter entre 15 e 255 caracteres (exigência da SEFAZ/Focus NFe).' };
  }
  return { ok: true };
}

// Gera uma referência nova e única para o `?ref=` do Focus NFe — inclui um
// contador de tentativa para nunca colidir com uma tentativa anterior
// (mesmo em caso de erro, que libera reemissão mas NÃO reaproveita a
// mesma ref usada por uma tentativa que chegou a ser autorizada).
export function buildFocusRef(tenantId: string, orderId: string, attempt: number): string {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const safeOrder = orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return `${safeTenant}-${safeOrder}-${attempt}`;
}
