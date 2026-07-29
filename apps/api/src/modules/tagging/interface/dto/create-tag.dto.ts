import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 4/Fase 0) — validação de forma aqui (tipo/tamanho/hex), validação de
// negócio (nome duplicado no tenant) em TaggingService.createTag.
export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}
