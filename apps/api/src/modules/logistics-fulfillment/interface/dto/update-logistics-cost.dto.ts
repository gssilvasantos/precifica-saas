import { IsNumber, Min } from 'class-validator';

// Edição do custo operacional por depósito (Sprint 26) — consumido pelo
// LogisticsCostReaderService para compor o custo logístico total do Motor
// de Margem de Promoções. Sem teto (ver isValidLogisticsCostPerUnit).
export class UpdateLogisticsCostDto {
  @IsNumber()
  @Min(0)
  logisticsCostPerUnit!: number;
}
