import { OrderFinancialLine } from '../../../shared/contracts/order-financials-reader.port';
import { FixedExpense } from './fixed-expense.entity';
import { computeFixedExpensesForPeriod } from './fixed-expense-proration';

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
  // --- Publicidade (01/08/2026, docs/revisao-geral-2026-08.md §2) ---
  //
  // Gasto com Ads no período, vindo do AdsSpendReader. Fica DEPOIS de
  // margemContribuicao de propósito, como uma linha própria, em vez de
  // entrar em custosVariaveis: publicidade é custo de PERÍODO, não custo
  // por pedido. Somá-la aos custos variáveis mudaria silenciosamente o
  // significado de uma métrica que já existe e é usada em gráfico e tela —
  // e margem de contribuição tem uma definição contábil que não inclui
  // mídia.
  custoAds: number;
  // Margem depois de descontar publicidade. É este o número que responde
  // "sobrou dinheiro?" para quem investe em Ads.
  margemAposAds: number;
  margemAposAdsPct: number | null;
  // false quando NENHUM snapshot de Ads existiu para este canal no período.
  // Distingue "não anunciou" (hasData true, custoAds 0) de "não sabemos"
  // (hasData false) — sem isso os dois viram R$0 e o lojista não tem como
  // saber se a margem exibida já considera mídia.
  adSpendDataAvailable: boolean;
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
  // "Ads" — custo de publicidade atribuído a ESTE pedido (01/08/2026).
  //
  // O gasto por SKU é DADO REAL importado do Mercado Livre (endpoint
  // /advertising/{SITE}/product_ads/ads/{ITEM_ID}, campo `cost`). O que
  // acontece aqui é a única parte que continua sendo divisão: o gasto do
  // SKU no período é distribuído entre as unidades daquele SKU vendidas no
  // mesmo período, proporcionalmente à quantidade de cada pedido.
  //
  // Por que essa divisão é inevitável: o marketplace sabe quais vendas
  // vieram de anúncio, mas não expõe essa marcação por PEDIDO — só o
  // agregado do anúncio. Então "R$120 de mídia no SKU X, que vendeu 40
  // unidades" vira R$3/unidade. É explícito, verificável e proporcional —
  // diferente de espalhar o gasto do canal inteiro sobre todos os pedidos,
  // que era a única alternativa antes de existir custo por item.
  custoAdsRateado: number;
  // Margem líquida do pedido já descontando custoAdsRateado. margemLiquida
  // acima permanece SEM Ads, para não redefinir um número que já existia.
  margemLiquidaAposAds: number;
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
  // Publicidade consolidada (01/08/2026) — soma do custoAds de todos os
  // canais, e a margem depois dela. Ver DreChannelBreakdown para o racional
  // de manter isto como linha separada em vez de somar aos custos variáveis.
  custoAds: number;
  margemAposAds: number;
  margemAposAdsPct: number | null;
  // --- Despesas fixas e resultado operacional (01/08/2026, §3 da revisão) ---
  //
  // Até esta data o relatório se chamava DRE mas parava na margem de
  // contribuição: o lojista via quanto sobrava depois dos custos variáveis,
  // mas nunca se a operação fechava no azul depois de aluguel, folha e
  // software — que é exatamente a pergunta que um DRE existe para responder.
  //
  // NÃO inclui AccountsPayable de propósito. Aquela tabela contém, entre
  // outras coisas, as contas geradas por Ordem de Compra — ou seja, compra
  // de ESTOQUE. Compra de estoque não é despesa quando paga; vira CMV
  // quando o item é vendido, e o CMV já está em custosVariaveis. Somar as
  // duas contaria o mesmo dinheiro duas vezes e mostraria prejuízo onde não
  // há. Só FixedExpense entra aqui, que é despesa operacional de verdade.
  despesasFixas: number;
  resultadoOperacional: number;
  resultadoOperacionalPct: number | null;
  // false quando o período do relatório é ABERTO (sem data inicial ou
  // final). Não dá para ratear um aluguel mensal num intervalo sem fim —
  // qualquer número seria inventado. Nesse caso despesasFixas fica 0 e a
  // tela avisa, em vez de exibir um resultado operacional falso.
  despesasFixasApuradas: boolean;
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

