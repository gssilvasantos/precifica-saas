import { Test } from '@nestjs/testing';
import { TaxRateResolverService } from './tax-rate-resolver.service';
import {
  PRODUCT_TAX_PROFILE_REPOSITORY,
  TENANT_PRIOR_REVENUE_REPOSITORY,
  TENANT_TAX_PROFILE_REPOSITORY,
} from './ports/tax-repositories.port';
import { MONTHLY_REVENUE_READER } from '../../../shared/contracts/tokens';
import { TaxRateUnavailableError } from '../../../shared/contracts/tax-rate-resolver.port';

const mes = (iso: string) => new Date(`${iso}-01T00:00:00.000Z`);
const PA = mes('2026-06');
const TENANT = 'tenant-1';

// Mesmo cenário do extrato oficial do PGDAS-D (PA 06/2026): empresa que era
// MEI até 2025 e passou a vender pelo Kyneti em 01/2026.
const RECEITAS_2026 = [
  { competencia: mes('2026-01'), receita: 99_033.94 },
  { competencia: mes('2026-02'), receita: 113_071.45 },
  { competencia: mes('2026-03'), receita: 117_148.36 },
  { competencia: mes('2026-04'), receita: 129_714.47 },
  { competencia: mes('2026-05'), receita: 146_606.67 },
];
const PERIODO_MEI_ZERADO = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'].map(
  (m) => ({ competencia: mes(m), receita: 0 }),
);

