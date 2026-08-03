# Tributação brasileira — regimes, Reforma do Consumo e impacto no Kyneti

> Documento de fundamento. Escrito em 02/08/2026 a partir de fontes oficiais
> (Planalto, Receita Federal, Ministério da Fazenda, Comitê Gestor do IBS,
> Portal do Simples Nacional). Substitui a §1.1 de
> [olist-analise-absorver-criar.md](./olist-analise-absorver-criar.md), que
> estava **errada** — ver §2.
>
> **Nível de verificação (atualizado em 02/08/2026, após instalar o poppler):**
> as páginas HTML do gov.br/receitafederal, gov.br/fazenda, cgibs.gov.br e
> www8.receita.fazenda.gov.br foram abertas e lidas diretamente. Com o poppler
> instalado, também foram baixados e extraídos por completo:
>
> - **Perguntas e Respostas do Simples Nacional** (Receita Federal, 104 páginas)
> - **Manual do PGDAS-D** (Receita Federal) — com exemplos de cálculo oficiais
> - **CPC 47 / IFRS 15** (CVM)
>
> O planalto.gov.br recusa conexão a partir deste ambiente, mas o Guilherme
> forneceu os PDFs oficiais da **LC 123/2006** e da **Lei 6.404/1976**, ambos
> lidos em texto integral — art. 18 §§ 1º-A, 1º-B, 2º, 4º-A e 12, e art. 187
> incisos I a VII.
>
> **O que permanece não conferido**, e segue marcado com ⚠️: a 6ª faixa do
> Anexo I (só se aplica acima de R$ 3,6 mi), o texto literal da LC 214/2025 e da
> Lei 10.147/2000, e o DIFAL (nem pesquisado — ver §6.4). **Conferir com o
> contador antes de virar código.** O que está sem marca foi lido em fonte
> oficial.

---

## 0. Por que este documento existe

