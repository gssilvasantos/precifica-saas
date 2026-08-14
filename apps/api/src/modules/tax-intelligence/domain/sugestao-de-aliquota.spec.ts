import { calcularSugestao, medirFolga } from './sugestao-de-aliquota';

// O caso que originou a funcionalidade: lojista usa 7,30% enquanto o RBT12
// calcula 7,21% — folga de 0,09 mantida de propósito, como margem de
// segurança. O sistema não deve incomodá-lo enquanto essa folga existir, e
// deve avisar no instante em que ela desaparecer.

describe('medirFolga', () => {
  it('mede a folga do próprio comportamento do lojista', () => {
    expect(medirFolga(7.3, 7.21)).toBe(0.09);
  });

  it('folga negativa vira zero — não existe "margem de segurança para baixo"', () => {
    // Se o número dele já está abaixo do calculado, preservar a "folga"
    // significaria sugerir uma subestimativa.
    expect(medirFolga(7.0, 7.21)).toBe(0);
  });

  it('sem diferença, folga zero', () => {
    expect(medirFolga(7.21, 7.21)).toBe(0);
  });
});

describe('calcularSugestao', () => {
  it('silencia enquanto a folga do lojista ainda existe', () => {
    // 7,30 acima de 7,21: ele está seguro. Alertar aqui treinaria a pessoa a
    // ignorar o alerta.
    expect(
      calcularSugestao({ aliquotaManualPct: 7.3, aliquotaCalculadaPct: 7.21, folgaPctPontos: 0.09 }),
    ).toBeNull();
  });

  it('sugere quando o calculado passa do número em uso, preservando a folga', () => {
    // O cenário do crescimento: faturamento sobe de faixa, calculado vai a
    // 7,80 e ultrapassa os 7,30 dele.
    const s = calcularSugestao({ aliquotaManualPct: 7.3, aliquotaCalculadaPct: 7.8, folgaPctPontos: 0.09 });

    expect(s).not.toBeNull();
    expect(s!.atualPct).toBe(7.3);
    expect(s!.calculadaPct).toBe(7.8);
    // 7,80 + 0,09 — a mesma folga que ele já mantinha.
    expect(s!.sugeridaPct).toBe(7.89);
    expect(s!.folgaPreservadaPctPontos).toBe(0.09);
    // Ele está 0,50 ponto ABAIXO do devido — a exposição real.
    expect(s!.defasagemPctPontos).toBe(0.5);
  });

  it('empate exato não sugere — a folga zerou mas não inverteu', () => {
    expect(
      calcularSugestao({ aliquotaManualPct: 7.21, aliquotaCalculadaPct: 7.21, folgaPctPontos: 0 }),
    ).toBeNull();
  });

  it('sem alíquota manual, não há o que sugerir', () => {
    // Quem não sobrescreveu já usa a calculada; ela se ajusta sozinha.
    expect(
      calcularSugestao({ aliquotaManualPct: null, aliquotaCalculadaPct: 9.5, folgaPctPontos: 0 }),
    ).toBeNull();
  });

  it('sem folga histórica, sugere o calculado puro', () => {
    const s = calcularSugestao({ aliquotaManualPct: 7.0, aliquotaCalculadaPct: 7.21, folgaPctPontos: 0 });

    expect(s!.sugeridaPct).toBe(7.21);
    expect(s!.defasagemPctPontos).toBe(0.21);
  });

  it('arredonda para 2 casas — a precisão da coluna no banco', () => {
    // Sugerir 7,8899999 produziria uma sugestão que, depois de gravada como
    // DECIMAL(5,2), não bate com o número que foi mostrado na tela.
    const s = calcularSugestao({
      aliquotaManualPct: 7.3,
      aliquotaCalculadaPct: 7.799999,
      folgaPctPontos: 0.09,
    });

    expect(s!.sugeridaPct).toBe(7.89);
    expect(Number.isInteger(s!.sugeridaPct * 100)).toBe(true);
  });

  it('não sugere um número igual ou menor que o em uso', () => {
    // Sugestão que não muda nada é ruído; e sugestão para baixo contraria a
    // razão de a folga existir.
    const s = calcularSugestao({
      aliquotaManualPct: 7.3,
      aliquotaCalculadaPct: 7.301,
      folgaPctPontos: 0,
    });

    expect(s).toBeNull();
  });

  it('salto grande de faixa é sugerido inteiro, sem suavização', () => {
    // O sistema informa a realidade; suavizar seria decidir pelo lojista.
    const s = calcularSugestao({ aliquotaManualPct: 7.3, aliquotaCalculadaPct: 11.2, folgaPctPontos: 0.09 });

    expect(s!.sugeridaPct).toBe(11.29);
    expect(s!.defasagemPctPontos).toBe(3.9);
  });
});
