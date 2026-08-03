# Mapeamento do ERP Olist — estudo de produto e UX

**Data:** 02/08/2026
**Método:** navegação direta na conta real do usuário (`erp.olist.com`), via Chrome, somente leitura — nenhum cadastro foi alterado. Diferente dos benchmarks `tiny-erp-benchmark-analysis.md` e `bling-erp-benchmark-analysis.md`, que leram Swagger; aqui o objeto de estudo é o **produto e a interface**, não a API.
**Objetivo:** estudar o ERP que o cliente usa hoje, absorver o que agrega, e propor evoluções para o Kyneti.

**Cobertura — status em 02/08/2026:**
- **Estrutura de menu: 100% mapeada** para Cadastros, Suprimentos, Vendas e Finanças (§0). Falta só Configurações.
- **Telas abertas em profundidade:** Produtos (lista, detalhe de variação, abas, ações em lote), Categorias dos Produtos (árvore completa), Controle de Estoques, Clientes e Fornecedores, Categorias de receitas e despesas, Caixa e Bancos.
- **Ainda não abertas:** ~30 telas listadas em §0 — em especial Anúncios, Campanhas Promocionais, Embalagens, Margem Contribuição, Custos do e-commerce, Comissões, Necessidades de Compra, Giro de Estoque, Contas a Pagar/Receber e todos os Relatórios.

Este documento é atualizado conforme cada tela é aberta.

---

## 0. Estrutura completa de menu

Obtida navegando o menu lateral (flyout por seção), não por adivinhação de URL.

### Cadastros
| Item | Aberta? |
|---|---|
| Clientes e Fornecedores | ✅ §3.6 |
| Produtos | ✅ §1, §2 |
| **Anúncios** | ⬜ — provável origem do "gerenciar preços dos anúncios" (§3.2) |
| **Campanhas Promocionais** | ⬜ — comparar com o módulo de Promoções do Kyneti |
| Categorias dos Produtos | ✅ §2.2 |
| Vendedores | ⬜ |
| **Embalagens** | ⬜ — o Kyneti tem `Packaging`; comparar modelagem |
| Relatórios | ⬜ |

### Suprimentos
| Item | Aberta? |
|---|---|
| Controle de Estoques | ✅ §3.5 |
| Ordens de Compra | ⬜ — Kyneti tem `PurchaseOrder` |
| Serviços Tomados | ⬜ |
| Notas de Entrada | ⬜ |
| Conferência de compra | ⬜ — comparar com o Pick & Pack do Kyneti |
| **Necessidades de Compra** | ⬜ — comparar com `ReplenishmentAdvisor` |
| **Giro de Estoque** | ⬜ — Kyneti usa giro na Curva ABC |
| FCI | ⬜ (Ficha de Conteúdo de Importação — fiscal) |
| Relatórios | ⬜ |

### Vendas
| Item | Aberta? |
|---|---|
| Crédito da Olist *(Novo)* | ⬜ — antecipação de recebíveis |
| CRM | ⬜ |
| Painel de Automações | ⬜ |
| PDV | ⬜ |
| Propostas Comerciais | ⬜ |
| Pedidos de Venda | ⬜ |
| Notas Fiscais | ⬜ |
| **Comissões** | ⬜ — Kyneti tem módulo `sellers` |
| **Performance de Vendas** | ⬜ |
| **Margem Contribuição** | ⬜ — **concorre diretamente com o núcleo do Kyneti** |
| **Custos do e-commerce** | ⬜ — **idem** |
| Google Shopping | ⬜ |
| *(a lista continua abaixo do que coube na tela)* | ⬜ |

### Finanças
| Item | Aberta? |
|---|---|
| Caixa | ✅ |
| Crédito da Olist *(Novo)* | ⬜ |
| Contas a Pagar | ⬜ |
| Contas a Receber | ⬜ |
| Cobranças Bancárias | ⬜ |
| Extratos Bancários | ⬜ |
| Relatórios | ⬜ |
| *Configurações → Categorias de receitas e despesas* | ✅ §3.1 |

### Configurações
⬜ Não aberta.

**Duas entradas de menu chamam atenção antes mesmo de abrir:** `Vendas → Margem Contribuição` e `Vendas → Custos do e-commerce`. São exatamente o que o Kyneti se propõe a fazer. Abrir essas duas é a próxima prioridade do mapeamento — é onde se descobre se o Kyneti está construindo algo que o cliente já tem, ou algo melhor.

