// Porta de LEITURA+ESCRITA exposta pelo Orders — consumida pelo Sellers
// (Vendedores + Comissão, Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026, docs/sellers-architecture.md) para atribuir vendedor a um
// item de pedido, ler linhas de comissão e marcar comissões como pagas, sem
// que o Sellers precise importar a classe concreta OrdersService nem o
// domínio interno de Orders. Mesmo racional de ACCOUNTS_PAYABLE_WRITER
// (Financial Intelligence -> Procurement): porta ENXUTA, DTO autocontido —
// nunca o ORDER_REPOSITORY inteiro exposto cross-módulo.
//
// Evita dependência circular: FinancialIntelligenceModule já importa
// OrdersModule (para ORDER_FINANCIALS_READER/DRE) — se OrdersModule
// importasse SellersModule (ou vice-versa formando um ciclo com Financial),
// o Nest não resolveria o grafo de módulos. Por isso o CommissionService
// mora no Sellers (que importa Orders + FinancialIntelligence, nunca o
// contrário).
export interface CommissionLineDto {
  orderItemId: string;
  orderId: string;
  externalOrderId: string;
  skuCode: string | null;
  productName: string;
  base: number;
  aliquotaPct: number;
  valor: number;
  orderedAt: Date;
  comissaoPagaEm: Date | null;
}

export interface OrderCommissionWriter {
  // Lookup de LEITURA — devolve o totalPrice do item (base sobre a qual a
  // comissão incide), usado por CommissionService.assignVendedor ANTES de
  // calcular computeCommission (domínio de Sellers, nunca de Orders).
  // Devolve null quando o item não existe (ou não pertence ao
  // tenant/pedido informado).
  findItemForCommission(tenantId: string, orderId: string, itemId: string): Promise<{ id: string; totalPrice: number } | null>;

  // Devolve null quando o item não existe (ou não pertence ao tenant/pedido
  // informado) — CommissionService traduz isso em NotFoundException.
  assignVendedorToItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    data: { vendedorId: string; comissaoAliquotaPct: number; comissaoValor: number },
  ): Promise<{ id: string; totalPrice: number } | null>;

  findCommissionLines(
    tenantId: string,
    vendedorId: string,
    options?: { dateFrom?: Date; dateTo?: Date; onlyPending?: boolean },
  ): Promise<CommissionLineDto[]>;

  markCommissionsPaid(tenantId: string, orderItemIds: string[], paidAt: Date): Promise<number>;
}

export const ORDER_COMMISSION_WRITER = Symbol('ORDER_COMMISSION_WRITER');
