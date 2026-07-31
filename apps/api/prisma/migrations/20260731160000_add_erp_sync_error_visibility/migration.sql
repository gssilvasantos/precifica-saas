-- Visibilidade de falha de sync (31/07/2026, bug relatado: "Olist não está
-- importando os anúncios" + "Nuvemshop continua auto preenchendo os campos").
--
-- Causa raiz do primeiro bug: ErpSyncOrchestrator.syncTenant (e o equivalente
-- da Nuvemshop, NuvemshopChannelListingSyncService.syncTenant) engolia TODO
-- erro internamente (log + ProviderHealth + ProviderSyncLog) mas nunca
-- propagava nada para quem chamou — nem para o scheduler, nem para o clique
-- manual em "Sincronizar agora". Resultado: card mostrava "Conectado" e
-- "Ainda não sincronizou" para sempre, sem nenhuma pista do motivo.
--
-- lastSyncStatus/lastSyncError guardam o resultado da ÚLTIMA tentativa
-- (sucesso ou falha), atualizado tanto pelo scheduler quanto pelo botão
-- manual — sucesso limpa os dois campos, falha preenche lastSyncError com a
-- mensagem real (ex.: token inválido, timeout, etc.).

ALTER TABLE "erp_integration"."olist_connections" ADD COLUMN IF NOT EXISTS "lastSyncStatus" TEXT;
ALTER TABLE "erp_integration"."olist_connections" ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT;

ALTER TABLE "erp_integration"."nuvemshop_connections" ADD COLUMN IF NOT EXISTS "lastSyncStatus" TEXT;
ALTER TABLE "erp_integration"."nuvemshop_connections" ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT;
