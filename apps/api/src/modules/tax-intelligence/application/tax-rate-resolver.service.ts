import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ResolvedTaxRate,
  TaxRateQuery,
  TaxRateResolver,
  TaxRateUnavailableError,
} from '../../../shared/contracts/tax-rate-resolver.port';
import { MONTHLY_REVENUE_READER } from '../../../shared/contracts/tokens';
import { MonthlyRevenueReader } from '../../../shared/contracts/monthly-revenue-reader.port';
import {
  PRODUCT_TAX_PROFILE_REPOSITORY,
  ProductTaxProfileRepository,
  TENANT_PRIOR_REVENUE_REPOSITORY,
  TENANT_TAX_PROFILE_REPOSITORY,
  TenantPriorRevenueRepository,
  TenantTaxProfileRecord,
  TenantTaxProfileRepository,
} from './ports/tax-repositories.port';
import { calcularAliquotaEfetiva, resolveFaixa, segregarAliquota } from '../domain/simples-nacional';
import { Rbt12IncompletoError, calcularRbt12 } from '../domain/rbt12';
import { calcularLucroPresumido, calcularLucroReal } from '../domain/regime-normal';

// Teto de receita do Simples Nacional (art. 3º, II da LC 123/2006). Acima
// dele não existe faixa: a empresa é excluída do regime.
const LIMITE_SIMPLES_NACIONAL = 4_800_000;

// Implementação da porta TAX_RATE_RESOLVER — orquestra I/O e delega TODO
// cálculo ao domínio puro (simples-nacional.ts, rbt12.ts). Mesma separação de
// PricingDecisionService: buscar dados de um lado, calcular do outro.
//
// REGRA DE OURO, herdada do motor de preço: quando não dá para responder com
// honestidade, LANÇA. Nunca devolve zero, nunca estima. Alíquota subestimada
// superestima margem, e o vendedor descobre no extrato.
@Injectable()
export class TaxRateResolverService implements TaxRateResolver {
  private readonly logger = new Logger(TaxRateResolverService.name);

  constructor(
    @Inject(TENANT_TAX_PROFILE_REPOSITORY) private readonly tenantProfiles: TenantTaxProfileRepository,
    @Inject(PRODUCT_TAX_PROFILE_REPOSITORY) private readonly productProfiles: ProductTaxProfileRepository,
    @Inject(TENANT_PRIOR_REVENUE_REPOSITORY) private readonly priorRevenues: TenantPriorRevenueRepository,
    @Inject(MONTHLY_REVENUE_READER) private readonly revenue: MonthlyRevenueReader,
  ) {}

  async resolve(query: TaxRateQuery): Promise<ResolvedTaxRate> {
    const perfil = await this.tenantProfiles.findVigente(query.tenantId, query.at);
    if (!perfil) {
      throw new TaxRateUnavailableError(
        'REGIME_NAO_CONFIGURADO',
        `nenhum regime tributário vigente em ${query.at.toISOString().slice(0, 10)} para este tenant. ` +
          'Configure o regime (MEI, Simples Nacional, Lucro Presumido ou Lucro Real) antes de precificar.',
      );
    }

    const calculada = await this.resolvePorRegime(perfil, query);

    // ALÍQUOTA MANTIDA À MÃO (13/08/2026) vence a calculada.
    //
    // O lojista acompanha o próprio faturamento e mantém um percentual um
    // pouco ACIMA do calculado, de propósito: errar imposto para cima
    // subestima lucro no DRE e sobe o piso de preço — a direção segura. É
    // política dele, não descuido, e o sistema não a sobrescreve.
    //
    // O calculado NÃO some: vai junto no breakdown, e é ele que alimenta a
    // sugestão de reajuste quando o RBT12 sobe de faixa e ultrapassa o número
    // digitado. Ver domain/sugestao-de-aliquota.ts.
    // `typeof === 'number'` e não `!== null`: um registro sem o campo devolve
    // undefined, e `undefined !== null` é TRUE — o perfil seria tratado como
    // sobrescrito, com effectiveRate undefined, contaminando piso de preço e
    // DRE em silêncio. Num campo que governa imposto, a checagem tem que ser
    // afirmativa sobre o que ACEITA, não sobre o que rejeita.
    if (typeof perfil.aliquotaManual === 'number') {
      return {
        ...calculada,
        effectiveRate: perfil.aliquotaManual,
        source: 'MANUAL_OVERRIDE',
        breakdown: { ...calculada.breakdown, aliquotaCheia: calculada.effectiveRate },
      };
    }

    return calculada;
  }

  private async resolvePorRegime(
    perfil: TenantTaxProfileRecord,
    query: TaxRateQuery,
  ): Promise<ResolvedTaxRate> {
    switch (perfil.regime) {
      case 'MEI_SIMEI':
        return this.resolveMei(perfil);
      case 'SIMPLES_NACIONAL':
        return this.resolveSimples(perfil, query);
      case 'LUCRO_PRESUMIDO':
        return this.resolveLucroPresumido(perfil, query);
      case 'LUCRO_REAL':
        return this.resolveLucroReal(perfil);
    }
  }

