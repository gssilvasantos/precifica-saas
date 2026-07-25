import { Injectable, Logger } from '@nestjs/common';
import { RateLimiter } from '../../../../../shared/rate-limiting/rate-limiter';
import { getRateLimitConfig } from '../../../../../shared/rate-limiting/marketplace-rate-limits';
import { isRateLimitError, isTimeoutError, withRetry } from '../../../../../shared/rate-limiting/with-retry';

const BASE_URL = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB'; // Brasil

export interface MlCategory {
  id: string;
  name: string;
}

export interface MlListingPrice {
  listing_type_id: string;
  listing_type_name?: string;
  sale_fee_amount?: number;
  sale_fee_details?: {
    percentage_fee?: number;
    fixed_fee?: number;
    gross_amount?: number;
  };
  currency_id?: string;
}

// Resposta de POST /oauth/token — mesmo formato para authorization_code e
// refresh_token (RFC 6749 + extensões do Mercado Livre: user_id/refresh_token
// sempre presentes quando o app tem o escopo offline_access).
export interface MlOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // segundos até expirar — tipicamente 21600 (6h)
  scope: string;
  user_id: number; // sellerId
  refresh_token: string; // NOVO refresh_token — sempre substitui o anterior
}

// Cliente sobre a API do Mercado Livre — dois grupos de endpoint:
// (1) PÚBLICOS (categories/listing_prices), sem OAuth, documentados desde a
// Etapa 4; (2) AUTENTICADOS (oauth/token, orders/search), que exigem
// OAuth2 por vendedor (Sprint 22 — ver mercado-livre-connection.service.ts,
// que é quem de fato chama exchangeCodeForToken/refreshToken/fetchOrders
// com um token válido).
// Documentação oficial: https://developers.mercadolivre.com.br/pt_br/api-de-precos
// e https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
// Campos assumidos com base na documentação pública — não foi possível
// validar contra uma chamada ao vivo neste ambiente (rede bloqueada no
// sandbox); o RulePayloadValidator do domínio rejeita e loga qualquer
// resposta de fee-rules que não bata com o formato esperado, em vez de
// persistir algo incerto. O fluxo OAuth2 (token exchange/refresh) segue o
// padrão RFC 6749 documentado pelo ML à risca (grant_type, form-urlencoded);
// só não foi exercitado contra credenciais reais de app aqui.
@Injectable()
export class MercadoLivreApiClient {
  private readonly logger = new Logger(MercadoLivreApiClient.name);

  // Bug de produção (24/07/2026, ver marketplace-rate-limits.ts) — este
  // client fazia fetch() cru em todo método, sem nenhum throttling: a
  // primeira sincronização de uma conta com histórico de anos paginou
  // /orders/search sem pausa nenhuma e levou um HTTP 429 na página 42,
  // derrubando a sincronização inteira. Mesmo padrão de RateLimiter +
  // withRetry já usado por NuvemshopApiClient desde a Etapa 17 — nunca fica
  // "se channelCode === X" espalhado, é uma instância privada configurada
  // com o limite deste canal (ver getRateLimitConfig).
  private readonly rateLimiter = new RateLimiter(getRateLimitConfig('MERCADO_LIVRE'));

  // Bug de produção (25/07/2026) — CAUSA RAIZ real de todo backfill que
  // nunca completava, mesmo depois de corrigir o filtro de data (ver
  // README): nenhum fetch() desta classe tinha timeout. `fetch` nativo do
  // Node não tem timeout implícito — se a API do Mercado Livre (ou a rede
  // entre o Render e ela) travasse numa única chamada sem nunca responder
  // OK nem erro, a Promise correspondente ficava pendente PARA SEMPRE.
  // Como o `Promise.all` de status de envio (ver mercado-livre-order.provider.ts)
  // espera TODAS as chamadas resolverem, uma única travada travava a
  // sincronização inteira: nunca lançava exceção (então `ProviderSyncLog`
  // nunca recebia `finishedAt`/status FAILED) e nunca completava (então
  // nunca recebia SUCCESS de verdade) — o padrão exato observado em
  // produção (dezenas de tentativas, todas com `finishedAt: null` para
  // sempre, mesmo após reduzir drasticamente o volume de pedidos). Timeout
  // de 20s por requisição via AbortController: rápido o bastante pra não
  // travar sozinho por muito tempo, folgado o bastante pra não confundir
  // uma resposta lenta normal com travamento real.
  private static readonly REQUEST_TIMEOUT_MS = 20_000;

