# Expedição em lote — agrupamento de pedidos (Fase 5, benchmark Tiny ERP)

Ver `docs/tiny-erp-benchmark-analysis.md`, seção 1.7/seção 5, para o achado
original (tela "Expedição" do ERP Olist) e a decisão de escopo tomada com o
usuário.

## 1. Por que estender `logistics_fulfillment`, não criar um módulo novo

A expedição em lote agrupa pedidos que **já passaram pelo Pick & Pack**
(`StockMovementAuditEvent` do tipo `RETAIL_SHIPMENT`, `conferenceStatus =
APROVADO`) e gera a etiqueta de envio para cada um. Isso é uma camada direta
acima de um conceito que já vive no Hub de Provas — mesmo racional de como a
Ordem de Compra (Fase 1) estendeu o mesmo Hub com `PURCHASE_RECEIPT` em vez de
abrir um caminho de escrita paralelo. Um `DispatchBatch` nunca decide sozinho
se um pedido pode ser expedido: ele delega a elegibilidade ao gate que já
existe (`canIncludeInDispatchBatch`, que reconsulta o mesmo
`StockMovementAuditEventRepository.findByOrderId`), preservando a auditoria
por pedido como pré-requisito — nunca substituída pelo lote.

O módulo novo que existe (`freight-shipping`) é uma peça deliberadamente
separada: conexões com transportadoras avulsas (Melhor Envio, Correios,
Frenet) não têm nenhuma relação com o domínio de fulfillment em si — são
credenciais de terceiros, mesmo racional de `erp-integration`/
`marketplace-intelligence` guardarem cada conexão de canal no módulo que a
introduziu.

## 2. `formaEnvio`: campo de texto livre, não um enum fechado

O usuário mostrou a tela "Expedição" do Olist (dropdown "Forma de envio")
mesclando três categorias bem diferentes num único campo:

- **Nativo do marketplace** — Mercado Envios, Shopee Envios, TikTok Shipping,
  Magalu Entregas, Amazon DBA;
- **Agregador/transportadora avulsa** — Correios, Frenet, Olist Envios, Nuvem
  Envio;
- **Organizacional, sem automação nenhuma** — Transportadora (própria),
  Retirar pessoalmente, Retirado no local, Motoboy.

Copiamos esse modelo: `DispatchBatch.formaEnvio` é `String` livre (armazenado
em maiúsculas), nunca um enum do Prisma — um enum fechado obrigaria uma
migração toda vez que o usuário quisesse adicionar uma transportadora nova ou
o Olist mudasse a lista. A tradução de `formaEnvio` para "o que fazer" é
inteiramente do domínio (`resolveLabelStrategy`, função pura, nunca lança):

| `formaEnvio` | Estratégia | Observação |
|---|---|---|
| `MERCADO_ENVIOS` | `NATIVE_MARKETPLACE` (canal `MERCADO_LIVRE`) | usa `ShippingLabelCapableProvider` |
| `SHOPEE_ENVIOS` | `NATIVE_MARKETPLACE` (canal `SHOPEE`) | idem |
| `CORREIOS` / `MELHOR_ENVIO` / `FRENET` | `GENERIC_FREIGHT` | usa `FreightLabelProvider` via `freight-shipping` |
| `TRANSPORTADORA`, `RETIRAR_PESSOALMENTE`, `RETIRADO_NO_LOCAL`, `MOTOBOY` | `NONE` | organizacional — conclui o lote sem gerar etiqueta |
| `OLIST_ENVIOS`, `NUVEM_ENVIO`, `TIKTOK_SHIPPING`, `MAGALU_ENTREGAS`, `AMAZON_DBA` | `NONE` | sem API pública de etiqueta conhecida (ver seção 5) |
| qualquer valor não mapeado | `NONE` | fallback seguro — nunca lança em forma de envio nova/digitada errado |

## 3. Dois caminhos de etiqueta (decisão do usuário via `AskUserQuestion`)

O usuário pediu explicitamente os dois caminhos, não um só: *"Deve conter
etiqueta via os marketplaces, cada marketplace tem a sua... bem como deve ter
outras opções para gerar etiquetas avulsas como melhor envio, olist envios,
frenet, correios."*

### 3.1 Nativo do marketplace — `ShippingLabelCapableProvider`

