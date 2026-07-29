import { Injectable, Logger } from '@nestjs/common';
import { isTimeoutError, withRetry } from '../../../shared/rate-limiting/with-retry';

// Cliente sobre a API REST da Focus NFe v2 (parceiro fiscal escolhido na
// Fase 0, ver docs/tiny-erp-benchmark-analysis.md, seção 1.1, e
// docs/fiscal-nfe-architecture.md). Autenticação via HTTP Basic Auth — o
// token da empresa vai como "usuário", senha em branco (documentação
// oficial: https://focusnfe.com.br/doc). Dois ambientes, mesma API:
// homologação (`https://homologacao.focusnfe.com.br`, sem valor fiscal) e
// produção (`https://api.focusnfe.com.br`).
//
// AVISO DE HONESTIDADE: implementado a partir da documentação pública da
// Focus NFe — ainda não exercitado contra uma emissão real (o usuário já
// tem certificado A1, mas hoje emite pelo Olist; falta configurar uma
// série de NF-e distinta no painel Focus NFe antes do primeiro envio real,
// ver docs/fiscal-nfe-architecture.md).
@Injectable()
export class FocusNfeApiClient {
  private readonly logger = new Logger(FocusNfeApiClient.name);

  private static readonly REQUEST_TIMEOUT_MS = 30_000;
  private static readonly HOMOLOGACAO_URL = 'https://homologacao.focusnfe.com.br';
  private static readonly PRODUCAO_URL = 'https://api.focusnfe.com.br';

  private baseUrl(environment: 'HOMOLOGACAO' | 'PRODUCAO'): string {
    return environment === 'PRODUCAO' ? FocusNfeApiClient.PRODUCAO_URL : FocusNfeApiClient.HOMOLOGACAO_URL;
  }

  private authHeader(token: string): string {
    // Basic Auth com senha vazia: "token:" em base64 (padrão documentado).
    return `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FocusNfeApiClient.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Focus NFe não respondeu em ${FocusNfeApiClient.REQUEST_TIMEOUT_MS}ms (timeout) para ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async request(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await withRetry(() => this.fetchWithTimeout(url, init), { shouldRetry: (error) => isTimeoutError(error) });
    const text = await response.text().catch(() => '');
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        this.logger.warn(`Focus NFe devolveu corpo não-JSON para ${url}: ${text.slice(0, 200)}`);
      }
    }
    return { status: response.status, body };
  }

  // Envio assíncrono (POST /v2/nfe?ref=REFERENCIA) — devolve HTTP 202 com
  // status "processando_autorizacao" na maioria dos casos, ou já o status
  // final se a Focus NFe conseguir processar de forma síncrona
  // (excepcional). O corpo de resposta é sempre repassado cru para o
  // chamador decidir (FiscalInvoiceService) — este client não interpreta
  // status de negócio, só a comunicação HTTP.
  async emit(
    token: string,
    environment: 'HOMOLOGACAO' | 'PRODUCAO',
    ref: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = `${this.baseUrl(environment)}/v2/nfe?ref=${encodeURIComponent(ref)}`;
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader(token) },
      body: JSON.stringify(payload),
    });
  }

  // Consulta (GET /v2/nfe/REFERENCIA) — usado tanto para polling manual
  // (endpoint check-status) quanto, no futuro, por um job de reconciliação
  // (gap conhecido: hoje o Kyneti não tem um poller automático, só o
  // gatilho/webhook da Focus NFe e a checagem manual — ver
  // docs/fiscal-nfe-architecture.md).
  async consult(token: string, environment: 'HOMOLOGACAO' | 'PRODUCAO', ref: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = `${this.baseUrl(environment)}/v2/nfe/${encodeURIComponent(ref)}?completa=1`;
    return this.request(url, {
      method: 'GET',
      headers: { Authorization: this.authHeader(token) },
    });
  }

  // Cancelamento (DELETE /v2/nfe/REFERENCIA) — síncrono, a Focus NFe já
  // comunica a SEFAZ na mesma requisição.
  async cancel(
    token: string,
    environment: 'HOMOLOGACAO' | 'PRODUCAO',
    ref: string,
    justificativa: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = `${this.baseUrl(environment)}/v2/nfe/${encodeURIComponent(ref)}`;
    return this.request(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader(token) },
      body: JSON.stringify({ justificativa }),
    });
  }
}