function computeChannelBreakdown(
  channelCode: string,
  lines: OrderFinancialLine[],
  adSpend: { spend: number; hasData: boolean } | undefined,
): DreChannelBreakdown {
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

  // Ads não afeta dataQuality: não ter gasto de mídia é um estado legítimo
  // (o lojista pode simplesmente não anunciar), diferente de não saber o
  // custo de um produto. A distinção fica em adSpendDataAvailable.
  const custoAds = adSpend?.spend ?? 0;
  const margemAposAds = margemContribuicao - custoAds;
  const margemAposAdsPct = receitaBruta > 0 ? (margemAposAds / receitaBruta) * 100 : null;

  return {
    channelCode,
    orderCount: lines.length,
    receitaBruta,
    deducoes,
    custosVariaveis,
    margemContribuicao,
    margemContribuicaoPct,
    custoAds,
    margemAposAds,
    margemAposAdsPct,
    adSpendDataAvailable: adSpend?.hasData ?? false,
    dataQuality,
  };
}

// Custo de mídia por unidade de cada SKU no período: gasto real do SKU
// dividido pelas unidades daquele SKU efetivamente vendidas na janela.
//
// O denominador é as unidades VENDIDAS (não as unidades que o canal
// atribuiu ao anúncio) de propósito: o objetivo é distribuir o custo real
// entre os pedidos que existem, e usar o atribuído deixaria parte do
// dinheiro sem pedido para alocar — o total por pedido não fecharia com o
// total do canal.
function buildAdsCostPerUnitBySku(
  lines: OrderFinancialLine[],
  adSpendBySku: { skuCode: string; spend: number }[],
): Map<string, number> {
  if (adSpendBySku.length === 0) return new Map();

  const unitsSoldBySku = new Map<string, number>();
  for (const line of lines) {
    for (const item of line.items) {
      if (!item.skuCode) continue;
      unitsSoldBySku.set(item.skuCode, (unitsSoldBySku.get(item.skuCode) ?? 0) + item.quantity);
    }
  }

  const costPerUnit = new Map<string, number>();
  for (const entry of adSpendBySku) {
    const units = unitsSoldBySku.get(entry.skuCode) ?? 0;
    // SKU com gasto e ZERO venda no período: não há pedido a onerar. O
    // dinheiro não some do relatório — continua no custoAds do canal, que
    // vem de sumSpendByChannel. Só não é atribuído a pedido nenhum, o que é
    // a verdade (a mídia não converteu naquela janela).
    if (units > 0) costPerUnit.set(entry.skuCode, entry.spend / units);
  }

  return costPerUnit;
}

function computeOrderLine(line: OrderFinancialLine, adsCostPerUnitBySku: Map<string, number>): DreOrderLine {
  const impostos = line.items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0);
  const deducoes = impostos + line.discountAmount;

  const cmv = line.items.reduce((sum, item) => sum + (item.costPriceUsed ?? 0) * item.quantity, 0);
  const custosVariaveis = cmv + line.shippingAmount + line.feeAmount;

  const margemLiquida = line.totalAmount - deducoes - custosVariaveis;

  // Soma o custo de mídia de cada item pela quantidade vendida neste pedido.
  // Item cujo SKU não teve gasto de Ads no período contribui 0 — sem
  // fabricar custo.
  const custoAdsRateado = line.items.reduce(
    (sum, item) => sum + (item.skuCode ? (adsCostPerUnitBySku.get(item.skuCode) ?? 0) * item.quantity : 0),
    0,
  );

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
    custoAdsRateado,
    margemLiquidaAposAds: margemLiquida - custoAdsRateado,
    dataQuality,
  };
}

