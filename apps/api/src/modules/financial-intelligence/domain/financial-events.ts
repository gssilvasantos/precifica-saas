// Mesma convenção de eventos de domínio do resto da plataforma (string +
// payload tipado, via EventEmitter2) — existe para que um futuro módulo de
// Analytics/Cash Flow Projection possa reagir a "um repasse foi confirmado"
// sem financial-intelligence precisar conhecê-lo.
export const FINANCIAL_EVENTS = {
  RECEIVABLE_PAID: 'financial-intelligence.receivable-paid',
} as const;

export interface ReceivablePaidEvent {
  tenantId: string;
  receivableId: string;
  amount: number;
  marketplaceSource: string;
  paidAt: Date;
}
