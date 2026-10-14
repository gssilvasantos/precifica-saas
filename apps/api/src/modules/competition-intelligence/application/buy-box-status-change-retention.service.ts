import { Inject, Injectable, Logger } from '@nestjs/common';
import { buyBoxStatusChangeRetentionCutoff, BUY_BOX_STATUS_CHANGE_RETENTION_DAYS } from '../domain/status-change-retention';
import {
  BUY_BOX_STATUS_CHANGE_REPOSITORY,
  BuyBoxStatusChangeRepository,
} from './ports/buy-box-status-change-repository.port';

// Retenção de CompetitiveOpportunityStatusChange (ADR-0004, 14/10/2026) —
// chamado pelo job de limpeza em background
// (BuyBoxStatusChangeRetentionCleanupJob, @Cron diário). Mesmo padrão de
// VideoCaptureService.runRetentionCleanup (logistics-fulfillment): a regra
// de "quanto manter" é pura e vive em domain/status-change-retention.ts;
// este serviço só orquestra I/O.
@Injectable()
export class BuyBoxStatusChangeRetentionService {
  private readonly logger = new Logger(BuyBoxStatusChangeRetentionService.name);

  constructor(
    @Inject(BUY_BOX_STATUS_CHANGE_REPOSITORY) private readonly statusChanges: BuyBoxStatusChangeRepository,
  ) {}

  async runRetentionCleanup(now: Date = new Date()): Promise<{ deletedCount: number }> {
    const cutoff = buyBoxStatusChangeRetentionCutoff(now);
    const deletedCount = await this.statusChanges.deleteOlderThan(cutoff);

    if (deletedCount > 0) {
      this.logger.log(
        `Retenção de histórico de buy box: ${deletedCount} registro(s) apagado(s) (mais de ${BUY_BOX_STATUS_CHANGE_RETENTION_DAYS} dias).`,
      );
    }

    return { deletedCount };
  }
}
