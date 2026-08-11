import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ReceitaAnteriorDetalhada,
  TENANT_PRIOR_REVENUE_REPOSITORY,
  TenantPriorRevenueRepository,
} from './ports/tax-repositories.port';
import { MONTHLY_REVENUE_READER } from '../../../shared/contracts/tokens';
import { MonthlyRevenueReader } from '../../../shared/contracts/monthly-revenue-reader.port';
import { chaveDeMes } from '../domain/rbt12';

// Faturamento anterior — a metade humana do RBT12 (11/08/2026).
//
// O RBT12 são os 12 meses ANTERIORES ao período de apuração. O Kyneti conhece
// os meses em que já havia pedidos; os anteriores à cobertura só o contador
// sabe, e é o mesmo dado do quadro "receitas brutas anteriores" do PGDAS-D.
//
// Sem isso, calcularRbt12 lança Rbt12IncompletoError e o Simples inteiro
// bloqueia — que é o comportamento certo (somar histórico parcial produz
// alíquota MENOR que a devida, e imposto subestimado superestima margem), mas
// não havia como sair do bloqueio.

export type OrigemDoMes = 'INFORMADA' | 'PEDIDOS_KYNETI' | 'FALTANDO';

export interface MesDaJanela {
  competencia: string; // 'YYYY-MM'
  receitaMercadoInterno: number | null;
  receitaMercadoExterno: number | null;
  // O que o Kyneti apurou pelos pedidos daquele mês, quando havia cobertura.
  // Exibido ao lado do informado para o contador conferir — nunca substitui o
  // declarado, que tem precedência.
  receitaDePedidos: number | null;
  origem: OrigemDoMes;
  fonte: string | null;
}

export interface JanelaRbt12 {
  periodoApuracao: string; // 'YYYY-MM'
  meses: MesDaJanela[];
  // Quantos meses ainda impedem o cálculo. Zero = o Simples destrava.
  mesesFaltantes: number;
  rbt12Parcial: number;
}

const FONTES_VALIDAS = ['MANUAL', 'PGDAS_D', 'DASN_SIMEI'] as const;
export type FonteReceita = (typeof FONTES_VALIDAS)[number];

@Injectable()
export class PriorRevenueService {
  private readonly logger = new Logger(PriorRevenueService.name);

  constructor(
    @Inject(TENANT_PRIOR_REVENUE_REPOSITORY) private readonly repository: TenantPriorRevenueRepository,
    @Inject(MONTHLY_REVENUE_READER) private readonly receitaDePedidos: MonthlyRevenueReader,
  ) {}

  async montarJanela(tenantId: string, periodoApuracao: Date): Promise<JanelaRbt12> {
    const chaves = mesesAnteriores(periodoApuracao);
    const primeiro = primeiroDiaDoMes(chaves[0]);
    const ultimo = ultimoInstanteDoMes(chaves[chaves.length - 1]);

    const [informadas, dePedidos, inicioDaCobertura] = await Promise.all([
      this.repository.listarDetalhado(tenantId, primeiro, ultimo),
      this.receitaDePedidos.sumByMonth(tenantId, primeiro, ultimo),
      this.receitaDePedidos.firstOrderAt(tenantId),
    ]);

    const porChaveInformada = new Map(informadas.map((r) => [chaveDeMes(r.competencia), r]));
    const porChavePedidos = new Map(dePedidos.map((r) => [chaveDeMes(r.competencia), r.receita]));
    const coberturaDesde = inicioDaCobertura ? chaveDeMes(inicioDaCobertura) : null;

    let rbt12Parcial = 0;
    let mesesFaltantes = 0;

    const meses = chaves.map<MesDaJanela>((chave) => {
      const informado = porChaveInformada.get(chave);
      const dePedido = porChavePedidos.get(chave) ?? null;

      // Precedência: o informado vence o apurado. É um número DECLARADO, e uma
      // correção manual precisa poder sobrepor o que o sistema calculou.
      if (informado) {
        const total = informado.receitaMercadoInterno + informado.receitaMercadoExterno;
        rbt12Parcial += total;
        return {
          competencia: chave,
          receitaMercadoInterno: informado.receitaMercadoInterno,
          receitaMercadoExterno: informado.receitaMercadoExterno,
          receitaDePedidos: dePedido,
          origem: 'INFORMADA',
          fonte: informado.fonte,
        };
      }

      // Dentro da cobertura: ausência de pedido significa mês sem venda, e zero
      // é a resposta correta — não um buraco.
      const dentroDaCobertura = coberturaDesde !== null && chave >= coberturaDesde;
      if (dentroDaCobertura) {
        const total = dePedido ?? 0;
        rbt12Parcial += total;
        return {
          competencia: chave,
          receitaMercadoInterno: null,
          receitaMercadoExterno: null,
          receitaDePedidos: total,
          origem: 'PEDIDOS_KYNETI',
          fonte: null,
        };
      }

      // Antes da cobertura e sem informação: é o que bloqueia o cálculo.
      mesesFaltantes++;
      return {
        competencia: chave,
        receitaMercadoInterno: null,
        receitaMercadoExterno: null,
        receitaDePedidos: null,
        origem: 'FALTANDO',
        fonte: null,
      };
    });

    return {
      periodoApuracao: chaveDeMes(periodoApuracao),
      meses,
      mesesFaltantes,
      rbt12Parcial: Number(rbt12Parcial.toFixed(2)),
    };
  }

