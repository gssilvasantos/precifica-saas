import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNotEmptyObject, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

export class FiscalAddressDto {
  @IsString()
  logradouro!: string;

  @IsString()
  numero!: string;

  @IsString()
  bairro!: string;

  @IsString()
  municipio!: string;

  @IsString()
  uf!: string;

  @IsString()
  cep!: string;

  @IsOptional()
  @IsString()
  pais?: string;
}

export class EmitInvoiceDestinatarioDto {
  @IsString()
  nome!: string;

  // Se ausente, usa Order.buyerTaxId — mas ao menos um dos dois precisa existir.
  @IsOptional()
  @IsString()
  documento?: string;

  @ValidateNested()
  @Type(() => FiscalAddressDto)
  @IsNotEmptyObject()
  endereco!: FiscalAddressDto;

  @IsOptional()
  @IsString()
  telefone?: string;
}

export class EmitInvoiceDto {
  @ValidateNested()
  @Type(() => EmitInvoiceDestinatarioDto)
  @IsNotEmptyObject()
  destinatario!: EmitInvoiceDestinatarioDto;

  @IsOptional()
  @IsString()
  naturezaOperacao?: string;

  // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2) — omitido = NORMAL. Ver domain/tax-code-resolver.ts
  // (NfeFinalidade) para o racional completo.
  @IsOptional()
  @IsIn(['NORMAL', 'COMPLEMENTAR', 'AJUSTE', 'DEVOLUCAO'])
  finalidade?: 'NORMAL' | 'COMPLEMENTAR' | 'AJUSTE' | 'DEVOLUCAO';

  // Chaves de acesso (44 dígitos) da(s) NF-e de origem — obrigatório quando
  // finalidade != NORMAL (validado em FiscalInvoiceService.emit, não aqui:
  // a obrigatoriedade depende de outro campo do mesmo DTO).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Matches(/^\d{44}$/, { each: true })
  documentoReferenciado?: string[];

  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026) — id de uma NaturezaOperacao cadastrada por este tenant.
  // Ausente = usa FiscalSettings.defaultNaturezaOperacaoId ou o fallback
  // hardcoded (ver EmitInvoiceInput em fiscal-invoice.service.ts).
  @IsOptional()
  @IsString()
  naturezaOperacaoId?: string;
}
