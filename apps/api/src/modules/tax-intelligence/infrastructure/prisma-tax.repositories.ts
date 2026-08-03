import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  PriorRevenueRecord,
  ProductTaxProfileRecord,
  ProductTaxProfileRepository,
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
      automationMode: record.automationMode,
    };
  }
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
}
