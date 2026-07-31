-- Painel de Administração da Plataforma (30/07/2026, pedido do usuário) —
-- Tenant.isActive bloqueia o acesso de TODOS os usuários de uma conta de uma
-- vez (checado em AuthService.login); User.isPlatformAdmin marca quem
-- enxerga a tela cross-tenant de administração (guardado pelo
-- PlatformAdminGuard). Idempotente (IF NOT EXISTS), mesmo padrão das demais
-- migrações retroativas desta base.

ALTER TABLE "identity"."tenants" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
