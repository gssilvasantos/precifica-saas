import { IsString, MaxLength, MinLength } from 'class-validator';

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 1.6) — validação de forma aqui (tipo/tamanho), validação de negócio
// (ownership do tenant) em ProductWarehouseLocationService.setLocation.
export class SetProductLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  location!: string;
}
