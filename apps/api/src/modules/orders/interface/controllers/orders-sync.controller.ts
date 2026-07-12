import { Body, Controller, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, UserRole } from '../../../identity-access/public-api';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';

// Dois caminhos de sincronização, além do OrdersSyncSchedulerJob (polling
// periódico, ver infrastructure/scheduler/orders-sync-scheduler.job.ts):
//
// 1. Trigger manual autenticado ("sincronizar agora"), mesmo padrão de
//    MarketplaceProvidersController.triggerSync.
// 2. Webhook público por canal — RECEBE a notificação do marketplace
//    (ex.: Nuvemshop dispara em order/created, order/paid, order/updated).
//
// AVISO DE HONESTIDADE (MVP, docs/orders-architecture.md, seção 3): o
// webhook aqui NÃO faz parsing dirigido pelo payload (isso exigiria decodificar
// o formato específico de cada canal e, principalmente, validar a
// assinatura/segredo do webhook — que também é específico por canal e não
// foi configurado ainda). Em vez disso, tratamos a chegada do webhook como
// um "nudge": disparamos o MESMO pipeline incremental que o scheduler
// roda (OrderSyncOrchestrator.syncProvider), que busca pedidos atualizados
// na janela recente via `since`. Isso é estrategicamente seguro (nunca
// aplica dado não validado direto do payload do webhook) e honesto sobre o
// que falta para ficar "tempo real de verdade": validação de assinatura +
// parsing do payload específico por canal, para atualizar o pedido pontual
// sem esperar a próxima varredura incremental.
@Controller('orders/providers')
export class OrdersSyncController {
  private readonly logger = new Logger(OrdersSyncController.name);

  constructor(private readonly orchestrator: OrderSyncOrchestrator) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':providerCode/sync')
  async triggerSync(@Param('providerCode') providerCode: string) {
    await this.orchestrator.syncProvider(providerCode);
    return { triggered: true, providerCode };
  }

  // Sem guard de autenticação de propósito — o marketplace não tem como
  // enviar um JWT nosso. A ausência de verificação de assinatura aqui é o
  // gap documentado acima; até que exista, este endpoint só "acorda" o
  // pipeline incremental (nunca escreve o payload cru direto).
  @Post(':providerCode/webhook')
  async receiveWebhook(@Param('providerCode') providerCode: string, @Body() payload: unknown) {
    this.logger.log(`Webhook recebido para ${providerCode} — disparando sync incremental (payload não é lido diretamente).`);
    // Fire-and-forget seria mais correto para um endpoint de webhook (o
    // marketplace espera um 2xx rápido), mas como o pipeline atual é só
    // best-effort e reaproveita o mesmo path do scheduler, aguardamos aqui
    // por simplicidade — se o volume justificar, isto vira uma fila.
    await this.orchestrator.syncProvider(providerCode);
    return { received: true, providerCode };
  }
}
