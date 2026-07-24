import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { ProductsService } from './products.service';
import { parseMapPriceImportCsv, MapPriceImportError } from '../domain/map-price-import-row-parser';

export interface BulkMapPriceImportSummary {
  totalRows: number;
  updated: number;
  unchanged: number; // SKU encontrado, mas map_price da planilha é igual ao já cadastrado — nenhuma mudança real, nenhum registro de auditoria novo
  errors: MapPriceImportError[];
}

// Importação em massa da Política de Preço Mínimo (MAP) via planilha (CSV).
//
// Política TUDO-OU-NADA: se QUALQUER linha tiver um erro (SKU vazio,
// map_price inválido, ou — depois do parsing — SKU que não existe para o
// tenant), NENHUMA linha é aplicada. Escolha deliberada, não a única
// possível: um import parcial deixaria o catálogo num estado "alguns SKUs
// já com a política nova, outros não, sem eu saber quais" — pior para uma
// política de PREÇO MÍNIMO (onde o erro custa dinheiro/contrato) do que
// obrigar o usuário a corrigir a planilha e reimportar do zero.
//
// Reaproveita ProductsService.update para CADA linha válida — MESMO funil
// de auditoria que o PATCH manual usa (diffGovernanceFields +
// ProductAuditLogService), só com source: 'BULK_IMPORT' e o mesmo
// changedByUserId de quem fez o upload. Garante que a importação em massa
// NUNCA pode gravar um mapPrice sem passar pela mesma trilha de auditoria
// do caminho manual — não existe um segundo caminho de escrita que a
// esqueça.
@Injectable()
export class BulkMapPriceImportService {
  private readonly logger = new Logger(BulkMapPriceImportService.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    private readonly productsService: ProductsService,
  ) {}

  async importFromCsv(tenantId: string, fileContent: string, actor: { userId: string }): Promise<BulkMapPriceImportSummary> {
    const { rows, errors: parseErrors } = parseMapPriceImportCsv(fileContent);

    if (parseErrors.length > 0) {
      return { totalRows: rows.length + parseErrors.length, updated: 0, unchanged: 0, errors: parseErrors };
    }

    // findAllActive + filtro em memória — mesmo padrão já usado por
    // CatalogReaderService (não há um findBySkuCodes em lote dedicado no
    // ProductRepository hoje; simples o bastante para o volume atual de
    // importação manual/planilha).
    const allProducts = await this.products.findAllActive(tenantId);
    const bySkuCode = new Map(allProducts.map((p) => [p.skuCode, p]));

    const notFoundErrors: MapPriceImportError[] = [];
    for (const row of rows) {
      if (!bySkuCode.has(row.skuCode)) {
        notFoundErrors.push({ rowNumber: row.rowNumber, message: `SKU ${row.skuCode} não encontrado nesta conta.` });
      }
    }

    if (notFoundErrors.length > 0) {
      return { totalRows: rows.length, updated: 0, unchanged: 0, errors: notFoundErrors };
    }

    let updated = 0;
    let unchanged = 0;

    for (const row of rows) {
      const product = bySkuCode.get(row.skuCode)!;
      if (product.mapPrice === row.mapPrice) {
        unchanged++;
        continue;
      }
      await this.productsService.update(
        tenantId,
        product.id,
        { mapPrice: row.mapPrice },
        { userId: actor.userId, source: 'BULK_IMPORT' },
      );
      updated++;
    }

    this.logger.log(`Importação em massa de MAP (tenant ${tenantId}): ${updated} SKU(s) atualizado(s), ${unchanged} sem mudança, ${rows.length} linha(s) no total.`);

    return { totalRows: rows.length, updated, unchanged, errors: [] };
  }
}
