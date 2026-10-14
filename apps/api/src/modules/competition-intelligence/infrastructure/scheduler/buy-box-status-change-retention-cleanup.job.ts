import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BuyBoxStatusChangeRetentionService } from '../../application/buy-box-status-change-retention.service';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

// ADR-0004 (14/10/2026) — mesmo padrão de VideoRetentionCleanupJob
// (logistics-fulfillment): job leve de @Cron que só invoca a regra de
// negócio (runRetentionCleanup), nunca implementa a lógica de retenção
// aqui dentro. Diário, de madrugada — retenção de 365 dias não é operação
// tempo-sensível.
@Injectable()
export class BuyBoxStatusChangeRetentionCleanupJob {
  private readonly logger = new Logger(BuyBoxStatusChangeRetentionCleanupJob.name);

  constructor(private readonly retention: BuyBoxStatusChangeRetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async runCleanup() {
    // Varredura de manutenção cruzando todos os tenants por natureza
    // (apaga histórico vencido por data, não por conta específica) —
    // bypass do envelope inteiro é o desenho correto aqui, mesmo racional
    // de VideoRetentionCleanupJob. Ver docs/row-level-security-architecture.md,
    // seção 3.3.
    await TenantContextStore.runAsService(() => this.runCleanupInner());
  }

  private async runCleanupInner() {
    try {
      await this.retention.runRetentionCleanup(new Date());
    } catch (error) {
      this.logger.error(`Falha na execução do job de retenção de histórico de buy box: ${(error as Error).message}`);
    }
  }
}
