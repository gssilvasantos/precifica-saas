-- Cursor do sync incremental da API v3 do Olist (12/10/2026, ADR 0003) — fatia 2 de 3.
--
-- EXPAND puro: uma coluna OPCIONAL em tabela existente. Sem NOT NULL, sem DROP/RENAME.
-- O código antigo não lê nem escreve esta coluna; com OLIST_V3_SYNC_ENABLED desligada
-- nada muda. RLS e GRANT da tabela continuam valendo (sem tabela nova).
--
-- NULL = a conta ainda não rodou o sync v3; o serviço parte de lastSyncedAt (v2).
--
-- ROLLBACK (sem perda de dado de negócio — o cursor é refeito na próxima rodada):
--   ALTER TABLE "erp_integration"."olist_connections" DROP COLUMN IF EXISTS "v3SyncCursorAt";

ALTER TABLE "erp_integration"."olist_connections"
  ADD COLUMN IF NOT EXISTS "v3SyncCursorAt" TIMESTAMP(3);
