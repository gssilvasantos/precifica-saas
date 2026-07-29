import {
  isValidCfopCode,
  isValidNaturezaOperacaoCfopConfig,
  isValidReferencedDocuments,
  NaturezaOperacaoCfopConfig,
  requiresReferencedDocument,
  resolveCfop,
  resolveCfopFromNatureza,
  resolveNfeFinalidadeCode,
} from './tax-code-resolver';

describe('resolveCfop', () => {
  it('retorna 5102 (venda interna) quando emitente e destinatário são do mesmo estado', () => {
    expect(resolveCfop('SP', 'SP')).toBe('5102');
  });

  it('é insensível a caixa e espaços', () => {
    expect(resolveCfop(' sp ', 'Sp')).toBe('5102');
  });

  it('retorna 6102 (venda interestadual) quando estados diferem', () => {
    expect(resolveCfop('SP', 'RJ')).toBe('6102');
  });

  // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2) — CFOP de devolução muda; Complementar/Ajuste mantêm o CFOP
  // de venda normal (a nota referencia, mas não desfaz, a operação original).
  it('finalidade NORMAL (default, sem argumento): mantém 5102/6102', () => {
    expect(resolveCfop('SP', 'SP')).toBe('5102');
    expect(resolveCfop('SP', 'RJ')).toBe('6102');
  });

  it('finalidade COMPLEMENTAR: mantém CFOP de venda normal', () => {
    expect(resolveCfop('SP', 'SP', 'COMPLEMENTAR')).toBe('5102');
    expect(resolveCfop('SP', 'RJ', 'COMPLEMENTAR')).toBe('6102');
  });

  it('finalidade AJUSTE: mantém CFOP de venda normal', () => {
    expect(resolveCfop('SP', 'SP', 'AJUSTE')).toBe('5102');
    expect(resolveCfop('SP', 'RJ', 'AJUSTE')).toBe('6102');
  });

  it('finalidade DEVOLUCAO: usa 5202 (interna) / 6202 (interestadual)', () => {
    expect(resolveCfop('SP', 'SP', 'DEVOLUCAO')).toBe('5202');
    expect(resolveCfop('SP', 'RJ', 'DEVOLUCAO')).toBe('6202');
  });
});

describe('resolveCfopFromNatureza', () => {
  function buildConfig(overrides: Partial<NaturezaOperacaoCfopConfig> = {}): NaturezaOperacaoCfopConfig {
    return {
      cfopVendaInterno: '5405',
      cfopVendaInterestadual: '6404',
      ...overrides,
    };
  }

  it('usa o CFOP de venda customizado da natureza (interno/interestadual)', () => {
    const config = buildConfig();
    expect(resolveCfopFromNatureza(config, 'SP', 'SP')).toBe('5405');
    expect(resolveCfopFromNatureza(config, 'SP', 'RJ')).toBe('6404');
  });

  it('finalidade COMPLEMENTAR/AJUSTE: mantém o CFOP de venda customizado', () => {
    const config = buildConfig();
    expect(resolveCfopFromNatureza(config, 'SP', 'SP', 'COMPLEMENTAR')).toBe('5405');
    expect(resolveCfopFromNatureza(config, 'SP', 'RJ', 'AJUSTE')).toBe('6404');
  });

  it('finalidade DEVOLUCAO sem CFOP de devolução customizado: cai no fallback padrão (5202/6202)', () => {
    const config = buildConfig();
    expect(resolveCfopFromNatureza(config, 'SP', 'SP', 'DEVOLUCAO')).toBe('5202');
    expect(resolveCfopFromNatureza(config, 'SP', 'RJ', 'DEVOLUCAO')).toBe('6202');
  });

  it('finalidade DEVOLUCAO com CFOP de devolução customizado: usa o valor da natureza', () => {
    const config = buildConfig({ cfopDevolucaoInterno: '5411', cfopDevolucaoInterestadual: '6411' });
    expect(resolveCfopFromNatureza(config, 'SP', 'SP', 'DEVOLUCAO')).toBe('5411');
    expect(resolveCfopFromNatureza(config, 'SP', 'RJ', 'DEVOLUCAO')).toBe('6411');
  });
});

