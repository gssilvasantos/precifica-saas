import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
// 29/07/2026) — validação de formato do CFOP (4 dígitos) acontece no
// domínio/NaturezaOperacaoService, não aqui — este DTO só garante presença
// e tipo string.
export class CreateNaturezaOperacaoDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsNotEmpty()
  cfopVendaInterno!: string;

  @IsString()
  @IsNotEmpty()
  cfopVendaInterestadual!: string;

  @IsOptional()
  @IsString()
  cfopDevolucaoInterno?: string;

  @IsOptional()
  @IsString()
  cfopDevolucaoInterestadual?: string;
}
