# Produto Pai + Variação (Fase 2, benchmark Tiny ERP)

Implementado em 28/07/2026, a partir de `docs/tiny-erp-benchmark-analysis.md`, seção 2.3. Antes disso, o catálogo do Kyneti tratava cada SKU como uma entidade solta — "Camiseta Azul P" e "Camiseta Azul M" eram dois produtos sem relação nenhuma no sistema, e o lojista gerenciava esse vínculo de cabeça. Esta feature absorve o *conceito* de produto pai/variação do Tiny, deliberadamente sem replicar sua implementação exata.

## 1. Por que um único campo, não dois

O Tiny modela isso com dois mecanismos redundantes ao mesmo tempo: `tipoVariacao` (`N`/`P`/`V` — Normal/Pai/Variação) *e* `produtoPai` (referência ao pai). O benchmark (seção 3, "O que descartar") já sinalizou essa redundância como algo a não trazer. O Kyneti usa só `Product.parentProductId`, nullable, auto-relacionamento na mesma tabela:

- `parentProductId = null` → o produto é "normal" **ou** é um "pai". Ser pai nunca é um flag gravado — é estado **derivado**: um produto é pai se e somente se outros produtos apontam para ele via `parentProductId` (mesmo racional de `resolveEffectiveStatus` em outras entidades desta base, como `AccountsPayable`/`Order`: nunca persistir o que pode ser calculado na leitura).
- `parentProductId = <id>` → o produto é uma variação daquele pai.

Isso significa que o "produto pai" continua sendo uma linha normal de `Product` — com seu próprio `skuCode`, preço, custo etc. Na prática, o lojista cadastra o pai como um produto "guarda-chuva" (pode nunca ser vendido diretamente) e depois cria cada variação apontando para ele.

## 2. Grade de atributos (`variantAttributes`)

Em vez de replicar `GradeVariacaoResponseModel` do Tiny (um sistema configurável de "tipos de atributo" cadastrados previamente), `Product.variantAttributes` é um JSON livre chave/valor — `{"Cor": "Azul", "Tamanho": "P"}`. Cobre o caso real (mostrar "Azul / P" na tela) sem exigir nenhum cadastro prévio de taxonomia de atributos. Só faz sentido quando `parentProductId` não é nulo — `isValidVariantAttributes` (`domain/product-variant.ts`) exige pelo menos um par chave/valor não vazio; é o "sinal" de que essa variação realmente varia em algo.

## 3. Hierarquia de um nível só

Deliberadamente **sem** múltiplos níveis (uma variação não pode ela mesma ter variantes). O gate `canSetParent` (função pura, `domain/product-variant.ts`) impede isso em duas direções:

- O candidato a pai não pode já ser, ele mesmo, uma variação (`candidateParent.parentProductId !== null` → rejeita).
- O produto que está virando variação não pode já ter filhos (`ProductRepository.findChildren` consultado antes do gate).

Também rejeita auto-referência (um produto virando pai de si mesmo). `ProductsService` monta esse contexto (busca o candidato a pai, busca os filhos existentes) e delega a decisão para a função pura — nenhuma lógica de hierarquia vive fora do domínio.

`onDelete: SetNull` na FK (não `Cascade`): apagar o produto pai nunca deveria arrastar a exclusão das variações, que continuam sendo produtos vendáveis por si só, mesmo órfãos.

## 4. Onde os campos são editáveis

Nem `parentProductId` nem `variantAttributes` entraram em `ERP_OWNED_FIELDS` (`domain/product-ownership-rules.ts`) — não são fatos físicos espelhados do ERP, são organização/estratégia de catálogo da Precifica, mesmo racional de `mapPrice`/`autoRepricingEnabled`/`isKit`. Continuam editáveis mesmo em produtos com `sourceSystem = ERP_OLIST`.

Desvincular do pai (`parentProductId: null` explícito) é sempre permitido, sem gate — uma variação virar produto normal de novo nunca quebra a hierarquia de ninguém.

## 5. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/products` | Aceita `parentProductId`/`variantAttributes` opcionais no corpo |
| `PATCH` | `/products/:id` | Mesmos campos — aceita `parentProductId: null` para desvincular |
| `GET` | `/products/:id/variants` | Lista as variações vinculadas a este produto (vazio se não é pai) |

## 6. Geração automática de combinações (Quick Win 5, benchmark Bling, 29/07/2026)

`POST /products/:id/variants/generate-combinations` — espelha `POST /produtos/variacoes/atributos/gerar-combinacoes` do Bling (`docs/bling-erp-benchmark-analysis.md`, seção 1.5). `:id` é o produto PAI (precisa já existir e não ser ele mesmo uma variação). O corpo é a grade de atributos — `{"attributes": [{"name": "Cor", "options": ["Azul", "Verde"]}, {"name": "Tamanho", "options": ["P", "M", "G"]}]}` — e o endpoint cria uma variação para CADA combinação (produto cartesiano, `generateVariantCombinations` em `domain/product-variant.ts`, função pura).

- Cada variação herda do pai tudo que não é a própria grade: `costPrice`, margens, dimensões/peso, dados fiscais (`ncm`/`gtin`/`fiscalOriginCode`/`cest`), fornecedor, perfil fiscal, embalagem, categoria. O lojista ajusta o que precisar depois via `PATCH` em cada variação — o endpoint só resolve o trabalho repetitivo de cadastro, não tenta adivinhar preço/custo por combinação.
- `skuCode` de cada variação é `{skuCode do pai}-{sufixo por atributo}` (ex.: `CAMISETA-01-AZUL-P`), gerado por `buildVariantSkuCode` (pura) — normaliza acento/espaço/caixa (`Azul Marinho` -> `AZUL-MARINHO`). `name` segue o mesmo padrão via `buildVariantName` (`Camiseta Básica (Azul / P)`).
- Duas combinações que gerariam o mesmo `skuCode` (ex.: opções `"Azul"` e `"AZUL"` na mesma grade, que normalizam igual) são rejeitadas ANTES de criar qualquer variação — erro de cadastro do próprio lojista na grade informada, melhor recusar tudo de uma vez do que criar uma leva parcial.
- Reaproveita o MESMO gate `canSetParent`/`isValidVariantAttributes` de uma criação manual — cada variação passa pelo `ProductsService.create()` de sempre, nenhuma lógica de hierarquia duplicada.
- **Limitação MVP consciente**: a criação das N variações é sequencial, não uma transação atômica (diferente de `AccountsPayable.createMany`, onde as parcelas de um MESMO parcelamento precisam nascer juntas). Se uma combinação falhar no meio do loop (ex.: SKU já usado por outro produto do tenant, fora do próprio conflito interno já checado acima), as variações já criadas antes da falha permanecem — o lojista vê o erro e completa manualmente o que faltou.

## 7. O que falta (MVP, gaps conhecidos)

- Sem UI ainda no frontend — só a API, mesmo padrão de Contas a Pagar/Ordem de Compra (backend primeiro).
- `variantAttributes` não é validado contra um conjunto fechado de chaves (`Cor`, `Tamanho` são só o exemplo mais comum) — texto livre no MVP, mesma filosofia de `Supplier.paymentTerms`/`internalCategory`.
- Nenhum agregado automático de estoque/preço do pai a partir das variações — cada variação mantém seu próprio `costPrice`/`stockQuantity`/margens, como qualquer outro produto.
