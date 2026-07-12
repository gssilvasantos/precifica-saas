import { IsString } from 'class-validator';

// Painel de abastecimento (Sprint 25) — a tabela é sempre por canal, já que
// giro/saldo do Full são conceitos por canal (cada marketplace tem seu
// próprio CD virtual). Trocar de canal na UI é só trocar este parâmetro.
export class ReplenishmentQueryDto {
  @IsString()
  channelCode!: string;
}