  // MEI: o imposto NÃO é percentual. É um valor fixo mensal (5% do
  // salário-mínimo + R$1 de ICMS ou R$5 de ISS), que não varia com o
  // faturamento até o teto. Qualquer alíquota digitada por um tenant MEI está
  // errada — por isso a resposta é effectiveRate 0 e o DAS vai para o DRE como
  // despesa fixa. Ver §1.1 do doc.
  private resolveMei(perfil: TenantTaxProfileRecord): ResolvedTaxRate {
    return {
      effectiveRate: 0,
      incidence: 'POR_DENTRO',
      creditableRate: 0,
      regime: 'MEI_SIMEI',
      source: 'NOT_APPLICABLE',
      fixedMonthlyTaxAmount: perfil.meiValorFixoMensal,
      breakdown: {
        fundamentacao: ['LC_123_2006_ART_18_A'], // SIMEI — recolhimento em valores fixos
      },
    };
  }

  // Lucro Presumido: IRPJ e CSLL TAMBÉM são proporcionais à receita, porque a
  // base é uma presunção sobre ela. Os quatro tributos entram no piso.
  private async resolveLucroPresumido(
    perfil: TenantTaxProfileRecord,
    query: TaxRateQuery,
  ): Promise<ResolvedTaxRate> {
    const icmsAliquota = this.exigirConfig(perfil.icmsAliquota, 'a alíquota interna de ICMS');
    const presuncaoIrpj = this.exigirConfig(perfil.presuncaoIrpj, 'o percentual de presunção do IRPJ');
    const presuncaoCsll = this.exigirConfig(perfil.presuncaoCsll, 'o percentual de presunção da CSLL');

    // O adicional de IRPJ é escalão mensal. Para PREÇO importa a posição
    // MARGINAL: se a empresa já opera acima do limite, cada real a mais
    // carrega o adicional. Usamos a média mensal dos 12 meses anteriores em
    // vez da receita do mês corrente — no dia 3 de cada mês a receita do mês
    // é quase zero, e o piso oscilaria por artefato de calendário.
    const { rbt12 } = await this.montarRbt12(perfil, query);

    const resultado = calcularLucroPresumido({
      icmsAliquota,
      presuncaoIrpj,
      presuncaoCsll,
      receitaMensalReferencia: rbt12 / 12,
    });

    return {
      effectiveRate: resultado.effectiveRate,
      incidence: 'POR_DENTRO',
      creditableRate: resultado.creditableRate,
      regime: 'LUCRO_PRESUMIDO',
      source: 'FIXED_REGIME_RATE',
      fixedMonthlyTaxAmount: null,
      breakdown: {
        rbt12,
        aliquotaCheia: resultado.effectiveRate,
        fundamentacao: ['LEI_9249_1995', 'LEI_9718_1998'],
      },
    };
  }

  // Lucro Real: IRPJ e CSLL incidem sobre o LUCRO, não sobre a receita — e por
  // isso ficam FORA do piso. Ver o comentário de calcularLucroReal e o art.
  // 187, V da Lei 6.404/1976.
  private resolveLucroReal(perfil: TenantTaxProfileRecord): ResolvedTaxRate {
    const icmsAliquota = this.exigirConfig(perfil.icmsAliquota, 'a alíquota interna de ICMS');
    const resultado = calcularLucroReal({ icmsAliquota });

    return {
      effectiveRate: resultado.effectiveRate,
      incidence: 'POR_DENTRO',
      creditableRate: resultado.creditableRate,
      regime: 'LUCRO_REAL',
      source: 'FIXED_REGIME_RATE',
      fixedMonthlyTaxAmount: null,
      breakdown: {
        aliquotaCheia: resultado.effectiveRate,
        fundamentacao: ['LEI_10637_2002', 'LEI_10833_2003'],
      },
    };
  }

  private exigirConfig(valor: number | null, descricao: string): number {
    if (valor === null) {
      throw new TaxRateUnavailableError(
        'REGIME_NAO_CONFIGURADO',
        `o regime normal exige ${descricao}, que não está configurado para este tenant. ` +
          'O cálculo foi bloqueado em vez de assumir zero.',
      );
    }
    return valor;
  }

