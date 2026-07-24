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
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ImportMapPriceDto } from '../dto/import-map-price.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly auditLog: ProductAuditLogService,
    private readonly bulkMapPriceImport: BulkMapPriceImportService,
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
