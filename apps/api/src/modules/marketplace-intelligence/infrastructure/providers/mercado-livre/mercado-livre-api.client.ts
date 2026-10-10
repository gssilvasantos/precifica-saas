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

// Fase 4 (Publicar anúncio novo em marketplace, benchmark Tiny ERP) — três
// novos endpoints, todos abaixo do MESMO aviso de honestidade das outras
// seções deste client (Ads/pauseCampaign): shape montado a partir da
// documentação pública, nunca exercitado contra uma chamada real neste
// sandbox.
export interface MlDomainDiscoveryResult {
  domain_id?: string;
  domain_name?: string;
  category_id: string;
  category_name: string;
}

export interface MlCategoryAttribute {
  id: string;
  name: string;
  tags?: {
    required?: boolean;
    // outras tags existem (catalog_required, hidden, variation_attribute...)
    // — só `required` importa para o gate canPublish hoje.
    [key: string]: unknown;
  };
}

export interface MlCreateItemPayload {
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: 'buy_it_now';
  condition: 'new';
  listing_type_id: string;
  pictures: { source: string }[];
  attributes: { id: string; value_name: string }[];
}

export interface MlCatalogProductHit {
  id: string;
  name: string | null;
  domainId: string | null;
  status: string | null;
}

export interface MlCreateItemResult {
  id?: string;
  status?: string;
  message?: string;
  error?: string;
  cause?: unknown[];
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

// Catálogo / Buy Box — campos usados pelo radar de concorrência
// (01/08/2026). Só o subconjunto que o radar realmente lê: a resposta real
// do ML tem dezenas de campos, e declarar todos criaria acoplamento a
// dados que não usamos.
export interface MlCatalogItem {
  item_id: string;
  seller_id?: number;
  price?: number;
  // Vem em algumas respostas; quando ausente, o radar cai para comparar o
  // item_id com o buy_box_winner do produto.
  winner?: boolean;
  shipping?: { free_shipping?: boolean };
}

export interface MlCatalogProduct {
  id: string;
  name?: string;
  buy_box_winner?: { item_id?: string; seller_id?: number; price?: number } | null;
}

export interface MlItem {
  id: string;
  price?: number;
  // null quando o anúncio não pertence a nenhum produto de catálogo — nesse
  // caso não existe Buy Box para disputar, e o radar informa isso em vez de
  // devolver lista vazia sem explicação.
  catalog_product_id?: string | null;
}

// Vínculo SKU <-> anúncio (18/09/2026, sincronização de ChannelListing do
// Mercado Livre — ver mercado-livre-channel-listing-sync.service.ts). Só o
// subconjunto que o sync realmente usa, mesmo racional de MlCatalogItem
// acima: a resposta real de GET /items tem dezenas de campos, declarar todos
// criaria acoplamento a dado que não consumimos.
export interface MlSellerItem {
  id: string;
  price: number | null;
  permalink: string | null;
  // Resolvido a partir de seller_custom_field (campo legado, ainda o mais
  // comum em contas antigas) OU do atributo SELLER_SKU (formato atual) —
  // ver resolveSellerSku. null quando o vendedor nunca cadastrou um SKU
  // para aquele anúncio no Mercado Livre; nesse caso não há como vincular
  // ao Product do Kyneti por SKU, e o sync descarta o item (loga, não falha
  // o lote inteiro).
  skuCode: string | null;
  // Diagnóstico (24/09/2026, ver comentário em
  // MercadoLivreChannelListingSyncService sobre os anúncios "sem SKU
  // vinculado"): só usado para o LOG desse caso — dá pra alguém humano
  // (comparando com o catálogo do Kyneti/Olist) descobrir a que produto um
  // anúncio sem SKU corresponde, sem precisar abrir o Mercado Livre anúncio
  // por anúncio. Nunca usado pra decidir vínculo automático — só texto pro
  // log.
  title: string | null;
}

interface MlRawItemBody {
  id: string;
  price?: number | null;
  permalink?: string | null;
  title?: string | null;
  status?: string | null;
  category_id?: string | null;
  seller_custom_field?: string | null;
  attributes?: { id: string; value_name?: string | null }[];
  // catalog_listing = true quando ESTE anúncio específico é (ou disputa) a
  // ficha de catálogo do Mercado Livre; catalog_product_id identifica essa
  // ficha (já usado por MlItem/fetchItem, para o radar de Buy Box — ver
  // mais abaixo). Trazidos aqui também (24/09/2026, dúvida real do Gui:
  // "como o Mercado Turbo sabe quais são catálogo e quais são clássicos") —
  // é o MESMO dado público que qualquer ferramenta de terceiro (Mercado
  // Turbo incluso) lê da API do Mercado Livre, não uma informação que só
  // ferramentas de terceiro conseguem enxergar.
  catalog_listing?: boolean | null;
  catalog_product_id?: string | null;
}

export interface MlItemAttribute {
  id: string;
  value_name: string | null;
}

// Detalhe completo de um anúncio — usado pelo endpoint de administração
// (MercadoLivreItemAdminController, 24/09/2026) exposto ao kyneti-mcp-server
// (Gui pediu MCP com leitura E escrita de Mercado Livre disponível a
// qualquer sessão). Superset de MlSellerItem de propósito: quem consome
// isto é um HUMANO (via MCP) decidindo o SKU certo pra um anúncio órfão —
// precisa ver os `attributes` crus, coisa que o sync automático
// (MlSellerItem) nunca precisou expor. Nunca usado pelo sync automático.
export interface MlItemDetail {
  id: string;
  title: string | null;
  price: number | null;
  permalink: string | null;
  status: string | null;
  categoryId: string | null;
  // Mesma resolução de resolveSellerSku (seller_custom_field OU atributo
  // SELLER_SKU) — nunca duas fontes de verdade pro que "é" o SKU de um
  // anúncio neste client.
  skuCode: string | null;
  // true = este anúncio participa (ou é dono) de uma ficha de catálogo do
  // Mercado Livre; false/null = anúncio "clássico" (sem ficha de catálogo
  // por trás). Mesmo campo que qualquer app de terceiro (ex.: Mercado
  // Turbo) lê da API pública do Mercado Livre para mostrar a etiqueta
  // "Catálogo" — não é um dado que só eles conseguem enxergar.
  isCatalogListing: boolean;
  catalogProductId: string | null;
  attributes: MlItemAttribute[];
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

// --- Tipos do planejador Buy Box + Campanhas (07/10/2026) ---
export interface MlItemPricingContext extends MlItemDetail {
  sellerId: string | null;
  originalPrice: number | null;
  availableQuantity: number;
  listingTypeId: string | null;
  // Variações do anúncio (vazio = anúncio sem variação). Cada variação tem
  // SKU e GTIN próprios — é por elas que se cria anúncio de catálogo.
  variations: MlItemVariation[];
}

export interface MlItemVariation {
  id: string;
  skuCode: string | null;
  attributes: MlItemAttribute[];
  // Ex.: "Cor: Rosa" — só para o humano identificar a variação.
  label: string | null;
  availableQuantity: number;
}

export interface MlCatalogListingSummary {
  id: string;
  title: string | null;
  price: number | null;
  status: string | null;
  availableQuantity: number;
  isCatalogListing: boolean;
  catalogProductId: string | null;
  skuCode: string | null;
}

export interface MlPriceToWin {
  status: string | null; // winning | sharing_first_place | competing | listed
  priceToWin: number | null;
  currentPrice: number | null;
  catalogProductId: string | null;
  reasons: string[];
  winnerItemId: string | null;
  winnerPrice: number | null;
}

export interface MlItemPromotion {
  id: string;
  type: string; // SELLER_CAMPAIGN | DEAL | SMART | ...
  subType: string | null;
  status: string; // candidate | started | pending | finished
  name: string | null;
  price: number | null;
  originalPrice: number | null;
  minDiscountedPrice: number | null;
  maxDiscountedPrice: number | null;
  suggestedDiscountedPrice: number | null;
  startDate: string | null;
  finishDate: string | null;
}

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
  // retryOnTimeout=false: para POST não idempotente (ex.: inscrição em campanha) um
  // timeout NÃO prova que o ML não processou — reenviar poderia duplicar o efeito.
  // Rate limit (429) continua retentando: o ML rejeitou antes de processar.
  private async request(url: string, init?: RequestInit, opts: { retryOnTimeout?: boolean } = {}): Promise<Response> {
    const retryOnTimeout = opts.retryOnTimeout ?? true;
    return withRetry(
      async () => {
        const response = await this.rateLimiter.schedule(() => this.fetchWithTimeout(url, init));
        if (response.status === 429) {
          throw new Error(`Mercado Livre retornou HTTP 429 (rate limit) para ${url}`);
        }
        return response;
      },
      { shouldRetry: (error) => isRateLimitError(error) || (retryOnTimeout && isTimeoutError(error)) },
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

  // --- Catálogo / Buy Box (01/08/2026, radar de concorrência real) ---
  //
  // Endpoints PÚBLICOS, sem OAuth — é o que torna o radar de concorrência
  // implementável hoje, sem depender do fluxo de autorização por vendedor.
  // Documentação: https://developers.mercadolivre.com.br/pt_br/catalogo-competicao
  //
  // `/products/{id}` traz `buy_box_winner` (quem está ganhando a página do
  // produto); `/products/{id}/items` traz TODAS as ofertas que competem por
  // aquele produto — é a fonte do preço de concorrente que o
  // PricingStrategist precisa e que, até agora, só existia se alguém
  // preenchesse uma planilha à mão.

  async fetchCatalogProduct(productId: string, accessToken?: string): Promise<MlCatalogProduct> {
    const response = await this.request(
      `${BASE_URL}/products/${productId}`,
      accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    );
    if (!response.ok) {
      throw new Error(`Mercado Livre products API retornou ${response.status} para ${productId}`);
    }
    return (await response.json()) as MlCatalogProduct;
  }

  async fetchCatalogProductItems(productId: string, accessToken?: string): Promise<MlCatalogItem[]> {
    const response = await this.request(
      `${BASE_URL}/products/${productId}/items`,
      accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    );
    if (!response.ok) {
      throw new Error(`Mercado Livre products/items API retornou ${response.status} para ${productId}`);
    }
    const data = (await response.json()) as { results?: MlCatalogItem[] };
    return data.results ?? [];
  }

  // Usado quando o alvo monitorado é um ANÚNCIO (MLB de item) em vez de um
  // produto de catálogo: aqui se descobre a qual produto ele pertence para
  // então listar os concorrentes.
  //
  // Bug de produção (19/09/2026): estes três endpoints são documentados pelo
  // Mercado Livre como públicos, mas passaram a responder 403 para chamada
  // anônima (sem Authorization) — confirmado em produção, 100% dos SKUs de
  // um tenant real falhando com "items API retornou 403". accessToken é
  // opcional (mantém a chamada sem token como fallback), mas
  // mercado-livre-catalog-radar.ts agora sempre passa o token do vendedor
  // já conectado — não precisa ser o dono do anúncio específico, só um
  // token válido do Mercado Livre.
  async fetchItem(itemId: string, accessToken?: string): Promise<MlItem> {
    const response = await this.request(
      `${BASE_URL}/items/${itemId}`,
      accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    );
    if (!response.ok) {
      throw new Error(`Mercado Livre items API retornou ${response.status} para ${itemId}`);
    }
    return (await response.json()) as MlItem;
  }

  // --- Vínculo SKU <-> anúncio (18/09/2026, ChannelListing) ---
  //
  // Endpoint AUTENTICADO (o vendedor consulta os PRÓPRIOS anúncios, ativos e
  // pausados) — diferente do radar de catálogo acima, que é público.
  // Documentação: https://developers.mercadolivre.com.br/pt_br/gerenciando-anuncios
  //
  // AVISO DE HONESTIDADE: paginação por offset/limit, mesmo padrão de
  // fetchOrders/fetchAdsCampaigns — mas o Mercado Livre documenta um teto de
  // 1000 resultados nesse modo (offset+limit); acima disso seria necessário
  // `search_type=scan` (scroll_id), não implementado aqui por falta de
  // necessidade comprovada até agora (nenhuma conta do projeto chega perto
  // disso). Uma conta com mais de 1000 anúncios ativos teria a sincronização
  // truncada silenciosamente nesse ponto — risco aceito e documentado, não
  // uma omissão.
  async fetchSellerItemIds(sellerId: string, accessToken: string): Promise<string[]> {
    const ids: string[] = [];
    let offset = 0;
    const limit = 50;
    const HARD_CAP = 1000;

    while (true) {
      const url = `${BASE_URL}/users/${sellerId}/items/search?offset=${offset}&limit=${limit}`;
      const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`Mercado Livre /users/${sellerId}/items/search retornou HTTP ${response.status} (offset ${offset})`);
      }
      const data = (await response.json()) as { results?: string[]; paging?: { total?: number } };
      const batch = Array.isArray(data.results) ? data.results : [];
      if (batch.length === 0) break;

      ids.push(...batch);
      offset += batch.length;
      const total = data.paging?.total ?? ids.length;
      if (offset >= total || offset >= HARD_CAP) break;
    }

    return ids;
  }

