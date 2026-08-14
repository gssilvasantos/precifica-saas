import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
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
import { TenantTaxProfileService } from '../../application/tenant-tax-profile.service';
import { DefinirRegimeDto } from '../dto/definir-regime.dto';
import { TenantTaxProfileRecord } from '../../application/ports/tax-repositories.port';

// Cadastro do regime tributário do tenant (11/08/2026).
//
// Mesma proteção do FiscalSettingsController: leitura para quem tem o módulo,
// escrita só para ADMIN. Trocar o regime muda o piso de preço e as deduções do
// DRE da conta inteira — não é configuração de operação diária.
//
// tenantId SEMPRE do token (@CurrentUser), nunca do corpo.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FISCAL_SETTINGS)
@Controller('tax-intelligence/regime')
export class TenantTaxProfileController {
  constructor(private readonly service: TenantTaxProfileService) {}

  @Get()
  async obterVigente(@CurrentUser() user: AuthenticatedUser) {
    const vigente = await this.service.obterVigente(user.tenantId);
    // null explícito em vez de 404: "ainda não configurou" é um estado normal
    // do onboarding, não um recurso inexistente. A UI mostra o formulário
    // vazio, não uma tela de erro.
    return vigente ? paraResposta(vigente) : null;
  }

  // Sugestão de reajuste da alíquota mantida à mão. null = nada a sugerir, que
  // é o estado normal enquanto a folga de segurança do lojista existir.
  @Get('sugestao')
  async obterSugestao(@CurrentUser() user: AuthenticatedUser) {
    return this.service.obterSugestaoDeReajuste(user.tenantId);
  }

  @Get('historico')
  async listarHistorico(@CurrentUser() user: AuthenticatedUser) {
    const historico = await this.service.listarHistorico(user.tenantId);
    return historico.map(paraResposta);
  }

  @Roles(UserRole.ADMIN)
  @Put()
  async definir(@CurrentUser() user: AuthenticatedUser, @Body() dto: DefinirRegimeDto) {
    const criado = await this.service.definirRegime(user.tenantId, {
      uf: dto.uf,
      regime: dto.regime,
      anexo: dto.anexo ?? null,
      vigenciaInicio: dto.vigenciaInicio,
      meiValorFixoMensal: dto.meiValorFixoMensal ?? null,
      icmsAliquotaPct: dto.icmsAliquotaPct ?? null,
      presuncaoIrpjPct: dto.presuncaoIrpjPct ?? null,
      presuncaoCsllPct: dto.presuncaoCsllPct ?? null,
      aliquotaManualPct: dto.aliquotaManualPct ?? null,
      automationMode: dto.automationMode ?? 'AUTO',
    });
    return paraResposta(criado);
  }
}

// Resposta traz só o necessário. `tenantId` fica de fora de propósito: o
// cliente já sabe de qual conta é, e devolvê-lo só aumenta a superfície.
//
// Os percentuais voltam como PERCENTUAL (0–100), não fração: é o que o
// formulário exibe e o que o usuário digitou. A fração é convenção interna do
// motor de cálculo, e vazá-la para a UI só produziria confusão de duas ordens
// de grandeza.
function paraResposta(record: TenantTaxProfileRecord) {
  const paraPct = (fracao: number | null) => (fracao === null ? null : Number((fracao * 100).toFixed(2)));

  return {
    id: record.id,
    uf: record.uf,
    regime: record.regime,
    anexo: record.anexo,
    vigenciaInicio: record.vigenciaInicio.toISOString(),
    vigenciaFim: record.vigenciaFim ? record.vigenciaFim.toISOString() : null,
    meiValorFixoMensal: record.meiValorFixoMensal,
    icmsAliquotaPct: paraPct(record.icmsAliquota),
    presuncaoIrpjPct: paraPct(record.presuncaoIrpj),
    presuncaoCsllPct: paraPct(record.presuncaoCsll),
    aliquotaManualPct: paraPct(record.aliquotaManual),
    automationMode: record.automationMode,
  };
}
