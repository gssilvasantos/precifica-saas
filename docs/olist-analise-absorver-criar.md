# Olist → Kyneti: o que absorver, aprimorar e criar

**Data:** 02/08/2026
**Base:** mapeamento completo do ERP Olist na conta real do cliente (`olist-erp-ux-mapping.md`), navegando menu por menu. Pulados por instrução do usuário: Envios, Ecommerce, Lis e Crédito da Olist.
**Escopo deste documento:** decisões de produto. O inventário de telas e os dados observados estão no documento de mapeamento; aqui fica o que fazer com eles.

---

## 0. Inventário completo de telas visitadas

| Seção | Telas |
|---|---|
| **Cadastros** | Clientes e Fornecedores · Produtos · Anúncios · Campanhas Promocionais · Categorias dos Produtos · Vendedores · Embalagens · Relatórios |
| **Suprimentos** | Controle de Estoques · Ordens de Compra · Notas de Entrada · Conferência de compra · Necessidades de Compra · Giro de Estoque · Serviços Tomados · FCI · Relatórios |
| **Vendas** | CRM · Painel de Automações · PDV · Propostas Comerciais · Pedidos de Venda · Notas Fiscais · Comissões · Performance de Vendas · **Margem Contribuição** · **Custos do e-commerce** · Google Shopping · Separação · Expedição · Devoluções de venda · Pedidos no e-commerce · Perguntas do e-commerce · Pós-venda Mercado Livre · Operações Fiscais · Relatórios |
| **Finanças** | Caixa e Bancos · Contas a Pagar · Contas a Receber · Cobranças Bancárias · Extratos Bancários · Categorias de receitas e despesas · Relatórios |
| **Configurações** | geral · cadastros · suprimentos · vendas · notas fiscais · finanças · e-commerce · **tributação (RTC)** |

**Números reais da operação, para calibrar prioridade:**

| Métrica | Valor |
|---|---|
| SKUs vendáveis | **937** |
| Anúncios ativos | **3.164** em 6 marketplaces |
| Faturamento (6 meses) | R$ 342.064,03 |
| Comissão paga (6 meses) | R$ 59.053,27 (17,3%) |
| Devoluções (2 meses) | 132 · R$ 8.761,56 |
| Contas a receber em aberto | 135 · R$ 19.160,86 — **todas atrasadas** |
| Notas de entrada (30 dias) | 40 · R$ 71.655,39 |

---

## 1. 🔴 Correções — coisas em que o Kyneti está ERRADO

Não são melhorias. São defeitos que o mapeamento expôs.

### 1.1 Alíquota de imposto é única e fixa — precisa ser **calculada**, e por produto

> ⚠️ **Esta seção foi reescrita em 02/08/2026.** A versão original dizia que a
> alíquota "muda todo mês" e propunha copiar do Olist uma tabela de alíquotas
> digitadas por competência. Estava errado. A pesquisa em fontes oficiais está em
> [tributacao-br-regimes-e-reforma.md](./tributacao-br-regimes-e-reforma.md) —
> **leia aquele documento**, este é só o resumo.

`CatalogSettings.taxRatePct` é **um número por tenant**. O Olist pede que o
usuário digite a alíquota por mês, separando produtos com e sem Substituição
Tributária:

| Mês | Regime | Alíquota s/ ST | Alíquota c/ ST |
|---|---|---|---|
| 08/2026 | Simples nacional | 7,30 | 0,00 |
| 05/2026 | Simples nacional | 0,00 | 0,00 |

**Mas 7,30% é a alíquota _nominal_ da 2ª faixa do Anexo I, não a efetiva.** A
alíquota do Simples não é um parâmetro que alguém escolhe — é o **resultado** de
`(RBT12 × nominal − parcela a deduzir) / RBT12` (art. 18 da LC 123/2006). Com o
RBT12 real desta conta (≈ R$ 350k), a efetiva é **5,60%**. E num produto com
ICMS-ST + monofásico, ≈ **2,83%**.

Digitado 7,30%, real ≈ 2,83% num produto com ST: **4,47 pontos percentuais** de
imposto que o sistema supõe existir e não existe — cerca de **R$ 15 mil** sobre o
faturamento do semestre. O piso de preço sai alto demais e o vendedor perde venda
por um custo fantasma.

A tela do Olist é um **contorno manual** para um valor que o ERP não calcula. O
Kyneti não precisa desse contorno: ele já ingere todos os pedidos de todos os
canais, então **tem o RBT12**.

