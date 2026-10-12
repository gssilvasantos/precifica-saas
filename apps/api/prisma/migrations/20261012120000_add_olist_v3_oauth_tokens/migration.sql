-- Conexão OAuth2 da API v3 do Olist (12/10/2026, ADR 0003) — fatia 1 de 3.
--
-- EXPAND puro: cinco colunas OPCIONAIS na tabela que já existe. Nenhum NOT NULL,
-- nenhum DROP/RENAME, nenhuma mudança de tipo. O código atual (sync v2) não lê
-- nem escreve estas colunas, então o deploy é seguro com a flag
-- OLIST_V3_ENABLED desligada.
--
-- Tabela já existente => RLS (tenant_isolation) e GRANT do papel app_runtime
-- continuam valendo; não há tabela nova, portanto nenhum par apply_*/grant_* novo.
--
-- Os dois tokens são gravados criptografados (AES-256-GCM, CredentialEncryptionService).
--
-- ROLLBACK (sem perda de dado de negócio — só tokens, refeitos ao reconectar):
--   ALTER TABLE "erp_integration"."olist_connections"
--     DROP COLUMN IF EXISTS "v3AccessTokenEnc",
--     DROP COLUMN IF EXISTS "v3RefreshTokenEnc",
--     DROP COLUMN IF EXISTS "v3AccessExpiresAt",
--     DROP COLUMN IF EXISTS "v3RefreshExpiresAt",
--     DROP COLUMN IF EXISTS "v3ConnectedAt";

ALTER TABLE "erp_integration"."olist_connections"
  ADD COLUMN IF NOT EXISTS "v3AccessTokenEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "v3RefreshTokenEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "v3AccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "v3RefreshExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "v3ConnectedAt" TIMESTAMP(3);