  // Wrapper único por onde TODA chamada de rede desta classe passa —
  // agenda através do RateLimiter (nunca excede a cota configurada) e
  // retenta com backoff exponencial especificamente em HTTP 429 (a API
  // pode ter um limite mais estrito que o nosso, ou outro
  // processo/tenant consumindo a mesma cota do lado do Mercado Livre) OU
  // timeout de rede (ver aviso acima — igualmente transitório, vale a
  // pena tentar de novo). Qualquer outro status (404/500/...) é devolvido
  // normalmente — cada método decide como reagir, exatamente como antes.
  private async request(url: string, init?: RequestInit): Promise<Response> {
    return withRetry(
      async () => {
        const response = await this.rateLimiter.schedule(() => this.fetchWithTimeout(url, init));
        if (response.status === 429) {
          throw new Error(`Mercado Livre retornou HTTP 429 (rate limit) para ${url}`);
        }
        return response;
      },
      { shouldRetry: (error) => isRateLimitError(error) || isTimeoutError(error) },
    );
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), MercadoLivreApiClient.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Mercado Livre não respondeu em ${MercadoLivreApiClient.REQUEST_TIMEOUT_MS}ms (timeout) para ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async fetchTopLevelCategories(): Promise<MlCategory[]> {
    const response = await this.request(`${BASE_URL}/sites/${SITE_ID}/categories`);
    if (!response.ok) {
      throw new Error(`Mercado Livre categories API retornou ${response.status}`);
    }
    const data = (await response.json()) as MlCategory[];
    return data;
  }

