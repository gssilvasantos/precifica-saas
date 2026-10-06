-- Checkpoint de retomada do sync do Olist (06/10/2026).
--
-- Causa raiz real do "sync travado pra sempre" (ver investigação de
-- 03-06/10/2026, que passou por 3 correções de timeout sem efeito nenhum):
-- o serviço `precifica-saas` roda no plano FREE do Render, que mata o
-- container inteiro depois de 15min sem tráfego HTTP externo — sem exceção,
-- sem log, sem shutdown gracioso. O catálogo real (1.804 SKUs, 1 req/1,3s)
-- leva ~40min pra sincronizar inteiro, ou seja, nunca teve garantia real de
-- terminar sem interrupção.
--
-- `resumeFromPage` guarda a próxima página do catálogo ainda não buscada —
-- ErpSyncOrchestrator grava aqui ao final de cada página e lê daqui ao
-- iniciar, pra retomar de onde parou em vez de reiniciar o catálogo inteiro
-- a cada interrupção. NULL = nada a retomar.

ALTER TABLE "erp_integration"."olist_connections" ADD COLUMN IF NOT EXISTS "resumeFromPage" INTEGER;
