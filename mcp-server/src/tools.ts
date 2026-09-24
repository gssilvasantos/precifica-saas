import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KyneteClient, KyneteApiError } from './kyneti-client';

/**
 * v1 (18/09/2026) — somente leitura. Cada ferramenta de leitura é um GET que
 * já existe na API do Kyneti, com o mesmo contrato de query params dos
 * controllers (ver apps/api/src/modules/<módulo>/interface/controllers/<nome>.controller.ts).
 *
 * v2 (24/09/2026, a pedido do Gui: "e se criarmos um mcp com o mercado
 * livre... leitura e escrita") — acrescenta DUAS ferramentas de Mercado
 * Livre (kyneti_get_mercado_livre_item, leitura; e
 * kyneti_update_mercado_livre_item_sku, ESCREVE de volta no Mercado Livre
 * real). Tudo o resto continua só leitura — nenhuma ferramenta de v1 virou
 * escrita, e a nova ferramenta de escrita é a ÚNICA deste servidor.
 *
 * Duas camadas independentes protegem a escrita (defesa em profundidade,
 * nenhuma delas sozinha é suficiente):
 *   1. RBAC do próprio Kyneti — o endpoint que ela chama
 *      (PATCH /marketplace-intelligence/mercado-livre/items/:id/sku) exige
 *      papel ADMIN ou PRICING_EDITOR; a conta de serviço deste MCP é VIEWER
 *      por padrão (ver README "Passo 1") e precisa ser promovida
 *      deliberadamente por você na tela de Equipe do Kyneti.
 *   2. writesEnabled (env var MCP_ALLOW_WRITES no Render, ver .env.example)
 *      — com a variável ausente/false, a ferramenta de escrita nem é
 *      REGISTRADA no servidor MCP (não aparece pra nenhuma sessão de
 *      Claude, em nenhum tenant), independente do papel da conta de
 *      serviço no Kyneti.
 */

function toResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toErrorResult(error: unknown) {
  const message = error instanceof KyneteApiError ? error.message : `Erro inesperado: ${(error as Error).message}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

// Usa registerTool (config-object) em vez de tool(name, desc, shape, cb):
// com este SDK (@modelcontextprotocol/sdk 1.30.0) + TS 5.9, as sobrecargas
// de tool() disparam "TS2589: Type instantiation is excessively deep" de
// forma inconsistente entre ferramentas de shape aparentemente idêntico
// (bug de resolução de overload, não do nosso código — confirmado rodando
// tsc: kyneti_get_pricing_decision e kyneti_list_orders falhavam,
// kyneti_get_order_margin e kyneti_get_financial_dre, com shapes
// equivalentes, não). registerTool tem uma única assinatura e não sofre
// disso.
export function registerKynetiTools(server: McpServer, client: KyneteClient, writesEnabled: boolean): void {
  server.registerTool(
    'kyneti_list_products',
    { description: 'Lista todo o catálogo de produtos do tenant (SKU, nome, custo, margem-alvo). Fonte: GET /products.' },
    async () => {
      try {
        return toResult(await client.get('/products'));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_get_pricing_decision',
    {
      description:
        'Retorna a decisão/recomendação de preço já calculada para um SKU (regra de margem vs. sinal de concorrência). Fonte: GET /pricing-intelligence/decisions/:skuCode.',
      inputSchema: { skuCode: z.string().min(1).describe('Código do SKU no Kyneti, ex.: RM0299-1') },
    },
    async ({ skuCode }) => {
      try {
        return toResult(await client.get(`/pricing-intelligence/decisions/${encodeURIComponent(skuCode)}`));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_list_competitive_opportunities',
    {
      description:
        'Lista oportunidades de precificação por concorrência (ex.: perdeu buy-box, margem de sobra) apontadas pelo radar. Fonte: GET /competition-intelligence/opportunities.',
    },
    async () => {
      try {
        return toResult(await client.get('/competition-intelligence/opportunities'));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_list_monitored_listings',
    {
      description:
        'Lista os anúncios de concorrentes atualmente monitorados pelo radar de competição. Fonte: GET /competition-intelligence/monitored-listings.',
    },
    async () => {
      try {
        return toResult(await client.get('/competition-intelligence/monitored-listings'));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_list_orders',
    {
      description: 'Lista pedidos com filtros de canal, status e período (paginado). Fonte: GET /orders.',
      inputSchema: {
        channelCode: z.string().optional().describe('Ex.: MERCADO_LIVRE, SHOPEE, NUVEMSHOP'),
        status: z.string().optional().describe('Status do pedido no Kyneti'),
        dateFrom: z.string().optional().describe('Data inicial, formato ISO (YYYY-MM-DD)'),
        dateTo: z.string().optional().describe('Data final, formato ISO (YYYY-MM-DD)'),
        page: z.number().int().positive().optional().default(1),
        pageSize: z.number().int().positive().max(200).optional().default(50),
        mode: z.string().optional().describe('Modo de dado (real/demo) — ver AppDataMode'),
      },
    },
    async (params) => {
      try {
        return toResult(await client.get('/orders', params));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_order_status_counts',
    {
      description:
        'Conta pedidos por status (para as abas Em aberto, Preparando envio, Faturado, Enviado, Entregue). Fonte: GET /orders/status-counts.',
      inputSchema: {
        mode: z.string().optional(),
        channelCode: z.string().optional(),
      },
    },
    async (params) => {
      try {
        return toResult(await client.get('/orders/status-counts', params));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_get_order_margin',
    {
      description: 'Retorna a margem real (por item + agregada) de um pedido específico. Fonte: GET /orders/:id/margin.',
      inputSchema: { orderId: z.string().min(1).describe('ID do pedido no Kyneti') },
    },
    async ({ orderId }) => {
      try {
        return toResult(await client.get(`/orders/${encodeURIComponent(orderId)}/margin`));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_list_channel_listings',
    {
      description:
        'Lista os anúncios (ChannelListing) sincronizados de cada canal, vinculados por SKU. Fonte: GET /erp-integration/channel-listings.',
    },
    async () => {
      try {
        return toResult(await client.get('/erp-integration/channel-listings'));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_get_olist_status',
    { description: 'Status da conexão/sincronização com o ERP Olist (última sync, saúde). Fonte: GET /erp-integration/olist/status.' },
    async () => {
      try {
        return toResult(await client.get('/erp-integration/olist/status'));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_get_financial_dre',
    {
      description: 'Gera o DRE (relatório de lucratividade) por canal para um período. Fonte: GET /financial-intelligence/dre.',
      inputSchema: {
        dateFrom: z.string().optional().describe('Data inicial, formato ISO (YYYY-MM-DD)'),
        dateTo: z.string().optional().describe('Data final, formato ISO (YYYY-MM-DD)'),
        mode: z.string().optional().describe('Modo de dado (real/demo)'),
      },
    },
    async (params) => {
      try {
        return toResult(await client.get('/financial-intelligence/dre', params));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- v2: Mercado Livre — leitura de anúncio individual ---
  //
  // Complementa kyneti_list_channel_listings (que só mostra anúncios JÁ
  // vinculados a um SKU): esta consulta um anúncio ESPECÍFICO direto no
  // Mercado Livre pelo id (MLB...), inclusive os `attributes` crus — é o
  // jeito de investigar um anúncio "órfão" (sem SKU vinculado, ver os logs
  // "sem SKU vinculado — Título: ..." do sync automático) antes de decidir
  // o SKU certo pra ele.
  server.registerTool(
    'kyneti_get_mercado_livre_item',
    {
      description:
        'Consulta um anúncio específico direto no Mercado Livre pelo id (ex.: MLB123456789) — título, preço, status, se é anúncio de catálogo (isCatalogListing/catalogProductId) e os atributos crus (inclusive SELLER_SKU, se já tiver). Só leitura. Fonte: GET /marketplace-intelligence/mercado-livre/items/:itemId.',
      inputSchema: { itemId: z.string().min(1).describe('Id do anúncio no Mercado Livre, ex.: MLB123456789') },
    },
    async ({ itemId }) => {
      try {
        return toResult(await client.get(`/marketplace-intelligence/mercado-livre/items/${encodeURIComponent(itemId)}`));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  if (!writesEnabled) return;

  // --- v2: Mercado Livre — ESCRITA real no anúncio (SELLER_SKU) ---
  //
  // ÚNICA ferramenta de escrita deste servidor. Registrada só quando
  // writesEnabled (env var MCP_ALLOW_WRITES) é true — ver aviso de
  // arquitetura no topo do arquivo para as duas camadas de proteção. Ainda
  // assim exige confirm:true explícito no CHAMADO (terceira camada, mais
  // barata de todas: obriga quem invoca — uma sessão de Claude — a
  // deliberadamente afirmar que quer escrever, nunca um efeito colateral de
  // uma leitura ambígua).
  server.registerTool(
    'kyneti_update_mercado_livre_item_sku',
    {
      description:
        'ESCREVE no Mercado Livre real: define o SKU do vendedor (SELLER_SKU) de um anúncio específico. Use kyneti_get_mercado_livre_item primeiro para confirmar o item certo (título, SKU atual) antes de chamar isto — é uma mudança real na loja de produção, não reversível automaticamente. Exige confirm:true. Fonte: PATCH /marketplace-intelligence/mercado-livre/items/:itemId/sku.',
      inputSchema: {
        itemId: z.string().min(1).describe('Id do anúncio no Mercado Livre, ex.: MLB123456789'),
        skuCode: z.string().min(1).max(70).describe('Novo SKU a gravar no anúncio (SELLER_SKU)'),
        confirm: z
          .literal(true)
          .describe('Precisa ser exatamente true — confirmação explícita de que esta é uma escrita real e intencional em produção.'),
      },
    },
    async ({ itemId, skuCode }) => {
      try {
        return toResult(
          await client.patch(`/marketplace-intelligence/mercado-livre/items/${encodeURIComponent(itemId)}/sku`, { skuCode }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
