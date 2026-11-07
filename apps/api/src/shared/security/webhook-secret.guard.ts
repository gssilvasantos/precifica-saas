import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

// Mitigação para webhooks de marketplace/ERP que não assinam a notificação
// (achado de auditoria de segurança, 20/10/2026 — ver
// docs/decisions/0006-webhook-shared-secret.md). Nenhum dos provedores
// integrados hoje (Mercado Livre, Nuvemshop, Shopee, Focus NFe) garante um
// cabeçalho HMAC verificável nesta notificação — este guard não substitui
// uma assinatura real quando ela existir (se um provedor futuro assinar,
// prefira validar a assinatura dele em vez de reusar isto), mas fecha o gap
// de "qualquer um na internet pode descobrir a URL e chamar este endpoint"
// com um segredo compartilhado simples, comparado em tempo constante.
//
// Falha alta na inicialização se WEBHOOK_SHARED_SECRET não estiver
// configurada — mesmo princípio aplicado a JWT_SECRET e
// ERP_CREDENTIALS_ENCRYPTION_KEY no mesmo lote de correções: nunca um
// fallback silencioso que deixaria o endpoint aberto por engano.
//
// Verificação por query string (`?secret=...`), não path param: exige só
// acrescentar `?secret=...` na URL já cadastrada em cada painel de
// desenvolvedor (Mercado Livre DevCenter, app da Nuvemshop/Shopee, painel da
// Focus NFe), em vez de reestruturar a rota — mas ainda é uma mudança
// operacional real, que PRECISA ser replicada manualmente em cada painel
// depois do deploy, ou as notificações desse canal passam a ser rejeitadas
// com 403 até isso ser feito (degradação graciosa: o sync por polling
// agendado continua funcionando sem o webhook, só fica mais lento).
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly secret: string;

  constructor() {
    const secret = process.env.WEBHOOK_SHARED_SECRET;
    if (!secret) {
      throw new Error(
        'WEBHOOK_SHARED_SECRET não está definida. Configure essa variável de ambiente antes de iniciar a ' +
          'aplicação — nunca existe um valor padrão de desenvolvimento aqui (ver .env.example).',
      );
    }
    this.secret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = typeof request.query.secret === 'string' ? request.query.secret : '';

    // timingSafeEqual exige buffers do MESMO tamanho — compara contra um
    // hash de tamanho fixo (sha-independente aqui: comparação byte a byte só
    // é segura com tamanhos iguais) em vez do valor direto quando os
    // tamanhos diferem, pra nunca vazar o tamanho do segredo real por timing.
    const expected = Buffer.from(this.secret);
    const candidate = Buffer.from(provided.padEnd(expected.length, '\0').slice(0, expected.length));
    const sameLength = provided.length === expected.length;
    const matches = sameLength && timingSafeEqual(candidate, expected);

    if (!matches) {
      throw new UnauthorizedException('Segredo de webhook inválido ou ausente.');
    }
    return true;
  }
}