---

## 1. A descoberta que muda o dimensionamento: 937 SKUs, não 340

A tela de Produtos mostra `todos 340 · simples 201 · kits 04 · variações 135`. A leitura natural — e a que o projeto estava usando — é "340 SKUs, 135 deles variações". **Está errada.**

`variações 135` conta **produtos-PAI que têm variações**. A lista exibe o pai com o rótulo `(N variações)`. O número real aparece em **Suprimentos → Controle de estoques**, que lista SKU por SKU:

> **produtos 937**

Nessa tela cada variação é uma linha própria (`RM0298-1`, `RM0298-2`, … `RM0298-11`). Exemplos de amplitude na conta: `BASE ALTA COBERTURA ANGEL WINGS` tem **21 variações**; `BATOM LÍQUIDO CREAMY MATTE` tem **15**; `BATOM MATTE 24H MAX LOVE` tem **14**.

**Consequências para o Kyneti:**
- O sync do Olist precisa criar ~937 `Product`, não 340. A **2,8× mais** do que se estimava.
- A 1 req/s (limite do plano base do Tiny), um sync completo leva ~15–20 min. A correção de rate limit de 02/08/2026 deixou de ser otimização e virou pré-requisito — com o `sleep(300)` antigo (200 req/min contra 60 permitidas), o sync nunca terminaria.

---

## 2. A variação é o produto real; o pai é uma casca

Verificado abrindo `RM0298-1` (BASE E CORRETIVO VELVET SKIN 2.0 — CACAU). A variação tem **tudo** que um produto precisa:

| Campo | Valor observado | Observação |
|---|---|---|
| Código (SKU) | `RM0298-1` | derivado do pai por sufixo `-N` |
| GTIN/EAN | `7898767912789` | único por variação |
| Preço de venda | R$ 89,90 | campo próprio |
| Estoque | 12 / 12 / 12 / 13 / 14 entre as cores | **valores diferentes provam que é campo da variação** |
| Peso líquido / bruto | 0,076 / 0,086 kg | próprio |
| Largura × Altura × Comprimento | 12,0 × 3,0 × 18,0 cm | próprio |
| NCM / CEST | 3304.99.90 / 20.015.00 | próprio |
| **Custo** | R$ 70,38 | aba `custos`, **série histórica** |
| Categoria | `ROSTO > BASE > BASE LÍQUIDA` | aba `dados complementares` |
| Tipo do Produto | "Simples" | a variação se declara produto simples |

No **pai**, a lista mostra `Custo: -` (vazio). O dado mais importante para precificar só existe na variação.

**Decisão de modelagem que isso resolve:** cada variação vira um `Product` próprio no Kyneti (`parentProductId` + `variantAttributes`). Importar só o pai perderia custo, estoque e preço por cor — os três insumos do motor de preço. E como a variação tem peso e dimensões próprios, ela **não** é rejeitada pelo normalizador.

### 2.1 Custo tem série histórica — e "custo médio" ≠ "preço custo"

A aba `custos` da variação é uma **tabela temporal**, não um campo:

| A partir de | Saldo atual | Preço custo | Custo médio |
|---|---|---|---|
| 29/04/2026 | 12,00 | 70,38 | 70,38 |
| 24/06/2026 | 0,00 | 60,19 | 0,00 |

E o Controle de Estoques mostra `Custo médio 0,00` para vários SKUs cujo `preço custo` não é zero. **São dois conceitos distintos**, e importar o errado zera o custo do produto — o que, depois da correção do piso de preço (§1 da revisão), faria o motor bloquear a decisão em vez de precificar. O `preco_custo` da API V2 é o campo certo; vale conferir no primeiro sync real se ele traz o valor da linha vigente.

### 2.2 Categorias dos Produtos — a tela dedicada

`Cadastros → Categorias dos Produtos` (`/produto_categorias`). **8 árvores** cadastradas pelo próprio lojista: `ACESSÓRIOS · CABELOS · KIT DE MAQUIAGEM · LÁBIOS · OLHOS · PERFUMARIA · ROSTO · SKINCARE`.

Listagem com duas colunas (`Descrição`, `Árvore` — que indica "Possui subcategorias") e duas ações: **informar atributos** e **incluir grupo de categorias**.

