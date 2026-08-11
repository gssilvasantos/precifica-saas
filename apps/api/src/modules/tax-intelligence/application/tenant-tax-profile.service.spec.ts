import { BadRequestException } from '@nestjs/common';
import { TenantTaxProfileService } from './tenant-tax-profile.service';
import { NovoPerfilTributario, TenantTaxProfileRecord } from './ports/tax-repositories.port';

const TENANT = 'tenant-1';

function registro(over: Partial<TenantTaxProfileRecord> = {}): TenantTaxProfileRecord {
  return {
    id: 'perfil-1',
    tenantId: TENANT,
    uf: 'SP',
    regime: 'SIMPLES_NACIONAL',
    anexo: 'I',
    vigenciaInicio: new Date('2026-01-01T00:00:00Z'),
    vigenciaFim: null,
    meiValorFixoMensal: null,
    icmsAliquota: null,
    presuncaoIrpj: null,
    presuncaoCsll: null,
    automationMode: 'AUTO',
    ...over,
  };
}

// Fake de porta, não mock de biblioteca: guarda o que recebeu para que o teste
// asserte sobre o COMPORTAMENTO, não sobre a chamada.
function construir(vigenteAtual: TenantTaxProfileRecord | null = null) {
  const recebido: NovoPerfilTributario[] = [];
  const repo = {
    findVigente: jest.fn().mockResolvedValue(vigenteAtual),
    listar: jest.fn().mockResolvedValue([]),
    abrirNovaVigencia: jest.fn(async (input: NovoPerfilTributario) => {
      recebido.push(input);
      return registro({ uf: input.uf, regime: input.regime, vigenciaInicio: input.vigenciaInicio });
    }),
  };
  return { service: new TenantTaxProfileService(repo as never), repo, recebido };
}

// Captura o erro esperado e ESTREITA o tipo. Também falha explicitamente se a
// operação tiver sucesso — um `.catch()` solto deixaria o teste passar em
// silêncio no dia em que a validação parasse de lançar.
async function capturarBadRequest(promessa: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof BadRequestException) return erro;
    throw erro;
  }
  throw new Error('Esperava BadRequestException, mas a operação foi concluída com sucesso.');
}

const SIMPLES_VALIDO = {
  uf: 'SP',
  regime: 'SIMPLES_NACIONAL' as const,
  anexo: 'I' as const,
  vigenciaInicio: new Date('2026-06-01T00:00:00Z'),
  meiValorFixoMensal: null,
  icmsAliquotaPct: null,
  presuncaoIrpjPct: null,
  presuncaoCsllPct: null,
  automationMode: 'AUTO' as const,
};

describe('TenantTaxProfileService', () => {
  it('grava um regime válido quando não havia nenhum', async () => {
    const { service, recebido } = construir(null);

    await service.definirRegime(TENANT, SIMPLES_VALIDO);

    expect(recebido).toHaveLength(1);
    expect(recebido[0].tenantId).toBe(TENANT);
    expect(recebido[0].regime).toBe('SIMPLES_NACIONAL');
  });

  it('normaliza a UF antes de validar, e grava só o valor normalizado', async () => {
    const { service, recebido } = construir(null);

    await service.definirRegime(TENANT, { ...SIMPLES_VALIDO, uf: ' sp ' });

    expect(recebido[0].uf).toBe('SP');
  });

  it('recusa configuração incoerente com o regime, listando TODOS os campos', async () => {
    const { service, repo } = construir(null);

    const erro = await capturarBadRequest(
      service.definirRegime(TENANT, {
        ...SIMPLES_VALIDO,
        regime: 'LUCRO_PRESUMIDO',
        anexo: null,
        icmsAliquotaPct: null,
      }),
    );

    const corpo = erro.getResponse() as { code: string; problemas: { campo: string }[] };
    expect(corpo.code).toBe('PERFIL_TRIBUTARIO_INVALIDO');
    expect(corpo.problemas.map((p) => p.campo).sort()).toEqual([
      'icmsAliquotaPct',
      'presuncaoCsllPct',
      'presuncaoIrpjPct',
    ]);
    // Nada foi gravado.
    expect(repo.abrirNovaVigencia).not.toHaveBeenCalled();
  });

  it('recusa vigência que começa antes ou junto da atual', async () => {
    // Aceitar isso criaria um passado alternativo para meses já apurados.
    const atual = registro({ vigenciaInicio: new Date('2026-06-01T00:00:00Z') });
    const { service, repo } = construir(atual);

    const erro = await capturarBadRequest(
      service.definirRegime(TENANT, { ...SIMPLES_VALIDO, vigenciaInicio: new Date('2026-03-01T00:00:00Z') }),
    );

    const corpo = erro.getResponse() as { code: string };
    expect(corpo.code).toBe('VIGENCIA_RETROATIVA');
    expect(repo.abrirNovaVigencia).not.toHaveBeenCalled();
  });

  it('recusa vigência começando exatamente no mesmo dia da atual', async () => {
    const mesmoDia = new Date('2026-06-01T00:00:00Z');
    const { service, repo } = construir(registro({ vigenciaInicio: mesmoDia }));

    await service
      .definirRegime(TENANT, { ...SIMPLES_VALIDO, vigenciaInicio: mesmoDia })
      .catch(() => undefined);

    expect(repo.abrirNovaVigencia).not.toHaveBeenCalled();
  });

  it('aceita trocar de regime com vigência posterior', async () => {
    const { service, recebido } = construir(registro({ vigenciaInicio: new Date('2026-01-01T00:00:00Z') }));

    await service.definirRegime(TENANT, {
      ...SIMPLES_VALIDO,
      regime: 'LUCRO_PRESUMIDO',
      anexo: null,
      icmsAliquotaPct: 18,
      presuncaoIrpjPct: 8,
      presuncaoCsllPct: 12,
      vigenciaInicio: new Date('2026-07-01T00:00:00Z'),
    });

    expect(recebido[0].regime).toBe('LUCRO_PRESUMIDO');
  });

  it('obterVigente devolve null quando nunca foi configurado', async () => {
    // A UI usa isso para mostrar onboarding em vez de tela de erro.
    const { service } = construir(null);
    expect(await service.obterVigente(TENANT)).toBeNull();
  });
});
