import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WebhookSecretGuard } from './webhook-secret.guard';

describe('WebhookSecretGuard', () => {
  const originalSecret = process.env.WEBHOOK_SHARED_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.WEBHOOK_SHARED_SECRET;
    } else {
      process.env.WEBHOOK_SHARED_SECRET = originalSecret;
    }
  });

  function buildContext(query: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ query }) }),
    } as unknown as ExecutionContext;
  }

  // Regressão (20/10/2026): antes, nenhum dos webhooks (orders, Focus NFe)
  // tinha qualquer verificação — este guard existe exatamente pra fechar
  // esse gap, então ele mesmo precisa falhar alto sem configuração, do
  // mesmo jeito que JWT_SECRET e ERP_CREDENTIALS_ENCRYPTION_KEY.
  it('lança erro (falha alta) na construção quando WEBHOOK_SHARED_SECRET não está definida', () => {
    delete process.env.WEBHOOK_SHARED_SECRET;

    expect(() => new WebhookSecretGuard()).toThrow(/WEBHOOK_SHARED_SECRET/);
  });

  it('permite a requisição quando ?secret= bate com o valor configurado', () => {
    process.env.WEBHOOK_SHARED_SECRET = 'segredo-de-teste';
    const guard = new WebhookSecretGuard();

    expect(guard.canActivate(buildContext({ secret: 'segredo-de-teste' }))).toBe(true);
  });

  it('rejeita com UnauthorizedException quando o secret não bate', () => {
    process.env.WEBHOOK_SHARED_SECRET = 'segredo-de-teste';
    const guard = new WebhookSecretGuard();

    expect(() => guard.canActivate(buildContext({ secret: 'chute-errado' }))).toThrow(UnauthorizedException);
  });

  it('rejeita quando o parâmetro secret não vem na query', () => {
    process.env.WEBHOOK_SHARED_SECRET = 'segredo-de-teste';
    const guard = new WebhookSecretGuard();

    expect(() => guard.canActivate(buildContext({}))).toThrow(UnauthorizedException);
  });

  it('rejeita um secret mais curto ou mais longo que o configurado (sem lançar erro de tamanho do timingSafeEqual)', () => {
    process.env.WEBHOOK_SHARED_SECRET = 'segredo-de-teste';
    const guard = new WebhookSecretGuard();

    expect(() => guard.canActivate(buildContext({ secret: 'x' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(buildContext({ secret: 'segredo-de-teste-bem-mais-longo-que-o-real' }))).toThrow(
      UnauthorizedException,
    );
  });
});
