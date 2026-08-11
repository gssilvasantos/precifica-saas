import {
  SIMPLES_ANEXOS,
  SimplesAnexo,
  calcularAliquotaEfetiva,
  calcularAliquotasPorTributo,
  calcularDas,
  resolveFaixa,
  segregarAliquota,
} from './simples-nacional';

// FIXTURE OFICIAL — não é caso sintético.
//
// Extrato do Simples Nacional, apuração ORIGINAL, PA 06/2026, gerado pelo
// PGDAS-D 2018 v2.2.29 em 20/07/2026. Estabelecimento em Pindamonhangaba/SP,
// Anexo I (revenda de mercadorias), sem ST e sem monofásico declarados.
//
// Este é o teste que decide se o resolver está certo: se ele não reproduzir
// estes números, está errado, por mais elegante que seja o código.
const EXTRATO_PGDAS_06_2026 = {
  receitaDoPeriodo: 188_817.8,
  rbt12: 605_574.89,
  das: {
    irpj: 748.89,
    csll: 476.57,
    cofins: 1_734.7,
    pisPasep: 375.81,
    cpp: 5_718.78,
    icms: 4_561.41,
    total: 13_616.16,
  },
};

describe('Simples Nacional — Anexo I', () => {
  describe('contra o extrato oficial do PGDAS-D (PA 06/2026)', () => {
    const { receitaDoPeriodo, rbt12, das } = EXTRATO_PGDAS_06_2026;

    it('enquadra o RBT12 na 3ª faixa', () => {
      const faixa = resolveFaixa('I', rbt12);
      expect(faixa.ordem).toBe(3);
      expect(faixa.aliquotaNominal).toBe(0.095);
      expect(faixa.parcelaDeduzir).toBe(13_860);
    });

    it('calcula a alíquota efetiva de 7,2113%', () => {
      const faixa = resolveFaixa('I', rbt12);
      const efetiva = calcularAliquotaEfetiva(rbt12, faixa);
      // (605.574,89 × 9,50% − 13.860) / 605.574,89 = 7,211265736...%
      expect(efetiva).toBeCloseTo(0.0721126574, 9);
    });

    it('reproduz o DAS oficial ao centavo, tributo a tributo', () => {
      const faixa = resolveFaixa('I', rbt12);
      const efetiva = calcularAliquotaEfetiva(rbt12, faixa);
      const { porTributo, total } = calcularDas(receitaDoPeriodo, efetiva, faixa.partilha);

      expect(porTributo.irpj).toBe(das.irpj);
      expect(porTributo.csll).toBe(das.csll);
      expect(porTributo.cofins).toBe(das.cofins);
      expect(porTributo.pisPasep).toBe(das.pisPasep);
      expect(porTributo.cpp).toBe(das.cpp);
      expect(porTributo.icms).toBe(das.icms);
      expect(total).toBe(das.total);
    });

    // Guarda de regressão para a ordem das operações documentada em
    // calcularDas: arredondar o total antes de repartir daria 13.616,15.
    it('soma os tributos arredondados em vez de arredondar o total', () => {
      const faixa = resolveFaixa('I', rbt12);
      const efetiva = calcularAliquotaEfetiva(rbt12, faixa);
      const totalIngenuo = Math.round(receitaDoPeriodo * efetiva * 100) / 100;

      expect(totalIngenuo).toBe(13_616.15);
      expect(calcularDas(receitaDoPeriodo, efetiva, faixa.partilha).total).toBe(13_616.16);
    });
  });

  describe('enquadramento nas faixas', () => {
    it.each([
      [0, 1],
      [180_000, 1],
      [180_000.01, 2],
      [360_000, 2],
      [360_000.01, 3],
      [720_000, 3],
      [720_000.01, 4],
      [1_800_000, 4],
      [1_800_000.01, 5],
      [3_600_000, 5],
    ])('RBT12 de %p cai na %pª faixa', (rbt12, ordem) => {
      expect(resolveFaixa('I', rbt12).ordem).toBe(ordem);
    });

    it('usa a 6ª faixa acima do sublimite', () => {
      const faixa = resolveFaixa('I', 4_000_000);
      expect(faixa.ordem).toBe(6);
      expect(faixa.aliquotaNominal).toBe(0.19);
      expect(faixa.parcelaDeduzir).toBe(378_000);
      // Acima do sublimite o ICMS sai do DAS e vai para guia própria.
      expect(faixa.partilha.icms).toBeUndefined();
    });
  });

  describe('alíquota efetiva', () => {
    // Exemplo do Manual do PGDAS-D: RBT12 1.500.000 no Anexo I → 9,2%.
    it('reproduz o exemplo do Manual (RBT12 1.500.000 → 9,2%)', () => {
      const faixa = resolveFaixa('I', 1_500_000);
      expect(calcularAliquotaEfetiva(1_500_000, faixa)).toBeCloseTo(0.092, 6);
    });

    // Exemplo do Manual: RBT12 660.000 no Anexo I → 7,40%.
    it('reproduz o exemplo do Manual (RBT12 660.000 → 7,40%)', () => {
      const faixa = resolveFaixa('I', 660_000);
      expect(calcularAliquotaEfetiva(660_000, faixa)).toBeCloseTo(0.074, 6);
    });

    // Perguntas e Respostas 5.3: RBT12 220.000 → 4,60%.
    it('reproduz o exemplo das Perguntas e Respostas (RBT12 220.000 → 4,60%)', () => {
      const faixa = resolveFaixa('I', 220_000);
      expect(calcularAliquotaEfetiva(220_000, faixa)).toBeCloseTo(0.046, 6);
    });

    // Na 1ª faixa a parcela a deduzir é zero, então efetiva = nominal.
    it('devolve a nominal na 1ª faixa', () => {
      const faixa = resolveFaixa('I', 100_000);
      expect(calcularAliquotaEfetiva(100_000, faixa)).toBe(0.04);
    });

    // RBT12 zero é real: empresa recém-migrada do MEI com o quadro de receitas
    // anteriores zerado, ou primeiro mês. Não pode dividir por zero.
    it('não divide por zero quando o RBT12 é zero', () => {
      const faixa = resolveFaixa('I', 0);
      expect(calcularAliquotaEfetiva(0, faixa)).toBe(0.04);
    });
  });

  describe('segregação por produto (ST e monofásico)', () => {
    const faixa = resolveFaixa('I', 605_574.89); // 3ª faixa: ICMS 33,5%, PIS+Cofins 15,5%
    const efetiva = calcularAliquotaEfetiva(605_574.89, faixa);

    it('não altera nada quando o produto não tem ST nem monofásico', () => {
      const r = segregarAliquota(efetiva, faixa.partilha, { icmsSt: false, monofasico: false });
      expect(r.effectiveRate).toBe(efetiva);
      expect(r.removido).toEqual({ icms: 0, pisCofins: 0 });
    });

    it('remove a fatia do ICMS quando o produto tem ST', () => {
      const r = segregarAliquota(efetiva, faixa.partilha, { icmsSt: true, monofasico: false });
      expect(r.removido.icms).toBe(0.335);
      expect(r.effectiveRate).toBeCloseTo(efetiva * 0.665, 10);
    });

    // Cosméticos das NCM da Lei 10.147/2000 — PIS 2,76% + Cofins 12,74%.
    it('remove PIS e Cofins quando o produto é monofásico', () => {
      const r = segregarAliquota(efetiva, faixa.partilha, { icmsSt: false, monofasico: true });
      expect(r.removido.pisCofins).toBeCloseTo(0.155, 10);
      expect(r.effectiveRate).toBeCloseTo(efetiva * 0.845, 10);
    });

    it('acumula as duas remoções', () => {
      const r = segregarAliquota(efetiva, faixa.partilha, { icmsSt: true, monofasico: true });
      expect(r.effectiveRate).toBeCloseTo(efetiva * 0.51, 10);
      expect(r.aliquotaCheia).toBe(efetiva);
    });

    // A 6ª faixa não reparte ICMS; marcar ST não pode remover o que não existe.
    it('não remove ICMS de faixa que não o reparte', () => {
      const semIcms = { ...faixa.partilha, icms: undefined };
      const r = segregarAliquota(efetiva, semIcms, { icmsSt: true, monofasico: false });
      expect(r.removido.icms).toBe(0);
      expect(r.effectiveRate).toBe(efetiva);
    });
  });

  describe('integridade das cinco tabelas (Anexos I a V da LC 123/2006)', () => {
    const anexos = Object.keys(SIMPLES_ANEXOS) as SimplesAnexo[];

    it.each(anexos)('toda partilha do Anexo %s soma 100%%', (anexo) => {
      for (const faixa of SIMPLES_ANEXOS[anexo]) {
        const soma = Object.values(faixa.partilha).reduce<number>((acc, pct) => acc + (pct ?? 0), 0);
        expect(soma).toBeCloseTo(1, 10);
      }
    });

    it.each(anexos)('o Anexo %s tem 6 faixas com os mesmos limites de receita', (anexo) => {
      expect(SIMPLES_ANEXOS[anexo].map((f) => f.rbt12Max)).toEqual([
        180_000,
        360_000,
        720_000,
        1_800_000,
        3_600_000,
        null,
      ]);
    });

    it.each(anexos)('as alíquotas nominais do Anexo %s são crescentes', (anexo) => {
      const faixas = SIMPLES_ANEXOS[anexo];
      for (let i = 1; i < faixas.length; i++) {
        expect(faixas[i].aliquotaNominal).toBeGreaterThan(faixas[i - 1].aliquotaNominal);
      }
    });

    // A alíquota efetiva é contínua no salto de faixa — é exatamente para isso
    // que a parcela a deduzir existe. Vale como verificação de transcrição: uma
    // PD digitada errada aparece aqui como degrau.
    //
    // O limite de 3.600.000 fica FORA: ali a continuidade não existe, e não
    // deveria — ver o teste seguinte.
    it.each(anexos)('a alíquota efetiva do Anexo %s é contínua da 1ª à 5ª faixa', (anexo) => {
      for (const limite of [180_000, 360_000, 720_000, 1_800_000]) {
        const antes = calcularAliquotaEfetiva(limite, resolveFaixa(anexo, limite));
        const depois = calcularAliquotaEfetiva(limite + 0.01, resolveFaixa(anexo, limite + 0.01));
        expect(Math.abs(depois - antes)).toBeLessThan(0.0005);
      }
    });

    // No sublimite (R$ 3,6 mi) a alíquota efetiva CAI — e isso é a lei, não
    // erro de transcrição. Acima dele o ICMS (ou o ISS) sai do DAS e passa a
    // guia própria, então a 6ª faixa é calibrada para uma composição de
    // tributos menor. A carga total do contribuinte não cai: ela muda de guia.
    //
    // Registrado como teste porque a leitura ingênua ("alíquota sempre sobe")
    // levaria alguém a "consertar" a tabela um dia.
    it.each(anexos)('a alíquota efetiva do Anexo %s DEGRAU para baixo no sublimite', (anexo) => {
      const naQuinta = calcularAliquotaEfetiva(3_600_000, resolveFaixa(anexo, 3_600_000));
      const naSexta = calcularAliquotaEfetiva(3_600_000.01, resolveFaixa(anexo, 3_600_000.01));
      expect(naSexta).toBeLessThan(naQuinta);
    });

    // Particularidades que distinguem os Anexos — se alguma sumir numa
    // refatoração, a tabela foi transcrita errado.
    it('só o Anexo II tem IPI', () => {
      expect(SIMPLES_ANEXOS.II[0].partilha.ipi).toBe(0.075);
      for (const anexo of ['I', 'III', 'IV', 'V'] as SimplesAnexo[]) {
        expect(SIMPLES_ANEXOS[anexo].every((f) => f.partilha.ipi === undefined)).toBe(true);
      }
    });

    it('o Anexo IV não reparte CPP — a previdenciária é recolhida fora do DAS', () => {
      expect(SIMPLES_ANEXOS.IV.every((f) => f.partilha.cpp === undefined)).toBe(true);
    });

    it('os Anexos de serviço repartem ISS, os de mercadoria repartem ICMS', () => {
      for (const anexo of ['III', 'IV', 'V'] as SimplesAnexo[]) {
        expect(SIMPLES_ANEXOS[anexo][0].partilha.iss).toBeGreaterThan(0);
        expect(SIMPLES_ANEXOS[anexo][0].partilha.icms).toBeUndefined();
      }
      for (const anexo of ['I', 'II'] as SimplesAnexo[]) {
        expect(SIMPLES_ANEXOS[anexo][0].partilha.icms).toBeGreaterThan(0);
        expect(SIMPLES_ANEXOS[anexo][0].partilha.iss).toBeUndefined();
      }
    });
  });

  // Art. 18, §1º-B, I — o teto incide sobre o PERCENTUAL EFETIVO do ISS, não
  // sobre a repartição. A própria lei publica os limiares e os coeficientes de
  // redistribuição, o que dá um gabarito exato para testar.
  describe('teto de 5% no ISS', () => {
    it('não morde enquanto o ISS efetivo estiver em 5% ou menos', () => {
      const faixa = resolveFaixa('III', 200_000); // repartição de ISS: 32%
      const efetiva = calcularAliquotaEfetiva(200_000, faixa);
      const porTributo = calcularAliquotasPorTributo(efetiva, faixa.partilha);

      expect(efetiva * 0.32).toBeLessThan(0.05);
      expect(porTributo.iss).toBeCloseTo(efetiva * 0.32, 10);
    });

    // A lei: "na 5a faixa, quando a alíquota efetiva for superior a 14,92537%".
    // 14,92537% = 0,05 / 0,335, a repartição de ISS da 5ª faixa do Anexo III.
    it('reproduz o limiar publicado para o Anexo III (14,92537%)', () => {
      expect(0.05 / SIMPLES_ANEXOS.III[4].partilha.iss!).toBeCloseTo(0.1492537, 7);
    });

    it('reproduz o limiar publicado para o Anexo IV (12,5%)', () => {
      expect(0.05 / SIMPLES_ANEXOS.IV[4].partilha.iss!).toBeCloseTo(0.125, 7);
    });

    // Os coeficientes publicados na LC 123 são a proporção que cada tributo
    // federal guarda entre si, arredondada a duas casas de percentual e
    // ajustada para fechar em 100%. Por isso a comparação é a 3 casas: o
    // cálculo usa a proporção exata; a lei publica a versão arredondada.
    //
    // No Anexo IV, por exemplo, PIS = 3,92/60,00 = 6,5333%, e a lei publica
    // 6,54% para que 31,33 + 32,00 + 30,13 + 6,54 dê exatamente 100.
    const PRECISAO_COEFICIENTE_PUBLICADO = 3;

    // LC 123, Anexo III, 5ª faixa:
    // IRPJ 6,02% · CSLL 5,26% · Cofins 19,28% · PIS 4,18% · CPP 65,26%.
    it('redistribui o excedente com os coeficientes publicados (Anexo III, 5ª faixa)', () => {
      const faixa = SIMPLES_ANEXOS.III[4];
      const efetiva = 0.18; // acima de 14,92537%
      const porTributo = calcularAliquotasPorTributo(efetiva, faixa.partilha);
      const restante = efetiva - 0.05;

      expect(porTributo.iss).toBe(0.05);
      expect(porTributo.irpj! / restante).toBeCloseTo(0.0602, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.csll! / restante).toBeCloseTo(0.0526, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.cofins! / restante).toBeCloseTo(0.1928, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.pisPasep! / restante).toBeCloseTo(0.0418, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.cpp! / restante).toBeCloseTo(0.6526, PRECISAO_COEFICIENTE_PUBLICADO);
    });

    // LC 123, Anexo IV, 5ª faixa:
    // IRPJ 31,33% · CSLL 32,00% · Cofins 30,13% · PIS 6,54%.
    it('redistribui o excedente com os coeficientes publicados (Anexo IV, 5ª faixa)', () => {
      const faixa = SIMPLES_ANEXOS.IV[4];
      const efetiva = 0.2;
      const porTributo = calcularAliquotasPorTributo(efetiva, faixa.partilha);
      const restante = efetiva - 0.05;

      expect(porTributo.iss).toBe(0.05);
      expect(porTributo.irpj! / restante).toBeCloseTo(0.3133, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.csll! / restante).toBeCloseTo(0.32, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.cofins! / restante).toBeCloseTo(0.3013, PRECISAO_COEFICIENTE_PUBLICADO);
      expect(porTributo.pisPasep! / restante).toBeCloseTo(0.0654, PRECISAO_COEFICIENTE_PUBLICADO);
    });

    it('preserva a alíquota total quando o teto morde', () => {
      const faixa = SIMPLES_ANEXOS.III[4];
      const efetiva = 0.18;
      const soma = Object.values(calcularAliquotasPorTributo(efetiva, faixa.partilha)).reduce(
        (acc, v) => acc + v,
        0,
      );
      expect(soma).toBeCloseTo(efetiva, 10);
    });
  });
});
