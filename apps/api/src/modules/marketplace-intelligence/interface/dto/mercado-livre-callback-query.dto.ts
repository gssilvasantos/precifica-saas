import { IsString, MinLength } from 'class-validator';

// Query params do redirect que o Mercado Livre faz para o navegador do
// vendedor após a tela de autorização — nunca um body (é sempre GET, por
// especificação do OAuth2 authorization code flow).
export class MercadoLivreCallbackQueryDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  state!: string;
}