export function buildDreReport(
  tenantId: string,
  lines: OrderFinancialLine[],
  periodFrom: Date | null,
  periodTo: Date | null,
  generatedAt: Date = new Date(),
  // Gasto com Ads por canal (01/08/2026). Opcional com default vazio para
  // manter a assinatura retrocompatível — quem chamava antes continua
  // funcionando, só sem a linha de publicidade.
  adSpendByChannel: { channelCode: string; spend: number; hasData: boolean }[] = [],
  // Despesas fixas ATIVAS do tenant. O rateio para o período acontece aqui
  // dentro (função pura, testável) — o chamador só entrega a lista crua.
  fixedExpenses: FixedExpense[] = [],
  // Gasto de Ads por SKU (01/08/2026) — dado real vindo do canal, usado
  // para o rateio por pedido em DreOrderLine.custoAdsRateado.
  adSpendBySku: { skuCode: string; spend: number }[] = [],
): DreReport {
  const recognized = lines.filter((l) => !NON_REVENUE_STATUSES.includes(l.status));

  const adSpendIndex = new Map(adSpendByChannel.map((a) => [a.channelCode, a]));

  const byChannel = new Map<string, OrderFinancialLine[]>();
  for (const line of recognized) {
    const group = byChannel.get(line.channelCode) ?? [];
    group.push(line);
    byChannel.set(line.channelCode, group);
  }

  const channels = Array.from(byChannel.entries())
    .map(([channelCode, group]) => computeChannelBreakdown(channelCode, group, adSpendIndex.get(channelCode)))
    .sort((a, b) => b.margemContribuicao - a.margemContribuicao);

  const incompleteOrders = recognized
    .map((line) => buildIncompleteRef(line))
    .filter((ref): ref is DreIncompleteOrderRef => ref !== null);

  const adsCostPerUnitBySku = buildAdsCostPerUnitBySku(recognized, adSpendBySku);

  const orderLines = recognized
    .map((line) => computeOrderLine(line, adsCostPerUnitBySku))
    .sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());

  const receitaBruta = channels.reduce((sum, c) => sum + c.receitaBruta, 0);
  const deducoes = channels.reduce((sum, c) => sum + c.deducoes, 0);
  const custosVariaveis = channels.reduce((sum, c) => sum + c.custosVariaveis, 0);
  const margemContribuicao = receitaBruta - deducoes - custosVariaveis;
  const margemContribuicaoPct = receitaBruta > 0 ? (margemContribuicao / receitaBruta) * 100 : null;
  const dataQuality: DreDataQuality = incompleteOrders.length > 0 ? 'INCOMPLETE' : 'COMPLETE';

  // Soma o Ads dos canais QUE TIVERAM PEDIDO no período (channels), não o
  // adSpendByChannel inteiro: gasto num canal sem nenhuma venda
  // reconhecida não tem receita contra a qual ser comparado, e incluí-lo
  // aqui distorceria o total sem aparecer em nenhuma linha por canal.
  const custoAds = channels.reduce((sum, c) => sum + c.custoAds, 0);
  const margemAposAds = margemContribuicao - custoAds;
  const margemAposAdsPct = receitaBruta > 0 ? (margemAposAds / receitaBruta) * 100 : null;

  // Período aberto não permite ratear despesa recorrente — ver comentário
  // de despesasFixasApuradas. Melhor um zero declarado do que um número
  // inventado passando por resultado operacional.
  const despesasFixasApuradas = periodFrom !== null && periodTo !== null;
  const despesasFixas = despesasFixasApuradas
    ? computeFixedExpensesForPeriod(fixedExpenses, periodFrom, periodTo)
    : 0;
  const resultadoOperacional = margemAposAds - despesasFixas;
  const resultadoOperacionalPct = receitaBruta > 0 ? (resultadoOperacional / receitaBruta) * 100 : null;

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
    custoAds,
    margemAposAds,
    margemAposAdsPct,
    despesasFixas,
    resultadoOperacional,
    resultadoOperacionalPct,
    despesasFixasApuradas,
    dataQuality,
    channels,
    incompleteOrders,
    orderLines,
  };
}
