import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdsAiOptimizationService } from '../../application/ads-ai-optimization.service';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

// Cron SEPARADO do AdsSyncSchedulerJob (2h) de propósito — ver
// docs/marketplace-ads-ai-fase4-architecture.md, seção 1.4: chamada de LLM
// tem custo e latência que sincronizar métrica não tem, e saúde de campanha
// não muda o suficiente hora a hora para justificar o custo de token a cada
// ciclo de 2h. O alerta determinístico (Fase 2, barato, roda a cada 2h) já
// cobre o caso urgente; a IA é para achar padrões que o threshold não vê,
// não para reagir em tempo real.
//
// Sem due-check contra ProviderSyncSchedule — mesma simplicidade consciente
// de AdsSyncSchedulerJob: intervalo fixo, direto.
@Injectable()
export class AdsAiOptimizationSchedulerJob {
  private readonly logger = new Logger(AdsAiOptimizationSchedulerJob.name);

  constructor(private readonly optimization: AdsAiOptimizationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async runAll() {
    this.logger.log('Ciclo diário de sugestão de otimização de ads (IA) iniciado.');
    // Ver ads-sync-scheduler.job.ts / docs/row-level-security-architecture.md,
    // seção 3.3 — bypass só do envelope externo, o loop por tenant dentro de
    // AdsAiOptimizationService.runAll reabre o contexto correto por tenant.
    await TenantContextStore.runAsService(() => this.optimization.runAll());
  }
}
