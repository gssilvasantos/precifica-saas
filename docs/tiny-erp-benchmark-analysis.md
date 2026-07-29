# Benchmark Tiny ERP (Olist) x Kyneti — Parecer Técnico

**Autor:** análise de arquitetura, papel de CPO/Arquiteto de Software Sênior
**Base:** OpenAPI v3.1 do Tiny ERP (115 endpoints, ~180 schemas) comparado contra a arquitetura real do Kyneti (Catalog, Orders, Financial Intelligence, Logistics/Fulfillment, Promotions, MAP Governance, Pick & Pack, Ads)
**Objetivo:** apontar o que absorver, aperfeiçoar e descartar, com rotas e entidades reais dos dois lados.

---

## 1. O que ABSORVER (recursos de valor que o Kyneti ainda não tem)

### 1.1 Emissão de Nota Fiscal (NF-e) — o maior gap de todos — ✅ ABSORVIDO (28/07/2026, Fase 3)

Rotas do Tiny: `POST /notas/{idNota}/emitir`, `POST /notas/xml`, `POST /notas/xml/cancelar`, `POST /notas/{idNota}/despacho`, `POST /notas/{idNota}/lancar-contas`, `POST /notas/{idNota}/lancar-estoque`.

Hoje o Kyneti **não emite nota fiscal nenhuma** — só lê o que os marketplaces já faturaram (`fiscalResponsibility`, `buyerTaxId`, `invoiceNumber` em `RawOrderCandidate`, adicionados na Étapa 17 Q4, mas nunca preenchidos por nenhum provider ainda). Isso é uma parede dura pra qualquer vendedor que fatura fora do marketplace (venda direta pela Nuvemshop, por exemplo) — sem emissão de NF-e, o Kyneti não pode ser o sistema de venda completo, só uma camada de inteligência em cima de outro sistema que fatura.

**Por que importa:** é literalmente o motivo pelo qual ferramentas como Tiny/Bling existem e são pagas — SEFAZ exige NF-e para toda venda faturada no Brasil. Sem isso, o Kyneti nunca substitui o ERP do cliente, só complementa.

**Caminho realista:** não é reinventar o motor fiscal do zero (certificado digital A1, comunicação SEFAZ por estado, contingência) — é integrar com um provedor especializado (Focus NFe, eNotas, NFe.io) que expõe API REST simples. Vale menos esforço que parece, e destrava o produto pra concorrer de verdade com Tiny/Bling.

**Implementado:** schema Postgres próprio (`fiscal`) com `FiscalSettings` (singleton por tenant, dados do emitente + token Focus NFe criptografado, mesmo `CredentialEncryptionService` do Olist) e `FiscalInvoice` (append-only por tentativa, nunca sobrescrita — reemissão só é permitida em cima de uma tentativa anterior `ERRO`, nunca por cima de `PENDENTE`/`PROCESSANDO`/`AUTORIZADA`). Integração real com a Focus NFe (API v2, HTTP Basic Auth, ambientes homologação/produção) via `FocusNfeApiClient`. Defaults fixos de Simples Nacional para os códigos tributários (CST ICMS `102`, PIS/COFINS `07`, CFOP resolvido por UF emitente x destinatário) — decisão do usuário, MVP, válida só para lojistas de fato enquadrados no Simples Nacional. Emissão manual (`POST /fiscal/invoices/orders/:orderId/emit`, destinatário informado por quem chama) e auto-emissão opt-in (`FiscalSettings.autoEmitOnApproval`, escuta `ORDER_EVENTS.PAID`) — a auto-emissão hoje só emite um alerta operacional em vez de emitir de fato, porque `Order` ainda não guarda nome/endereço estruturado do comprador (gap documentado, não inventa dado fiscal). Item sem NCM cadastrado bloqueia a emissão inteira, nunca envia um código fiscal chutado. Webhook (`POST /fiscal/webhooks/focus-nfe`) e consulta manual (`POST /fiscal/invoices/:id/check-status`) atualizam o status da nota (PENDENTE/PROCESSANDO/AUTORIZADA/ERRO/CANCELADA). **Risco operacional registrado, não mitigado por código:** o usuário confirmou que já emite pelo Olist com o mesmo CNPJ — precisa configurar uma série de NF-e distinta no painel Focus NFe antes da primeira emissão real, ou haverá colisão de numeração na SEFAZ. Ver `docs/fiscal-nfe-architecture.md` para o desenho completo.