  // Bug de produção (19/09/2026, tenant real): fetchSellerItemIds(sellerId)
  // acima devolveu 0 anúncios por SEMANAS para um tenant com conexão ativa
  // e pedidos reais sincronizando normalmente (2000+ pedidos, todos com o
  // MESMO seller.id embutido no payload — ver mercado-livre-order.provider.ts).
  // Causa raiz: `sellerId` persistido em MercadoLivreConnectionService vem
  // de `token.user_id` (resposta do OAuth2) — mas esse nem sempre é o ID
  // que de fato "possui" os anúncios no Mercado Livre (ex.: token de uma
  // conta operadora/colaboradora distinta da conta vendedora). `/orders/search`
  // continua funcionando com o `sellerId` do token porque é escopado pelo
  // TOKEN, não pelo parâmetro `seller` da querystring — mas
  // `/users/{sellerId}/items/search` é estritamente por ID no path, e
  // devolve lista vazia (200 OK, nunca erro) se o ID não for o dono real.
  //
  // Este método busca 1 pedido recente (mesmo endpoint /orders/search já
  // comprovado funcional para este tenant, mesmo token) só para LER o
  // `seller.id` de verdade embutido no payload — nunca escreve nada, nunca
  // aplica preço, é uma sonda read-only usada como fallback em
  // MercadoLivreChannelListingSyncService quando fetchSellerItemIds(sellerId)
  // devolve 0 resultados. Devolve null se não houver nenhum pedido ainda
  // (tenant novo) ou se o payload vier em formato inesperado — nunca lança,
  // o chamador trata null como "sem alternativa, mantém 0 candidatos".
  //
  // Bug de produção (20/09/2026, achado com o log de diagnóstico acima): a
  // primeira versão desta sonda chamava `/orders/search?seller=X&offset=0&limit=1`
  // SEM nenhum filtro de data — e devolveu 200 OK com paging.total=0, mesmo
  // para um tenant com pedido real criado minutos antes (confirmado direto
  // no banco). Ou seja, a suposição do comentário acima ("endpoint já
  // comprovado funcional... escopado pelo token") só vale quando a chamada
  // inclui um filtro de data — é exatamente assim que
  // MercadoLivreApiClient.fetchOrders() sempre chama esse mesmo endpoint (ver
  // abaixo), nunca sem `order.<campo>.from`. Sem esse filtro, o Mercado Livre
  // aparentemente aplica uma janela padrão que pode vir vazia. Fix: usa o
  // MESMO padrão comprovado — `order.date_created.from` com uma data bem
  // antiga (cobre qualquer histórico, incluindo reconexões), igual ao
  // backfill em MercadoLivreOrderProvider.fetchOrders.
  async fetchOrderSellerIdSample(sellerId: string, accessToken: string): Promise<string | null> {
    const sinceFloor = '2015-01-01T00:00:00.000-00:00'; // bem antes de qualquer conta real neste sistema
    const url = `${BASE_URL}/orders/search?seller=${sellerId}&offset=0&limit=1&order.date_created.from=${sinceFloor}`;
    const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      // Bug de produção (20/09/2026): primeira execução real deste fallback
      // devolveu 0 candidatos sem nenhum log de aviso — porque um `!response.ok`
      // aqui simplesmente devolvia null, em silêncio total. Isso deixou
      // literalmente impossível saber, pelos logs, se a sonda falhou por HTTP
      // (ex.: 4xx específico deste endpoint sem `since`/`status`, diferente do
      // fetchOrders() normal) ou por payload vazio (abaixo). Loga o status
      // real — nunca lança, o comportamento pro chamador continua o mesmo
      // (null = "sem alternativa, mantém 0 candidatos").
      this.logger.warn(`fetchOrderSellerIdSample: ${url} retornou HTTP ${response.status} — sem sellerId alternativo disponível.`);
      return null;
    }

