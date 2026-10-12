import { IsString, MaxLength, MinLength } from 'class-validator';

// Query do redirect do Olist ao navegador após a autorização (sempre GET no
// authorization code flow). Tamanho limitado: é entrada pública, sem JWT.
export class OlistV3CallbackQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  state!: string;
}
