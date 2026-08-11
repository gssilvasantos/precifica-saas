import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export const FONTES = ['MANUAL', 'PGDAS_D', 'DASN_SIMEI'] as const;

export class CompetenciaDto {
  // Qualquer data dentro do mês; o serviço normaliza para o primeiro dia.
  @Type(() => Date)
  @IsDate({ message: 'competencia deve ser uma data válida (ISO 8601).' })
  competencia!: Date;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  receitaMercadoInterno!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  receitaMercadoExterno!: number;

  @IsIn(FONTES, { message: `fonte deve ser uma de: ${FONTES.join(', ')}.` })
  fonte!: (typeof FONTES)[number];
}

export class SalvarFaturamentoAnteriorDto {
  // Teto de 60: a janela do RBT12 tem 12 meses, e 5 anos cobrem qualquer
  // recomposição de histórico razoável. Array sem limite é convite a payload
  // gigante (.claude/rules/backend.md).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => CompetenciaDto)
  linhas!: CompetenciaDto[];
}