Árvore de `ROSTO`, capturada por inteiro:

```
ROSTO
├─ ACESSÓRIOS
│  └─ PINCEL
│     └─ PINCEL PARA CONTORNO
├─ BASE
│  ├─ BASE ALTA COBERTURA · BASE EM BASTÃO
│  └─ BASE LÍQUIDA · BASE MÉDIA COBERTURA
├─ BLINDAGEM
├─ BLUSH
│  ├─ BLUSH COMPACTO · BLUSH EM BASTÃO · BLUSH LÍQUIDO
│  └─ BLUSH MULTIFUNCIONAL · ILUMINADOR
├─ CONTORNO
│  ├─ PALETA → PALETA MULTIFUNCIONAL
│  └─ CONTORNO COMPACTO · CONTORNO EM BASTÃO · CONTORNO LÍQUIDO
├─ CORRETIVO → CORRETIVO EM BASTÃO · CORRETIVO LÍQUIDO
├─ DEMAQUILANTE · FIXADOR
├─ ILUMINADOR → ILUMINADOR LÍQUIDO
├─ MARCAS → RUBY ROSE · UNI MAKEUP
├─ PALETA → PALETA DE ILUMINADORES
├─ PÓ FACIAL → PÓ COMPACTO · PÓ SOLTO
├─ PRIMER
└─ PROTETOR SOLAR FACIAL
```

**Profundidade real: 4 níveis** (`ROSTO > ACESSÓRIOS > PINCEL > PINCEL PARA CONTORNO`) — e não 3, como o campo no cadastro do produto sugeria.

**O editor de árvore vale ser copiado quase como está.** Cada nó tem três ações inline (`+` adicionar filho · lápis editar · lixeira excluir), expandir/recolher por nó, e `salvar`/`cancelar` no rodapé. Sem modal, sem navegação. A raiz não tem lixeira. O Kyneti tem `catalog.ProductCategory` como árvore de profundidade arbitrária no schema, mas **não tem tela de árvore** — a `CategoriesPage` existe, mas o modelo de interação aqui é melhor que qualquer coisa que eu inventaria do zero.

**Categorias podem ter atributos** (ação "informar atributos"). O Kyneti já tem `CategoryAttribute` com herança para filhos (`extendToChildren`) no `marketplace-publishing` — a modelagem bate. Abrir essa tela é prioridade para comparar.

**Uma observação sobre o uso real, não sobre a ferramenta:** dentro de `ROSTO` há um nó `MARCAS` com `RUBY ROSE` e `UNI MAKEUP`. Duas dimensões diferentes — tipo de produto e marca — convivem na mesma árvore. A ferramenta permite e não há nada errado nisso. Mas importa para o Kyneti: se a categoria interna for usada para inferir a taxa por categoria do marketplace (`ChannelCategoryMapping` → `FeeRule`), um nó de marca não tem correspondente do outro lado. Vale saber disso antes de tratar a árvore como taxonomia confiável para mapeamento automático.

---

## 2.3 Como o Olist vincula produto ↔ categoria do marketplace — **a peça central**

Esta era a pergunta de verdade (a árvore interna é organização particular do lojista; o que importa é como ela vira categoria do canal). A resposta está em `Cadastros → Anúncios`.

### O "Anúncio" é uma entidade própria, separada do Produto

`Cadastros → Anúncios` mostra os canais e seus anúncios ativos:

| Canal | Anúncios ativos |
|---|---|
| **Mercado Livre** | **1.236** |
| **TikTok Shop** | **931** |
| **Shopee** | **875** |
| Magalu Marketplace | 64 |
| Amazon | 56 |
| Shein | 2 |
| Mercado Livre Fulfillment | 0 |
| **Total** | **~3.164** |

Três coisas que isso revela e que o Kyneti não estava considerando:

1. **O lojista vende em SEIS marketplaces.** O Kyneti integra Mercado Livre, Shopee e Nuvemshop. **TikTok Shop (931 anúncios) é o segundo maior canal dele** e não tem nenhuma integração no Kyneti.
2. **3.164 anúncios para 937 SKUs** — em média 3,4 anúncios por produto. O anúncio não é um espelho 1:1 do produto.
3. O texto da própria tela: *"você pode importar anúncios de marketplaces e **relacioná-los com seus produtos**. Você pode ter alguns anúncios **não relacionados**"*. Ou seja, o vínculo é explícito e pode faltar — existe um estado de órfão, e uma tela para resolvê-lo.

