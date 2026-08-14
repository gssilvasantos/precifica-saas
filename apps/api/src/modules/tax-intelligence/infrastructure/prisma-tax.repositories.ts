import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  NovoPerfilDeProduto,
  NovoPerfilTributario,
  PriorRevenueRecord,
  ProductTaxProfileRecord,
  ProductTaxProfileRepository,
  ReceitaAnteriorDetalhada,
  TenantPriorRevenueRepository,
  TenantTaxProfileRecord,
  TenantTaxProfileRepository,
} from '../application/ports/tax-repositories.port';
import { SimplesAnexo } from '../domain/simples-nacional';
import { TaxRegime } from '../../../shared/contracts/tax-rate-resolver.port';

// "Vigente numa data" é a mesma cláusula nos três repositórios: começou antes
// ou na data E (não terminou OU terminou depois dela). Extraída para não ser
// reescrita — uma divergência sutil aqui reapareceria como alíquota errada num
// mês já fechado.
// null continua null: "não configurado" é diferente de "zero por cento", e é a
// distinção que faz o resolver bloquear em vez de precificar sem ICMS.
function pctParaFracao(valor: { toString(): string } | null): number | null {
  return valor !== null ? Number(valor) / 100 : null;
}

function vigenteEm(at: Date) {
  return {
    vigenciaInicio: { lte: at },
    OR: [{ vigenciaFim: null }, { vigenciaFim: { gte: at } }],
  };
}

@Injectable()
export class PrismaTenantTaxProfileRepository implements TenantTaxProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVigente(tenantId: string, at: Date): Promise<TenantTaxProfileRecord | null> {
    const record = await this.prisma.tenantTaxProfile.findFirst({
      where: { tenantId, ...vigenteEm(at) },
      // Mais recente primeiro: se houver sobreposição de vigências por erro de
      // cadastro, vale a mais nova — e nunca silenciosamente a mais antiga.
      orderBy: { vigenciaInicio: 'desc' },
    });
    if (!record) return null;
    return paraRegistro(record);
  }

  async listar(tenantId: string): Promise<TenantTaxProfileRecord[]> {
    const records = await this.prisma.tenantTaxProfile.findMany({
      where: { tenantId },
      orderBy: { vigenciaInicio: 'desc' },
    });
    return records.map(paraRegistro);
  }

  async abrirNovaVigencia(input: NovoPerfilTributario): Promise<TenantTaxProfileRecord> {
    // Encerrar a anterior e abrir a nova têm que ser atômicos: entre os dois
    // passos o tenant ficaria ou sem regime vigente (resolver bloqueia) ou com
    // dois (o orderBy desempataria em silêncio). Nenhuma chamada externa aqui
    // dentro — só as duas escritas.
    const criado = await this.prisma.$transaction(async (tx) => {
      await tx.tenantTaxProfile.updateMany({
        where: { tenantId: input.tenantId, vigenciaFim: null },
        data: { vigenciaFim: vespera(input.vigenciaInicio) },
      });

      return tx.tenantTaxProfile.create({
        data: {
          tenantId: input.tenantId,
          uf: input.uf,
          regime: input.regime,
          anexo: input.anexo,
          vigenciaInicio: input.vigenciaInicio,
          vigenciaFim: null,
          meiValorFixoMensal: input.meiValorFixoMensal,
          icmsAliquotaPct: input.icmsAliquotaPct,
          presuncaoIrpjPct: input.presuncaoIrpjPct,
          presuncaoCsllPct: input.presuncaoCsllPct,
          aliquotaManualPct: input.aliquotaManualPct,
          automationMode: input.automationMode,
        },
      });
    });

    return paraRegistro(criado);
  }
}

// Uma única tradução banco → domínio, usada por findVigente e por listar. Ter
// duas cópias era o caminho mais curto para a conversão de percentual divergir
// entre "o regime de hoje" e "o histórico".
function paraRegistro(record: {
  id: string;
  tenantId: string;
  uf: string;
  regime: string;
  anexo: string | null;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  meiValorFixoMensal: { toString(): string } | null;
  icmsAliquotaPct: { toString(): string } | null;
  presuncaoIrpjPct: { toString(): string } | null;
  presuncaoCsllPct: { toString(): string } | null;
  aliquotaManualPct: { toString(): string } | null;
  automationMode: 'AUTO' | 'MANUAL';
}): TenantTaxProfileRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    uf: record.uf,
    regime: record.regime as TaxRegime,
    anexo: (record.anexo as SimplesAnexo | null) ?? null,
    vigenciaInicio: record.vigenciaInicio,
    vigenciaFim: record.vigenciaFim,
    meiValorFixoMensal: record.meiValorFixoMensal !== null ? Number(record.meiValorFixoMensal) : null,
    // Guardados como percentual no schema (0-100, convenção do resto do
    // banco), consumidos como FRAÇÃO — a conversão vive aqui, na fronteira,
    // e em nenhum outro lugar.
    icmsAliquota: pctParaFracao(record.icmsAliquotaPct),
    presuncaoIrpj: pctParaFracao(record.presuncaoIrpjPct),
    presuncaoCsll: pctParaFracao(record.presuncaoCsllPct),
    // Alíquota mantida à mão: mesma conversão percentual -> fração dos demais.
    aliquotaManual: pctParaFracao(record.aliquotaManualPct),
    automationMode: record.automationMode,
  };
}

