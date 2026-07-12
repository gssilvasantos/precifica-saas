import { Inject, Injectable, Logger } from '@nestjs/common';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreApiClient } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';

export interface MercadoLivreHandshakeResult {
  success: boolean;
  testedAt: Date;
  sellerId: string | null;
  // true quando getValidAccessToken() precisou renovar o token durante este
  // teste (comparação de lastRefreshedAt antes/depois) — prova que o
  // caminho de renovação automática funciona de ponta a ponta, não só que
  // um token já válido foi lido.
  tokenRefreshed: boolean;
  ordersFound: number;
  sampleOrderId: string | null;
  errorMessage: string | null;
}

// Fase de Conexão Real (item 1 do pedido) — diagnóstico de handshake real
// contra a API do Mercado Livre, para o vendedor confirmar que a conta
// conectada de fato funciona ponta a ponta, ANTES de confiar na ingestão
// automática (scheduler) ou disparar um sync manual.
//
// DECISÃO DE ARQUITETURA — leitura pura, nunca escreve dados de pedido:
// este serviço deliberadamente NÃO persiste nenhum Order nem emite eventos
// de domínio. Ele exercita a MESMA cadeia que a ingestão real usa (status
// -> getValidAccessToken (renovação automática incluída) -> fetchOrders),
// mas o resultado é só um relatório de diagnóstico. A ingestão de verdade
// continua sendo o pipeline já existente: OrderSyncOrchestrator, disparado
// por POST /orders/providers/:providerCode/sync ou pelo scheduler
// (OrdersSyncSchedulerJob). Misturar as duas coisas (um "teste de conexão"
// que também grava pedidos) criaria um segundo caminho de escrita para a
// mesma tabela, com regras de deduplicação/eventos divergentes do
// orquestrador real — pior para manter, e surpreendente para quem só queria
// "ver se está conectado".
//
// AVISO DE HONESTIDADE: a cadeia OAuth2 (exchangeCodeForToken/
// refreshAccessToken/fetchOrders) foi implementada seguindo à risca a
// documentação pública do Mercado Livre, mas nunca foi exercitada contra
// credenciais de produção reais dentro deste ambiente de desenvolvimento
// (sandbox sem acesso de rede externo). Este serviço é exatamente a
// ferramenta para o usuário validar isso pela primeira vez, uma vez
// implantado com MERCADO_LIVRE_CLIENT_ID/SECRET reais e uma conexão
// autorizada de verdade — não uma simulação.
@Injectable()
export class MercadoLivreHandshakeService {
  private readonly logger = new Logger(MercadoLivreHandshakeService.name);

  constructor(
    private readonly connectionService: MercadoLivreConnectionService,
    private readonly client: MercadoLivreApiClient,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  async testConnection(tenantId: string): Promise<MercadoLivreHandshakeResult> {
    const testedAt = new Date();
    const statusBefore = await this.connectionService.getStatus(tenantId);

    if (!statusBefore.connected || !statusBefore.isActive) {
      return {
        success: false,
        testedAt,
        sellerId: null,
        tokenRefreshed: false,
        ordersFound: 0,
        sampleOrderId: null,
        errorMessage:
          'Nenhuma conexão ativa com o Mercado Livre para esta conta. Inicie o fluxo de autorização (GET /marketplace-intelligence/mercado-livre/authorize) antes de testar.',
      };
    }

    try {
      // getValidAccessToken já decide sozinho se precisa renovar — se
      // precisar e a renovação falhar, ela mesma emite um alerta ERROR
      // (ver mercado-livre-connection.service.ts) antes de relançar; aqui
      // só precisamos obter o resultado final e o comparativo de
      // lastRefreshedAt para relatar se uma renovação de fato aconteceu.
      const accessToken = await this.connectionService.getValidAccessToken(tenantId);
      const statusAfter = await this.connectionService.getStatus(tenantId);
      const tokenRefreshed =
        (statusAfter.lastRefreshedAt?.getTime() ?? null) !== (statusBefore.lastRefreshedAt?.getTime() ?? null);

      const sellerId = statusAfter.sellerId;
      if (!sellerId) {
        throw new Error('Conexão marcada como ativa, mas sem sellerId registrado — estado inconsistente.');
      }

      const rawOrders = await this.client.fetchOrders(sellerId, accessToken);
      const firstOrder = rawOrders[0] as { id?: unknown } | undefined;

      this.logger.log(
        `Handshake com o Mercado Livre OK para tenant ${tenantId}: ${rawOrders.length} pedido(s) encontrado(s), token renovado: ${tokenRefreshed}.`,
      );

      return {
        success: true,
        testedAt,
        sellerId,
        tokenRefreshed,
        ordersFound: rawOrders.length,
        sampleOrderId: firstOrder?.id != null ? String(firstOrder.id) : null,
        errorMessage: null,
      };
    } catch (error) {
      const message = (error as Error).message;
      // Alerta próprio para falha na ETAPA DE FETCH (orders/search) — a
      // falha de refresh em si já foi alertada dentro de
      // MercadoLivreConnectionService.getValidAccessToken(), então não
      // duplicamos aquele alerta aqui, mas qualquer falha (de refresh OU de
      // fetch) precisa aparecer no resultado deste diagnóstico de qualquer
      // forma.
      this.alerts.emitAlert({
        source: 'MercadoLivreHandshakeService',
        severity: 'ERROR',
        message: `Teste de conexão com o Mercado Livre falhou para tenant ${tenantId}`,
        context: { tenantId, error: message },
      });

      return {
        success: false,
        testedAt,
        sellerId: statusBefore.sellerId,
        tokenRefreshed: false,
        ordersFound: 0,
        sampleOrderId: null,
        errorMessage: message,
      };
    }
  }
}
