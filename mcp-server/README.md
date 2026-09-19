# Kyneti MCP Server

Servidor MCP (Model Context Protocol) somente-leitura para a API do Kyneti.
Expõe catálogo, pricing, concorrência, pedidos, integrações e financeiro como
ferramentas que uma sessão de Claude autorizada pode chamar, em vez de eu
(Claude) ler direto do banco via Supabase — aqui a chamada passa pela mesma
autorização e regra de negócio que o próprio app usa.

**v1 é 100% leitura.** Nenhuma ferramenta aplica preço, altera pedido, ou
escreve em produção. Ações de escrita ficam para uma v2 deliberada.

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
3. Módulos concedidos: `CATALOG`, `ORDERS`, `INTEGRATIONS`, `FINANCE` — são
   os módulos que as 10 ferramentas abaixo usam. Não marque `ADS`,
   `PROMOTIONS`, `REPLENISHMENT`, `CONFERENCE` nem `FISCAL_SETTINGS`, essa
   conta não precisa deles.
4. Escolha uma senha forte só sua. Guarde-a — você vai usá-la no Passo 2.

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
