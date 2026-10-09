import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { MlCatalogCampaignService } from './ml-catalog-campaign.service';
import { MercadoLivreApiClient } from '../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../marketplace-intelligence/application/mercado-livre-connection.service';

// Batom Maria Clara (MLB7393870900) — números reais da gravação do Gui no
// Mercado Turbo: custo 32,64, imposto 7,3%, tarifa 13%, frete 8,15.
function build(overrides: { stock?: number; promotions?: unknown[]; taxThrows?: boolean } = {}) {
  const client = {
    fetchItemPricingContext: jest.fn().mockResolvedValue({
      id: 'MLB7393870900',
      title: 'Batom Líquido Matte Aveludado Mari Maria Maria Clara',
      price: 69.9,
      permalink: null,
      status: 'active',
      categoryId: 'MLB1234',
      skuCode: 'RM0299-1',
      isCatalogListing: true,
      catalogProductId: 'MLB999',
      attributes: [],
      sellerId: '123',
      originalPrice: 69.9,
      availableQuantity: overrides.stock ?? 11,
      listingTypeId: 'gold_special',
    }),
    fetchPriceToWin: jest.fn().mockResolvedValue({
      status: 'competing',
      priceToWin: 52.4,
      currentPrice: 55.9,
      catalogProductId: 'MLB999',
      reasons: [],
      winnerItemId: 'MLB1',
      winnerPrice: 52.4,
    }),
    fetchItemPromotions: jest.fn().mockResolvedValue(
      overrides.promotions ?? [
        { id: 'P-DEZ', type: 'SELLER_CAMPAIGN', subType: null, status: 'candidate', name: 'Campanha Dezembro', price: null, originalPrice: 69.9, minDiscountedPrice: 13.98, maxDiscountedPrice: 66.4, suggestedDiscountedPrice: null, startDate: null, finishDate: null },
        { id: 'P-SMART', type: 'SMART', subType: null, status: 'candidate', name: 'Impulsione', price: null, originalPrice: 69.9, minDiscountedPrice: null, maxDiscountedPrice: null, suggestedDiscountedPrice: null, startDate: null, finishDate: null },
      ],
    ),
    fetchSellerShippingCost: jest.fn().mockResolvedValue(8.15),
    fetchSaleFeeAmount: jest.fn().mockImplementation((_c: string, price: number) => Promise.resolve(Math.round(price * 0.13 * 100) / 100)),
    joinItemPromotion: jest.fn().mockResolvedValue({ price: 55.9, originalPrice: 69.9 }),
  } as unknown as jest.Mocked<MercadoLivreApiClient>;

  const connections = {
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
    getSellerId: jest.fn().mockResolvedValue('123'),
  } as unknown as jest.Mocked<MercadoLivreConnectionService>;

  const catalog = {
    findBySku: jest.fn().mockResolvedValue({ productId: 'prod-1', skuCode: 'RM0299-1', productCostPrice: 32.64 }),
  };
  const taxRates = {
    resolve: overrides.taxThrows
      ? jest.fn().mockRejectedValue(new Error('RBT12_INCOMPLETO'))
      : jest.fn().mockResolvedValue({ effectiveRate: 0.073, incidence: 'POR_DENTRO' }),
  };

  const service = new MlCatalogCampaignService(catalog as never, taxRates as never, client, connections);
  return { service, client };
}

