// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 1.6) — localização física do SKU dentro de um depósito. Ver
// prisma/schema.prisma, model ProductWarehouseLocation, para o racional
// completo de por que é separado de StockLedgerEntry.
export interface ProductWarehouseLocation {
  id: string;
  tenantId: string;
  warehouseId: string;
  skuCode: string;
  location: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductWarehouseLocationUpsertData {
  tenantId: string;
  warehouseId: string;
  skuCode: string;
  location: string;
}

// Texto livre, mas não vazio/só-espaço — mesmo racional de outros campos de
// texto obrigatórios nesta base (ex.: Packaging.code). Teto de 100
// caracteres só para evitar abuso (nenhum sistema de localização real
// precisa de mais que isso para "corredor/prateleira/bin").
export function isValidLocation(location: string): boolean {
  const trimmed = location.trim();
  return trimmed.length > 0 && trimmed.length <= 100;
}
