// Script de diagnóstico ÚNICO — dá a resposta direta do banco de produção
// sobre o estado real da sincronização do Mercado Livre, sem depender de
// filtrar/interpretar a UI de logs do Render (que se mostrou confusa demais
// pra diagnosticar isso ao vivo). Mostra: (1) status da conexão OAuth2, (2)
// quantos pedidos reais já estão gravados, (3) as últimas tentativas de sync
// registradas em ProviderSyncLog (com status/candidatos/erro), (4) o health
// atual do provider.
//
// Rodar: cd apps/api && npx ts-node diagnose-ml-sync.ts
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PROVIDER_CODE = 'MERCADO_LIVRE_ORDERS';
const CHANNEL_CODE = 'MERCADO_LIVRE';

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    console.log('\n=== 1. Conexão OAuth2 (MercadoLivreConnection) ===');
    const connection = await tx.mercadoLivreConnection.findUnique({ where: { tenantId: TENANT_ID } });
    if (!connection) {
      console.log('Nenhuma linha de conexão encontrada para este tenant.');
    } else {
      console.log({
        sellerId: connection.sellerId,
        isActive: connection.isActive,
        expiresAt: connection.expiresAt,
        expirado: connection.expiresAt < new Date(),
        lastRefreshedAt: connection.lastRefreshedAt,
      });
    }

    console.log('\n=== 2. Pedidos reais já gravados (Order, channelCode=MERCADO_LIVRE) ===');
    const orderCount = await tx.order.count({ where: { tenantId: TENANT_ID, channelCode: CHANNEL_CODE, isDemo: false } });
    console.log(`Total: ${orderCount} pedido(s).`);
    if (orderCount > 0) {
      const statusBreakdown = await tx.order.groupBy({
        by: ['status'],
        where: { tenantId: TENANT_ID, channelCode: CHANNEL_CODE, isDemo: false },
        _count: true,
      });
      console.log('Por status:', statusBreakdown.map((s) => `${s.status}=${s._count}`).join(', '));
    }

    console.log('\n=== 3. Últimas 10 tentativas de sync (ProviderSyncLog) ===');
    const logs = await tx.providerSyncLog.findMany({
      where: { providerCode: PROVIDER_CODE },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    if (logs.length === 0) {
      console.log('Nenhuma tentativa registrada ainda.');
    } else {
      for (const log of logs) {
        const durationMs = log.finishedAt ? log.finishedAt.getTime() - log.startedAt.getTime() : null;
        console.log({
          startedAt: log.startedAt,
          finishedAt: log.finishedAt ?? '(NUNCA TERMINOU — ainda em andamento ou processo morreu no meio)',
          duracaoSegundos: durationMs !== null ? Math.round(durationMs / 1000) : null,
          status: log.status,
          candidatesFound: log.candidatesFound,
          candidatesApplied: log.candidatesApplied,
          errorDetails: log.errorDetails,
        });
      }
    }

    console.log('\n=== 4. Health do provider (ProviderHealth) ===');
    const health = await tx.providerHealth.findUnique({ where: { providerCode: PROVIDER_CODE } });
    if (!health) {
      console.log('Nenhum registro de health ainda.');
    } else {
      console.log({
        status: health.status,
        consecutiveFailures: health.consecutiveFailures,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt,
        lastError: health.lastError,
      });
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
