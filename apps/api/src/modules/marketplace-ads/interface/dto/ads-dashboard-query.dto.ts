import { IsDateString, IsOptional } from 'class-validator';

// Período do dashboard — ambos opcionais: sem filtro, cobre os últimos 30
// dias (mesma janela padrão do AdsSyncOrchestrator), nunca "todo o
// histórico" por padrão (ao contrário do DRE) — dado de ads sem filtro de
// data cresce rápido demais para um agregado fazer sentido sem período.
export class AdsDashboardQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
