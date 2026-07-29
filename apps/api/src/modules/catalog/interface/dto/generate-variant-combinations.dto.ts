import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';

// Geração automática de combinações de variação (Quick Win 5, benchmark
// Bling, docs/bling-erp-benchmark-analysis.md, seção 1.5) — espelha o corpo
// de `POST /produtos/variacoes/atributos/gerar-combinacoes`: lista de
// atributos, cada um com um nome e a lista de opções que ele assume.
export class VariantAttributeDefinitionDto {
  @IsString()
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  options!: string[];
}

export class GenerateVariantCombinationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDefinitionDto)
  attributes!: VariantAttributeDefinitionDto[];
}
