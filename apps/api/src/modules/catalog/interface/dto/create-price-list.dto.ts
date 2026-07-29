import { IsNumber, IsString, Max, Min } from 'class-validator';

export class CreatePriceListDto {
  @IsString()
  name!: string;

  // Positivo = acréscimo, negativo = desconto (ex.: -10 = "10% off").
  @IsNumber()
  @Min(-99.99)
  @Max(1000)
  adjustmentPct!: number;
}
