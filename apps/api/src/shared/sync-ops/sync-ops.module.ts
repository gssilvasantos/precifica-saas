import { Module } from '@nestjs/common';
import { PrismaProviderSyncScheduleRepository } from './infrastructure/prisma-provider-sync-schedule.repository';
import { PrismaProviderSyncLogRepository } from './infrastructure/prisma-provider-sync-log.repository';
import { PrismaProviderHealthRepository } from './infrastructure/prisma-provider-health.repository';
import { PROVIDER_SYNC_SCHEDULE_REPOSITORY } from './ports/provider-sync-schedule-repository.port';
import { PROVIDER_SYNC_LOG_REPOSITORY } from './ports/provider-sync-log-repository.port';
import { PROVIDER_HEALTH_REPOSITORY } from './ports/provider-health-repository.port';

// Infraestrutura genérica de "orquestrar sincronizações externas periódicas"
// (agenda, log, saúde do provider) — extraída do Marketplace Intelligence na
// Etapa 5 porque o erp-integration precisa exatamente do mesmo mecanismo
// (schema integration_ops). Qualquer módulo que sincronize com uma fonte
// externa importa este módulo e consome só os tokens — nunca a classe
// concreta. Ver docs/erp-integration-architecture.md, seção 5.
@Module({
  providers: [
    { provide: PROVIDER_SYNC_SCHEDULE_REPOSITORY, useClass: PrismaProviderSyncScheduleRepository },
    { provide: PROVIDER_SYNC_LOG_REPOSITORY, useClass: PrismaProviderSyncLogRepository },
    { provide: PROVIDER_HEALTH_REPOSITORY, useClass: PrismaProviderHealthRepository },
  ],
  exports: [PROVIDER_SYNC_SCHEDULE_REPOSITORY, PROVIDER_SYNC_LOG_REPOSITORY, PROVIDER_HEALTH_REPOSITORY],
})
export class SyncOpsModule {}