describe('MlCatalogCampaignService.plan', () => {
  it('planeja entrar na campanha do vendedor mantendo R$ 55,90 e ignora a Smart', async () => {
    const { service } = build();
    const plan = await service.plan('tenant-1', 'MLB7393870900');

    expect(plan.taxRatePct).toBe(7.3);
    expect(plan.taxRateSource).toBe('TAX_INTELLIGENCE');
    const dez = plan.campaigns.find((c) => c.promotionId === 'P-DEZ');
    expect(dez?.action).toBe('JOIN');
    expect(dez?.plannedPrice).toBe(55.9);
    expect(dez?.priceReason).toBe('KEEP_CURRENT_PRICE');
    expect(dez?.margin?.marginAmount).toBe(3.76);
    expect(plan.campaigns.find((c) => c.promotionId === 'P-SMART')?.action).toBe('SKIP_NOT_ELIGIBLE');
  });

  it('sem alíquota no Tax Intelligence e sem taxRatePct: 422 pedindo a alíquota', async () => {
    const { service } = build({ taxThrows: true });
    await expect(service.plan('tenant-1', 'MLB7393870900')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('taxRatePct informado substitui a alíquota calculada', async () => {
    const { service } = build({ taxThrows: true });
    const plan = await service.plan('tenant-1', 'MLB7393870900', { taxRatePct: 7.3 });
    expect(plan.taxRateSource).toBe('OVERRIDE');
  });
});

describe('MlCatalogCampaignService.join', () => {
  const originalFlag = process.env.ML_CAMPAIGN_WRITES_ENABLED;
  beforeEach(() => {
    process.env.ML_CAMPAIGN_WRITES_ENABLED = 'true';
  });
  afterAll(() => {
    if (originalFlag === undefined) delete process.env.ML_CAMPAIGN_WRITES_ENABLED;
    else process.env.ML_CAMPAIGN_WRITES_ENABLED = originalFlag;
  });

  it('com a flag ausente ou diferente de "true", recusa (403) e NÃO escreve no ML', async () => {
    const { service, client } = build();
    for (const value of [undefined, '', 'false', '1', 'TRUE']) {
      if (value === undefined) delete process.env.ML_CAMPAIGN_WRITES_ENABLED;
      else process.env.ML_CAMPAIGN_WRITES_ENABLED = value;
      await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('não aceita piso de margem abaixo de 5% (minMarginPct: 0) e NÃO escreve no ML', async () => {
    const { service, client } = build();
    await expect(
      service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 52.4, minMarginPct: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('aceita exigir margem maior que 5% e recusa quando o preço não atinge', async () => {
    const { service, client } = build();
    await expect(
      service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9, minMarginPct: 10 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('duas inscrições simultâneas do mesmo anúncio/campanha: só uma escreve, a outra recebe 409', async () => {
    const { service, client } = build();
    let release!: () => void;
    (client.joinItemPromotion as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ price: 55.9, originalPrice: 69.9 }); }),
    );
    const first = service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 });
    await new Promise((r) => setImmediate(r));
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    release();
    await first;
    expect(client.joinItemPromotion).toHaveBeenCalledTimes(1);
    // Liberada a trava, uma nova tentativa volta a ser avaliada normalmente.
    await service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 });
    expect(client.joinItemPromotion).toHaveBeenCalledTimes(2);
  });

  it('inscreve quando a margem recalculada no servidor fica >= 5%', async () => {
    const { service, client } = build();
    const result = await service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 });
    expect(result.margin.marginPct).toBeGreaterThanOrEqual(5);
    expect(client.joinItemPromotion).toHaveBeenCalledWith('MLB7393870900', 'token', {
      promotionId: 'P-DEZ',
      promotionType: 'SELLER_CAMPAIGN',
      dealPrice: 55.9,
    });
  });

  it('recusa preço que derruba a margem abaixo de 5% (R$ 52,40 = 1,85%) e NÃO escreve no ML', async () => {
    const { service, client } = build();
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 52.4 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('recusa preço acima do teto aceito pela campanha', async () => {
    const { service, client } = build();
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 69.9 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('recusa campanha fora da rotina (Smart) e campanha inexistente', async () => {
    const { service, client } = build();
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-SMART', dealPrice: 55.9 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-NAO-EXISTE', dealPrice: 55.9 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('recusa anúncio sem estoque', async () => {
    const { service, client } = build({ stock: 0 });
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-DEZ', dealPrice: 55.9 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });

  it('não reinscreve campanha em que o anúncio já participa', async () => {
    const { service, client } = build({
      promotions: [
        { id: 'P-OUT', type: 'SELLER_CAMPAIGN', subType: null, status: 'started', name: 'Outubro', price: 55.9, originalPrice: 69.9, minDiscountedPrice: 13.98, maxDiscountedPrice: 66.4, suggestedDiscountedPrice: null, startDate: null, finishDate: null },
      ],
    });
    await expect(service.join('tenant-1', 'MLB7393870900', { promotionId: 'P-OUT', dealPrice: 55.9 })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(client.joinItemPromotion).not.toHaveBeenCalled();
  });
});
