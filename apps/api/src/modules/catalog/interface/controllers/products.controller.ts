import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { ProductsService } from '../../application/products.service';
import { ProductAuditLogService } from '../../application/product-audit-log.service';
import { BulkMapPriceImportService } from '../../application/bulk-map-price-import.service';
import { ProductStructureService } from '../../application/product-structure.service';
import { ProductLotService } from '../../application/product-lot.service';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ImportMapPriceDto } from '../dto/import-map-price.dto';
import { GenerateVariantCombinationsDto } from '../dto/generate-variant-combinations.dto';
import { SetProductStructureDto } from '../dto/set-product-structure.dto';
import { CreateProductLotDto } from '../dto/create-product-lot.dto';
import { UpdateProductLotStatusDto } from '../dto/update-product-lot-status.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly auditLog: ProductAuditLogService,
    private readonly bulkMapPriceImport: BulkMapPriceImportService,
    private readonly productStructure: ProductStructureService,
    private readonly productLots: ProductLotService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.products.create(user.tenantId, dto);
  }

  // Importação em massa da Política de Preço Mínimo (MAP) via CSV
  // (sku_code,map_price) — ver BulkMapPriceImportService para a política
  // tudo-ou-nada e domain/map-price-import-row-parser.ts para o formato
  // aceito. Rota estática ANTES de qualquer `:id` do controller — nenhum
  // conflito de roteamento (método HTTP e path diferentes de todo o resto),
  // mas mantida perto do create() por convenção de leitura.
  @Roles(UserRole.ADMIN)
  @Post('bulk-import/map-price')
  bulkImportMapPrice(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportMapPriceDto) {
    return this.bulkMapPriceImport.importFromCsv(user.tenantId, dto.fileContent, { userId: user.userId });
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.products.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.findOne(user.tenantId, id);
  }

  // Produto Pai + Variação — lista as variações vinculadas a este produto
  // (vazio quando o produto não é um pai, ou ainda não tem variações).
  @Get(':id/variants')
  findVariants(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.findVariants(user.tenantId, id);
  }

  // Geração automática de combinações de variação (Quick Win 5, benchmark
  // Bling) — id é o produto PAI. Cria uma variação por combinação da grade
  // de atributos informada, herdando custo/margens/dimensões/dados fiscais
  // do pai. Ver ProductsService.generateVariantCombinations.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/variants/generate-combinations')
  generateVariantCombinations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GenerateVariantCombinationsDto,
  ) {
    return this.products.generateVariantCombinations(user.tenantId, id, dto.attributes);
  }

  // BOM real — Produtos-Estrutura (Projeto Estruturante 1, benchmark Bling
  // ERP, 29/07/2026). id é o produto PAI (kit); PUT substitui a estrutura
  // inteira (semântica idempotente, ver ProductStructureService.setComponents).
  @Get(':id/structure')
  getStructure(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productStructure.getByProductId(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/structure')
  setStructure(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetProductStructureDto) {
    return this.productStructure.setComponents(user.tenantId, id, dto.components);
  }

  // Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP,
  // 29/07/2026). id é o produto (Product.controlaLote precisa ser true —
  // ver ProductLotService.create).
  @Get(':id/lots')
  listLots(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productLots.listByProductId(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/lots')
  createLot(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateProductLotDto) {
    return this.productLots.create(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/lots/:lotCode/status')
  updateLotStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('lotCode') lotCode: string,
    @Body() dto: UpdateProductLotStatusDto,
  ) {
    return this.productLots.updateStatus(user.tenantId, id, lotCode, dto.status);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(user.tenantId, id, dto, { userId: user.userId });
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.remove(user.tenantId, id);
  }

  // Trilha de auditoria de campos de governança (hoje só mapPrice) — quem
  // mudou, quando, de/para qual valor, manual ou via importação em massa.
  @Roles(UserRole.ADMIN)
  @Get(':id/audit-log')
  auditLogForProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.auditLog.listForProduct(user.tenantId, id);
  }
}