**Correção:** `TaxRateResolver` que calcula a efetiva a partir do RBT12 e a
ajusta por produto (ST remove a partilha do ICMS, monofásico remove PIS+Cofins),
com `memoriaDeCalculo` e `source: CALCULATED_RBT12 | MANUAL_OVERRIDE` — mesma
filosofia do `dataQuality`. Bloqueia quando o histórico é menor que 12 meses em
vez de somar o que tem e chamar de verdade. `Product.cest` já identifica ST.

O modelo completo (quatro regimes + CBS/IBS da Reforma) está na §5 de
[tributacao-br-regimes-e-reforma.md](./tributacao-br-regimes-e-reforma.md).

### 1.2 Não existe conceito de incentivo/subsídio do marketplace

O waterfall do Olist tem **`(+) Incentivos`** como linha positiva (R$309 em 7 dias). São subsídios de frete grátis e de campanha que o canal devolve ao vendedor.

O Kyneti trata subsídio só como redutor dentro de `resolveSellerFreightCost`. Quando o canal **paga** algo ao vendedor, não há onde registrar — e a margem fica subestimada.

**Correção:** linha `incentivos` no DRE, alimentada pelo settlement (o repasse traz esses créditos discriminados).

---

## 2. 🟠 ABSORVER — existe no Olist, falta no Kyneti, e vale

### 2.1 Devoluções — o buraco mais caro

**132 devoluções, R$ 8.761,56 em ~2 meses.** O Kyneti **não tem módulo de devolução**. Uma devolução mexe em tudo: estoque volta, comissão é estornada, frete de retorno é custo, e o DRE precisa reverter a margem daquele pedido.

Hoje o DRE do Kyneti só ignora pedido `CANCELADO`. Devolução parcial pós-entrega não existe no modelo.

O Olist tem ainda **vales-troca** (crédito de loja) — conceito ausente no Kyneti.

**Criar:** módulo `returns` com `SalesReturn` (origem = pedido, itens, motivo, meio) + reversão de estoque via `StockReceiptWriter` + linha de dedução no DRE. Situações do Olist: `em aberto · em andamento · finalizadas`.

### 2.2 Prazo máximo de despacho — SLA do marketplace

A tela de Separação mostra **"Prazo máximo de despacho: 03/08/2026 23:59:00"** por pedido. É o SLA que o marketplace cobra; estourar derruba reputação, que derruba o subsídio de frete (até 70% no ML), que come margem.

O Pick & Pack do Kyneti tem prova em vídeo e checklist bipado — melhor que o Olist nesse aspecto —, mas **não tem o relógio**.

**Absorver:** `Order.dispatchDeadline`, vindo do provider, com ordenação e alerta por proximidade. É barato e liga operação a dinheiro.

### 2.3 Plano de contas com linha de DRE e competência

`Finanças → Configurações → Categorias de receitas e despesas`: cada categoria declara **"Categoria no DRE"** e **"Competência padrão"** (mês do vencimento vs. do pagamento).

No Kyneti, `FixedExpense.category` e `AccountsPayable.category` são **texto livre**. O `resultadoOperacional` implementado em 01/08/2026 é um total único, sem linhas por natureza.

**Absorver:** `ExpenseCategory` com `dreLine` e `competenciaPadrao`, e agrupar o DRE por ela.

### 2.4 Painel de Automações centralizado

O Olist tem uma tela única listando toda automação como **ação + gatilho + liga/desliga**:

- `Lançar saída de estoque` **[ON]** → *Quando: ao autorizar a nota fiscal*
- `Emitir NF-e` **[OFF]** → *Quando: —*
- `Autorizar NF-e na Sefaz` **[OFF]** → *Quando: —*

O Kyneti tem a mesma filosofia (Safety Lock) mas com as chaves **espalhadas**: `Product.autoRepricingEnabled`, `FiscalSettings.autoEmitOnApproval`, agendamentos de sync. O lojista não consegue responder "o que este sistema faz sozinho?" numa tela.

**Absorver:** tela `Automações` que lê todas as flags existentes e as apresenta como ação + gatilho + toggle. **Não precisa de backend novo** — é uma tela de composição sobre o que já existe.

### 2.5 Necessidades de Compra configurável

O relatório do Olist deixa o usuário escolher: **quais status de venda contam como demanda** (Aprovado, Faturado), **janela em meses**, **considerar transferências entre depósitos**, filtro por fornecedor, por tag, por depósito.

O `ReplenishmentAdvisorService` do Kyneti tem lead time configurável, mas o resto é fixo.

**Aprimorar:** expor esses parâmetros. O cálculo já existe; falta parametrizar.

### 2.6 Tela de anúncios com qualidade e órfãos

