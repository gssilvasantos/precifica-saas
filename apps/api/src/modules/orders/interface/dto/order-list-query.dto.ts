import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AppDataMode, OrderStatus } from '../../domain/order.entity';

const ORDER_STATUSES: OrderStatus[] = ['EM_ABERTO', 'PREPARANDO_ENVIO', 'FATURADO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'];
const APP_DATA_MODES: AppDataMode[] = ['REAL', 'DEMO'];

// Filtros da worklist (docs/orders-architecture.md, seção 4) — todos
// opcionais: sem filtro nenhum, GET /orders retorna a página mais recente de
// todos os canais/status.
export class OrderListQueryDto {
  @IsOptional()
  @IsString()
  channelCode?: string;

  @IsOptional()
  @IsEnum(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;

  // Modo de Demonstração / Audit Mode — ausente = 'REAL' (worklist nunca
  // mostra pedido fictício por padrão). Ver docs/audit-mode.md.
  @IsOptional()
  @IsIn(APP_DATA_MODES)
  mode?: AppDataMode;
}
