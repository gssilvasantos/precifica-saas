import { IsNumber, Min } from 'class-validator';

// Edição do frete médio estimado por canal (01/08/2026, política de frete
// — ver docs/marketplace-fee-model-architecture.md, §2.0). Consumido pelo
// motor de preço quando a política do canal transfere o frete ao vendedor
// (no Mercado Livre, a partir de R$79). Sem teto, mesmo racional do custo
// operacional: frete de item grande é ordens de magnitude maior que o de
// um envelope.
export class UpdateEstimatedFreightDto {
  @IsNumber()
  @Min(0)
  estimatedFreightCost!: number;
}