    const data = (await response.json()) as { results?: Array<{ seller?: { id?: number | string } }> };
    const first = Array.isArray(data.results) ? data.results[0] : undefined;
    const realSellerId = first?.seller?.id;
    if (realSellerId == null) {
      // Mesmo racional do log acima: 200 OK mas sem seller.id no primeiro
      // resultado (lista vazia, ou item com formato inesperado) — sem isto,
      // esse caminho também falhava em silêncio total.
      this.logger.warn(
        `fetchOrderSellerIdSample: ${url} devolveu 200 OK mas sem seller.id utilizável (paging.total=${(data as { paging?: { total?: number } }).paging?.total ?? 'desconhecido'}, resultados=${data.results?.length ?? 0}).`,
      );
      // Bug de produção (21/09/2026): mesmo com o filtro de data (fix
      // anterior), a sonda continuou devolvendo paging.total=0 — ou seja,
      // esse `sellerId` NUNCA teve nenhum pedido, em nenhuma data. Isso é
      // inconsistente com a suposição original de "conta operadora/colaboradora
      // que só não possui os anúncios": uma conta operadora ainda deveria
      // aparecer como seller.id de pedidos que ela processou. A hipótese
      // agora é mais básica — a conexão OAuth2 pode simplesmente estar
      // autenticada com a conta ERRADA do Mercado Livre (login secundário/de
      // teste, nunca usado pra vender). `/users/me` é só leitura, nunca
      // aplica nada — usado aqui só pra logar a identidade real por trás do
      // token (id/nickname/user_type), pra confirmar ou descartar essa
      // hipótese sem adivinhar. Nunca lança: falha aqui não muda o retorno
      // desta função.
      await this.logAuthenticatedUserIdentity(accessToken);
    }
    return realSellerId != null ? String(realSellerId) : null;
  }

