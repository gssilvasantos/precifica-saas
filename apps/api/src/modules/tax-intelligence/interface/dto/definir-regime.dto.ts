import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

// Validação de FORMA na fronteira. A coerência entre regime e campos (Simples
// exige anexo, MEI exige valor fixo, etc.) é invariante de negócio e vive no
// domínio — ver domain/tenant-tax-profile-rules.ts. Duplicar aquela regra aqui
// criaria duas verdades que divergiriam na primeira mudança de legislação.

export const REGIMES = ['MEI_SIMEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const;
export const ANEXOS = ['I', 'II', 'III', 'IV', 'V'] as const;

export class DefinirRegimeDto {
  @IsString()
  @Length(2, 2, { message: 'UF deve ter exatamente 2 letras.' })
  uf!: string;

  @IsIn(REGIMES, { message: `regime deve ser um de: ${REGIMES.join(', ')}.` })
  regime!: (typeof REGIMES)[number];

  @IsOptional()
  @IsIn(ANEXOS, { message: `anexo deve ser um de: ${ANEXOS.join(', ')}.` })
  anexo?: (typeof ANEXOS)[number] | null;

  // A data em que o regime passa a valer. Obrigatória e explícita: assumir
  // "hoje" faria uma troca de regime cadastrada com atraso reescrever o mês
  // corrente em silêncio.
  @Type(() => Date)
  @IsDate({ message: 'vigenciaInicio deve ser uma data válida (ISO 8601).' })
  vigenciaInicio!: Date;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999.99)
  meiValorFixoMensal?: number | null;

  // Percentuais 0–100, convenção do schema. O teto de 100 é CHECK de sanidade,
  // não regra fiscal: alíquota acima disso é erro de digitação, não um regime
  // exótico.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  icmsAliquotaPct?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  presuncaoIrpjPct?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  presuncaoCsllPct?: number | null;

  @IsOptional()
  @IsEnum({ AUTO: 'AUTO', MANUAL: 'MANUAL' }, { message: 'automationMode deve ser AUTO ou MANUAL.' })
  automationMode?: 'AUTO' | 'MANUAL';
}