### 1.2 Expedição/Agrupamento — despacho em lote

Rotas: `POST /expedicao` (`CriarAgrupamentoRequestModel`: `idsNotasFiscais[]`, `idsPedidos[]`, `objetosAvulsos[]`), `POST /expedicao/{idAgrupamento}/origens`, `POST /expedicao/{idAgrupamento}/concluir`, `GET /expedicao/{idAgrupamento}/etiquetas`.

O Kyneti já tem uma esteira de expedição própria — o Pick & Pack (Sprint 26/27, com checklist bipado + vídeo obrigatório) — mas ela é **pedido a pedido**. O Tiny agrupa N pedidos/notas fiscais num único "agrupamento" e gera etiquetas de todos de uma vez, pra despachar um lote inteiro pra transportadora numa única operação.

**Por que importa:** operação com volume real (o Mercado Livre do próprio Guilherme já mostrou 300+ pedidos ativos num sync) não escala despachando um por um. Separar "auditoria por pedido" (o vídeo do Pick & Pack, que é um diferencial real do Kyneti) de "geração de etiqueta em lote" (o que falta) resolve os dois: mantém a prova em vídeo por pedido e ainda permite despachar 50 pedidos de uma vez pro Correios/transportadora.

### 1.3 Ordem de Compra — fechar o ciclo do `ReplenishmentAdvisor` — ✅ ABSORVIDO (28/07/2026, Fase 1)

Rotas: `GET/POST /ordem-compra`, `PUT /ordem-compra/{id}/situacao` (Aberto → Andamento → Atendido/Cancelado), `POST /ordem-compra/{id}/lancar-estoque`, `POST /ordem-compra/{id}/lancar-contas`.

O Kyneti já **sugere** reposição (`ReplenishmentAdvisorService`, Logistics Intelligence) mas não tinha nenhuma entidade pra registrar a ação de comprar — o lojista recebia a sugestão e fazia a compra fora do sistema, sem rastro. O Tiny modela isso como uma entidade completa: pedido de compra → item com `preco`/`ipi` → parcelas de pagamento → ao confirmar recebimento, lança estoque E contas a pagar automaticamente.

**Implementado:** schema Postgres próprio (`procurement`, ver racional em `prisma/schema.prisma`) com `PurchaseOrder`/`PurchaseOrderItem` — fornecedor e depósito de destino são referências soltas (validadas por tenant via `SUPPLIER_REPOSITORY`/`WAREHOUSE_REPOSITORY`). Situação `ABERTO → ANDAMENTO → ATENDIDO/CANCELADO`, nunca cancela a partir de `ATENDIDO`. `POST .../receber` (equivalente combinado de `lancar-estoque` + `lancar-contas` do Tiny) credita estoque via `StockReceiptWriter.receivePurchase` (Hub de Provas, novo tipo `PURCHASE_RECEIPT`, prova = número da NF em vez de mídia) e lança a conta a pagar do fornecedor via `AccountsPayableWriter.createSingle` (Financial Intelligence) — as duas únicas integrações cross-módulo, sempre por porta exportada, nunca pela classe concreta. Valor da conta vem de `computeTotalAmount` (função pura, soma `quantity*unitCost + ipi` por item, em centavos). Ver `docs/procurement-architecture.md` para o desenho completo.

**Por que importa:** é o fechamento natural do módulo de abastecimento que já existe — sem isso, o Kyneti parava na sugestão e perdia o rastro de "comprei, chegou, entrou no estoque, gerou uma conta a pagar".

### 1.4 Contas a Pagar — hoje só existe o lado "a receber" — ✅ ABSORVIDO (28/07/2026, Fase 1)

Rotas: `GET/POST /contas-pagar`, `POST /contas-pagar/{id}/marcadores`. Schema `CriarContaPagarRequestModel` com `ocorrencia` (Única/Semanal/Mensal/Trimestral/Parcelada) e `categoria` (plano de contas).

O Kyneti tem `FixedExpense` (despesa fixa) e `ReceivableRecord` (a receber, reconciliação de repasse) — mas não tem um módulo de contas a pagar de verdade, com fornecedor, vencimento, parcelamento e baixa. `FixedExpense` é estático demais pra isso.

