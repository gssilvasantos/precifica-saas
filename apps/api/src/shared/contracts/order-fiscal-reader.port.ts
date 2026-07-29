// Exportado pelo Orders, consumido pelo Fiscal (Fase 3, Emissão de NF-e) —
// DTO autocontido, mesma disciplina de OrderFinancialsReader/
// AccountsPayableWriter: nenhum tipo do domínio interno de Orders (OrderStatus
// etc.) vaza para cá, só os campos que a emissão de NF-e realmente precisa.
//
// NÃO inclui nome/endereço do comprador — Order (orders/domain/order.entity.ts)
// hoje só guarda buyerTaxId (CPF/CNPJ), nenhum canal normaliza nome/endereço
// estruturado ainda (gap conhecido, ver docs/fiscal-nfe-architecture.md).
// Por isso o destinatário completo da NF-e é sempre informado por quem chama
// FiscalInvoiceService.emit — este DTO só empresta o que o pedido já tem.
export interface OrderFiscalItem {
  skuCode: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderFiscalData {
  orderId: string;
  channelCode: string;
  externalOrderId: string;
  status: string; // string solta (não o enum de Orders) — DTO autocontido
  buyerTaxId: string | null;
  totalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  items: OrderFiscalItem[];
}

export interface OrderFiscalReader {
  getForFiscalEmission(tenantId: string, orderId: string): Promise<OrderFiscalData | null>;
}

export const ORDER_FISCAL_READER = Symbol('ORDER_FISCAL_READER');