### A lista de anúncios de um canal

Abas: `todos · ativos · rejeitados · não publicados · **necessitam atenção** · **anúncios agrupados**`.

Colunas: `Identificador (MLB…) · **SKU** · Título · **SKU (produto)** · Preço · **Qualidade do anúncio** · **Experiência de compra**`.

- **Duas colunas de SKU** — o do anúncio e o do produto no ERP. É exatamente o par `externalId ↔ skuCode` do `ChannelListing` do Kyneti. A diferença é que aqui isso é visível e auditável numa tela.
- **Qualidade do anúncio (69%, 63%) e Experiência de compra (100%)** — métricas de reputação do próprio Mercado Livre, importadas por anúncio. O Kyneti não tem nada disso.
- Aba **"necessitam atenção"** — mesma filosofia proativa de "produtos com problemas fiscais".

### A ficha técnica é o vínculo de categoria de verdade

Ao abrir um anúncio: abas `detalhes do anúncio · agrupador · variações do e-commerce · **ficha técnica** · central de ofertas`.

A **ficha técnica** é o schema de atributos que a categoria do marketplace exige, espelhado dentro do ERP e **agrupado por nível de obrigatoriedade**:

| Grupo | Exemplos reais do anúncio observado |
|---|---|
| **Características de variação** | Fragrância → Suave |
| **Características de família** | Marca, Linha, Nome, Tipo de embalagem, Consistência, Formato de venda, Unidades por kit, Volume da unidade, Peso da unidade |
| **Características obrigatórias** | Altura / Comprimento / Largura / Peso da embalagem do vendedor |
| **Características recomendados** | Momento de aplicação, Zonas de aplicação, Duração do efeito, Preferência de ingredientes, É livre de crueldade, É dermatologicamente testado, É de absorção rápida, É livre de fragrância, É livre de glúten |

**É por isso que o vínculo parece "automático" para o lojista:** ele não escolhe categoria numa árvore gigante do marketplace. Ele preenche uma ficha cujos campos **já vêm determinados pela categoria** que o canal atribuiu, com os campos separados entre "o canal exige", "o canal recomenda", "identifica a família do produto" e "diferencia a variação".

### O que isso significa para o Kyneti

O Kyneti tem `ChannelCategoryMapping` (categoria interna → categoria do canal) e `CategoryAttribute` com herança (`extendToChildren`). **A modelagem está certa, mas é mais pobre em dois pontos:**

1. **Não há tiering de obrigatoriedade.** `CategoryAttribute` é uma lista plana. O Olist separa obrigatória / recomendada / família / variação — e é isso que permite um gate de publicação honesto ("faltam 2 obrigatórias") em vez de um checklist indistinto.
2. **O atributo de VARIAÇÃO é um conceito à parte.** "Fragrância → Suave" não é um atributo do produto: é o que diferencia esta variação das irmãs. O Kyneti guarda isso em `Product.variantAttributes` (JSON livre), sem ligação com o schema da categoria do canal.

**Proposta:** estender `CategoryAttribute` com um campo de **nível** (`OBRIGATORIO · RECOMENDADO · FAMILIA · VARIACAO`) e usar isso no gate `canPublish` do `ListingPublicationService`, que hoje só verifica presença. É mudança pequena de schema com ganho direto de qualidade de publicação.

---

## 2.4 ⚠️ O Olist JÁ TEM um módulo de Margem de Contribuição

`Vendas → Margem Contribuição`. Esta é a descoberta mais importante do mapeamento: **o núcleo do Kyneti já existe na ferramenta que o cliente usa hoje.** Precisa ser encarado de frente.

### O waterfall dele (dados reais, últimos 7 dias)

```
(+) Faturamento                R$ 29.960,33
    Frete das vendas           R$  1.174,24
(-) Custo adicional com Frete  R$  2.237,37
(-) Comissões                  R$  5.763,86
(-) Taxas e tarifas            R$      0,00
(-) Custos de compras          R$ 15.673,80
(-) Impostos das vendas        R$  1.804,38
(+) Incentivos                 R$    309,46
(+) Créditos de impostos       R$      0,00
(-) Valores adicionais         R$      0,00
──────────────────────────────────────────
= Margem de contribuição       R$  4.790,39   (15,99%)
```

