import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { RateLimiter } from '../../../../../shared/rate-limiting/rate-limiter';
import { getRateLimitConfig } from '../../../../../shared/rate-limiting/marketplace-rate-limits';
import { isRateLimitError, isTimeoutError, withRetry } from '../../../../../shared/rate-limiting/with-retry';

// Base do Shopee Open Platform.
//
// CONFIRMADO EM PRODUÇÃO (27/07/2026), em duas etapas — a suposição
// original deste comentário estava ERRADA duas vezes seguidas:
// (1) credenciais de TESTE não funcionam contra `https://partner.shopeemobile.com`
//     (produção) — primeiro handshake real devolveu `{"error":"invalid_partner_id"}`.
// (2) a URL de sandbox documentada em blogs de terceiros
//     (`https://partner.test-stable.shopeemobile.com`) aceitava o
//     partner_id mas rejeitava TODA assinatura HMAC com "Wrong sign" —
//     mesmo com a fórmula e a chave verificadas byte a byte como corretas.
// A URL de sandbox REAL só apareceu ao usar a "Ferramenta de teste de API"
// dentro do próprio Shopee Open Platform Console (não documentada nos
// blogs de terceiros consultados antes): um domínio `.sg` completamente
// diferente —`https://openplatform.sandbox.test-stable.shopee.sg`.
// `DEFAULT_BASE_URL` continua sendo a base de PRODUÇÃO (para quando o app
// for aprovado e ganhar credenciais reais); `SHOPEE_BASE_URL` deve ser
// explicitamente setada para a URL de sandbox acima enquanto o app estiver
// em modo de teste — ver .env.example e docs/auth-security.md, seção 9.
const DEFAULT_BASE_URL = 'https://partner.shopeemobile.com';

// Resposta de POST /api/v2/auth/token/get (troca de code) e de
// POST /api/v2/auth/access_token/get (refresh) — MESMO formato de resposta
// para as duas chamadas, conforme documentação pública do Shopee Open
// Platform v2. Diferente do Mercado Livre: não há `token_type`/`scope`
// nesta resposta.
export interface ShopeeOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number; // segundos até expirar — tipicamente 14400 (4h), MAIS CURTO que o ML
  shop_id?: number;
  partner_id?: number;
  error?: string;
  message?: string;
}

// Cliente sobre a API do Shopee Open Platform — autenticação por assinatura
// HMAC-SHA256 em TODA chamada (nunca um Bearer token simples): a Shopee
// exige `partner_id` + `timestamp` + `sign` como query params em toda
// requisição, autenticada ou não. `sign` varia conforme o tipo de chamada
// (ver `sign()` abaixo).
//
// AVISO DE HONESTIDADE (mesmo padrão do MercadoLivreApiClient): o formato de
// assinatura, os paths de troca/renovação de token e o formato da resposta
// seguem a documentação pública do Shopee Open Platform e um guia de
// terceiro (developer.inlinex.com.sg) consultados neste sandbox — nunca
// exercitados contra uma chamada real (app em status "Developing", só
// credenciais de teste). Isso deve ser validado no primeiro
// handshake/conexão real feita pelo usuário, ANTES de confiar neste client
// para qualquer fluxo de produção (pedidos, preços). Nenhum endpoint de
// pedidos/produtos foi implementado ainda de propósito — só o necessário
// para a camada de conexão OAuth (ver Pending Tasks / README).
@Injectable()
export class ShopeeApiClient {
  private readonly logger = new Logger(ShopeeApiClient.name);

  // Mesmo racional de throttling do MercadoLivreApiClient (ver comentário
  // lá, incidente de produção 24/07/2026) — aplicado aqui PREVENTIVAMENTE,
  // antes de qualquer incidente real, já que o limite oficial do Shopee não
  // pôde ser confirmado (ver marketplace-rate-limits.ts).
  private readonly rateLimiter = new RateLimiter(getRateLimitConfig('SHOPEE'));

  // Mesmo racional de timeout do MercadoLivreApiClient (bug de produção
  // 25/07/2026 — fetch nativo do Node não tem timeout implícito e uma
  // chamada travada trava o sync inteiro).
  private static readonly REQUEST_TIMEOUT_MS = 20_000;

  private get baseUrl(): string {
    return process.env.SHOPEE_BASE_URL || DEFAULT_BASE_URL;
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    return withRetry(
      async () => {
        const response = await this.rateLimiter.schedule(() => this.fetchWithTimeout(url, init));
        if (response.status === 429) {
          throw new Error(`Shopee retornou HTTP 429 (rate limit) para ${url}`);
        }
        return response;
      },
      { shouldRetry: (error) => isRateLimitError(error) || isTimeoutError(error) },
    );
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), ShopeeApiClient.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Shopee não respondeu em ${ShopeeApiClient.REQUEST_TIMEOUT_MS}ms (timeout) para ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // Assinatura HMAC-SHA256 — a STRING assinada muda conforme o tipo de
  // chamada (documentação pública do Shopee Open Platform v2):
  //   - chamadas públicas/de auth (sem loja autorizada ainda): partner_id + path + timestamp
  //   - chamadas de loja já autorizada: partner_id + path + timestamp + access_token + shop_id
  // `partnerKey` nunca é logado nem incluído no retorno — só usado como
  // chave HMAC efêmera dentro desta função.
  private sign(path: string, timestamp: number, partnerId: string, partnerKey: string, accessToken?: string, shopId?: string): string {
    const base = accessToken && shopId ? `${partnerId}${path}${timestamp}${accessToken}${shopId}` : `${partnerId}${path}${timestamp}`;
    return createHmac('sha256', partnerKey).update(base).digest('hex');
  }

