// Script de manutenção ÚNICO — apaga os pedidos REAIS do Mercado Livre já
// sincronizados para o tenant demo, para forçar a próxima sincronização a
// tratar como "primeira sincronização" de novo (ver
// OrderSyncOrchestrator.syncTenant — `hasAnyOrderForChannel`), usando a
// janela de backfill de 2 anos E a lógica corrigida de status de envio real
// (ver README, seção "Bug de produção — janela fixa de 7 dias..." e
// "Corrigir status de envio real"). Necessário porque os ~316 pedidos já
// gravados nesta sessão ficaram presos em PREPARANDO_ENVIO para sempre —
// esse bug foi corrigido no CÓDIGO, mas a sincronização incremental (7 dias)
// que roda depois da primeira nunca re-toca pedido mais antigo que isso, só
// um novo backfill completo corrige o dado já gravado.
//
// SEGURO de rodar: o Mercado Livre é a fonte da verdade (rawPayload/valores
// vêm de lá), apagar a cópia local não perde informação nenhuma — a próxima
// sincronização recria tudo, agora com o status correto.
//
// Rodar: cd apps/api && npx ts-node clear-mercado-livre-orders.ts
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001'; // "Loja Demo", mesmo tenant usado para a conexão real do Mercado Livre
const CHANNEL_CODE = 'MERCADO_LIVRE';

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    // Mesma válvula de bypass usada por seed-demo.ts/create-review-user.ts.
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    // OrderItem tem onDelete: Cascade em relação a Order (schema.prisma) —
    // apagar o Order já apaga os itens associados, sem query extra.
    return tx.order.deleteMany({ where: { tenantId: TENANT_ID, channelCode: CHANNEL_CODE, isDemo: false } });
  });

  console.log(`\n${result.count} pedido(s) real(is) do Mercado Livre apagado(s) para o tenant ${TENANT_ID}.`);
  console.log('Na próxima vez que o OrdersSyncSchedulerJob rodar (cron de 10 min), vai detectar que');
  console.log('não há mais pedido nenhum e refazer o backfill completo — agora com o status de');
  console.log('envio correto (consultando /shipments/{id} de verdade, não mais um chute).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
