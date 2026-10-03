import { Injectable, Logger } from '@nestjs/common';
import { RateLimiter } from '../../../../shared/rate-limiting/rate-limiter';
import { getRateLimitConfig } from '../../../../shared/rate-limiting/marketplace-rate-limits';
import { withRetry } from '../../../../shared/rate-limiting/with-retry';

const BASE_URL = 'https://api.tiny.com.br/api2';

// O Tiny sinaliza estouro de cota com HTTP 200 e uma MENSAGEM no corpo
// ("API Bloqueada - Excedido o número de acessos a API"), não com 429 — por
// isso a detecção é por texto, não por status. Sem isso, o retry nunca
// dispararia para o único erro em que ele realmente importa.
// Exportado (09/08/2026) porque o ErpSyncOrchestrator precisa do MESMO
// predicado para NÃO re-tentar uma busca que já morreu por cota — ver o
// comentário em ErpSyncOrchestrator.withRetry. Duas definições do que é
// "bloqueio de cota" divergiriam com o tempo; esta é a única.
export function isRateLimitError(error: unknown): boolean {
  const message = (error as Error)?.message ?? '';
  return /API Bloqueada|Excedido o n[úu]mero de acessos/i.test(message);
}

// GARANTIA DE SOMENTE LEITURA (docs/erp-integration-architecture.md, seção 4,
// camada técnica): esta classe implementa SÓ os dois GETs necessários para
// importar o catálogo. Não existe, e nunca deve existir, um método que
// chame produto.alterar.php ou qualquer outro endpoint de escrita da API do
// Tiny — a ausência do caminho de código é a garantia, não uma checagem em
// runtime que pode ser burlada por engano.
//
// Autenticação: API V2, token estático por conta (gerado pelo tenant em
// Configurações > Preferências > Chave da API, no painel do Olist),
// enviado como query param `token` em toda chamada — ver seção 8 do doc de
// arquitetura para o porquê de V2 em vez de V3/OAuth2 nesta entrega.
//
// AVISO DE HONESTIDADE: os nomes de endpoint (`produtos.pesquisa.php`,
// `produto.obter.php`) e o formato paginado (retorno.produtos[].produto,
// retorno.numero_paginas) vêm do conhecimento geral e bem documentado da
// API V2 do Tiny/Olist, mas não foi possível confirmar contra uma chamada
// autenticada ao vivo neste ambiente (ver nota igual no client do Mercado
// Livre). O normalizador (domain/olist-product-normalizer.ts) rejeita e
// loga qualquer resposta fora do formato esperado em vez de confiar cegamente.
export interface OlistProductSummary {
  id: string;
  codigo: string;
  nome: string;
  situacao: string;
}

@Injectable()
export class OlistApiClient {
  private readonly logger = new Logger(OlistApiClient.name);

  // Throttling REAL (02/08/2026) — substitui o `sleep(300)` fixo que
  // rodava a 200 req/min contra um limite de 60. Ver o comentário de OLIST
  // em shared/rate-limiting/marketplace-rate-limits.ts.
  private readonly rateLimiter = new RateLimiter(getRateLimitConfig('OLIST'));

