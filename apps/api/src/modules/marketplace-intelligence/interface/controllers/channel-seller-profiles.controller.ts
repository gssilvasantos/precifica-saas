import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { ChannelSellerProfileService } from '../../application/channel-seller-profile.service';
import { UpsertChannelSellerProfileDto } from '../dto/upsert-channel-seller-profile.dto';

// Configuração da conta do vendedor em cada canal — é aqui que entra o
// liga/desliga do "Plano de vendas profissional" da Amazon e o desconto de
// frete por reputação do Mercado Livre.
//
// Por que é uma tela de configuração e não dado importado: nenhum canal
// expõe por API "este vendedor assina o plano X". É informação do contrato
// do lojista com o marketplace — mesma natureza do custo de embalagem, que
// o usuário já definiu como valor a cadastrar. Toda taxa que o canal
// DIVULGA continua sendo importada.
@Controller('marketplace-intelligence/seller-profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChannelSellerProfilesController {
  constructor(private readonly profiles: ChannelSellerProfileService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.listByTenant(user.tenantId);
  }

  // Devolve o perfil NEUTRO quando nada foi configurado, nunca 404 — a tela
  // precisa de algo para renderizar, e "nada configurado" é um estado
  // válido (significa: paga tarifa por item, paga frete cheio).
  @Get(':channelCode')
  get(@CurrentUser() user: AuthenticatedUser, @Param('channelCode') channelCode: string) {
    return this.profiles.getProfile(user.tenantId, channelCode.toUpperCase());
  }

  @Put(':channelCode')
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelCode') channelCode: string,
    @Body() dto: UpsertChannelSellerProfileDto,
  ) {
    return this.profiles.upsertProfile(user.tenantId, channelCode.toUpperCase(), dto);
  }
}