A lista de anúncios do ML traz **Qualidade do anúncio (69%, 63%)** e **Experiência de compra (100%)** — métricas de reputação por anúncio, importadas do canal. E abas `necessitam atenção` e `não publicados`, além do estado **"não relacionado"** (anúncio sem produto vinculado).

O Kyneti tem `ChannelListing` mas nenhuma tela que mostre a saúde do vínculo.

**Absorver:** tela de Anúncios por canal, com as duas métricas de qualidade e um filtro de órfãos.

---

## 3. 🟡 CRIAR — não existe em nenhum dos dois, e é oportunidade

### 3.1 TikTok Shop — o canal invisível

**931 anúncios ativos.** É o **segundo maior canal** do cliente e o Kyneti não tem nenhuma integração. Shopee (875) tem.

Antes de qualquer refinamento de precificação, vale integrar o canal onde ele já vende.

### 3.2 Comissão real por canal como alerta, não só como número

Dado real de 6 meses:

| Canal | Faturamento | Comissão | Efetiva |
|---|---|---|---|
| Mercado Livre | R$ 176.108 | R$ 20.990 | **11,9%** |
| Shopee | R$ 163.471 | R$ 38.064 | **23,3%** |

**A Shopee custa quase o dobro, sobre faturamento equivalente.** O Kyneti já tem o piso por canal (01/08/2026). O que falta é a leitura executiva: *"o mesmo SKU a R$50 rende X no ML e Y na Shopee"*, comparando canais lado a lado antes de decidir onde empurrar volume.

### 3.3 Auditoria de taxa configurada × taxa real do repasse

No Olist, **Amazon e Magalu aparecem com comissão R$ 0,00** — o que é falso e infla a margem desses canais (Amazon aparece com 37,94%).

O Kyneti já bloqueia decisão sem taxa importada. O passo seguinte é **conferir a taxa importada contra o repasse real** do settlement, que ele já ingere: *"a regra diz 14%, o repasse está cobrando 14,8% — revise."*

Nenhum concorrente pesquisado faz isso. É diferencial defensável.

### 3.4 Saneamento proativo de cadastro

O Olist tem `produtos com problemas fiscais` e `sugestão de NCM em lote`. O Kyneti bloqueia emissão de NF-e sem NCM (correto), mas descobre pedido a pedido.

**Criar:** tela de saneamento com contadores — quantos SKUs sem NCM, sem custo, sem foto, sem categoria mapeada. Com 937 SKUs, isso é tarefa de mutirão, não de correção pontual.

E **sugestão de NCM por IA** — o Kyneti já tem infraestrutura de IA (`anthropic-campaign-advisor.service.ts`).

---

## 4. O que o Kyneti tem e o Olist NÃO tem — o diferencial verificado

Não é hipótese. Foi conferido contra a ferramenta que o cliente usa hoje.

| Diferencial | Evidência |
|---|---|
| **Custo de Ads no resultado** | O waterfall do Olist não tem nenhuma linha de mídia. O Kyneti desconta por canal **e** rateia por SKU com dado real da API do ML |
| **Cálculo em tempo real** | O Olist mostra *"último processamento 04/06/2026"* — é batch e pode estar meses desatualizado |
| **`dataQuality` por pedido** | O Kyneti aponta o pedido exato com custo desconhecido; o Olist mostra o agregado |
| **Piso de preço que bloqueia sem taxa importada** | O Olist assume comissão zero e exibe margem falsa (Amazon 37,94%) |
| **Prova em vídeo na conferência** | O Pick & Pack do Kyneti grava; o Olist só tem checklist |
| **Custo de embalagem** | As 9 embalagens do Olist têm dimensão e peso, **sem custo**. O `Packaging.costPrice` do Kyneti entra na margem |

---

## 5. Frontend — o que copiar da interface do Olist para o Kyneti

Padrões observados que resolvem problemas que o Kyneti **vai ter** com 937 SKUs e 3.164 anúncios. Todos são de composição sobre o backend atual.

### 5.1 Contador na aba como filtro e diagnóstico

`todos 340 · simples 201 · kits 04 · variações 135` — a aba filtra e informa ao mesmo tempo.

**Aplicar em:** `CatalogPage` (todos / sem NCM / sem custo / sem foto / sem categoria mapeada), `FiscalInvoicesPage`, `OrdersPage` (já tem status, falta o contador em algumas).

### 5.2 Expansão inline em vez de navegação

Clicar na seta abre um resumo (GTIN, NCM, custo, marca, localização) **sem sair da lista**.

**Aplicar em:** `CatalogPage` — mostrar piso de preço, margem atual e taxa do canal sem abrir o produto. Todos esses dados já vêm do `PricingDecision`.

