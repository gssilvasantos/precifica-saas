# Panorama de Mercado — Precificação, Hub, ERP, Analytics e Financeiro (Brasil)

**Status:** levantamento inicial (nível "mapa de mercado"), não um benchmark de API como `bling-erp-benchmark-analysis.md`/`tiny-erp-benchmark-analysis.md`. Objetivo: listar quem já resolve, no todo ou em parte, cada uma das áreas de inteligência que o Kyneti cobre (Pricing Intelligence, Competition Intelligence, Marketplace Intelligence, Financial Intelligence, Analytics), para orientar posicionamento e priorização — não é ainda um parecer "absorver/aperfeiçoar/descartar" como os dois benchmarks de ERP.

**Metodologia:** busca web (fontes públicas, sites institucionais e comparativos de terceiros), sem acesso a documentação técnica/API de nenhuma dessas empresas — ao contrário dos benchmarks Bling/Tiny, que leram o Swagger real. Tratar como ponto de partida para aprofundar (ex.: se algum concorrente aqui virar prioridade, o próximo passo é o mesmo tratamento dado a Bling/Tiny: ler a documentação técnica real). **Seção 9** varre exatamente essa lacuna — quais desses sistemas têm API pública de verdade.

---

## 0. Alerta — colisão de nome com concorrente direto

