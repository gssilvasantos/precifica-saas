import { OrderFinancialLine } from '../../../shared/contracts/order-financials-reader.port';

// DRE (Demonstração do Resultado do Exercício) simplificado, por canal —
// Etapa 20. Função pura: recebe as linhas já normalizadas pelo Orders
// (OrderFinancialsReader) e devolve o relatório, sem tocar banco/HTTP. Zero
// mocks necessários para testar.
//
// Cadeia de cálculo (waterfall clássico de DRE, na ordem em que os valores
// são deduzidos):
//   receitaBruta            = soma de Order.totalAmount (o que o comprador pagou)
//   (-) deducoes             = impostos por item (OrderItem.taxAmount) + descontos (Order.discountAmount)
//   (-) custosVariaveis      = CMV (custo unitário resolvido x quantidade) + fretes (Order.shippingAmount) + comissão do canal (Order.feeAmount)
//   = margemContribuicao
//
// Pedidos CANCELADO nunca entram no cálculo — não são receita reconhecida.
export type DreDataQuality = 'COMPLETE' | 'INCOMPLETE';

// Canais confirmados como "comissão zero é o valor correto" (ver
// docs/orders-architecture.md, seção 11.2: Nuvemshop é a loja própria do
// vendedor, sem comissão de marketplace). Qualquer OUTRO canal com
// feeAmount = 0 é tratado como suspeito/não confirmado — a Regra de Ouro
// pede para sinalizar em vez de aceitar cegamente. Ajustar esta lista
// quando um adapter real confirmar (por código, não por adivinhação) que um
// canal novo também tem comissão zero.
const KNOWN_ZERO_FEE_CHANNELS: readonly string[] = ['NUVEMSHOP'];

const NON_REVENUE_STATUSES: readonly string[] = ['CANCELADO'];

export interface DreIncompleteOrderRef {
  orderId: string;
  externalOrderId: string;
  channelCode: string;
  reasons: string[];
}

export interface DreChannelBreakdown {
  channelCode: string;
  orderCount: number;
  receitaBruta: number;
  deducoes: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPct: number | null;
  // 'INCOMPLETE' quando pelo menos um pedido deste canal tem custo
  // desconhecido ou comissão não confirmada — a margem acima ainda é
  // calculada (nunca fica em branco), mas deve ser lida como uma
  // APROXIMAÇÃO (itens de custo desconhecido contribuem 0 ao CMV, o que
  // tende a SUPERESTIMAR levemente a margem) até os pedidos listados em
  // `incompleteOrders` (no DreReport) serem corrigidos.
  dataQuality: DreDataQuality;
}

// Fase de Conexão Real — extensão ADITIVA do DRE (Sprint 23): o relatório até
// aqui só expunha agregados por canal (DreChannelBreakdown) — suficiente
// para o gráfico comparativo, mas não para "eu quero ver CADA pedido com seu
// próprio cálculo financeiro", que é exatamente o que a tela de DRE por
// pedido do frontend precisa. DreOrderLine reaproveita a MESMA cadeia de
// cálculo (receitaBruta - deducoes - custosVariaveis) de
// computeChannelBreakdown, só que para um único pedido em vez de um grupo —
// nunca uma fórmula financeira paralela/divergente.
export interface DreOrderLine {
  orderId: string;
  externalOrderId: string;
  channelCode: string;
  orderedAt: Date;
  // "Valor Total" — o que o comprador pagou (Order.totalAmount).
  totalAmount: number;
  // "Taxas" — comissão do canal deduzida deste pedido (Order.feeAmount).
  // Impostos/descontos (a outra metade de `deducoes`) e frete continuam
  // sendo descontados no cálculo de margemLiquida abaixo, mesmo não tendo
  // coluna própria na tabela simples pedida — a margem nunca omite uma
  // dedução real só porque a UI não a lista explicitamente.
  feeAmount: number;
  // "CMV" — custo unitário resolvido (snapshot do pedido ou custo atual do
  // produto, via fallback do Orders) x quantidade, somado entre os itens.
  cmv: number;
  // "Margem Líquida" deste pedido — receitaBruta - deducoes - custosVariaveis,
  // mesma fórmula do waterfall de canal, aplicada a um pedido só.
  margemLiquida: number;
  // INCOMPLETE quando este pedido específico tem item de custo desconhecido
  // ou comissão suspeita — mesmo critério usado por canal, granular por pedido.
  dataQuality: DreDataQuality;
}

export interface DreReport {
  tenantId: string;
  periodFrom: Date | null;
  periodTo: Date | null;
  generatedAt: Date;
  receitaBruta: number;
  deducoes: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPct: number | null;
  dataQuality: DreDataQuality;
  // Ordenado por margemContribuicao desc — pronto para o gráfico de barras
  // comparativo do Dashboard (só os canais com pedido no período; canais
  // sem dado nenhum não aparecem aqui — ver docs/financial-intelligence-architecture.md
  // sobre como o frontend completa os 7 marketplaces no gráfico).
  channels: DreChannelBreakdown[];
  // Achatado de todos os canais — para a tela de correção identificar o
  // pedido específico (Regra de Ouro: nunca só um agregado "está incompleto
  // em algum lugar", sempre o pedido exato).
  incompleteOrders: DreIncompleteOrderRef[];
  // Sprint 23 — um item por pedido reconhecido no período (mesmo filtro de
  // NON_REVENUE_STATUSES do resto do relatório), ordenado por orderedAt
  // desc (pedido mais recente primeiro) — é a fonte da tabela "Pedido /
  // Valor Total / Taxas / CMV / Margem Líquida" do draft de DRE do frontend.
  orderLines: DreOrderLine[];
}