  // Passo 1 do fluxo — monta a URL para a qual o FRONTEND deve redirecionar
  // o navegador do lojista (tela de autorização do próprio Shopee, fora da
  // nossa aplicação). Diferente do Mercado Livre, a Shopee não tem um
  // parâmetro `state` nativo — por isso o `redirect` embute nosso próprio
  // `state` criptografado como query param (ver ShopeeConnectionService);
  // a Shopee só ANEXA `code`/`shop_id` ao redirecionar de volta, sem remover
  // query params já presentes (técnica padrão usada por integradores
  // terceiros para contornar a ausência de `state` nativo — NÃO validada
  // ainda contra um redirect real da Shopee neste sandbox).
  buildAuthPartnerUrl(partnerId: string, partnerKey: string, redirectUri: string): string {
    const path = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, partnerId, partnerKey);
    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
      redirect: redirectUri,
    });
    return `${this.baseUrl}${path}?${params.toString()}`;
  }

  // Passo 2 — troca do `code` (+ `shop_id`, devolvidos no redirect) pelo par
  // access_token/refresh_token. Chamado uma única vez por conexão nova
  // (ShopeeConnectionService.handleCallback).
  async exchangeCodeForToken(partnerId: string, partnerKey: string, code: string, shopId: string): Promise<ShopeeOAuthTokenResponse> {
    return this.postAuthEndpoint(partnerId, partnerKey, '/api/v2/auth/token/get', {
      code,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    });
  }

  // Renovação — executado automaticamente por
  // ShopeeConnectionService.getValidAccessToken() sempre que o access_token
  // armazenado está vencido ou perto de vencer (janela de 4h, bem mais curta
  // que a do Mercado Livre). A Shopee também substitui o refresh_token a
  // cada renovação — o chamador persiste os dois campos, nunca só o
  // primeiro (mesmo cuidado do MercadoLivreApiClient).
  async refreshAccessToken(partnerId: string, partnerKey: string, refreshToken: string, shopId: string): Promise<ShopeeOAuthTokenResponse> {
    return this.postAuthEndpoint(partnerId, partnerKey, '/api/v2/auth/access_token/get', {
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(partnerId),
    });
  }

  // Ambas as chamadas de auth (token/get e access_token/get) são assinadas
  // do MESMO jeito (sem access_token/shop_id na assinatura — só no BODY) e
  // têm o mesmo formato de resposta — por isso compartilham este helper
  // privado, evitando duplicar a lógica de assinatura/erro.
  private async postAuthEndpoint(
    partnerId: string,
    partnerKey: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ShopeeOAuthTokenResponse> {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, partnerId, partnerKey);
    const url = `${this.baseUrl}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

    const response = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Shopee ${path} retornou HTTP ${response.status}: ${text}`);
    }
    const data = (await response.json()) as ShopeeOAuthTokenResponse;
    // A Shopee devolve HTTP 200 mesmo em erro de negócio (ex.: code
    // inválido/expirado) — o corpo é quem carrega `error`/`message` nesse
    // caso, então precisa ser checado explicitamente (não basta response.ok).
    if (data.error) {
      throw new Error(`Shopee ${path} retornou erro de negócio: ${data.error} — ${data.message ?? ''}`);
    }
    return data;
  }

  // Handshake de diagnóstico (ShopeeHandshakeService) — /api/v2/shop/get_shop_info
  // é o endpoint mais leve possível que exige uma loja já autorizada
  // (assinatura shop-level: partner_id+path+timestamp+access_token+shop_id),
  // por isso serve como "prova de vida" real da conexão sem tocar em
  // pedidos/produtos (nenhum desses provider ainda existe, ver README).
  //
  // AVISO DE HONESTIDADE: path e formato de resposta assumidos da
  // documentação pública do Shopee Open Platform — não validados contra uma
  // chamada real neste sandbox.
  async fetchShopInfo(
    partnerId: string,
    partnerKey: string,
    shopId: string,
    accessToken: string,
  ): Promise<{ shop_name?: string; status?: string; region?: string; error?: string; message?: string }> {
    const path = '/api/v2/shop/get_shop_info';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this.sign(path, timestamp, partnerId, partnerKey, accessToken, shopId);
    const url = `${this.baseUrl}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&access_token=${accessToken}&shop_id=${shopId}`;

    const response = await this.request(url, { headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Shopee ${path} retornou HTTP ${response.status}: ${text}`);
    }
    const data = (await response.json()) as { shop_name?: string; status?: string; region?: string; error?: string; message?: string };
    if (data.error) {
      throw new Error(`Shopee ${path} retornou erro de negócio: ${data.error} — ${data.message ?? ''}`);
    }
    return data;
  }
}