describe('TaxRateResolverService', () => {
  let tenantProfiles: { findVigente: jest.Mock };
  let productProfiles: { findVigente: jest.Mock };
  let priorRevenues: { findForPeriod: jest.Mock };
  let revenue: { sumByMonth: jest.Mock; firstOrderAt: jest.Mock };
  let service: TaxRateResolverService;

  beforeEach(async () => {
    tenantProfiles = {
      findVigente: jest.fn().mockResolvedValue({
        id: 'p1',
        tenantId: TENANT,
        uf: 'SP',
        regime: 'SIMPLES_NACIONAL',
        anexo: 'I',
        vigenciaInicio: mes('2026-01'),
        vigenciaFim: null,
        meiValorFixoMensal: null,
        automationMode: 'AUTO',
      }),
    };
    productProfiles = {
      findVigente: jest.fn().mockResolvedValue({
        id: 'pt1',
        productId: 'prod-1',
        uf: 'SP',
        icmsSt: false,
        monofasico: false,
        ncm: '3304.99.90',
        fonte: 'MANUAL',
        vigenciaInicio: mes('2026-04'),
        vigenciaFim: null,
      }),
    };
    priorRevenues = { findForPeriod: jest.fn().mockResolvedValue(PERIODO_MEI_ZERADO) };
    revenue = {
      sumByMonth: jest.fn().mockResolvedValue(RECEITAS_2026),
      firstOrderAt: jest.fn().mockResolvedValue(mes('2026-01')),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TaxRateResolverService,
        { provide: TENANT_TAX_PROFILE_REPOSITORY, useValue: tenantProfiles },
        { provide: PRODUCT_TAX_PROFILE_REPOSITORY, useValue: productProfiles },
        { provide: TENANT_PRIOR_REVENUE_REPOSITORY, useValue: priorRevenues },
        { provide: MONTHLY_REVENUE_READER, useValue: revenue },
      ],
    }).compile();

    service = moduleRef.get(TaxRateResolverService);
  });

  const query = { tenantId: TENANT, productId: 'prod-1', uf: 'SP', at: PA };

  describe('UF opcional na consulta (12/08/2026)', () => {
    it('sem uf, usa a do estabelecimento e resolve igual', async () => {
      // Quem consome a porta (Pricing, DRE) não sabe a UF: ela vive no perfil
      // tributário, que é o que este módulo encapsula. Exigir o campo obrigaria
      // o Pricing a ler dado de tributação para perguntar sobre tributação.
      const { uf: _omitida, ...semUf } = query;

      const comUf = await service.resolve(query);
      const semUfResolvido = await service.resolve(semUf);

      expect(semUfResolvido.effectiveRate).toBe(comUf.effectiveRate);
      expect(semUfResolvido.regime).toBe(comUf.regime);
    });
  });

  describe('Simples Nacional', () => {
    it('reproduz a alíquota do extrato oficial (7,2113%)', async () => {
      const r = await service.resolve(query);

      expect(r.regime).toBe('SIMPLES_NACIONAL');
      expect(r.source).toBe('CALCULATED_RBT12');
      expect(r.effectiveRate).toBeCloseTo(0.0721126574, 9);
      expect(r.incidence).toBe('POR_DENTRO');
      // Optante do Simples na guia única não se apropria de crédito (art. 24).
      expect(r.creditableRate).toBe(0);
      expect(r.fixedMonthlyTaxAmount).toBeNull();
    });

    it('devolve memória de cálculo auditável', async () => {
      const { breakdown } = await service.resolve(query);

      expect(breakdown.rbt12).toBeCloseTo(605_574.89, 2);
      expect(breakdown.anexo).toBe('I');
      expect(breakdown.faixa).toBe(3);
      expect(breakdown.aliquotaNominal).toBe(0.095);
      expect(breakdown.parcelaDeduzir).toBe(13_860);
      expect(breakdown.fundamentacao).toContain('LC_123_2006_ART_18_PARAGRAFO_1A');
    });

    it('remove PIS e Cofins de produto monofásico', async () => {
      productProfiles.findVigente.mockResolvedValue({
        id: 'pt1',
        productId: 'prod-1',
        uf: 'SP',
        icmsSt: false,
        monofasico: true,
        ncm: '3304.99.90',
        fonte: 'LEI_10147_2000',
        vigenciaInicio: mes('2026-04'),
        vigenciaFim: null,
      });

      const r = await service.resolve(query);

      // 15,5% da partilha (Cofins 12,74% + PIS 2,76%) saem da alíquota.
      expect(r.effectiveRate).toBeCloseTo(0.0721126574 * 0.845, 9);
      expect(r.breakdown.removidoMonofasico).toBeCloseTo(0.155, 10);
      expect(r.breakdown.fundamentacao).toContain('LEI_10147_2000');
    });

    it('remove o ICMS de produto ainda em substituição tributária', async () => {
      productProfiles.findVigente.mockResolvedValue({
        id: 'pt1',
        productId: 'prod-1',
        uf: 'SP',
        icmsSt: true,
        monofasico: false,
        ncm: '3304.99.90',
        fonte: 'PORTARIA_CAT_68_2019',
        vigenciaInicio: mes('2025-01'),
        vigenciaFim: mes('2026-03'),
      });

      const r = await service.resolve(query);
      expect(r.effectiveRate).toBeCloseTo(0.0721126574 * 0.665, 9);
      expect(r.breakdown.removidoIcmsSt).toBe(0.335);
    });

    it('consulta o perfil do produto pela UF e pela DATA da apuração', async () => {
      await service.resolve(query);
      expect(productProfiles.findVigente).toHaveBeenCalledWith(TENANT, 'prod-1', 'SP', PA);
    });
  });

  describe('MEI', () => {
    it('devolve alíquota ZERO e o DAS fixo — percentual nenhum está certo para MEI', async () => {
      tenantProfiles.findVigente.mockResolvedValue({
        id: 'p0',
        tenantId: TENANT,
        uf: 'SP',
        regime: 'MEI_SIMEI',
        anexo: null,
        vigenciaInicio: mes('2025-01'),
        vigenciaFim: mes('2025-12'),
        meiValorFixoMensal: 76.9,
        automationMode: 'AUTO',
      });

      const r = await service.resolve(query);

      expect(r.effectiveRate).toBe(0);
      expect(r.source).toBe('NOT_APPLICABLE');
      expect(r.fixedMonthlyTaxAmount).toBe(76.9);
      // MEI não depende de RBT12 — não deve nem consultar faturamento.
      expect(revenue.sumByMonth).not.toHaveBeenCalled();
    });
  });

  describe('bloqueios — nunca devolver zero silencioso', () => {
    it('bloqueia quando não há regime vigente na data', async () => {
      tenantProfiles.findVigente.mockResolvedValue(null);
      await expect(service.resolve(query)).rejects.toThrow(TaxRateUnavailableError);
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'REGIME_NAO_CONFIGURADO' });
    });

    it('bloqueia Simples sem Anexo informado', async () => {
      tenantProfiles.findVigente.mockResolvedValue({
        id: 'p1',
        tenantId: TENANT,
        uf: 'SP',
        regime: 'SIMPLES_NACIONAL',
        anexo: null,
        vigenciaInicio: mes('2026-01'),
        vigenciaFim: null,
        meiValorFixoMensal: null,
        automationMode: 'AUTO',
      });
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'REGIME_NAO_CONFIGURADO' });
    });

    it('bloqueia quando o RBT12 está incompleto', async () => {
      priorRevenues.findForPeriod.mockResolvedValue([]);
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'RBT12_INCOMPLETO' });
    });

    // Ausência de perfil não é "produto sem ST e sem monofásico" — é falta de
    // informação, e assumir false é como se declara PIS/Cofins indevido.
    it('bloqueia quando o produto não tem perfil fiscal vigente', async () => {
      productProfiles.findVigente.mockResolvedValue(null);
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'PERFIL_DO_PRODUTO_AUSENTE' });
    });

    // Acima de R$ 4,8 milhões não existe faixa: a empresa está fora do regime.
    it('bloqueia quando o RBT12 ultrapassa o limite do Simples', async () => {
      revenue.sumByMonth.mockResolvedValue([{ competencia: mes('2026-05'), receita: 5_000_000 }]);
      await expect(service.resolve(query)).rejects.toThrow(/limite do Simples Nacional/);
    });

    // Dentro do limite, a 6ª faixa é calculada normalmente — e sem ICMS, que
    // acima do sublimite sai do DAS.
    it('calcula a 6ª faixa quando o RBT12 está entre o sublimite e o limite', async () => {
      revenue.sumByMonth.mockResolvedValue([{ competencia: mes('2026-05'), receita: 4_000_000 }]);
      const r = await service.resolve(query);
      expect(r.breakdown.faixa).toBe(6);
      expect(r.effectiveRate).toBeGreaterThan(0);
    });

    // ICMS ausente não é "ICMS zero": é falta de configuração. Precificar sem
    // ele erra para menos, e imposto subestimado superestima margem.
    it.each(['LUCRO_PRESUMIDO', 'LUCRO_REAL'])('bloqueia %s sem alíquota de ICMS', async (regime) => {
      tenantProfiles.findVigente.mockResolvedValue(perfilRegimeNormal(regime, { icmsAliquota: null }));
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'REGIME_NAO_CONFIGURADO' });
    });

    it('bloqueia Lucro Presumido sem percentual de presunção', async () => {
      tenantProfiles.findVigente.mockResolvedValue(
        perfilRegimeNormal('LUCRO_PRESUMIDO', { presuncaoIrpj: null }),
      );
      await expect(service.resolve(query)).rejects.toMatchObject({ reason: 'REGIME_NAO_CONFIGURADO' });
    });
  });

  describe('regimes normais', () => {
    it('calcula o Lucro Presumido somando os quatro tributos', async () => {
      tenantProfiles.findVigente.mockResolvedValue(perfilRegimeNormal('LUCRO_PRESUMIDO'));

      const r = await service.resolve(query);

      // 0,65 + 3,00 + 18,00 (ICMS) + 1,20 (IRPJ) + 1,08 (CSLL) = 23,93%
      // Sem adicional: a média mensal do RBT12 (605.574,89/12 ≈ 50.464) fica
      // muito abaixo dos R$ 250.000 que acionam o escalão.
      expect(r.effectiveRate).toBeCloseTo(0.2393, 10);
      expect(r.regime).toBe('LUCRO_PRESUMIDO');
      expect(r.source).toBe('FIXED_REGIME_RATE');
      expect(r.creditableRate).toBe(0.18);
    });

    it('calcula o Lucro Real sem IRPJ e sem CSLL no piso', async () => {
      tenantProfiles.findVigente.mockResolvedValue(perfilRegimeNormal('LUCRO_REAL'));

      const r = await service.resolve(query);

      // 1,65 + 7,60 + 18,00 = 27,25% — IRPJ e CSLL ficam de fora porque
      // incidem sobre o lucro, não sobre a receita.
      expect(r.effectiveRate).toBeCloseTo(0.2725, 10);
      expect(r.creditableRate).toBeCloseTo(0.2725, 10);
    });

    // O Real não depende de faturamento histórico: a alíquota é a mesma em
    // qualquer volume.
    it('o Lucro Real não consulta o RBT12', async () => {
      tenantProfiles.findVigente.mockResolvedValue(perfilRegimeNormal('LUCRO_REAL'));
      await service.resolve(query);
      expect(revenue.sumByMonth).not.toHaveBeenCalled();
    });
  });

  function perfilRegimeNormal(regime: string, overrides: Record<string, unknown> = {}) {
    return {
      id: 'p1',
      tenantId: TENANT,
      uf: 'SP',
      regime,
      anexo: null,
      vigenciaInicio: mes('2026-01'),
      vigenciaFim: null,
      meiValorFixoMensal: null,
      icmsAliquota: 0.18,
      presuncaoIrpj: 0.08,
      presuncaoCsll: 0.12,
      automationMode: 'AUTO',
      ...overrides,
    };
  }
});