  private async resolveSimples(perfil: TenantTaxProfileRecord, query: TaxRateQuery): Promise<ResolvedTaxRate> {
    if (!perfil.anexo) {
      throw new TaxRateUnavailableError(
        'REGIME_NAO_CONFIGURADO',
        'o tenant está no Simples Nacional mas nenhum Anexo foi informado. ' +
          'O Anexo define a tabela de alíquotas (I = comércio, II = indústria, III a V = serviços).',
      );
    }

    const rbt12 = await this.montarRbt12(perfil, query);
    const faixa = resolveFaixa(perfil.anexo, rbt12.rbt12);
    const aliquotaCheia = calcularAliquotaEfetiva(rbt12.rbt12, faixa);

    // Acima do limite de R$ 4,8 milhões a empresa está fora do Simples — a 6ª
    // faixa não se estende indefinidamente. Continuar calculando por ela
    // devolveria uma alíquota que não existe.
    if (rbt12.rbt12 > LIMITE_SIMPLES_NACIONAL) {
      throw new TaxRateUnavailableError(
        'REGIME_NAO_CONFIGURADO',
        `o RBT12 de ${rbt12.rbt12.toFixed(2)} ultrapassa o limite do Simples Nacional ` +
          `(R$ ${LIMITE_SIMPLES_NACIONAL.toLocaleString('pt-BR')}). A empresa está sujeita a exclusão do regime — ` +
          'confirme o enquadramento com o contador antes de continuar precificando por ele.',
      );
    }

    // Perfil do produto ausente NÃO é o mesmo que "produto sem ST e sem
    // monofásico": é falta de informação. Assumir false silenciosamente é como
    // o sistema declararia PIS/Cofins que não deve — foi exatamente o que
    // encontramos num PGDAS-D real de revendedor de cosméticos.
    // UF ausente = a do estabelecimento, que já está no perfil vigente lido
    // acima. Quem consome esta porta não tem como saber esse dado — ele mora
    // aqui dentro. Ver o comentário de TaxRateQuery.uf.
    const uf = query.uf ?? perfil.uf;

    const produto = await this.productProfiles.findVigente(query.tenantId, query.productId, uf, query.at);
    if (!produto) {
      throw new TaxRateUnavailableError(
        'PERFIL_DO_PRODUTO_AUSENTE',
        `o produto ${query.productId} não tem perfil fiscal vigente em ${uf} na data ` +
          `${query.at.toISOString().slice(0, 10)}. Sem saber se há substituição tributária ou tributação ` +
          'monofásica, a alíquota do produto não pode ser afirmada.',
      );
    }

    const segregada = segregarAliquota(aliquotaCheia, faixa.partilha, {
      icmsSt: produto.icmsSt,
      monofasico: produto.monofasico,
    });

    return {
      effectiveRate: segregada.effectiveRate,
      // Até 2026 o DAS é calculado POR DENTRO do preço. A partir de 2027 a
      // CBS/IBS passa a ser por fora para quem optar pelo regime regular — a
      // porta já carrega o campo para que a virada não mude assinatura.
      incidence: 'POR_DENTRO',
      // Optante do Simples na guia única não se apropria de crédito
      // (art. 24 da LC 123/2006).
      creditableRate: 0,
      regime: 'SIMPLES_NACIONAL',
      source: 'CALCULATED_RBT12',
      fixedMonthlyTaxAmount: null,
      breakdown: {
        rbt12: rbt12.rbt12,
        anexo: perfil.anexo,
        faixa: faixa.ordem,
        aliquotaNominal: faixa.aliquotaNominal,
        parcelaDeduzir: faixa.parcelaDeduzir,
        aliquotaCheia: segregada.aliquotaCheia,
        removidoIcmsSt: segregada.removido.icms,
        removidoMonofasico: segregada.removido.pisCofins,
        fundamentacao: [
          'LC_123_2006_ART_18_PARAGRAFO_1A', // fórmula da alíquota efetiva
          'LC_123_2006_ART_18_PARAGRAFO_1B', // partilha multiplicativa
          ...(produto.icmsSt || produto.monofasico
            ? ['LC_123_2006_ART_18_PARAGRAFO_4A_I', 'LC_123_2006_ART_18_PARAGRAFO_12', produto.fonte]
            : []),
        ],
      },
    };
  }

  // Os 12 meses anteriores ao período de apuração, montados a partir de duas
  // fontes: os pedidos que o Kyneti já ingeriu e o faturamento informado para
  // o período anterior à nossa cobertura. Quem decide de onde vem cada mês é o
  // domínio (rbt12.ts) — aqui só se busca.
  private async montarRbt12(perfil: TenantTaxProfileRecord, query: TaxRateQuery) {
    const inicioJanela = new Date(Date.UTC(query.at.getUTCFullYear(), query.at.getUTCMonth() - 12, 1));
    const fimJanela = new Date(Date.UTC(query.at.getUTCFullYear(), query.at.getUTCMonth(), 0, 23, 59, 59, 999));

    const [receitasDePedidos, informadas, inicioDaCobertura] = await Promise.all([
      this.revenue.sumByMonth(query.tenantId, inicioJanela, fimJanela),
      this.priorRevenues.findForPeriod(query.tenantId, inicioJanela, fimJanela),
      this.revenue.firstOrderAt(query.tenantId),
    ]);

    try {
      return calcularRbt12({
        periodoApuracao: query.at,
        receitasDePedidos: receitasDePedidos.map((r) => ({ competencia: r.competencia, receita: r.receita })),
        receitasInformadas: informadas.map((r) => ({ competencia: r.competencia, receita: r.receita })),
        inicioDaCobertura,
      });
    } catch (error) {
      if (error instanceof Rbt12IncompletoError) {
        this.logger.warn(
          `RBT12 incompleto para o tenant ${perfil.tenantId} em ${query.at.toISOString().slice(0, 10)}: ` +
            `${error.mesesFaltantes.join(', ')}`,
        );
        throw new TaxRateUnavailableError('RBT12_INCOMPLETO', error.message);
      }
      throw error;
    }
  }
}
