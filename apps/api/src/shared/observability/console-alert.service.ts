import { Injectable, Logger } from '@nestjs/common';
import { AlertService, TechnicalAlert } from './ports/alert-service.port';

// Implementação padrão de AlertService — loga com um prefixo fixo e
// "grepável" ([ALERTA TÉCNICO]), em nível de log correspondente à
// severidade (error para ERROR, warn para WARNING). Não é um sistema de
// notificação de verdade (sem Slack/e-mail/PagerDuty) — é o mínimo
// necessário para que uma falha de sync ou de renovação de token pare de
// exigir checagem manual: aparece no log do processo, com um formato
// consistente que uma ferramenta de log aggregation (ex.: Datadog,
// CloudWatch Logs Insights) já consegue filtrar/alertar em cima, mesmo sem
// nenhuma mudança de código aqui.
//
// Gap honesto (ver Auditoria Técnica Consolidada, seção 6): isto é
// observabilidade básica, não uma "camada de observabilidade" completa —
// não há APM/tracing, não há métricas expostas (Prometheus), e ninguém é
// avisado ativamente (e-mail/SMS/push) enquanto este serviço não for
// substituído por uma implementação que chame um serviço externo. A porta
// (AlertService) já está pronta para essa substituição ser um adapter novo,
// não uma reescrita.
@Injectable()
export class ConsoleAlertService implements AlertService {
  private readonly logger = new Logger('AlertaTecnico');

  emitAlert(alert: TechnicalAlert): void {
    const contextSuffix = alert.context ? ` ${JSON.stringify(alert.context)}` : '';
    const line = `[ALERTA TÉCNICO] [${alert.source}] ${alert.message}${contextSuffix}`;

    if (alert.severity === 'ERROR') {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }
  }
}
