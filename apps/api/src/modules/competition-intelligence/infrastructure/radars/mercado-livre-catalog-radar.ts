import { Injectable, Logger } from '@nestjs/common';
import {
  CompetitionFetchContext,
  CompetitionRadar,
  RadarHealthStatus,
  RawCompetitorOffer,
} from '../../../../shared/contracts/competition-radar.contract';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../marketplace-intelligence/application/mercado-livre-connection.service';

// Radar de concorrência REAL do Mercado Livre (01/08/2026, ver
// docs/revisao-geral-2026-08.md, §4).
//
// POR QUE ELE EXISTE: até esta data o módulo Competition Intelligence tinha
// exatamente UMA implementação de radar — ManualSheetRadar — que devolve
// lista vazia por não ter import de planilha construído. Como o
// PricingDecisionService só decide quando existe `bestCompetitorPrice`, o
// efeito prático era que **todo o loop de repricing dependia de alguém
// preencher uma planilha à mão**. O motor estava correto e testado, mas sem
// combustível.
//
// FONTE: API pública de catálogo do Mercado Livre, sem OAuth
// (developers.mercadolivre.com.br/pt_br/catalogo-competicao). Isso importa:
// é o que torna o radar utilizável hoje, sem depender do fluxo de
// autorização por vendedor que ainda não está implementado — e sem
// scraping, que é frágil e pode ferir os termos de uso.
//
// `targetRef` (de MonitoredCompetitorListing) aceita as duas formas que o
// usuário tem à mão, porque exigir que ele saiba a diferença entre "id de
// anúncio" e "id de produto de catálogo" seria transferir um detalhe da API
// para dentro do cadastro:
//   - id de PRODUTO de catálogo (ex.: MLB19151277) — caminho direto;
//   - id de ANÚNCIO (ex.: MLB3456789012) — o radar descobre a qual produto
//     pertence e então lista os concorrentes.
//
// Incidente PolicyAgent (25/11/2026) e limitação conhecida: desde então o
// caminho PRIMÁRIO (quando o listing tem canal vinculado) é
// GET /items/{id}/price_to_win — decisão do Gui (ver conversa do incidente)
// de priorizar destravar a funcionalidade principal (ganhando/perdendo +
// preço-alvo) sem custo e sem pausar o radar. Essa troca tem um trade-off
// conhecido e aceito: price_to_win NÃO lista todos os concorrentes de um
// produto (só o vencedor atual), diferente do /products/:id/items antigo —
// por isso o caminho antigo continua no código (resolveCatalogProductId +
// fetchCatalogProduct/fetchCatalogProductItems) como fallback e como base
// do endpoint sob demanda de "ver todos os concorrentes" (fora do ciclo
// automático — é o volume do ciclo automático, não o endpoint em si, que
// disparou o bloqueio).
@Injectable()
export class MercadoLivreCatalogRadar implements CompetitionRadar {
  readonly code = 'MERCADO_LIVRE_CATALOG_V1';
  readonly sourceType = 'PARTNER_API' as const;

  private readonly logger = new Logger(MercadoLivreCatalogRadar.name);

  constructor(
    private readonly client: MercadoLivreApiClient,
    private readonly connections: MercadoLivreConnectionService,
  ) {}