Quatro visões: **Canais de venda · Produtos · Pedidos de venda · Visão geral**, mais um **Glossário** explicando cada linha. Drill-down com índice (%) em cada nível.

Por canal, no período:

| Canal | Faturado | Margem | Índice |
|---|---|---|---|
| Amazon | R$ 590,28 | R$ 223,94 | **37,94%** |
| Mercado Livre | R$ 15.308,31 | R$ 2.442,00 | 15,95% |
| Shopee | R$ 14.061,74 | R$ 2.124,45 | 15,11% |

### O que ele tem e o Kyneti NÃO tem

1. **`(+) Incentivos`** — subsídio do marketplace entra como linha POSITIVA (R$309 no período). Frete grátis subsidiado, incentivo de campanha. O Kyneti não modela isso em lugar nenhum, e trata subsídio só como redutor de custo de frete.
2. **`(+) Créditos de impostos`** — crédito tributário recuperável.
3. **`Frete das vendas` vs `(-) Custo adicional com Frete`** — separa o frete cobrado do comprador do que sobrou para o vendedor pagar. É mais preciso que o `sellerFreightCost` único do Kyneti.
4. **Alíquota configurada POR MÊS, e separada para produtos com e sem ST:**

   | Mês | Regime | Alíquota s/ ST | Alíquota c/ ST |
   |---|---|---|---|
   | 08/2026 | Simples nacional | 7,30 | 0,00 |
   | 07/2026 | Simples nacional | 7,30 | 0,00 |
   | 05/2026 | Simples nacional | 0,00 | 0,00 |

   O Kyneti tem **uma** `CatalogSettings.taxRatePct` por tenant, fixa. Mas a alíquota do Simples Nacional **muda todo mês** conforme o RBT12, e produto com Substituição Tributária tem tratamento diferente. **O modelo do Kyneti está errado nesse ponto**, e o Olist está certo.
5. **Glossário embutido** explicando cada linha do waterfall.

### O que o Kyneti tem e ele NÃO tem — o diferencial real

**Não existe linha de Ads/publicidade no waterfall dele.** Faturamento, frete, comissão, taxas, compras, impostos, incentivos, créditos, valores adicionais — e nada de mídia.

Isso é exatamente o que o Kyneti passou a fazer em 01/08/2026 (§2 da revisão), incluindo o rateio por SKU com dado real da API do ML. **Contra a ferramenta que o cliente usa hoje, é um diferencial verificado, não uma hipótese.**

O Kyneti também: calcula em **tempo real** (o Olist mostra "último processamento 04/06/2026", ou seja, é batch e pode estar desatualizado), e tem `dataQuality` apontando o pedido exato com custo incompleto.

## 2.5 Custos do e-commerce — e um furo de dado no Olist

`Vendas → Custos do e-commerce`, últimos 6 meses:

| Canal | Faturamento | Frete do pedido | Comissão | Comissão efetiva |
|---|---|---|---|---|
| **Mercado Livre** | R$ 176.108,43 | R$ 4.508,10 | R$ 20.989,71 | **11,9%** |
| **Shopee** | R$ 163.470,69 | R$ 6.179,45 | R$ 38.063,56 | **23,3%** |
| Amazon | R$ 1.773,61 | R$ 51,82 | **R$ 0,00** | ⚠️ |
| Magalu | R$ 284,70 | R$ 16,90 | **R$ 0,00** | ⚠️ |
| Nuvemshop | R$ 426,60 | R$ 33,43 | R$ 0,00 | (loja própria, correto) |
| **Total** | **R$ 342.064,03** | R$ 10.789,70 | R$ 59.053,27 | 17,3% |

**Dois achados:**

1. **A Shopee custa quase o DOBRO do Mercado Livre** — 23,3% contra 11,9% de comissão efetiva, sobre faturamento praticamente igual (163k vs 176k). Esse é precisamente o tipo de assimetria que o piso de preço por canal (corrigido em 01/08/2026) existe para respeitar. Vender o mesmo SKU pelo mesmo preço nos dois canais entrega margens muito diferentes.

