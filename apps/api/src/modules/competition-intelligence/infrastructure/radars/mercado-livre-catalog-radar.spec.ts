import { MercadoLivreCatalogRadar } from './mercado-livre-catalog-radar';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../marketplace-intelligence/application/mercado-livre-connection.service';

// Radar REAL de concorrência (01/08/2026, docs/revisao-geral-2026-08.md §4)
// — antes dele, todo o loop de repricing dependia de planilha manual.
describe('MercadoLivreCatalogRadar', () => {
  function buildClient(overrides: Partial<jest.Mocked<MercadoLivreApiClient>> = {}) {
    return {
      fetchCatalogProduct: jest.fn(),
      fetchCatalogProductItems: jest.fn().mockResolvedValue([]),
      fetchItem: jest.fn(),
      fetchPriceToWin: jest.fn(),
      fetchTopLevelCategories: jest.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as jest.Mocked<MercadoLivreApiClient>;
  }

  // Bug de producao (19/09/2026, ver mercado-livre-api.client.ts): o radar
  // agora sempre busca o token OAuth2 do tenant antes de chamar a API de
  // catalogo (publica, mas passou a responder 403 sem Authorization).
  const MOCK_ACCESS_TOKEN = 'mock-access-token';
  function buildConnections() {
    return {
      getValidAccessToken: jest.fn().mockResolvedValue(MOCK_ACCESS_TOKEN),
    } as unknown as MercadoLivreConnectionService;
  }

  const ctx = { tenantId: 'tenant-1', skuCode: 'SKU-001', targetRef: 'MLB19151277' };

  it('coleta as ofertas concorrentes de um produto de catálogo', async () => {
    const client = buildClient({
      fetchCatalogProduct: jest.fn().mockResolvedValue({
        id: 'MLB19151277',
        buy_box_winner: { item_id: 'MLB111', seller_id: 111, price: 89.9 },
      }),
      fetchCatalogProductItems: jest.fn().mockResolvedValue([
        { item_id: 'MLB111', seller_id: 111, price: 89.9 },
        { item_id: 'MLB222', seller_id: 222, price: 95.5 },
      ]),
    });

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx);

    expect(offers).toHaveLength(2);
    expect(offers[0].price).toBe(89.9);
    expect(offers[0].isBuyBoxWinner).toBe(true);
    expect(offers[1].isBuyBoxWinner).toBe(false);
  });

  it('marca o vencedor pelo campo `winner` quando a resposta o traz', async () => {
    const client = buildClient({
      fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB1', buy_box_winner: null }),
      fetchCatalogProductItems: jest
        .fn()
        .mockResolvedValue([{ item_id: 'MLB222', seller_id: 222, price: 95.5, winner: true }]),
    });

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx);

    expect(offers[0].isBuyBoxWinner).toBe(true);
  });

  it('descarta oferta sem preço em vez de tratar como R$0', async () => {
    // Assumir zero criaria um "concorrente de graça" que puxaria qualquer
    // decisão de preço para o piso — o oposto do que o radar existe para
    // fazer.
    const client = buildClient({
      fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB1' }),
      fetchCatalogProductItems: jest.fn().mockResolvedValue([
        { item_id: 'MLB111', seller_id: 111 },
        { item_id: 'MLB222', seller_id: 222, price: 0 },
        { item_id: 'MLB333', seller_id: 333, price: 50 },
      ]),
    });

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx);

    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe(50);
  });

  // Incidente PolicyAgent (25/11/2026) — caminho primário quando o listing
  // tem canal vinculado: usa GET /items/{id}/price_to_win em vez de
  // /products/:id/items (que foi bloqueado em massa). Ver comentário de
  // topo deste arquivo.
  //
  // Bug corrigido (26/11/2026): o item id usado é `targetRef` (o próprio
  // anúncio desta listagem monitorada) — NÃO mais resolvido por
  // ChannelListingReader.findBySku(tenantId, channelCode, skuCode), que
  // devolvia sempre o MESMO anúncio "representante" do SKU mesmo quando o
  // SKU tinha vários anúncios monitorados separadamente (ex.: RM0021 com 8
  // anúncios ML distintos) — fazendo os outros caírem, incorretamente, no
  // caminho antigo bloqueado.
  describe('price_to_win (caminho primário, listing com canal vinculado)', () => {
    const ctxComCanal = { ...ctx, channelCode: 'MERCADO_LIVRE' };

    it('usa price_to_win com o targetRef da própria listagem monitorada e devolve o anúncio-vencedor como oferta', async () => {
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockResolvedValue({
          status: 'competing',
          priceToWin: 95,
          currentPrice: 100,
          catalogProductId: 'MLB1',
          reasons: [],
          winnerItemId: 'MLB222',
          winnerPrice: 95,
        }),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctxComCanal);

      // targetRef do ctx (MLB19151277) é usado diretamente — sem nenhum
      // round-trip por SKU.
      expect(client.fetchPriceToWin).toHaveBeenCalledWith('MLB19151277', MOCK_ACCESS_TOKEN);
      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled(); // não cai no caminho antigo
      expect(offers).toEqual([
        expect.objectContaining({ price: 95, isBuyBoxWinner: true, competitorLabel: 'Concorrente (anúncio MLB222)' }),
      ]);
    });

    it('status winning gera oferta com isBuyBoxWinner=false (nós somos o vencedor, não o concorrente sintetizado)', async () => {
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockResolvedValue({
          status: 'winning',
          priceToWin: 100,
          currentPrice: 100,
          catalogProductId: 'MLB1',
          reasons: [],
          winnerItemId: 'MLB19151277',
          winnerPrice: 100,
        }),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctxComCanal);

      expect(offers).toEqual([expect.objectContaining({ price: 100, isBuyBoxWinner: false })]);
    });

    it('sem channelCode no listing cai direto no caminho antigo (price_to_win nunca tentado)', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      // ctx sem channelCode (o `ctx` base, não o `ctxComCanal`).
      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx);

      expect(client.fetchPriceToWin).not.toHaveBeenCalled();
      expect(client.fetchCatalogProductItems).toHaveBeenCalled();
      expect(offers).toHaveLength(1);
    });

    it('price_to_win falhando (erro de rede, inconclusivo) cai no caminho antigo em vez de propagar o erro', async () => {
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockRejectedValue(new Error('Mercado Livre GET /items/MLB19151277/price_to_win retornou HTTP 403')),
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctxComCanal);

      expect(client.fetchCatalogProductItems).toHaveBeenCalled();
      expect(offers).toHaveLength(1);
    });

    // Bug corrigido (26/11/2026, achado monitorando o disjuntor por tenant
    // estourar quase todo ciclo para o tenant real): uma resposta NORMAL do
    // price_to_win sem preço utilizável (ex.: status "not_listed",
    // reasons=["item_not_opted_in"]) é uma resposta DEFINITIVA — o anúncio
    // não está disputando Buy Box agora. Cair no caminho antigo depois
    // disso é inútil: ele está bloqueado (403) pelo PolicyAgent e nunca
    // teria sucesso, só queima o orçamento do disjuntor por tenant
    // (MAX_CONSECUTIVE_FAILURES) sem chance nenhuma de dar certo.
    it('resposta sem preço utilizável (priceToWin e winnerPrice nulos) NÃO cai mais no caminho antigo — devolve vazio', async () => {
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockResolvedValue({
          status: 'not_listed',
          priceToWin: null,
          currentPrice: null,
          catalogProductId: null,
          reasons: ['item_not_opted_in'],
          winnerItemId: null,
          winnerPrice: null,
        }),
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctxComCanal);

      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled(); // caminho antigo bloqueado, nem tenta
      expect(offers).toEqual([]);
    });
  });

  describe('resolução do alvo monitorado', () => {
    it('aceita id de ANÚNCIO e descobre o produto de catálogo dele', async () => {
      const client = buildClient({
        // Primeira chamada (como produto) falha; segunda (item) resolve.
        fetchCatalogProduct: jest
          .fn()
          .mockRejectedValueOnce(new Error('404'))
          .mockResolvedValue({ id: 'MLB999', buy_box_winner: null }),
        fetchItem: jest.fn().mockResolvedValue({ id: 'MLB3456789012', catalog_product_id: 'MLB999' }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers({
        ...ctx,
        targetRef: 'MLB3456789012',
      });

      expect(client.fetchItem).toHaveBeenCalledWith('MLB3456789012', MOCK_ACCESS_TOKEN);
      expect(client.fetchCatalogProductItems).toHaveBeenCalledWith('MLB999', MOCK_ACCESS_TOKEN);
      expect(offers).toHaveLength(1);
    });

    it('anúncio fora do catálogo devolve vazio — não há Buy Box para disputar', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockRejectedValue(new Error('404')),
        fetchItem: jest.fn().mockResolvedValue({ id: 'MLB123', catalog_product_id: null }),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx);

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled();
    });

    it('alvo irresolúvel devolve vazio em vez de derrubar o ciclo de monitoramento', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockRejectedValue(new Error('500')),
        fetchItem: jest.fn().mockRejectedValue(new Error('500')),
      });

      await expect(new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers(ctx)).resolves.toEqual([]);
    });

    it('targetRef vazio não chama a API', async () => {
      const client = buildClient();

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections()).fetchOffers({ ...ctx, targetRef: '  ' });

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProduct).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('UP quando a API pública responde', async () => {
      const radar = new MercadoLivreCatalogRadar(buildClient(), buildConnections());
      await expect(radar.healthCheck()).resolves.toEqual({ status: 'UP' });
    });

    it('DOWN com a mensagem real do erro', async () => {
      const client = buildClient({
        fetchTopLevelCategories: jest.fn().mockRejectedValue(new Error('timeout')),
      });

      await expect(new MercadoLivreCatalogRadar(client, buildConnections()).healthCheck()).resolves.toEqual({
        status: 'DOWN',
        message: 'timeout',
      });
    });
  });
});
