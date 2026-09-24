# Kyneti MCP Server

Servidor MCP (Model Context Protocol) para a API do Kyneti. Expõe catálogo,
pricing, concorrência, pedidos, integrações e financeiro como ferramentas
que uma sessão de Claude autorizada pode chamar, em vez de eu (Claude) ler
direto do banco via Supabase — aqui a chamada passa pela mesma autorização e
regra de negócio que o próprio app usa.

**v1 (18/09/2026) era 100% leitura.** **v2 (24/09/2026, a pedido do Gui)**
acrescenta Mercado Livre: uma ferramenta de leitura de anúncio individual, e
UMA ferramenta de escrita real (`kyneti_update_mercado_livre_item_sku`) —
grava o SKU do vendedor (SELLER_SKU) direto num anúncio do Mercado Livre.
Ela é desligada por padrão (ver "Ativando a escrita (v2)" abaixo) e continua
sendo a única ferramenta de escrita deste servidor — todo o resto permanece
só leitura.

## Por que existe

A API do Kyneti não tem mecanismo de API key — só login com e-mail/senha
(`POST /auth/login`), que devolve um JWT de 8h sem refresh token
(`apps/api/src/modules/identity-access`, inspecionado em 18/09/2026). Este
serviço guarda as credenciais de uma conta de serviço dedicada e faz login
de novo automaticamente antes do token expirar — nenhuma outra parte do
sistema precisa saber disso.

## Duas coisas que só você (Gui) pode fazer

Eu não crio contas nem manipulo senhas — isso é intencional, é uma regra de
segurança meta, não só do projeto. Faltam exatamente dois passos, os dois
fora deste chat:

### Passo 1 — Criar a conta de serviço no próprio Kyneti

No painel **Equipe** do Kyneti (logado como admin da Rita Mazzei Beauty):

1. Crie um usuário novo, com um e-mail dedicado (ex.:
   `mcp-readonly@ritamazzeibeauty.com` ou qualquer e-mail que você controle —
   não precisa ser real, só precisa existir no Kyneti).
2. Papel: **VIEWER** (somente leitura — nunca dê ADMIN pra essa conta).
   Suficiente para todas as ferramentas de leitura, inclusive
   `kyneti_get_mercado_livre_item`. Só a escrita (Passo abaixo) exige mais.
3. Módulos concedidos: `CATALOG`, `ORDERS`, `INTEGRATIONS`, `FINANCE` — são
   os módulos que as ferramentas abaixo usam. Não marque `ADS`,
   `PROMOTIONS`, `REPLENISHMENT`, `CONFERENCE` nem `FISCAL_SETTINGS`, essa
   conta não precisa deles.
4. Escolha uma senha forte só sua. Guarde-a — você vai usá-la no Passo 2.

### Ativando a escrita (v2) — dois passos deliberados, os dois só você faz

A ferramenta `kyneti_update_mercado_livre_item_sku` grava direto na loja
real do Mercado Livre. Por isso ela exige DUAS mudanças independentes, além
do `confirm:true` que a própria sessão de Claude precisa passar em toda
chamada — nenhuma das duas sozinha liga a escrita:

1. **No Kyneti**: promova a conta de serviço criada no Passo 1 de **VIEWER**
   para **PRICING_EDITOR** na tela de Equipe (mesma tela, botão de editar o
   membro). `PRICING_EDITOR` continua sem acesso a nada de ADMIN (times,
   billing, etc.) — só ganha permissão de escrever nos módulos já
   concedidos, incluindo Integrações.
2. **No Render**: adicione a variável de ambiente `MCP_ALLOW_WRITES=true`
   no serviço `kyneti-mcp-server` (painel → Environment). Sem essa
   variável (ou com qualquer valor diferente de `true`), o servidor nem
   REGISTRA a ferramenta de escrita — ela não aparece pra nenhuma sessão de
   Claude, mesmo que a conta de serviço já seja PRICING_EDITOR.

Enquanto qualquer um dos dois passos não for feito, o servidor continua
100% leitura — pode fazer o deploy deste código sem risco, a escrita só
liga quando você decidir ligar os dois interruptores.

### Passo 2 — Configurar as variáveis de ambiente no Render

Depois que eu criar o serviço no Render (`kyneti-mcp-server`), abra o painel
dele → **Environment** e adicione, **direto lá, nunca aqui no chat**:

