import { classifyAbc, computeReplenishmentSuggestion } from './replenishment-advisor.entity';

describe('classifyAbc', () => {
  it('classifica pelo método de Pareto: os SKUs que somam até 80% do giro são A, até 95% são B, o resto C', () => {
    const result = classifyAbc([
      { skuCode: 'A1', unitsSoldInWindow: 80 }, // 80/100 = 80% -> A
      { skuCode: 'B1', unitsSoldInWindow: 15 }, // acumulado 95% -> B
      { skuCode: 'C1', unitsSoldInWindow: 5 }, // acumulado 100% -> C
    ]);

    expect(result.get('A1')).toBe('A');
    expect(result.get('B1')).toBe('B');
    expect(result.get('C1')).toBe('C');
  });

  it('giro total zero: todos os SKUs viram C (nenhum dado para priorizar)', () => {
    const result = classifyAbc([
      { skuCode: 'X', unitsSoldInWindow: 0 },
      { skuCode: 'Y', unitsSoldInWindow: 0 },
    ]);
    expect(result.get('X')).toBe('C');
    expect(result.get('Y')).toBe('C');
  });

  it('lista vazia: não lança, devolve mapa vazio', () => {
    expect(classifyAbc([]).size).toBe(0);
  });
});

describe('computeReplenishmentSuggestion', () => {
  it('giroDiario zero: status SEM_GIRO, sugestão sempre 0, cobertura null', () => {
    const result = computeReplenishmentSuggestion({
      giroDiario: 0,
      saldoFull: 10,
      saldoFisico: 100,
      leadTimeDays: 15,
      abcClass: 'A',
    });
    expect(result).toEqual({ coberturaDiasFull: null, sugestaoEnvio: 0, status: 'SEM_GIRO', physicalShortfall: false });
  });

  it('cobertura abaixo do lead time: CRITICO', () => {
    // giro 10/dia, saldoFull 50 -> cobre 5 dias, lead time 15 -> CRITICO
    const result = computeReplenishmentSuggestion({
      giroDiario: 10,
      saldoFull: 50,
      saldoFisico: 1000,
      leadTimeDays: 15,
      abcClass: 'A',
    });
    expect(result.status).toBe('CRITICO');
    expect(result.coberturaDiasFull).toBe(5);
  });

  it('cobertura entre lead time e lead time+segurança: ATENCAO', () => {
    // giro 10/dia, saldoFull 180 -> cobre 18 dias; lead time 15 + segurança A (7) = 22 -> ATENCAO
    const result = computeReplenishmentSuggestion({
      giroDiario: 10,
      saldoFull: 180,
      saldoFisico: 1000,
      leadTimeDays: 15,
      abcClass: 'A',
    });
    expect(result.status).toBe('ATENCAO');
  });

  it('cobertura já atinge o alvo (lead time + segurança): OK, sugestão 0', () => {
    // giro 10/dia, alvo = (15+7)*10 = 220; saldoFull 220 -> OK
    const result = computeReplenishmentSuggestion({
      giroDiario: 10,
      saldoFull: 220,
      saldoFisico: 1000,
      leadTimeDays: 15,
      abcClass: 'A',
    });
    expect(result.status).toBe('OK');
    expect(result.sugestaoEnvio).toBe(0);
  });

  it('sugestão nunca excede o saldo físico disponível, mesmo que o ideal seja maior', () => {
    // alvo ideal = (15+2)*10 - 0 = 170, mas só há 50 no físico
    const result = computeReplenishmentSuggestion({
      giroDiario: 10,
      saldoFull: 0,
      saldoFisico: 50,
      leadTimeDays: 15,
      abcClass: 'C',
    });
    expect(result.sugestaoEnvio).toBe(50);
    expect(result.physicalShortfall).toBe(true);
  });

  it('classe C tem menos estoque de segurança que classe A para o mesmo giro/saldo', () => {
    const base = { giroDiario: 10, saldoFull: 160, saldoFisico: 1000, leadTimeDays: 15 };
    const classA = computeReplenishmentSuggestion({ ...base, abcClass: 'A' }); // alvo 220
    const classC = computeReplenishmentSuggestion({ ...base, abcClass: 'C' }); // alvo 170

    expect(classA.sugestaoEnvio).toBeGreaterThan(classC.sugestaoEnvio);
  });

  it('sugestão arredonda para cima (nunca sugere fração de unidade)', () => {
    const result = computeReplenishmentSuggestion({
      giroDiario: 3,
      saldoFull: 10,
      saldoFisico: 1000,
      leadTimeDays: 15,
      abcClass: 'B',
    });
    // alvo = (15+4)*3 = 57; ideal = 47 -> sugestão inteira
    expect(Number.isInteger(result.sugestaoEnvio)).toBe(true);
  });
});