  async salvar(tenantId: string, linhas: ReceitaAnteriorDetalhada[]): Promise<void> {
    const problemas: { campo: string; mensagem: string }[] = [];
    const vistas = new Set<string>();

    linhas.forEach((linha, indice) => {
      const chave = chaveDeMes(linha.competencia);

      // Competência repetida no mesmo envio: o upsert gravaria as duas e a
      // última venceria em silêncio, escondendo um erro de planilha.
      if (vistas.has(chave)) {
        problemas.push({ campo: `linhas[${indice}].competencia`, mensagem: `Competência ${chave} repetida no envio.` });
      }
      vistas.add(chave);

      if (linha.receitaMercadoInterno < 0 || linha.receitaMercadoExterno < 0) {
        problemas.push({ campo: `linhas[${indice}]`, mensagem: 'Receita não pode ser negativa.' });
      }
      if (!FONTES_VALIDAS.includes(linha.fonte as FonteReceita)) {
        problemas.push({
          campo: `linhas[${indice}].fonte`,
          mensagem: `Fonte deve ser uma de: ${FONTES_VALIDAS.join(', ')}.`,
        });
      }
    });

    if (problemas.length > 0) {
      throw new BadRequestException({
        code: 'FATURAMENTO_ANTERIOR_INVALIDO',
        message: 'Há competências inválidas no envio.',
        problemas,
      });
    }

    // Normaliza toda competência para o PRIMEIRO DIA do mês, em UTC. Sem isso,
    // duas telas enviando dias diferentes do mesmo mês criariam duas linhas e a
    // unicidade (tenantId, competencia) não protegeria nada.
    const normalizadas = linhas.map((l) => ({ ...l, competencia: primeiroDiaDoMes(chaveDeMes(l.competencia)) }));

    await this.repository.salvarCompetencias(tenantId, normalizadas);

    this.logger.log(
      `Faturamento anterior gravado para o tenant ${tenantId}: ${normalizadas.length} competência(s).`,
    );
  }
}

// Os 12 meses anteriores ao período de apuração, do mais antigo ao mais
// recente. Mesma regra de mesesAnteriores() em domain/rbt12.ts — o mês corrente
// nunca entra no próprio RBT12.
function mesesAnteriores(periodoApuracao: Date): string[] {
  const chaves: string[] = [];
  for (let i = 12; i >= 1; i--) {
    chaves.push(
      chaveDeMes(new Date(Date.UTC(periodoApuracao.getUTCFullYear(), periodoApuracao.getUTCMonth() - i, 1))),
    );
  }
  return chaves;
}

function primeiroDiaDoMes(chave: string): Date {
  const [ano, mes] = chave.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1));
}

function ultimoInstanteDoMes(chave: string): Date {
  const [ano, mes] = chave.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999));
}