  // CORRIGIDO (03/10/2026, a pedido do Gui: "porque a olist está assim,
  // investigue"): este client nunca teve timeout — diferente de
  // MercadoLivreApiClient/ShopeeApiClient, que já tratam isso (ver aviso de
  // ambos: "fetch nativo do Node não tem timeout implícito e uma chamada
  // travada trava o sync inteiro"). Investigação direto no banco (333
  // tentativas desde 31/07, ver provider_sync_logs): 203 falharam rápido com
  // "fetch failed" (a mensagem genérica do fetch do Node quando a conexão
  // falha — sem o `cause`, nunca dava pra saber se é DNS, TLS ou conexão
  // recusada), e 129 ficaram PENDURADAS PARA SEMPRE — nunca erraram, nunca
  // terminaram (finishedAt null, até hoje).
  //
  // CORRIGIDO DE NOVO (03/10/2026, poucas horas depois do fix acima): o
  // primeiro fix só envolvia o `fetch(url, { signal })` em si — mas
  // `clearTimeout` disparava no `finally` logo que esse `await` resolvia,
  // ou seja, assim que os HEADERS chegavam. A leitura do corpo
  // (`response.json()`) acontecia DEPOIS, em requestJson, já sem nenhum
  // guarda-chuva de timeout. Resultado: uma chamada que conecta normalmente
  // mas trava lendo o corpo da resposta (conexão TCP aberta, Tiny para de
  // mandar dado no meio do stream — bem mais comum do que uma conexão que
  // nunca nem abre) continuava pendurada pra sempre, exatamente como antes.
  // Confirmado em produção: a sincronização das 2026-10-03 12:00:00 ficou
  // 1h42min sem terminar e SEM NENHUM log de erro — nem do timeout, nem de
  // falha por produto — o que só é possível se nenhuma chamada chegou a
  // rejeitar nunca, ou seja, estava travada na leitura do corpo, não na
  // conexão. Agora o MESMO AbortController cobre fetch() E response.json()
  // juntos — só um dos dois pontos de travamento (abrir conexão, ler corpo)
  // tinha guarda antes; os dois precisam da mesma janela de 20s.
  private static readonly REQUEST_TIMEOUT_MS = 20_000;