**Implementado:** model `AccountsPayable` (schema `financial_intelligence`, mesmo bounded context de `ReceivableRecord`) — fornecedor (referência solta a `catalog.Supplier`, validada por tenant), `category` (texto livre), `dueDate`, `occurrence` (`UNICA`/`SEMANAL`/`MENSAL`/`TRIMESTRAL`/`PARCELADA` — `PARCELADA` gera N linhas com rateio de centavos via `buildInstallmentPlan`, função pura testada), baixa (`markPaid`, único caminho, idempotente, emite evento) e cancelamento. Status `OVERDUE` é derivado na leitura, nunca gravado. Tags: `TaggableEntityType` ganhou `ACCOUNTS_PAYABLE`, cobrindo o equivalente a `POST /contas-pagar/{id}/marcadores`. Ver `docs/financial-intelligence-architecture.md`, seção 9, para o desenho completo.

**Por que importa:** sem contas a pagar real, o DRE do Kyneti (que já é um diferencial forte — margem líquida por pedido) fica incompleto do lado de despesas variáveis (fornecedor, frete pago, imposto a recolher).

### 1.5 Lista de Preços com exceções — motor de atacado/canal ✅ ABSORVIDO (28/07/2026, Fase 2)

Schema: `ListaPrecoResponseModel` (`acrescimoDesconto` — um percentual aplicado sobre a tabela base) + `ExcecaoListaPrecoModel` (preço específico por produto, sobrepondo o percentual geral da lista).

O Kyneti precifica por regra de margem por SKU (`desiredMarginPct`/`minimumMarginPct`), mas não tem o conceito de "lista de preços nomeada" (ex.: "Atacado", "Revenda", "Black Friday") aplicável a um conjunto de produtos de uma vez, com exceções pontuais.

**Por que importa:** hoje, pra rodar uma campanha tipo "10% off em tudo, exceto X e Y", o lojista tem que editar produto por produto. Uma lista de preços com regra geral + exceção é ordens de magnitude mais rápido de operar.

**Implementado:** models `PriceList` (schema `catalog`, `name` + `adjustmentPct` — percentual único com sinal, positivo=acréscimo/negativo=desconto, ao contrário do par `acrescimoDesconto`+flag do Tiny) e `PriceListException` (FK real para `Product`, mesmo schema, `onDelete: Cascade`, `@@unique([priceListId, productId])` — upsert, nunca duplica). Função pura `resolveListPrice` (`domain/price-list.entity.ts`): exceção sempre vence sobre o percentual, mesmo racional do `ExcecaoListaPrecoModel`. `PriceListService.resolvePrice` recebe `basePrice` sempre por parâmetro — decisão deliberada de não integrar ainda com o motor de repricing (`PricingStrategist`), pois o Kyneti não tem preço canônico único por produto. Ver `docs/price-lists-architecture.md` para o desenho completo.

### 1.7 Publicação de produto em marketplace — achado posterior, via API v2 legada (não estava no swagger v3 enviado)

**✅ ABSORVIDO (29/07/2026, Fase 4).** Implementado como um novo módulo `marketplace-publishing`, seguindo a orientação do usuário de espelhar como o próprio ERP Olist/Tiny resolve o mapeamento de categoria (confirmado no artigo oficial da central de ajuda do Olist): árvore de categoria interna (`catalog.ProductCategory`, profundidade arbitrária, diferente da hierarquia de 1 nível de `Product.parentProductId`) com atributos herdáveis por categoria (`CategoryAttribute.extendToChildren`) + um passo SEPARADO de mapeamento categoria-interna↔categoria-do-canal (`ChannelCategoryMapping`) configurado via busca por texto livre na API do canal — nunca um dropdown gigante. `ListingPublicationService.publish` é a ação MANUAL (Safety Lock, mesmo racional das ações de escrita do módulo de Ads): resolve o produto, a categoria, os atributos efetivos (herdados + overrides do usuário) e roda o gate `canPublish` (nome, foto, peso, categoria mapeada, atributos obrigatórios do canal presentes) antes de qualquer chamada de rede; cada tentativa é uma linha nova em `ListingPublication` (append-only-por-tentativa, mesmo padrão de `FiscalInvoice`), nunca sobrescrita. Mercado Livre (`domain_discovery/search` + `POST /items`) e Shopee (`get_category`/`get_attributes` + `add_item`, com upload de imagem prévio via `media_space/upload_image`) implementados juntos, via duas novas capacidades de provider (`CategoryDiscoveryCapableProvider`/`ListingCreateCapableProvider`, Interface Segregation). Publicação bem-sucedida vincula o SKU ao anúncio em `ChannelListing` (nova porta `CHANNEL_LISTING_WRITER`, irmã de escrita de `CHANNEL_LISTING_READER`). Ver `docs/marketplace-listing-publish-architecture.md` para o desenho completo.

