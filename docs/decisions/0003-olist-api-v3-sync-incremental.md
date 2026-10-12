# ADR 0003 — Sync do Olist pela API v3, incremental e híbrido

| | |
|---|---|
| **Status** | proposto (a fatia 1 só entrega conexão e verificação; o sync continua na v2) |
| **Data** | 2026-10-12 |
| **Decisores** | Dono do produto (gssilvasantos) |
| **Escopo** | `apps/api/src/modules/erp-integration` — importação do catálogo do Olist |

## Contexto

O sync atual usa a API v2 (Tiny: `produtos.pesquisa.php` + `produto.obter.php`, token estático).
A cada execução ele refaz a **varredura completa** do catálogo: 1 chamada por produto pai e 1 por
variação. Com ~1.050 produtos no Kyneti e ~1.800 SKUs no Olist, isso é da ordem de 1.800
chamadas a 1 req/1,33 s (`marketplace-rate-limits.ts`), ou 40–54 min.

O que isso causa hoje (evidência de 2026-10-10 e 2026-10-12):

- **Bloqueio de cota.** Os logs de 10/10 mostram `API Bloqueada - Excedido o número de acessos`
  nas variações RM0185-1/2/3 e em mais uma. O limite é por conta e é dividido com marketplaces e
  outros apps (o `rm-catalogo` usa a v3 na mesma conta Olist).
- **Sync cortado pelo Render.** `precifica-saas` roda no plano `free`, que derruba o processo após
  15 min sem tráfego. O sync leva mais que isso. O checkpoint `resumeFromPage` só cobre a fase de
  busca; o estado do card fica em `PARTIAL` desde 2026-10-10 10:07 (horário de Brasília).
- **Mensagem enganosa.** `motivoVisivelDeRejeicao` rotula qualquer erro de infraestrutura como
  "falha interna ao gravar", inclusive bloqueio de cota (corrigir é outra fatia).

O Kyneti **já guarda** o catálogo (Postgres) e um hash de conteúdo por produto
(`ErpSyncChangeEvent.contentHash`). O hash evita regravar, mas não evita **buscar** tudo de novo.

## Decisão

Migrar a **busca** do catálogo para a API v3 do Olist (OAuth2), em modo incremental e híbrido:

1. **Primeira carga completa uma vez** (a que já existe no Kyneti).
2. **Rotina**: `GET /produtos?dataAlteracao=<último sync>` traz só o que mudou (sku, gtin, preços
   incluindo custo, `tipoVariacao`). Estoque vem do detalhe do pai (`variacoes[].estoque.quantidade`),
   porque a listagem só devolve `estoque.localizacao`.
3. **Detalhe individual** (`GET /produtos/{id}`) só para produto/variação **novo ou alterado**, que
   é o único caminho para peso, dimensões, NCM e fotos (a variação, dentro do pai, não os traz).
4. **Varredura completa rara** (ex.: semanal) como rede de segurança contra o que o filtro não pegue.
5. A v2 permanece como reserva até a v3 provar equivalência.

Estimativa por rotina: ~11 chamadas de listagem + ~130 de detalhe de pais (estoque), contra ~1.800.

**Esta fatia (1 de 3)** entrega somente: colunas de token v3 (opcionais), cliente v3, fluxo OAuth
atrás da flag `OLIST_V3_ENABLED` (desligada por padrão) e um endpoint de **verificação somente de
leitura**. Não altera o sync v2. As fatias seguintes: (2) sync incremental v3 atrás de flag,
(3) corte da v2 e keep-alive do token.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Fila de atualizações da v2 (`produtos.lista.atualizacoes`, `lista.atualizacoes.estoque`) | Mesmo token, sem OAuth | Cada chamada **consome** a fila no Olist (não repetível); exige a extensão "API para estoque em tempo real"; disputa a fila com outras integrações; falha no meio perde alterações | Não é seguro como base de sync. Não foi chamada em produção. |
| Só subir o Render para plano pago | Elimina o corte do processo | Não reduz as ~1.800 chamadas; a cota continua estourando | Necessário, mas não suficiente. Recomendado em paralelo. |
| v3 com varredura completa a cada sync | Simples | Mesmo volume de chamadas de detalhe por variação | Perde o ganho principal |
| Manter a v2 e só retomar o que falhou | Menor mudança | Continua varredura completa a cada sync | Trata o sintoma |

## Consequências

**Positivas**

- Rotina de poucos minutos, cabendo na janela de 15 min do plano free.
- Filtro por data repetível: falha no meio não perde alteração.
- A v3 devolve cabeçalhos `x-ratelimit-*`, que o cliente respeita (o `rm-catalogo` já faz assim).

**Negativas / custo aceito**

- **OAuth**: access token de 4 h, refresh de 24 h (valores do `rm-catalogo`; a verificação desta
  fatia confirma contra a conta). Se o processo ficar parado mais de 24 h sem renovar, o refresh
  expira e é preciso reconectar. Exige keep-alive (fatia 3): ping periódico ou plano sem spin-down.
- **`cest`** não existe na v3 (conferido no OpenAPI 3.1). Passa a valer só o que já está gravado.
- Peso/dimensão/foto por variação dependem da chamada individual. Nos dados atuais, 660 de 678
  variações têm o mesmo peso do pai, 3 diferem em dimensões e 466 têm fotos próprias.
- Dois mecanismos de credencial do Olist convivem até o corte da v2.

## Riscos

| Risco | Sinal de alerta | Plano |
|---|---|---|
| Limite de cota da v3 menor que o esperado | `x-ratelimit-remaining` baixo na verificação; HTTP 429 | A verificação lê e relata o limite; o cliente espera `x-ratelimit-reset` |
| `dataAlteracao` não refletir toda mudança (ex.: só estoque) | Verificação mostra produto com saldo diferente sem entrar no filtro | Estoque vem do detalhe do pai, não do filtro; varredura completa rara |
| Refresh token rotacionado e perdido em corrida | Erro 400/401 no refresh | Renovação com single-flight por tenant e gravação do novo par antes do uso |
| Resposta real diferente do OpenAPI | Campo ausente na verificação | A verificação lista presença de campo por SKU antes de qualquer sync |
| Segredo do app vazar | Valor em log ou resposta | `OLIST_V3_CLIENT_SECRET` só em variável de ambiente; nunca em log, erro ou resposta |

## Reversibilidade

Alta nesta fatia: as colunas novas são opcionais e a flag vem desligada; desligar a flag devolve o
comportamento atual. Rollback de schema: `ALTER TABLE ... DROP COLUMN` das 5 colunas (sem dado de
negócio, só tokens que podem ser refeitos reconectando).

## Não verificado até a data deste ADR

- Se `GET /produtos/{id}` de uma **variação** devolve peso e dimensões (esperado, pelo OpenAPI,
  mas sem chamada real).
- Limite real de requisições da v3 para esta conta.
- Duração real do refresh token.
- Comportamento de `dataAlteracao` em movimentação de estoque.

O endpoint de verificação desta fatia existe para responder a isso com a conta real.

## Referências

- OpenAPI da Olist ERP API v3 (3.1), fornecido pelo dono do produto em 2026-10-12.
- `apps/api/src/modules/erp-integration/application/erp-sync-orchestrator.service.ts`
- `apps/api/src/modules/marketplace-intelligence/application/mercado-livre-connection.service.ts`
  (padrão OAuth reaproveitado)
- `docs/auth-security.md` (state criptografado, callback público)