  private async fetchJsonWithTimeout<T>(url: string, describe: string): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), OlistApiClient.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Olist ${describe} retornou HTTP ${response.status}`);
      }
      // `response.json()` AINDA sob o mesmo `controller.signal`: abortar
      // depois que os headers já chegaram também corta a leitura do corpo
      // em andamento (é o mesmo AbortSignal da chamada) — ver aviso acima.
      return (await response.json()) as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Olist não respondeu em ${OlistApiClient.REQUEST_TIMEOUT_MS}ms (timeout) para ${url}`);
      }
      // `cause` carrega o erro real do Node (ENOTFOUND, ECONNREFUSED,
      // ECONNRESET, certificado inválido etc.) — o fetch nativo só expõe
      // "fetch failed" em error.message, escondendo exatamente a informação
      // que faltava pra diagnosticar isto. Nunca descartar.
      const cause = (error as { cause?: unknown }).cause;
      const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : null;
      // Sem `{ cause }` no construtor de propósito: o target deste projeto é
      // ES2021 (tsconfig.json), que não tem o tipo da segunda forma de Error
      // do TS — a causa real já vai embutida na própria mensagem, que é o
      // dado que faltava (ver aviso acima de REQUEST_TIMEOUT_MS). Erro de
      // HTTP (ex.: "retornou HTTP 500") já vem com mensagem própria — só
      // reembrulha quando `cause` existir e for diferente disso.
      if ((error as Error).message?.startsWith('Olist ') && causeMessage === null) throw error;
      throw new Error(`Olist: falha de rede ao chamar ${url}${causeMessage ? ` — causa: ${causeMessage}` : ''}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // Toda chamada passa por aqui: primeiro espera a cota (RateLimiter), e se
  // ainda assim o Tiny devolver bloqueio, tenta de novo com backoff. Os
  // dois juntos, não um ou outro — o limitador evita o bloqueio no caso
  // normal, o retry salva o sync quando a cota já estava consumida por
  // outra origem (o token é da conta inteira, não só do Kyneti).
  private async requestJson<T>(url: string, describe: string): Promise<T> {
    return withRetry(
      () => this.rateLimiter.schedule(() => this.fetchJsonWithTimeout<T>(url, describe)),
      {
        maxAttempts: 4,
        // Escalada longa de propósito: o bloqueio do Tiny é por JANELA DE
        // MINUTO ("aguarde alguns minutos e tente novamente"), não por
        // segundo. Backoff curto só queimaria as tentativas dentro da mesma
        // janela bloqueada; 10s → 30s → 60s atravessa a janela.
        backoffMs: [10_000, 30_000, 60_000],
        // Só re-tenta bloqueio de cota. Erro de token inválido ou payload
        // malformado não melhora com espera — re-tentar só atrasaria a
        // mensagem de erro real que o usuário precisa ver.
        shouldRetry: isRateLimitError,
      },
    );
  }

  async healthCheck(apiToken: string): Promise<boolean> {
    try {
      await this.pesquisarProdutos(apiToken, 1);
      return true;
    } catch {
      return false;
    }
  }

  async pesquisarProdutos(apiToken: string, pagina: number): Promise<{ produtos: OlistProductSummary[]; totalPaginas: number }> {
    const url = `${BASE_URL}/produtos.pesquisa.php?token=${encodeURIComponent(apiToken)}&formato=json&situacao=A&pagina=${pagina}`;
    const data = await this.requestJson<{
      retorno?: {
        status?: string;
        erros?: unknown[];
        numero_paginas?: number;
        produtos?: { produto: Record<string, unknown> }[];
      };
    }>(url, 'produtos.pesquisa.php');
    if (data.retorno?.status !== 'OK') {
      throw new Error(`Olist produtos.pesquisa.php retornou erro: ${JSON.stringify(data.retorno?.erros ?? data)}`);
    }
    const produtos = (data.retorno.produtos ?? []).map((p) => ({
      id: String(p.produto.id),
      codigo: String(p.produto.codigo ?? ''),
      nome: String(p.produto.nome ?? ''),
      situacao: String(p.produto.situacao ?? ''),
    }));
    return { produtos, totalPaginas: data.retorno.numero_paginas ?? 1 };
  }

  async obterProduto(apiToken: string, id: string): Promise<unknown> {
    const url = `${BASE_URL}/produto.obter.php?token=${encodeURIComponent(apiToken)}&formato=json&id=${encodeURIComponent(id)}`;
    const data = await this.requestJson<{ retorno?: { status?: string; erros?: unknown[]; produto?: unknown } }>(
      url,
      `produto.obter.php (id=${id})`,
    );
    if (data.retorno?.status !== 'OK' || !data.retorno.produto) {
      throw new Error(`Olist produto.obter.php retornou erro para id=${id}: ${JSON.stringify(data.retorno?.erros ?? data)}`);
    }
    return data.retorno.produto;
  }

  // Varre todas as páginas de produtos ativos e busca o detalhe completo de
  // cada um (a busca paginada não traz peso/dimensão/foto, só o detalhe traz).
  //
  // O `sleep(300)` fixo que existia aqui foi REMOVIDO em 02/08/2026: ele
  // rodava a 200 req/min contra um limite de 60 do plano base do Tiny, e era
  // a causa do "API Bloqueada" que impedia qualquer importação. O
  // espaçamento agora vem do RateLimiter em requestJson, que respeita a cota
  // configurada em vez de um número mágico.
  //
  // Falha de UM produto não derruba o lote (o catch já fazia isso) — mas
  // agora a contagem de falhas é devolvida junto, para o chamador conseguir
  // dizer ao usuário "importei 320 de 340" em vez de só um número solto.
  async fetchAllActiveProductDetails(apiToken: string): Promise<{ details: unknown[]; failedCount: number }> {
    const details: unknown[] = [];
    let failedCount = 0;
    let pagina = 1;
    let totalPaginas = 1;

    do {
      const { produtos, totalPaginas: total } = await this.pesquisarProdutos(apiToken, pagina);
      totalPaginas = total;
      for (const summary of produtos) {
        try {
          const detail = await this.obterProduto(apiToken, summary.id);
          details.push(detail);
        } catch (error) {
          failedCount++;
          this.logger.error(`Falha ao obter detalhe do produto ${summary.id} (${summary.codigo}): ${(error as Error).message}`);
        }
      }
      pagina++;
    } while (pagina <= totalPaginas);

    return { details, failedCount };
  }
}