**[Precifica](https://precifica.com.br/produtos/marketplace/)** é uma empresa brasileira já estabelecida que vende **exatamente** o que o módulo Pricing/Competition Intelligence do Kyneti faz: monitoramento de preço de concorrente em marketplace + precificação dinâmica com regras/limites + simulação de margem/markup, com sincronização a ERPs. Características divulgadas:

- Cria e habilita regras de precificação que alteram o preço diretamente nos marketplaces, 24×7.
- Define limites (piso/teto) enquanto o sistema busca o melhor preço dentro deles — mesmo conceito de `desiredMarginPct`/`minimumMarginPct` do Kyneti.
- Considera frete do concorrente no cálculo, não só o preço do produto.
- Agendamento de regras por data sazonal.
- Simulação de cenário de margem/markup antes de aplicar.
- Integra com e-commerces, marketplaces e ERPs.

O README atual do repositório (`README.md`, linha 1) usa "Precifica SaaS" como nome do produto — os docs internos mais recentes (`docs/bling-erp-benchmark-analysis.md`, `docs/tiny-erp-benchmark-analysis.md`) já usam **"Kyneti"**, então é possível que o rebranding já tenha acontecido e o README esteja só desatualizado. Vale confirmar: se "Precifica" ainda está em uso em qualquer lugar (README, prisma schema, nome de pacote), recomendo trocar por Kyneti nesses lugares para evitar confusão de marca com um concorrente direto já no mercado.

---

## 1. Precificação dinâmica / Repricing / Monitoramento de concorrência

Concorrentes diretos do módulo **Pricing Intelligence + Competition Intelligence** do Kyneti.

| Empresa | O que faz | Como se compara ao Kyneti |
|---|---|---|
| **[Precifica](https://precifica.com.br/)** | Repricing com regras + limites de piso/teto, monitoramento de concorrente (inclui frete do concorrente), agendamento sazonal, simulação de margem antes de aplicar | Concorrente mais direto encontrado — mesmo conceito central (regra de negócio + limite + aplicação automática opt-in). Kyneti tem a vantagem potencial de já nascer integrado ao ERP/catálogo/fiscal/logística (plataforma, não ferramenta isolada) |
| **[WinnerBox](https://winnerbox.com.br/)** | Repricing dinâmico focado em Mercado Livre e Amazon LatAm, 30+ estratégias pré-definidas, defesa de Buy Box, "cérebro estratégico" com IA para sugerir ação | Mais focado em automação agressiva de Buy Box; casos divulgados de +32% faturamento / -91% esforço manual após migrar de gestão manual. Especializado, não é plataforma de gestão completa |
| **[VC Price](https://www.vcprice.com.br/)** | Comparação de preço com concorrentes, regra tipo "meu preço = Buy Box − R$0,50" | Mais simples/tático que WinnerBox e Precifica; foco estreito em regra de distância de preço |
| **[Base](https://base.com/pt-BR/ajuda/knowledgebase/estrategia-de-precificacao-com-o-modulo-de-concorrencia/)** | ERP/plataforma com módulo de acompanhamento de concorrência no Mercado Livre e ajuste automático de anúncio por regra | Concorrente indireto — é ERP com módulo de precificação embutido, mesma lógica do Kyneti de "produto como ponto de agregação" |
| **[Jaguar Sheet](https://jaguarsheet.com/pt/blog/analisis-competencia-mercado-livre)** | Painel lateral (extensão) para análise de concorrência dentro do próprio Mercado Livre | Ferramenta leve, não é plataforma — referência de UX para "análise de concorrência no contexto do anúncio" |
| **[GoSmarter](https://gosmarter.com.br/)** | IA para análise de concorrência e decisão mais rápida em ML/Shopee, + conteúdo educacional forte sobre precificação (fórmulas, guias) | Mistura de produto + conteúdo/mídia; vale ler os artigos deles como fonte secundária de "linguagem do mercado" |

**Leitura para o PRD:** o Kyneti não está criando uma categoria nova — está entrando num mercado com pelo menos 4-5 players ativos fazendo repricing/monitoramento. A diferenciação real, pelo que já está documentado em `platform-architecture.md`, é **não ser uma ferramenta isolada de precificação, e sim um módulo dentro de uma plataforma que já conhece custo real (fiscal + logística + compra), margem líquida por pedido (DRE) e catálogo unificado** — nenhum concorrente listado acima menciona isso como pacote único.

---

## 2. Hub de integração de marketplace

Categoria adjacente ao módulo **ERP Integration** do Kyneti — não fazem precificação, mas competem pela mesma "conta" do lojista como camada de orquestração entre canais.

| Empresa | O que faz | Relevância |
|---|---|---|
| **[Anymarket](https://anymarket.com.br/)** | Hub de integração com 150+ marketplaces, 200+ funcionalidades, certificações Platinum ML / Diamante Magalu / Conectado Amazon. Sincroniza catálogo, preço, estoque, pedido entre ERP/loja e canais | Líder de categoria no Brasil — se o Kyneti algum dia expandir para "orquestrar N canais" além de Nuvemshop/ML/Shopee, é o benchmark técnico a ler primeiro (documentação de API deles, não só marketing) |
| **[Ideris](https://www.ideris.com.br/)** | Hub de integração (Parceiro Platinum ML), anúncio em massa, estoque unificado, regras de preço por canal, logística ponta a ponta, dashboards | Concorre de perto com Anymarket; tem "análise de concorrência" e "regra de preço por canal" como feature dentro do hub — mais um sinal de que o mercado já espera precificação + integração juntos, reforçando a tese de plataforma do Kyneti |

---

## 3. ERP (gestão de estoque, pedido, fiscal, financeiro)

Bling e Tiny/Olist já têm benchmark técnico profundo (`docs/bling-erp-benchmark-analysis.md`, `docs/tiny-erp-benchmark-analysis.md`, via Swagger real). Os itens abaixo são **outros ERPs relevantes ainda não benchmarcados**, mapeados só por pesquisa de mercado:

| Empresa | Perfil | Faixa de preço (2026, achado em comparativos de terceiros — validar antes de citar externamente) | Quando entraria na comparação |
|---|---|---|---|
| **Omie** | ERP de PME média, BPM (fluxo de processo customizável), módulos por setor, forte em financeiro/faturamento recorrente | R$ 450–1.800/mês | Cliente com operação mais complexa que revenda simples, ou que precisa de contrato recorrente — fora do perfil atual do Kyneti (revenda multicanal), mas referência de "financeiro robusto" |
| **ContaAzul** | Foco financeiro (contas a pagar/receber) + integração com contador | R$ 220–650/mês | Referência para o módulo Financial Intelligence do Kyneti — especialmente fluxo de conciliação com contador externo, que o Kyneti ainda não tem desenhado |
| **Nibo** | Similar a ContaAzul/Omie, focado em gestão financeira para contabilidade | — | Baixa prioridade — mesmo nicho de ContaAzul |
| **Linx ERP / Linx Commerce** | ERP de varejo (físico + online), 200+ parceiros no ecossistema Linx Commerce | — | Mais voltado a varejo com loja física — fora do perfil "seller multicanal" do Kyneti, baixa prioridade |
| **TOTVS (linha Consinco)** | ERP de varejo/supermercado, porte enterprise | — | Fora de escopo — porte e segmento (supermercado) não batem com o perfil de cliente do Kyneti |
| **Eccosys** | ERP focado em Nuvemshop (catálogo, estoque, NF-e, etiqueta, picking em um só lugar) | — | Concorrente direto de escopo mais estreito que Bling/Tiny — vale um benchmark leve se o Kyneti for competir especificamente por lojistas Nuvemshop-first |

**Nota sobre preços:** os valores acima vieram de blogs comparativos de terceiros, não das páginas oficiais de pricing — tratar como ordem de grandeza, não como dado a citar em material público sem confirmar na fonte primária.

---

## 4. Analytics / BI para sellers

Categoria adjacente ao módulo **Analytics** do Kyneti (ainda "Não iniciado" segundo `platform-architecture.md`, seção 2).

| Empresa | O que faz | Relevância |
|---|---|---|
| **[SellerUp](https://sellerup.app/)** | Análise de vendas para Mercado Livre e Shopee, comparação de preço entre canais, IA para tendência de produto | Referência direta de escopo para o futuro módulo Analytics do Kyneti |
| **[MLAnalise](https://mlanalise.com.br/)** | Análise de produtos e anúncios especificamente para Mercado Livre | Escopo mais estreito (ML apenas) — referência de profundidade de métrica por anúncio |
| **[SOFTClass](https://www.softclass.com.br/integracao-com-marketplaces)** | Integração de marketplace com sincronização de estoque, pedido centralizado e "relatórios avançados" | Genérico — menos diferenciado, baixa prioridade de estudo |

**Métricas citadas como padrão de mercado** (relevante para desenhar o módulo Analytics): GMV, ROI, CAC, taxa de conversão, reputação, cancelamento.

---

## 5. Financeiro / DRE / Conciliação de repasse

Concorrentes diretos e complementares do módulo **Financial Intelligence** do Kyneti (`financial-intelligence-architecture.md`) — especificamente da peça de reconciliação de repasse que hoje é o `ReceivableReconciliationService`/`settlement-import.controller.ts`.

| Empresa | O que faz | Relevância |
|---|---|---|
| **[Koncili](https://www.koncili.com/)** | "Primeiro conciliador de repasse de marketplace do Brasil" — reconciliação automática de repasse/adquirente, integra com múltiplos ERPs, alimenta DRE | Concorrente direto da peça de conciliação do Kyneti — vale ler a documentação de integração deles (como eles modelam "esperado vs. recebido" por marketplace) como referência técnica |
| **[GE Finance](https://ge.finance/)** | Conciliação automática, fluxo de caixa, DRE, balanço patrimonial, margem real por seller | Mais próximo do escopo completo do Financial Intelligence do Kyneti (DRE + margem real), não só conciliação |
| **TrackCash** | Conciliador financeiro, citado como integração alternativa da Ideris (ao lado de Koncili) | Mesmo nicho de Koncili — segunda fonte para comparar modelo de dados de conciliação |

---

## 6. Rodada 2 — pesquisa dirigida (Jodda, Letzee, Mercado Turbo, Magis5, Preço Certo, Confery, GE Finance, Emori)

Pedido explícito do usuário: estudar essas 8 empresas para dar suporte ao desenvolvimento do Kyneti. Duas delas (**Preço Certo** e **Magis5**) têm central de ajuda pública de verdade (não só site de marketing) — foram lidas diretamente. As demais só têm conteúdo de marketing/blog público; nenhuma expõe Swagger/API pública encontrada (diferente de Bling/Tiny), então o nível de detalhe é menor que os dois benchmarks originais.

### 6.1 Jodda.ia — "inteligência de lucro pedido a pedido"

**O que faz:** cruza pedido × produto × taxa × ADS × frete × tributo × custo de mercadoria × ERP × CNPJ para mostrar o **lucro real por pedido**, em todos os marketplaces (ML, Shopee, Amazon, Magalu) — não faturamento bruto. Também audita taxas/fretes/repasses para achar divergência, e sinaliza a alavanca certa a mexer (preço, campanha, promoção, custo ou cadastro tributário) quando a margem está ruim. Público-alvo declarado: sellers com R$100k+/mês, 2+ marketplaces, que usam ADS.

**Onde bate com o Kyneti:** é o concorrente mais completo encontrado em toda a pesquisa (rodada 1 + 2) para o conjunto **Financial Intelligence + Pricing Intelligence + Analytics** do Kyneti — a mesma tese de "produto como ponto de agregação de custo real" que está em `platform-architecture.md`, seção 8. A diferença que vale estudar: a Jodda inclui **custo de ADS atribuído por pedido** no cálculo de margem — verificar se o `financial-intelligence-architecture.md` do Kyneti já desconta gasto de Ads (módulo `marketplace-ads-*` existe, mas não está confirmado que o gasto por campanha é rateado e descontado no DRE por pedido). Se não estiver, é o gap mais valioso encontrado nesta rodada.

### 6.2 Letzee — margem por anúncio + extensão de navegador + IA

**O que faz:** "Lucro Verdadeiro por Anúncio" — margem de contribuição real por venda (comissão + frete + imposto + Ads), calculada em tempo real, injetada **diretamente na página do Mercado Livre** via extensão de navegador (Chrome Web Store, também listada na Central de Partners do ML). Mostra quais campanhas de Ads gastam sem converter. "Central de Envios" sugere reposição de estoque com base no ritmo real de venda. Tem também IA para responder clientes automaticamente (fora do escopo do Kyneti).

**Onde bate com o Kyneti:** o padrão de **extensão de navegador injetando dado de margem direto na tela de criação/edição de anúncio do marketplace** aparece aqui e em Mercado Turbo — é um padrão de distribuição/UX recorrente no mercado brasileiro que o Kyneti (hoje web app próprio, `apps/web`) não tem. Vale registrar como ideia de crescimento futura, não como prioridade de arquitetura agora. A sugestão de reposição por ritmo de venda é equivalente ao `ReplenishmentAdvisorService` do Kyneti (Logistics Intelligence) — já coberto.

### 6.3 Mercado Turbo — gestão de anúncio em escala + DRE + Curva ABC

**O que faz:** App Certified Platinum do Mercado Livre. Gestão de anúncios/SKU em massa, dashboard com DRE, Curva ABC, "Raio-x de Anúncios", vendas por estado, monitoramento de concorrente. Também tem extensão de navegador que calcula margem de contribuição dinamicamente ao aplicar desconto na própria tela de venda do ML.

**Onde bate com o Kyneti:** a feature de **cruzar Curva ABC de faturamento com Curva ABC de margem de contribuição** (achar produto que vende pouco mas dá ótima margem, vs. campeão de venda que "sangra margem em silêncio") é uma ideia concreta e ainda não coberta pelo módulo Analytics do Kyneti (que está "Não iniciado" segundo `platform-architecture.md`). Vale anotar como requisito quando esse módulo for desenhado.

### 6.4 Magis5 — Hub de integração + precificação automática (documentação lida)

**O que faz:** hub de integração (concorrente de Anymarket/Ideris, seção 2) que conecta ERP a ~10+ marketplaces (ML, Americanas, Shopee, Magalu, Amazon, Via Varejo, Madeira Madeira, TikTok Shop, AliExpress, Carrefour, Leroy Merlin) + ERPs (Omie, Sankhya, Bling, e API pública genérica) + tem ERP próprio opcional.

**Precificação automática (lida na central de ajuda):**
- Dois níveis de configuração: **por Produto** (aplica a todos os anúncios) e **por Anúncio** (override específico) — regra de precedência explícita: "se o anúncio tem configuração própria, usa a do anúncio; senão, usa a do produto."
- Campos por produto: custo operacional (R$ fixo — embalagem etc.), % de lucro líquido desejado, comissão por marketplace (opcional, por tipo de produto).
- Por marketplace: taxa extra em % ou R$ fixo, e **taxas por faixa de peso** do produto.
- Fórmula: parte do custo cadastrado no ERP + custo operacional + margem desejada, aplicando as comissões/taxas específicas do canal.

**Onde bate com o Kyneti:** essa é a comparação estruturalmente mais próxima do `pricing-intelligence-architecture.md` + `marketplace-intelligence-architecture.md` do Kyneti que a pesquisa encontrou. Dois pontos concretos para revisar contra o desenho atual:
1. **Precedência anúncio > produto** — o Kyneti hoje precifica por produto (`desiredMarginPct`/`minimumMarginPct` em `Product`); confirmar se `PriceList`/`PriceListException` (já implementado, `price-lists-architecture.md`) cobre override por **anúncio/canal específico** e não só por produto — se não cobrir, é um gap real de granularidade.
2. **Taxa por faixa de peso do marketplace** — o Kyneti já tem `LogisticsSettings.cubicWeightFactor` e Marketplace Intelligence versionado por regra; confirmar se as regras de comissão (`FeeRuleProvider`) já suportam faixa de peso como dimensão de variação de taxa (alguns marketplaces cobram comissão/frete diferente por peso), ou se hoje é só por categoria/valor.

### 6.5 Preço Certo — precificação + método + consultor humano (documentação lida)

**O que faz:** plataforma de formação de preço via margem de contribuição, com um diferencial de modelo de negócio, não só de produto: **um especialista humano valida cada decisão** ("método calibrado em mais de 30.000 reuniões, o software mostra o problema e gente experiente resolve"). Reconhecida pelo Santander como melhor plataforma de preço do Brasil. Preço sob medida por volume de pedido.

**Modelo de dados (lido na base de conhecimento):** cadastro em 3 blocos — Dados Básicos (cadastro), Dados de Compra (preço de fornecedor, tempo de estocagem, capital de giro), Dados de Venda (comissão de canal, custo de adiantamento de recebível, comissão de vendedor, política de frete grátis). Precifica por **Margem** (define % de lucro desejado) ou por **Preço** (fixa valor e o sistema calcula a margem resultante) — os dois caminhos que o `Product.desiredMarginPct` do Kyneti já cobre de um lado (margem → preço); o caminho inverso (fixar preço, calcular margem resultante) vale conferir se o simulador de margem do Kyneti (Pricing Intelligence) já suporta como fluxo de entrada alternativo.

**Onde bate com o Kyneti:** o achado mais importante aqui não é técnico, é de **modelo de negócio**: a Preço Certo prova que existe demanda paga por "software + humano validando a decisão" no segmento de precificação — não é algo para o Kyneti construir, mas é um sinal de posicionamento (o Kyneti pode se diferenciar justamente por ser 100% self-service/automatizado, ou pode considerar um tier de consultoria no futuro). Vale registrar como nota de estratégia de produto, não de arquitetura.

### 6.6 Confery — conciliação de repasse (concorrente direto do `ReceivableReconciliationService`)

**O que faz:** confere recebimento liberado pelo marketplace (ML, Shopee, Amazon) e faz **baixa automática da conta a receber** no ERP (Bling ou Olist/Tiny) — inclusive pedidos do Full do Mercado Livre. Rastreia reembolso/devolução separadamente por transação.

**Onde bate com o Kyneti:** é o concorrente direto mais específico da peça de reconciliação (`financial-intelligence-architecture.md`, `settlement-import.controller.ts`). Diferença estrutural importante: a Confery **empurra a baixa para um ERP externo** (Bling/Olist) porque ela não é o ERP — o Kyneti já é dono do módulo financeiro (`AccountsPayable`/`ReceivableRecord` nativos), então não precisa desse passo de "escrever de volta em outro sistema". Ponto de atenção real: o texto público da Confery **não menciona como trata divergência/glosa** (recebido ≠ esperado) — não dá para saber se eles têm um fluxo de exceção ou só conciliam o que bate. Vale usar isso como diferenciação a comunicar: se o `ReceivableReconciliationService` do Kyneti já trata divergência explicitamente (vale conferir o doc), isso é vantagem competitiva a destacar no PRD.

### 6.7 GE Finance — já coberto na rodada 1

Confirmado sem informação nova relevante além do que já está na seção 5 (conciliação + fluxo de caixa + DRE + margem real).

### 6.8 Emori — dashboard de margem para Mercado Livre/Shopee

**O que faz:** dashboard multi-conta (ML + Shopee) com margem de contribuição por pedido (taxa + frete + imposto + Ads já descontados), previsão/sugestão de compra de estoque, Curva ABC, faturamento por canal, gestão de campanha de Ads, integração com WhatsApp. Termos de uso deixam claro que os dados vêm 100% da API do Mercado Livre via token do usuário (sem parceria formal declarada).

**Onde bate com o Kyneti:** mais um exemplo (junto de Jodda, Letzee, Mercado Turbo) do mesmo padrão repetido — "margem de contribuição por pedido com tudo descontado" é a feature mais replicada de todo o mercado pesquisado até agora. Confirma que é tabela-stakes (requisito mínimo esperado pelo mercado), não diferencial — o Kyneti precisa ter isso muito bem feito, mas não deveria vender isso sozinho como diferenciador.

---

## 7. Padrão que se repete entre (quase) todos os concorrentes — atenção para o PRD

Depois de 13 empresas pesquisadas (rodada 1 + 2), um padrão fica claro:

**"Margem de contribuição real por pedido/anúncio, com comissão + frete + imposto + Ads descontados em tempo real"** aparece em Jodda, Letzee, Mercado Turbo, Emori, Preço Certo e (com sinal mais fraco) GoSmarter, WinnerBox, Precifica. É o requisito mínimo do mercado inteiro, não um diferencial de ninguém específico — **isso valida a decisão do Kyneti de ter o DRE por pedido como parte do core** (`financial-intelligence-architecture.md`), mas também significa que só ter essa feature não é suficiente para diferenciar.

Dois gaps concretos, novos nesta rodada, que valem uma conferência rápida no código/docs existentes antes de qualquer decisão:

1. **Custo de Ads atribuído por pedido, descontado do DRE por pedido** (achado na Jodda e replicado em quase todas) — confirmar se o módulo `marketplace-ads-*` do Kyneti já alimenta o Financial Intelligence com esse rateio, ou se hoje são dois módulos que não se falam.
2. **Precedência de configuração de preço por Anúncio > por Produto** (achado detalhado na Magis5) — confirmar granularidade real do `PriceList`/`PriceListException` do Kyneti.

Um terceiro achado, de padrão de distribuição/UX (não de arquitetura): **extensão de navegador que injeta margem/lucro direto na tela do marketplace** (Letzee, Mercado Turbo) é recorrente o suficiente para valer uma nota de backlog de produto, sem virar prioridade agora.

---

## 8. Síntese para o PRD

1. **O Kyneti compete, hoje, em pelo menos 5 categorias que no mercado existem como produtos separados** (repricer, hub de integração, ERP, analytics de seller, conciliador financeiro) — a tese de plataforma unificada (`platform-architecture.md`, seção 1) é a aposta de diferenciação, e cada concorrente acima é validação de que existe demanda paga para a fatia isolada. Vale registrar isso explicitamente no PRD como comparação de categoria, não só "concorrentes".
2. **Risco de nome com "Precifica" (seção 0)** — decisão a tomar antes de qualquer material de posicionamento externo.
3. **Maior gap de pesquisa real, não coberto aqui:** nenhuma das empresas acima teve documentação técnica (API/Swagger) lida — foi tudo pesquisa de marketing/comparativo de terceiros. Se algum desses virar prioridade de "benchmark de verdade" (mesmo tratamento dado a Bling/Tiny), os candidatos mais fortes por proximidade de escopo são **Precifica** (pricing), **Anymarket ou Ideris** (integração) e **Koncili** (conciliação) — nessa ordem de relevância direta ao core do Kyneti.

---

## 9. Base de conhecimento — quem tem API pública de verdade

Levantamento dirigido: para cada um dos ~21 sistemas pesquisados (rodadas 1+2), verificado se existe documentação de API destinada a integração por terceiros (portal de desenvolvedor, Swagger/OpenAPI, referência REST, webhooks) — não site de marketing. Nenhum Swagger foi lido endpoint-a-endpoint ainda (isso é o "próximo passo", se algum destes virar prioridade, no mesmo nível dos benchmarks Bling/Tiny). Aqui só mapeamos **existência, abertura de acesso e superfície aproximada**.

### 9.1 API pública real, self-service (sem precisar de aprovação comercial)

| Sistema | Auth | Superfície | Nota |
|---|---|---|---|
| **Omie** | `app_key`/`app_secret` | 80+ serviços: Geral, CRM, Financeiro (contas, PIX/boleto), Compras/Estoque, Vendas/Faturamento, NF-e/NFS-e, tabelas fiscais (CFOP/NCM/ICMS/PIS-COFINS) | `developer.omie.com.br` — protocolo majoritariamente JSON/SOAP (v1); REST/Swagger "em desenvolvimento" segundo achado |
| **ContaAzul** | OAuth 2.0 | Vendas, Contratos, Financeiro (contas, categorias, centro de custo), Pessoas, Produtos/Serviços | `developers.contaazul.com` — OpenAPI/Swagger real, portal renovado em 2025 |
| **Ideris** | Login → JWT (20h) ou API key, suporta OAuth2 | Autenticação, marketplaces, produtos (CRUD), categorias/subcategorias, marcas, estoque, pedidos | Swagger + Postman público, sandbox auto-criado sem aprovação prévia — o mais aberto de todos os hubs pesquisados |
| **Koncili** | JWT (access+refresh) | "Marketplace API" (integra canal → Koncili) + "Financial/ERP API" (baixa automática no ERP), com suporte a MCP | `developers.koncili.com/en` |
| **Base / BaseLinker** | API token (`X-BLToken`) | Pedidos, produtos/preços (`updateInventoryProductsPrices`), grupos de preço, courier/logística | `api.baselinker.com` — 100 req/min. É a mesma "Base" da seção 1 (rebrand internacional da BaseLinker) |

### 9.2 API pública real, mas com atrito (homologação, plano pago, ou rasa)

| Sistema | Restrição | Nota |
|---|---|---|
| **Anymarket** | Exige token via gerente de conta + homologação de parceiro antes de produção | Documentação completa (`developers.anymarket.com.br`) inclui BackOffice API + Marketplace API + webhooks de pedido/produto + sandbox — tecnicamente mais robusta que Ideris, mas não é auto-cadastro |
| **Nibo** | Só para clientes do plano Premium | `nibo.readme.io` — protocolo OData, escopo estreito (contas a pagar/receber, clientes, fornecedores) |
| **Eccosys** | Self-service só para cliente ativo (credencial via artigo de ajuda) | Documentação via Postman, não Swagger UI — mais rasa que Omie/ContaAzul; limite de requisição varia por plano |
| **TrackCash** | Basic Auth simples, mas API de escopo muito estreito | Só `GET /api/payments` (conciliação agregada) — não é uma API de produto completa |
| **Mercado Turbo** | Precisa ativar em "Minha Conta" | Bearer token; único endpoint encontrado é `POST /rest/produtos/sku/{sku}` (atualizar custo/imposto do SKU) — escopo mínimo |

### 9.3 Só parceiro / acesso fechado (existe API, mas não é integrável sem negociação)

| Sistema | Situação |
|---|---|
| **Magis5 (Hub)** | Portal `developers.magis5.com.br` existe (Stoplight) mas retornou vazio/404 nas tentativas de acesso — indício de conteúdo raso ou restrito; central de ajuda pública só documenta o Magis5 como **consumidor** de APIs de terceiros, não como provedor |
| **Linx** | Documentação só na base interna "Linx Share", com endpoints por loja individual — integração via parceiro/implantação, não cadastro aberto |
| **TOTVS** | Fragmentado por linha de produto (RM, Datasul, Fluig), Swagger hospedado no ambiente on-premise do próprio cliente — pressupõe implantação TOTVS já em curso |

### 9.4 Nenhuma API pública encontrada

**Precifica, WinnerBox, VC Price, Jaguar Sheet, Jodda.ia, Letzee, Preço Certo, SellerUp, MLAnalise, SOFTClass, GE Finance, Emori, Confery.**

Padrão comum: são ferramentas SaaS fechadas, voltadas a usuário final via navegador/extensão, sem intenção declarada de virar plataforma para terceiros integrarem. Onde existe integração (ex.: Confery ↔ Bling/Olist, Preço Certo ↔ Bling/Tiny/Magis5/Ideris/Lexos), é a própria empresa consumindo a API do outro lado (ERP), não expondo a própria API. Duas notas de rodapé técnicas: Jodda.ia e Preço Certo mencionam nos respectivos sites uma camada interna chamada "API & MCP" (parece ser infraestrutura de IA/agente, não API de integração para terceiros) — vale reconfirmar se algum dia isso mudar de status.

### 9.5 Leitura para o Kyneti

1. **Nenhum concorrente direto de precificação (Precifica, WinnerBox, VC Price, Jodda, Letzee, Preço Certo) expõe API própria.** Isso limita o quanto dá pra estudar tecnicamente a fundo (não tem Swagger pra ler, ao contrário de Bling/Tiny) — o conhecimento sobre eles fica no nível "o que o produto faz", não "como o dado é modelado". Não é um gap de pesquisa nosso, é uma característica real do mercado.
2. **Os únicos 5 sistemas com API pública self-service de verdade (Omie, ContaAzul, Ideris, Koncili, Base/BaseLinker) são os candidatos certos para um benchmark técnico real** (mesmo tratamento dado a Bling/Tiny: ler o Swagger, comparar schema a schema) — e coincide bem com prioridade de produto: Koncili (conciliação, disputa direta com `ReceivableReconciliationService`), Ideris (hub, se o Kyneti algum dia orquestrar múltiplos canais além de ML/Shopee/Nuvemshop) e Omie/ContaAzul (financeiro, se algum módulo do Kyneti precisar interoperar com a contabilidade externa do cliente).
3. **Anymarket, apesar de exigir homologação, tem a documentação mais completa entre os hubs** — se o objetivo for só ler e aprender (não integrar de fato agora), vale pedir para o usuário confirmar se há acesso de leitura à doc sem precisar do processo de parceiro.

---

## Fontes

- [Precifica | Marketplace](https://precifica.com.br/produtos/marketplace/)
- [WinnerBox](https://winnerbox.com.br/)
- [VC Price](https://www.vcprice.com.br/)
- [Base — Análise de Concorrência e Reprecificador Mercado Livre](https://base.com/pt-BR/ajuda/knowledgebase/estrategia-de-precificacao-com-o-modulo-de-concorrencia/)
- [Jaguar Sheet — Análise de concorrência no Mercado Livre 2026](https://jaguarsheet.com/pt/blog/analisis-competencia-mercado-livre)
- [GoSmarter](https://gosmarter.com.br/)
- [ANYMARKET](https://anymarket.com.br/)
- [Ideris](https://www.ideris.com.br/)
- [Tiny vs Bling vs Conta Azul vs Omie — comparativo 2026](https://adrion.com.br/blog/tiny-bling-conta-azul-omie-comparativo-honesto-pme/)
- [ERP 2026: Conta Azul vs Omie vs Bling vs Tiny](https://dinheirodaminhaempresa.com/comparativos/erp-conta-azul-omie-bling-tiny-2026/)
- [Melhor ERP Marketplace 2026: Bling, Tiny, Omie, Eccosys](https://gosmarter.com.br/melhor-erp-marketplace-2026/)
- [Linx Commerce](https://linxcommerce.com.br/)
- [TOTVS Varejo Supermercados — Linha Consinco](https://produtos.totvs.com/ficha-tecnica/tudo-sobre-o-totvs-varejo-supermercados-linha-consinco/)
- [eccosys ERP — Nuvemshop](https://www.nuvemshop.com.br/loja-aplicativos-nuvem/erp-eccosys)
- [SellerUp](https://sellerup.app/)
- [MLAnalise](https://mlanalise.com.br/)
- [SOFTClass](https://www.softclass.com.br/integracao-com-marketplaces)
- [Koncili](https://www.koncili.com/)
- [GE Finance](https://ge.finance/)
- [Ideris — Conciliação financeira para marketplaces](https://www.ideris.com.br/blog/conciliacao-financeira-marketplace/)
- [Jodda.ia](https://joddaia.com.br/) · [Lucro real em marketplace](https://joddaia.com.br/lucro-real-marketplace/)
- [Letzee](https://letzee.ai/)
- [Mercado Turbo](https://www.mercadoturbo.com.br/) · [Funcionalidades](https://mercadoturbo.com.br/funcionalidades/)
- [Magis5 Hub](https://magis5.com.br/hub-integracao-automacao/) · [Central de Ajuda — Precificação Automática](https://ajuda.magis5.com.br/produtos/precifica%C3%A7%C3%A3o-autom%C3%A1tica/configura%C3%A7%C3%A3o-margens-e-custos) · [Quais sistemas o Hub integra](https://ajuda.magis5.com.br/quais-sistemas-o-magis5-hub-integra)
- [Preço Certo](https://precocerto.co/) · [Base de Conhecimento — Como precificar um produto](https://precocerto.helpscoutdocs.com/article/36-como-precificar-um-produto-usando-a-preco-certo)
- [Confery](https://confery.com.br/)
- [GE Finance](https://ge.finance/)
- [Emori](https://emori.com.br/)
- [Omie Developers](https://developer.omie.com.br/)
- [ContaAzul Developers](https://developers.contaazul.com/)
- [Ideris — Documentação (Postman)](https://documenter.getpostman.com/view/4554319/S1a63SJM)
- [Anymarket Developers](https://developers.anymarket.com.br/api/v2)
- [Koncili Developers](https://developers.koncili.com/en/)
- [BaseLinker API](https://api.baselinker.com/)
- [Nibo Developers](https://nibo.readme.io/)
- [Eccosys API (Postman)](https://documenter.getpostman.com/view/3495554/api-erp-eccosys)
- [Mercado Turbo — APIs](https://mercadoturbo.com.br/apis-mercado-turbo/)
