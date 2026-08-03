import { AppDataMode } from './order-financials-reader.port';

// Porta exposta pelo Marketplace Ads, consumida pelo Financial Intelligence
// (01/08/2026 — ver docs/revisao-geral-2026-08.md, §2).
//
// POR QUE EXISTE: até esta data o DRE ignorava completamente o gasto com
// publicidade — busca por "ads" no módulo financeiro inteiro não retornava
// nada. O lojista via a margem de contribuição depois de comissão, frete,
// imposto e CMV, mas antes do dinheiro gasto em anúncio, que em operação
// que usa Ads é justamente o que separa lucro de prejuízo.
//
// A pesquisa de mercado (docs/market-landscape-analysis.md, §7) mostrou que
// "margem com Ads descontado" é o recurso mais replicado entre os
// concorrentes brasileiros — Jodda.ia, Letzee, Emori e Mercado Turbo vendem
// exatamente isso como funcionalidade central. Não ter era o gap mais
// visível comercialmente de toda a revisão.
export interface AdsSpendByChannel {
  channelCode: string;
  spend: number;
  // Distingue "gastou R$0 porque não anunciou" de "não temos dado porque a
  // sincronização de Ads nunca rodou". Sem isso, os dois casos apareceriam
  // como R$0 e o lojista não teria como saber se a margem exibida já
  // considera publicidade. Mesma disciplina do dataQuality do DRE: nunca
  // deixar o usuário achar que um número é completo quando não é.
  hasData: boolean;
}

// Gasto com Ads atribuído a um SKU no período — DADO REAL, não rateio.
//
// Confirmado em 01/08/2026 na documentação oficial do Mercado Livre: o
// endpoint `/advertising/{SITE}/product_ads/ads/{ITEM_ID}` aceita
// `metrics=cost,units_quantity` e devolve o investimento POR ANÚNCIO. Como
// ChannelListing já liga anúncio↔SKU, o custo chega ao produto sem nenhuma
// estimativa no caminho.
//
// Isso corrige uma ressalva anterior deste projeto, que assumia que só
// existia gasto por campanha e que qualquer atribuição por pedido seria
// chute. Metade disso continua verdade — ver DreOrderLine.custoAdsRateado
// para onde a divisão ainda acontece e por quê.
export interface AdsSpendBySku {
  skuCode: string;
  channelCode: string;
  spend: number;
  // Unidades que o próprio canal creditou à publicidade no período. NÃO é
  // o total vendido do SKU — é o que o marketplace atribui ao anúncio
  // patrocinado. Exposto para a tela conseguir mostrar "R$120 de mídia
  // geraram 8 vendas atribuídas", que é a leitura útil.
  attributedUnits: number;
}

export interface AdsSpendReader {
  // Gasto por SKU no período. Lista vazia quando não há captura por item
  // para aquele tenant/período — quem consome trata a ausência como "sem
  // dado", nunca como "gastou zero".
  sumSpendBySku(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date,
    dataMode?: AppDataMode,
  ): Promise<AdsSpendBySku[]>;

  // Gasto com anúncios agregado por CANAL no período. Por canal, e não por
  // pedido, porque é a granularidade que o dado realmente tem hoje:
  // AdsMetricSnapshot guarda gasto por campanha × dia, sem vínculo com SKU
  // nem com pedido. Ratear isso por pedido exigiria um vínculo
  // campanha↔anúncio que ainda não existe — e inventar um rateio seria pior
  // que informar a verdade no nível em que ela é conhecida.
  sumSpendByChannel(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date,
    dataMode?: AppDataMode,
  ): Promise<AdsSpendByChannel[]>;
}
