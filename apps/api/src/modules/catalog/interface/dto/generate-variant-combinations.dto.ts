import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';

// Geração automática de combinações de variação (Quick Win 5, benchmark
// Bling, docs/bling-erp-benchmark-analysis.md, seção 1.5) — espelha o corpo
// de `POST /produtos/variacoes/atributos/gerar-combinacoes`: lista de
// atributos, cada um com um nome e a lista de opções que ele assume.
export class VariantAttributeDefinitionDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  options!: string[];
}

export class GenerateVariantCombinationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDefinitionDto)
  attributes!: VariantAttributeDefinitionDto[];
}