  private async logAuthenticatedUserIdentity(accessToken: string): Promise<void> {
    try {
      const response = await this.request(`${BASE_URL}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        this.logger.warn(`logAuthenticatedUserIdentity: /users/me retornou HTTP ${response.status}.`);
        return;
      }
      const data = (await response.json()) as {
        id?: number | string;
        nickname?: string;
        user_type?: string;
        site_status?: string;
        seller_reputation?: { level_id?: string | null; transactions?: { total?: number } };
      };
      this.logger.warn(
        `logAuthenticatedUserIdentity: token pertence a id=${data.id} nickname=${data.nickname} user_type=${data.user_type} site_status=${data.site_status} transacoes_como_vendedor=${data.seller_reputation?.transactions?.total ?? 'desconhecido'}.`,
      );
    } catch (error) {
      this.logger.warn(`logAuthenticatedUserIdentity: falhou (${(error as Error).message}).`);
    }
  }

  // Multiget (GET /items?ids=...) em vez de um GET /items/{id} por anúncio —
  // com dezenas/centenas de anúncios, item a item seriam N round-trips só
  // para montar ChannelListing; mesma estratégia de lote já usada em
  // fetchAdsItemMetrics. Lote de 20: limite documentado do endpoint.
  // Item com `code !== 200` (removido, denunciado, etc.) é descartado sem
  // derrubar o lote inteiro — mesma filosofia de "resultado parcial honesto"
  // do resto deste client.
  async fetchItemsDetails(itemIds: string[], accessToken: string): Promise<MlSellerItem[]> {
    const BATCH_SIZE = 20;
    const results: MlSellerItem[] = [];

    for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
      const batchIds = itemIds.slice(i, i + BATCH_SIZE);
      const url = `${BASE_URL}/items?ids=${batchIds.join(',')}`;
      const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`Mercado Livre /items (multiget) retornou HTTP ${response.status} para o lote iniciando em ${batchIds[0]}`);
      }
      const data = (await response.json()) as { code: number; body?: MlRawItemBody }[];
      for (const entry of data) {
        if (entry.code !== 200 || !entry.body) continue;
        results.push({
          id: entry.body.id,
          price: typeof entry.body.price === 'number' ? entry.body.price : null,
          permalink: entry.body.permalink ?? null,
          skuCode: this.resolveSellerSku(entry.body),
          title: entry.body.title ?? null,
        });
      }
    }

    return results;
  }

  // seller_custom_field é o campo legado (ainda o mais usado em contas
  // antigas); SELLER_SKU é o atributo atual. Tenta os dois, nessa ordem —
  // nunca inventa um SKU quando nenhum dos dois está preenchido.
  private resolveSellerSku(item: MlRawItemBody): string | null {
    if (item.seller_custom_field) return item.seller_custom_field;
    const attribute = item.attributes?.find((a) => a.id === 'SELLER_SKU');
    return attribute?.value_name ?? null;
  }

  private toItemDetail(data: MlRawItemBody): MlItemDetail {
    return {
      id: data.id,
      title: data.title ?? null,
      price: typeof data.price === 'number' ? data.price : null,
      permalink: data.permalink ?? null,
      status: data.status ?? null,
      categoryId: data.category_id ?? null,
      skuCode: this.resolveSellerSku(data),
      isCatalogListing: Boolean(data.catalog_listing) || Boolean(data.catalog_product_id),
      catalogProductId: data.catalog_product_id ?? null,
      attributes: (data.attributes ?? []).map((a) => ({ id: a.id, value_name: a.value_name ?? null })),
    };
  }

  // --- Administração de anúncio — leitura completa (24/09/2026) ---
  //
  // Base de DOIS usos: (1) kyneti-mcp-server consultar um anúncio específico
  // sem precisar decifrar o payload cru do Mercado Livre — Gui pediu MCP
  // disponível a qualquer sessão futura, leitura E escrita (ver
  // updateItemSellerSku abaixo); (2) confirmar o formato real de
  // `attributes` de um item que JÁ tem SELLER_SKU preenchido antes de
  // confiar no payload de escrita — em vez de assumir contra documentação
  // pública que este ambiente nem sempre consegue acessar ao vivo.
  async fetchItemDetail(itemId: string, accessToken: string): Promise<MlItemDetail> {
    const response = await this.request(`${BASE_URL}/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre GET /items/${itemId} retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as MlRawItemBody;
    return this.toItemDetail(data);
  }

  // --- Administração de anúncio — escrita do SKU do vendedor (24/09/2026) ---
  //
  // ESCRITA REAL em produção da loja do vendedor — segundo endpoint de
  // escrita de LISTAGEM deste client (o primeiro é createItem, nunca
  // exercitado contra a API real). O formato do payload
  // { attributes: [{ id: 'SELLER_SKU', value_name }] } segue o MESMO shape
  // já usado por MlCreateItemPayload.attributes (id/value_name) — o formato
  // de atributo do Mercado Livre em toda a API de itens, não algo inventado
  // para este endpoint. Defesa em profundidade além da guarda HTTP do
  // controller (ver mercado-livre-item-admin.controller.ts): o próprio
  // Mercado Livre recusa (403) editar um item que não pertence ao vendedor
  // dono do access_token, então um itemId errado nunca escreve na loja de
  // outra pessoa.
  async updateItemSellerSku(itemId: string, accessToken: string, skuCode: string): Promise<MlItemDetail> {
    const response = await this.request(`${BASE_URL}/items/${itemId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: [{ id: 'SELLER_SKU', value_name: skuCode }] }),
    });
    const data = (await response.json().catch(() => ({}))) as MlRawItemBody & {
      message?: string;
      error?: string;
      cause?: unknown[];
    };
    if (!response.ok) {
      const detail = data.message ?? data.error ?? JSON.stringify(data.cause ?? {});
      throw new Error(`Mercado Livre PUT /items/${itemId} (SELLER_SKU) retornou HTTP ${response.status}: ${detail}`);
    }
    return this.toItemDetail(data);
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

  // --- Expedição em lote (Fase 5, benchmark Tiny ERP, 29/07/2026) ---
  //
  // Resolve o shipment_id vinculado ao pedido (GET /orders/:id, mesmo objeto
  // `shipping` de referência já usado em fetchOrders — ver aviso acima sobre
  // este objeto NUNCA trazer o status/dado completo, só o id) e, com ele, o
  // tracking_number real via GET /shipments/:id. Nunca lança — mesmo padrão
  // de fetchShipmentStatus: "sem informação" é um retorno válido, não uma
  // falha.
  async fetchOrderShippingInfo(externalOrderId: string, accessToken: string): Promise<{ shipmentId: string | null; trackingNumber: string | null }> {
    try {
      const orderResponse = await this.request(`${BASE_URL}/orders/${externalOrderId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!orderResponse.ok) return { shipmentId: null, trackingNumber: null };
      const orderData = (await orderResponse.json()) as { shipping?: { id?: number | string } };
      const shipmentId = orderData.shipping?.id != null ? String(orderData.shipping.id) : null;
      if (!shipmentId) return { shipmentId: null, trackingNumber: null };

      const shipmentResponse = await this.request(`${BASE_URL}/shipments/${shipmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!shipmentResponse.ok) return { shipmentId, trackingNumber: null };
      const shipmentData = (await shipmentResponse.json()) as { tracking_number?: string };
      return { shipmentId, trackingNumber: shipmentData.tracking_number ?? null };
    } catch (error) {
      this.logger.warn(`Falha ao resolver envio do pedido ML ${externalOrderId}: ${(error as Error).message}`);
      return { shipmentId: null, trackingNumber: null };
    }
  }

  // Puro (sem chamada de rede) — monta a URL do documento de etiqueta
  // (Mercado Envios). AVISO DE HONESTIDADE: esta URL exige o MESMO
  // `Authorization: Bearer <token>` do vendedor para ser aberta — não é um
  // link público direto, diferente do que labelUrl sugere à primeira vista.
  // Servir isso de verdade para o usuário final exige um proxy autenticado
  // (gap conhecido, ver docs/dispatch-batch-architecture.md) — por ora o
  // Kyneti só guarda/expõe a URL, quem abre precisa estar com uma sessão
  // válida do Mercado Livre por trás.
  buildShippingLabelUrl(shipmentId: string): string {
    return `${BASE_URL}/shipment_labels?shipment_ids=${shipmentId}&response_type=pdf`;
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

  // Métricas por ANÚNCIO (01/08/2026) — confirmado na documentação oficial
  // que a API entrega `cost` no nível do item, não só por campanha:
  // https://developers.mercadolivre.com.br/pt_br/product-ads-leitura
  //
  // Usa o endpoint de busca PAGINADO (`/product_ads/ads/search`) em vez de
  // consultar `/product_ads/ads/{ITEM_ID}` um a um: com dezenas de anúncios
  // ativos, item a item seriam dezenas de round-trips por sync. Mesma
  // estratégia de paginação de fetchAdsCampaigns acima.
  //
  // `aggregation_type=daily` para o snapshot casar com a granularidade de
  // AdsItemMetricSnapshot.periodDate — o DRE precisa somar por janela
  // arbitrária, e só o diário permite isso sem reconsultar a API.
  //
  // Mesma honestidade do resto deste arquivo: o path segue a convenção que
  // já funciona para campanhas neste projeto (`/marketplace/advertising/...`);
  // a documentação pública mostra variações com e sem o prefixo
  // `/marketplace`. Se a primeira chamada real retornar 404, é aqui que se
  // ajusta — o normalizador do provider rejeita resposta fora do formato
  // esperado em vez de gravar lixo.
  async fetchAdsItemMetrics(
    advertiserId: string,
    accessToken: string,
    dateFrom: Date,
    dateTo: Date,
  ): Promise<unknown[]> {
    const from = dateFrom.toISOString().slice(0, 10);
    const to = dateTo.toISOString().slice(0, 10);
    const metrics = 'cost,units_quantity,clicks,prints';

    const ads: unknown[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const url =
        `${BASE_URL}/marketplace/advertising/${SITE_ID}/advertisers/${advertiserId}/product_ads/ads/search` +
        `?offset=${offset}&limit=${limit}&date_from=${from}&date_to=${to}` +
        `&metrics=${metrics}&aggregation_type=daily`;
      const response = await this.request(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Api-Version': '2' },
      });
      if (!response.ok) {
        throw new Error(`Mercado Livre /product_ads/ads/search retornou HTTP ${response.status} (offset ${offset})`);
      }
      const data = (await response.json()) as { results?: unknown[]; paging?: { total?: number } };
      const batch = Array.isArray(data.results) ? data.results : [];
      if (batch.length === 0) break;

      ads.push(...batch);
      offset += batch.length;
      const total = data.paging?.total ?? ads.length;
      if (offset >= total) break;
    }

    return ads;
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

  // --- Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP) ---
  //
  // Busca de categoria por texto livre — endpoint PÚBLICO (sem OAuth),
  // documentado em developers.mercadolivre.com.br/pt_br/domain-discovery.
  // Usado só no momento de CONFIGURAR o ChannelCategoryMapping (via
  // ChannelCategoryMappingService), nunca em toda publicação.
  async searchCategories(query: string): Promise<MlDomainDiscoveryResult[]> {
    const url = `${BASE_URL}/sites/${SITE_ID}/domain_discovery/search?limit=10&q=${encodeURIComponent(query)}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre /domain_discovery/search retornou HTTP ${response.status} para "${query}"`);
    }
    const data = (await response.json()) as MlDomainDiscoveryResult[];
    return Array.isArray(data) ? data : [];
  }

  // Atributos exigidos pela categoria — endpoint PÚBLICO, consultado sempre
  // ao vivo (nunca cacheado permanentemente: a lista muda por categoria e o
  // canal pode alterá-la sem aviso — ver CategoryDiscoveryCapableProvider).
  async getCategoryAttributes(categoryId: string): Promise<MlCategoryAttribute[]> {
    const url = `${BASE_URL}/categories/${categoryId}/attributes`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre /categories/${categoryId}/attributes retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as MlCategoryAttribute[];
    return Array.isArray(data) ? data : [];
  }

  // Cria o anúncio de fato — PRIMEIRO endpoint de escrita de LISTAGEM deste
  // client (diferente de pauseCampaign, que é escrita de Ads). MESMO aviso de
  // honestidade reforçado: nunca exercitado contra a API real. Só é chamado
  // depois que o gate canPublish (domain/listing-publication.entity.ts) já
  // validou o payload E o usuário confirmou explicitamente a publicação
  // (ListingPublicationService) — nunca automaticamente.
  async createItem(accessToken: string, payload: MlCreateItemPayload): Promise<MlCreateItemResult> {
    const response = await this.request(`${BASE_URL}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as MlCreateItemResult;
    if (!response.ok) {
      const detail = data.message ?? data.error ?? JSON.stringify(data.cause ?? {});
      throw new Error(`Mercado Livre POST /items retornou HTTP ${response.status}: ${detail}`);
    }
    return data;
  }

  // --- Criar anúncio de catálogo pelo EAN (09/10/2026) ---
  // AVISO DE HONESTIDADE: shapes e endpoints abaixo vêm da documentação
  // pública e NUNCA foram chamados contra o ML real. Parse defensivo.

  // Fichas de catálogo ativas para um GTIN/EAN (GET /products/search).
  async searchCatalogProductsByGtin(gtin: string, accessToken: string): Promise<MlCatalogProductHit[]> {
    const params = new URLSearchParams({ status: 'active', site_id: SITE_ID, product_identifier: gtin });
    const response = await this.request(`${BASE_URL}/products/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre GET /products/search retornou HTTP ${response.status}`);
    }
    const data = (await response.json().catch(() => ({}))) as {
      results?: { id?: string; name?: string; domain_id?: string; status?: string }[];
    };
    return (data.results ?? [])
      .filter((r): r is { id: string; name?: string; domain_id?: string; status?: string } => typeof r.id === 'string')
      .map((r) => ({ id: r.id, name: r.name ?? null, domainId: r.domain_id ?? null, status: r.status ?? null }));
  }

  // Cria anúncio de catálogo (POST /items com catalog_product_id). POST NÃO
  // idempotente: timeout não prova que o ML não criou — por isso NÃO retenta
  // em timeout (só em 429, que o ML rejeita antes de processar). Evita
  // anúncio duplicado.
  async createCatalogItem(accessToken: string, payload: Record<string, unknown>): Promise<MlCreateItemResult> {
    const response = await this.request(
      `${BASE_URL}/items`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      { retryOnTimeout: false },
    );
    const data = (await response.json().catch(() => ({}))) as MlCreateItemResult;
    if (!response.ok) {
      const detail = data.message ?? data.error ?? JSON.stringify(data.cause ?? {});
      throw new Error(`Mercado Livre POST /items (catálogo) retornou HTTP ${response.status}: ${detail}`);
    }
    return data;
  }

  // --- Buy Box + Campanhas do vendedor (07/10/2026, a pedido do Gui) ---
  //
  // Base do planejador de catálogo (promotion-intelligence/application/
  // ml-catalog-campaign.service.ts), que substitui a rotina manual que o
  // Gui fazia no Mercado Turbo. AVISO DE HONESTIDADE (mesmo padrão das
  // outras seções deste client): os shapes abaixo vêm da documentação
  // pública (catalog-competition, seller-campaigns, traditional-campaigns)
  // e foram escritos SEM uma chamada real neste sandbox — o parse é
  // defensivo (todo campo opcional) e campos desconhecidos viram null.

  // Dados do anúncio que o planejador precisa e que MlItemDetail não traz
  // (estoque, tipo de anúncio, seller_id dono do item).
  async fetchItemPricingContext(itemId: string, accessToken: string): Promise<MlItemPricingContext> {
    const response = await this.request(`${BASE_URL}/items/${itemId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre GET /items/${itemId} retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as MlRawItemBody & {
      seller_id?: number | null;
      original_price?: number | null;
      available_quantity?: number | null;
      listing_type_id?: string | null;
      variations?: {
        id?: number | string;
        seller_custom_field?: string | null;
        available_quantity?: number | null;
        attributes?: { id: string; value_name?: string | null }[];
        attribute_combinations?: { name?: string | null; value_name?: string | null }[];
      }[];
    };
    const detail = this.toItemDetail(data);
    // Parse defensivo: formato da variação vem da documentação, nunca
    // exercitado contra o ML real (ver docs/product/ml-catalogo-criar-por-ean.md).
    const variations: MlItemVariation[] = (data.variations ?? [])
      .filter((v) => v.id !== undefined && v.id !== null)
      .map((v) => ({
        id: String(v.id),
        skuCode:
          v.seller_custom_field ?? v.attributes?.find((a) => a.id === 'SELLER_SKU')?.value_name ?? null,
        attributes: (v.attributes ?? []).map((a) => ({ id: a.id, value_name: a.value_name ?? null })),
        label:
          (v.attribute_combinations ?? [])
            .map((c) => [c.name, c.value_name].filter(Boolean).join(': '))
            .filter(Boolean)
            .join(' / ') || null,
        availableQuantity: typeof v.available_quantity === 'number' ? v.available_quantity : 0,
      }));
    return {
      ...detail,
      sellerId: data.seller_id != null ? String(data.seller_id) : null,
      originalPrice: typeof data.original_price === 'number' ? data.original_price : null,
      availableQuantity: typeof data.available_quantity === 'number' ? data.available_quantity : 0,
      listingTypeId: data.listing_type_id ?? null,
      variations,
    };
  }

  // GET /items/{id}/price_to_win?version=v2 — status da disputa de catálogo
  // e o preço que faria o anúncio ganhar.
  async fetchPriceToWin(itemId: string, accessToken: string): Promise<MlPriceToWin> {
    const response = await this.request(`${BASE_URL}/items/${itemId}/price_to_win?siteId=${SITE_ID}&version=v2`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre GET /items/${itemId}/price_to_win retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      status?: string | null;
      price_to_win?: number | null;
      current_price?: number | null;
      catalog_product_id?: string | null;
      reason?: string[] | null;
      winner?: { item_id?: string | null; price?: number | null } | null;
    };
    return {
      status: data.status ?? null,
      priceToWin: typeof data.price_to_win === 'number' ? data.price_to_win : null,
      currentPrice: typeof data.current_price === 'number' ? data.current_price : null,
      catalogProductId: data.catalog_product_id ?? null,
      reasons: Array.isArray(data.reason) ? data.reason : [],
      winnerItemId: data.winner?.item_id ?? null,
      winnerPrice: typeof data.winner?.price === 'number' ? data.winner.price : null,
    };
  }

  // GET /seller-promotions/items/{id}?app_version=v2 — todas as promoções em
  // que o anúncio participa ou é candidato.
  async fetchItemPromotions(itemId: string, accessToken: string): Promise<MlItemPromotion[]> {
    const response = await this.request(`${BASE_URL}/seller-promotions/items/${itemId}?app_version=v2`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre GET /seller-promotions/items/${itemId} retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as unknown;
    const list = Array.isArray(data) ? data : Array.isArray((data as { results?: unknown[] })?.results) ? (data as { results: unknown[] }).results : [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
    return list
      .filter((raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null)
      .map((raw) => ({
        id: str(raw.id) ?? '',
        type: str(raw.type) ?? 'UNKNOWN',
        subType: str(raw.sub_type),
        status: str(raw.status) ?? 'unknown',
        name: str(raw.name),
        price: num(raw.price),
        originalPrice: num(raw.original_price),
        minDiscountedPrice: num(raw.min_discounted_price),
        maxDiscountedPrice: num(raw.max_discounted_price),
        suggestedDiscountedPrice: num(raw.suggested_discounted_price),
        startDate: str(raw.start_date),
        finishDate: str(raw.finish_date),
      }))
      .filter((p) => p.id !== '');
  }

  // POST /seller-promotions/items/{id}?app_version=v2 — ESCRITA REAL: coloca
  // o anúncio numa campanha com o preço promocional informado. Só chamado
  // depois de o serviço recalcular a margem no servidor e ela ficar acima do
  // mínimo (nunca confia no preço vindo do cliente sem recalcular). O próprio
  // ML recusa item de outro vendedor (token escopado).
  async joinItemPromotion(
    itemId: string,
    accessToken: string,
    input: { promotionId: string; promotionType: string; dealPrice: number },
  ): Promise<{ price: number | null; originalPrice: number | null }> {
    const response = await this.request(`${BASE_URL}/seller-promotions/items/${itemId}?app_version=v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promotion_id: input.promotionId,
        promotion_type: input.promotionType,
        deal_price: input.dealPrice,
      }),
    }, { retryOnTimeout: false });
    const data = (await response.json().catch(() => ({}))) as {
      price?: number;
      original_price?: number;
      message?: string;
      error?: string;
      cause?: unknown[];
    };
    if (!response.ok) {
      const detail = data.message ?? data.error ?? JSON.stringify(data.cause ?? {});
      throw new Error(`Mercado Livre POST /seller-promotions/items/${itemId} retornou HTTP ${response.status}: ${detail}`);
    }
    return {
      price: typeof data.price === 'number' ? data.price : null,
      originalPrice: typeof data.original_price === 'number' ? data.original_price : null,
    };
  }