Nova capacidade de provider (`shared/contracts/marketplace-provider.contract.ts`),
mesmo padrão de Interface Segregation já usado para `ORDERS`/`PRICE_UPDATE`/
`ADS_ACTIONS`/`SHIPPING_LABEL` — anexada às classes de provider EXISTENTES
(`MercadoLivreOrderProvider`, `ShopeeOrderProvider`), nunca a classes novas,
porque reaproveita a mesma conexão/token já usada por `fetchOrders`. Resolução
via `OrderProviderRegistry.findByMarketplaceCode(canal).find(isShippingLabelCapable)`
— a mesma registry que já serve o `OrderSyncOrchestrator`, agora também
exportada por `OrdersModule` para o `DispatchBatchService` consumir.

- **Mercado Livre**: `getShippingLabel` busca `shipping.id` do pedido
  (`GET /orders/:id`), depois `tracking_number` (`GET /shipments/:id`), e monta
  a URL de impressão (`GET /shipment_labels?shipment_ids=...&response_type=pdf`
  — precisa do Bearer token do tenant para abrir, o frontend deve anexar o
  header, não é uma URL pública).
- **Shopee**: `getShippingLabel` dispara `create_shipping_document`, faz UM
  poll em `get_shipping_document_result` (sem retry/backoff — MVP consciente,
  ver gap na seção 6) e só devolve sucesso se o status já for `READY`;
  `download_shipping_document` exige assinatura HMAC sensível ao tempo, então
  o provider devolve o PATH, não uma URL já assinada.

### 3.2 Transportadora avulsa — `FreightLabelProvider` (`freight-shipping`)

Módulo novo com conexão por provider (`FreightProviderConnection`,
`@@unique([tenantId, providerCode])` — diferente do padrão singleton de
`FiscalSettings`, porque um tenant pode ter Melhor Envio E Correios
configurados ao mesmo tempo). Cada provider implementa
`FreightLabelProvider.generateLabel(tenantId, input)`, nunca lança — sempre
devolve `{ success, trackingCode?, labelUrl?, message? }`.

- **Melhor Envio** (`MELHOR_ENVIO`) — AVISO DE HONESTIDADE: construído a
  partir da documentação pública da API v2, nunca exercitado contra uma conta
  real. Fluxo de 4 passos (carrinho → checkout → gerar → imprimir); usa sempre
  `serviceId` configurado na conexão (default 1 = Correios PAC) — não cota
  entre serviços antes de gerar.
- **Correios** (`CORREIOS`) — AVISO DE HONESTIDADE: idem, API oficial v3
  (Autentica + Pré-postagem), nunca testado nem em homologação. Autentica via
  Basic → Bearer, cria a pré-postagem, baixa a etiqueta em base64 e devolve
  como `data:application/pdf;base64,...` (evita depender de upload/
  FileStorage no MVP).
- **Frenet** (`FRENET`) — Frenet é fundamentalmente um AGREGADOR DE COTAÇÃO;
  não existe endpoint público único e padronizado de emissão de etiqueta (cada
  transportadora contratada dentro do painel Frenet tem o seu). Por isso
  `FrenetFreightProvider.generateLabel` **sempre devolve `success: false`**,
  com a melhor cotação encontrada na mensagem — nunca finge automatizar uma
  emissão que a API não expõe.

O endereço estruturado do destinatário e o peso do pacote não existem em
nenhum canal hoje (nenhum provider normaliza nome/endereço — mesmo gap já
documentado em `docs/fiscal-nfe-architecture.md` para a NF-e), então
`GenerateLabelManualInput` exige que quem aciona a etiqueta avulsa informe
`recipientAddress` + `packageWeightKg` manualmente; sem isso o
`DispatchBatchService.generateLabel` marca erro sem tentar a chamada.

### 3.3 `avisoRecebimento`/`maoPropria`/`valorDeclarado` (Quick Win 6, benchmark Bling, 29/07/2026)

`docs/bling-erp-benchmark-analysis.md`, seção 1.6/2 — `LogisticasObjetosDadosDTO`
do Bling traz esses três campos como parte padrão de todo objeto de postagem.
`valorDeclarado` já existia no Kyneti desde a Fase 5 original (`declaredValue`
em `FreightLabelInput`); este quick win completa o trio com `avisoRecebimento`
(aviso de recebimento — confirmação por escrito de que o destinatário recebeu
a encomenda, exigido por alguns clientes/contratos B2B) e `maoPropria` (mão
própria — só o destinatário nomeado pode assinar, obrigatório para documentos/
produtos de valor). Os dois são opcionais em `GenerateLabelManualInput` (DTO
`GenerateDispatchLabelDto`) e propagados para `FreightLabelInput` — mas nem
todo provider expõe ambos de fato:

