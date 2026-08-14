// Evento emitido quando um produto é importado ou atualizado a partir do ERP
// (13/08/2026).
//
// POR QUE EVENTO, E NÃO CHAMADA DIRETA. O consumidor natural é o Tax
// Intelligence, que classifica o produto a partir do NCM. Mas aquele módulo
// importa OrdersModule (o RBT12 é a receita dos pedidos), e OrdersModule
// importa este — chamar direto criaria o ciclo
// ErpIntegration -> TaxIntelligence -> Orders -> ErpIntegration.
//
// `forwardRef` compilaria e esconderia o acoplamento. O evento diz a verdade
// sobre a relação: o importador ANUNCIA um fato consumado e não sabe, nem
// precisa saber, quem reage.
//
// Consequência aceita: quem escuta roda FORA do contexto de tenant da
// requisição, e precisa reabrir o TenantContextStore explicitamente — ver
// ProductImportedTaxListener.

export const ERP_PRODUCT_EVENTS = {
  IMPORTED: 'erp.product.imported',
} as const;

export interface ErpProductImportedEvent {
  tenantId: string;
  // Id do produto no CATÁLOGO do Kyneti, não o externalId do ERP.
  productId: string;
  skuCode: string;
  // Como veio do ERP. null é legítimo: cadastro incompleto é comum, e o
  // produto entra mesmo assim.
  ncm: string | null;
}