  async fetchOffers(ctx: CompetitionFetchContext): Promise<RawCompetitorOffer[]> {
    const targetRef = ctx.targetRef?.trim();
    if (!targetRef) return [];

    // Bug de produção (19/09/2026): /products, /products/:id/items e
    // /items/:id são documentados como públicos, mas o Mercado Livre passou
    // a responder 403 para chamada anônima (ver mercado-livre-api.client.ts
    // para o histórico completo). Reaproveita o token OAuth2 já conectado
    // do tenant — não precisa ser o dono do anúncio específico, só um token
    // válido. Sem conexão ativa, segue sem token (comportamento anterior) e
    // deixa o 403 real aparecer no log, em vez de falhar aqui.
    const accessToken = await this.connections.getValidAccessToken(ctx.tenantId).catch((error) => {
      this.logger.warn(
        `SKU ${ctx.skuCode} (tenant ${ctx.tenantId}): não foi possível obter token do Mercado Livre para o radar de catálogo — seguindo sem autenticação (pode retornar 403). ${(error as Error).message}`,
      );
      return undefined;
    });

    // Incidente PolicyAgent (25/11/2026, ver comentário de
    // MAX_CONSECUTIVE_FAILURES em competition-monitor-orchestrator.service.ts):
    // /products/:id/items (abaixo, caminho antigo) lista TODOS os concorrentes
    // de um produto — exatamente o padrão de "varredura em lote" que o
    // Mercado Livre passou a bloquear com 403 (PA_UNAUTHORIZED_RESULT_FROM_POLICIES)
    // quando chamado em massa (1748 listings x ciclo de 10min). GET
    // /items/{id}/price_to_win é escopado a UM anúncio nosso — não enumera
    // concorrentes, só devolve se estamos ganhando/perdendo e o preço-alvo —
    // por isso é o caminho PRIMÁRIO agora, sempre que o listing tem canal
    // vinculado, usando `targetRef` (o próprio anúncio monitorado, não um
    // anúncio "representante" do SKU — ver bug corrigido em
    // tryFetchViaPriceToWin) como item id. Preserva o caminho antigo só como
    // fallback de chamada INCONCLUSIVA do price_to_win (erro de rede, auth,
    // 5xx) — não é mais tentado quando o price_to_win responde normalmente
    // sem preço utilizável, porque nesse caso a resposta já é definitiva e o
    // caminho antigo está bloqueado (403 garantido, ver
    // tryFetchViaPriceToWin). Não foi removido porque ainda alimenta a lista
    // completa de concorrentes sob demanda (ver endpoint dedicado, fora do
    // ciclo automático).
    if (ctx.channelCode && accessToken) {
      const viaPriceToWin = await this.tryFetchViaPriceToWin(ctx, targetRef, accessToken);
      // `null` = inconclusivo (price_to_win não pôde ser tentado ou falhou
      // na chamada) — cai para o caminho antigo abaixo. Um array (mesmo
      // vazio) = resposta DEFINITIVA do price_to_win — não cai, ver
      // comentário em tryFetchViaPriceToWin.
      if (viaPriceToWin !== null) return viaPriceToWin;
    }

    const productId = await this.resolveCatalogProductId(targetRef, ctx.skuCode, accessToken);
    if (!productId) return [];

    const [product, items] = await Promise.all([
      this.client.fetchCatalogProduct(productId, accessToken).catch(() => null),
      this.client.fetchCatalogProductItems(productId, accessToken),
    ]);

    const winnerItemId = product?.buy_box_winner?.item_id ?? null;
    const collectedAt = new Date();

    return items
      // Item sem preço não é oferta comparável — descartar é mais honesto
      // que assumir zero, que viraria "concorrente de graça" e puxaria
      // qualquer decisão de preço para o piso.
      .filter((item) => typeof item.price === 'number' && item.price > 0)
      .map((item) => ({
        // O ML não expõe o NOME do vendedor neste endpoint público, só o
        // seller_id. Usar o id é menos legível, mas é o dado real — inventar
        // um rótulo amigável seria pior.
        competitorLabel: item.seller_id ? `Vendedor ${item.seller_id}` : item.item_id,
        price: item.price as number,
        // `winner` vem em algumas respostas; quando não vem, comparar com o
        // buy_box_winner do produto cobre o caso.
        isBuyBoxWinner: item.winner === true || (winnerItemId !== null && item.item_id === winnerItemId),
        collectedAt,
        sourceEvidenceRef: `https://api.mercadolibre.com/products/${productId}/items`,
      }));
  }

