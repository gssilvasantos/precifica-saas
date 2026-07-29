import { IsIn, IsInt, IsPositive, IsString } from 'class-validator';

// Lançamento manual por lote (Produtos-Lotes, Projeto Estruturante 2,
// benchmark Bling ERP, 29/07/2026) — espelha LoteLancamentoDTO.tipoLancamento
// do Bling (Entrada/Saída/Balanço). `quantity` sempre positiva para
// ENTRADA/SAIDA (a direção vem de movementType); para BALANCO é a contagem
// física total do lote, não um delta (ver resolveLotAdjustmentDelta).
export class AdjustLotDto {
  @IsString()
  warehouseId!: string;

  @IsString()
  skuCode!: string;

  @IsString()
  lotCode!: string;

  @IsIn(['ENTRADA', 'SAIDA', 'BALANCO'])
  movementType!: 'ENTRADA' | 'SAIDA' | 'BALANCO';

  @IsInt()
  @IsPositive()
  quantity!: number;

  // Justificativa textual obrigatória — a "prova" deste tipo de evento (ver
  // canApproveLotAdjustment).
  @IsString()
  notes!: string;
}