**Nota de proveniência:** este item não veio do `swagger.json` (API v3) analisado nas seções anteriores — o usuário perguntou explicitamente se esse fluxo existia, e uma nova pesquisa na documentação pública confirmou que ele está na **API v2 legada** do Tiny (`tiny.com.br/api-docs`, ainda ativa mas sem novas atualizações), não na v3. Fontes: [Webhooks envio de produtos](https://tiny.com.br/api-docs/api2-webhooks-envio-produtos), [Webhooks envio de preços](https://tiny.com.br/api-docs/api2-webhooks-envio-preco-produtos), [exemplo de payload real](https://tiny.com.br/api-docs/files/webhook-produto.json).

**Mecanismo real (webhook síncrono, não REST pull):**

1. O vendedor cadastra o produto no Tiny normalmente (mesmo cadastro da seção 1.1-2.1).
2. Na tela de Integrações, o vendedor aciona manualmente "enviar produtos para o e-commerce" — ação em lote, mas cada produto é despachado como uma notificação individual.
3. O Tiny **envia** (webhook síncrono — a chamada HTTP fica esperando a resposta) o payload completo do produto pra URL cadastrada pelo integrador (o app do marketplace/plataforma).
4. Quem recebe é responsável por criar o anúncio de fato no canal de destino e **devolver, na mesma resposta HTTP 200**, um mapeamento `idMapeamento` (ID do produto no Tiny) ↔ `skuMapeamento` (ID que o produto recebeu no canal) — esse vínculo fica gravado no Tiny permanentemente.
5. Sem resposta 200, o Tiny tenta de novo (máximo 2 vezes) e depois marca o mapeamento como rejeitado.
6. O mesmo padrão se repete para atualização de preço ("Envio de preços de produtos" — payload mais enxuto, reaproveitando o `idMapeamento`/`skuMapeamento` já criado) e para estoque.

**Payload real confirmado** (via exemplo baixado): preço/preço promocional, NCM, GTIN, `localizacao` (bin/prateleira — mesmo achado da seção 1.6), dimensões e peso de embalagem, árvore de categoria (pai→filho), `variacoes[]` com grade de atributos (`{chave: "Cor", valor: "Azul"}`), anexos/imagens, bloco `seo` (title/description/keywords/slug) e `kit[]`. É essencialmente o mesmo modelo de produto já mapeado na seção 2.1 — só que **empurrado** via webhook em vez de **puxado** via REST.

**Por que isso muda a leitura do gap:** o Kyneti hoje só tem a direção inversa — `ListingCapableProvider.listActiveListings()` **lê** anúncios que já existem no canal pra casar por SKU; não existe nenhuma capacidade de **criar** um anúncio novo a partir de um produto do Kyneti. O padrão do Tiny mostra que essa peça não precisa ser um "empurrar via webhook para um app parceiro" (isso só faz sentido pra quem é o próprio ERP, como o Tiny) — o caminho certo pro Kyneti é mais direto: ele mesmo chama a API de criação de anúncio de cada marketplace (Mercado Livre `POST /items`, Shopee tem endpoint equivalente) usando os campos que já tem no catálogo (e os que faltam, listados na seção 1.1/2.1 — NCM, GTIN, categoria, variações). O valor do achado do Tiny aqui não é "copiar o webhook", é confirmar **quais campos** um marketplace exige pra aceitar um anúncio novo — e isso já está incorporado nas seções 1.1 e 2.1 acima.

**Novo item de roadmap:** "Publicar anúncio novo em marketplace" — capacidade que falta tanto no Kyneti quanto (evidentemente) não é resolvida pela API pública v3 do Tiny; teria que ser construída direto contra a API de cada marketplace, reaproveitando o vínculo `ChannelListing` já existente como destino do `externalId` retornado pela criação.

### 1.6 Log de movimentação de estoque com localização

Rota: `GET /estoque/{idProduto}/logs-movimentacao`. Schema `EstoqueProdutoResponseModel.localizacao` (bin/prateleira).

Isso é parcialmente coberto — o Kyneti já tem `StockLedgerEntry` (Sprint "Full Fulfillment") registrando toda movimentação. O que falta é o campo de **localização física** (corredor/prateleira) por produto/depósito, que o Tiny já expõe. Baixo esforço, alto valor pra quem tem mais de um depósito físico grande.

---

## 2. O que APERFEIÇOAR (evolução do que o Kyneti já faz)

### 2.1 Campos fiscais no Produto

O `ObterProdutoModelResponse` do Tiny carrega `ncm`, `gtin`, `origem` (9 códigos de origem de mercadoria pra ICMS), `classeIPI`, `gtinEmbalagem`. O Product do Kyneti não tem nenhum desses campos hoje. Mesmo sem emitir NF-e ainda (item 1.1), vale já **capturar e guardar** NCM/GTIN no cadastro do produto — é dado que o lojista já tem (vem do fornecedor) e que se torna pré-requisito obrigatório no dia em que a emissão fiscal for implementada. Adicionar agora custa uma migração de schema; adicionar depois, quando a NF-e for prioridade, vira trabalho de repopular catálogo inteiro.

### 2.2 Granularidade de status do pedido

O Tiny modela **10 situações** (`Dados Incompletos`, `Aberta`, `Aprovada`, `Preparando Envio`, `Faturada`, `Pronto Envio`, `Enviada`, `Entregue`, `Cancelada`, `Não Entregue`) contra os **6** do `UnifiedOrderStatus` do Kyneti (`EM_ABERTO`, `PREPARANDO_ENVIO`, `FATURADO`, `ENVIADO`, `ENTREGUE`, `CANCELADO`). Duas faltam e valem a pena: **`APROVADO`** (pago mas ainda não entrou em preparação — hoje cai direto em `EM_ABERTO`, perdendo o sinal "já posso confiar que vai virar venda") e **`NAO_ENTREGUE`** (entrega tentada e falhou — hoje provavelmente fica preso em `ENVIADO` pra sempre, mascarando um problema logístico real que merece alerta).

### 2.3 Produto Pai/Variação como conceito de primeira classe — ✅ ABSORVIDO (28/07/2026, Fase 2)

O Tiny tem `tipoVariacao` (`N`/`P`/`V` — Normal/Pai/Variação) e `GradeVariacaoResponseModel` (a grade de atributos, tipo Cor x Tamanho) como parte nativa do cadastro de produto, com `produtoPai` referenciando o pai a partir da variação. O catálogo do Kyneti hoje trata cada SKU como uma entidade solta — bom para o caso simples, mas obriga o lojista a gerenciar manualmente o vínculo entre "Camiseta Azul P" e "Camiseta Azul M" como produtos sem relação nenhuma no sistema. Vale absorver o conceito (produto pai + variações), não necessariamente a implementação exata do Tiny (ver item 3.5).

**Implementado:** `Product.parentProductId` (self-relation nullable, `onDelete: SetNull`) — exatamente o único relacionamento sugerido no item 3.5, sem o par redundante `tipoVariacao`+`produtoPai`. Ser "pai" é estado derivado (outros produtos apontando pra ele), nunca um flag gravado. `Product.variantAttributes` (JSON livre, ex.: `{"Cor": "Azul", "Tamanho": "P"}`) substitui a grade estruturada do Tiny. Hierarquia de um nível só, garantida pelo gate puro `canSetParent` (`domain/product-variant.ts`): uma variação nunca pode virar pai, e um produto que já tem variações nunca pode virar variação de outro. Endpoint novo `GET /products/:id/variants`. Ver `docs/product-variants-architecture.md` para o desenho completo.

### 2.4 Motor de recorrência em despesas

`ocorrencia` no Tiny (Única/Semanal/Quinzenal/Mensal/Trimestral/Semestral/Anual/Parcelada) gera automaticamente as parcelas futuras a partir de uma única entrada. O `FixedExpense` do Kyneti é mais estático — vale adicionar esse motor de recorrência, reaproveitável tanto pra contas a pagar (item 1.4) quanto pra despesas fixas já existentes.

### 2.5 Regime tributário ligado à Nota, não só ao tenant

O Tiny amarra `regimeTributario` (Simples Nacional / Simples Excesso / Regime Normal / MEI) e `naturezaOperacao` a cada nota fiscal individualmente. O `TaxProfile` do Kyneti hoje é uma alíquota única estimada por perfil (documentado como simplificação consciente desde a Etapa 2). Isso já era uma dívida técnica assumida — o benchmark do Tiny reforça que vale endereçar, especialmente com a Reforma Tributária (EC 132/2023, IBS/CBS) rodando em transição desde 2026: o Tiny **já tem** campos prontos pra isso (`cstIbsCbs`, `cClassTribIbsCbs`, `valorImpostoCbs`, `valorImpostoIbsUf` em `NotaFiscalItemIbsCbsIsModelResponse`). O Kyneti não tem nada equivalente ainda — é um risco de ficar pra trás numa mudança regulatória que já está em curso, não é hipotética.

---

## 3. O que DESCARTAR (não faz sentido trazer pro Kyneti)

- **CRM completo** (`/crm/assuntos`, `/crm/estagios`, `/crm/assuntos/{id}/acoes`, `/crm/assuntos/{id}/anotacoes`, sistema de estrelas/arquivamento). É pipeline de vendas B2B genérico — fora do escopo de um SaaS de precificação/gestão de marketplace. Quem precisa disso usa HubSpot/Pipedrive; trazer pro Kyneti é inchar o produto sem reforçar o que o diferencia.

- **Ordem de Serviço + Assistência Técnica** (`/ordem-servico`, `OrdemServicoAssistenciaTecnicaRequestModel`, `PecaOrdemServicoRequestModel`). É feito pra loja que conserta produto (assistência técnica, oficina). Não é o perfil de quem vende em marketplace.

- **Notas de consumidor final / PDV** (`POST /notas/nota-fiscal-consumidor/xml`, `ConsumidorFinalRequestModel`). É NFC-e de loja física com caixa registradora. O Kyneti é 100% operação online — não existe balcão de loja física a atender.

- **Meios de pagamento legados** (Cheque, Vale Alimentação, Vale Combustível, Crediário — presentes tanto em `formaPagamento` de contas a pagar quanto em `meioPagamento` de parcelas de ordem de compra). Herança de varejo físico brasileiro pré-Pix. Se absorver contas a pagar/receber (item 1.4), o enum deveria vir enxuto: Pix, Boleto, Cartão (Crédito/Débito), Transferência, Dinheiro — o resto é ruído.

- **`fretePorConta` com nomenclatura NF-e legada** (`R`/`D`/`T`/`3`/`4`/`S` — Remetente/Destinatário/Terceiros/Próprio Remetente/Próprio Destinatário/Sem Transporte, duas codificações diferentes pra "quem paga" convivendo no mesmo enum). É complexidade herdada da nota fiscal em papel/SPED. Um campo booleano ou enum de 2-3 valores (`LOJA_PAGA`/`CLIENTE_PAGA`) resolve o mesmo problema sem a bagagem.

- **Conceito de "Vendedor" com comissão amarrada a usuário do sistema** (`/vendedores`, `VendedorResponseModel`, `VendedorOrdemServicoRequestModel`). É modelo de loja física com equipe de vendas interna. O RBAC do Kyneti (`ADMIN`/`PRICING_EDITOR`/`VIEWER`, RLS multi-tenant) já resolve controle de acesso de um jeito mais adequado a SaaS — não precisa importar o conceito de comissão por vendedor.

- **Redundância `produtoPai` + `tipoVariacao` fazendo o mesmo papel de duas formas** (item 2.3): absorver o *conceito* de produto pai/variação, não a implementação exata — o Tiny carrega os dois campos ao mesmo tempo (um schema `ProdutoResponseModel` aninhado inteiro só pra dizer "esse é o pai", e mais um enum pra dizer a mesma coisa). Um único relacionamento `parentProductId` nullable resolve com metade do código.

---

## 4. Roadmap sugerido (Impacto x Esforço)

### Quick Wins (dias, não sprints inteiras)

| Item | O que é | Esforço |
|---|---|---|
| NCM/GTIN/origem no Product | Campos novos no schema Prisma do Catalog, sem lógica nova | Baixo |
| `APROVADO` e `NAO_ENTREGUE` no `UnifiedOrderStatus` | 2 valores novos no enum + mapeamento nos normalizers existentes | Baixo |
| Campo `localização` no Warehouse/estoque | Já existe `StockLedgerEntry` — só falta o campo de bin/prateleira | Baixo |
| Motor de recorrência em `FixedExpense` | Enum de ocorrência + geração de parcelas futuras | Médio-baixo |
| Sistema de marcadores/tags genérico | Reaproveitável em Products, Orders, Contas — só uma tabela `Tag` + join genérico | Médio-baixo |

### Projetos Estruturantes (mudam o patamar do produto)

| Item | Por que estrutural |
|---|---|
| **Emissão de NF-e** | Maior alavanca de produto — só isso já destrava "Kyneti como ERP completo", não só camada de inteligência. Exige integração com provedor fiscal (Focus NFe/eNotas), fluxo de certificado digital, contingência. |
| **Ordem de Compra completa** | Fecha o ciclo do `ReplenishmentAdvisor` já existente: sugestão → decisão → recebimento → estoque + contas a pagar, tudo rastreado. |
| **Contas a Pagar** | Completa o DRE do lado de despesa variável — hoje só existe `FixedExpense` (estático) e `ReceivableRecord` (a receber). |
| **Expedição em lote** | Agrupar N pedidos/notas num despacho único com etiquetas em massa, preservando o diferencial do Pick & Pack (auditoria em vídeo por pedido) como camada abaixo, não substituída. |
| **Produto Pai + Variações nativo** | Muda o modelo de dados do Catalog — child products deixam de ser SKUs soltos e passam a ter hierarquia real, com grade de atributos (cor/tamanho). |
| **Lista de Preços com exceções** | Motor de precificação em lote por canal/segmento (atacado, campanha), complementar às regras de margem por SKU que já existem. |

**Prioridade de execução sugerida:** NF-e primeiro (maior alavanca, mas também o mais longo — vale começar já, em paralelo com os quick wins). Ordem de Compra e Contas a Pagar em seguida (reaproveitam módulos que já existem, esforço menor que NF-e). Expedição em lote e Produto Pai/Variação por último — são os que mais mexem em fluxo/schema já consolidado, fazem mais sentido depois que o financeiro/fiscal estiver fechado.

---

## 5. Cronograma de execução (acordado em 28/07/2026)

Seis fases sequenciais, com a trilha fiscal (NF-e) rodando em paralelo desde a Fase 0 por ser a mais longa — não trava as outras fases, só termina depois. Construção módulo a módulo, ajustando escopo antes de cada um.

- **Fase 0 — Quick wins (imediato, em paralelo):** campos fiscais no Produto (NCM/GTIN/origem); novos status de pedido (`APROVADO`/`NAO_ENTREGUE`); localização de estoque + tags genéricas; escolha do parceiro fiscal — **decidido em 28/07/2026: Focus NFe** (API já disponível no plano de entrada, R$ 109/mês, sem fidelidade; foco em NF-e/NFC-e de produto casa com o perfil do Kyneti — venda de produto físico multicanal — diferente da eNotas, mais voltada a NFS-e/serviço e com API só a partir do plano Plus, R$ 247/mês). Integração de fato entra na Fase 3.
- **Fase 1 — Financeiro:** Contas a Pagar completo; Ordem de Compra completo (fecha o ciclo do `ReplenishmentAdvisorService`).
- **Fase 2 — Catálogo:** Produto Pai + Variação nativo (grade Cor x Tamanho); Lista de Preços com exceções.
- **Fase 3 — Fiscal:** Emissão de NF-e (integração com o provedor escolhido na Fase 0).
- **Fase 4 — Publicação multicanal — ✅ ABSORVIDO (29/07/2026):** criar anúncio novo direto no Mercado Livre/Shopee a partir de um produto do Kyneti (capacidade que não existe hoje nem no Kyneti nem na API pública do Tiny — ver seção 1.7).
- **Fase 5 — Logística em lote — ✅ ABSORVIDO (29/07/2026):** expedição/agrupamento de pedidos com etiquetas em massa, complementando o Pick & Pack existente (que continua por pedido, com auditoria em vídeo) — ver `docs/dispatch-batch-architecture.md`.

Com a Fase 5 absorvida, as seis fases do cronograma acordado em 28/07/2026 estão concluídas.
