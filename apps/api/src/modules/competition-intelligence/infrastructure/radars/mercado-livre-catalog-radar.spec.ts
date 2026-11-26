import { MercadoLivreCatalogRadar } from './mercado-livre-catalog-radar';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../marketplace-intelligence/application/mercado-livre-connection.service';
import { ChannelListingReader } from '../../../../shared/contracts/channel-listing-reader.port';

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

  // Incidente PolicyAgent (25/11/2026) — por padrão sem canal vinculado
  // (findBySku resolve null), então os testes existentes continuam
  // exercitando o caminho antigo (/products/:id/items) sem mudança de
  // comportamento. Os testes do caminho novo (price_to_win) sobrescrevem
  // findBySku e passam channelCode no ctx.
  function buildChannelListings(overrides: Partial<jest.Mocked<ChannelListingReader>> = {}) {
    return {
      findBySku: jest.fn().mockResolvedValue(null),
      findSkusByExternalIds: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<ChannelListingReader>;
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

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers(ctx);

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

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers(ctx);

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

    const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers(ctx);

    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe(50);
  });

  // Incidente PolicyAgent (25/11/2026) — caminho primário quando o listing
  // tem canal vinculado: resolve o anúncio NOSSO via ChannelListingReader e
  // usa GET /items/{id}/price_to_win em vez de /products/:id/items (que foi
  // bloqueado em massa). Ver comentário de topo deste arquivo.
  describe('price_to_win (caminho primário, listing com canal vinculado)', () => {
    const ctxComCanal = { ...ctx, channelCode: 'MERCADO_LIVRE' };

    it('usa price_to_win quando o listing tem canal vinculado e devolve o anúncio-vencedor como oferta', async () => {
      const channelListings = buildChannelListings({
        findBySku: jest.fn().mockResolvedValue({ channelCode: 'MERCADO_LIVRE', externalId: 'MLB999', currentPrice: 100, url: null }),
      });
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

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), channelListings).fetchOffers(ctxComCanal);

      expect(client.fetchPriceToWin).toHaveBeenCalledWith('MLB999', MOCK_ACCESS_TOKEN);
      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled(); // não cai no caminho antigo
      expect(offers).toEqual([
        expect.objectContaining({ price: 95, isBuyBoxWinner: true, competitorLabel: 'Concorrente (anúncio MLB222)' }),
      ]);
    });

    it('status winning gera oferta com isBuyBoxWinner=false (nós somos o vencedor, não o concorrente sintetizado)', async () => {
      const channelListings = buildChannelListings({
        findBySku: jest.fn().mockResolvedValue({ channelCode: 'MERCADO_LIVRE', externalId: 'MLB999', currentPrice: 100, url: null }),
      });
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockResolvedValue({
          status: 'winning',
          priceToWin: 100,
          currentPrice: 100,
          catalogProductId: 'MLB1',
          reasons: [],
          winnerItemId: 'MLB999',
          winnerPrice: 100,
        }),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), channelListings).fetchOffers(ctxComCanal);

      expect(offers).toEqual([expect.objectContaining({ price: 100, isBuyBoxWinner: false })]);
    });

    it('sem canal vinculado (findBySku null) cai no caminho antigo', async () => {
      const channelListings = buildChannelListings(); // findBySku -> null por padrão
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), channelListings).fetchOffers(ctxComCanal);

      expect(client.fetchPriceToWin).not.toHaveBeenCalled();
      expect(client.fetchCatalogProductItems).toHaveBeenCalled();
      expect(offers).toHaveLength(1);
    });

    it('price_to_win falhando (erro de rede) cai no caminho antigo em vez de propagar o erro', async () => {
      const channelListings = buildChannelListings({
        findBySku: jest.fn().mockResolvedValue({ channelCode: 'MERCADO_LIVRE', externalId: 'MLB999', currentPrice: 100, url: null }),
      });
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockRejectedValue(new Error('Mercado Livre GET /items/MLB999/price_to_win retornou HTTP 403')),
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), channelListings).fetchOffers(ctxComCanal);

      expect(client.fetchCatalogProductItems).toHaveBeenCalled();
      expect(offers).toHaveLength(1);
    });

    it('resposta sem preço utilizável (priceToWin e winnerPrice nulos) cai no caminho antigo', async () => {
      const channelListings = buildChannelListings({
        findBySku: jest.fn().mockResolvedValue({ channelCode: 'MERCADO_LIVRE', externalId: 'MLB999', currentPrice: 100, url: null }),
      });
      const client = buildClient({
        fetchPriceToWin: jest.fn().mockResolvedValue({
          status: null,
          priceToWin: null,
          currentPrice: null,
          catalogProductId: null,
          reasons: [],
          winnerItemId: null,
          winnerPrice: null,
        }),
        fetchCatalogProduct: jest.fn().mockResolvedValue({ id: 'MLB19151277', buy_box_winner: null }),
        fetchCatalogProductItems: jest.fn().mockResolvedValue([{ item_id: 'MLB1', seller_id: 1, price: 10 }]),
      });

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), channelListings).fetchOffers(ctxComCanal);

      expect(offers).toHaveLength(1); // veio do caminho antigo
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

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers({
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

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers(ctx);

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled();
    });

    it('alvo irresolúvel devolve vazio em vez de derrubar o ciclo de monitoramento', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockRejectedValue(new Error('500')),
        fetchItem: jest.fn().mockRejectedValue(new Error('500')),
      });

      await expect(new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers(ctx)).resolves.toEqual([]);
    });

    it('targetRef vazio não chama a API', async () => {
      const client = buildClient();

      const offers = await new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).fetchOffers({ ...ctx, targetRef: '  ' });

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProduct).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('UP quando a API pública responde', async () => {
      const radar = new MercadoLivreCatalogRadar(buildClient(), buildConnections(), buildChannelListings());
      await expect(radar.healthCheck()).resolves.toEqual({ status: 'UP' });
    });

    it('DOWN com a mensagem real do erro', async () => {
      const client = buildClient({
        fetchTopLevelCategories: jest.fn().mockRejectedValue(new Error('timeout')),
      });

      await expect(new MercadoLivreCatalogRadar(client, buildConnections(), buildChannelListings()).healthCheck()).resolves.toEqual({
        status: 'DOWN',
        message: 'timeout',
      });
    });
  });
});