describe('isValidCfopCode', () => {
  it('aceita CFOP com exatamente 4 dígitos', () => {
    expect(isValidCfopCode('5102')).toBe(true);
    expect(isValidCfopCode(' 5102 ')).toBe(true);
  });

  it('rejeita CFOP com formato inválido', () => {
    expect(isValidCfopCode('510')).toBe(false);
    expect(isValidCfopCode('51022')).toBe(false);
    expect(isValidCfopCode('ABCD')).toBe(false);
    expect(isValidCfopCode('')).toBe(false);
  });
});

describe('isValidNaturezaOperacaoCfopConfig', () => {
  it('válido quando venda interno/interestadual são CFOPs de 4 dígitos e devolução ausente', () => {
    expect(isValidNaturezaOperacaoCfopConfig({ cfopVendaInterno: '5102', cfopVendaInterestadual: '6102' })).toBe(true);
  });

  it('válido quando devolução customizada também é um CFOP de 4 dígitos', () => {
    expect(
      isValidNaturezaOperacaoCfopConfig({
        cfopVendaInterno: '5102',
        cfopVendaInterestadual: '6102',
        cfopDevolucaoInterno: '5202',
        cfopDevolucaoInterestadual: '6202',
      }),
    ).toBe(true);
  });

  it('inválido quando o CFOP de venda tem formato errado', () => {
    expect(isValidNaturezaOperacaoCfopConfig({ cfopVendaInterno: '51', cfopVendaInterestadual: '6102' })).toBe(false);
  });

  it('inválido quando o CFOP de devolução customizado tem formato errado', () => {
    expect(
      isValidNaturezaOperacaoCfopConfig({
        cfopVendaInterno: '5102',
        cfopVendaInterestadual: '6102',
        cfopDevolucaoInterno: 'XXXX',
      }),
    ).toBe(false);
  });
});

describe('resolveNfeFinalidadeCode', () => {
  it('mapeia cada finalidade para o código Focus NFe/SEFAZ correspondente', () => {
    expect(resolveNfeFinalidadeCode('NORMAL')).toBe(1);
    expect(resolveNfeFinalidadeCode('COMPLEMENTAR')).toBe(2);
    expect(resolveNfeFinalidadeCode('AJUSTE')).toBe(3);
    expect(resolveNfeFinalidadeCode('DEVOLUCAO')).toBe(4);
  });
});

describe('requiresReferencedDocument', () => {
  it('NORMAL não exige documento referenciado', () => {
    expect(requiresReferencedDocument('NORMAL')).toBe(false);
  });

  it('COMPLEMENTAR/AJUSTE/DEVOLUCAO exigem documento referenciado', () => {
    expect(requiresReferencedDocument('COMPLEMENTAR')).toBe(true);
    expect(requiresReferencedDocument('AJUSTE')).toBe(true);
    expect(requiresReferencedDocument('DEVOLUCAO')).toBe(true);
  });
});

describe('isValidReferencedDocuments', () => {
  it('NORMAL: válido mesmo sem nenhum documento informado', () => {
    expect(isValidReferencedDocuments('NORMAL', undefined)).toBe(true);
    expect(isValidReferencedDocuments('NORMAL', [])).toBe(true);
  });

  it('DEVOLUCAO sem documento nenhum: inválido', () => {
    expect(isValidReferencedDocuments('DEVOLUCAO', undefined)).toBe(false);
    expect(isValidReferencedDocuments('DEVOLUCAO', [])).toBe(false);
  });

  it('DEVOLUCAO com chave de acesso que não tem 44 dígitos: inválido', () => {
    expect(isValidReferencedDocuments('DEVOLUCAO', ['123'])).toBe(false);
  });

  it('DEVOLUCAO com chave de acesso válida (44 dígitos): válido', () => {
    expect(isValidReferencedDocuments('DEVOLUCAO', ['1'.repeat(44)])).toBe(true);
  });

  it('COMPLEMENTAR/AJUSTE seguem a mesma regra de DEVOLUCAO', () => {
    expect(isValidReferencedDocuments('COMPLEMENTAR', ['1'.repeat(44)])).toBe(true);
    expect(isValidReferencedDocuments('AJUSTE', undefined)).toBe(false);
  });
});
