import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CatalogSettings,
  CatalogSettingsRepository,
} from '../application/ports/catalog-settings-repository.port';

@Injectable()
export class PrismaCatalogSettingsRepository implements CatalogSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<CatalogSettings | null> {
    return this.prisma.catalogSettings.findUnique({ where: { tenantId } });
  }

  upsertMargins(
    tenantId: string,
    defaultDesiredMarginPct: number,
    defaultMinimumMarginPct: number,
  ): Promise<CatalogSettings> {
    return this.prisma.catalogSettings.upsert({
      where: { tenantId },
      create: { tenantId, defaultDesiredMarginPct, defaultMinimumMarginPct },
      update: { defaultDesiredMarginPct, defaultMinimumMarginPct },
    });
  }

  upsertFinancialPolicy(tenantId: string, taxRatePct: number, minProfitMarginPct: number): Promise<CatalogSettings> {
    // create omite defaultDesiredMarginPct/defaultMinimumMarginPct de
    // propósito — o Prisma aplica os @default do schema quando a linha
    // ainda não existe (tenant configurando política financeira antes de
    // qualquer margem por SKU, cenário perfeitamente válido).
    return this.prisma.catalogSettings.upsert({
      where: { tenantId },
      create: { tenantId, taxRatePct, minProfitMarginPct },
      update: { taxRatePct, minProfitMarginPct },
    });
  }
}
