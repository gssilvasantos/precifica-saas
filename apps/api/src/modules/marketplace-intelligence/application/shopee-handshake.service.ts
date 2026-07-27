import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ShopeeConnectionService } from './shopee-connection.service';
import { ShopeeApiClient } from '../infrastructure/providers/shopee/shopee-api-client';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';

export interface ShopeeHandshakeResult {
  success: boolean;
  testedAt: Date;
  shopId: string | null;
  // Mesmo racional de MercadoLivreHandshakeResult.tokenRefreshed — prova que
  // o caminho de renovação automática funciona de ponta a ponta, não só que
  // um token já válido foi lido.
  tokenRefreshed: boolean;
  shopName: string | null;
  shopStatus: string | null;
  errorMessage: string | null;
}

// Diagnóstico de handshake real contra a API da Shopee — mesmo racional
// arquitetural de MercadoLivreHandshakeService: leitura pura (nunca escreve
// pedido/produto nenhum), só exercita a cadeia
// status -> getValidAccessToken (renovação automática incluída) ->
// fetchShopInfo, para o lojista confirmar que a conexão funciona de ponta a
// ponta ANTES de qualquer integração de pedidos existir.
//
// Por que /shop/get_shop_info e não /orders/search (como o Mercado Livre):
// não existe NENHUM endpoint de pedidos da Shopee implementado ainda (só a
// camada de conexão, ver README) — get_shop_info é o endpoint autenticado
// mais leve disponível para provar que o access_token/shop_id funcionam.
//
// AVISO DE HONESTIDADE: mesmo aviso de ShopeeApiClient — a cadeia inteira
// nunca foi exercitada contra uma chamada real (app "Developing",
// credenciais de teste). Este serviço é exatamente a ferramenta para o
// usuário validar isso pela primeira vez.
@Injectable()
export class ShopeeHandshakeService {
  private readonly logger = new Logger(ShopeeHandshakeService.name);

  constructor(
    private readonly connectionService: ShopeeConnectionService,
    private readonly client: ShopeeApiClient,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  async testConnection(tenantId: string): Promise<ShopeeHandshakeResult> {
    const testedAt = new Date();
    const statusBefore = await this.connectionService.getStatus(tenantId);

    if (!statusBefore.connected || !statusBefore.isActive) {
      return {
        success: false,
        testedAt,
        shopId: null,
        tokenRefreshed: false,
        shopName: null,
        shopStatus: null,
        errorMessage: 'Nenhuma conexão ativa com a Shopee para esta conta. Inicie o fluxo de autorização (GET /marketplace-intelligence/shopee/authorize) antes de testar.',
      };
    }

    try {
      // getValidAccessToken já decide sozinho se precisa renovar — se
      // precisar e a renovação falhar, ela mesma emite um alerta ERROR (ver
      // shopee-connection.service.ts) antes de relançar; aqui só precisamos
      // do resultado final e do comparativo de lastRefreshedAt.
      const accessToken = await this.connectionService.getValidAccessToken(tenantId);
      const statusAfter = await this.connectionService.getStatus(tenantId);
      const tokenRefreshed =
        (statusAfter.lastRefreshedAt?.getTime() ?? null) !== (statusBefore.lastRefreshedAt?.getTime() ?? null);

      const shopId = statusAfter.shopId;
      if (!shopId) {
        throw new Error('Conexão marcada como ativa, mas sem shopId registrado — estado inconsistente.');
      }

      const shopInfo = await this.client.fetchShopInfo(this.requireEnv('SHOPEE_PARTNER_ID'), this.requireEnv('SHOPEE_PARTNER_KEY'), shopId, accessToken);

      this.logger.log(`Handshake com a Shopee OK para tenant ${tenantId}: loja "${shopInfo.shop_name ?? shopId}", token renovado: ${tokenRefreshed}.`);

      return {
        success: true,
        testedAt,
        shopId,
        tokenRefreshed,
        shopName: shopInfo.shop_name ?? null,
        shopStatus: shopInfo.status ?? null,
        errorMessage: null,
      };
    } catch (error) {
      const message = (error as Error).message;
      // Alerta próprio para falha na ETAPA DE FETCH (get_shop_info) — a
      // falha de refresh em si já foi alertada dentro de
      // ShopeeConnectionService.getValidAccessToken, então não duplicamos
      // aquele alerta aqui.
      this.alerts.emitAlert({
        source: 'ShopeeHandshakeService',
        severity: 'ERROR',
        message: `Teste de conexão com a Shopee falhou para tenant ${tenantId}`,
        context: { tenantId, error: message },
      });

      return {
        success: false,
        testedAt,
        shopId: statusBefore.shopId,
        tokenRefreshed: false,
        shopName: null,
        shopStatus: null,
        errorMessage: message,
      };
    }
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new InternalServerErrorException(`Variável de ambiente ${name} não configurada — a integração da Shopee não pode funcionar sem ela.`);
    }
    return value;
  }
}
