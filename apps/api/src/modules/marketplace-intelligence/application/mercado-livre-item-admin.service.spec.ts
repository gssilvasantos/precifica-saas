import { MercadoLivreItemAdminService } from './mercado-livre-item-admin.service';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreApiClient, MlItemDetail } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';

function buildDetail(overrides: Partial<MlItemDetail> = {}): MlItemDetail {
  return {
    id: 'MLB111',
    title: 'Item de teste',
    price: 99.9,
    permalink: 'https://produto.mercadolivre.com.br/MLB111',
    status: 'active',
    categoryId: 'MLB1234',
    skuCode: null,
    isCatalogListing: false,
    catalogProductId: null,
    attributes: [],
    ...overrides,
  };
}

describe('MercadoLivreItemAdminService', () => {
  function buildService() {
    const connections = {
      getValidAccessToken: jest.fn().mockResolvedValue('token-valido'),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;

    const client = {
      fetchItemDetail: jest.fn(),
      updateItemSellerSku: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;

    const service = new MercadoLivreItemAdminService(connections, client);
    return { service, connections, client };
  }

  describe('getItem', () => {
    it('resolve o access token do tenant e delega ao client', async () => {
      const { service, connections, client } = buildService();
      client.fetchItemDetail.mockResolvedValue(buildDetail());

      const result = await service.getItem('tenant-1', 'MLB111');

      expect(connections.getValidAccessToken).toHaveBeenCalledWith('tenant-1');
      expect(client.fetchItemDetail).toHaveBeenCalledWith('MLB111', 'token-valido');
      expect(result.id).toBe('MLB111');
    });
  });

  describe('updateItemSku', () => {
    it('rejeita SKU vazio (ou só espaço) sem chamar a API', async () => {
      const { service, client } = buildService();

      await expect(service.updateItemSku('tenant-1', 'MLB111', '   ')).rejects.toThrow('skuCode não pode ser vazio');
      expect(client.fetchItemDetail).not.toHaveBeenCalled();
      expect(client.updateItemSellerSku).not.toHaveBeenCalled();
    });

    it('lê o item antes (auditoria), aplica trim, e escreve o novo SKU', async () => {
      const { service, client } = buildService();
      client.fetchItemDetail.mockResolvedValue(buildDetail({ skuCode: 'SKU-ANTIGO' }));
      client.updateItemSellerSku.mockResolvedValue(buildDetail({ skuCode: 'SKU-NOVO' }));

      const result = await service.updateItemSku('tenant-1', 'MLB111', '  SKU-NOVO  ');

      expect(client.fetchItemDetail).toHaveBeenCalledWith('MLB111', 'token-valido');
      expect(client.updateItemSellerSku).toHaveBeenCalledWith('MLB111', 'token-valido', 'SKU-NOVO');
      expect(result.skuCode).toBe('SKU-NOVO');
    });

    it('propaga o erro quando a escrita no Mercado Livre falha', async () => {
      const { service, client } = buildService();
      client.fetchItemDetail.mockResolvedValue(buildDetail({ skuCode: null }));
      client.updateItemSellerSku.mockRejectedValue(new Error('Mercado Livre PUT /items/MLB111 (SELLER_SKU) retornou HTTP 403'));

      await expect(service.updateItemSku('tenant-1', 'MLB111', 'SKU-NOVO')).rejects.toThrow('HTTP 403');
    });
  });
});