// Um dia antes de `data`, em UTC. A vigência anterior termina na VÉSPERA do
// novo início — não no mesmo dia — para que `vigenteEm` nunca case duas linhas
// para a mesma data e o `orderBy desc` não tenha que desempatar.
function vespera(data: Date): Date {
  return new Date(data.getTime() - 24 * 60 * 60 * 1000);
}

@Injectable()
export class PrismaProductTaxProfileRepository implements ProductTaxProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVigente(
    tenantId: string,
    productId: string,
    uf: string,
    at: Date,
  ): Promise<ProductTaxProfileRecord | null> {
    const record = await this.prisma.productTaxProfile.findFirst({
      where: { tenantId, productId, uf, ...vigenteEm(at) },
      orderBy: { vigenciaInicio: 'desc' },
    });
    if (!record) return null;
    return paraRegistroDeProduto(record);
  }

  async listarPorProduto(tenantId: string, productId: string): Promise<ProductTaxProfileRecord[]> {
    const records = await this.prisma.productTaxProfile.findMany({
      where: { tenantId, productId },
      orderBy: [{ uf: 'asc' }, { vigenciaInicio: 'desc' }],
    });
    return records.map(paraRegistroDeProduto);
  }

  async abrirNovaVigencia(input: NovoPerfilDeProduto): Promise<ProductTaxProfileRecord> {
    const criado = await this.prisma.$transaction(async (tx) => {
      // Encerra a vigência aberta SÓ desta UF. Sem o filtro de uf, classificar
      // o produto em SP encerraria a classificação dele no Paraná — e a ST é
      // regime estadual, não nacional.
      await tx.productTaxProfile.updateMany({
        where: { tenantId: input.tenantId, productId: input.productId, uf: input.uf, vigenciaFim: null },
        data: { vigenciaFim: vespera(input.vigenciaInicio) },
      });

      return tx.productTaxProfile.create({
        data: {
          tenantId: input.tenantId,
          productId: input.productId,
          uf: input.uf,
          icmsSt: input.icmsSt,
          monofasico: input.monofasico,
          ncm: input.ncm,
          fonte: input.fonte,
          vigenciaInicio: input.vigenciaInicio,
          vigenciaFim: null,
        },
      });
    });

    return paraRegistroDeProduto(criado);
  }
}

function paraRegistroDeProduto(record: {
  id: string;
  productId: string;
  uf: string;
  icmsSt: boolean;
  monofasico: boolean;
  ncm: string | null;
  fonte: string;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
}): ProductTaxProfileRecord {
  return {
    id: record.id,
    productId: record.productId,
    uf: record.uf,
    icmsSt: record.icmsSt,
    monofasico: record.monofasico,
    ncm: record.ncm,
    fonte: record.fonte,
    vigenciaInicio: record.vigenciaInicio,
    vigenciaFim: record.vigenciaFim,
  };
}

@Injectable()
export class PrismaTenantPriorRevenueRepository implements TenantPriorRevenueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findForPeriod(tenantId: string, from: Date, to: Date): Promise<PriorRevenueRecord[]> {
    const records = await this.prisma.tenantPriorRevenue.findMany({
      where: { tenantId, competencia: { gte: from, lte: to } },
      orderBy: { competencia: 'asc' },
    });

    // Mercado interno + externo somados: o RBT12 do art. 18 é a receita bruta
    // TOTAL. A separação existe no schema porque a exportação tem regra de
    // redução própria (art. 18, §14), aplicada na apuração — não aqui.
    return records.map((r) => ({
      competencia: r.competencia,
      receita: Number(r.receitaMercadoInterno) + Number(r.receitaMercadoExterno),
    }));
  }

  async listarDetalhado(tenantId: string, from: Date, to: Date): Promise<ReceitaAnteriorDetalhada[]> {
    const records = await this.prisma.tenantPriorRevenue.findMany({
      where: { tenantId, competencia: { gte: from, lte: to } },
      orderBy: { competencia: 'asc' },
    });

    return records.map((r) => ({
      competencia: r.competencia,
      receitaMercadoInterno: Number(r.receitaMercadoInterno),
      receitaMercadoExterno: Number(r.receitaMercadoExterno),
      fonte: r.fonte,
    }));
  }

  async salvarCompetencias(tenantId: string, linhas: ReceitaAnteriorDetalhada[]): Promise<void> {
    if (linhas.length === 0) return;

    // Uma transação para as N competências: o contador informa a janela inteira
    // de uma vez, e meia janela gravada produziria um RBT12 que não corresponde
    // a nenhuma declaração real. Sem chamada externa aqui dentro.
    await this.prisma.$transaction(
      linhas.map((linha) =>
        this.prisma.tenantPriorRevenue.upsert({
          // A unicidade natural (tenantId, competencia) É a chave de
          // idempotência — não precisa de chave sintética.
          where: { tenantId_competencia: { tenantId, competencia: linha.competencia } },
          create: {
            tenantId,
            competencia: linha.competencia,
            receitaMercadoInterno: linha.receitaMercadoInterno,
            receitaMercadoExterno: linha.receitaMercadoExterno,
            fonte: linha.fonte,
          },
          update: {
            receitaMercadoInterno: linha.receitaMercadoInterno,
            receitaMercadoExterno: linha.receitaMercadoExterno,
            fonte: linha.fonte,
          },
        }),
      ),
    );
  }
}
