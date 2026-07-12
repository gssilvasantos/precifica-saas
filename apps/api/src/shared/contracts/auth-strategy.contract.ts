// Estratégia de autenticação por marketplace — cada canal tem um mecanismo
// diferente (OAuth2, HMAC, token estático). Ver
// docs/marketplace-intelligence-architecture.md, seção 4. Nenhum provider
// desta primeira etapa precisa disso ainda (os endpoints públicos do
// Mercado Livre usados hoje não exigem OAuth) — o contrato existe para os
// próximos adaptadores (Amazon, Shopee) e para o futuro módulo de push de
// preço, que precisará de auth por tenant.
export interface AuthStrategy {
  readonly type: 'OAUTH2' | 'API_KEY_HMAC' | 'STATIC_TOKEN' | 'NONE';
  readonly scope: 'PLATFORM' | 'TENANT';
  getValidAccessToken(tenantId?: string): Promise<string>;
}
