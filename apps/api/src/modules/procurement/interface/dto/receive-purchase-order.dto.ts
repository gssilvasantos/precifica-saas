import { IsString } from 'class-validator';

// Corpo do POST .../receive — conferredByUserId nunca vem do body (sempre
// resolvido do usuário autenticado, mesmo padrão de StockMovementAuditEventController.approve).
export class ReceivePurchaseOrderDto {
  @IsString()
  invoiceNumber!: string;
}
