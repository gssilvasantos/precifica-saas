import { Injectable, Logger } from '@nestjs/common';
import { RateLimiter } from '../../../../shared/rate-limiting/rate-limiter';
import { getRateLimitConfig } from '../../../../shared/rate-limiting/marketplace-rate-limits';
import { isRateLimitError, withRetry } from '../../../../shared/rate-limiting/with-retry';

const BASE_URL = 'https://api.nuvemshop.com.br/v1';

// Cliente da API da Nuvemshop — leitura (produtos/pedidos/taxas) e, desde
// 31/07/2026 (task "Nuvemshop: push de preço"), UMA escrita: atualizar o
// preço de uma variante (usada por NuvemshopPriceUpdateProvider). Continua
// nunca escrevendo nada além disso — qualquer outra escrita futura é um
// método novo aqui, não uma mudança de arquitetura.
//
// Autenticação: "app privado" (storeId + access_token gerados no painel,
// Configurações > Meus Aplicativos) — a API da Nuvemshop historicamente usa
// um header customizado `Authentication: bearer TOKEN` (não o `Authorization`
// padrão) e exige um `User-Agent` descritivo, ou rejeita a chamada.
//
// AVISO DE HONESTIDADE (mesmo padrão do Olist/Mercado Livre): a listagem de
// produtos/variantes segue a API pública e bem documentada da Nuvemshop com
// confiança razoável. A tabela de taxas do gateway Nuvem Pago (comissão por
// parcela x janela de recebimento) é dado tipicamente só visível no painel
// do lojista — não tenho confiança de que exista um endpoint público
// estável para isso, e não consegui validar ao vivo neste ambiente. Por
// isso `fetchGatewayFeeTable` é "best effort": se a chamada falhar ou o
// formato não bater, retorna vazio e loga uma mensagem clara — o
// NuvemshopFeeRuleProvider trata isso como "nenhum candidato" em vez de
// quebrar o sync, e o tenant pode cadastrar a tabela manualmente via
// POST /marketplace-intelligence/rules/manual (endpoint que já existe desde
// a Etapa 4 exatamente para esse tipo de situação).
export interface NuvemshopProductVariant {
  id: string;
  sku: string;
  price: string;
}

export interface NuvemshopProduct {
  id: string;
  name: string;
  variants: NuvemshopProductVariant[];
  permalink?: string;
}

@Injectable()
export class NuvemshopApiClient {
  private readonly logger = new Logger(NuvemshopApiClient.name);

  // Etapa 17 (escalabilidade multicanal) — UMA instância de RateLimiter por
  // client, configurada com o limite documentado deste canal (ver
  // shared/rate-limiting/marketplace-rate-limits.ts). Aproximação
  // consciente: o bucket é GLOBAL ao client (todas as lojas/tenants que
  // usam esta instância do NestJS compartilham a mesma cota), não por loja
  // individual — seguro por construção (nunca estoura o limite real),
  // apenas conservador quando o volume multi-tenant crescer. Refinamento
  // natural, se necessário: um bucket por storeId em vez de um único.
  private readonly rateLimiter = new RateLimiter(getRateLimitConfig('NUVEMSHOP'));

  private headers(accessToken: string): HeadersInit {
    return {
      Authentication: `bearer ${accessToken}`,
      'User-Agent': 'Precifica SaaS (contato@precifica.app)',
      'Content-Type': 'application/json',
    };
  }

  // Todo fetch passa por aqui: rate limiter primeiro (throttle preventivo),
  // depois retry com backoff SE mesmo assim vier um 429 (a API pode ter um
  // limite mais estrito do que o configurado, ou outro processo/tenant
  // consumindo a mesma cota) — nunca o contrário (retry sem throttle só
  // adicionaria mais pressão a uma API já saturada).
  private async request(url: string, accessToken: string): Promise<Response> {
    return withRetry(
      async () => {
        const response = await this.rateLimiter.schedule(() => fetch(url, { headers: this.headers(accessToken) }));
        // fetch() só rejeita em falha de rede — um 429 é uma resposta
        // normal (response.ok = false), não uma exceção. Transformamos em
        // Error aqui só para que withRetry/isRateLimitError consigam
        // reconhecer e retentar; qualquer outro status (404, 500...)
        // simplesmente retorna, e o método chamador decide como reagir
        // (mensagens específicas por endpoint, como já faziam antes).
        if (response.status === 429) {
          throw new Error(`Nuvemshop retornou HTTP 429 (rate limit) para ${url}`);
        }
        return response;
      },
      { shouldRetry: isRateLimitError },
    );
  }

  // Mesmo pipeline de rate-limit/retry de `request`, mas para verbos com
  // corpo (PUT/POST) — usado hoje só por updateVariantPrice. fetch() só
  // rejeita em falha de rede, então o 429 é tratado da mesma forma que no
  // GET (transformado em Error para o withRetry reconhecer).
  private async writeRequest(url: string, accessToken: string, method: 'PUT' | 'POST', body: unknown): Promise<Response> {
    return withRetry(
      async () => {
        const response = await this.rateLimiter.schedule(() =>
          fetch(url, { method, headers: this.headers(accessToken), body: JSON.stringify(body) }),
        );
        if (response.status === 429) {
          throw new Error(`Nuvemshop retornou HTTP 429 (rate limit) para ${method} ${url}`);
        }
        return response;
      },
      { shouldRetry: isRateLimitError },
    );
  }

