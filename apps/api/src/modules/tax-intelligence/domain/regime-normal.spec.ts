import {
  COFINS_CUMULATIVO,
  COFINS_NAO_CUMULATIVO,
  PIS_CUMULATIVO,
  PIS_NAO_CUMULATIVO,
  calcularLucroPresumido,
  calcularLucroReal,
} from './regime-normal';

// Comércio em São Paulo: presunção de 8% (IRPJ) e 12% (CSLL), ICMS interno 18%.
const COMERCIO_SP = { icmsAliquota: 0.18, presuncaoIrpj: 0.08, presuncaoCsll: 0.12 };

describe('Lucro Presumido', () => {
  it('soma PIS, Cofins, ICMS, IRPJ e CSLL — todos proporcionais à receita', () => {
    const r = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 100_000 });

    // IRPJ: 8% de presunção × 15% = 1,20%
    expect(r.breakdown.irpj).toBeCloseTo(0.012, 10);
    // CSLL: 12% de presunção × 9% = 1,08%
    expect(r.breakdown.csll).toBeCloseTo(0.0108, 10);
    expect(r.breakdown.pis).toBe(PIS_CUMULATIVO);
    expect(r.breakdown.cofins).toBe(COFINS_CUMULATIVO);
  });

  // Federal sem o adicional: 0,65 + 3,00 + 1,20 + 1,08 = 5,93%.
  it('fecha em 5,93% de carga federal no comércio', () => {
    const r = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 100_000 });
    expect(r.effectiveRate - r.breakdown.icms).toBeCloseTo(0.0593, 10);
  });

  describe('adicional de IRPJ — é escalão, não alíquota linear', () => {
    // Base presumida = receita × 8%. O limite é R$ 20.000/mês de BASE, ou seja
    // R$ 250.000/mês de receita no comércio.
    it('não incide abaixo de R$ 250.000/mês de receita', () => {
      const r = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 249_000 });
      expect(r.breakdown.irpjAdicional).toBe(0);
    });

    it('incide acima de R$ 250.000/mês de receita', () => {
      const r = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 251_000 });
      // 8% de presunção × 10% de adicional = 0,80% a mais sobre a receita.
      expect(r.breakdown.irpjAdicional).toBeCloseTo(0.008, 10);
    });

    it('o degrau vale exatamente 0,80 ponto percentual no comércio', () => {
      const abaixo = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 249_000 });
      const acima = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 251_000 });
      expect(acima.effectiveRate - abaixo.effectiveRate).toBeCloseTo(0.008, 10);
    });

    // Em serviços a presunção é 32%, então o limite de base é atingido com
    // receita bem menor — R$ 62.500/mês.
    it('o limiar de receita depende da presunção da atividade', () => {
      const servicos = { icmsAliquota: 0, presuncaoIrpj: 0.32, presuncaoCsll: 0.32 };
      expect(
        calcularLucroPresumido({ ...servicos, receitaMensalReferencia: 62_000 }).breakdown.irpjAdicional,
      ).toBe(0);
      expect(
        calcularLucroPresumido({ ...servicos, receitaMensalReferencia: 63_000 }).breakdown.irpjAdicional,
      ).toBeCloseTo(0.032, 10);
    });
  });

  // Regime cumulativo: PIS/Cofins não geram crédito. Só o ICMS volta.
  it('credita apenas o ICMS — o regime cumulativo não gera crédito de PIS/Cofins', () => {
    const r = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 100_000 });
    expect(r.creditableRate).toBe(0.18);
  });
});

describe('Lucro Real', () => {
  it('soma apenas PIS, Cofins não cumulativos e ICMS', () => {
    const r = calcularLucroReal({ icmsAliquota: 0.18 });

    expect(r.breakdown.pis).toBe(PIS_NAO_CUMULATIVO);
    expect(r.breakdown.cofins).toBe(COFINS_NAO_CUMULATIVO);
    expect(r.effectiveRate).toBeCloseTo(0.0165 + 0.076 + 0.18, 10);
  });

  // O ponto central do regime, e o que mais se erra: IRPJ e CSLL incidem sobre
  // o LUCRO apurado, não sobre a receita. Colocá-los no piso trataria imposto
  // sobre resultado como custo de transação — art. 187, V da Lei 6.404/1976.
  it('NÃO inclui IRPJ nem CSLL — eles incidem sobre o lucro, não sobre a receita', () => {
    const r = calcularLucroReal({ icmsAliquota: 0.18 });
    expect(r.breakdown.irpj).toBeUndefined();
    expect(r.breakdown.csll).toBeUndefined();
    expect(r.breakdown.irpjAdicional).toBeUndefined();
  });

  it('credita PIS, Cofins e ICMS — 9,25% a mais que o Presumido', () => {
    const real = calcularLucroReal({ icmsAliquota: 0.18 });
    const presumido = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 100_000 });
    expect(real.creditableRate - presumido.creditableRate).toBeCloseTo(0.0925, 10);
  });
});

describe('comparação entre os regimes normais', () => {
  // O Real tem alíquota nominal de PIS/Cofins muito maior (9,25% contra
  // 3,65%), mas devolve tudo isso em crédito na compra. Quem compra de
  // fornecedor do regime normal pode pagar menos no Real mesmo com a alíquota
  // maior — é a conta que o comparador de regime (§4.5 do doc) vai fazer.
  it('o Lucro Real tem alíquota maior e crédito maior', () => {
    const real = calcularLucroReal({ icmsAliquota: 0.18 });
    const presumido = calcularLucroPresumido({ ...COMERCIO_SP, receitaMensalReferencia: 100_000 });

    expect(real.breakdown.pis + real.breakdown.cofins).toBeGreaterThan(
      presumido.breakdown.pis + presumido.breakdown.cofins,
    );
    expect(real.creditableRate).toBeGreaterThan(presumido.creditableRate);
  });
});
