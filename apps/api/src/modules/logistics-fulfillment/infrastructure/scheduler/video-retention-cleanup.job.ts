import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VideoCaptureService } from '../../application/video-capture.service';

// Sprint 27 (Pick & Pack) — mesmo padrão de OrdersSyncSchedulerJob: job leve
// de @Cron que só invoca a regra de negócio (runRetentionCleanup), nunca
// implementa a lógica de retenção aqui dentro. Diário (não a cada 10 min,
// como o de pedidos) porque retenção de 30 dias não é operação
// tempo-sensível — atrasar algumas horas para apagar um vídeo vencido não
// tem impacto nenhum no negócio, diferente de um pedido não sincronizado.
@Injectable()
export class VideoRetentionCleanupJob {
  private readonly logger = new Logger(VideoRetentionCleanupJob.name);

  constructor(private readonly videoCapture: VideoCaptureService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runCleanup() {
    try {
      const { deletedCount } = await this.videoCapture.runRetentionCleanup(new Date());
      if (deletedCount > 0) {
        this.logger.log(`Job de retenção de vídeo: ${deletedCount} arquivo(s) apagado(s).`);
      }
    } catch (error) {
      this.logger.error(`Falha na execução do job de retenção de vídeo: ${(error as Error).message}`);
    }
  }
}