  // Resumo de vários anúncios (multiget, 20 por chamada) só com o que a
  // listagem do planejador precisa: é catálogo? está ativo? tem estoque?
  async fetchCatalogListingSummaries(itemIds: string[], accessToken: string): Promise<MlCatalogListingSummary[]> {
    const BATCH_SIZE = 20;
    const results: MlCatalogListingSummary[] = [];
    for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
      const batchIds = itemIds.slice(i, i + BATCH_SIZE);
      const url =
        `${BASE_URL}/items?ids=${batchIds.join(',')}` +
        '&attributes=id,title,price,status,available_quantity,catalog_listing,catalog_product_id,seller_custom_field,attributes';
      const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) {
        throw new Error(`Mercado Livre /items (multiget) retornou HTTP ${response.status} para o lote iniciando em ${batchIds[0]}`);
      }
      const data = (await response.json()) as {
        code: number;
        body?: MlRawItemBody & { available_quantity?: number | null };
      }[];
      for (const entry of data) {
        if (entry.code !== 200 || !entry.body) continue;
        results.push({
          id: entry.body.id,
          title: entry.body.title ?? null,
          price: typeof entry.body.price === 'number' ? entry.body.price : null,
          status: entry.body.status ?? null,
          availableQuantity: typeof entry.body.available_quantity === 'number' ? entry.body.available_quantity : 0,
          isCatalogListing: entry.body.catalog_listing === true,
          catalogProductId: entry.body.catalog_product_id ?? null,
          skuCode: this.resolveSellerSku(entry.body),
        });
      }
    }
    return results;
  }

  // Tarifa de venda do ML para um preço/categoria/tipo de anúncio — o valor
  // que o Mercado Turbo mostra como "Tarifa de Venda".
  async fetchSaleFeeAmount(categoryId: string, price: number, listingTypeId: string): Promise<number> {
    const url =
      `${BASE_URL}/sites/${SITE_ID}/listing_prices?price=${price}` +
      `&category_id=${encodeURIComponent(categoryId)}&listing_type_id=${encodeURIComponent(listingTypeId)}`;
    const response = await this.request(url);
    if (!response.ok) {
      throw new Error(`Mercado Livre listing_prices retornou HTTP ${response.status} para ${categoryId}/${listingTypeId}`);
    }
    const data = (await response.json()) as MlListingPrice | MlListingPrice[];
    const entry = Array.isArray(data) ? data.find((d) => d.listing_type_id === listingTypeId) ?? data[0] : data;
    if (!entry || typeof entry.sale_fee_amount !== 'number') {
      throw new Error(`listing_prices sem sale_fee_amount para ${categoryId}/${listingTypeId} a R$ ${price}`);
    }
    return entry.sale_fee_amount;
  }

  // Custo de frete pago pelo VENDEDOR para enviar este anúncio (o "Frete ML"
  // do Mercado Turbo). GET /users/{seller}/shipping_options/free?item_id=...
  // → coverage.all_country.list_cost.
  async fetchSellerShippingCost(sellerId: string, itemId: string, accessToken: string): Promise<number> {
    const url = `${BASE_URL}/users/${sellerId}/shipping_options/free?item_id=${itemId}`;
    const response = await this.request(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      throw new Error(`Mercado Livre shipping_options/free retornou HTTP ${response.status} para ${itemId}`);
    }
    const data = (await response.json()) as { coverage?: { all_country?: { list_cost?: number } } };
    const cost = data.coverage?.all_country?.list_cost;
    if (typeof cost !== 'number') {
      throw new Error(`shipping_options/free sem coverage.all_country.list_cost para ${itemId}`);
    }
    return cost;
  }
}
