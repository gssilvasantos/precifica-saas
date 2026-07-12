import { IsInt, IsPositive, Max } from 'class-validator';

// Edição do lead time por depósito (Sprint 25) — validação de forma aqui
// (tipo/faixa), validação de negócio (teto de 90, ownership do tenant) em
// WarehouseService.updateLeadTimeDays. A UI oferece 3/7/15 como atalhos,
// mas o valor aceito não é uma lista fechada — ver isValidLeadTimeDays.
export class UpdateLeadTimeDto {
  @IsInt()
  @IsPositive()
  @Max(90)
  leadTimeDays!: number;
}
