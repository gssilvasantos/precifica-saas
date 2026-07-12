// Observabilidade básica (Fase de Conexão Real) — porta compartilhada para
// alertas técnicos, no mesmo espírito de ProviderSyncLogRepository/
// ProviderHealthRepository (shared/sync-ops/): um contrato simples, com uma
// implementação de baixo custo hoje (console/log estruturado) que pode ser
// trocada por Slack/PagerDuty/e-mail no futuro SEM tocar quem emite o
// alerta — o chamador conhece só AlertService + o token, nunca a
// implementação concreta (mesma disciplina de Ports & Adapters do resto da
// plataforma).
export type AlertSeverity = 'WARNING' | 'ERROR';

export interface TechnicalAlert {
  // Componente que detectou o problema (ex.: 'OrderSyncOrchestrator',
  // 'MercadoLivreConnectionService') — não o canal/tenant, isso vai em `context`.
  source: string;
  severity: AlertSeverity;
  message: string;
  // Dados estruturados extras (tenantId, providerCode, externalOrderId...) —
  // uma implementação futura (ex.: Slack) pode usar isso para montar campos
  // ricos na notificação, em vez de só concatenar tudo na mensagem.
  context?: Record<string, unknown>;
}

export interface AlertService {
  emitAlert(alert: TechnicalAlert): void;
}

export const ALERT_SERVICE = Symbol('ALERT_SERVICE');
