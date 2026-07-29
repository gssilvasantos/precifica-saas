import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class MarkAccountsPayablePaidDto {
  // Opcional — se omitido, AccountsPayableService.markPaid usa `new Date()`
  // (data da baixa = agora). Existe pra permitir lançar uma baixa retroativa
  // (ex.: importando um histórico), mesmo racional de ReceivableMarkPaidData.
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  // Quick Win 4 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2 — ContasBaixarContaDTO) — todos opcionais e aditivos. Omitidos,
  // a baixa é do valor de face integral (comportamento de antes deste quick
  // win). Ver domain/accounts-payable.entity.ts (resolvePaidAmount).
  @IsOptional()
  @IsNumber()
  @Min(0)
  interestAmount?: number; // juros

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number; // desconto

  @IsOptional()
  @IsNumber()
  @Min(0)
  feeAmount?: number; // tarifa
}
