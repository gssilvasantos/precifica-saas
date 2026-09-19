import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KyneteClient, KyneteApiError } from './kyneti-client';

/**
 * v1 — somente leitura (18/09/2026). Cada ferramenta é um GET que já existe
 * na API do Kyneti, com o mesmo contrato de query params dos controllers
 * (ver apps/api/src/modules/<módulo>/interface/controllers/<nome>.controller.ts). Nada
 * aqui aplica preço, altera pedido ou escreve em produção — é só leitura.
 * Ações de escrita (aplicar reprecificação, reconectar integração, etc.)
 * ficam para uma v2 deliberada, com ferramentas próprias e mais restritas.
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
export function registerKynetiTools(server: McpServer, client: KyneteClient): void {
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
}
