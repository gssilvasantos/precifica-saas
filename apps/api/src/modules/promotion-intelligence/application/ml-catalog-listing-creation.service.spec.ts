import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { CATALOG_CREATE_FLAG, MlCatalogListingCreationService } from './ml-catalog-listing-creation.service';
import { MercadoLivreApiClient } from '../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../marketplace-intelligence/application/mercado-livre-connection.service';

interface Overrides {
  item?: Record<string, unknown>;
  hits?: unknown[];
  summaries?: unknown[];
  product?: unknown;
  taxThrows?: boolean;
  sellerId?: string;
}

function build(o: Overrides = {}) {
  const client = {
    fetchItemPricingContext: jest.fn().mockResolvedValue({
      id: 'MLB111',
      title: 'Batom Tradicional',
      price: 69.9,
      permalink: null,
      status: 'active',
      categoryId: 'MLB1234',
      skuCode: 'RM0130',
      isCatalogListing: false,
      catalogProductId: null,
      attributes: [{ id: 'GTIN', value_name: '7908254900097' }],
      sellerId: '123',
      originalPrice: null,
      availableQuantity: 5,
      listingTypeId: 'gold_special',
      variations: [],
      ...o.item,
    }),
    searchCatalogProductsByGtin: jest.fn().mockResolvedValue(o.hits ?? [{ id: 'MLB999', name: 'Batom', domainId: 'MLB-LIPSTICKS', status: 'active' }]),
    fetchSellerShippingCost: jest.fn().mockResolvedValue(8.15),
    fetchSaleFeeAmount: jest.fn().mockImplementation((_c: string, price: number) => Promise.resolve(Math.round(price * 0.13 * 100) / 100)),
    fetchSellerItemIds: jest.fn().mockResolvedValue(['MLB111']),
    fetchOrderSellerIdSample: jest.fn().mockResolvedValue(null),
    fetchCatalogListingSummaries: jest.fn().mockResolvedValue(
      o.summaries ?? [{ id: 'MLB111', title: 'Batom Tradicional', price: 69.9, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: 'RM0130' }],
    ),
    createCatalogItem: jest.fn().mockResolvedValue({ id: 'MLB555', status: 'active' }),
  } as unknown as jest.Mocked<MercadoLivreApiClient>;

  const connections = {
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
    getSellerId: jest.fn().mockResolvedValue(o.sellerId ?? '123'),
  } as unknown as jest.Mocked<MercadoLivreConnectionService>;

  const catalog = {
    findBySku: jest.fn().mockResolvedValue(o.product === undefined ? { productId: 'prod-1', skuCode: 'RM0130', productCostPrice: 32.64 } : o.product),
  };
  const taxRates = {
    resolve: o.taxThrows
      ? jest.fn().mockRejectedValue(new Error('RBT12_INCOMPLETO'))
      : jest.fn().mockResolvedValue({ effectiveRate: 0.073, incidence: 'POR_DENTRO' }),
  };
  const service = new MlCatalogListingCreationService(catalog as never, taxRates as never, client, connections);
  return { service, client, catalog, taxRates };
}