function isCostIncomplete(line: OrderFinancialLine): boolean {
  return line.items.some((item) => !item.costKnown);
}

function isFeeSuspicious(line: OrderFinancialLine): boolean {
  return line.feeAmount === 0 && !KNOWN_ZERO_FEE_CHANNELS.includes(line.channelCode);
}

function buildIncompleteRef(line: OrderFinancialLine): DreIncompleteOrderRef | null {
  const reasons: string[] = [];

  const unknownCostItems = line.items.filter((item) => !item.costKnown);
  if (unknownCostItems.length > 0) {
    const skus = unknownCostItems.map((item) => item.skuCode ?? '(sem SKU)').join(', ');
    reasons.push(`Custo desconhecido para ${unknownCostItems.length} item(ns) (SKU: ${skus})`);
  }

  if (isFeeSuspicious(line)) {
    reasons.push(`Comissão do canal (feeAmount) não confirmada para ${line.channelCode} (valor registrado: 0)`);
  }

  if (reasons.length === 0) return null;
  return { orderId: line.orderId, externalOrderId: line.externalOrderId, channelCode: line.channelCode, reasons };
}

function computeChannelBreakdown(channelCode: string, lines: OrderFinancialLine[]): DreChannelBreakdown {
  const receitaBruta = lines.reduce((sum, l) => sum + l.totalAmount, 0);

  const impostos = lines.reduce((sum, l) => sum + l.items.reduce((s, item) => s + (item.taxAmount ?? 0), 0), 0);
  const descontos = lines.reduce((sum, l) => sum + l.discountAmount, 0);
  const deducoes = impostos + descontos;

  // CMV: item sem custo conhecido contribui 0 aqui de propósito (ver aviso
  // de "aproximação" no comentário de DreChannelBreakdown.dataQuality) —
  // nunca bloqueia o cálculo do canal inteiro, mas também nunca fabrica um
  // custo que ninguém informou.
  const cmv = lines.reduce(
    (sum, l) => sum + l.items.reduce((s, item) => s + (item.costPriceUsed ?? 0) * item.quantity, 0),
    0,
  );
  const fretes = lines.reduce((sum, l) => sum + l.shippingAmount, 0);
  const comissoes = lines.reduce((sum, l) => sum + l.feeAmount, 0);
  const custosVariaveis = cmv + fretes + comissoes;

  const margemContribuicao = receitaBruta - deducoes - custosVariaveis;
  const margemContribuicaoPct = receitaBruta > 0 ? (margemContribuicao / receitaBruta) * 100 : null;

  const dataQuality: DreDataQuality = lines.some((l) => isCostIncomplete(l) || isFeeSuspicious(l)) ? 'INCOMPLETE' : 'COMPLETE';

  return { channelCode, orderCount: lines.length, receitaBruta, deducoes, custosVariaveis, margemContribuicao, margemContribuicaoPct, dataQuality };
}

function computeOrderLine(line: OrderFinancialLine): DreOrderLine {
  const impostos = line.items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0);
  const deducoes = impostos + line.discountAmount;

  const cmv = line.items.reduce((sum, item) => sum + (item.costPriceUsed ?? 0) * item.quantity, 0);
  const custosVariaveis = cmv + line.shippingAmount + line.feeAmount;

  const margemLiquida = line.totalAmount - deducoes - custosVariaveis;
  const dataQuality: DreDataQuality = isCostIncomplete(line) || isFeeSuspicious(line) ? 'INCOMPLETE' : 'COMPLETE';

  return {
    orderId: line.orderId,
    externalOrderId: line.externalOrderId,
    channelCode: line.channelCode,
    orderedAt: line.orderedAt,
    totalAmount: line.totalAmount,
    feeAmount: line.feeAmount,
    cmv,
    margemLiquida,
    dataQuality,
  };
}

export function buildDreReport(
  tenantId: string,
  lines: OrderFinancialLine[],
  periodFrom: Date | null,
  periodTo: Date | null,
  generatedAt: Date = new Date(),
): DreReport {
  const recognized = lines.filter((l) => !NON_REVENUE_STATUSES.includes(l.status));

  const byChannel = new Map<string, OrderFinancialLine[]>();
  for (const line of recognized) {
    const group = byChannel.get(line.channelCode) ?? [];
    group.push(line);
    byChannel.set(line.channelCode, group);
  }

  const channels = Array.from(byChannel.entries())
    .map(([channelCode, group]) => computeChannelBreakdown(channelCode, group))
    .sort((a, b) => b.margemContribuicao - a.margemContribuicao);

  const incompleteOrders = recognized
    .map((line) => buildIncompleteRef(line))
    .filter((ref): ref is DreIncompleteOrderRef => ref !== null);

  const orderLines = recognized
    .map((line) => computeOrderLine(line))
    .sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());

  const receitaBruta = channels.reduce((sum, c) => sum + c.receitaBruta, 0);
  const deducoes = channels.reduce((sum, c) => sum + c.deducoes, 0);
  const custosVariaveis = channels.reduce((sum, c) => sum + c.custosVariaveis, 0);
  const margemContribuicao = receitaBruta - deducoes - custosVariaveis;
  const margemContribuicaoPct = receitaBruta > 0 ? (margemContribuicao / receitaBruta) * 100 : null;
  const dataQuality: DreDataQuality = incompleteOrders.length > 0 ? 'INCOMPLETE' : 'COMPLETE';

  return {
    tenantId,
    periodFrom,
    periodTo,
    generatedAt,
    receitaBruta,
    deducoes,
    custosVariaveis,
    margemContribuicao,
    margemContribuicaoPct,
    dataQuality,
    channels,
    incompleteOrders,
    orderLines,
  };
}
