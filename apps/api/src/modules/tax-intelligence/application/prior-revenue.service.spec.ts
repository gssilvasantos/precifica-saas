import { BadRequestException } from '@nestjs/common';
import { PriorRevenueService } from './prior-revenue.service';
import { ReceitaAnteriorDetalhada } from './ports/tax-repositories.port';

const TENANT = 'tenant-1';
// PA de 2026-08 => janela de 2025-08 a 2026-07.
const PA = new Date(Date.UTC(2026, 7, 1));

function mes(chave: string): Date {
  const [ano, m] = chave.split('-').map(Number);
  return new Date(Date.UTC(ano, m - 1, 1));
}

function construir(opcoes: {
  informadas?: ReceitaAnteriorDetalhada[];
  pedidos?: { competencia: Date; receita: number }[];
  primeiroPedido?: Date | null;
}) {
  const gravado: ReceitaAnteriorDetalhada[][] = [];
  const repo = {
    findForPeriod: jest.fn().mockResolvedValue([]),
    listarDetalhado: jest.fn().mockResolvedValue(opcoes.informadas ?? []),
    salvarCompetencias: jest.fn(async (_t: string, linhas: ReceitaAnteriorDetalhada[]) => {
      gravado.push(linhas);
    }),
  };
  const leitor = {
    sumByMonth: jest.fn().mockResolvedValue(opcoes.pedidos ?? []),
    firstOrderAt: jest.fn().mockResolvedValue(opcoes.primeiroPedido ?? null),
  };
  return { service: new PriorRevenueService(repo as never, leitor as never), repo, gravado };
}

describe('PriorRevenueService — janela do RBT12', () => {
  it('monta exatamente os 12 meses ANTERIORES ao período de apuração', async () => {
    const { service } = construir({});

    const janela = await service.montarJanela(TENANT, PA);

    expect(janela.meses).toHaveLength(12);
    expect(janela.meses[0].competencia).toBe('2025-08');
    expect(janela.meses[11].competencia).toBe('2026-07');
    // O mês corrente nunca entra no próprio RBT12.
    expect(janela.meses.map((m) => m.competencia)).not.toContain('2026-08');
  });

  it('sem cobertura e sem informação, todos os 12 meses bloqueiam', async () => {
    const { service } = construir({ primeiroPedido: null });

    const janela = await service.montarJanela(TENANT, PA);

    expect(janela.mesesFaltantes).toBe(12);
    expect(janela.meses.every((m) => m.origem === 'FALTANDO')).toBe(true);
    expect(janela.rbt12Parcial).toBe(0);
  });

  it('dentro da cobertura, mês sem pedido vale ZERO e não bloqueia', async () => {
    // "Mês sem venda" é diferente de "mês anterior à nossa cobertura".
    const { service } = construir({
      primeiroPedido: mes('2025-08'),
      pedidos: [{ competencia: mes('2025-09'), receita: 1000 }],
    });

    const janela = await service.montarJanela(TENANT, PA);

    expect(janela.mesesFaltantes).toBe(0);
    expect(janela.meses[0].origem).toBe('PEDIDOS_KYNETI');
    expect(janela.meses[0].receitaDePedidos).toBe(0);
    expect(janela.rbt12Parcial).toBe(1000);
  });

  it('a receita INFORMADA tem precedência sobre a apurada por pedidos', async () => {
    // O informado é um número declarado; uma correção manual precisa poder
    // sobrepor o que o sistema calculou.
    const { service } = construir({
      primeiroPedido: mes('2025-08'),
      pedidos: [{ competencia: mes('2025-09'), receita: 1000 }],
      informadas: [
        { competencia: mes('2025-09'), receitaMercadoInterno: 1500, receitaMercadoExterno: 0, fonte: 'PGDAS_D' },
      ],
    });

    const janela = await service.montarJanela(TENANT, PA);
    const setembro = janela.meses.find((m) => m.competencia === '2025-09')!;

    expect(setembro.origem).toBe('INFORMADA');
    expect(setembro.receitaMercadoInterno).toBe(1500);
    // O apurado continua visível ao lado, para o contador conferir.
    expect(setembro.receitaDePedidos).toBe(1000);
    expect(janela.rbt12Parcial).toBe(1500);
  });

  it('soma mercado interno e externo no RBT12', async () => {
    const { service } = construir({
      primeiroPedido: null,
      informadas: [
        { competencia: mes('2025-08'), receitaMercadoInterno: 800, receitaMercadoExterno: 200, fonte: 'MANUAL' },
      ],
    });

    const janela = await service.montarJanela(TENANT, PA);

    expect(janela.rbt12Parcial).toBe(1000);
    expect(janela.mesesFaltantes).toBe(11);
  });
});

// Captura o erro esperado ESTREITANDO o tipo, e falha se a operação tiver
// sucesso — um `.catch()` solto deixaria o teste passar em silêncio no dia em
// que a validação parasse de lançar.
async function capturarBadRequest(promessa: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof BadRequestException) return erro;
    throw erro;
  }
  throw new Error('Esperava BadRequestException, mas a operação foi concluída com sucesso.');
}

describe('PriorRevenueService — gravação', () => {
  const LINHA: ReceitaAnteriorDetalhada = {
    competencia: mes('2025-08'),
    receitaMercadoInterno: 1000,
    receitaMercadoExterno: 0,
    fonte: 'MANUAL',
  };

  it('normaliza a competência para o primeiro dia do mês', async () => {
    // Sem isso, duas telas enviando dias diferentes do mesmo mês criariam duas
    // linhas e a unicidade (tenantId, competencia) não protegeria nada.
    const { service, gravado } = construir({});

    await service.salvar(TENANT, [{ ...LINHA, competencia: new Date(Date.UTC(2025, 7, 23, 15, 30)) }]);

    expect(gravado[0][0].competencia.toISOString()).toBe('2025-08-01T00:00:00.000Z');
  });

  it('recusa competência repetida no mesmo envio', async () => {
    const { service, repo } = construir({});

    const erro = await capturarBadRequest(service.salvar(TENANT, [LINHA, { ...LINHA, receitaMercadoInterno: 2000 }]));

    expect((erro.getResponse() as { code: string }).code).toBe('FATURAMENTO_ANTERIOR_INVALIDO');
    expect(repo.salvarCompetencias).not.toHaveBeenCalled();
  });

  it('recusa receita negativa e fonte desconhecida, listando os dois', async () => {
    const { service } = construir({});

    const erro = await capturarBadRequest(
      service.salvar(TENANT, [
        { ...LINHA, receitaMercadoInterno: -1 },
        { ...LINHA, competencia: mes('2025-09'), fonte: 'INVENTADA' },
      ]),
    );

    const problemas = (erro.getResponse() as { problemas: { campo: string }[] }).problemas;
    expect(problemas).toHaveLength(2);
  });

  it('grava a janela inteira de uma vez', async () => {
    const { service, gravado } = construir({});

    await service.salvar(TENANT, [LINHA, { ...LINHA, competencia: mes('2025-09') }]);

    expect(gravado[0]).toHaveLength(2);
  });
});