  async fetchListingPrices(categoryId: string, referencePrice: number): Promise<MlListingPrice[]> {
    const url = `${BASE_URL}/sites/${SITE_ID}/listing_prices?price=${referencePrice}&category_id=${categoryId}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre listing_prices API retornou ${response.status} para ${categoryId}`);
    }
    const data = (await response.json()) as MlListingPrice[] | { error?: string };
    if (!Array.isArray(data)) {
      throw new Error(`Resposta inesperada de listing_prices para ${categoryId}: ${JSON.stringify(data)}`);
    }
    return data;
  }

  // Troca do `code` de autorização por access_token/refresh_token — passo 2
  // do fluxo OAuth2 (o passo 1, montar a URL de autorização, não precisa de
  // chamada de rede e vive em MercadoLivreConnectionService). Chamado uma
  // única vez por conexão nova (`handleCallback`).
  async exchangeCodeForToken(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<MlOAuthTokenResponse> {
    return this.postOAuthToken({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
  }

  // Renovação — passo executado automaticamente por
  // MercadoLivreConnectionService.getValidAccessToken() sempre que o
  // access_token armazenado está vencido ou perto de vencer, ANTES de
  // qualquer chamada a fetchOrders(). O Mercado Livre invalida o
  // refresh_token anterior a cada uso e devolve um NOVO refresh_token na
  // resposta — por isso o chamador precisa persistir os dois campos
  // (access_token E refresh_token) a cada renovação, nunca só o primeiro.
  async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<MlOAuthTokenResponse> {
    return this.postOAuthToken({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
  }

  private async postOAuthToken(params: Record<string, string>): Promise<MlOAuthTokenResponse> {
    const response = await this.request(`${BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Mercado Livre /oauth/token retornou HTTP ${response.status}: ${body}`);
    }
    return (await response.json()) as MlOAuthTokenResponse;
  }

  // Pedidos — endpoint AUTENTICADO (`/orders/search`, exige OAuth2 de
  // vendedor, ver exchangeCodeForToken/refreshAccessToken acima), diferente
  // de categories/listing_prices (públicos). Implementado por completo
  // seguindo a documentação pública (paginação via offset/limit +
  // paging.total).
  //
  // Bug de produção (25/07/2026) — CAUSA RAIZ real do backfill que nunca
  // completava (ver README): o filtro sempre usou
  // `order.date_last_updated.from`, mas esse campo reflete QUALQUER toque no
  // pedido (reindexação/atualização interna do Mercado Livre), não só
  // pedidos criados no período. Log de diagnóstico temporário confirmou:
  // filtrando os últimos 90 dias por `date_last_updated`, a conta (com ~43
  // pedidos realmente ativos) devolveu 4674 resultados — cada pedido pago
  // ainda dispara uma consulta extra de status de envio (rate limit de 1
  // req/s, ver fetchShipmentStatus), então só o enriquecimento desses
  // milhares de "falsos positivos" levaria bem mais de uma hora, e nada é
  // persistido até o lote inteiro terminar (ver
  // OrderSyncOrchestrator.syncTenant). `dateField` agora é explícito: o
  // BACKFILL (primeira sincronização) usa `date_created` — literalmente
  // pedidos CRIADOS na janela, o volume real e esperado para um backfill.
  // O INCREMENTAL continua em `date_last_updated` de propósito: aí sim
  // queremos pegar qualquer pedido que mudou de status recentemente, mesmo
  // que criado há mais tempo — e a janela curta (7 dias, ver
  // order-sync-orchestrator.service.ts) mantém o volume seguro mesmo
  // incluindo pedidos "só tocados".
  // Chamado por MercadoLivreOrderProvider.fetchOrders() sempre com um
  // accessToken já validado/renovado por MercadoLivreConnectionService.
  async fetchOrders(
    sellerId: string,
    accessToken: string,
    since?: Date,
    dateField: 'date_created' | 'date_last_updated' = 'date_last_updated',
  ): Promise<unknown[]> {
    const orders: unknown[] = [];
    let offset = 0;
    const limit = 50;
    const sinceParam = since ? `&order.${dateField}.from=${since.toISOString()}` : '';

    while (true) {
      const url = `${BASE_URL}/orders/search?seller=${sellerId}&offset=${offset}&limit=${limit}${sinceParam}`;
      const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`Mercado Livre /orders/search retornou HTTP ${response.status} (offset ${offset})`);
      }
      const data = (await response.json()) as { results?: unknown[]; paging?: { total?: number } };
      const batch = Array.isArray(data.results) ? data.results : [];
      if (batch.length === 0) break;

      orders.push(...batch);
      offset += batch.length;
      const total = data.paging?.total ?? orders.length;
      if (offset >= total) break;
    }

    return orders;
  }

  // Status REAL de envio — bug de produção (24/07/2026): o objeto `shipping`
  // devolvido por `/orders/search` é só uma REFERÊNCIA ({id: <shipment_id>}),
  // nunca o status de fato (a suposição original de que `shipping.status`
  // viria populado ali era um aviso de honestidade não validado — o primeiro
  // sync real revelou que TODO pedido pago ficava para sempre marcado como
  // "Preparando envio", mesmo pedidos de meses atrás já entregues de
  // verdade). O status/sub-status real do envio só existe neste sub-recurso
  // dedicado. Chamado pelo MercadoLivreOrderProvider só para pedidos pagos
  // (ver comentário lá) — pedido em aberto/cancelado não precisa. Devolve
  // `null` (não lança) se o envio ainda não existir ou o payload vier em
  // formato inesperado — o chamador trata isso como "sem informação nova",
  // nunca como falha do sync inteiro.
  async fetchShipmentStatus(shipmentId: string, accessToken: string): Promise<{ status: string; substatus: string | null } | null> {
    try {
      const response = await this.request(`${BASE_URL}/shipments/${shipmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { status?: string; substatus?: string };
      if (!data.status) return null;
      return { status: data.status, substatus: data.substatus ?? null };
    } catch (error) {
      this.logger.warn(`Falha ao consultar /shipments/${shipmentId}: ${(error as Error).message}`);
      return null;
    }
  }

  // --- Product Ads (Módulo de Ads, Fase 1) ---
  //
  // AVISO DE HONESTIDADE (mais forte que o de fee-rules acima, de propósito):
  // os endpoints abaixo foram montados a partir de fontes SECUNDÁRIAS
  // públicas (resumo de terceiros + páginas de documentação do Mercado
  // Livre) — a documentação oficial em
  // developers.mercadolivre.com.br/product-ads-us-read é renderizada via
  // JS e não pôde ser lida por completo a partir deste sandbox de
  // desenvolvimento (sem navegador real). O formato de payload/paginação
  // segue o MESMO padrão já confirmado nos endpoints públicos acima
  // (results[]/paging{offset,limit,total}), mas os PATHS exatos, o header
  // `Api-Version` e o shape exato da resposta de métricas NÃO foram
  // validados contra uma chamada real — isso só será possível depois que o
  // escopo `advertising/product_ads` for aprovado no app do Mercado Livre
  // (ver docs/marketplace-ads-api-access-plan.md) e testado a partir de uma
  // máquina com rede real (mesma limitação já documentada para o R2 — ver
  // docs/deploy-render-supabase-r2.md, seção 3.5). Até lá, qualquer resposta
  // com formato inesperado deve estourar erro explícito aqui, nunca ser
  // adaptada "na marra" para não mascarar um path errado.

  // advertiser_id é um identificador PRÓPRIO de Ads, diferente do sellerId
  // usado em /orders/search — resolvido uma vez e reaproveitado nas demais
  // chamadas.
  async fetchAdvertiserId(accessToken: string): Promise<string | null> {
    const url = `${BASE_URL}/advertising/advertisers?product_id=PADS&site_id=${SITE_ID}`;
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': '2' },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre /advertising/advertisers retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as { advertisers?: { advertiser_id?: number | string }[] };
    const first = data.advertisers?.[0];
    return first?.advertiser_id != null ? String(first.advertiser_id) : null;
  }

  async fetchAdsCampaigns(advertiserId: string, accessToken: string): Promise<unknown[]> {
    const campaigns: unknown[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const url = `${BASE_URL}/marketplace/advertising/${SITE_ID}/advertisers/${advertiserId}/product_ads/campaigns/search?offset=${offset}&limit=${limit}`;
      const response = await this.request(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': '2' },
      });
      if (!response.ok) {
        throw new Error(`Mercado Livre /product_ads/campaigns/search retornou HTTP ${response.status} (offset ${offset})`);
      }
      const data = (await response.json()) as { results?: unknown[]; paging?: { total?: number } };
      const batch = Array.isArray(data.results) ? data.results : [];
      if (batch.length === 0) break;

      campaigns.push(...batch);
      offset += batch.length;
      const total = data.paging?.total ?? campaigns.length;
      if (offset >= total) break;
    }

    return campaigns;
  }

  // Métricas por campanha, agregadas por dia — a API do Mercado Livre limita
  // a janela de consulta a 90 dias (documentado publicamente); o CALLER
  // (MercadoLivreAdsProvider) é quem valida isso antes de chamar, este
  // método só repassa a janela recebida.
  async fetchAdsCampaignMetrics(advertiserId: string, accessToken: string, dateFrom: Date, dateTo: Date): Promise<unknown[]> {
    const from = dateFrom.toISOString().slice(0, 10);
    const to = dateTo.toISOString().slice(0, 10);
    const url = `${BASE_URL}/marketplace/advertising/${SITE_ID}/advertisers/${advertiserId}/product_ads/campaigns/metrics?date_from=${from}&date_to=${to}&metrics_summary=false&aggregation_type=daily`;
    const response = await this.request(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': '2' },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre /product_ads/campaigns/metrics retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as { results?: unknown[] };
    return Array.isArray(data.results) ? data.results : [];
  }

  // --- Ação de escrita (Módulo de Ads, Fase 3 — Safety Lock) ---
  //
  // MESMO aviso de honestidade acima, reforçado: este é o primeiro endpoint
  // de ESCRITA do módulo de Ads, nunca exercitado contra a API real. O path
  // e o body seguem a convenção REST já usada pelos endpoints de leitura
  // acima (mesmo recurso /campaigns/{id}, verbo PUT com body parcial —
  // padrão comum de APIs do Mercado Livre, ex. PUT /items/{id} para
  // atualizar um anúncio), mas PRECISA ser validado contra uma chamada real
  // assim que o escopo advertising/product_ads estiver aprovado, ANTES de
  // liberar a Fase 3 para uso em produção. Só é chamado depois que o
  // usuário confirma explicitamente a ação (AdsActionDispatcherService) —
  // nunca automaticamente.
  async pauseCampaign(advertiserId: string, accessToken: string, externalCampaignId: string): Promise<void> {
    const url = `${BASE_URL}/marketplace/advertising/${SITE_ID}/advertisers/${advertiserId}/product_ads/campaigns/${externalCampaignId}`;
    const response = await this.request(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': '2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Mercado Livre PUT /product_ads/campaigns/${externalCampaignId} retornou HTTP ${response.status}: ${body}`);
    }
  }
}
