import { FinancialPolicyReaderService } from './financial-policy-reader.service';
import { CatalogSettingsService } from './catalog-settings.service';
import { DEFAULT_TARGET_ROAS } from '../../../shared/contracts/financial-policy-reader.port';

describe('FinancialPolicyReaderService', () => {
  function buildService() {
    const settingsService = {
      getFinancialPolicy: jest.fn(),
    } as unknown as jest.Mocked<CatalogSettingsService>;
    const service = new FinancialPolicyReaderService(settingsService);
    return { service, settingsService };
  }

  it('converte taxRatePct/minProfitMarginPct de percentual para fração', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy.mockResolvedValue({ taxRatePct: 6, minProfitMarginPct: 30, targetRoas: 4 });

    const policy = await service.getPolicy('tenant-1');

    expect(policy.taxRate).toBe(0.06);
    expect(policy.minProfitMargin).toBe(0.3);
  });

  it('targetRoas: usa o valor configurado pelo tenant quando presente (Fase 4 — Ads/IA)', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy.mockResolvedValue({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: 4.5 });

    const policy = await service.getPolicy('tenant-1');

    expect(policy.targetRoas).toBe(4.5);
  });

  it('targetRoas: cai para DEFAULT_TARGET_ROAS quando o tenant não configurou (null)', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy.mockResolvedValue({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: null });

    const policy = await service.getPolicy('tenant-1');

    expect(policy.targetRoas).toBe(DEFAULT_TARGET_ROAS);
  });

  it('cacheia o resultado — segunda chamada não bate no CatalogSettingsService de novo', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy.mockResolvedValue({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: null });

    await service.getPolicy('tenant-1');
    await service.getPolicy('tenant-1');

    expect(settingsService.getFinancialPolicy).toHaveBeenCalledTimes(1);
  });

  it('invalida o cache no evento FINANCIAL_POLICY_UPDATED — próxima leitura busca de novo', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy.mockResolvedValue({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: null });

    await service.getPolicy('tenant-1');
    service.handlePolicyUpdated({ tenantId: 'tenant-1' });
    await service.getPolicy('tenant-1');

    expect(settingsService.getFinancialPolicy).toHaveBeenCalledTimes(2);
  });

  it('cache é isolado por tenant', async () => {
    const { service, settingsService } = buildService();
    settingsService.getFinancialPolicy
      .mockResolvedValueOnce({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: 2 })
      .mockResolvedValueOnce({ taxRatePct: 0, minProfitMarginPct: 0, targetRoas: 5 });

    const policyA = await service.getPolicy('tenant-a');
    const policyB = await service.getPolicy('tenant-b');

    expect(policyA.targetRoas).toBe(2);
    expect(policyB.targetRoas).toBe(5);
  });
});