  // Caminho primário (25/11/2026, ver comentário acima em fetchOffers).
  //
  // Bug corrigido (26/11/2026, achado investigando por que o disjuntor por
  // tenant — ver competition-monitor-orchestrator.service.ts — continuava
  // sendo acionado para o TENANT REAL mesmo depois de isolado por tenant):
  // esta função resolvia "nosso anúncio" com
  // `channelListings.findBySku(tenantId, channelCode, skuCode)` — por SKU,
  // não pelo `targetRef` desta listagem monitorada específica. Para SKU com
  // UM anúncio só isso é inofensivo (coincide), mas vários SKUs reais têm
  // MÚLTIPLOS anúncios próprios no Mercado Livre para o mesmo produto
  // (ex.: RM0021 tem 8 anúncios ML distintos monitorados) — e
  // `findBySku` sempre devolve o MESMO (um) anúncio "representante" do SKU.
  // Resultado: toda vez que o orchestrator chamava `fetchOffers` para
  // qualquer um dos OUTROS 7 anúncios de RM0021, o price_to_win era
  // consultado para o anúncio errado (sempre o mesmo), e os outros 7
  // caíam, um por um, no caminho antigo — que está bloqueado (403) desde o
  // incidente PolicyAgent. É exatamente isso que fazia o disjuntor do
  // tenant real estourar quase todo ciclo: não era falha genuína do
  // price_to_win, era ele nunca sendo tentado para o anúncio certo.
  //
  // Fix: usa `targetRef` (o próprio anúncio desta listagem monitorada, já
  // resolvido por quem chama) diretamente como item id — sem round-trip
  // nenhum pelo SKU. Cada anúncio monitorado agora consulta price_to_win
  // para SI MESMO.
  private async tryFetchViaPriceToWin(ctx: CompetitionFetchContext, itemId: string, accessToken: string): Promise<RawCompetitorOffer[] | null> {
    try {
      const result = await this.client.fetchPriceToWin(itemId, accessToken);
      const competitorPrice = result.priceToWin ?? result.winnerPrice;
      if (competitorPrice == null || competitorPrice <= 0) {
        // Resposta sem preço utilizável (ex.: anúncio fora do catálogo,
        // `status` null) — não é erro, é uma resposta DEFINITIVA do
        // price_to_win (endpoint seguro, nunca bloqueado pelo PolicyAgent):
        // este anúncio não está disputando Buy Box agora.
        this.logger.warn(
          `SKU ${ctx.skuCode}: price_to_win respondeu para o anúncio ${itemId} mas sem preço utilizável (status=${result.status ?? 'null'}, ` +
            `priceToWin=${result.priceToWin ?? 'null'}, winnerPrice=${result.winnerPrice ?? 'null'}, ` +
            `reasons=${result.reasons?.length ? result.reasons.join(',') : 'null'}) — sem oferta a registrar (não cai mais para o caminho antigo, ver abaixo). ` +
            // 25/11/2026-26/11/2026: `status: "not_listed"` não é documentado
            // pela API. Em produção já vimos DUAS causas distintas por trás
            // dele, não uma só — a nota anterior deste comentário ("sempre é
            // estoque") estava incompleta: (1) estoque zerado geral (RM0005)
            // ou zerado no depósito "Full Mercado Livre" com saldo geral
            // positivo (RM0043, confirmado reativando o anúncio em
            // produção); (2) `reasons: ["item_not_opted_in"]` — anúncio que
            // simplesmente não está inscrito na competição de catálogo
            // daquele produto, sem relação com estoque (visto em RM0021 e
            // outros SKUs com múltiplos anúncios ML). Não assumir estoque
            // sem olhar `reasons` primeiro.
            'Ver reasons acima para a causa específica deste anúncio.',
        );
        // Não cai para o caminho antigo aqui (26/11/2026): `/products/:id/items`
        // está bloqueado (403) pelo PolicyAgent desde o incidente original e
        // NUNCA teria sucesso — cair nele só queima o orçamento do disjuntor
        // por tenant (MAX_CONSECUTIVE_FAILURES) sem chance nenhuma de dar
        // certo. O price_to_win já deu uma resposta definitiva: sem oferta.
        return [];
      }

      const isWinning = result.status === 'winning' || result.status === 'sharing_first_place';
      // price_to_win não lista TODOS os concorrentes (ver limitação
      // conhecida registrada no comentário de topo deste arquivo) — só o
      // preço-alvo e, quando existe, o id do anúncio vencedor. Sintetiza UMA
      // oferta a partir disso: é o suficiente para calculateOpportunity()
      // decidir ganhando/perdendo e o gap de preço, que é o que a tela de
      // Oportunidades realmente usa.
      return [
        {
          competitorLabel:
            result.winnerItemId && result.winnerItemId !== itemId ? `Concorrente (anúncio ${result.winnerItemId})` : 'Concorrência (price_to_win)',
          price: competitorPrice,
          isBuyBoxWinner: !isWinning,
          collectedAt: new Date(),
          sourceEvidenceRef: `https://api.mercadolibre.com/items/${itemId}/price_to_win`,
        },
      ];
    } catch (error) {
      // Erro de fato na chamada (rede, auth, 5xx, rate limit) — inconclusivo,
      // diferente do caso acima. Aqui sim vale cair para o caminho antigo:
      // pode ser falha transitória do price_to_win, não uma resposta
      // definitiva de que não há concorrência.
      this.logger.warn(`SKU ${ctx.skuCode}: price_to_win falhou para o anúncio ${itemId}, caindo para o caminho antigo: ${(error as Error).message}`);
      return null;
    }
  }

  // Aceita id de produto ou de anúncio. Tenta produto primeiro (caminho
  // direto e mais barato); se falhar, trata como anúncio e busca o produto
  // ao qual ele pertence.
  private async resolveCatalogProductId(targetRef: string, skuCode: string, accessToken?: string): Promise<string | null> {
    try {
      await this.client.fetchCatalogProduct(targetRef, accessToken);
      return targetRef;
    } catch {
      // Não é um produto de catálogo — segue para a interpretação de anúncio.
    }

    try {
      const item = await this.client.fetchItem(targetRef, accessToken);
      if (!item.catalog_product_id) {
        // Anúncio fora do catálogo não disputa Buy Box com ninguém: não há
        // concorrência a medir. Log explícito para o usuário entender por
        // que aquele SKU nunca gera oportunidade, em vez de silêncio.
        this.logger.warn(
          `SKU ${skuCode}: anúncio ${targetRef} não pertence a nenhum produto de catálogo do Mercado Livre — ` +
            'sem Buy Box para disputar, nenhuma oferta concorrente a coletar.',
        );
        return null;
      }
      return item.catalog_product_id;
    } catch (error) {
      this.logger.error(
        `SKU ${skuCode}: não foi possível resolver ${targetRef} nem como produto de catálogo nem como anúncio ` +
          `do Mercado Livre: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // Bate num produto de catálogo conhecido e estável para verificar se a
  // API pública está respondendo — mesmo racional do healthCheck do
  // MercadoLivreFeeRuleProvider, que usa fetchTopLevelCategories.
  async healthCheck(): Promise<RadarHealthStatus> {
    try {
      await this.client.fetchTopLevelCategories();
      return { status: 'UP' };
    } catch (error) {
      return { status: 'DOWN', message: (error as Error).message };
    }
  }
}
