import { Module } from '@nestjs/common';
import { ConsoleAlertService } from './console-alert.service';
import { ALERT_SERVICE } from './ports/alert-service.port';

// Módulo compartilhado (mesmo padrão de SyncOpsModule) — quem precisa
// emitir um alerta técnico importa só este módulo e injeta ALERT_SERVICE,
// nunca ConsoleAlertService diretamente.
@Module({
  providers: [{ provide: ALERT_SERVICE, useClass: ConsoleAlertService }],
  exports: [ALERT_SERVICE],
})
export class ObservabilityModule {}
