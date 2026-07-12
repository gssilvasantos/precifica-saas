import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { MarketplaceRuleRepository } from '../application/ports/marketplace-rule-repository.port';
import { MarketplaceRule, MarketplaceRuleCreateData, RuleStatus } from '../domain/marketplace-rule.entity';

// Nota sobre os `as any`/`as never` neste arquivo: o domínio usa union types
// de string (RuleType, RuleStatus, DataSourceType) para não depender do
// client gerado do Prisma; o Prisma gera enums TS nominais com os mesmos
// valores. Estruturalmente idênticos, nominalmente incompatíveis — a
// conversão é seguro porque os valores literais batem exatamente com o
// schema.prisma (ver domain/marketplace-rule.entity.ts).
@Injectable()
export class PrismaMarketplaceRuleRepository implements MarketplaceRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: MarketplaceRuleCreateData): Promise<MarketplaceRule> {
    if (data.status === 'VALIDADA') {
      return this.prisma.$transaction(async (tx) => {
        await this.supersedeActiveValidated(tx, data.marketplaceId, data.ruleType, data.scopeKey, data.tenantId ?? null);
        return tx.marketplaceRule.create({
          data: { ...data, validatedAt: new Date() } as any,
        }) as unknown as Promise<MarketplaceRule>;
      });
    }
    return this.prisma.marketplaceRule.create({ data: data as any }) as unknown as Promise<MarketplaceRule>;
  }

  findLatestValidated(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string | null,
  ): Promise<MarketplaceRule | null> {
    return this.prisma.marketplaceRule.findFirst({
      where: { marketplaceId, ruleType: ruleType as never, scopeKey, tenantId, status: 'VALIDADA' },
      orderBy: { version: 'desc' },
    }) as unknown as Promise<MarketplaceRule | null>;
  }

  findLatestVersion(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string | null,
  ): Promise<MarketplaceRule | null> {
    return this.prisma.marketplaceRule.findFirst({
      where: { marketplaceId, ruleType: ruleType as never, scopeKey, tenantId },
      orderBy: { version: 'desc' },
    }) as unknown as Promise<MarketplaceRule | null>;
  }

  findByStatus(status: RuleStatus, marketplaceId?: string): Promise<MarketplaceRule[]> {
    return this.prisma.marketplaceRule.findMany({
      where: { status: status as never, ...(marketplaceId ? { marketplaceId } : {}) },
      orderBy: { createdAt: 'desc' },
    }) as unknown as Promise<MarketplaceRule[]>;
  }

  findById(id: string): Promise<MarketplaceRule | null> {
    return this.prisma.marketplaceRule.findUnique({ where: { id } }) as unknown as Promise<MarketplaceRule | null>;
  }

  async updateStatus(id: string, status: RuleStatus, validatedById?: string): Promise<MarketplaceRule> {
    if (status === 'VALIDADA') {
      return this.prisma.$transaction(async (tx) => {
        const rule = await tx.marketplaceRule.findUniqueOrThrow({ where: { id } });
        await this.supersedeActiveValidated(tx, rule.marketplaceId, rule.ruleType, rule.scopeKey, rule.tenantId, id);
        return tx.marketplaceRule.update({
          where: { id },
          data: { status: status as never, validatedAt: new Date(), validatedById },
        }) as unknown as Promise<MarketplaceRule>;
      });
    }
    return this.prisma.marketplaceRule.update({
      where: { id },
      data: { status: status as never },
    }) as unknown as Promise<MarketplaceRule>;
  }

  setPinned(id: string, pinned: boolean): Promise<MarketplaceRule> {
    return this.prisma.marketplaceRule.update({ where: { id }, data: { pinned } }) as unknown as Promise<MarketplaceRule>;
  }

  async markEffectiveToNow(id: string): Promise<void> {
    await this.prisma.marketplaceRule.update({ where: { id }, data: { effectiveTo: new Date() } });
  }

  async resolveEffective(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string,
    atDate: Date,
  ): Promise<MarketplaceRule | null> {
    const whereEffective = {
      marketplaceId,
      ruleType: ruleType as never,
      scopeKey,
      status: 'VALIDADA' as never,
      effectiveFrom: { lte: atDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: atDate } }],
    };

    // Override do tenant sempre vence a regra global, quando existir e estiver vigente.
    const tenantOverride = await this.prisma.marketplaceRule.findFirst({
      where: { ...whereEffective, tenantId },
      orderBy: { version: 'desc' },
    });
    if (tenantOverride) return tenantOverride as unknown as MarketplaceRule;

    const globalRule = await this.prisma.marketplaceRule.findFirst({
      where: { ...whereEffective, tenantId: null },
      orderBy: { version: 'desc' },
    });
    return globalRule as unknown as MarketplaceRule | null;
  }

  // Invariante mantida por esta classe: no máximo uma MarketplaceRule com
  // status VALIDADA e effectiveTo em aberto por (marketplace, ruleType,
  // scopeKey, tenant). Ao validar uma versão nova, a antiga vira OBSOLETA.
  private async supersedeActiveValidated(
    tx: Prisma.TransactionClient,
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string | null,
    excludeId?: string,
  ) {
    const active = await tx.marketplaceRule.findMany({
      where: {
        marketplaceId,
        ruleType: ruleType as never,
        scopeKey,
        tenantId,
        status: 'VALIDADA' as never,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    for (const rule of active) {
      await tx.marketplaceRule.update({
        where: { id: rule.id },
        data: { status: 'OBSOLETA' as never, effectiveTo: new Date() },
      });
    }
  }
}