2. **Amazon e Magalu aparecem com comissão R$ 0,00 — e isso está errado.** A Amazon cobra 8–15% de referral fee; Magalu 12–20%. O Olist não está capturando a comissão desses dois canais, o que **infla a margem deles**. Não por acaso, a Amazon aparece com 37,94% de margem no módulo anterior — número que não sobrevive a descontar a comissão real.

   Isso reforça a decisão de projeto do Kyneti de **bloquear a decisão de preço quando não há regra de taxa importada** em vez de assumir zero. O Olist assume zero e mostra um número bonito e falso.

---

## 3. O que vale ABSORVER

Ordenado por valor para o Kyneti.

### 3.1 Categoria financeira com linha de DRE e competência — prioridade alta

`Finanças → Configurações → Categorias de receitas e despesas` tem três colunas:

| Descrição | **Categoria no DRE** | **Competência padrão** |
|---|---|---|
| Água, luz | … | Mês do vencimento |
| Aluguéis e condomínio | … | Mês do vencimento |
| Compras | … | Mês do vencimento |
| Impostos, taxas | … | Mês do vencimento |

Duas ideias embutidas aí, e o Kyneti não tem nenhuma das duas:

1. **Cada categoria declara a que linha do DRE pertence.** Hoje `FixedExpense.category` e `AccountsPayable.category` são **texto livre** no Kyneti — o DRE não sabe agrupar despesa por natureza. Isso é o que falta para o `resultadoOperacional` (implementado em 01/08/2026) virar um DRE de verdade, com linhas por natureza de despesa em vez de um total único.
2. **Competência padrão por categoria** (mês do vencimento vs. mês do pagamento). É a diferença entre regime de caixa e competência — e hoje o Kyneti assume um só, implicitamente.

Há também **grupos** de categoria, ou seja, uma hierarquia de plano de contas.

### 3.2 "Gerenciar preços dos anúncios" — valida o override por anúncio

O menu `mais ações` de Produtos tem a ação **"gerenciar preços dos anúncios"**. É exatamente o override de preço por anúncio que ficou pendente na revisão do Kyneti (§5), e que eu havia recomendado adiar por falta de demanda concreta.

**A demanda existe e o cliente já usa.** Isso muda a recomendação: o override deixa de ser hipótese e passa a ser paridade com a ferramenta que ele opera hoje.

### 3.3 "Produtos com problemas fiscais" — tela proativa

Outra ação do mesmo menu. É uma lista dos produtos cujo cadastro fiscal está incompleto.

O Kyneti hoje **bloqueia** a emissão de NF-e quando falta NCM (correto), mas só descobre no momento da emissão — pedido a pedido. Uma tela "produtos com problema fiscal" transforma isso de obstáculo reativo em tarefa de saneamento. Casa com o `dataQuality` do DRE, que já segue essa filosofia de apontar o registro exato.

### 3.4 Ações em lote no catálogo

Menu completo observado:

- receber produtos do e-commerce
- imprimir relatório
- **iniciar histórico de custos**
- **reajustar preço dos produtos** (reajuste em massa)
- **editar CEST dos produtos em lote**
- **produtos com problemas fiscais**
- **gerenciar preços dos anúncios**
- **consultar último lote de sugestão de NCM**
- exportar produtos / **composição de kits** / **estrutura de fabricados** para planilha
- **importar produtos de uma planilha**

O padrão a absorver não é a lista, é a **filosofia**: num catálogo de 937 SKUs, quase toda operação relevante é em lote. O Kyneti é fortemente orientado a "um SKU por vez" (tela de produto, decisão de preço, adesão a promoção). Vale escolher 2–3 operações de maior atrito e dar versão em lote — reajuste de margem e correção fiscal são as candidatas naturais.

**Sugestão de NCM em lote** merece nota à parte: é um caso de IA aplicada a saneamento de cadastro, e o Kyneti já tem infraestrutura de IA (`anthropic-campaign-advisor.service.ts`). Sugerir NCM a partir de nome e categoria é um problema bem delimitado e de valor direto.

### 3.5 Estoque: reservado é cidadão de primeira classe

O Controle de Estoques mostra, por SKU: **Estoque físico · Estoque reservado · Estoque disponível**, com seletor de **depósito** e coluna de **Localização**.

O Kyneti tem `Warehouse` e `ProductWarehouseLocation`, e o benchmark do Bling já apontou `saldoFisico` vs `saldoVirtual` como lacuna. Ver isso em uso confirma a prioridade: "disponível para vender" é o número que o lojista realmente consulta, e é o que o motor de reposição deveria usar.