  async healthCheck(storeId: string, accessToken: string): Promise<boolean> {
    try {
      const response = await this.request(`${BASE_URL}/${storeId}/store`, accessToken);
      return response.ok;
    } catch {
      return false;
    }
  }

  async fetchAllProducts(storeId: string, accessToken: string): Promise<NuvemshopProduct[]> {
    const products: NuvemshopProduct[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const url = `${BASE_URL}/${storeId}/products?page=${page}&per_page=${perPage}&published=true`;
      const response = await this.request(url, accessToken);
      if (!response.ok) {
        throw new Error(`Nuvemshop /products retornou HTTP ${response.status} (página ${page})`);
      }
      const batch = (await response.json()) as Array<{
        id: number | string;
        name: { pt?: string } | string;
        permalink?: string;
        variants?: Array<{ id?: number | string; sku?: string; price?: string }>;
      }>;
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const item of batch) {
        const name = typeof item.name === 'string' ? item.name : item.name?.pt ?? '';
        const variants = (item.variants ?? [])
          .filter((v) => typeof v.sku === 'string' && v.sku.trim() !== '')
          .map((v) => ({ id: String(v.id ?? ''), sku: v.sku as string, price: v.price ?? '0' }));
        if (variants.length === 0) continue; // sem SKU não dá para vincular — pulado, não é erro
        products.push({ id: String(item.id), name, variants, permalink: item.permalink });
      }

      if (batch.length < perPage) break;
      page++;
    }

    return products;
  }

  // Usado por NuvemshopPriceUpdateProvider para resolver, a partir do
  // `externalId` guardado em ChannelListing (= product.id, ver
  // NuvemshopChannelListingSyncService), a lista de variantes ATUAL do
  // produto — inclusive o `id` de cada variante, que fetchAllProducts também
  // captura mas ChannelListing não persiste (só guarda o preço/SKU). GET de
  // 1 produto só, nunca a loja inteira.
  async fetchProduct(storeId: string, accessToken: string, productId: string): Promise<NuvemshopProduct | null> {
    const url = `${BASE_URL}/${storeId}/products/${productId}`;
    const response = await this.request(url, accessToken);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Nuvemshop /products/${productId} retornou HTTP ${response.status}`);
    }
    const item = (await response.json()) as {
      id: number | string;
      name: { pt?: string } | string;
      permalink?: string;
      variants?: Array<{ id?: number | string; sku?: string; price?: string }>;
    };
    const name = typeof item.name === 'string' ? item.name : item.name?.pt ?? '';
    const variants = (item.variants ?? [])
      .filter((v) => typeof v.sku === 'string' && v.sku.trim() !== '')
      .map((v) => ({ id: String(v.id ?? ''), sku: v.sku as string, price: v.price ?? '0' }));
    return { id: String(item.id), name, variants, permalink: item.permalink };
  }

  // Única escrita deste client (ver comentário no topo do arquivo) — preço é
  // por VARIANTE, nunca por produto (mesmo produto pode ter N SKUs/variantes
  // com preços diferentes), por isso exige productId + variantId, não só o
  // externalId de ChannelListing. Endpoint oficial: PUT
  // /{store_id}/products/{product_id}/variants/{variant_id}, corpo
  // `{price: "99.90"}` (string, mesmo formato devolvido pela leitura).
  async updateVariantPrice(storeId: string, accessToken: string, productId: string, variantId: string, newPrice: number): Promise<void> {
    const url = `${BASE_URL}/${storeId}/products/${productId}/variants/${variantId}`;
    const response = await this.writeRequest(url, accessToken, 'PUT', { price: newPrice.toFixed(2) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Nuvemshop PUT /products/${productId}/variants/${variantId} retornou HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }
  }

  // Pedidos — mesmo estilo de paginação de fetchAllProducts (incrementa
  // `page` até vir um lote menor que perPage). `updated_at_min` é o filtro
  // incremental oficial da API da Nuvemshop para pedidos (evita reler a loja
  // inteira a cada sync); usado pelo OrderSyncOrchestrator via `since`.
  async fetchOrders(storeId: string, accessToken: string, since?: Date): Promise<unknown[]> {
    const orders: unknown[] = [];
    let page = 1;
    const perPage = 200;
    const sinceParam = since ? `&updated_at_min=${since.toISOString()}` : '';

    while (true) {
      const url = `${BASE_URL}/${storeId}/orders?page=${page}&per_page=${perPage}${sinceParam}`;
      const response = await this.request(url, accessToken);
      if (!response.ok) {
        throw new Error(`Nuvemshop /orders retornou HTTP ${response.status} (página ${page})`);
      }
      const batch = await response.json();
      if (!Array.isArray(batch) || batch.length === 0) break;

      orders.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }

    return orders;
  }

  // Best-effort — ver aviso de honestidade no topo do arquivo.
  async fetchGatewayFeeTable(storeId: string, accessToken: string): Promise<unknown[]> {
    try {
      const response = await this.request(`${BASE_URL}/${storeId}/payment_providers`, accessToken);
      if (!response.ok) {
        this.logger.warn(
          `Nuvemshop não retornou tabela de taxas do gateway via API (HTTP ${response.status}) para a loja ${storeId}. ` +
            'Cadastre a tabela manualmente em POST /marketplace-intelligence/rules/manual — o restante do pipeline funciona igual.',
        );
        return [];
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.logger.warn(
        `Falha ao buscar taxas do gateway da Nuvemshop para a loja ${storeId}: ${(error as Error).message}. ` +
          'Cadastro manual continua disponível via POST /marketplace-intelligence/rules/manual.',
      );
      return [];
    }
  }
}
