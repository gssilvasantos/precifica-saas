import { IsNumber, Max, Min } from 'class-validator';

export class UpdateFinancialPolicyDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRatePct!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  minProfitMarginPct!: number;
}
