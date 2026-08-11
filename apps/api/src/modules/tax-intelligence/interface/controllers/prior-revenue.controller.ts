import { BadRequestException, Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
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
import { PriorRevenueService } from '../../application/prior-revenue.service';
import { SalvarFaturamentoAnteriorDto } from '../dto/salvar-faturamento-anterior.dto';

// Faturamento anterior (RBT12) — 11/08/2026.
//
// Mesma proteção do cadastro de regime: leitura para quem tem o módulo,
// escrita só ADMIN. É o dado que define a alíquota do Simples da conta inteira.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FISCAL_SETTINGS)
@Controller('tax-intelligence/faturamento-anterior')
export class PriorRevenueController {
  constructor(private readonly service: PriorRevenueService) {}

  // periodoApuracao no formato 'YYYY-MM'. Explícito e não opcional-com-default
  // porque a janela de 12 meses depende dele inteiramente — deixar o servidor
  // assumir "mês corrente" faria a tela mostrar um período diferente do que o
  // contador está apurando, sem nada indicando isso.
  @Get()
  async obterJanela(@CurrentUser() user: AuthenticatedUser, @Query('periodoApuracao') periodoApuracao?: string) {
    return this.service.montarJanela(user.tenantId, parsePeriodo(periodoApuracao));
  }

  @Roles(UserRole.ADMIN)
  @Put()
  async salvar(@CurrentUser() user: AuthenticatedUser, @Body() dto: SalvarFaturamentoAnteriorDto) {
    await this.service.salvar(user.tenantId, dto.linhas);
    // Devolve a janela recalculada do mês corrente: a tela precisa saber
    // imediatamente se ainda faltam meses para o cálculo destravar.
    return this.service.montarJanela(user.tenantId, new Date());
  }
}

// 'YYYY-MM' -> primeiro dia do mês em UTC. Validação na fronteira, com erro
// que diz o formato esperado em vez de devolver Invalid Date adiante.
function parsePeriodo(valor: string | undefined): Date {
  if (!valor) return new Date();

  const match = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!match) {
    throw new BadRequestException({
      code: 'PERIODO_INVALIDO',
      message: 'periodoApuracao deve estar no formato YYYY-MM (por exemplo, 2026-08).',
    });
  }

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) {
    throw new BadRequestException({
      code: 'PERIODO_INVALIDO',
      message: `Mês inválido em periodoApuracao: "${valor}".`,
    });
  }

  return new Date(Date.UTC(ano, mes - 1, 1));
}