describe('MlCatalogListingCreationService.plan', () => {
  it('planeja com EAN lido do tradicional, ficha única e margem >= 40%', async () => {
    const { service, client } = build();
    const plan = await service.plan('tenant-1', 'MLB111');
    expect(client.searchCatalogProductsByGtin).toHaveBeenCalledWith('7908254900097', 'token');
    expect(plan.catalogProductId).toBe('MLB999');
    expect(plan.skuCode).toBe('RM0130');
    expect(plan.initialStock).toBe(1);
    expect(plan.marginPct).toBeGreaterThanOrEqual(40);
    expect(plan.taxRateSource).toBe('TAX_INTELLIGENCE');
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('sem MAP cadastrado: planeja normalmente e avisa que o piso da marca não foi verificado', async () => {
    const { service } = build();
    const plan = await service.plan('tenant-1', 'MLB111');
    expect(plan.mapPrice).toBeNull();
    expect(plan.warnings.join(' ')).toMatch(/sem MAP cadastrado/i);
  });

  it('MAP abaixo do preço da margem alvo: preço não muda e o aviso diz que respeita o MAP', async () => {
    const base = await build().service.plan('tenant-1', 'MLB111');
    const { service } = build({ product: { productId: 'p', skuCode: 'RM0130', productCostPrice: 32.64, mapPrice: 51.6 } });
    const plan = await service.plan('tenant-1', 'MLB111');
    expect(plan.price).toBe(base.price);
    expect(plan.mapPrice).toBe(51.6);
    expect(plan.warnings.join(' ')).toMatch(/respeita o MAP/);
  });

  it('MAP acima do preço da margem alvo: sobe para o MAP, recalcula tarifa e margem (>= alvo)', async () => {
    const { service } = build({ product: { productId: 'p', skuCode: 'RM0130', productCostPrice: 32.64, mapPrice: 150 } });
    const plan = await service.plan('tenant-1', 'MLB111');
    expect(plan.price).toBe(150);
    expect(plan.feeAmount).toBe(19.5);
    expect(plan.taxAmount).toBe(10.95);
    expect(plan.marginAmount).toBe(Math.round((150 - 32.64 - 10.95 - 19.5 - 8.15) * 100) / 100);
    expect(plan.marginPct).toBeGreaterThanOrEqual(40);
    expect(plan.warnings.join(' ')).toMatch(/subiu .* para o MAP de R\$ 150\.00/);
  });

  it('recusa anúncio de outra conta (isolamento) e não consulta catálogo', async () => {
    const { service, client } = build({ item: { sellerId: '999' } });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(client.searchCatalogProductsByGtin).not.toHaveBeenCalled();
  });

  it.each([
    ['já é de catálogo', { isCatalogListing: true }],
    ['inativo', { status: 'paused' }],
    ['sem SKU', { skuCode: null }],
    ['sem EAN', { attributes: [] }],
    ['EAN inválido', { attributes: [{ id: 'GTIN', value_name: '123' }] }],
    ['sem categoria', { categoryId: null }],
  ])('recusa quando o anúncio %s', async (_name, item) => {
    const { service, client } = build({ item });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(client.searchCatalogProductsByGtin).not.toHaveBeenCalled();
  });

  it('sinaliza no plano quando já existe catálogo ativo da conta para a ficha (verificação pelo EAN)', async () => {
    const { service } = build({
      summaries: [{ id: 'MLB777', title: 'c', price: 1, status: 'active', isCatalogListing: true, catalogProductId: 'MLB999', skuCode: null }],
    });
    const plan = await service.plan('tenant-1', 'MLB111');
    expect(plan.existingCatalogListingId).toBe('MLB777');
    expect(plan.warnings[0]).toMatch(/Já existe o anúncio de catálogo MLB777/);
  });

  it('sem catálogo existente, existingCatalogListingId é null', async () => {
    const { service } = build();
    expect((await service.plan('tenant-1', 'MLB111')).existingCatalogListingId).toBeNull();
  });

  it('recusa quando não há ficha de catálogo para o EAN', async () => {
    const { service } = build({ hits: [] });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toThrow(/Não existe ficha/);
  });

  it('recusa quando o EAN tem mais de uma ficha (escolha manual)', async () => {
    const { service } = build({ hits: [{ id: 'A', name: null, domainId: null, status: 'active' }, { id: 'B', name: null, domainId: null, status: 'active' }] });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toThrow(/2 fichas/);
  });

  it('recusa SKU fora do catálogo do Kyneti e custo zerado', async () => {
    await expect(build({ product: null }).service.plan('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      build({ product: { productId: 'p', skuCode: 'RM0130', productCostPrice: 0 } }).service.plan('tenant-1', 'MLB111'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('sem alíquota calculada pede taxRatePct; com taxRatePct usa OVERRIDE', async () => {
    const { service } = build({ taxThrows: true });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    const plan = await service.plan('tenant-1', 'MLB111', { taxRatePct: 7.3 });
    expect(plan.taxRateSource).toBe('OVERRIDE');
  });

  it('não aceita margem alvo abaixo do piso nem 100%', async () => {
    const { service } = build();
    await expect(service.plan('tenant-1', 'MLB111', { targetMarginPct: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.plan('tenant-1', 'MLB111', { targetMarginPct: 100 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MlCatalogListingCreationService.create', () => {
  const original = process.env[CATALOG_CREATE_FLAG];
  beforeEach(() => {
    process.env[CATALOG_CREATE_FLAG] = 'true';
  });
  afterAll(() => {
    if (original === undefined) delete process.env[CATALOG_CREATE_FLAG];
    else process.env[CATALOG_CREATE_FLAG] = original;
  });

  it('com a flag ausente ou diferente de "true", recusa (403) e NÃO escreve no ML', async () => {
    const { service, client } = build();
    for (const value of [undefined, '', 'false', '1', 'TRUE']) {
      if (value === undefined) delete process.env[CATALOG_CREATE_FLAG];
      else process.env[CATALOG_CREATE_FLAG] = value;
      await expect(service.create('tenant-1', 'MLB111')).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('cria com estoque 1, SKU e preço recalculado no servidor', async () => {
    const { service, client } = build();
    const result = await service.create('tenant-1', 'MLB111');
    expect(result.createdItemId).toBe('MLB555');
    expect(client.createCatalogItem).toHaveBeenCalledTimes(1);
    expect(client.createCatalogItem).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        catalog_listing: true,
        catalog_product_id: 'MLB999',
        available_quantity: 1,
        price: result.plan.price,
        attributes: [{ id: 'SELLER_SKU', value_name: 'RM0130' }],
      }),
    );
  });

  it('com MAP acima do preço da margem alvo, cria no MAP (nunca abaixo)', async () => {
    const { service, client } = build({ product: { productId: 'p', skuCode: 'RM0130', productCostPrice: 32.64, mapPrice: 150 } });
    const result = await service.create('tenant-1', 'MLB111');
    expect(result.plan.price).toBe(150);
    expect(client.createCatalogItem).toHaveBeenCalledWith('token', expect.objectContaining({ price: 150 }));
  });

  it('recusa quando já existe anúncio de catálogo ativo com o mesmo SKU ou ficha (409) e NÃO escreve', async () => {
    const { service, client } = build({
      summaries: [
        { id: 'MLB111', title: 't', price: 1, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: 'RM0130' },
        { id: 'MLB777', title: 'c', price: 1, status: 'active', isCatalogListing: true, catalogProductId: 'MLB999', skuCode: null },
      ],
    });
    await expect(service.create('tenant-1', 'MLB111')).rejects.toBeInstanceOf(ConflictException);
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('não escreve quando o plano falha (sem ficha)', async () => {
    const { service, client } = build({ hits: [] });
    await expect(service.create('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('duas criações simultâneas do mesmo anúncio: só uma escreve, a outra recebe 409; trava liberada depois', async () => {
    const { service, client } = build();
    let release!: () => void;
    (client.createCatalogItem as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ id: 'MLB555', status: 'active' }); }),
    );
    const first = service.create('tenant-1', 'MLB111');
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r));
    await expect(service.create('tenant-1', 'MLB111')).rejects.toBeInstanceOf(ConflictException);
    release();
    await first;
    expect(client.createCatalogItem).toHaveBeenCalledTimes(1);
  });
});

describe('anúncio com variações (um catálogo por variação, pelo EAN de cada uma)', () => {
  const variations = [
    { id: '111', skuCode: 'RM0130', label: 'Cor: Rosa', availableQuantity: 4, attributes: [{ id: 'GTIN', value_name: '7908254900097' }], userProductId: null, rawKeys: ['id', 'attribute_combinations'] },
    { id: '222', skuCode: 'RM0134', label: 'Cor: Nude', availableQuantity: 2, attributes: [{ id: 'GTIN', value_name: '7908254900004' }], userProductId: null, rawKeys: ['id', 'attribute_combinations'] },
    { id: '333', skuCode: 'RM0999', label: 'Cor: Preto', availableQuantity: 1, attributes: [], userProductId: null, rawKeys: ['id', 'attribute_combinations'] },
  ];
  const itemWithVariations = { skuCode: null, attributes: [], variations };

  it('plan sem variationId recusa (422) e lista as variações', async () => {
    const { service } = build({ item: itemWithVariations });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toThrow(/3 variações/);
  });

  it('plan com variationId usa o SKU e o EAN DA VARIAÇÃO', async () => {
    const { service, client } = build({ item: itemWithVariations });
    const plan = await service.plan('tenant-1', 'MLB111', { variationId: '222' });
    expect(client.searchCatalogProductsByGtin).toHaveBeenCalledWith('7908254900004', 'token');
    expect(plan.skuCode).toBe('RM0134');
    expect(plan.variationId).toBe('222');
    expect(plan.variationLabel).toBe('Cor: Nude');
  });

  it('variação inexistente e variationId em anúncio sem variações são recusados', async () => {
    await expect(build({ item: itemWithVariations }).service.plan('tenant-1', 'MLB111', { variationId: '999' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(build().service.plan('tenant-1', 'MLB111', { variationId: '111' })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('planVariations devolve uma linha por variação, com o motivo das que não dá', async () => {
    const { service } = build({ item: itemWithVariations });
    const rows = await service.planVariations('tenant-1', 'MLB111');
    expect(rows.map((r) => [r.variationId, r.plan ? 'ok' : 'erro'])).toEqual([['111', 'ok'], ['222', 'ok'], ['333', 'erro']]);
    expect(rows[2].error).toMatch(/sem EAN/);
  });

  const originalFlag = process.env[CATALOG_CREATE_FLAG];
  beforeEach(() => {
    process.env[CATALOG_CREATE_FLAG] = 'true';
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env[CATALOG_CREATE_FLAG];
    else process.env[CATALOG_CREATE_FLAG] = originalFlag;
  });

  it('create de variação escreve com o SKU da variação e recusa anúncio com variações sem variationId', async () => {
    const { service, client } = build({ item: itemWithVariations });
    await service.create('tenant-1', 'MLB111', { variationId: '111' });
    expect(client.createCatalogItem).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ attributes: [{ id: 'SELLER_SKU', value_name: 'RM0130' }] }),
    );
    await expect(service.create('tenant-1', 'MLB111')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(client.createCatalogItem).toHaveBeenCalledTimes(1);
  });
});

describe('MlCatalogListingCreationService.planBatch (só leitura, por EAN)', () => {
  const rows = (...ids: string[]) =>
    ids.map((id) => ({ id, title: id, price: 10, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: null }));

  it('planeja anúncio simples e variações, separando pronto / já tem catálogo / bloqueado', async () => {
    const { service, client } = build({
      summaries: [
        ...rows('MLB1', 'MLB2'),
        { id: 'MLB9', title: 'cat', price: 1, status: 'active', isCatalogListing: true, catalogProductId: 'FICHA-EXISTENTE', skuCode: null },
      ],
    });
    (client.fetchItemPricingContext as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve(
        id === 'MLB1'
          ? { id, title: 'simples', status: 'active', categoryId: 'MLB1234', skuCode: 'RM0130', isCatalogListing: false, catalogProductId: null,
              attributes: [{ id: 'GTIN', value_name: '7908254900097' }], sellerId: '123', originalPrice: null, availableQuantity: 5, listingTypeId: 'gold_special', variations: [] }
          : { id, title: 'pai', status: 'active', categoryId: 'MLB1234', skuCode: null, isCatalogListing: false, catalogProductId: null,
              attributes: [], sellerId: '123', originalPrice: null, availableQuantity: 5, listingTypeId: 'gold_special',
              variations: [
                { id: '1', skuCode: 'RM0134', label: 'Rosa', availableQuantity: 1, attributes: [{ id: 'GTIN', value_name: '7908254900004' }], userProductId: null, rawKeys: ['id', 'attribute_combinations'] },
                { id: '2', skuCode: 'RM0999', label: 'Preto', availableQuantity: 1, attributes: [], userProductId: null, rawKeys: ['id', 'attribute_combinations'] },
              ] },
      ),
    );
    // A ficha da variação 1 do MLB2 já tem catálogo na conta.
    (client.searchCatalogProductsByGtin as jest.Mock).mockImplementation((gtin: string) =>
      Promise.resolve([{ id: gtin === '7908254900004' ? 'FICHA-EXISTENTE' : 'MLB999', name: 'simples pai', domainId: null, status: 'active' }]),
    );
    const res = await service.planBatch('tenant-1', { offset: 0, limit: 5 });
    expect(res.total).toBe(2);
    expect(res.counts).toEqual({ READY: 1, ALREADY_HAS_CATALOG: 1, BLOCKED: 1 });
    expect(res.rows.map((r) => [r.itemId, r.variationId, r.status])).toEqual([
      ['MLB1', null, 'READY'],
      ['MLB2', '1', 'ALREADY_HAS_CATALOG'],
      ['MLB2', '2', 'BLOCKED'],
    ]);
    expect(res.rows[1].existingCatalogListingId).toBe('MLB9');
    expect(res.rows[2].reason).toMatch(/sem EAN/);
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('anúncio com várias variações consulta frete uma vez e reaproveita tarifas de preços repetidos (estouro de 90 s, 10/10/2026)', async () => {
    const { service, client } = build({ summaries: rows('MLB1') });
    const variation = (id: string, sku: string, gtin: string) => ({
      id, skuCode: sku, label: `Tom ${id}`, availableQuantity: 1, attributes: [{ id: 'GTIN', value_name: gtin }], userProductId: null, rawKeys: ['id'],
    });
    (client.fetchItemPricingContext as jest.Mock).mockResolvedValue({
      id: 'MLB1', title: 'Batom Tradicional', status: 'active', categoryId: 'MLB1234', skuCode: null, isCatalogListing: false, catalogProductId: null,
      attributes: [], sellerId: '123', originalPrice: null, availableQuantity: 5, listingTypeId: 'gold_special',
      variations: [variation('1', 'RM0130', '7908254900097'), variation('2', 'RM0131', '7908254900004'), variation('3', 'RM0132', '7908254900011')],
    });
    // Mesmo custo nas três variações => mesmo preço de equilíbrio => mesmas tarifas.
    const res = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
    expect(res.counts.READY).toBe(3);
    expect(client.fetchSellerShippingCost).toHaveBeenCalledTimes(1);
    const pricesAsked = (client.fetchSaleFeeAmount as jest.Mock).mock.calls.map((c) => c[1] as number);
    expect(new Set(pricesAsked).size).toBe(pricesAsked.length); // nenhum preço consultado duas vezes
    expect(new Set(res.rows.map((r) => r.plan?.price)).size).toBe(1);
  });

  describe('cache do plano em lote por anúncio (timeout de 90 s, 10/10/2026)', () => {
    const variation = (id: string, sku: string, gtin: string) => ({
      id, skuCode: sku, label: `Tom ${id}`, availableQuantity: 1, attributes: [{ id: 'GTIN', value_name: gtin }], userProductId: null, rawKeys: ['id'],
    });
    const item = {
      id: 'MLB1', title: 'Batom Tradicional', status: 'active', categoryId: 'MLB1234', skuCode: null, isCatalogListing: false, catalogProductId: null,
      attributes: [], sellerId: '123', originalPrice: null, availableQuantity: 5, listingTypeId: 'gold_special',
      variations: [variation('1', 'RM0130', '7908254900097'), variation('2', 'RM0131', '7908254900004'), variation('3', 'RM0132', '7908254900011')],
    };

    it('repetir a mesma página reaproveita o resultado: o ML não é consultado de novo', async () => {
      const { service, client } = build({ summaries: rows('MLB1') });
      (client.fetchItemPricingContext as jest.Mock).mockResolvedValue(item);
      const first = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
      const second = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
      expect(second.rows).toEqual(first.rows);
      expect(client.fetchItemPricingContext).toHaveBeenCalledTimes(1);
      expect(client.fetchSellerShippingCost).toHaveBeenCalledTimes(1);
    });

    it('nova tentativa durante o cálculo entra no mesmo trabalho em vez de recomeçar', async () => {
      const { service, client } = build({ summaries: rows('MLB1') });
      let release!: () => void;
      (client.fetchItemPricingContext as jest.Mock).mockImplementation(
        () => new Promise((resolve) => { release = () => resolve(item); }),
      );
      const first = service.planBatch('tenant-1', { offset: 0, limit: 1 });
      await new Promise((r) => setImmediate(r));
      const retry = service.planBatch('tenant-1', { offset: 0, limit: 1 });
      await new Promise((r) => setImmediate(r));
      release();
      const [a, b] = await Promise.all([first, retry]);
      expect(b.rows).toEqual(a.rows);
      expect(client.fetchItemPricingContext).toHaveBeenCalledTimes(1);
    });

    it('falha não fica guardada: a próxima tentativa calcula de novo', async () => {
      const { service, client } = build({ summaries: rows('MLB1') });
      (client.fetchItemPricingContext as jest.Mock).mockRejectedValueOnce(new Error('ML fora do ar')).mockResolvedValue(item);
      await expect(service.planBatch('tenant-1', { offset: 0, limit: 1 })).rejects.toThrow('ML fora do ar');
      const res = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
      expect(res.counts.READY).toBe(3);
    });

    it('margem alvo diferente não reaproveita o cache', async () => {
      const { service, client } = build({ summaries: rows('MLB1') });
      (client.fetchItemPricingContext as jest.Mock).mockResolvedValue(item);
      const a = await service.planBatch('tenant-1', { offset: 0, limit: 1 }, { targetMarginPct: 40 });
      const b = await service.planBatch('tenant-1', { offset: 0, limit: 1 }, { targetMarginPct: 50 });
      expect(client.fetchItemPricingContext).toHaveBeenCalledTimes(2);
      expect(b.rows[0].plan!.price).toBeGreaterThan(a.rows[0].plan!.price);
    });

    it('variações em paralelo mantêm a ordem do anúncio', async () => {
      const { service, client } = build({ summaries: rows('MLB1') });
      (client.fetchItemPricingContext as jest.Mock).mockResolvedValue(item);
      const res = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
      expect(res.rows.map((r) => r.variationId)).toEqual(['1', '2', '3']);
    });
  });

  it('plano avulso (fora do lote) continua sem cache entre chamadas', async () => {
    const { service, client } = build();
    await service.plan('tenant-1', 'MLB111');
    await service.plan('tenant-1', 'MLB111');
    expect(client.fetchSellerShippingCost).toHaveBeenCalledTimes(2);
  });

  it('limita a página a 5 anúncios, respeita offset e bloqueia item de outra conta sem derrubar o lote', async () => {
    const { service, client } = build({ summaries: rows('MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5', 'MLB6', 'MLB7') });
    (client.fetchItemPricingContext as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve({
        id, title: id, status: 'active', categoryId: 'MLB1234', skuCode: 'RM0130', isCatalogListing: false, catalogProductId: null,
        attributes: [{ id: 'GTIN', value_name: '7908254900097' }], sellerId: id === 'MLB3' ? '999' : '123', originalPrice: null,
        availableQuantity: 5, listingTypeId: 'gold_special', variations: [],
      }),
    );
    const res = await service.planBatch('tenant-1', { offset: 1, limit: 1000 });
    expect(res.limit).toBe(5);
    expect(res.rows.map((r) => r.itemId)).toEqual(['MLB2', 'MLB3', 'MLB4', 'MLB5', 'MLB6']);
    expect(res.rows.find((r) => r.itemId === 'MLB3')?.status).toBe('BLOCKED');
  });
});

describe('anúncio ligado a uma ficha (catalogProductId) não é tradicional', () => {
  it('fica fora da lista e do lote, e conta como catálogo existente da ficha', async () => {
    const { service } = build({
      summaries: [
        { id: 'MLB1', title: 'a', price: 1, status: 'active', isCatalogListing: false, catalogProductId: 'FICHA-X', skuCode: 'S1' },
        { id: 'MLB2', title: 'b', price: 1, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: 'S2' },
      ],
    });
    const list = await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 50 });
    expect(list.items.map((i) => i.itemId)).toEqual(['MLB2']);
    const batch = await service.planBatch('tenant-1', { offset: 0, limit: 5 });
    expect(batch.total).toBe(1);
  });
});

describe('cache da lista de anúncios da conta (30 min, por tenant)', () => {
  const originalFlag = process.env[CATALOG_CREATE_FLAG];
  beforeEach(() => {
    process.env[CATALOG_CREATE_FLAG] = 'true';
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env[CATALOG_CREATE_FLAG];
    else process.env[CATALOG_CREATE_FLAG] = originalFlag;
  });

  it('planos de leitura reaproveitam a lista; a criação sempre relê (trava de duplicidade com dado fresco)', async () => {
    const { service, client } = build();
    await service.plan('tenant-1', 'MLB111');
    await service.plan('tenant-1', 'MLB111');
    await service.planBatch('tenant-1', { offset: 0, limit: 1 });
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(1);
    await service.plan('tenant-2', 'MLB111');
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(2); // outro tenant: outra chave
    await service.create('tenant-1', 'MLB111');
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(3); // fresh
  });
});

describe('EAN que leva a ficha de outro produto não cria (09/10/2026)', () => {
  const originalFlag = process.env[CATALOG_CREATE_FLAG];
  beforeEach(() => {
    process.env[CATALOG_CREATE_FLAG] = 'true';
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env[CATALOG_CREATE_FLAG];
    else process.env[CATALOG_CREATE_FLAG] = originalFlag;
  });
  // Caso real: pincel de maquiagem (RM0019) com EAN que o ML liga a um microfone.
  const microfone = [{ id: 'MLB21632968', name: 'Microfone de Lapela Condensador Profissional', domainId: null, status: 'active' }];

  it('o plano é recusado (422) com o motivo: EAN, ficha e título', async () => {
    const { service } = build({ hits: microfone });
    await expect(service.plan('tenant-1', 'MLB111')).rejects.toThrow(/MLB21632968.*Microfone.*Batom Tradicional/);
  });

  it('o lote lista o item como BLOCKED com o motivo, sem derrubar os outros', async () => {
    const { service } = build({ hits: microfone });
    const res = await service.planBatch('tenant-1', { offset: 0, limit: 1 });
    expect(res.rows[0].status).toBe('BLOCKED');
    expect(res.rows[0].reason).toMatch(/Microfone.*confira o EAN/);
    expect(res.rows[0].plan).toBeNull();
  });

  it('a criação não escreve nada', async () => {
    const { service, client } = build({ hits: microfone });
    await expect(service.create('tenant-1', 'MLB111')).rejects.toThrow(/não bate/);
    expect(client.createCatalogItem).not.toHaveBeenCalled();
  });

  it('com nome da ficha batendo com o anúncio, cria normalmente', async () => {
    const { service, client } = build();
    await service.create('tenant-1', 'MLB111');
    expect(client.createCatalogItem).toHaveBeenCalledTimes(1);
  });
});

describe('variação sem SKU na resposta do ML (09/10/2026)', () => {
  it('bloqueia e diz quais campos o ML devolveu (sem valores), para diagnosticar o formato real', async () => {
    const { service, client } = build();
    (client.fetchItemPricingContext as jest.Mock).mockResolvedValue({
      id: 'MLB111', title: 'Corretivo', status: 'active', categoryId: 'MLB1234', skuCode: null, isCatalogListing: false, catalogProductId: null,
      attributes: [], sellerId: '123', originalPrice: null, availableQuantity: 5, listingTypeId: 'gold_special',
      variations: [{ id: '9', skuCode: null, label: 'Cor: A1', availableQuantity: 3, attributes: [], userProductId: 'MLBU1', rawKeys: ['id', 'user_product_id'] }],
    });
    await expect(service.plan('tenant-1', 'MLB111', { variationId: '9' })).rejects.toThrow(/sem SKU.*campos da variação no ML: id, user_product_id; user_product_id: MLBU1/);
  });
});

describe('tarifa do ML com token (09/10/2026)', () => {
  it('consulta a tarifa autenticada: sem token o ML devolve 403 (PolicyAgent)', async () => {
    const { service, client } = build();
    await service.plan('tenant-1', 'MLB111');
    expect(client.fetchSaleFeeAmount).toHaveBeenCalled();
    for (const call of client.fetchSaleFeeAmount.mock.calls) expect(call[3]).toBe('token');
  });
});

describe('leitura lenta da conta: lista antiga serve e primeira chamada devolve 202 (10/10/2026)', () => {
  const originalFlag = process.env[CATALOG_CREATE_FLAG];
  beforeEach(() => {
    process.env[CATALOG_CREATE_FLAG] = 'true';
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env[CATALOG_CREATE_FLAG];
    else process.env[CATALOG_CREATE_FLAG] = originalFlag;
  });

  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('sem cache e leitura lenta: devolve 202 ML_CATALOG_LIST_LOADING e a leitura continua; a repetição já acha o resultado', async () => {
    jest.useFakeTimers();
    const { service, client } = build();
    const slow = deferred<string[]>();
    client.fetchSellerItemIds.mockReturnValueOnce(slow.promise);

    const first = service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 });
    const outcome = first.then(() => null, (e) => e);
    await jest.advanceTimersByTimeAsync(46_000);
    const error = await outcome;
    expect(error.getStatus()).toBe(202);
    expect(error.getResponse()).toMatchObject({ code: 'ML_CATALOG_LIST_LOADING' });

    slow.resolve(['MLB111']);
    await jest.advanceTimersByTimeAsync(0);
    const again = await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 });
    expect(again.total).toBe(1);
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(1);
  });

  it('cache vencido (30 min a 12 h): responde na hora com a lista antiga e atualiza em segundo plano', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-10T10:00:00Z') });
    const { service, client } = build();
    await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 });
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-10T11:00:00Z'));
    const slow = deferred<string[]>();
    client.fetchSellerItemIds.mockReturnValueOnce(slow.promise);
    const stale = await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 });
    expect(stale.total).toBe(1);
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(2);
    slow.resolve(['MLB111']);
    await jest.advanceTimersByTimeAsync(0);
  });

  it('a criação não usa lista antiga: lê de novo', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-10T10:00:00Z') });
    const { service, client } = build();
    await service.plan('tenant-1', 'MLB111');
    jest.setSystemTime(new Date('2026-10-10T10:05:00Z'));
    await service.create('tenant-1', 'MLB111');
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(2);
  });
});

describe('leitura da lista de anúncios em andamento', () => {
  it('chamadas simultâneas de leitura compartilham UMA leitura da conta', async () => {
    const { service, client } = build();
    await Promise.all([
      service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 }),
      service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 }),
      service.planBatch('tenant-1', { offset: 0, limit: 1 }),
    ]);
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(1);
  });

  it('falha na leitura não fica presa: a próxima chamada tenta de novo', async () => {
    const { service, client } = build();
    client.fetchSellerItemIds.mockRejectedValueOnce(new Error('ML fora do ar'));
    await expect(service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 })).rejects.toThrow('ML fora do ar');
    await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 10 });
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(2);
  });
});

describe('MlCatalogListingCreationService.listTraditionalWithoutCatalog', () => {
  it('lista só tradicionais ativos, marca SKU que já tem catálogo e limita a página', async () => {
    const { service } = build({
      summaries: [
        { id: 'MLB1', title: 'a', price: 10, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: 'S1' },
        { id: 'MLB2', title: 'b', price: 10, status: 'paused', isCatalogListing: false, catalogProductId: null, skuCode: 'S2' },
        { id: 'MLB3', title: 'c', price: 10, status: 'active', isCatalogListing: true, catalogProductId: 'X', skuCode: 'S1' },
        { id: 'MLB4', title: 'd', price: 10, status: 'active', isCatalogListing: false, catalogProductId: null, skuCode: 'S4' },
      ],
    });
    const page = await service.listTraditionalWithoutCatalog('tenant-1', { offset: 0, limit: 1000 });
    expect(page.limit).toBe(100);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => [i.itemId, i.hasCatalogListingWithSameSku])).toEqual([['MLB1', true], ['MLB4', false]]);
  });
});
