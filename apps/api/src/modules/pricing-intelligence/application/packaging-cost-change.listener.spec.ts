import { PackagingCostChangeListener } from './packaging-cost-change.listener';
import { PackagingLinkedProductsReader } from '../../../shared/contracts/packaging-linked-products-reader.port';
import { PricingDecisionService } from './pricing-decision.service';

describe('PackagingCostChangeListener', () => {
  function buildListener(skuCodes: string[]) {
    const linkedProducts: jest.Mocked<PackagingLinkedProductsReader> = {
      findSkuCodesByPackaging: jest.fn().mockResolvedValue(skuCodes),
    };
    const pricingDecisions = {
      decideAndMaybeApply: jest.fn().mockResolvedValue({
        decision: { action: 'MATCH_COMPETITOR', recommendedPrice: 90 },
        applied: true,
        reason: 'ok',
      }),
    } as unknown as jest.Mocked<PricingDecisionService>;

    const listener = new PackagingCostChangeListener(linkedProducts, pricingDecisions);
    return { listener, linkedProducts, pricingDecisions };
  }

  it('nenhum produto vinculado à embalagem: não chama decideAndMaybeApply', async () => {
    const { listener, pricingDecisions } = buildListener([]);

    await listener.handleCostChanged({
      tenantId: 'tenant-1',
      packagingId: 'pack-1',
      previousCostPrice: 5,
      newCostPrice: 8,
    });

    expect(pricingDecisions.decideAndMaybeApply).not.toHaveBeenCalled();
  });

  it('reprecifica cada SKU vinculado à embalagem', async () => {
    const { listener, pricingDecisions } = buildListener(['SKU-001', 'SKU-002']);

    await listener.handleCostChanged({
      tenantId: 'tenant-1',
      packagingId: 'pack-1',
      previousCostPrice: 5,
      newCostPrice: 8,
    });

    expect(pricingDecisions.decideAndMaybeApply).toHaveBeenCalledTimes(2);
    expect(pricingDecisions.decideAndMaybeApply).toHaveBeenCalledWith('tenant-1', 'SKU-001');
    expect(pricingDecisions.decideAndMaybeApply).toHaveBeenCalledWith('tenant-1', 'SKU-002');
  });

  it('falha ao reprecificar um SKU não impede os demais de serem processados', async () => {
    const { listener, pricingDecisions } = buildListener(['SKU-001', 'SKU-002']);
    pricingDecisions.decideAndMaybeApply
      .mockRejectedValueOnce(new Error('falha simulada'))
      .mockResolvedValueOnce({ decision: { action: 'HOLD_PRICE', recommendedPrice: 100 }, applied: false, reason: 'ok' } as never);

    await expect(
      listener.handleCostChanged({ tenantId: 'tenant-1', packagingId: 'pack-1', previousCostPrice: 5, newCostPrice: 8 }),
    ).resolves.not.toThrow();

    expect(pricingDecisions.decideAndMaybeApply).toHaveBeenCalledTimes(2);
  });
});
