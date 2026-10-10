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
// Planos de criação de catálogo consultam o ML várias vezes por anúncio: 20s não basta.
const HEAVY_READ_TIMEOUT_MS = 90_000;

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

  // --- v3 (07/10/2026): Buy Box + Campanhas de catálogo do Mercado Livre ---
  // Substitui a rotina manual do Gui no Mercado Turbo. Leitura aqui; a
  // escrita (inscrever em campanha) fica abaixo, atrás de writesEnabled.
  server.registerTool(
    'kyneti_list_ml_catalog_items',
    {
      description:
        'Lista os anúncios de CATÁLOGO ativos do Mercado Livre da conta (a aba "Catálogo" do Mercado Turbo), com estoque, preço e SKU. Paginado. Fonte: GET /promotion-intelligence/mercado-livre/catalog/items.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Início da página (padrão 0)'),
        limit: z.number().int().min(1).max(100).optional().describe('Itens por página (padrão 50, máx. 100)'),
      },
    },
    async ({ offset, limit }) => {
      try {
        return toResult(await client.get('/promotion-intelligence/mercado-livre/catalog/items', { offset, limit }));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_plan_ml_catalog_campaigns',
    {
      description:
        'Planeja, para UM anúncio de catálogo do ML, em quais campanhas (Campanha do Vendedor e Tradicional: Outubro, Novembro, Dezembro, 10.10, 11.11...) entrar e a que preço. Regra: preço da buy box se a margem de contribuição ficar >= minMarginPct (padrão 5%); senão mantém o preço atual se der >= mínimo; senão não entra. Sem estoque = pula. Só leitura — não altera nada. Margem = preço − custo − imposto − tarifa ML − frete ML (igual ao Mercado Turbo). Fonte: GET /promotion-intelligence/mercado-livre/catalog/items/:itemId/plan.',
      inputSchema: {
        itemId: z.string().regex(/^MLB\d{6,15}$/).describe('Id do anúncio, ex.: MLB7393870900'),
        minMarginPct: z.number().min(0).max(100).optional().describe('Margem mínima em % (padrão 5)'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Alíquota de imposto em % para sobrescrever a calculada (ex.: 7.3)'),
      },
    },
    async ({ itemId, minMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.get(`/promotion-intelligence/mercado-livre/catalog/items/${encodeURIComponent(itemId)}/plan`, {
            minMarginPct,
            taxRatePct,
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- v4 (09/10/2026): criar anúncio de CATÁLOGO pelo EAN (leitura) ---
  // Ver docs/product/ml-catalogo-criar-por-ean.md. A criação (escrita) fica
  // abaixo, atrás de writesEnabled.
  server.registerTool(
    'kyneti_list_ml_traditional_items',
    {
      description:
        'Lista os anúncios TRADICIONAIS ativos do Mercado Livre da conta (candidatos a ganhar anúncio de catálogo), com SKU, preço e se já existe catálogo ativo com o mesmo SKU. Paginado. Só leitura. Fonte: GET /promotion-intelligence/mercado-livre/catalog-creation/traditional-items.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Início da página (padrão 0)'),
        limit: z.number().int().min(1).max(100).optional().describe('Itens por página (padrão 50, máx. 100)'),
      },
    },
    async ({ offset, limit }) => {
      try {
        return toResult(await client.get('/promotion-intelligence/mercado-livre/catalog-creation/traditional-items', { offset, limit }));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_plan_ml_catalog_creation',
    {
      description:
        'Planeja a criação de um anúncio de CATÁLOGO a partir de UM anúncio tradicional: lê o EAN do tradicional, acha a ficha de catálogo, e calcula o menor preço com a margem alvo (padrão 40%) sobre custo + imposto + tarifa + frete. Estoque inicial 1 e SKU do produto. Só leitura — não cria nada. Devolve erro 422 com o motivo quando não dá (sem EAN, sem ficha, mais de uma ficha, sem SKU, sem custo). Fonte: GET /promotion-intelligence/mercado-livre/catalog-creation/items/:itemId/plan.',
      inputSchema: {
        itemId: z.string().regex(/^MLB\d{6,15}$/).describe('Id do anúncio TRADICIONAL de origem, ex.: MLB7393870900'),
        variationId: z.string().regex(/^\d{1,20}$/).optional().describe('Id da variação. Obrigatório quando o anúncio tem variações (cada variação gera o SEU catálogo, pelo EAN dela)'),
        targetMarginPct: z.number().min(5).max(99).optional().describe('Margem alvo em % (padrão 40)'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Alíquota de imposto em % para sobrescrever a calculada (ex.: 7.3)'),
      },
    },
    async ({ itemId, variationId, targetMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.get(`/promotion-intelligence/mercado-livre/catalog-creation/items/${encodeURIComponent(itemId)}/plan`, {
            variationId,
            targetMarginPct,
            taxRatePct,
          }, HEAVY_READ_TIMEOUT_MS),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_plan_ml_catalog_creation_variations',
    {
      description:
        'Planeja a criação de catálogo de TODAS as variações de um anúncio tradicional de uma vez: uma linha por variação (variationId, SKU, EAN, ficha, preço, margem) ou o motivo de não dar (sem EAN, sem ficha, sem custo...). Só leitura. Fonte: GET /promotion-intelligence/mercado-livre/catalog-creation/items/:itemId/variations/plan.',
      inputSchema: {
        itemId: z.string().regex(/^MLB\d{6,15}$/).describe('Id do anúncio TRADICIONAL com variações, ex.: MLB6223019912'),
        targetMarginPct: z.number().min(5).max(99).optional().describe('Margem alvo em % (padrão 40)'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Alíquota de imposto em % para sobrescrever a calculada (ex.: 7.3)'),
      },
    },
    async ({ itemId, targetMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.get(`/promotion-intelligence/mercado-livre/catalog-creation/items/${encodeURIComponent(itemId)}/variations/plan`, {
            targetMarginPct,
            taxRatePct,
          }, HEAVY_READ_TIMEOUT_MS),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'kyneti_plan_ml_catalog_creation_batch',
    {
      description:
        'Plano em LOTE (só leitura) do que falta ter catálogo, POR EAN: percorre uma página dos anúncios tradicionais ativos e, para cada anúncio simples ou variação, devolve status READY (pode criar; traz preço e margem), ALREADY_HAS_CATALOG (a conta já tem catálogo da ficha) ou BLOCKED (com o motivo: sem EAN, sem ficha, sem SKU, sem custo...). Página pequena (máx. 5 anúncios; cada um faz várias chamadas ao ML) — chame uma página por vez, aumentando offset até cobrir total. Substitui a lista "sem catálogo" do Mercado Turbo. Fonte: GET /promotion-intelligence/mercado-livre/catalog-creation/plan-batch.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Início da página (padrão 0)'),
        limit: z.number().int().min(1).max(5).optional().describe('Anúncios por página (padrão 3, máx. 5)'),
        targetMarginPct: z.number().min(5).max(99).optional().describe('Margem alvo em % (padrão 40)'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Alíquota de imposto em % para sobrescrever a calculada'),
      },
    },
    async ({ offset, limit, targetMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.get('/promotion-intelligence/mercado-livre/catalog-creation/plan-batch', { offset, limit, targetMarginPct, taxRatePct }, HEAVY_READ_TIMEOUT_MS),
        );
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

  // --- v3: inscrever anúncio em campanha do ML (ESCRITA real) ---
  // Mesmas camadas da escrita de SKU (RBAC PRICING_EDITOR + MCP_ALLOW_WRITES
  // + confirm:true). O backend recalcula a margem e recusa abaixo do mínimo.
  server.registerTool(
    'kyneti_join_ml_promotion',
    {
      description:
        'ESCREVE no Mercado Livre real: inscreve um anúncio numa campanha (SELLER_CAMPAIGN ou DEAL) com o preço promocional informado. Use kyneti_plan_ml_catalog_campaigns antes e passe o plannedPrice de uma campanha com action JOIN. O servidor recalcula a margem e recusa se ficar abaixo de minMarginPct (padrão 5%), se o preço estiver fora da faixa da campanha, se o item estiver sem estoque ou já participar. Exige confirm:true. Fonte: POST /promotion-intelligence/mercado-livre/catalog/items/:itemId/promotions.',
      inputSchema: {
        itemId: z.string().regex(/^MLB\d{6,15}$/).describe('Id do anúncio, ex.: MLB7393870900'),
        promotionId: z.string().min(1).max(64).describe('promotionId vindo do plano'),
        dealPrice: z.number().positive().describe('Preço promocional (plannedPrice do plano)'),
        minMarginPct: z.number().min(0).max(100).optional().describe('Margem mínima em % (padrão 5)'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Mesma alíquota usada no plano, se foi sobrescrita'),
        confirm: z.literal(true).describe('Precisa ser exatamente true — escrita real e intencional em produção.'),
      },
    },
    async ({ itemId, promotionId, dealPrice, minMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.post(`/promotion-intelligence/mercado-livre/catalog/items/${encodeURIComponent(itemId)}/promotions`, {
            promotionId,
            dealPrice,
            ...(minMarginPct !== undefined ? { minMarginPct } : {}),
            ...(taxRatePct !== undefined ? { taxRatePct } : {}),
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- v4: criar anúncio de catálogo pelo EAN (ESCRITA real) ---
  // Mesmas camadas: RBAC (ADMIN/PRICING_EDITOR) + MCP_ALLOW_WRITES + confirm:true
  // + flag ML_CATALOG_LISTING_CREATE_ENABLED na API. UM anúncio por chamada.
  server.registerTool(
    'kyneti_create_ml_catalog_listing',
    {
      description:
        'ESCREVE no Mercado Livre real: cria UM anúncio de catálogo (ficha do EAN do tradicional de origem), com estoque 1, SKU do produto e o preço que dá a margem alvo. Rode kyneti_plan_ml_catalog_creation antes e só crie com a confirmação explícita do dono. O servidor recalcula tudo, recusa se já existir catálogo ativo com o mesmo SKU/ficha e não repete a chamada em timeout. Exige confirm:true. Fonte: POST /promotion-intelligence/mercado-livre/catalog-creation/items/:itemId/create.',
      inputSchema: {
        itemId: z.string().regex(/^MLB\d{6,15}$/).describe('Id do anúncio TRADICIONAL de origem, ex.: MLB7393870900'),
        variationId: z.string().regex(/^\d{1,20}$/).optional().describe('Id da variação (obrigatório se o anúncio tem variações): cria o catálogo DESTA variação'),
        targetMarginPct: z.number().min(5).max(99).optional().describe('Margem alvo em % (padrão 40) — a mesma do plano'),
        taxRatePct: z.number().min(0).max(99.99).optional().describe('Mesma alíquota usada no plano, se foi sobrescrita'),
        confirm: z.literal(true).describe('Precisa ser exatamente true — escrita real e intencional em produção.'),
      },
    },
    async ({ itemId, variationId, targetMarginPct, taxRatePct }) => {
      try {
        return toResult(
          await client.post(`/promotion-intelligence/mercado-livre/catalog-creation/items/${encodeURIComponent(itemId)}/create`, {
            ...(variationId !== undefined ? { variationId } : {}),
            ...(targetMarginPct !== undefined ? { targetMarginPct } : {}),
            ...(taxRatePct !== undefined ? { taxRatePct } : {}),
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  // --- v5: cadastrar o MAP (preço mínimo da marca) de UM SKU (ESCRITA no Kyneti) ---
  // Não escreve em marketplace: grava Product.mapPrice no próprio Kyneti pelo
  // mesmo PATCH /products/:id da tela (RBAC ADMIN/PRICING_EDITOR + módulo
  // CATALOG), então a trilha de auditoria (ProductAuditLog) registra o usuário
  // do MCP, o valor anterior e o novo. Um SKU por chamada, de propósito.
  server.registerTool(
    'kyneti_set_product_map_price',
    {
      description:
        'ESCREVE no Kyneti (não no marketplace): define o MAP — preço mínimo anunciado pela marca — de UM SKU, ou limpa com mapPrice null. Só use com o valor informado pelo dono (tabela do fornecedor); nunca estime. Devolve o valor anterior e o novo. A mudança entra na trilha de auditoria do produto. Exige confirm:true. Fonte: PATCH /products/:id.',
      inputSchema: {
        skuCode: z.string().min(1).max(70).describe('SKU exato no Kyneti, ex.: RM0026-9'),
        mapPrice: z.number().positive().nullable().describe('Preço mínimo em R$ (ex.: 89.9) ou null para limpar o MAP do SKU'),
        confirm: z.literal(true).describe('Precisa ser exatamente true — escrita real e intencional em produção.'),
      },
    },
    async ({ skuCode, mapPrice }) => {
      try {
        const products = (await client.get('/products')) as Array<{ id: string; skuCode: string; mapPrice?: number | string | null }>;
        const matches = products.filter((p) => p.skuCode === skuCode);
        if (matches.length !== 1) {
          throw new Error(
            matches.length === 0
              ? `SKU ${skuCode} não existe no catálogo do Kyneti — nada foi gravado.`
              : `SKU ${skuCode} aparece ${matches.length} vezes no catálogo — nada foi gravado.`,
          );
        }
        const product = matches[0];
        const before = product.mapPrice ?? null;
        const updated = (await client.patch(`/products/${encodeURIComponent(product.id)}`, { mapPrice })) as { mapPrice?: number | string | null };
        return toResult({ skuCode, mapPriceBefore: before, mapPriceAfter: updated.mapPrice ?? null });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
