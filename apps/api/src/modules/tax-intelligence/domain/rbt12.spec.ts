import { Rbt12IncompletoError, calcularRbt12, chaveDeMes } from './rbt12';

const mes = (iso: string) => new Date(`${iso}-01T00:00:00.000Z`);

describe('RBT12', () => {
  const periodoApuracao = mes('2026-06');

  it('considera os 12 meses ANTERIORES ao período de apuração', () => {
    const { meses } = calcularRbt12({
      periodoApuracao,
      receitasDePedidos: [],
      receitasInformadas: Array.from({ length: 12 }, (_, i) => ({
        competencia: new Date(Date.UTC(2025, 5 + i, 1)),
        receita: 100,
      })),
      inicioDaCobertura: null,
    });

    expect(meses).toHaveLength(12);
    expect(meses[0].competencia).toBe('2025-06');
    expect(meses[11].competencia).toBe('2026-05');
    // O próprio mês da apuração nunca entra.
    expect(meses.map((m) => m.competencia)).not.toContain('2026-06');
  });

  // Reproduz o cenário do extrato oficial: empresa que era MEI até 2025
  // (receita informada) e passou a vender pelo Kyneti em 01/2026.
  it('mistura receita informada (período MEI) com pedidos do Kyneti', () => {
    const { rbt12, meses } = calcularRbt12({
      periodoApuracao,
      inicioDaCobertura: mes('2026-01'),
      receitasInformadas: [
        '2025-06',
        '2025-07',
        '2025-08',
        '2025-09',
        '2025-10',
        '2025-11',
        '2025-12',
      ].map((m) => ({ competencia: mes(m), receita: 0 })),
      receitasDePedidos: [
        { competencia: mes('2026-01'), receita: 99_033.94 },
        { competencia: mes('2026-02'), receita: 113_071.45 },
        { competencia: mes('2026-03'), receita: 117_148.36 },
        { competencia: mes('2026-04'), receita: 129_714.47 },
        { competencia: mes('2026-05'), receita: 146_606.67 },
      ],
    });

    expect(rbt12).toBeCloseTo(605_574.89, 2);
    expect(meses.filter((m) => m.origem === 'INFORMADA')).toHaveLength(7);
    expect(meses.filter((m) => m.origem === 'PEDIDOS_KYNETI')).toHaveLength(5);
  });

  it('trata mês sem pedido DENTRO da cobertura como faturamento zero', () => {
    const { rbt12, meses } = calcularRbt12({
      periodoApuracao,
      inicioDaCobertura: mes('2025-06'),
      receitasInformadas: [],
      receitasDePedidos: [{ competencia: mes('2026-05'), receita: 1_000 }],
    });

    expect(rbt12).toBe(1_000);
    expect(meses.every((m) => m.origem === 'PEDIDOS_KYNETI')).toBe(true);
  });

  // O caso que motivou o arquivo: assumir zero aqui produziria alíquota menor
  // que a devida, e imposto subestimado superestima margem.
  it('BLOQUEIA quando falta mês anterior à cobertura, em vez de assumir zero', () => {
    expect(() =>
      calcularRbt12({
        periodoApuracao,
        inicioDaCobertura: mes('2026-01'),
        receitasInformadas: [],
        receitasDePedidos: [{ competencia: mes('2026-01'), receita: 99_033.94 }],
      }),
    ).toThrow(Rbt12IncompletoError);
  });

  it('lista exatamente quais meses faltam', () => {
    try {
      calcularRbt12({
        periodoApuracao,
        inicioDaCobertura: mes('2026-04'),
        receitasInformadas: [{ competencia: mes('2025-06'), receita: 10 }],
        receitasDePedidos: [],
      });
      fail('deveria ter lançado');
    } catch (error) {
      const e = error as Rbt12IncompletoError;
      expect(e.mesesFaltantes).toEqual([
        '2025-07',
        '2025-08',
        '2025-09',
        '2025-10',
        '2025-11',
        '2025-12',
        '2026-01',
        '2026-02',
        '2026-03',
      ]);
    }
  });

  it('bloqueia tudo quando o tenant não tem nenhum pedido nem receita informada', () => {
    expect(() =>
      calcularRbt12({
        periodoApuracao,
        inicioDaCobertura: null,
        receitasInformadas: [],
        receitasDePedidos: [],
      }),
    ).toThrow(Rbt12IncompletoError);
  });

  it('dá precedência à receita informada sobre os pedidos (correção manual)', () => {
    const { rbt12, meses } = calcularRbt12({
      periodoApuracao,
      inicioDaCobertura: mes('2025-06'),
      receitasInformadas: [{ competencia: mes('2026-05'), receita: 5_000 }],
      receitasDePedidos: [{ competencia: mes('2026-05'), receita: 1_000 }],
    });

    expect(rbt12).toBe(5_000);
    expect(meses.find((m) => m.competencia === '2026-05')?.origem).toBe('INFORMADA');
  });

  it('soma linhas repetidas do mesmo mês (canais diferentes)', () => {
    const { rbt12 } = calcularRbt12({
      periodoApuracao,
      inicioDaCobertura: mes('2025-06'),
      receitasInformadas: [],
      receitasDePedidos: [
        { competencia: new Date('2026-05-03T00:00:00.000Z'), receita: 300 },
        { competencia: new Date('2026-05-27T00:00:00.000Z'), receita: 700 },
      ],
    });

    expect(rbt12).toBe(1_000);
  });

  // Janela que cruza o ano — erro clássico de aritmética de mês.
  it('atravessa a virada do ano corretamente', () => {
    const { meses } = calcularRbt12({
      periodoApuracao: mes('2026-01'),
      inicioDaCobertura: mes('2025-01'),
      receitasInformadas: [],
      receitasDePedidos: [],
    });

    expect(meses[0].competencia).toBe('2025-01');
    expect(meses[11].competencia).toBe('2025-12');
  });

  it('normaliza qualquer data do mês para a mesma chave', () => {
    expect(chaveDeMes(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03');
    expect(chaveDeMes(new Date('2026-03-31T23:59:59.999Z'))).toBe('2026-03');
  });
});
