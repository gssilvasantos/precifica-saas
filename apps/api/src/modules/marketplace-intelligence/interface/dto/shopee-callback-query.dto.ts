import { IsString, MinLength } from 'class-validator';

// Query params do redirect que a Shopee faz para o navegador do lojista
// após a tela de autorização (/api/v2/shop/auth_partner) — sempre GET.
// `state` não é um parâmetro nativo da Shopee: é o NOSSO próprio query
// param, embutido no `redirect` passado a buildAuthPartnerUrl, que a Shopee
// preserva ao anexar `code`/`shop_id` (ver aviso de honestidade em
// shopee-api-client.ts).
export class ShopeeCallbackQueryDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  shop_id!: string;

  @IsString()
  @MinLength(1)
  state!: string;
}
