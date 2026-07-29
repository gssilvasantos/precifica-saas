// Mesmo padrão de domain/financial-events.ts — arquivo dedicado a
// constantes+tipos, importável por outro módulo sem puxar o
// FinancialIntelligenceModule inteiro (ver comentário em
// financial-intelligence.module.ts sobre listener vs. import de porta). Hoje
// nenhum listener cross-módulo assina isso ainda, mas Ordem de Compra (Fase
// 1, próxima etapa) provavelmente vai — mesmo padrão de
// ReceivableFromOrderListener assinando ORDER_EVENTS.
export const ACCOUNTS_PAYABLE_EVENTS = {
  PAID: 'financial-intelligence.accounts-payable-paid',
} as const;

export interface AccountsPayablePaidEvent {
  tenantId: string;
  accountsPayableId: string;
  amount: number;
  // Quick Win 4 (benchmark Bling) — valor de fato baixado (após juros/
  // desconto/tarifa). Aditivo: quem já consumia só `amount` não quebra.
  paidAmount: number;
  paidAt: Date;
}
