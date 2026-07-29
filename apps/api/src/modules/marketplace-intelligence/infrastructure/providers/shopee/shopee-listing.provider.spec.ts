import { ShopeeListingProvider } from './shopee-listing.provider';
import { ShopeeApiClient } from './shopee-api-client';
import { ShopeeConnectionService } from '../../../application/shopee-connection.service';

describe('ShopeeListingProvider (Fase 4, Publicar anúncio novo em marketplace)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, SHOPEE_PARTNER_ID: 'partner-1', SHOPEE_PARTNER_KEY: 'chave-secreta' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function buildProvider() {
    const client = {
      getCategoryList: jest.fn(),
      getCategoryAttributes: jest.fn(),
      uploadImage: jest.fn(),
      addItem: jest.fn(),
    } as unknown as jest.Mocked<ShopeeApiClient>;
    const connection = {
      getValidAccessToken: jest.fn(),
      getShopId: jest.fn(),
    } as unknown as jest.Mocked<ShopeeConnectionService>;
    const provider = new ShopeeListingProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara as capacidades CATEGORY_DISCOVERY e LISTING_CREATE e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('SHOPEE');
    expect(provider.capabilities).toContain('CATEGORY_DISCOVERY');
    expect(provider.capabilities).toContain('LISTING_CREATE');
  });

  describe('searchCategories', () => {
    it('busca a árvore inteira e filtra por substring do nome (case-insensitive)', async () => {
      const { provider, client } = buildProvider();
      client.getCategoryList.mockResolvedValue([
        { category_id: 1, category_name: 'Celulares e Acessórios', parent_category_id: 0 },
        { category_id: 2, category_name: 'Roupas', parent_category_id: 0 },
      ]);

      const result = await provider.searchCategories({ marketplaceCode: 'SHOPEE' }, 'celular');

      expect(result).toEqual([{ externalCategoryId: '1', name: 'Celulares e Acessórios' }]);
    });
  });

  describe('getCategoryAttributes', () => {
    it('mapeia is_mandatory para o campo `required` normalizado', async () => {
      const { provider, client } = buildProvider();
      client.getCategoryAttributes.mockResolvedValue([{ attribute_id: 10, original_attribute_name: 'Marca', is_mandatory: true }]);

      const result = await provider.getCategoryAttributes({ marketplaceCode: 'SHOPEE' }, '1');

      expect(result).toEqual([{ name: 'Marca', required: true }]);
    });
  });

  describe('createListing', () => {
    const input = {
      title: 'Produto X',
      externalCategoryId: '1',
      price: 100,
      currency: 'BRL',
      availableQuantity: 5,
      pictureUrls: ['https://cdn.example.com/foto.jpg'],
      weightKg: 1,
      attributes: { Marca: 'Genérica' },
    };

    it('sem tenantId: devolve success false sem chamar nada', async () => {
      const { provider, client } = buildProvider();
      const result = await provider.createListing({ marketplaceCode: 'SHOPEE' }, input);
      expect(result.success).toBe(false);
      expect(client.addItem).not.toHaveBeenCalled();
    });

    it('sem loja conectada: devolve success false com mensagem explicativa', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue(null);

      const result = await provider.createListing({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, input);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Nenhuma loja Shopee conectada/);
      expect(client.addItem).not.toHaveBeenCalled();
    });

    it('resolve token/loja, faz upload da imagem, resolve attribute_id por nome e cria o item', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.uploadImage.mockResolvedValue('image-id-1');
      client.getCategoryAttributes.mockResolvedValue([{ attribute_id: 10, original_attribute_name: 'Marca', is_mandatory: true }]);
      client.addItem.mockResolvedValue({ item_id: '999' });

      const result = await provider.createListing({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, input);

      expect(client.uploadImage).toHaveBeenCalledWith('partner-1', 'chave-secreta', 'shop-1', 'token-valido', input.pictureUrls[0]);
      expect(client.addItem).toHaveBeenCalledWith(
        'partner-1',
        'chave-secreta',
        'shop-1',
        'token-valido',
        expect.objectContaining({
          item_name: 'Produto X',
          category_id: 1,
          image_id_list: ['image-id-1'],
          attribute_list: [{ attribute_id: 10, attribute_value_list: [{ value: 'Genérica' }] }],
        }),
      );
      expect(result).toEqual({ success: true, externalListingId: '999' });
    });

    it('atributo sem correspondência na categoria é descartado (nunca falha a publicação por isso)', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.uploadImage.mockResolvedValue('image-id-1');
      client.getCategoryAttributes.mockResolvedValue([]); // nenhum atributo reconhecido na categoria
      client.addItem.mockResolvedValue({ item_id: '999' });

      const result = await provider.createListing({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, input);

      expect(client.addItem).toHaveBeenCalledWith('partner-1', 'chave-secreta', 'shop-1', 'token-valido', expect.objectContaining({ attribute_list: [] }));
      expect(result.success).toBe(true);
    });

    it('falha do client (ex.: HTTP não-ok): devolve success false com a mensagem do erro, nunca lança', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.uploadImage.mockRejectedValue(new Error('Falha ao baixar imagem'));

      const result = await provider.createListing({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, input);

      expect(result).toEqual({ success: false, message: 'Falha ao baixar imagem' });
    });
  });
});
