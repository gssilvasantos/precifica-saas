import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { AppDataMode } from '../../../../shared/contracts/order-financials-reader.port';

const APP_DATA_MODES: AppDataMode[] = ['REAL', 'DEMO'];

// Período do DRE — ambos opcionais: sem filtro nenhum, o relatório cobre
// TODOS os pedidos do tenant (aceitável para o volume de MVP; ver aviso de
// escala em orders/infrastructure/prisma-order.repository.ts).
export class DreQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // Modo de Demonstração / Audit Mode — ausente = 'REAL' (nunca mistura
  // pedido fictício no DRE por padrão). Ver docs/audit-mode.md.
  @IsOptional()
  @IsIn(APP_DATA_MODES)
  mode?: AppDataMode;
}