### 5.3 Painel lateral para detalhe de coleção

O rótulo `(11 variações)` abre um painel lateral com a grade completa — SKU, GTIN, preço, estoque por variação — sem perder o contexto.

**Aplicar em:** variações do produto (quando a importação estiver pronta) e anúncios por SKU.

### 5.4 Editor de árvore inline

Cada nó de categoria com `+` / lápis / lixeira, expandir/recolher, `salvar`/`cancelar` no rodapé. Sem modal.

**Aplicar em:** `CategoriesPage` — o `ProductCategory` já é árvore no schema, mas a tela não reflete isso.

### 5.5 Waterfall como lista vertical rotulada com sinal

O Olist mostra `(+) Faturamento`, `(-) Comissões`, `(+) Incentivos` — o sinal no rótulo, valor à direita, uma linha por conceito.

O Kyneti hoje usa **cards lado a lado** na `FinanceiroPage`. Com 8 linhas (receita → deduções → variáveis → margem → Ads → margem após Ads → despesas fixas → resultado), cards ficam apertados e perdem a sequência.

**Aplicar:** trocar os cards por waterfall vertical, mantendo os dois números finais em destaque. **Zero mudança de backend** — os campos já existem no `DreReport`.

### 5.6 Glossário embutido

O Olist tem uma aba `Glossário` explicando cada linha do waterfall.

O Kyneti tem conceitos ainda menos óbvios (piso líquido, faixa de comissão, rateio de Ads por SKU, `dataQuality`). **Aplicar:** aba de glossário na `FinanceiroPage` e na tela de preço.

### 5.7 Atalhos de teclado em telas de volume

Conferência de compra e Separação têm `CTRL+X` importar XML, `CTRL+I` conferir, `CTRL+S` separar, `CTRL+E` embalar.

**Aplicar em:** `ConferenciaPage` e `DispatchBatchesPage` — telas onde o operador repete a mesma ação dezenas de vezes.

### 5.8 Preço promocional riscado na própria lista

O Olist mostra `49,90` riscado com `39,90` embaixo, direto no catálogo.

**Aplicar em:** `CatalogPage` — o Kyneti tem Promoções como módulo separado; mostrar o efeito no catálogo é mais direto.

### 5.9 O que NÃO copiar

- **Menu `mais ações` com 12 itens sem hierarquia** — mistura exportação, saneamento fiscal e reajuste de preço no mesmo nível.
- **Duas telas chamadas "Categorias"** com sentidos diferentes (`/categorias` é plano de contas; categoria de produto é `/produto_categorias`). Confundiu inclusive este mapeamento.
- **Custo do pai vazio quando as variações têm custo** — induz a ler errado.
- **Submenu que só abre por clique no item da barra lateral**, sem estado persistente. Foi o maior obstáculo desta análise.

---

## 6. Ordem sugerida

| # | Item | Tipo | Por quê |
|---|---|---|---|
| 1 | `TaxRateResolver` — alíquota calculada por RBT12 + ST/monofásico (§1.1) | Correção | O Kyneti está errado; ~R$ 15k/semestre de imposto fantasma |
| 2 | Importar variações do Olist | Pendência | 937 SKUs, não 340 — sem isso o catálogo não existe |
| 3 | Waterfall vertical + glossário (§5.5, §5.6) | Frontend | Zero backend; o DRE ficou ilegível em cards |
| 4 | Conciliação tolerante a split payment | Prazo | **Antes de 2027**, ou vira falso positivo em massa |
| 5 | Comparador de regime (Simples × regular de IBS/CBS) | Criar | Janela de decisão em **setembro/2026** |
| 6 | Prazo de despacho (§2.2) | Absorver | Liga operação a reputação a margem |
| 7 | Módulo de devoluções (§2.1) | Criar | R$8.7k em 2 meses fora do resultado |
| 8 | Plano de contas com linha de DRE (§2.3) | Absorver | Fecha o `resultadoOperacional` |
| 9 | Painel de Automações (§2.4) | Frontend | Zero backend; responde "o que roda sozinho?" |
| 10 | Auditoria taxa × repasse (§3.3) | Criar | Diferencial que nenhum concorrente tem |
| 11 | TikTok Shop | Criar | 931 anúncios sem cobertura |

Os itens 3 e 9 são só frontend sobre backend existente — entregam valor visível sem risco.

Os itens 1, 4 e 5 saíram da pesquisa tributária de 02/08/2026
([tributacao-br-regimes-e-reforma.md](./tributacao-br-regimes-e-reforma.md)). O 4
e o 5 têm **data marcada por lei**, não por conveniência — a ordem completa da
frente tributária está na §6 daquele documento.