- **Melhor Envio** — a API v2 já documentava `receipt`/`own_hand` como opções
  do carrinho (hardcoded `false` antes deste quick win); agora refletem o que
  o operador pediu.
- **Correios** — enviados como `servicoAdicional: ["001", "002"]` na
  pré-postagem (códigos de Serviços Adicionais da documentação pública:
  "001" aviso de recebimento, "002" mão própria) — mesmo AVISO DE HONESTIDADE
  do resto do client, nunca exercitado contra uma conta real.
- **Frenet** — não recebe nenhum dos dois: `FrenetFreightProvider.generateLabel`
  nunca emite etiqueta de fato (seção 3.2), só cota — os campos ficariam sem
  uso nenhum se propagados até lá, por isso não foram adicionados ao
  `FrenetApiClient`.

## 4. Máquina de estados

`DispatchBatch.status`: `ABERTO → ETIQUETADO → DESPACHADO`, ou `CANCELADO` a
qualquer momento antes de `DESPACHADO`. `DispatchBatchOrder.status`:
`PENDENTE → ETIQUETADO`, ou `ERRO` (nunca trava o lote — o operador pode tentar
gerar de novo). Gates puros em `domain/dispatch-batch.entity.ts`:

- `canAddOrderToBatch` — lote precisa estar `ABERTO`; pedido não pode já estar
  em outro lote ativo (`ABERTO` ou `ETIQUETADO`).
- `canIncludeInDispatchBatch` — gate de elegibilidade central: exige
  `StockMovementAuditEvent` do tipo `RETAIL_SHIPMENT` já `APROVADO`.
- `canGenerateLabelForOrder` — rejeita se já `ETIQUETADO` (evita gerar
  duplicado sem remover antes).
- `canConcludeBatch` — formas `NONE` concluem mesmo com pedidos `PENDENTE`
  (nunca vão ganhar etiqueta); formas com estratégia real exigem que TODO
  pedido do lote esteja `ETIQUETADO`.
- `canCancelBatch` — rejeita lotes já `DESPACHADO`/`CANCELADO`.

`generateLabel` (aplicação) nunca lança em falha de provider — sempre grava
`markError`/`markLabeled` e devolve o link atualizado, permitindo retry sem
perder o resto do lote. Conclusão/cancelamento continuam sendo ações
explícitas do operador (`POST .../conclude`, `POST .../cancel`), mesma
filosofia de Safety Lock já usada em repricing/publicação de anúncio: nunca
automático, nunca agendado.

## 5. Gaps conhecidos (honestos, não escondidos)

- **Olist Envios, Nuvem Envio, TikTok Shipping, Magalu Entregas, Amazon DBA**
  — sem API pública de emissão de etiqueta descoberta (Olist Envios é interno
  ao próprio ERP Olist). Mapeados para `NONE`: o lote conclui sem etiqueta
  automática, o operador resolve fora do Kyneti.
- **Frenet** — quote-only por natureza do serviço (seção 3.2), não uma
  limitação de tempo/esforço.
- **Melhor Envio / Correios** — clients construídos só a partir de
  documentação pública, nunca validados contra conta real. Precisam de teste
  de handshake antes de qualquer uso em produção (mesmo processo já seguido
  para Mercado Livre/Shopee/Focus NFe).
- **Endereço estruturado do destinatário** — nenhum canal normaliza hoje;
  etiqueta avulsa depende de entrada manual por lote (seção 3.2). Resolver
  isso de vez exigiria estender `OrderFiscalData`/`Order` com campos de
  endereço — fora do escopo desta fase.
- **Shopee `getShippingLabel`** — um poll só, sem retry/backoff; se o
  documento não estiver pronto na primeira consulta, o operador precisa tentar
  de novo manualmente (mesmo padrão de retry manual que `canGenerateLabelForOrder`
  já permite).

## 6. Verificação

Testes: `domain/dispatch-batch.spec.ts` (estratégia + todos os gates),
`mercado-livre-order.provider.spec.ts`/`shopee-order.provider.spec.ts`
(`getShippingLabel`), `application/dispatch-batch.service.spec.ts`
(orquestração dos dois caminhos + gates), e um spec por provider de frete
(`melhor-envio-freight.provider.spec.ts`, `correios-freight.provider.spec.ts`,
`frenet-freight.provider.spec.ts`).
