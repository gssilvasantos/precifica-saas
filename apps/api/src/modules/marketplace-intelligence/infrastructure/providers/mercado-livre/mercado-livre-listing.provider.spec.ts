import { MercadoLivreListingProvider } from './mercado-livre-listing.provider';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

describe('MercadoLivreListingProvider (Fase 4, Publicar anúncio novo em marketplace)', () => {
  function buildProvider() {
    const client = {
      searchCategories: jest.fn(),
      getCategoryAttributes: jest.fn(),
      createItem: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;
    const connection = {
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;
    const provider = new MercadoLivreListingProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara as capacidades CATEGORY_DISCOVERY e LISTING_CREATE e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('MERCADO_LIVRE');
    expect(provider.capabilities).toContain('CATEGORY_DISCOVERY');
    expect(provider.capabilities).toContain('LISTING_CREATE');
  });

  describe('searchCategories', () => {
    it('busca no client e normaliza para ExternalCategoryCandidate', async () => {
      const { provider, client } = buildProvider();
      client.searchCategories.mockResolvedValue([{ category_id: 'MLB123', category_name: 'Celulares' }]);

      const result = await provider.searchCategories({ marketplaceCode: 'MERCADO_LIVRE' }, 'celular');

      expect(client.searchCategories).toHaveBeenCalledWith('celular');
      expect(result).toEqual([{ externalCategoryId: 'MLB123', name: 'Celulares' }]);
    });
  });

  describe('getCategoryAttributes', () => {
    it('mapeia tags.required para o campo `required` normalizado', async () => {
      const { provider, client } = buildProvider();
      client.getCategoryAttributes.mockResolvedValue([
        { id: 'BRAND', name: 'Marca', tags: { required: true } },
        { id: 'COLOR', name: 'Cor', tags: { required: false } },
      ]);

      const result = await provider.getCategoryAttributes({ marketplaceCode: 'MERCADO_LIVRE' }, 'MLB123');

      expect(result).toEqual([
        { name: 'Marca', required: true },
        { name: 'Cor', required: false },
      ]);
    });
  });

  describe('createListing', () => {
    const input = {
      title: 'Produto X',
      externalCategoryId: 'MLB123',
      price: 100,
      currency: 'BRL',
      availableQuantity: 5,
      pictureUrls: ['https://cdn.example.com/foto.jpg'],
      weightKg: 1,
      attributes: { Marca: 'Genérica' },
    };

    it('sem tenantId: devolve success false sem chamar nada', async () => {
      const { provider, client } = buildProvider();
      const result = await provider.createListing({ marketplaceCode: 'MERCADO_LIVRE' }, input);
      expect(result.success).toBe(false);
      expect(client.createItem).not.toHaveBeenCalled();
    });

    it('resolve token e cria o item, devolvendo externalListingId', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.createItem.mockResolvedValue({ id: 'MLB999' });

      const result = await provider.createListing({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, input);

      expect(client.createItem).toHaveBeenCalledWith(
        'token-valido',
        expect.objectContaining({
          title: 'Produto X',
          category_id: 'MLB123',
          attributes: [{ id: 'Marca', value_name: 'Genérica' }],
        }),
      );
      expect(result).toEqual({ success: true, externalListingId: 'MLB999' });
    });

    it('falha do client (ex.: HTTP não-ok): devolve success false com a mensagem do erro, nunca lança', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.createItem.mockRejectedValue(new Error('Mercado Livre POST /items retornou HTTP 400'));

      const result = await provider.createListing({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, input);

      expect(result).toEqual({ success: false, message: 'Mercado Livre POST /items retornou HTTP 400' });
    });
  });
});
