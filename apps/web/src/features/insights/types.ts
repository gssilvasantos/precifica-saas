// Contrato de UI para sugestões de inteligência (Etapa 18, resposta à
// pergunta 3 do Frontend Expert: "como dispor sugestões de IA sem poluir a
// interface"). Puramente presentacional — NÃO existe ainda um motor de
// sugestões nem endpoint no backend que gere `AIInsight[]` de verdade; este
// tipo e os componentes que o consomem (`AIInsightBadge`/`AIInsightPanel`)
// são o ponto de extensão pronto para quando esse motor existir (mesmo
// racional de `ORDER_EVENTS.READY_FOR_FULFILLMENT`: a UI/o evento existem
// primeiro, o produtor de dados vem depois). Hoje o Dashboard/OrderTable
// passam um array vazio — nenhum dado é inventado.
export type InsightSeverity = 'INFO' | 'ATENCAO' | 'OPORTUNIDADE';

export interface AIInsight {
  id: string;
  severity: InsightSeverity;
  message: string;
  // Chaves opcionais de correlação — permitem à tabela de pedidos mostrar o
  // badge só na linha relevante (por SKU ou por canal), sem que o
  // componente precise saber a origem do dado.
  skuCode?: string;
  channelCode?: string;
  orderId?: string;
}
