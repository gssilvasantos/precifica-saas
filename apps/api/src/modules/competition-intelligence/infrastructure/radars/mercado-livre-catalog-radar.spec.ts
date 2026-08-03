import { MercadoLivreCatalogRadar } from './mercado-livre-catalog-radar';
import { MercadoLivreApiClient } from '../../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';

// Radar REAL de concorrência (01/08/2026, docs/revisao-geral-2026-08.md §4)
// — antes dele, todo o loop de repricing dependia de planilha manual.
describe('MercadoLivreCatalogRadar', () => {
  function buildClient(overrides: Partial<jest.Mocked<MercadoLivreApiClient>> = {}) {
    return {
      fetchCatalogProduct: jest.fn(),
      fetchCatalogProductItems: jest.fn().mockResolvedValue([]),
      fetchItem: jest.fn(),
      fetchTopLevelCategories: jest.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as jest.Mocked<MercadoLivreApiClient>;
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

    const offers = await new MercadoLivreCatalogRadar(client).fetchOffers(ctx);

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

    const offers = await new MercadoLivreCatalogRadar(client).fetchOffers(ctx);

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

    const offers = await new MercadoLivreCatalogRadar(client).fetchOffers(ctx);

    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe(50);
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

      const offers = await new MercadoLivreCatalogRadar(client).fetchOffers({
        ...ctx,
        targetRef: 'MLB3456789012',
      });

      expect(client.fetchItem).toHaveBeenCalledWith('MLB3456789012');
      expect(client.fetchCatalogProductItems).toHaveBeenCalledWith('MLB999');
      expect(offers).toHaveLength(1);
    });

    it('anúncio fora do catálogo devolve vazio — não há Buy Box para disputar', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockRejectedValue(new Error('404')),
        fetchItem: jest.fn().mockResolvedValue({ id: 'MLB123', catalog_product_id: null }),
      });

      const offers = await new MercadoLivreCatalogRadar(client).fetchOffers(ctx);

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProductItems).not.toHaveBeenCalled();
    });

    it('alvo irresolúvel devolve vazio em vez de derrubar o ciclo de monitoramento', async () => {
      const client = buildClient({
        fetchCatalogProduct: jest.fn().mockRejectedValue(new Error('500')),
        fetchItem: jest.fn().mockRejectedValue(new Error('500')),
      });

      await expect(new MercadoLivreCatalogRadar(client).fetchOffers(ctx)).resolves.toEqual([]);
    });

    it('targetRef vazio não chama a API', async () => {
      const client = buildClient();

      const offers = await new MercadoLivreCatalogRadar(client).fetchOffers({ ...ctx, targetRef: '  ' });

      expect(offers).toEqual([]);
      expect(client.fetchCatalogProduct).not.toHaveBeenCalled();
    });
  });

  describe('healthCheck', () => {
    it('UP quando a API pública responde', async () => {
      const radar = new MercadoLivreCatalogRadar(buildClient());
      await expect(radar.healthCheck()).resolves.toEqual({ status: 'UP' });
    });

    it('DOWN com a mensagem real do erro', async () => {
      const client = buildClient({
        fetchTopLevelCategories: jest.fn().mockRejectedValue(new Error('timeout')),
      });

      await expect(new MercadoLivreCatalogRadar(client).healthCheck()).resolves.toEqual({
        status: 'DOWN',
        message: 'timeout',
      });
    });
  });
});
