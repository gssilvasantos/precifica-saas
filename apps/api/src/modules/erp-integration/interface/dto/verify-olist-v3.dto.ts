import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

// SKUs a verificar. Teto de 3 no servidor: cada SKU custa 2 chamadas na cota do
// Olist, que é da conta inteira e dividida com marketplaces.
export class VerifyOlistV3Dto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value))
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Matches(/^[A-Za-z0-9._/ -]+$/, { each: true, message: 'SKU com caracteres inválidos.' })
  skus!: string[];
}