O Kyneti tem **um único campo de imposto**: `CatalogSettings.taxRatePct`, um
`Float` por tenant ([schema.prisma:745](../apps/api/prisma/schema.prisma#L745)),
comentado como "alíquota efetiva estimada (%)". Esse número entra:

- no piso de preço — `denominator = 1 − comissão − taxRate − margem`
  ([pricing-strategist.ts](../apps/api/src/modules/pricing-intelligence/domain/pricing-strategist.ts))
- na margem líquida de cada pedido — `tax = price × taxRate`
- no DRE, na linha de deduções
- no simulador de promoção
  ([margin-calculator.ts](../apps/api/src/modules/promotion-intelligence/domain/margin-calculator.ts))

Ou seja: **um número digitado à mão governa todo o dinheiro do sistema.** Se ele
estiver errado, tudo o que o Kyneti afirma sobre margem está errado junto — e o
sistema não tem como saber.

Este documento estabelece o que esse número realmente é em cada regime, e o que
a Reforma Tributária faz com ele.

---

## 1. Os quatro regimes

### 1.1 MEI / SIMEI — o imposto **não é percentual**

O MEI recolhe um **valor fixo mensal** (DAS-SIMEI), calculado sobre o
salário-mínimo, não sobre o faturamento:

| Componente | Valor |
|---|---|
| INSS | 5% do salário-mínimo vigente |
| ICMS (comércio) | R$ 1,00 |
| ISS (serviços) | R$ 5,00 |

> "O valor do imposto mensal (DAS) é calculado com base em um percentual fixo do
> salário-mínimo nacional vigente, acrescido de impostos de acordo com a sua
> atividade (ICMS e/ou ISS). O aumento do teto de faturamento em si não altera o
> valor do DAS."
> — [Receita Federal / Portal do Simples Nacional](https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3)

**Limite de receita — mudou em junho/2026.** O teto sai de R$ 81.000/ano e sobe
de forma progressiva: **R$ 110.000 em 2027** e **R$ 140.000 em 2028**. O MEI
também passa a poder contratar **até dois empregados**.
([Planalto, 06/2026](https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/2026/06/governo-amplia-limite-de-faturamento-do-mei-para-ate-r-140-mil-em-2028-e-autoriza-dois-empregados))

**Consequência direta para o Kyneti:** para um tenant MEI, `taxRatePct` **deve
ser 0** no piso de preço, e o DAS deve entrar como `FixedExpense` mensal. Hoje o
sistema obriga o usuário a digitar um percentual — e **qualquer valor que ele
digite está errado**. Digitar 6% num produto de R$ 50 cobra R$ 3,00 de imposto
que não existe; o DAS é o mesmo R$ 76 vendendo R$ 1.000 ou R$ 6.750 no mês.

Também é o único regime em que **vender mais não aumenta o imposto** — até
estourar o teto, quando o custo tributário dá um salto. Um alerta de
"faturamento acumulado vs. teto do MEI" vale mais para esse tenant do que
qualquer sugestão de preço.

### 1.2 Simples Nacional — a alíquota é **calculada**, não configurada

Este é o ponto em que minha análise anterior errou.

A alíquota efetiva sai de uma fórmula definida no art. 18 da LC 123/2006:

```
Alíquota efetiva = (RBT12 × Alíquota nominal − Parcela a Deduzir) / RBT12
```

Onde:

- **RBT12** = receita bruta acumulada nos **12 meses anteriores** ao período de apuração
- **Alíquota nominal** e **Parcela a Deduzir** = constantes dos Anexos I a V, escolhidas pela faixa em que o RBT12 cai

Texto literal (LC 123/2006, art. 18, §1º-A, incluído pela LC 155/2016):

> "**§ 1º-A.** A alíquota efetiva é o resultado de: `(RBT12 × Aliq − PD) / RBT12`,
> em que:
> **I** - RBT12: receita bruta acumulada nos doze meses anteriores ao período de
> apuração;
> **II** - Aliq: alíquota nominal constante dos Anexos I a V desta Lei
> Complementar;
> **III** - PD: parcela a deduzir constante dos Anexos I a V desta Lei
> Complementar."

E o §1º-B é a base legal da partilha — o que o Manual do PGDAS-D mostrava por
exemplo, a lei diz por escrito:

> "**§ 1º-B.** Os percentuais efetivos de cada tributo serão calculados a partir
> da **alíquota efetiva, multiplicada pelo percentual de repartição** constante
> dos Anexos I a V desta Lei Complementar, observando-se que:
> **I** - o percentual efetivo **máximo destinado ao ISS será de 5%**,
> transferindo-se eventual diferença, de forma proporcional, aos tributos
> federais da mesma faixa de receita bruta anual;
> **II** - eventual **diferença centesimal** entre o total dos percentuais e a
> alíquota efetiva será transferida para o **tributo com maior percentual de
> repartição** na respectiva faixa."

Duas regras finas que só a lei traz, e que o `TaxRateResolver` precisa
implementar para bater com o PGDAS-D centavo a centavo:

- **Teto de 5% no ISS** com redistribuição proporcional aos tributos federais.
  Só afeta Anexos III a V (serviços), mas quebra a ideia de que a partilha é um
  vetor fixo.
- **Resíduo de arredondamento** vai para o tributo de maior repartição da faixa
  (no Anexo I, a CPP com 41,5%/42%). Importa justamente porque nosso cálculo
  *subtrai* fatias — se arredondarmos antes de subtrair, divergimos do oficial.

**Anexo I — Comércio**

| Faixa | RBT12 | Alíquota nominal | Parcela a deduzir | Verificação |
|---|---|---|---|---|
| 1ª | até R$ 180.000,00 | 4,00% | — | ✅ Manual do PGDAS-D |
| 2ª | R$ 180.000,01 a R$ 360.000,00 | 7,30% | R$ 5.940,00 | ✅ Perguntas e Respostas + Manual |
| 3ª | R$ 360.000,01 a R$ 720.000,00 | 9,50% | R$ 13.860,00 | ✅ Manual do PGDAS-D |
| 4ª | R$ 720.000,01 a R$ 1.800.000,00 | 10,70% | R$ 22.500,00 | ✅ Manual do PGDAS-D |
| 5ª | R$ 1.800.000,01 a R$ 3.600.000,00 | 14,30% | R$ 87.300,00 | ✅ SEFA/PR |
| 6ª | R$ 3.600.000,01 a R$ 4.800.000,00 | 19,00% | R$ 378.000,00 | ⚠️ **não conferida** |

Cinco das seis faixas têm exemplo de cálculo oficial. A 1ª está confirmada pela
regra "na 1ª faixa, alíquota efetiva = alíquota nominal" (parcela a deduzir zero)
no Manual do PGDAS-D. A 6ª só se aplica acima de R$ 3,6 milhões — irrelevante
hoje para esta conta, mas precisa ser conferida antes de virar constante.

#### Partilha — e como ela é aplicada

O Manual do PGDAS-D traz a regra em uma linha:

> **Alíquota efetiva do tributo = alíquota nominal do tributo × alíquota efetiva do PA**

E o exemplo oficial (RBT12 R$ 300.000, Anexo I, efetiva 5,32%):

| | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | ICMS | Total |
|---|---|---|---|---|---|---|---|
| **Partilha — 2ª faixa** | 5,50% | 3,50% | 12,74% | 2,76% | 41,50% | 34,00% | 100% |
| Alíquota efetiva | 0,29260% | 0,18620% | 0,67777% | 0,14683% | 2,20780% | 1,80880% | **5,32%** |

Isso confirma o mecanismo inteiro: a partilha é aplicada **multiplicativamente
sobre a alíquota efetiva**. Retirar o ICMS de um produto com ST é retirar
`partilha_ICMS × efetiva` — remoção proporcional, exatamente como o
`TaxRateResolver` da §5 foi desenhado.

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | ICMS |
|---|---|---|---|---|---|---|
| 1ª e 2ª | 5,50% | 3,50% | 12,74% | 2,76% | 41,50% | 34,00% ✅ |
| 3ª a 5ª | 5,50% | 3,50% | 12,74% | 2,76% | 42,00% | 33,50% ✅ |
| 6ª | 13,50% | 10,00% | 28,27% | 6,13% | 42,10% | — ⚠️ |

#### RBT12 quando a empresa tem menos de 12 meses

Existe regra oficial, e ela **não** é bloquear — é proporcionalizar (Perguntas e
Respostas 5.4):

1. **1º mês:** RBT12 = receita do próprio mês × 12
2. **2º ao 12º mês:** RBT12 = média aritmética das receitas dos meses anteriores × 12
3. **13º mês em diante:** regra geral (soma dos 12 meses anteriores)

⚠️ **Divergência de redação a resolver antes de implementar.** O art. 18, §2º da
LC 123/2006 diz que "os valores de receita bruta acumulada constantes dos Anexos
I a V devem ser **proporcionalizados ao número de meses de atividade**" — ou
seja, proporcionaliza os **limites da tabela**. Já as Perguntas e Respostas 5.4
proporcionalizam a **RBT12** (× 12). Para *escolher a faixa* as duas dão o mesmo
resultado; para a **parcela a deduzir** dentro da fórmula, não necessariamente.
Os exemplos oficiais que encontrei caem todos na 1ª faixa, onde efetiva = nominal
e PD = 0, então não desempatam. **Um extrato do PGDAS-D de empresa nova
resolveria em um minuto.**

✅ **Atenção ao aplicar isso no Kyneti — e agora com prova.** Essa regra vale para
empresa em **início de atividade** (data de abertura do CNPJ). Não vale para o
caso comum do Kyneti: empresa antiga cujo histórico *no nosso banco* tem menos de
12 meses. Aí a receita anterior existe, só não está aqui — proporcionalizar
produziria um número errado com cara de certo.

O extrato real conferido na §1.2.7 demonstra a distinção: CNPJ aberto em
**12/09/2022**, todos os meses de 2025 aparecendo com **R$ 0,00**, primeira
receita registrada em 01/2026. Mesmo assim o PGDAS-D usou a **RBT12 comum** (soma
dos 12 meses anteriores) e deixou o campo **"RBT12 proporcionalizada" vazio** —
porque a empresa não está em início de atividade.

E o motivo dos zeros não é o que eu supus: a empresa era **MEI** em 2025 e migrou
para o Simples Nacional em 2026. Isso é um terceiro caso, tratado na §1.2.10.

"Sem receita", "sem histórico aqui" e "receita sob outro regime" são três coisas
distintas, e o resolver precisa separá-las: a primeira soma zeros normalmente; a
segunda **pede o faturamento anterior**; a terceira o Kyneti pode **já ter em
casa**.

#### Sublimite

- **R$ 3.600.000** — obrigatório
- **R$ 1.800.000** — opcional, adotado por alguns Estados; a relação é publicada
  a cada ano até o último dia útil de outubro

Vale **só** para ICMS e ISS: acima do sublimite esses dois saem do DAS e vão
para guia própria, com a empresa seguindo optante. Depende da UF do tenant.

#### 1.2.1 A alíquota também muda **por produto** — ST e monofásico

Esta é a parte que o campo único do Kyneti ignora por completo, e é onde está o
dinheiro.

> "A ME ou EPP optante pelo Simples Nacional que proceda à importação,
> industrialização ou comercialização de produtos sujeitos à substituição
> tributária ou tributação concentrada em única etapa (monofásica) de PIS/Pasep e
> Cofins deve segregar a receita decorrente da venda desse produto (...) de forma
> que **serão desconsiderados, no cálculo do Simples Nacional, os percentuais a
> elas correspondentes**."
> — [Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2023/fevereiro/operacao-autorregularizacao-do-simples-nacional-com-foco-em-pis-e-cofins-com-indicacao-de-existencia-de-tributacao-monofasica)

A pergunta **7.4** do documento oficial trata exatamente do nosso caso — comércio
que revende produto monofásico:

> "Ela deve destacar a receita decorrente da venda desse produto (...) e, sobre
> tal receita, **aplicar a alíquota efetiva calculada a partir da alíquota
> nominal prevista no Anexo I**, porém **desconsiderando, para fins de
> recolhimento em documento único de arrecadação (DAS), os percentuais
> correspondentes à contribuição para o PIS/Pasep e à Cofins**, nos termos do
> art. 18, § 4-A, inciso I, e § 12 da mesma Lei Complementar."
> — Perguntas e Respostas do Simples Nacional, 7.4

E a **7.1**, para ICMS-ST na condição de substituído (nosso caso no comércio):

> "O contribuinte deverá informar essas receitas destacadamente de modo que o
> aplicativo de cálculo **as desconsidere da base de cálculo dos tributos objeto
> de substituição**. Ressalte-se, porém, que essas receitas **continuam fazendo
> parte da base de cálculo dos demais tributos**."
> — Perguntas e Respostas do Simples Nacional, 7.1

Base normativa: art. 25, §6º da Resolução CGSN nº 140/2018, e art. 18, §4º-A, I e
§12 da LC 123/2006.

Dois detalhes que fecham o modelo:

1. A receita com ST/monofásico **continua contando no RBT12** — a segregação
   afeta só quais fatias saem da alíquota daquele produto, não a base que define
   a faixa.
2. A remoção é **proporcional sobre a alíquota efetiva** (`partilha × efetiva`),
   conforme a regra e o exemplo do Manual do PGDAS-D reproduzidos acima.

Traduzindo para a mesa de precificação: dois produtos do mesmo tenant, no mesmo
mês, com o mesmo RBT12, **pagam alíquotas diferentes** conforme sejam ou não
sujeitos a ST / monofásico.

E há um detalhe que fecha o raciocínio: o ICMS-ST **não é de graça** — ele foi
pago pelo substituto e já está **embutido no preço de compra**, portanto já está
dentro do `costPrice` que o Kyneti importa do ERP. Retirá-lo da alíquota é
exatamente o que evita **cobrá-lo duas vezes**.

#### 1.2.2 O erro concreto

O print do Olist mostrava, para 08/2026, alíquota **7,30%** sem ST.

7,30% é a **alíquota nominal da 2ª faixa** — não é alíquota efetiva de coisa
alguma. Que ela apareça digitada num campo de "alíquota" é o sintoma: alguém leu
a tabela e copiou o número da coluna errada.

> ⚠️ **Correção (02/08/2026).** A versão anterior desta seção estimava o RBT12 em
> "cerca de R$ 350 mil" a partir de um painel do Olist, concluía que a efetiva era
> 5,60% e projetava ~R$ 15 mil de imposto fantasma. **Os dois números estavam
> errados.** O extrato oficial do PGDAS-D (§1.2.7) mostra RBT12 de
> **R$ 605.574,89** — 3ª faixa, não 2ª — e efetiva de **7,21%**.
>
> Ou seja: o 7,30% digitado estava, *naquele momento*, a 0,09 ponto do valor
> correto. Quase certo por acaso. A conclusão de que um campo fixo está errado por
> construção continua de pé — e a §1.2.7 mostra que ele fica errado rápido — mas a
> magnitude que eu tinha atribuído era invenção minha em cima de um número que não
> conferi. Estimativa não substitui documento.

#### 1.2.3 Sublimite

O sublimite de **R$ 3.600.000** separa o que entra no DAS: acima dele, ICMS e ISS
passam a ser recolhidos **fora** do Simples, direto ao Estado/Município, mesmo
que a empresa continue optante. Um tenant crescendo perto desse número tem a
composição da alíquota alterada no meio do ano.

#### 1.2.3 🔴 São Paulo está desmontando a ST — e o tenant é de SP

Isso muda o desenho: **`icmsSt` não pode ser um booleano do produto.** É uma
propriedade de `(produto, data)`.

A SEFAZ-SP vem retirando mercadorias da substituição tributária em blocos, para
convergir com a Reforma — o modelo do IBS/CBS **não prevê ST**:

| Bloco | Portaria | Vigência | Escopo |
|---|---|---|---|
| 4º | [SRE 64/2025](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-64-de-2025.aspx) | **01/01/2026** | Revoga os Anexos IX, X, XV e XX da CAT 68/19 e itens dos XIV, XVI e XVII — medicamentos, bebidas alcoólicas, lâmpadas, artefatos de uso doméstico, itens da indústria alimentícia e de material de construção |
| — | [**SRE 94/2025**](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-94-de-2025.aspx) | **01/04/2026** | Revoga o **Anexo XI** — *produtos de perfumaria e de higiene pessoal*, 69 itens. Revoga também a SRE 48/25 (base de cálculo do segmento) |
| 5º | [SRE 34/2026](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-34-de-2026.aspx) | **01/10/2026** | Autopeças, pneumáticos, tintas, materiais elétricos, ferramentas, acumuladores e produtos eletroeletrônicos — 174 mercadorias |

Já são quase **dois terços** do que estava sujeito à ST.

##### O caso concreto deste tenant: cosméticos

O tenant revende **exclusivamente cosméticos** — ou seja, a portaria que o atinge
é a **SRE 94/2025**, e ela entrou em vigor em **01/04/2026**. Não é uma data
futura a preparar: é uma mudança que **já aconteceu há quatro meses** e que o
`taxRatePct` fixo não registrou.

O Anexo XI revogado cobria 69 itens nas faixas NCM 1211, 2712, 2814, 2847, 3006,
3301–3307, 3401, 3924, 3926, 4014–4015, 4202, 4818, 5601, 5603, 8203, 8214, 9018,
9025, 9603, 9605, 9615 e 9616 — de perfumes e maquiagem a xampus, dentifrícios,
desodorantes, sabonetes, papel higiênico, fraldas, absorventes e lâminas de
barbear.

**E aqui o desenho por NCM prova seu valor:** a lista da ST **não coincide** com a
lista do monofásico. A Lei 10.147/2000 cobre 3003, 3004, 3303 a 3307, 3401.11.90,
3401.20.10 e 9603.21.00. Então, dentro do mesmo catálogo:

| Produto | Estava em ST (até 31/03/26) | É monofásico |
|---|---|---|
| Perfume (3303), maquiagem (3304), xampu (3305) | ✅ | ✅ |
| Dentifrício (3306), desodorante (3307) | ✅ | ✅ |
| Sabonete de toucador (3401.11.90) | ✅ | ✅ |
| **Papel higiênico (4818), fraldas, absorventes** | ✅ | ❌ |
| **Escova de cabelo (9603.29), pinça (8203)** | ✅ | ❌ |

Dois SKUs do mesmo fornecedor, na mesma nota, podem ter alíquotas efetivas
diferentes — e mudaram em datas diferentes. Isso não é caso de borda: é o
catálogo inteiro deste tenant.

##### O número real deste tenant

Com o RBT12 oficial de 06/2026 (R$ 605.574,89 → 3ª faixa → efetiva **7,21%**),
para um SKU **monofásico que estava em ST**:

| Período | Cálculo | Alíquota efetiva |
|---|---|---|
| até 31/03/2026 | efetiva do mês × (1 − 0,3350 ICMS − 0,1550 PIS/Cofins) | ~51% da cheia |
| **desde 01/04/2026** | 7,21% × (1 − 0,1550 PIS/Cofins) | **6,09%** |
| declarado no PGDAS-D 06/2026 | sem segregação nenhuma | **7,21%** |

A alíquota correta mudou de patamar em **01/04/2026**, numa data conhecida — um
campo único não tem como estar certo dos dois lados. É a demonstração mais limpa
possível de por que `icmsSt` precisa de vigência.

E a linha do meio levanta a questão da §1.2.7: **o monofásico não está sendo
segregado.**

##### E o crédito de estoque? O prazo era 31/03/2026

O levantamento da CAT 28/20 para este segmento tinha como data-base o **fim do dia
31/03/2026**. Já passou.

Duas perguntas para o contador, nesta ordem:

1. **O levantamento foi feito?** Se sim, o crédito é deduzido via campo "redução
   da base de cálculo" do PGDAS-D a partir de **maio/2026**, e o art. 3º, §3º,
   item 2 permite compensar a sobra **nos meses seguintes** — então pode haver
   saldo correndo até hoje.
2. **Se foi feito, os fornecedores preencheram o `vBCSTRet`?** Onde não
   preencheram, o crédito foi zero (art. 4º, I) e a nota complementar já é bem
   mais difícil de conseguir.

Se não foi feito, é conversa com o contador sobre o que ainda é recuperável — não
é decisão de software. O que o Kyneti pode fazer é **não deixar o próximo passar
em branco**: os blocos continuam saindo, e a Reforma extingue a ST de vez.

**Por que isso é grande para o Kyneti.** Na data da exclusão, o mesmo SKU sofre
dois efeitos em direções opostas:

| | Antes (com ST) | Depois (sem ST) |
|---|---|---|
| Alíquota efetiva do DAS | ICMS **removido** (−33,5% da efetiva) | ICMS **volta** → alíquota **sobe** |
| Custo de compra | traz o ICMS-ST **embutido** | sem ICMS-ST → custo **cai** |

O efeito líquido na margem depende de qual é maior, **e varia SKU a SKU**. É
exatamente o tipo de conta que ninguém faz à mão para 937 SKUs — e que o Kyneti
tem todos os dados para fazer.

**01/10/2026 está a dois meses.** Se o `TaxRateResolver` nascer com `icmsSt`
booleano e sem vigência, ele vai estar errado em outubro para toda a linha de
eletrônicos e eletrodomésticos — e errado do jeito pior, com cara de certo.

#### 1.2.4 O crédito de estoque da Portaria CAT 28/20

✅ *Texto integral conferido (com as alterações das Portarias SRE-65/25 e
SRE-07/26).*

Quando a mercadoria sai da ST, o estoque comprado **com o ICMS-ST já retido**
passa a ser vendido sob tributação normal — ou seja, o imposto seria pago duas
vezes sobre a mesma mercadoria. A CAT 28/20 é o mecanismo que devolve isso.

**É opcional, e é dinheiro.** O art. 1º, parágrafo único, item 1 dispensa do
procedimento "o contribuinte que optar pelo não aproveitamento do crédito". Ou
seja: quem não fizer o levantamento simplesmente perde o crédito. Ninguém
autua — o lojista só paga a mais e não fica sabendo.

**O que a lei exige** (art. 2º): relatório digital por mercadoria (Anexos I e II)
+ escrituração do Registro de Inventário, do estoque existente **no final do dia
imediatamente anterior** ao início da vigência — para o 5º bloco, **30/09/2026**.
Quem usa EFD preenche o Bloco H com motivo `02 - Na mudança de forma de
tributação da mercadoria (ICMS)`.

**Fórmula para optante do Simples Nacional** (Anexo V — o nosso caso):

```
sem redução de BC:                      C = (BC ST − VlMerc) × alíquota interna
com redução aplicável ao consumidor:    C = (BC ST − VlMerc) × (1 − pRedBc) × alíquota interna
com redução não aplicável:              C = (BC ST − VlMerc × (1 − pRedBc)) × alíquota interna
```

Repare que para o Simples o crédito é sobre `(BC ST − VlMerc)` — só a **margem**
presumida da ST, não a base inteira. Faz sentido: o optante nunca teve direito ao
crédito do ICMS da própria operação, só do que foi retido acima do valor da
mercadoria. No RPA a fórmula é outra (Anexo IV) e credita a base cheia.

**Como o crédito é realizado** (art. 3º, §3º) — e aqui o Simples é diferente do RPA:

| | Simples Nacional | RPA |
|---|---|---|
| Onde | campo **"redução da base de cálculo" do PGDAS-D** | Registro de Apuração, ajuste `SP020750` |
| Quando | **mês seguinte** ao da exclusão | 12 parcelas mensais |
| Sobra | compensa nos meses seguintes | — |

*(As 12 parcelas do RPA viraram 24 pela SRE-65/25 e voltaram a 12 pela SRE-07/26,
com efeitos retroativos a 01/01/2026. Não afeta o Simples.)*

#### 1.2.5 🔴 A pegadinha do art. 4º — crédito zero por culpa do fornecedor

Este é o achado mais acionável de toda a portaria.

Quando a entrada veio por NF-e de fornecedor **substituído**, a base de cálculo da
retenção sai dos campos `vBCSTRet` e `vBCFCPSTRet` (IDs N26 e N27a, CST 60 /
CSOSN 500). E então:

> "na impossibilidade de identificação da base de cálculo da retenção no item do
> documento fiscal, **o valor do crédito será considerado zero**"
> — art. 4º, I

Se o fornecedor não preencheu o campo, o crédito do lojista é **zero**. E o
inciso II dá a saída: a falta ou o preenchimento a menor "poderão ser sanados pela
emissão de **nota fiscal complementar**" pelo remetente.

**Isso é uma janela que fecha em 30/09/2026.** Depois da virada, pedir nota
complementar de compra antiga vira negociação difícil. Um relatório que varra as
NF-e de entrada dos SKUs afetados e liste *quais fornecedores não preencheram o
`vBCSTRet`* é dinheiro achado no chão — e nenhum ERP pesquisado faz isso.

#### 1.2.6 O que o Kyneti consegue fazer — e o que não

Sendo honesto sobre a fronteira:

| | Consegue hoje? |
|---|---|
| Identificar quais SKUs saem da ST (NCM/CEST × portaria) | ✅ temos NCM/CEST do Olist |
| Estimar a ordem de grandeza do crédito | 🟡 aproximação, falta `BC ST` real |
| Recalcular alíquota e piso a partir de 01/10 | ✅ é o `TaxRateResolver` |
| Listar fornecedores sem `vBCSTRet` | ❌ **falta importar NF-e de entrada** |
| Gerar o relatório dos Anexos I e II | ❌ idem |

O relatório oficial exige, item a item: chave da NF-e de entrada, número do item,
quantidade na unidade comercial, fator de conversão, `VlMerc`, `BC ST`, `pRedBc`
e alíquota interna **com FCP**. Quase tudo isso vive na **nota de compra**, que o
Kyneti não importa — só o Olist tem.

Então a promessa honesta é: o Kyneti **avisa, prioriza e calcula o impacto na
margem**; a emissão do relatório fiscal depende de trazer as notas de entrada
(evolução do `ErpSyncOrchestrator`, não do módulo fiscal).

#### 1.2.7 ✅ Validação contra o PGDAS-D real

Extrato oficial do Simples Nacional, PA **06/2026**, apuração original, gerado em
20/07/2026 (PGDAS-D 2018 v2.2.29). Estabelecimento em **Pindamonhangaba/SP**.

**Dados de entrada:**

| | |
|---|---|
| Receita do período (RPA) | R$ 188.817,80 |
| RBT12 | R$ 605.574,89 |
| RBA (ano corrente) | R$ 794.392,69 |
| Sublimite | R$ 3.600.000,00 — não impedido de recolher ICMS/ISS no DAS |
| Atividade declarada | Revenda de mercadorias — **sem** ST / monofásica / antecipação |

**Cálculo pelo nosso modelo:**

```
RBT12 = 605.574,89  →  3ª faixa (360.000,01 a 720.000,00)
                       Aliq = 9,50%   PD = 13.860,00

efetiva = (605.574,89 × 0,095 − 13.860) / 605.574,89
        = (57.529,61 − 13.860) / 605.574,89
        = 43.669,61 / 605.574,89
        = 7,211266%

DAS = 188.817,80 × 7,211266% = 13.616,15
```

**DAS oficial: R$ 13.616,16.** Diferença: **um centavo**, de arredondamento.

**Partilha — os seis tributos, conferidos um a um:**

| Tributo | Repartição (3ª faixa) | Calculado | **Oficial** |
|---|---|---|---|
| IRPJ | 5,50% | 748,89 | **748,89** ✅ |
| CSLL | 3,50% | 476,57 | **476,57** ✅ |
| COFINS | 12,74% | 1.734,70 | **1.734,70** ✅ |
| PIS/Pasep | 2,76% | 375,81 | **375,81** ✅ |
| INSS/CPP | 42,00% | 5.718,79 | **5.718,78** ⬅ |
| ICMS | 33,50% | 4.561,41 | **4.561,41** ✅ |
| | | | **13.616,16** |

A tabela de partilha da 3ª faixa está confirmada inteira. E a CPP com **um centavo
a menos** é literalmente o art. 18, §1º-B, II em ação: o resíduo de arredondamento
vai para o tributo de maior repartição da faixa — que no Anexo I é a CPP, com 42%.
A regra que eu tinha achado curiosa demais para importar aparece na primeira conta
real.

**O modelo da §5.9 reproduz o cálculo oficial ao centavo.**

#### 1.2.8 🔴 O que o extrato revelou: PIS/Cofins possivelmente indevidos

A atividade está declarada como **"Revenda de mercadorias — SEM substituição
tributária / tributação monofásica"**. Mas o tenant revende **cosméticos**.

- **A ausência de ST está correta** para 06/2026: cosméticos saíram da ST em SP em
  01/04/2026 (§1.2.3). Antes disso, não estaria.
- **A ausência de monofásico é a dúvida.** O monofásico de PIS/Cofins é **federal e
  permanente** (Lei 10.147/2000, NCMs 3303 a 3307, 3401.11.90, 3401.20.10,
  9603.21.00) — não tem nada a ver com a portaria paulista e não mudou em abril.

Se os produtos estão nessas NCMs, o art. 18 §4º-A, I combinado com o §12 manda
segregar a receita e **desconsiderar os percentuais de PIS e Cofins**. Só em
06/2026 isso é:

```
COFINS   1.734,70
PIS        375,81
         --------
         2.110,51   (15,50% do DAS do mês)
```

Estimando o semestre pelos RBT12 de cada mês (todos os meses de 2025 estão
zerados, então dá para reconstruir):

| PA | RPA | RBT12 | Faixa | Efetiva | DAS |
|---|---|---|---|---|---|
| 01/2026 | 99.033,94 | 0,00 | 1ª | 4,00% | ~3.961 |
| 02/2026 | 113.071,45 | 99.033,94 | 1ª | 4,00% | ~4.523 |
| 03/2026 | 117.148,36 | 212.105,39 | 2ª | 4,50% | ~5.272 |
| 04/2026 | 129.714,47 | 329.253,75 | 2ª | 5,50% | ~7.134 |
| 05/2026 | 146.606,67 | 458.968,22 | 3ª | 6,48% | ~9.500 |
| 06/2026 | 188.817,80 | 605.574,89 | 3ª | **7,21%** | **13.616** ✅ |
| | | | | **Total** | **~44.006** |

15,50% disso ≈ **R$ 6.800 no primeiro semestre de 2026**.

⚠️ **Isto é uma pergunta para o contador, não uma conclusão minha.** Três
ressalvas que importam:

1. **Nem todo cosmético está na lista.** A Lei 10.147 é por NCM. Precisa de
   conferência SKU a SKU — que é exatamente o que `ProductTaxProfile.monofasico`
   existe para fazer.
2. **O erro na direção oposta é pior.** A Receita mantém operação de
   autorregularização mirando justamente optantes do Simples que **indicaram
   monofásico indevidamente**. Segregar sem base é risco, não economia.
3. **Período anterior é assunto do contador.** Se a segregação for devida, há
   discussão de restituição/compensação que não é decisão de software.

**Para o produto, o valor é este:** um SKU cadastrado com NCM 3304 (maquiagem) e
marcado como "sem monofásico" é uma **contradição verificável**. O Kyneti tem o
NCM de cada produto e pode cruzar com a lista da Lei 10.147 — apontando a
divergência para o contador decidir. É a mesma mecânica do `dataQuality`: não
decide, mas não deixa passar em silêncio.

#### 1.2.9 🔴 A alíquota está subindo rápido — e o campo fixo vai errar feio

O extrato mostra um negócio em crescimento acelerado: R$ 99k em janeiro,
R$ 188,8k em junho. E como **todos os meses de 2025 estão zerados**, nada sai do
RBT12 quando entra um mês novo — ele cresce pelo valor cheio da receita.

Projetando com a aritmética da §5.6 (para julho, 11 das 12 parcelas já são fato):

| PA | RBT12 | Faixa | Efetiva |
|---|---|---|---|
| 06/2026 | 605.574,89 | 3ª | **7,21%** ✅ oficial |
| 07/2026 | 794.392,69 | **4ª** | **7,87%** |
| 08/2026 | ~983.000 | 4ª | **~8,41%** |
| 01/2027 | ~1.930.000 | **5ª** | **~9,79%** |

Duas leituras:

1. **O campo do Olist tem 7,30% para 08/2026. O valor real será ~8,41%** — erra
   por 1,11 ponto, e **para menos**. Subestimar imposto **superestima margem**:
   é a direção perigosa, a mesma classe de erro do bug de piso que corrigimos na
   tarefa #1.
2. **Em sete meses a alíquota sobe ~2,6 pontos** (7,21% → ~9,79%). Sobre
   ~R$ 190k/mês, são cerca de **R$ 4.900/mês a mais de imposto** em janeiro. Um
   piso de preço calculado com 7,30% fixo vai estar progressivamente mentindo.

E os limiares seguintes não são hipótese distante: no ritmo atual, o **sublimite
de R$ 3,6 mi** (quando ICMS sai do DAS e vai para guia própria) e o **limite de
R$ 4,8 mi** (exclusão do Simples) entram no horizonte de 2027.

Isto valida o alerta da §5.6 em dado real: não é recurso cosmético, é a diferença
entre saber com meses de antecedência e descobrir na guia.

#### 1.2.10 🔴 A transição MEI → Simples Nacional

Os zeros de 2025 no extrato não são ausência de vendas: a empresa era **MEI** e
migrou para o Simples Nacional em 2026. Isso muda a interpretação e levanta uma
questão de conformidade.

**O Manual do PGDAS-D trata desse caso nominalmente:**

> "Para aqueles contribuintes que foram **desenquadrados do Simei**, mas
> permaneceram como optantes do Simples Nacional, o **quadro de receitas
> anteriores também será apresentado** quando do preenchimento da primeira
> apuração feita no PGDAS-D."

O quadro normalmente **não** aparece para quem já era optante nos 12 PA
anteriores. Ele é exibido ao ex-MEI justamente para que a **receita do período
MEI seja informada** — e ela conta, porque o SIMEI é uma forma de recolhimento
*dentro* do Simples Nacional, não um regime à parte. A RBT12 é definida como
"receita bruta acumulada **da empresa** nos 12 meses anteriores ao PA", sem
ressalva quanto à modalidade de recolhimento.

E o próprio Manual avisa o que acontece quando esse quadro fica zerado:

> "será acumulado o valor R$ 0,00 para a determinação da RBT12, RBA e RBAA, com
> reflexos na verificação dos limites e sublimites e **na determinação das
> alíquotas dos períodos posteriores, gerando erros no cálculo**."

**No extrato, todos os meses de 2025 estão com R$ 0,00 e a RBAA é R$ 0,00.**

⚠️ **Pergunta para o contador, não afirmação minha.** Se houve faturamento como
MEI em 2025, ele aparentemente não foi informado — e a consequência é RBT12
subestimada → alíquota efetiva menor que a devida → **imposto a menos**. Direção
perigosa: erro que não gera cobrança agora, e sim depois, com multa e juros.

A magnitude é limitada pelo teto do MEI (R$ 81 mil/ano), então na 3ª faixa isso
significaria algo como 0,1 a 0,2 ponto percentual — algumas centenas de reais por
mês, crescendo com o faturamento. Não é catastrófico; é o tipo de coisa que se
corrige barato agora e cara depois.

Vale checar junto: **o teto do MEI foi respeitado em 2025?** Excesso acima de 20%
(> R$ 97.200) tem efeito retroativo ao início do ano-calendário. Com R$ 99 mil já
em janeiro de 2026, o crescimento foi rápido o suficiente para a pergunta fazer
sentido.

##### O que isso ensina ao produto

Esta é a terceira validação seguida de que **`TenantTaxProfile` precisa ser
versionado no tempo**: o mesmo CNPJ foi MEI em 2025 e Simples em 2026. O DRE de
2025 tem que ser calculado com DAS fixo e alíquota zero no piso; o de 2026, com
alíquota efetiva por RBT12. Um campo único de regime no tenant não representa a
própria empresa que estamos usando de referência.

E abre um recurso que nenhum ERP pesquisado tem:

> **O Kyneti conhece a receita mês a mês independentemente do regime.** Ele ingere
> pedidos de marketplace — não sabe nem se importa se aquele mês foi declarado em
> DASN-SIMEI ou em PGDAS-D.

Então ele pode **preencher ou conferir** o quadro de "receitas brutas anteriores"
que hoje alguém digita à mão na primeira apuração pós-MEI. E pode apontar a
contradição:

> "O PGDAS-D de 06/2026 declara R$ 0,00 de receita em 2025. O Kyneti registrou
> R$ X em vendas nesse período. Confirme com seu contador."

Mesma mecânica do cruzamento de NCM monofásica (§1.2.8): o sistema não decide,
mas não deixa passar em silêncio. E a migração MEI → Simples é o momento de maior
risco de erro na vida fiscal de um pequeno varejista — exatamente o público do
Kyneti.

### 1.3 Lucro Presumido — percentual de receita, mas em camadas

| Tributo | Base | Alíquota | Efetivo sobre receita (comércio) |
|---|---|---|---|
| IRPJ | 8% da receita bruta | 15% | 1,20% |
| IRPJ adicional | sobre base > R$ 20.000/mês | 10% | variável |
| CSLL | 12% da receita bruta | 9% | 1,08% |
| PIS (cumulativo) | receita bruta | 0,65% | 0,65% |
| COFINS (cumulativo) | receita bruta | 3,00% | 3,00% |
| **Subtotal federal** | | | **≈ 5,93%** |
| ICMS | conforme UF/produto | — | + |

> "A base de cálculo do imposto, em cada mês, será determinada mediante a
> aplicação do percentual de 8% (oito por cento) sobre a receita bruta auferida
> mensalmente" — Lei nº 9.249/1995, via
> [PGFN](https://www.gov.br/pgfn/pt-br/cidadania-tributaria/por-assunto/irpj-csll/lucro-real-lucro-presumido-e-lucro-arbitrado)

Os percentuais de presunção de 8% (IRPJ) e 12% (CSLL) e o regime **cumulativo**
de PIS/COFINS estão confirmados em fonte oficial. No regime cumulativo **não há
crédito sobre compras** — o custo do produto entra cheio no piso.

O **adicional de IRPJ** é a pegadinha: ele só incide acima de R$ 20.000 de base
presumida por mês (≈ R$ 250.000 de faturamento mensal no comércio). Modelá-lo
como percentual linear de receita erra nos dois sentidos.

### 1.4 Lucro Real — parte **não pertence** ao preço

| Tributo | Base | Alíquota |
|---|---|---|
| PIS (não cumulativo) | receita, **com crédito** sobre compras | 1,65% |
| COFINS (não cumulativo) | receita, **com crédito** sobre compras | 7,60% |
| IRPJ | **lucro real** | 15% + 10% adicional |
| CSLL | **lucro real** | 9% |

Duas consequências que o modelo atual do Kyneti não comporta:

1. **IRPJ e CSLL incidem sobre o lucro, não sobre a receita.** Colocá-los no piso
   de preço como percentual de venda é conceitualmente errado — eles não são
   custo de transação, são resultado do exercício. Pertencem ao DRE, abaixo do
   resultado operacional, e **nunca** ao denominador do piso.
2. **PIS/COFINS não cumulativos geram crédito na compra.** O custo relevante para
   precificar é o custo **líquido de crédito**, não o valor da nota. Hoje o
   Kyneti usa o valor cheio — superestimando o custo em até 9,25% para um tenant
   de Lucro Real.

### 1.5 Resumo: como cada regime entra no preço

| Regime | Vai no denominador do piso? | O que é | Onde o resto entra |
|---|---|---|---|
| MEI/SIMEI | **Não** — 0% | valor fixo mensal | `FixedExpense` |
| Simples Nacional | **Sim** | efetiva calculada por RBT12, ajustada por ST/monofásico **por produto** | — |
| Lucro Presumido | **Sim** (≈5,93% + ICMS) | percentual de receita | adicional de IRPJ como escalão |
| Lucro Real | **Só PIS/COFINS + ICMS** | receita, líquido de crédito | IRPJ/CSLL no DRE, sobre o lucro |

**Um campo `Float` não representa nenhuma dessas quatro realidades.**

---

## 2. Correção da minha análise anterior

A §1.1 de [olist-analise-absorver-criar.md](./olist-analise-absorver-criar.md)
dizia que a alíquota "muda todo mês" e propunha um `TaxRateSchedule` com uma
alíquota digitada por competência.

**Estava errado, e o erro importa.** A alíquota do Simples não é um parâmetro que
alguém escolhe por mês — é o **resultado** de uma fórmula sobre o RBT12. Copiar a
tela do Olist teria reproduzido no Kyneti o mesmo defeito que produziu o "7,30%"
digitado: um campo que aceita o número errado sem reclamar.

O que a tela do Olist realmente é: um **contorno manual** para um valor que o ERP
não calcula. O Kyneti não precisa desse contorno — e é aí que está a
oportunidade, na §4.1.

O que se mantém da §1.1: a distinção **com ST / sem ST** é real e necessária. Só
que ela não é uma configuração mensal do tenant; é um **atributo do produto**.

---

## 3. Reforma Tributária do Consumo — o chão está se movendo agora

### 3.1 O que substitui o quê

| Sai | Entra |
|---|---|
| PIS/PASEP + COFINS | **CBS** (federal) |
| ICMS + ISS | **IBS** (estadual + municipal) |
| IPI | zerado em 2027 (exceto Zona Franca de Manaus) |
| — | **IS** — Imposto Seletivo, sobre consumo prejudicial |

— [Receita Federal, "Entenda a Reforma Tributária do Consumo"](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda)

Base legal: EC 132/2023 → **LC 214/2025** (institui IBS, CBS e IS) → **LC
227/2026** (13/01/2026) → Decreto de regulamentação da CBS (abril/2026) →
**Resolução CGIBS nº 6/2026** (30/04/2026, regulamenta o IBS).

### 3.2 Cronograma oficial

| Ano | O que acontece |
|---|---|
| **2026** | Ano-teste. CBS **0,9%** + IBS **0,1%**, compensáveis com PIS/COFINS. Contribuinte que cumprir as obrigações acessórias fica **dispensado do recolhimento**. |
| **2027** | CBS em alíquota cheia. **PIS e COFINS extintos.** IPI a zero (exceto ZFM). IS instituído. IBS a 0,05% estadual + 0,05% municipal. |
| **2028** | Mantém o desenho de 2027. |
| **2029** | IBS 10% / ICMS e ISS 90% |
| **2030** | IBS 20% / ICMS e ISS 80% |
| **2031** | IBS 30% / ICMS e ISS 70% |
| **2032** | IBS 40% / ICMS e ISS 60% |
| **2033** | Vigência integral. **ICMS e ISS extintos.** |

### 3.3 Onde estamos hoje — e o que acontece **amanhã**

**03/08/2026** (amanhã): acaba a flexibilização.

> "não será permitida a emissão de documentos fiscais eletrônicos sem o
> preenchimento dos campos relativos ao IBS e à CBS, para as empresas do regime
> regular." (...) "o sistema rejeitará automaticamente documentos incompletos" e
> as notas não serão autorizadas.
> — [Comitê Gestor do IBS](https://www.cgibs.gov.br/novo-marco-da-reforma-tributaria-inicia-em-03-de-agosto-com-preenchimento-obrigatorio-dos-campos-relativos-ao-ibs-e-a-cbs)

Alíquota-teste de 1% (0,1% IBS + 0,9% CBS) destacada em NF-e, NFC-e, CT-e, NFS-e,
NFCom, NF3e e BP-e. A apuração em 2026 é **meramente informativa, sem efeitos
tributários**, desde que as obrigações acessórias sejam cumpridas.

**Setembro/2026 — janela de decisão para os tenants do Simples.** A opção pelo
Simples Nacional e pelo **regime regular de IBS/CBS** para 2027 é exercida entre
**01 e 30 de setembro de 2026**, com efeito em 01/01/2027; há arrependimento até
novembro/2026, e nova janela em março/2027 para o 2º semestre.
— [Portal do Simples Nacional / CGSN](https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c739e03c-8482-473f-8e82-f38ec3b13637)

**O MEI não é afetado**: continua optando pelo SIMEI em janeiro, como sempre.

### 3.4 Alíquota de referência

Estimativa da Secretaria Extraordinária da Reforma Tributária:

| | |
|---|---|
| CBS | 8,8% |
| IBS | 17,7% |
| **Total** | **26,5%** |

Contra os ≈34,4% atuais de ICMS + PIS/Cofins na mesma metodologia.
— [Nota técnica SERT/MF](https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria/regulamentacao-da-reforma-tributaria/lei-geral-do-ibs-da-cbs-e-do-imposto-seletivo/notas/nota-tecnica-aliquotas_2024-07-01_sertmf-1.pdf)

Para 2027 o IBS foi fixado em 0,1% (0,05% estadual + 0,05% municipal), conforme
[Resolução CGIBS nº 14, de 29/07/2026](https://www.cgibs.gov.br/upload/arquivos/202607/31144942-resoluc-ao-cgibs-n-14-de-29-de-julho-de-2026-proposta-percentual-ibs-cgibs-2027.pdf)
(DOU de 31/07/2026), com arrecadação estimada de R$ 5,15 bilhões.

### 3.5 "Por fora" — isso quebra a fórmula do piso

> "A convenção internacional de cálculo é 'por fora' sobre o preço sem imposto"
> — Nota técnica SERT/MF

Hoje, ICMS, PIS/COFINS e o DAS do Simples são **por dentro**: o imposto está
contido no preço. Por isso a fórmula do Kyneti funciona:

```
P = (custo + logística + taxaFixa + frete) / (1 − comissão − imposto − margem)
```

Com CBS/IBS **por fora**, o imposto é acrescido **sobre** o preço. A conta muda
de forma, não de constante:

```
P_líquido = (custoLíquidoDeCrédito + logística + taxaFixa + frete) / (1 − comissão − margem)
P_bruto   = P_líquido × (1 + alíquotaCBS_IBS)
```

E abre uma pergunta que precisa de resposta antes de virar código: **a comissão
do marketplace incide sobre o preço bruto ou líquido?** O anúncio exibe o preço
com imposto; a comissão do canal quase certamente será calculada sobre ele. Se
for, a fórmula acima ainda precisa de um ajuste — a comissão passa a incidir
sobre uma base maior que a receita do vendedor.

**Isso não é um ajuste de parâmetro. É uma segunda fórmula de piso**, que precisa
conviver com a primeira durante a transição de 2026 a 2033 — inclusive
**simultaneamente**, porque de 2029 a 2032 ICMS/ISS e IBS coexistem em proporções
que mudam todo ano.

### 3.6 Crédito integral — muda o **custo**, não só o imposto

A não-cumulatividade plena dá crédito de CBS/IBS sobre **todas** as aquisições do
contribuinte do regime regular. O custo relevante para precificar deixa de ser o
valor da nota e passa a ser **o valor da nota menos o crédito**.

O Kyneti usa `productCostPrice` como valor cheio. A partir de 2027, para um
tenant do regime regular, isso **superestima o custo em até 26,5%** — e o piso
de preço sai alto demais na direção errada, num momento em que o mercado inteiro
estará reprecificando.

### 3.7 Simples Nacional na Reforma — a decisão que o Kyneti pode informar

O optante pelo Simples que mantiver o recolhimento na guia única **não aproveita
créditos dos seus fornecedores** e **transfere ao adquirente apenas o crédito
limitado ao valor de IBS/CBS calculado no regime simplificado**.

Quem opta pelo **regime regular** recolhe IBS/CBS por fora, com crédito integral
nas duas pontas.

A decisão é semestral a partir de 2027. Para um vendedor B2C de marketplace, o
crédito repassado ao comprador é irrelevante — o consumidor final não credita. O
que decide é o **crédito de entrada**: quanto o tenant compra de fornecedores do
regime regular.

**Essa é uma conta que o Kyneti tem os dados para fazer e o contador do lojista,
na média, não vai fazer produto a produto.**

### 3.8 Plataformas digitais e split payment — muda o fluxo de caixa

A LC 214/2025 (art. 22) torna a plataforma digital **responsável** pelo IBS/CBS
das operações realizadas por meio dela — solidariamente com o adquirente e em
substituição ao fornecedor quando este é do exterior; e solidariamente com o
fornecedor nacional quando a plataforma não presta as informações exigidas.

E, no ponto que nos interessa mais:

> "As plataformas digitais devem adotar as providências necessárias para a
> segregação e recolhimento dos valores de IBS e CBS devidos pelo fornecedor **na
> liquidação financeira da operação (split payment)**, quando disponível."

Ou seja: **o marketplace vai reter o imposto no repasse.** O extrato de
settlement ganha uma linha de retenção que hoje não existe.

**Impacto imediato na conciliação do Kyneti:** o módulo que compara taxa
esperada × repasse recebido vai enxergar uma divergência a maior e **acusar erro
onde não há** — a menos que aprenda a reconhecer a retenção de IBS/CBS como linha
legítima. Isso precisa estar pronto **antes** de 2027, não depois.

---

## 4. Impacto módulo a módulo no Kyneti

### 4.1 🟢 A oportunidade: o Kyneti pode **calcular** a alíquota

O Olist pede que o usuário digite a alíquota todo mês. Foi assim que o "7,30%"
nominal entrou no lugar do "5,60%" efetivo — o ERP não tinha como saber, e não
reclamou.

**O Kyneti tem o RBT12.** Ele já ingere pedido a pedido de todos os canais. A
receita bruta dos últimos 12 meses é uma soma sobre dados que já estão no banco.

```
alíquotaEfetiva(tenant, produto, data):
  RBT12    = Σ receita bruta dos 12 meses anteriores a `data`   ← já temos
  faixa    = faixa do Anexo aplicável para RBT12
  efetiva  = (RBT12 × faixa.nominal − faixa.parcelaDeduzir) / RBT12
  se produto.icmsSt         → efetiva −= efetiva × partilha.icms
  se produto.monofasico     → efetiva −= efetiva × (partilha.pis + partilha.cofins)
  retorna { efetiva, memoriaDeCalculo, origem }
```

Isso não é um recurso a mais. É a **filosofia `dataQuality` aplicada ao imposto**:
em vez de aceitar um número e fingir que é verdade, o sistema mostra de onde ele
veio. `memoriaDeCalculo` responde "por que 5,60%?" com o RBT12, a faixa e a
parcela a deduzir — do mesmo jeito que hoje o Kyneti aponta o registro exato de
uma taxa importada.

E é coerente com a regra que já vale para comissão: **quando o dado não dá para
calcular, bloqueia** — não inventa. Se o tenant tem menos de 12 meses de
histórico no Kyneti, o RBT12 está incompleto; nesse caso o sistema pede o
faturamento anterior em vez de somar o que tem e chamar de verdade.

### 4.2 🔴 Piso de preço

- Denominador precisa da alíquota **do produto**, não do tenant
- MEI: alíquota 0 e DAS como despesa fixa
- Lucro Real: só PIS/COFINS + ICMS no denominador; IRPJ/CSLL **fora**
- Lucro Presumido: adicional de IRPJ é escalão, não linear
- De 2027: segunda fórmula, imposto **por fora**
- De 2029 a 2032: as duas fórmulas convivem, com pesos que mudam por ano

A boa notícia: a estrutura de **faixas** que já construímos para comissão
(`TieredFeeInput`, `calculateTieredNetMarginFloorPrice`) é exatamente a mesma
forma de problema do adicional de IRPJ e da transição por ano. Não precisamos de
um motor novo — precisamos generalizar o que existe.

### 4.3 🔴 DRE

- Deduções passam a ser calculadas por produto
- IRPJ/CSLL de Lucro Real/Presumido merecem linha **abaixo** do resultado
  operacional (são resultado, não custo de transação)
- MEI: DAS na linha de despesas fixas
- A partir de 2027: linha de **crédito de CBS/IBS** — hoje não existe conceito de
  imposto recuperável em lugar nenhum do sistema

### 4.4 🔴 Conciliação de repasse

Split payment introduz retenção de IBS/CBS no extrato. Sem tratamento, vira falso
positivo em massa no módulo de auditoria taxa × repasse.

### 4.5 🟢 Módulo novo: comparador de regime

Com catálogo, custos, canais e faturamento reais no banco, o Kyneti pode simular
o mesmo catálogo sob Simples × regime regular de IBS/CBS e responder à decisão de
**setembro/2026** com números do próprio negócio.

Nenhum ERP pesquisado ([market-landscape-analysis.md](./market-landscape-analysis.md))
faz isso. É um diferencial com prazo de validade — vale muito em 2026 e 2027, e
vira commodity depois.

### 4.6 🟠 Fundamento contábil do waterfall

✅ *Texto literal conferido.* O **art. 187 da Lei nº 6.404/1976** determina que a
DRE discrimine, nesta ordem:

> **I** - a receita bruta das vendas e serviços, as deduções das vendas, os
> abatimentos e os impostos;
> **II** - a receita líquida das vendas e serviços, o custo das mercadorias e
> serviços vendidos e o lucro bruto;
> **III** - as despesas com as vendas, as despesas financeiras, deduzidas das
> receitas, as despesas gerais e administrativas, e outras despesas operacionais;
> **IV** - o lucro ou prejuízo operacional, as outras receitas e as outras
> despesas; *(redação da Lei nº 11.941/2009)*
> **V** - o resultado do exercício antes do Imposto sobre a Renda e a provisão
> para o imposto;
> **VI** - as participações de debêntures, empregados, administradores e partes
> beneficiárias (...);
> **VII** - o lucro ou prejuízo líquido do exercício e o seu montante por ação do
> capital social.

É a ordem que [dre-report.ts](../apps/api/src/modules/financial-intelligence/domain/dre-report.ts)
já implementa.

**E o inciso V resolve a dúvida da §4.3:** a lei coloca o IR e sua provisão
**depois** do resultado operacional, em linha própria. Confirma que IRPJ e CSLL de
Lucro Real/Presumido não pertencem ao denominador do piso nem às deduções de
receita — são resultado, não custo de transação.

O **CPC 47 (IFRS 15)** valida uma escolha nossa, e agora com o texto na mão:

> **B35.** "A entidade é principal se ela controlar o bem ou o serviço
> especificado antes que o bem ou o serviço seja transferido ao cliente."
>
> **B35B.** "Quando (ou como) a entidade, que é um dos principais, satisfaz à
> obrigação de performance, a entidade deve reconhecer a receita **no montante
> bruto da contraprestação** a que espera ter direito (...)"
>
> **B36.** "A entidade é agente se a obrigação de performance da entidade for
> providenciar o fornecimento de bens ou serviços especificados por outra parte.
> (...) ela deve reconhecer a receita equivalente ao valor de qualquer taxa ou
> comissão (...)"
>
> **B37.** Indicadores de que é principal: "(a) a entidade é a responsável
> primária para o cumprimento do compromisso de fornecer o bem ou serviço
> especificado (...)"

O lojista de marketplace é **principal**: é dono do estoque, tem a
responsabilidade primária pela entrega e pela conformidade do produto, assume o
risco e define o preço. Quem é agente na relação é **o marketplace**.

**Logo: receita = preço cheio; comissão do canal = despesa.** É exatamente como o
waterfall do Kyneti está montado — e é a base normativa para recusar a
apresentação alternativa (receita já líquida de comissão), que apagaria a linha
de comissão do DRE. ✅ *Lido diretamente do
[CPC 47 Rev. 14 da CVM](https://conteudo.cvm.gov.br/export/sites/cvm/menu/regulados/normascontabeis/cpc/CPC_47_Rev_14.pdf).*

Fontes normativas para essa camada: [CFC](https://cfc.org.br) (NBCs),
[CPC](http://www.cpc.org.br) (pronunciamentos), [CVM](https://conteudo.cvm.gov.br).

---

## 5. Perfil fiscal — o desenho

> Ideia do Guilherme (02/08/2026): perfis fiscais pré-definidos por regime,
> estado e faixa, como **sugestão editável** e não imposição; com aviso
> antecipado quando o cálculo se aproxima do limite da faixa, em modo automático
> (troca sozinho) ou manual (o usuário decide).
>
> O desenho está certo. O que segue são três ajustes que decidem se ele funciona
> ou apodrece em seis meses.

### 5.1 O que varia por estado (e o que não varia)

Ponto que muda o escopo: **a tabela do Simples Nacional é federal.** Faixas,
alíquotas nominais e parcelas a deduzir dos Anexos I a V valem igual em Roraima e
em São Paulo. Não há perfil por estado a fazer ali.

O que realmente varia por UF:

| Item | Varia? | Observação |
|---|---|---|
| Faixas e alíquotas dos Anexos | ❌ Federal | LC 123/2006 |
| Partilha dos tributos | ❌ Federal | idem |
| **Sublimite** | ✅ | R$ 3,6 mi obrigatório; alguns Estados adotam R$ 1,8 mi |
| **Quais produtos estão em ST** | ✅ **e muda o tempo todo** | SP já publicou 5 blocos de exclusão |
| Alíquota interna de ICMS | ✅ | relevante para Lucro Real/Presumido |
| ISS | ✅ Municipal | fora do nosso escopo (comércio) |
| Monofásico de PIS/Cofins | ❌ Federal | por NCM |

Ou seja: o trabalho pesado do "perfil por estado" **não é a tabela do Simples —
é o mapa de ST por NCM por UF, com vigência.** É um dataset vivo, não uma
constante. Fingir que é constante é como teria sido chumbar a comissão do Mercado
Livre em 14%.

### 5.2 Ajuste 1 — referência com override, nunca cópia

A tentação é copiar o template para dentro do tenant no momento da adoção. Isso
quebra em outubro: o tenant que adotou o perfil "SP / Simples / Anexo I" em
agosto **não receberia** a exclusão da ST da Portaria SRE 34/2026, porque estaria
carregando uma fotografia de agosto.

```
TenantTaxProfile → referencia FiscalProfileTemplate (versionado, com vigência)
                 + guarda SÓ os campos que o usuário sobrescreveu
```

Assim a atualização do template flui sozinha, e o override do usuário sobrevive —
mas apenas onde ele explicitamente mexeu. É a mesma escolha que já fizemos em
`FeeRule`: a regra é do provider, o ajuste é do tenant.

### 5.3 Ajuste 2 — perfil fiscal é um *provider*, não um seed

Esse dataset envelhece. São Paulo publicou cinco blocos de exclusão de ST; a
Reforma vai mexer em tudo até 2033. Um seed inicial estaria desatualizado antes
do primeiro cliente pagar.

A boa notícia é que já temos essa forma de problema resolvida. Regra fiscal é
**dado público compartilhado por todos os tenants** — exatamente a mesma natureza
das regras de taxa de marketplace, que já rodam sob `RuleSyncOrchestrator` com
`ProviderSyncSchedule` e `ProviderHealth`.

O perfil fiscal deve nascer como mais um provider desse mesmo mecanismo:
versionado, com vigência, com `dataQuality`, e com a origem citável ("Portaria
SRE 34/2026") em vez de "alguém marcou um checkbox".

### 5.4 Ajuste 3 — o que "automático" deve significar

Vale separar duas coisas que a palavra "automático" junta:

| | O que é | Deve ser automático? |
|---|---|---|
| Recalcular a **alíquota** quando o RBT12 muda de faixa | aplicar a lei corretamente | **Sempre.** Não é preferência do usuário — 5,60% ou 7,40% não é opinião |
| Recalcular o **piso** de cada SKU | consequência aritmética | Sim |
| **Mudar preço** de anúncio por causa disso | decisão de negócio | **Nunca sozinho** — passa pelo Safety Lock que já existe |

Sugiro que o "modo automático × manual" governe só a terceira linha. As duas
primeiras são cálculo, não escolha — e deixá-las manuais é justamente o que
produziu o "7,30%" digitado no Olist.

### 5.5 O override precisa de guarda

"Sugestão editável" é a decisão certa — o contador do lojista pode ter motivo que
o sistema não conhece. Mas um override sem contrapeso reintroduz o bug original.

A regra: **o valor calculado nunca some da tela.** Se o usuário digitar 7,30% e o
cálculo der 5,60%, o sistema mostra os dois lado a lado com a diferença em reais
por mês, e marca `source: MANUAL_OVERRIDE`. Não impede — evidencia. Mesma
filosofia do `dataQuality`: o sistema não decide por você, mas também não deixa
você não saber.

### 5.6 O alerta é melhor do que parece — dá para *projetar*

O RBT12 é uma soma móvel de 12 meses:

```
RBT12(m+1) = RBT12(m) − receita(m−11) + receita(m+1)
```

Para o próximo mês, **11 das 12 parcelas já são conhecidas** — só a receita do
mês corrente é estimativa. A projeção de curto prazo é quase determinística, e
degrada suavemente conforme se olha mais longe. Não é chute: é aritmética sobre
dados que já estão no banco.

Isso permite avisar com antecedência real, e não só quando já aconteceu:

> "No ritmo atual você entra na 3ª faixa em novembro. A alíquota vai de 5,60%
> para ~7,40%. Isso derruba a margem de 214 SKUs abaixo do mínimo e sobe o piso
> em média R$ 3,80."

E há **quatro limiares diferentes**, com consequências e prazos distintos:

| Limiar | Valor | O que acontece ao cruzar |
|---|---|---|
| Faixa do Anexo | 180k / 360k / 720k / 1,8M / 3,6M | alíquota sobe |
| **Sublimite** | 3,6M (ou 1,8M em alguns Estados) | ICMS e ISS **saem do DAS** e vão para guia própria |
| Limite do Simples | 4,8M | exclusão do regime |
| **Teto do MEI** | 81k hoje, 110k em 2027, 140k em 2028 | desenquadramento — e o excesso acima de 20% tem efeito retroativo |

O do MEI é o mais brutal e o menos avisado por aí: o imposto é fixo até o teto e
então **salta**. Um alerta de "faltam R$ X para o teto, no ritmo atual você chega
em setembro" vale mais para esse tenant do que qualquer sugestão de preço.

### 5.7 Uma ressalva

Perfil pré-definido que diz "você é MEI em SP, sua alíquota é esta" chega perto de
orientação tributária. O enquadramento correto é do contador, não nosso.

Isso não impede o recurso — impede a moldura. O perfil se apresenta como
**sugestão a confirmar**, e a memória de cálculo (RBT12, faixa, parcela a
deduzir, o que foi removido por ST/monofásico) deixa o contador auditar em trinta
segundos em vez de refazer. Nesse formato, ajuda o contador em vez de disputar
com ele.

### 5.8 A adesão à Reforma é uma chave do usuário — mas com data

Para o optante do Simples, entrar no regime regular de IBS/CBS é **opcional**.
Então sim: é o usuário que liga ou não. Mas o desenho tem três amarras que um
interruptor simples não respeita.

**1. A escolha é por semestre, não permanente.** A opção de 01–30/09/2026 vale
para **jan–jun/2027**; em março/2027 abre a janela do 2º semestre. O mesmo tenant
pode estar dentro no 1º semestre e fora no 2º — e cada pedido tem que ser
calculado com a regra que valia na data dele, ou o DRE de um mês fechado muda
sozinho quando o usuário mexe na chave.

**2. A chave só abre em certas datas.** Fora da janela, ela não é editável — é
consulta. A tela precisa mostrar *quando* volta a abrir, não só o estado atual.
Há inclusive arrependimento até novembro/2026 para a opção de 2027.

**3. Ligar a chave troca a fórmula inteira**, não um parâmetro:

| | Guia única (Simples) | Regime regular |
|---|---|---|
| IBS/CBS | dentro do DAS | por fora, apuração própria |
| Crédito de entrada | ❌ não aproveita | ✅ integral |
| Incidência no piso | por dentro | **por fora** — outra fórmula (§3.5) |
| Crédito ao adquirente | limitado ao do simplificado | integral |

Por isso a chave não deve ficar solta numa tela de configuração. Ela pertence ao
lado do **comparador de regime** (§4.5): o usuário liga *depois* de ver os dois
cenários com os números do próprio catálogo, não antes.

Para um vendedor B2C de marketplace, o que decide é o **crédito de entrada** —
quanto ele compra de fornecedor do regime regular. O crédito que ele repassaria
ao comprador é irrelevante: consumidor final não credita.

---

## 5.9 Modelo de dados

> **Estado da implementação — 02/08/2026.** No ar: schema `tax_intelligence`
> (3 tabelas, RLS habilitado e forçado), domínio puro (`simples-nacional.ts`,
> `rbt12.ts`), porta `TAX_RATE_RESOLVER` e o serviço que a implementa.
> **83 testes**, incluindo a reprodução do extrato oficial do PGDAS-D ao centavo.
>
> **Os cinco Anexos (I a V) estão completos**, transcritos do PDF oficial da
> LC 123/2006 e cobertos por testes de integridade: partilha somando 100% em
> toda faixa, alíquota efetiva contínua da 1ª à 5ª, e o degrau intencional no
> sublimite.
>
> Duas coisas que só apareceram ao transcrever as tabelas:
>
> - **O teto de 5% do ISS incide sobre a alíquota EFETIVA, não sobre a
>   repartição.** A primeira implementação comparava a repartição (33,5% no
>   Anexo III) com 5% e acionaria o teto sempre. A lei confirma a leitura ao
>   publicar o limiar: 14,92537% no Anexo III é exatamente 0,05 / 0,335.
> - **A alíquota efetiva CAI no sublimite**, em todos os cinco Anexos. Não é
>   erro de transcrição: acima de R$ 3,6 mi o ICMS (ou o ISS) sai do DAS, e a
>   6ª faixa é calibrada para uma composição menor de tributos. A carga não
>   diminui — muda de guia. Está travado em teste para ninguém "consertar"
>   depois.
>
> **Os quatro regimes estão implementados** (`regime-normal.ts`, 98 testes no
> módulo). Duas decisões que o código registra:
>
> - **Lucro Presumido inclui IRPJ e CSLL no piso**; Lucro Real, não. No
>   Presumido a base é uma presunção sobre a receita, então os dois são custo
>   marginal de vender. No Real incidem sobre o lucro apurado — art. 187, V da
>   Lei 6.404/1976 — e entram no DRE, abaixo do resultado operacional.
> - **O adicional de IRPJ é escalão.** No comércio ele vale 0,80 ponto
>   percentual e só liga acima de ~R$ 250 mil/mês de receita (R$ 20 mil de base
>   presumida). Em serviços, com presunção de 32%, o mesmo degrau chega em
>   ~R$ 62,5 mil/mês. Usamos a média mensal dos 12 meses como referência: a
>   receita do mês corrente faria o piso oscilar por artefato de calendário.
>
> **O que ainda falta**, e por quê:
> - `FiscalProfileTemplate` (§5.2/§5.3) — o catálogo nacional só vale quando
>   houver mais de uma UF mapeada; hoje seria indireção vazia.
> - `IbsCbsRegimeOption` (§5.8) — a janela de opção abre em setembro/2026.
> - Telas de cadastro. Sem `TenantTaxProfile`, `ProductTaxProfile` e as receitas
>   anteriores preenchidos, o resolver bloqueia todo mundo — comportamento
>   correto, inutilizável sem onde cadastrar.
> - Nenhum consumidor migrado: `CatalogSettings.taxRatePct` continua alimentando
>   o piso de preço.
>
> O modelo abaixo é o desenho completo; o que existe hoje é o subconjunto acima.

```prisma
enum TaxRegime { MEI_SIMEI  SIMPLES_NACIONAL  LUCRO_PRESUMIDO  LUCRO_REAL }
enum SimplesAnexo { I  II  III  IV  V }
enum TaxAutomationMode { AUTO  MANUAL }

// Catálogo NACIONAL, compartilhado por todos os tenants — mantido por provider,
// não por seed. Ver §5.3.
model FiscalProfileTemplate {
  id             String   @id @default(uuid())
  uf             String?           // null = regra federal (faixas dos Anexos)
  regime         TaxRegime
  anexo          SimplesAnexo?
  sublimite      Decimal?
  vigenciaInicio DateTime
  vigenciaFim    DateTime?
  fonte          String            // 'LC_123_2006' | 'PORTARIA_SRE_34_2026' | ...
  payload        Json              // faixas, partilha, regras de ST por NCM

  @@index([uf, regime, vigenciaInicio])
}

// Também versionado no tempo: o tenant troca de regime na virada do ano, e o
// DRE de um mês fechado tem que continuar sendo calculado com o regime que
// valia naquele mês.
model TenantTaxProfile {
  id             String   @id @default(uuid())
  tenantId       String
  templateId     String?          // referência, NÃO cópia — ver §5.2
  uf             String
  regime         TaxRegime
  anexo          SimplesAnexo?    // só Simples
  vigenciaInicio DateTime
  vigenciaFim    DateTime?
  automationMode TaxAutomationMode @default(AUTO)
  // Só os campos que o usuário sobrescreveu do template. O que não está aqui
  // vem do template e se atualiza sozinho.
  overrides      Json?
  // Receita anterior à adoção do Kyneti, para completar o RBT12 quando o
  // histórico interno tem menos de 12 meses E a empresa NÃO está em início de
  // atividade (aí vale a proporcionalização oficial — ver §1.2). null =
  // não informado → o resolver BLOQUEIA em vez de somar histórico parcial.
  receitaAnteriorInformada Json?

  @@index([tenantId, vigenciaInicio])
}

// A adesão ao regime regular de IBS/CBS é OPCIONAL para o optante do Simples —
// e é uma escolha POR SEMESTRE, não um interruptor. A primeira opção
// (01–30/09/2026) vale para jan–jun/2027; em março/2027 abre a janela do
// 2º semestre. Um booleano no tenant não representa isso: o mesmo tenant pode
// estar no regime regular no 1º semestre e fora no 2º, e cada pedido precisa
// ser calculado com a regra que valia na data dele.
model IbsCbsRegimeOption {
  id             String   @id @default(uuid())
  tenantId       String
  ano            Int
  semestre       Int      // 1 | 2
  regimeRegular  Boolean  @default(false)
  optadoEm       DateTime?
  // Janela em que a escolha ainda pode ser mudada (há arrependimento até
  // novembro/2026 para a opção de 2027).
  prazoOpcaoAte  DateTime

  @@unique([tenantId, ano, semestre])
}

// NÃO é @id productId: o regime do produto MUDA no tempo. São Paulo está
// retirando mercadorias da ST em blocos (SRE 64/2025 em 01/01/2026, SRE 34/2026
// em 01/10/2026) — o mesmo SKU é "com ST" em setembro e "sem ST" em outubro.
// Um booleano sem vigência calcularia a alíquota errada retroativamente e
// estragaria o DRE de meses já fechados. Ver §1.2.3.
model ProductTaxProfile {
  id             String   @id @default(uuid())
  productId      String
  // ST é regime ESTADUAL: o mesmo NCM pode estar em ST no PR e fora dela em SP.
  // A chave do resolver é (produto, UF, data) — não (produto, data). Sem isso o
  // sistema só funciona para vendedor de um estado só. Ver §6.
  uf             String
  vigenciaInicio DateTime
  vigenciaFim    DateTime?               // null = vigente
  icmsSt         Boolean  @default(false) // estadual, por NCM/CEST
  // Monofásico é FEDERAL (Lei 10.147/2000 e outras) — não varia por UF, mas
  // fica aqui porque a resolução é sempre por NCM e por data.
  monofasico     Boolean  @default(false)
  ncm            String?
  cfopPadrao     String?
  fonte          String                   // 'PORTARIA_SRE_94_2025' | 'LEI_10147_2000' | 'MANUAL'

  @@index([productId, uf, vigenciaInicio])
}
```

`fonte` existe pelo mesmo motivo que `source` em `ResolvedTaxRate`: quando a
alíquota de um SKU mudar em outubro, o usuário vai perguntar por quê — e a
resposta precisa ser "Portaria SRE 34/2026", não "alguém marcou um checkbox".

Porta nova em `shared/contracts/`, seguindo o padrão de
`FeeRuleResolver` — os módulos consomem o contrato, nunca a tabela:

```typescript
export interface ResolvedTaxRate {
  effectiveRate: number;          // FRAÇÃO (0.056 = 5,6%) — convenção do projeto
  incidence: 'POR_DENTRO' | 'POR_FORA';
  creditableRate: number;         // crédito de entrada (0 até 2027)
  regime: TaxRegime;
  breakdown: TaxRateBreakdown;    // RBT12, faixa, PD, deduções de ST/monofásico
  source: 'CALCULATED_RBT12' | 'FIXED_REGIME_RATE' | 'MANUAL_OVERRIDE';
}

export interface TaxRateResolver {
  // Lança quando não dá para calcular com honestidade (RBT12 incompleto,
  // regime não configurado) — nunca devolve zero silencioso.
  resolve(tenantId: string, productId: string, at: Date): Promise<ResolvedTaxRate>;
}
```

`effectiveRate` em **fração**, como comissão — mesma convenção, mesmo motivo
(ver a correção de unidade em
[revisao-geral-2026-08.md](./revisao-geral-2026-08.md)).

`source` existe pelo mesmo motivo que `dataQuality` existe: distinguir o que o
sistema **calculou** do que alguém **digitou**.

---

## 6. Generalização — qualquer nicho, qualquer UF, qualquer canal

> O Kyneti não é para um vendedor de cosméticos de São Paulo. É para varejo
> digital, marketplace, e-commerce próprio e loja física, em qualquer nicho e
> qualquer estado. Esta seção separa o que é caso concreto do que é modelo — e
> aponta onde as seções anteriores ficaram estreitas demais.

### 6.1 O que estava colado no caso concreto

| Onde | Estava assumindo | Generalização |
|---|---|---|
| §1.2 | Anexo I (comércio) | Anexos I a V, **coexistindo no mesmo mês** — ver §6.2 |
| §5.9 | `ProductTaxProfile(produto, data)` | `(produto, **UF**, data)` — ST é estadual (já corrigido) |
| §1.2.3 | ST de SP | 27 UFs, cada uma com sua lista e seu calendário |
| todo | venda por marketplace | marketplace, loja própria e **presencial** |

### 6.2 Um tenant pode estar em vários Anexos ao mesmo tempo

Isto não é caso raro, é comum: quem revende (Anexo I), fabrica o próprio produto
(Anexo II) e cobra montagem ou personalização (Anexo III) tem **três receitas
segregadas no mesmo mês**, cada uma tributada pelo seu Anexo.

O Manual do PGDAS-D mostra exatamente isso num exemplo oficial: `RPA1` pelo Anexo
I (efetiva 5,32%) + `RPA2` pelo Anexo III (efetiva 8,08%), e
`Valor devido total = RPA1 + RPA2`.

Duas consequências de modelagem:

1. **O RBT12 é único e total** — soma de todas as atividades. Ele define a
   *faixa*; o *Anexo* é escolhido por atividade. São dois eixos independentes, e
   confundi-los é fácil.
2. A alíquota efetiva é resolvida por **(produto ou serviço) × atividade**, não
   só por produto. `TaxRateResolver.resolve()` precisa receber a natureza da
   receita, não apenas o `productId`.

### 6.3 Fator R — mais um valor calculado, e não temos o insumo

Anexos III e V se decidem pelo **fator R** = folha de salários dos 12 meses ÷
receita bruta dos 12 meses. Se ≥ 0,28 → Anexo III; abaixo → Anexo V. E ele muda
**todo mês**.

O Kyneti tem o denominador e **não tem o numerador** — folha não passa por aqui.
Então, para tenant de serviço, o fator R é entrada obrigatória do usuário
(ou integração de folha, mais adiante). É o mesmo padrão da receita anterior ao
RBT12: quando falta insumo, **pedir**, nunca estimar.

Para varejo puro (Anexo I) o fator R é irrelevante — mas o modelo não pode nascer
sem ele, ou o primeiro tenant de serviço quebra o desenho.

### 6.4 Canal: marketplace, loja própria e presencial

O motor de preço já é por canal, o que ajuda. O que muda por tipo de canal:

| | Marketplace | E-commerce próprio | Loja física |
|---|---|---|---|
| Comissão | ✅ importada | ❌ zero | ❌ zero |
| Gateway/adquirência | dentro da comissão | ✅ **taxa de cartão** | ✅ taxa de cartão/maquininha |
| Frete | do canal ou do vendedor | do vendedor | ❌ |
| Documento fiscal | NF-e | NF-e | **NFC-e** |
| **DIFAL** | conforme operação | ✅ **interestadual B2C** | ❌ |

Dois furos reais aqui:

- **Taxa de adquirência não existe no modelo.** Hoje a comissão do marketplace
  cobre esse papel; num e-commerce próprio ou numa loja física, o custo
  equivalente é a taxa do cartão — que varia por bandeira, por parcelamento e por
  antecipação. Sem isso, o piso de preço de quem não vende por marketplace fica
  **otimista demais**, que é o erro mais caro.
- **DIFAL interestadual B2C** (EC 87/2015, LC 190/2022) atinge todo e-commerce
  que envia para fora do estado. É uma matriz de 27 × 27 origens/destinos, com
  alíquotas interestaduais de 7% ou 12% (e 4% para importado, Resolução do Senado
  13/2012) e regras próprias para optantes do Simples que ainda variam por
  estado. ⚠️ *Não pesquisado nesta sessão — é um documento à parte.*

Na loja física, a linha de comissão deve **sumir** do waterfall, não aparecer
como "R$ 0,00". Zero informativo é ruído.

### 6.5 O que dá para cobrir de verdade, e em que ordem

Sendo honesto sobre o tamanho do dataset:

| Camada | Abrangência | Viabilidade |
|---|---|---|
| **Federal** | Anexos I–V, partilha, monofásico por NCM, CBS/IBS, MEI, Presumido, Real | ✅ **Fecha completo.** É lei única, tabela pequena, muda pouco |
| **Estadual** (27) | ST por NCM com vigência, alíquota interna, MVA, sublimite, FCP, DIFAL | 🟡 **Incremental.** O modelo suporta as 27; o dado entra estado a estado |
| **Municipal** (5.570) | ISS | ❌ **Entrada do usuário.** Não há como templatizar |

Isso define a promessa honesta do produto:

- Para **qualquer** tenant, o Kyneti calcula corretamente tudo que é federal — o
  que já inclui a alíquota efetiva do Simples, o monofásico e os regimes.
- Para o estadual, o Kyneti cobre as UFs já mapeadas e, nas demais, **diz que não
  sabe** em vez de chutar. Mesma regra que já vale para taxa de marketplace: sem
  regra validada, bloqueia.
- Cada UF nova mapeada melhora o produto para todos os tenants daquele estado —
  é trabalho que compõe, não trabalho que se repete.

E a ordem natural de mapeamento é por concentração de vendedor: SP, MG, RS, PR,
SC, RJ cobrem a maior parte do varejo digital brasileiro. Não é preciso ter as 27
para lançar; é preciso que o modelo não impeça as 27.

### 6.6 A Reforma simplifica isso — de 2033

Vale registrar como alívio de longo prazo: o IBS **não tem ST**, não tem MVA e
não tem DIFAL — é destino, com crédito integral. A complexidade estadual que a
§6.5 chama de "incremental" tem prazo de validade.

Até lá, porém, o sistema precisa conviver com os dois mundos ao mesmo tempo,
inclusive na faixa 2029–2032 em que ICMS e IBS coexistem com pesos que mudam todo
ano. O trabalho estadual não é desperdício — é o que permite atravessar a
transição sem mentir sobre a margem.

---

## 7. Ordem sugerida

| # | O quê | Prazo | Por quê |
|---|---|---|---|
| 1 | `TenantTaxProfile` + `TaxRateResolver` com Simples calculado por RBT12, resolvendo por atividade (Anexos I–V coexistentes) | — | corrige erro ativo em todo tenant do Simples |
| 2 | `ProductTaxProfile(produto, UF, data)` com vigência — ST estadual + monofásico federal | — | sem isso só funciona para vendedor de um estado e de um nicho |
| 3 | **Taxa de adquirência como custo de canal** | — | quem vende fora de marketplace tem piso otimista demais hoje |
| 4 | MEI e Lucro Presumido/Real no resolver | — | hoje o sistema mente para três dos quatro regimes |
| 5 | Comparador de regime (Simples × regular de IBS/CBS) | **30/09/2026** | janela de opção fecha e só reabre em março/2027 |
| 6 | Alerta de limiar (faixa, sublimite, teto do MEI, R$ 4,8 mi) | — | projeção quase determinística sobre dado que já temos (§5.6) |
| 7 | Conciliação tolerante a retenção de IBS/CBS | **2027** | ou vira falso positivo em massa no split payment |
| 8 | Provider de regras fiscais estaduais, UF a UF | contínuo | ST muda por portaria o ano inteiro; seed nasce velho |
| 9 | DIFAL interestadual B2C | — | atinge todo e-commerce próprio ⚠️ *ainda não pesquisado* |
| 10 | Segunda fórmula de piso (por fora + crédito) | 2027 | o desenho precisa entrar já em 1 e 2 |
| 11 | Crédito de estoque na saída da ST (CAT 28/20 e equivalentes) | por portaria | recorrente enquanto a ST existir |
| 12 | Transição 2029–2032 com pesos por ano | 2029 | depois de 10 |

Reordenado após a §6: o que subiu foram os itens que **decidem se o sistema
atende um nicho ou todos** — resolução por atividade (1), chave por UF (2) e taxa
de adquirência (3). Nenhum deles é mais difícil se feito agora; todos são
retrabalho caro se feitos depois.

Os itens 1 a 4 corrigem o que já está errado hoje. O 5 e o 7 têm data marcada por
lei. O 10 e o 12 são preparação — e a razão de o modelo da §5.9 já nascer com
`incidence` e `creditableRate`, mesmo que ambos sejam constantes até 2027.

O item 8 não tem fim: é operação contínua, como já é o sync de taxas de
marketplace.

---

## 8. Fontes

**Abertas e lidas diretamente nesta sessão:**

- [Receita Federal — Entenda a Reforma Tributária do Consumo](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda)
- [Receita Federal — Orientações da Reforma Tributária para 2026](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026)
- [CGIBS — Novo marco a partir de 03/08/2026](https://www.cgibs.gov.br/novo-marco-da-reforma-tributaria-inicia-em-03-de-agosto-com-preenchimento-obrigatorio-dos-campos-relativos-ao-ibs-e-a-cbs)
- [Portal do Simples Nacional — prazos de opção pelo regime regular de IBS/CBS para 2027](https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=c739e03c-8482-473f-8e82-f38ec3b13637)

**Leis lidas em texto integral** *(PDFs do Planalto fornecidos pelo Guilherme em
02/08/2026, já que o site recusa conexão a partir deste ambiente):*

- ✅ [LC 123/2006 — Simples Nacional e MEI](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm) — art. 18 §§ 1º-A, 1º-B, 2º, 4º-A, 12, 13 e 14
- ✅ [Lei 6.404/1976 — art. 187, DRE](https://www.planalto.gov.br/ccivil_03/leis/l6404consol.htm) — incisos I a VII

**Citadas a partir de resultados oficiais de busca (conteúdo do gov.br):**

- [Planalto — LC 214/2025 (IBS, CBS e IS)](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm) — *planalto recusou conexão*
- [Planalto — LC 227/2026](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm) — *idem*
- [Planalto — Lei 10.147/2000 (monofásico de perfumaria e higiene pessoal)](https://www.planalto.gov.br/ccivil_03/leis/l10147.htm) — *idem*
- [PGFN — Lucro real, presumido e arbitrado](https://www.gov.br/pgfn/pt-br/cidadania-tributaria/por-assunto/irpj-csll/lucro-real-lucro-presumido-e-lucro-arbitrado)
- [Receita Federal — monofásico no Simples Nacional](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2023/fevereiro/operacao-autorregularizacao-do-simples-nacional-com-foco-em-pis-e-cofins-com-indicacao-de-existencia-de-tributacao-monofasica)
- [Planalto — teto do MEI para R$ 140 mil](https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/2026/06/governo-amplia-limite-de-faturamento-do-mei-para-ate-r-140-mil-em-2028-e-autoriza-dois-empregados)
- [Nota técnica SERT/MF — alíquotas de referência](https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria/regulamentacao-da-reforma-tributaria/lei-geral-do-ibs-da-cbs-e-do-imposto-seletivo/notas/nota-tecnica-aliquotas_2024-07-01_sertmf-1.pdf)
- [Resolução CGIBS nº 14, de 29/07/2026](https://www.cgibs.gov.br/upload/arquivos/202607/31144942-resoluc-ao-cgibs-n-14-de-29-de-julho-de-2026-proposta-percentual-ibs-cgibs-2027.pdf)
- [Resolução CGIBS nº 6, de 30/04/2026 — regulamenta o IBS](https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf)

**PDFs oficiais baixados e lidos integralmente (após instalar o poppler):**

- [Perguntas e Respostas do Simples Nacional](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/perguntaosn.pdf) — Receita Federal, 104 páginas. Fórmula da alíquota efetiva, segregação de ST/monofásico (7.1 a 7.4), RBT12 proporcionalizada (5.4), sublimites (cap. 4)
- [Manual do PGDAS-D](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/manual_pgdas-d_2018_v4.pdf) — Receita Federal. Exemplos de cálculo oficiais que confirmaram 5 das 6 faixas do Anexo I e a tabela de partilha
- [CPC 47 Rev. 14 — Receita de Contrato com Cliente](https://conteudo.cvm.gov.br/export/sites/cvm/menu/regulados/normascontabeis/cpc/CPC_47_Rev_14.pdf) — CVM. Itens B34 a B38 (principal × agente)

**São Paulo — desmonte da substituição tributária:**

- [Portaria SRE 64/2025](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-64-de-2025.aspx) — 4º bloco, vigência 01/01/2026
- [Portaria SRE 34/2026](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-34-de-2026.aspx) — 5º bloco, vigência **01/10/2026**
- [Portaria CAT 28/2020](https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-CAT-28-de-2020.aspx) — procedimentos de estoque na saída da ST ✅ *texto integral conferido, com as alterações das Portarias SRE-65/25 e SRE-07/26*
- [Legislação SEFAZ-SP](https://legislacao.fazenda.sp.gov.br) — acompanhar os próximos blocos

**Base normativa citada nas respostas oficiais (não abertas diretamente):**

- Resolução CGSN nº 140/2018, art. 25 §6º (segregação de ST/monofásico) e art. 28 §4º
- LC 123/2006, art. 18, §4º-A inciso I e §12
- Soluções de Consulta Cosit nº 4/2013, nº 173/2014 e Solução de Divergência Cosit nº 4/2014
- [CFC — Conselho Federal de Contabilidade](https://cfc.org.br)

**Para monitorar:** [Programa da Reforma Tributária do Consumo](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo)
e [Resoluções do CGIBS](https://www.cgibs.gov.br/resolucoes) — a regulamentação
está saindo mês a mês.
