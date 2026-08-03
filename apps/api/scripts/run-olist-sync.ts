/**
 * Dispara a sincronização com o Olist para um tenant, fora do ciclo HTTP.
 *
 * Uso:
 *   npx ts-node scripts/run-olist-sync.ts <tenantId>
 *
 * Por que existe: o sync roda por agendamento ou pelo botão "Sincronizar
 * agora" da tela de Integrações. Nenhum dos dois serve para operar/depurar —
 * o primeiro não dá para provocar na hora, o segundo exige sessão de usuário.
 * Este script usa o MESMO ErpSyncOrchestrator (nada é reimplementado aqui),
 * então o que ele exercita é exatamente o caminho de produção.
 *
 * Abre o TenantContextStore explicitamente: sem isso toda consulta do Prisma
 * falha por falta de contexto de RLS — proteção deliberada contra job que
 * roda "no escuro" (ver shared/prisma/prisma.service.ts).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ErpSyncOrchestrator } from '../src/modules/erp-integration/application/erp-sync-orchestrator.service';
import { TenantContextStore } from '../src/shared/prisma/tenant-context';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Uso: npx ts-node scripts/run-olist-sync.ts <tenantId>');
    process.exit(1);
  }

  const logger = new Logger('run-olist-sync');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const orchestrator = app.get(ErpSyncOrchestrator);
    const inicio = Date.now();

    logger.log(`Iniciando sync do Olist para o tenant ${tenantId}...`);
    const resultado = await TenantContextStore.run(tenantId, () => orchestrator.syncTenant(tenantId));

    const minutos = ((Date.now() - inicio) / 60_000).toFixed(1);
    if (resultado.success) {
      logger.log(`Sync concluído em ${minutos} min.`);
    } else {
      logger.error(`Sync falhou em ${minutos} min: ${resultado.error}`);
    }
    process.exitCode = resultado.success ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main();