### 3.6 Cadastro único de Contato, com papéis

`Clientes e Fornecedores` é **uma entidade** com abas: `todos · cliente · fornecedor · transportador · vendedor · outro`.

O Kyneti tem **três tabelas separadas**: `Supplier` (catalog), `Carrier` (freight-shipping) e `Vendedor` (sellers). A mesma pessoa jurídica que é fornecedor e transportador precisa de dois cadastros.

**Não recomendo migrar agora** — seria refatoração grande, cara, e as três tabelas já têm consumidores. Mas registro como dívida de modelagem conhecida: se um quarto papel aparecer (representante, por exemplo), é o momento de consolidar em vez de criar a quarta tabela.

---

## 4. Leitura de UX — o que a interface faz bem

**Contadores nas abas como filtro.** `todos 340 · simples 201 · kits 04 · variações 135` — a aba é filtro e diagnóstico ao mesmo tempo. O Kyneti usa abas de status em Pedidos; vale estender ao catálogo (quantos sem NCM, quantos sem custo, quantos sem foto).

**Expansão inline em vez de navegação.** Clicar na seta do produto abre um resumo (GTIN, NCM, custo, marca, localização) sem sair da lista. Reduz ida e volta em catálogo grande.

**O rótulo `(11 variações)` é um link.** Abre um painel lateral com a grade completa — SKU, GTIN, preço, estoque por variação. É a solução para "ver o detalhe sem perder o contexto da lista", e resolve bem o problema que o Kyneti terá quando tiver 937 produtos numa tela só.

**Preço promocional exibido riscando o cheio** direto na lista (`49,90` riscado, `39,90` embaixo). O Kyneti tem Promoções como módulo separado; mostrar o efeito no próprio catálogo é mais direto.

**Ponto fraco observado:** a tela de Clientes e Fornecedores retornou *"Erro ao carregar registros — Ocorreu um erro ao executar a consulta"* durante a navegação, e o próprio ERP do cliente vinha devolvendo `API Bloqueada` por rate limit. Confiabilidade sob carga é um flanco real do produto que ele usa hoje — e um diferencial defensável para o Kyneti, desde que a nossa própria sincronização seja disciplinada (o que só passou a ser verdade em 02/08/2026).

---

## 5. O que NÃO copiar

- **Menu de `mais ações` com 12 itens sem hierarquia.** Mistura exportação, saneamento fiscal, reajuste de preço e importação no mesmo nível. É o sintoma clássico de ERP que cresceu por acréscimo. Se o Kyneti for adicionar operações em lote, agrupá-las por intenção desde o começo.
- **Duas telas com o mesmo nome e sentidos diferentes.** `Categorias` (`/categorias`) é plano de contas financeiro; a categoria de produto vive dentro do cadastro do produto, em outra aba. Descobrir isso exigiu tentativa e erro — inclusive para mim.
- **Custo do pai vazio quando as variações têm custo.** Tecnicamente coerente, mas induz a erro na leitura da lista: o operador vê `Custo: -` e conclui que não há custo cadastrado.

---

## 6. Efeito nas prioridades do Kyneti

| Item | Antes deste estudo | Depois |
|---|---|---|
| Override de preço por anúncio | "sem demanda concreta, adiar" (revisão §5) | **Priorizar** — o cliente já usa o equivalente no Olist |
| Volume do sync Olist | ~340 produtos | **937** — rate limiting é pré-requisito, não otimização |
| Modelagem de variação | dúvida entre pai-só e filho-por-variação | **Resolvida**: filho por variação, com dados próprios |
| Categoria de despesa no DRE | não estava no radar | **Nova proposta** — fecha o `resultadoOperacional` com linhas por natureza |
| Produtos com problema fiscal | não estava no radar | **Nova proposta** — saneamento proativo |
| Sugestão de NCM por IA | não estava no radar | **Nova proposta** — infraestrutura de IA já existe |

---

## 7. Referências

- `docs/olist-import-design.md` §5.1 — estrutura de dados verificada, com os mesmos valores observados
- `docs/revisao-geral-2026-08.md` — revisão geral do Kyneti (o §5 sobre override de preço muda de prioridade por causa de §3.2 aqui)
- `docs/tiny-erp-benchmark-analysis.md` / `docs/bling-erp-benchmark-analysis.md` — benchmarks de API (complementares a este, que é de produto/UX)
