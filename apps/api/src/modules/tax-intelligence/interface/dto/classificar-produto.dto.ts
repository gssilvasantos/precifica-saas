import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { FONTES_DE_CLASSIFICACAO } from '../../application/product-tax-profile.service';

export class ClassificarProdutoDto {
  @IsString()
  @Length(2, 2, { message: 'UF deve ter exatamente 2 letras.' })
  uf!: string;

  // Substituição tributária: o ICMS já foi recolhido pelo substituto, então a
  // parcela de ICMS sai da partilha do DAS para este produto.
  @IsBoolean()
  icmsSt!: boolean;

  // PIS/Cofins monofásicos (Lei 10.147/2000, típico de cosméticos e
  // medicamentos): a parcela de PIS/Cofins também sai.
  @IsBoolean()
  monofasico!: boolean;

  // Aceita com ou sem pontuação; o serviço normaliza e exige 8 dígitos.
  @IsOptional()
  @IsString()
  @MaxLength(12)
  ncm?: string | null;

  @IsIn(FONTES_DE_CLASSIFICACAO, {
    message: `fonte deve ser uma de: ${FONTES_DE_CLASSIFICACAO.join(', ')}.`,
  })
  fonte!: (typeof FONTES_DE_CLASSIFICACAO)[number];

  @Type(() => Date)
  @IsDate({ message: 'vigenciaInicio deve ser uma data válida (ISO 8601).' })
  vigenciaInicio!: Date;
}
