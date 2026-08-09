import { Test } from '@nestjs/testing';
import { CatalogSyncWriterService } from './catalog-sync-writer.service';
import { PRODUCT_REPOSITORY } from './ports/product-repository.port';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../../shared/contracts/tokens';
import { CatalogSettingsService } from './catalog-settings.service';
import type { ProductCatalogWriteData } from '../../../shared/contracts/product-catalog-writer.port';

const DADOS_DO_SYNC: ProductCatalogWriteData = {
  tenantId: 'tenant-1',
  skuCode: 'BAT-VM-4G',
  name: 'Batom matte vermelho 4g',
  costPrice: 12.5,
  stockQuantity: 40,
  weightKg: 0.012,
  packagingWeightKg: 0.018,
  lengthCm: 9,
  widthCm: 2,
  heightCm: 2,
  photoUrls: [],
  erpSalePrice: 29.9,
  sourceSystem: 'ERP_OLIST',
  externalId: '778899',
  ncm: '3304.99.90',
  cest: '20.063.00',
  gtin: '7891234567890',
  fiscalOriginCode: 0,
};

describe('CatalogSyncWriterService — campos fiscais', () => {
  let products: { findByExternalId: jest.Mock; create: jest.Mock; update: jest.Mock };
  let service: CatalogSyncWriterService;

  beforeEach(async () => {
    products = {
      findByExternalId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'novo', ...data })),
      update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CatalogSyncWriterService,
        { provide: PRODUCT_REPOSITORY, useValue: products },
        {
          provide: SHIPPING_WEIGHT_CALCULATOR,
          useValue: {
            calculate: jest.fn().mockResolvedValue({ packedWeightKg: 0.03, cubicWeightKg: 0.01, shippingWeightKg: 0.03 }),
          },
        },
        {
          provide: CatalogSettingsService,
          useValue: { getDefaultMargins: jest.fn().mockResolvedValue({ desiredMarginPct: 20, minimumMarginPct: 8 }) },
        },
      ],
    }).compile();

    service = moduleRef.get(CatalogSyncWriterService);
  });

  const produtoExistente = (fiscais: Partial<Record<string, unknown>> = {}) => ({
    id: 'existente',
    ncm: null,
    cest: null,
    gtin: null,
    fiscalOriginCode: null,
    ...fiscais,
  });

  // O calculador de peso cubado lança quando qualquer medida é zero, e no
  // catálogo real isso é a maioria dos SKUs. Sem dimensão não existe peso
  // cubado — o peso de frete vira o peso embalado, e o produto entra.
  describe('cadastro sem dimensões', () => {
    const SEM_DIMENSOES = { ...DADOS_DO_SYNC, lengthCm: 0, widthCm: 0, heightCm: 0 };

    it('importa sem chamar o calculador de peso cubado', async () => {
      const calculator = { calculate: jest.fn() };
      const moduleRef = await Test.createTestingModule({
        providers: [
          CatalogSyncWriterService,
          { provide: PRODUCT_REPOSITORY, useValue: products },
          { provide: SHIPPING_WEIGHT_CALCULATOR, useValue: calculator },
          {
            provide: CatalogSettingsService,
            useValue: { getDefaultMargins: jest.fn().mockResolvedValue({ desiredMarginPct: 20, minimumMarginPct: 8 }) },
          },
        ],
      }).compile();

      await moduleRef.get(CatalogSyncWriterService).upsertFromExternalSource(SEM_DIMENSOES);

      expect(calculator.calculate).not.toHaveBeenCalled();
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // peso embalado = 0,012 + 0,018; sem cubagem possível.
          packedWeightKg: 0.03,
          cubicWeightKg: 0,
          shippingWeightKg: 0.03,
        }),
      );
    });

    it('preserva custo, estoque e campos fiscais do produto sem dimensão', async () => {
      await service.upsertFromExternalSource(SEM_DIMENSOES);

      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ costPrice: 12.5, stockQuantity: 40, ncm: '3304.99.90' }),
      );
    });
  });

  describe('produto novo', () => {
    it('grava os campos fiscais como vieram do ERP', async () => {
      await service.upsertFromExternalSource(DADOS_DO_SYNC);

      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ncm: '3304.99.90',
          cest: '20.063.00',
          gtin: '7891234567890',
          fiscalOriginCode: 0,
        }),
      );
    });
  });

  describe('produto existente — o sync PREENCHE LACUNA, nunca sobrescreve', () => {
    it('preenche o NCM quando o produto ainda não tem', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente());

      await service.upsertFromExternalSource(DADOS_DO_SYNC);

      expect(products.update).toHaveBeenCalledWith('existente', expect.objectContaining({ ncm: '3304.99.90' }));
    });

    // O caso que motivou a política: o cadastro do ERP costuma ser onde o NCM
    // errado nasceu. Sobrescrever apagaria a correção em silêncio, e o
    // usuário só descobriria pelo imposto.
    it('NÃO sobrescreve NCM já corrigido no Kyneti', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente({ ncm: '3305.10.00' }));

      await service.upsertFromExternalSource(DADOS_DO_SYNC);

      const payload = products.update.mock.calls[0][1];
      expect(payload).not.toHaveProperty('ncm');
    });

    it('preenche uns e preserva outros na mesma passada', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente({ ncm: '3305.10.00', gtin: '7890000000000' }));

      await service.upsertFromExternalSource(DADOS_DO_SYNC);

      const payload = products.update.mock.calls[0][1];
      expect(payload).not.toHaveProperty('ncm');
      expect(payload).not.toHaveProperty('gtin');
      expect(payload).toMatchObject({ cest: '20.063.00', fiscalOriginCode: 0 });
    });

    // Origem 0 é falsy e é o valor mais comum (nacional) — não pode ser
    // confundida com "não preenchido".
    it('trata origem zero como valor preenchido, não como ausência', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente({ fiscalOriginCode: 0 }));

      await service.upsertFromExternalSource({ ...DADOS_DO_SYNC, fiscalOriginCode: 3 });

      expect(products.update.mock.calls[0][1]).not.toHaveProperty('fiscalOriginCode');
    });

    it('não grava nada quando o ERP também não tem o campo', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente());

      await service.upsertFromExternalSource({ ...DADOS_DO_SYNC, ncm: null, cest: null, gtin: null, fiscalOriginCode: null });

      const payload = products.update.mock.calls[0][1];
      expect(payload).not.toHaveProperty('ncm');
      expect(payload).not.toHaveProperty('cest');
    });

    // Contraste deliberado: nome, custo e dimensões continuam com o ERP como
    // dono, sobrescritos a cada sync.
    it('continua sobrescrevendo os campos de que o ERP é dono', async () => {
      products.findByExternalId.mockResolvedValue(produtoExistente({ ncm: '3305.10.00' }));

      await service.upsertFromExternalSource(DADOS_DO_SYNC);

      expect(products.update.mock.calls[0][1]).toMatchObject({
        name: 'Batom matte vermelho 4g',
        costPrice: 12.5,
        weightKg: 0.012,
      });
    });
  });
});
