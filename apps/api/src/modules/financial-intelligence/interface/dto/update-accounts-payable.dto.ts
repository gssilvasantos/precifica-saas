import { IsDateString, IsOptional, IsString } from 'class-validator';

// Não usa PartialType(CreateAccountsPayableDto) de propósito — update não
// permite mexer em amount/occurrence/totalInstallments (mudar valor ou
// parcelamento de uma conta já criada é uma operação de negócio diferente,
// não uma edição de campo; ver AccountsPayableService.update, que só aceita
// description/category/supplierId/dueDate/notes e só em contas PENDING).
export class UpdateAccountsPayableDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
