import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  ModuleAccessGuard,
  ModuleCode,
  RequireModule,
  Roles,
  RolesGuard,
  UserRole,
} from '../../../identity-access/public-api';
import { ProductTaxProfileService } from '../../application/product-tax-profile.service';
import { ClassificarProdutoDto } from '../dto/classificar-produto.dto';
import { ProductTaxProfileRecord } from '../../application/ports/tax-repositories.port';

// Classificação fiscal por produto (12/08/2026).
//
// POST e não PUT: cada chamada CRIA uma vigência nova (a anterior daquela UF é
// encerrada na véspera). Não é substituição de um recurso — é acréscimo ao
// histórico, e o verbo precisa dizer isso.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FISCAL_SETTINGS)
@Controller('tax-intelligence/produtos/:productId/perfil-fiscal')
export class ProductTaxProfileController {
  constructor(private readonly service: ProductTaxProfileService) {}

  @Get()
  async listar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
  ) {
    const registros = await this.service.listarPorProduto(user.tenantId, productId);
    return registros.map(paraResposta);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async classificar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: ClassificarProdutoDto,
  ) {
    // productId vem da ROTA e tenantId do TOKEN. O corpo não carrega nenhum
    // dos dois — um produto de outro tenant não é alcançável nem por engano,
    // porque toda query do repositório filtra por tenantId e o RLS reforça no
    // banco.
    const criado = await this.service.classificar(user.tenantId, {
      productId,
      uf: dto.uf,
      icmsSt: dto.icmsSt,
      monofasico: dto.monofasico,
      ncm: dto.ncm ?? null,
      fonte: dto.fonte,
      vigenciaInicio: dto.vigenciaInicio,
    });
    return paraResposta(criado);
  }
}

function paraResposta(record: ProductTaxProfileRecord) {
  return {
    id: record.id,
    productId: record.productId,
    uf: record.uf,
    icmsSt: record.icmsSt,
    monofasico: record.monofasico,
    ncm: record.ncm,
    fonte: record.fonte,
    vigenciaInicio: record.vigenciaInicio.toISOString(),
    vigenciaFim: record.vigenciaFim ? record.vigenciaFim.toISOString() : null,
  };
}
