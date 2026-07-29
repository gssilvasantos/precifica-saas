import {
  CarrierServiceForMatching,
  isValidAutomationCode,
  matchCarrierServiceByFormaEnvio,
  normalizeCarrierAlias,
  resolveFormaEnvioForService,
} from './carrier-catalog';

function buildService(overrides: Partial<CarrierServiceForMatching> = {}): CarrierServiceForMatching {
  return {
    id: 'service-1',
    carrierId: 'carrier-1',
    name: 'Correios',
    aliases: [],
    isActive: true,
    ...overrides,
  };
}

describe('normalizeCarrierAlias', () => {
  it('coloca em caixa alta, remove acentos e troca espaços por underscore', () => {
    expect(normalizeCarrierAlias('Correios')).toBe('CORREIOS');
    expect(normalizeCarrierAlias(' correios ')).toBe('CORREIOS');
    expect(normalizeCarrierAlias('Retirar Pessoalmente')).toBe('RETIRAR_PESSOALMENTE');
    expect(normalizeCarrierAlias('Jadlog Package')).toBe('JADLOG_PACKAGE');
  });

  it('é idempotente e insensível a variações de acentuação', () => {
    expect(normalizeCarrierAlias('Correios')).toBe(normalizeCarrierAlias('CORREIOS'));
  });
});

describe('matchCarrierServiceByFormaEnvio', () => {
  it('bate pelo NOME do serviço (normalizado)', () => {
    const services = [buildService({ name: 'Jadlog Package' })];
    const match = matchCarrierServiceByFormaEnvio('JADLOG_PACKAGE', services);
    expect(match).toEqual({
      carrierServiceId: 'service-1',
      carrierId: 'carrier-1',
      matchedBy: 'NAME',
      matchedValue: 'Jadlog Package',
    });
  });

  it('bate por ALIAS quando o nome não bate diretamente', () => {
    const services = [buildService({ name: 'Jadlog .Package', aliases: ['JADLOG_PACKAGE', 'JADLOG_PKG'] })];
    const match = matchCarrierServiceByFormaEnvio('JADLOG_PKG', services);
    expect(match).toEqual({
      carrierServiceId: 'service-1',
      carrierId: 'carrier-1',
      matchedBy: 'ALIAS',
      matchedValue: 'JADLOG_PKG',
    });
  });

  it('ignora serviços inativos, mesmo que o nome/alias bata', () => {
    const services = [buildService({ isActive: false, aliases: ['CORREIOS'] })];
    expect(matchCarrierServiceByFormaEnvio('CORREIOS', services)).toBeNull();
  });

  it('retorna null quando nenhum serviço bate — nunca lança', () => {
    const services = [buildService({ name: 'Jadlog' })];
    expect(matchCarrierServiceByFormaEnvio('TRANSPORTADORA_DESCONHECIDA', services)).toBeNull();
  });

  it('prioriza match por NOME mesmo se outro serviço bate por ALIAS', () => {
    const services = [
      buildService({ id: 'service-2', name: 'Outro Serviço', aliases: ['CORREIOS'] }),
      buildService({ id: 'service-1', name: 'Correios', aliases: [] }),
    ];
    const match = matchCarrierServiceByFormaEnvio('CORREIOS', services);
    expect(match?.matchedBy).toBe('NAME');
    expect(match?.carrierServiceId).toBe('service-1');
  });
});

describe('resolveFormaEnvioForService', () => {
  it('retorna o nome do serviço normalizado', () => {
    expect(resolveFormaEnvioForService({ name: 'Jadlog Package' })).toBe('JADLOG_PACKAGE');
  });
});

describe('isValidAutomationCode', () => {
  it('aceita null/undefined/string vazia (automação opcional)', () => {
    expect(isValidAutomationCode(null)).toBe(true);
    expect(isValidAutomationCode(undefined)).toBe(true);
    expect(isValidAutomationCode('')).toBe(true);
  });

  it('aceita código conhecido de resolveLabelStrategy (case-insensitive)', () => {
    expect(isValidAutomationCode('CORREIOS')).toBe(true);
    expect(isValidAutomationCode('correios')).toBe(true);
    expect(isValidAutomationCode('MELHOR_ENVIO')).toBe(true);
  });

  it('rejeita código não mapeado — nunca cria automação fantasma', () => {
    expect(isValidAutomationCode('CODIGO_INVENTADO')).toBe(false);
  });
});
