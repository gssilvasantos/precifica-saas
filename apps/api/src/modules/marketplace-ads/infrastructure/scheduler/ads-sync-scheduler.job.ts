import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdsSyncOrchestrator } from '../../application/ads-sync-orchestrator.service';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

// Job leve, sem due-check contra ProviderSyncSchedule (nenhuma linha
// seedada para ADS ainda) — mesmo racional de simplicidade do
// NuvemshopSyncSchedulerJob: intervalo fixo, direto. 2h porque gasto/receita
// de ads não muda minuto a minuto como pedido, e a API do Mercado Livre tem
// sua própria janela de consolidação diária de métricas — sincronizar mais
// rápido que isso não traria dado mais fresco, só mais chamadas.
@Injectable()
export class AdsSyncSchedulerJob {
  private readonly logger = new Logger(AdsSyncSchedulerJob.name);

  constructor(private readonly orchestrator: AdsSyncOrchestrator) {}

  @Cron(CronExpression.EVERY_2_HOURS)
  async syncAll() {
    this.logger.log('Sincronização periódica de Ads iniciada.');
    // Cron não passa pelo TenantContextInterceptor (não há requisição HTTP)
    // — sem isto, a primeira consulta ao Prisma dentro do orquestrador
    // lançaria "sem contexto de tenant" (ver shared/prisma/prisma.service.ts).
    // Bypass aqui é só o envelope externo: o loop por tenant dentro de
    // AdsSyncOrchestrator.syncProvider reabre o contexto correto por tenant
    // antes de tocar dado de negócio. Ver docs/row-level-security-architecture.md, seção 3.3.
    await TenantContextStore.runAsService(() => this.orchestrator.syncAll());
  }
}
