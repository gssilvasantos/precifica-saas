import { Injectable, Logger } from '@nestjs/common';

const BASE_URL = 'https://api.tiny.com.br/api2';

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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Olist produtos.pesquisa.php retornou HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      retorno?: {
        status?: string;
        erros?: unknown[];
        numero_paginas?: number;
        produtos?: { produto: Record<string, unknown> }[];
      };
    };
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Olist produto.obter.php retornou HTTP ${response.status} para id=${id}`);
    }
    const data = (await response.json()) as { retorno?: { status?: string; erros?: unknown[]; produto?: unknown } };
    if (data.retorno?.status !== 'OK' || !data.retorno.produto) {
      throw new Error(`Olist produto.obter.php retornou erro para id=${id}: ${JSON.stringify(data.retorno?.erros ?? data)}`);
    }
    return data.retorno.produto;
  }

  // Varre todas as páginas de produtos ativos e busca o detalhe completo de
  // cada um (a busca paginada não traz peso/dimensão/foto, só o detalhe
  // traz). Pequeno intervalo entre chamadas de detalhe para não estourar o
  // rate limit por minuto da conta do tenant (60–240 req/min conforme
  // plano — ver seção 4 do doc de arquitetura).
  async fetchAllActiveProductDetails(apiToken: string): Promise<unknown[]> {
    const details: unknown[] = [];
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
          this.logger.error(`Falha ao obter detalhe do produto ${summary.id} (${summary.codigo}): ${(error as Error).message}`);
        }
        await sleep(300);
      }
      pagina++;
    } while (pagina <= totalPaginas);

    return details;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
