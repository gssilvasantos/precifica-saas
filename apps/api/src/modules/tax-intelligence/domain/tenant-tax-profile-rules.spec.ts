import { PerfilTributarioInput, isUf, validarPerfilTributario } from './tenant-tax-profile-rules';

const BASE: PerfilTributarioInput = {
  uf: 'SP',
  regime: 'SIMPLES_NACIONAL',
  anexo: 'I',
  vigenciaInicio: new Date('2026-01-01T00:00:00Z'),
  meiValorFixoMensal: null,
  icmsAliquotaPct: null,
  presuncaoIrpjPct: null,
  presuncaoCsllPct: null,
};

function campos(input: Partial<PerfilTributarioInput>): string[] {
  return validarPerfilTributario({ ...BASE, ...input }).map((p) => p.campo);
}

describe('validarPerfilTributario', () => {
  it('aceita Simples com anexo e sem ICMS separado', () => {
    expect(validarPerfilTributario(BASE)).toEqual([]);
  });

  it('reporta TODOS os campos inválidos de uma vez, não só o primeiro', () => {
    // Regra do projeto: erro de validação devolve todos os campos inválidos.
    const problemas = validarPerfilTributario({
      ...BASE,
      uf: 'XX',
      regime: 'LUCRO_PRESUMIDO',
      anexo: 'III',
      icmsAliquotaPct: null,
    });

    expect(problemas.map((p) => p.campo).sort()).toEqual(
      ['anexo', 'icmsAliquotaPct', 'presuncaoCsllPct', 'presuncaoIrpjPct', 'uf'].sort(),
    );
  });

  describe('Simples Nacional', () => {
    it('exige anexo — sem ele o resolver não tem tabela de faixas', () => {
      expect(campos({ anexo: null })).toContain('anexo');
    });

    it('recusa alíquota de ICMS separada — já está na partilha do DAS', () => {
      expect(campos({ icmsAliquotaPct: 18 })).toContain('icmsAliquotaPct');
    });
  });

  describe('MEI', () => {
    const MEI: Partial<PerfilTributarioInput> = { regime: 'MEI_SIMEI', anexo: null };

    it('exige o valor fixo mensal — nenhum percentual está certo para MEI', () => {
      expect(campos({ ...MEI, meiValorFixoMensal: null })).toContain('meiValorFixoMensal');
    });

    it('aceita com o DAS fixo informado', () => {
      expect(campos({ ...MEI, meiValorFixoMensal: 76.9 })).toEqual([]);
    });

    it('recusa valor zero ou negativo', () => {
      expect(campos({ ...MEI, meiValorFixoMensal: 0 })).toContain('meiValorFixoMensal');
      expect(campos({ ...MEI, meiValorFixoMensal: -10 })).toContain('meiValorFixoMensal');
    });

    it('recusa anexo — MEI não tem anexo do Simples', () => {
      expect(campos({ regime: 'MEI_SIMEI', anexo: 'I', meiValorFixoMensal: 76.9 })).toContain('anexo');
    });
  });

  describe('regime normal', () => {
    it('Lucro Presumido exige ICMS e as duas presunções', () => {
      expect(campos({ regime: 'LUCRO_PRESUMIDO', anexo: null }).sort()).toEqual(
        ['icmsAliquotaPct', 'presuncaoCsllPct', 'presuncaoIrpjPct'].sort(),
      );
    });

    it('Lucro Presumido completo é válido', () => {
      expect(
        campos({
          regime: 'LUCRO_PRESUMIDO',
          anexo: null,
          icmsAliquotaPct: 18,
          presuncaoIrpjPct: 8,
          presuncaoCsllPct: 12,
        }),
      ).toEqual([]);
    });

    it('Lucro Real exige ICMS mas NÃO exige presunção', () => {
      // Presunção é conceito do Presumido; no Real o lucro é o apurado.
      expect(campos({ regime: 'LUCRO_REAL', anexo: null, icmsAliquotaPct: 18 })).toEqual([]);
    });
  });

  describe('UF', () => {
    it('aceita as 27 unidades federativas', () => {
      expect(isUf('SP')).toBe(true);
      expect(isUf('DF')).toBe(true);
      expect(isUf('TO')).toBe(true);
    });

    it('recusa o que não é UF', () => {
      expect(isUf('XX')).toBe(false);
      expect(isUf('sp')).toBe(false); // normalização é responsabilidade da fronteira
      expect(campos({ uf: 'Brasil' })).toContain('uf');
    });
  });
});
