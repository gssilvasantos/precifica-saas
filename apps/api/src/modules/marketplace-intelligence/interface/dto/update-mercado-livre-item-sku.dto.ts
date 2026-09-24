import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 70 caracteres é o teto documentado pelo Mercado Livre para o valor de um
// atributo de texto livre como SELLER_SKU — validação de borda aqui evita
// uma chamada de escrita real destinada a falhar só na resposta do canal.
export class UpdateMercadoLivreItemSkuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(70)
  skuCode!: string;
}