| Variável | Valor |
|---|---|
| `KYNETI_SERVICE_EMAIL` | o e-mail que você criou no Passo 1 |
| `KYNETI_SERVICE_PASSWORD` | a senha que você criou no Passo 1 |

As outras variáveis (`KYNETI_API_BASE_URL`, `MCP_SHARED_SECRET`,
`KYNETI_SERVICE_TENANT_ID`) eu já configuro ao criar o serviço — ver
`.env.example` para o que cada uma faz.

## Passo 3 — Registrar como conector no Claude

Nas configurações de conectores do Claude (Settings → Connectors → Add
custom connector):

- **URL**: `https://<nome-do-servico>.onrender.com/mcp` (eu te passo a URL
  exata depois do deploy).
- **Autenticação**: o cabeçalho `Authorization: Bearer <MCP_SHARED_SECRET>`
  — eu te passo esse valor separadamente (não é senha de conta nenhuma, é um
  segredo que eu gero só pra proteger esse servidor).

Se a tela de conector customizado do Claude só aceitar OAuth (alguns
conectores remotos exigem), me avisa que a gente ajusta — pode precisar de
uma camada extra na frente. Vamos confirmar isso juntos depois do deploy.

## Ferramentas (v1)

| Ferramenta | Endpoint | O que retorna |
|---|---|---|
| `kyneti_list_products` | `GET /products` | Catálogo completo do tenant |
| `kyneti_get_pricing_decision` | `GET /pricing-intelligence/decisions/:skuCode` | Recomendação de preço calculada para um SKU |
| `kyneti_list_competitive_opportunities` | `GET /competition-intelligence/opportunities` | Oportunidades de precificação por concorrência |
| `kyneti_list_monitored_listings` | `GET /competition-intelligence/monitored-listings` | Anúncios de concorrentes monitorados |
| `kyneti_list_orders` | `GET /orders` | Pedidos, com filtro de canal/status/período |
| `kyneti_order_status_counts` | `GET /orders/status-counts` | Contagem de pedidos por status |
| `kyneti_get_order_margin` | `GET /orders/:id/margin` | Margem real de um pedido |
| `kyneti_list_channel_listings` | `GET /erp-integration/channel-listings` | Anúncios sincronizados por canal |
| `kyneti_get_olist_status` | `GET /erp-integration/olist/status` | Saúde da sincronização com o ERP Olist |
| `kyneti_get_financial_dre` | `GET /financial-intelligence/dre` | DRE por canal e período |
| `kyneti_get_mercado_livre_item` | `GET /marketplace-intelligence/mercado-livre/items/:itemId` | Anúncio específico do Mercado Livre por id (título, preço, status, se é anúncio de catálogo, atributos crus) |

## Ferramentas (v2 — escrita, desligada por padrão)

| Ferramenta | Endpoint | O que faz |
|---|---|---|
| `kyneti_update_mercado_livre_item_sku` | `PATCH /marketplace-intelligence/mercado-livre/items/:itemId/sku` | **Escreve** o SKU do vendedor (SELLER_SKU) direto num anúncio real do Mercado Livre. Exige `confirm:true` na chamada — ver "Ativando a escrita (v2)". |

## Rodando local

```bash
npm install
cp .env.example .env   # preencha os valores, nunca commite o .env
npm run dev
```

## Deploy

Serviço Node standalone (não é NestJS, não faz parte de `apps/api` nem
`apps/web` — roda isolado, com seu próprio `package.json`). No Render:
Build Command `npm install && npm run build`, Start Command `npm start`,
Root Directory `mcp-server`.

## Limitações conhecidas (18/09/2026)

- Sem refresh token na API do Kyneti: se a conta de serviço tiver a senha
  trocada ou for desativada, o serviço para de autenticar até alguém
  corrigir a variável de ambiente no Render.
- Modo stateless (cada chamada MCP abre e fecha sua própria sessão) — não
  há suporte a subscriptions/streaming de eventos, só request/response.
- Filtros de `kyneti_list_orders` e `kyneti_get_financial_dre` espelham
  exatamente os query params dos controllers reais — não inventam nada além
  do que a API já aceita.
- `kyneti_update_mercado_livre_item_sku` (v2) só grava o atributo
  SELLER_SKU — não cria anúncio, não altera preço, não altera categoria nem
  nenhum outro atributo. Uma escrita malsucedida (SKU errado) não tem
  "desfazer" automático: corrige-se chamando a mesma ferramenta de novo com
  o SKU certo.
