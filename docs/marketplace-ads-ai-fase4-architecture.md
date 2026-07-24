# Módulo de Ads Multicanal — Fase 4 (sugestão via IA) — arquitetura

**Status: IMPLEMENTADO.** As seções 0-5 abaixo são o documento de DESENHO original (escrito antes de qualquer código, seguindo o mesmo processo do Hub de Provas e do Full Fulfillment: desenhar → validar com o usuário → só então construir) — mantidas como registro histórico das decisões de design. A seção 6 respondia às perguntas em aberto; a seção 7 (nova, no topo lógico) documenta o que foi de fato construído e onde ficou diferente do desenho original.

**Premissa que não muda (e não mudou):** a IA nunca ganhou um caminho de escrita novo. Ela produz exatamente o mesmo tipo de registro que `AdsAlertingService` (Fase 2) já produz — uma `AdsActionSuggestion` `PENDING` — e entra na fila que `AdsActionDispatcherService` (Fase 3) já sabe processar. `AdsActionDispatcherService` não foi tocado nesta fase — zero linhas alteradas.

## 7. Como foi implementado (decisões finais do usuário + desvios do desenho original)

O usuário respondeu as 3 perguntas da seção 6 assim:

1. **Provider de IA: Anthropic (Claude)**, via `fetch` puro contra `https://api.anthropic.com/v1/messages` — não o SDK oficial (`@anthropic-ai/sdk`), pela mesma razão que `MercadoLivreApiClient`/`NuvemshopApiClient` usam `fetch` puro: nenhuma necessidade de assinatura complexa (como o SigV4 que justificou o SDK da AWS para R2), então uma dependência nova não se paga. Ver `marketplace-ads/infrastructure/ai/anthropic-campaign-advisor.service.ts`.
2. **`targetRoas` por tenant: adiantado agora, com fallback global** — não ficou no `DEFAULT_ROAS_HEALTHY_THRESHOLD` fixo como a opção b) da pergunta original sugeria, nem exigiu configuração obrigatória de todo tenant. Solução híbrida pedida explicitamente pelo usuário ("flexibilidade com valor padrão"): `CatalogSettings.targetRoas` é `Float?` (nullable, raw, sem fallback embutido no repositório/serviço de catálogo); `FinancialPolicyReaderService.getPolicy` é o ÚNICO lugar que resolve `targetRoas ?? DEFAULT_TARGET_ROAS` — mesmo padrão exato já usado para `taxRate`/`minProfitMargin`. `DEFAULT_TARGET_ROAS = 3` é definido em `shared/contracts/financial-policy-reader.port.ts`, deliberadamente DUPLICADO do valor de `DEFAULT_ROAS_HEALTHY_THRESHOLD` (`marketplace-ads/domain/ads-metrics.ts`) em vez de importado de lá — `catalog` nunca pode depender de `marketplace-ads` (sentido de dependência errado).
3. **Escopo de ações: só `PAUSE_CAMPAIGN`** — a opção mais enxuta da pergunta 3, não as três ações (`PAUSE_CAMPAIGN`/`REDUCE_BID`/`INCREASE_BUDGET`) desenhadas nas seções 2 e 4 abaixo. Antes de implementar, o usuário pediu avaliação arquitetural explícita sobre riscos dessa redução de escopo; a resposta (registrada na conversa, resumida aqui): nenhum bloqueio técnico em manter só `PAUSE_CAMPAIGN` — `AdsActionType`/`CampaignOptimizationActionType`/`SUPPORTED_ACTION_TYPES` são todos union types fechados de um único literal hoje, e adicionar `REDUCE_BID` depois é estender o union + implementar `AdsActionCapableProvider.adjustBid` (novo método de capability, mesmo padrão de `pauseCampaign`) — nenhum dos dois exige tocar em `AdsActionDispatcherService`, `AdsAiOptimizationService` ou no schema de `AdsActionSuggestion`. Única mudança preventiva feita agora, adiantando esse crescimento futuro: `AdsActionSuggestion.metadata Json?` já existe no schema desde já (ver 2.1), como o ponto de extensão natural para parâmetros de ações futuras (`bidAdjustmentPct`, etc.) sem nova migração quando `REDUCE_BID` chegar.

Diferenças adicionais entre o desenho e o código final, por honestidade técnica:

- **Sem tendência de série temporal (5+ dias).** O prompt implementado (seção 4, atualizada) usa o mesmo agregado de 30 dias que já alimenta o dashboard (`AdsInsightsService.getDashboard`) — não a série diária que o rascunho de prompt original pedia. A nota de design da seção 4 original ("`AdsAiOptimizationService` precisa montar uma série temporal por campanha... não coberto pelo dashboard atual") permanece um gap real, não implementado nesta fase — o MVP raciocina sobre o agregado do período, igual à Fase 2. Fica registrado como próximo incremento natural, não como um esquecimento silencioso.
- **`ADS_AI_PROVIDER` como variável de seleção de provider não existe.** A seção 1.5 original desenhava `ADS_AI_PROVIDER=anthropic|openai|none` como uma chave de feature-flag; o `.env.example` implementado não tem essa variável — só `ANTHROPIC_API_KEY`/`ADS_AI_MODEL`/`ADS_AI_MIN_CONFIDENCE`, porque só existe um adapter (Anthropic) registrado no módulo (`{ provide: CAMPAIGN_OPTIMIZATION_ADVISOR, useClass: AnthropicCampaignAdvisor }`, fixo). Trocar de provider hoje é trocar essa linha de wiring, não uma variável de ambiente — reavaliar se/quando um segundo provider for adicionado de verdade.
- **`ADS_AI_MAX_CAMPAIGNS_PER_CALL` (truncamento) não foi implementado.** Todas as campanhas elegíveis do tenant (`tier !== 'SEM_DADOS'`) vão num único prompt, sem limite — aceitável para o volume atual (MVP, poucos tenants, poucas campanhas cada), mas é um risco de custo/contexto real se um tenant crescer muito. Não resolvido nesta fase.
- **Cron confirmado:** `AdsAiOptimizationSchedulerJob`, `@Cron(CronExpression.EVERY_DAY_AT_6AM)`, exatamente como desenhado na seção 1.4 — sem due-check contra `ProviderSyncSchedule`, mesma simplicidade consciente de `AdsSyncSchedulerJob`.
- **Migração:** `20260716140000_ads_ai_optimization` (hand-written, mesmo padrão de honestidade técnica das demais — sandbox sem rede não roda `prisma migrate dev`), cobre os 3 campos novos em `AdsActionSuggestion` (`source`/`confidenceScore`/`metadata`) e `CatalogSettings.targetRoas` num único arquivo.
- **Testes:** `anthropic-campaign-advisor.service.spec.ts` (10 casos — chave ausente, lista vazia, happy path, e cada uma das 4 rejeições de `validateSuggestion`, HTTP de erro, resposta sem `tool_use`), `ads-ai-optimization.service.spec.ts` (9 casos — early-exit sem elegíveis, happy path, confidence abaixo do mínimo default e customizado via env, idempotência, campaignId fora do conjunto elegível, falha da IA nunca relança, `runAll` itera providers/tenants e pula provider sem `listTenantIdsToSync`), `financial-policy-reader.service.spec.ts` (6 casos, incluindo fallback de `targetRoas`). Nenhum teste da Fase 3 (`ads-action-dispatcher.service.spec.ts`) precisou de mudança de comportamento — só das fixtures (`source`/`confidenceScore`/`metadata` nos objetos `AdsActionSuggestionSummary` mockados, campos novos e obrigatórios no tipo).

## 0. Onde a Fase 4 se encaixa no que já existe

```
AdsSyncOrchestrator (cron 2h)
  │
  ├─ upsert campanhas + métricas
  ├─ AdsAlertingService.evaluateAndAlert()          ─┐
  │     regra determinística (CUSTO_PERDIDO)         ├─→ AdsActionSuggestion (PENDING)
  │                                                   │
  └─ [NOVO] AdsAiOptimizationService.suggest()       ─┘        │
        regra probabilística (LLM)                            │
                                                                ▼
                                          AdsActionDispatcherService.confirmAndApply()
                                          (SÓ dispara com POST /actions/:id/confirm de um ADMIN)
```

As duas fontes de sugestão (regra determinística e IA) convergem na MESMA tabela e no MESMO dispatcher. Do ponto de vista do Safety Lock, não existe diferença entre "o sistema achou ROAS ruim" e "a IA achou que vale a pena reduzir lance" — as duas são só uma sugestão esperando confirmação humana.

## 1. Desenho da integração

### 1.1 Onde o cliente de IA mora

Mesma disciplina de Ports & Adapters do resto do projeto (`AdsCapableProvider`, `FileStorage`, `OrderFinancialsReader`...): a chamada de IA é uma porta em `shared/contracts`, não uma dependência direta de `@anthropic-ai/sdk`/`openai` espalhada pela aplicação.

```ts
// shared/contracts/campaign-optimization-advisor.port.ts
export interface CampaignOptimizationAdvisor {
  suggestActions(input: CampaignOptimizationRequest): Promise<CampaignOptimizationResponse>;
}
export const CAMPAIGN_OPTIMIZATION_ADVISOR = Symbol('CAMPAIGN_OPTIMIZATION_ADVISOR');
```

Isso permite trocar Anthropic por OpenAI (ou os dois, com fallback) sem tocar em `AdsAiOptimizationService` — mesmo racional de `AlertService` (console hoje, Slack amanhã) e `FileStorage` (local hoje, R2 em produção).

### 1.2 Camadas

| Camada | Peça nova | Responsabilidade |
|---|---|---|
| `shared/contracts` | `CampaignOptimizationAdvisor` (porta) | Contrato — input/output tipados, nenhuma referência a Anthropic/OpenAI aqui. |
| `marketplace-ads/infrastructure` | `AnthropicCampaignAdvisor` (adapter) | Implementa a porta. Único lugar que conhece o SDK da Anthropic, monta o prompt, valida a resposta. |
| `marketplace-ads/application` | `AdsAiOptimizationService` (novo, irmão de `AdsAlertingService`) | Busca dados via `AdsInsightsService` (MESMA fonte do dashboard — nenhuma segunda leitura de métricas), chama a porta, valida a resposta contra regras de negócio, grava `AdsActionSuggestion` via `ADS_ACTION_SUGGESTION_REPOSITORY` (MESMO repositório da Fase 3). |
| `shared/sync-ops` | reaproveitado, zero código novo | `ProviderSyncLogRepository`/`ProviderHealthRepository` — auditoria de cada execução (ver seção 5). |

### 1.3 Reuso de dado — nenhuma segunda fonte de "performance"

`AdsAiOptimizationService` consome `AdsInsightsService.getDashboard(tenantId, dateFrom, dateTo)` — a MESMA estrutura (`AdsCampaignInsight[]`: `totals`, `roas`, `tier`, `recommendation`) que já alimenta o dashboard visual e que `AdsAlertingService` deriva via `classifyCampaignHealth`. A IA nunca lê `AdsMetricSnapshot` diretamente nem recalcula ROAS/TACOS por conta própria — reduz a superfície de "a IA inventou um número" a zero: todo dado que ela vê já passou pela mesma função pura testada (`domain/ads-metrics.ts`).

### 1.4 Trigger — cron separado, não o mesmo ciclo de 2h

Chamada de LLM tem custo e latência que a sincronização de métricas não tem. Proposta: `AdsAiOptimizationSchedulerJob`, `@Cron(CronExpression.EVERY_DAY_AT_6AM)` (ou config por tenant no futuro) — não a cada 2h como `AdsSyncSchedulerJob`. Saúde de campanha não muda o suficiente hora a hora para justificar o custo de token a cada ciclo; o alerta determinístico (Fase 2, barato, roda a cada 2h) já cobre o caso urgente ("campanha estourou o orçamento agora"). A IA é para achar padrões que a regra de threshold não vê (ex.: "campanha ESTRELA mas ROAS caindo 3 dias seguidos — sugerir atenção antes de virar CUSTO_PERDIDO").

Uma chamada por tenant por ciclo, com TODAS as campanhas do tenant num único prompt (não uma chamada por campanha) — controla custo e dá à IA contexto comparativo entre campanhas do mesmo tenant.

### 1.5 Configuração — mesma disciplina de `requireStorageEnv`

```ts
// shared/infrastructure/ai/ai-env.ts
export function requireAiEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} ausente — obrigatória para o provider de IA de Ads (ver docs/marketplace-ads-ai-fase4-architecture.md, seção 1.5).`);
  }
  return value;
}
```

`.env.example` novo:

```
# Fase 4 — Sugestão de ações de Ads via IA (opcional; se ausente, o job pula silenciosamente — ver seção 5)
ADS_AI_PROVIDER=anthropic          # anthropic | openai | none
ANTHROPIC_API_KEY=
ADS_AI_MODEL=claude-sonnet-4-5     # nome do modelo, não hardcoded no adapter
ADS_AI_MAX_CAMPAIGNS_PER_CALL=40   # trunca e avisa, nunca estoura o contexto silenciosamente
```

`ADS_AI_PROVIDER=none` (ou variável ausente) é um estado de primeira classe, não um erro — Fase 4 é opcional (mesmo enquadramento do roadmap desde o início): o `AdsAiOptimizationSchedulerJob` verifica isso e nem tenta rodar, sem alerta nenhum. Só falha alto e explícito se `ADS_AI_PROVIDER=anthropic` mas `ANTHROPIC_API_KEY` estiver ausente — erro de configuração, não estado esperado.

## 2. Contrato de dados — JSON que a IA devolve

Duas restrições não-negociáveis moldam este contrato:

1. **Nunca texto livre.** A chamada usa *structured output* (tool-use com JSON Schema, tanto Anthropic quanto OpenAI suportam) — não "peça JSON no prompt e faça regex depois". Resposta fora do schema é rejeitada pelo SDK antes mesmo de chegar no nosso código.
2. **`actionType` é um enum fechado, validado contra o que os providers hoje sabem executar.** Hoje só existe `AdsActionCapableProvider.pauseCampaign` — `REDUCE_BID`/`INCREASE_BUDGET` ainda NÃO têm um método correspondente no contrato de provider. O JSON já nasce pronto para os três (a IA raciocina sobre os três), mas `AdsAiOptimizationService` valida e descarta (nunca aplica um fallback silencioso) qualquer `actionType` sem capability implementada — mesmo defensive-throw que `AdsActionDispatcherService.applyAction` já tem para tipo desconhecido.

```json
{
  "suggestions": [
    {
      "campaignId": "clx1a2b3c4d5",
      "actionType": "REDUCE_BID",
      "reasoning": "ROAS caiu de 4.2 para 1.8 nos últimos 5 dias com volume estável (62 cliques/dia) — tendência clara de degradação, não ruído estatístico. TACOS do tenant já está em 8%, acima da meta de 6%. Reduzir o lance em vez de pausar preserva o histórico de qualidade do anúncio.",
      "confidenceScore": 0.78,
      "metadata": {
        "suggestedBidAdjustmentPct": -15,
        "roasAtSuggestionTime": 1.8,
        "roasTrend5d": [4.2, 3.6, 2.9, 2.1, 1.8],
        "tacosAtSuggestionTime": 0.08,
        "targetRoas": 3.0
      }
    }
  ],
  "campaignsAnalyzed": 12,
  "campaignsWithNoActionNeeded": 11
}
```

Schema formal (`campaign-optimization-response.schema.ts`, validado com Zod ou class-validator no boundary do adapter — nunca confiar no `success: true` do SDK sozinho):

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `campaignId` | `string` | sim | Deve ser um `AdsCampaign.id` que PERTENCE ao tenant consultado (validado contra a lista enviada no prompt — a IA nunca inventa um ID que não estava no input) |
| `actionType` | `'PAUSE_CAMPAIGN' \| 'REDUCE_BID' \| 'INCREASE_BUDGET'` | sim | Validado contra capabilities do provider antes de virar `AdsActionSuggestion` (ver acima) |
| `reasoning` | `string`, 20–500 chars | sim | Vira `AdsActionSuggestion.reason` — precisa citar NÚMEROS concretos (ROAS, tendência), rejeitado se genérico demais (heurística simples: precisa conter ao menos um dígito) |
| `confidenceScore` | `number`, 0–1 | sim | Abaixo de `ADS_AI_MIN_CONFIDENCE` (padrão 0.6, configurável) a sugestão é descartada, não criada — melhor nenhuma sugestão que uma sugestão de baixa confiança poluindo a fila do admin |
| `metadata` | `Record<string, unknown>`, JSON | não | Contexto quantitativo que embasou a decisão (tendência, meta, delta sugerido) — nunca usado para decidir nada no backend, é só para o admin auditar visualmente antes de confirmar; **não é confiável para automação**, só para leitura humana |

### 2.1 Mudança de schema necessária (ainda não aplicada)

`AdsActionSuggestion` (Fase 3) precisa de 3 campos novos para acomodar isto sem perder informação:

```prisma
model AdsActionSuggestion {
  // ...campos existentes da Fase 3...
  source          AdsActionSource @default(RULE_BASED) // RULE_BASED | AI
  confidenceScore Float?                                 // só preenchido quando source = AI
  metadata        Json?                                  // só preenchido quando source = AI
}
enum AdsActionSource { RULE_BASED AI @@schema("marketplace_ads") }
```

`source` é o campo que separa auditoriamente "o threshold decidiu" de "a IA decidiu" — importante porque as duas têm perfis de confiabilidade diferentes e o admin (e qualquer auditoria futura) precisa distinguir isso na hora de revisar decisões passadas.

## 3. Fluxo de processamento — como a IA nunca aplica nada

```
AdsAiOptimizationService.runForTenant(tenantId)
  1. dashboard = AdsInsightsService.getDashboard(tenantId, últimos 30 dias)
  2. elegíveis = dashboard.campaigns.filter(c => c.tier !== 'SEM_DADOS')   // nunca manda campanha sem dado suficiente pra IA opinar
  3. se elegíveis.length === 0 → encerra, sem chamar a IA (custo zero quando não há nada a avaliar — mesmo early-return de AdsAlertingService)
  4. logId = ProviderSyncLogRepository.start('ADS_AI_ADVISOR', correlationId)   // auditoria, ver seção 5
  5. try:
       response = CAMPAIGN_OPTIMIZATION_ADVISOR.suggestActions({ tenantId, campaigns: elegíveis, targetRoas })
       para cada sugestão validada (schema + confidence + actionType suportado + campaignId pertence ao tenant):
         aberta = ADS_ACTION_SUGGESTION_REPOSITORY.findOpenSuggestion(campaignId, actionType)
         se aberta === null:
           ADS_ACTION_SUGGESTION_REPOSITORY.createPending(tenantId, campaignId, actionType, reasoning, { source: 'AI', confidenceScore, metadata })
       ProviderSyncLogRepository.finish(logId, { status: 'SUCCESS', candidatesFound: elegíveis.length, candidatesApplied: sugestõesCriadas })
     catch (error):
       ProviderSyncLogRepository.finish(logId, { status: 'FAILED', candidatesFound: elegíveis.length, candidatesApplied: 0, errorDetails: error.message })
       AlertService.emitAlert({ source: 'AdsAiOptimizationService', severity: 'WARNING', message: 'Falha ao consultar IA de otimização', context: { tenantId, error } })
       // NUNCA relança — uma falha de IA não pode derrubar o sync nem qualquer outro fluxo
```

Três travas garantem que "a IA nunca executa nada", nenhuma delas opcional:

1. **Caminho de escrita não existe no adapter de IA.** `AnthropicCampaignAdvisor` implementa só `CampaignOptimizationAdvisor.suggestActions` — a classe nem tem acesso a `AdsProviderRegistry` ou a qualquer `AdsActionCapableProvider`. Não é uma trava de configuração, é ausência física de dependência injetada — para a IA "escrever direto" seria preciso mudar a assinatura da classe.
2. **`createPending` só cria `PENDING`.** Olhando o método já existente (`ads-action-suggestion-repository.port.ts`), não existe um `createAndApply`. `AdsAiOptimizationService` literalmente não tem como pedir status diferente de `PENDING` — o repositório não expõe essa opção.
3. **`AdsActionDispatcherService.confirmAndApply` exige `suggestionId` + `confirmedByUserId`**, ambos só disponíveis numa request HTTP autenticada (`@CurrentUser()` no controller). Nenhum service de background tem esses dois valores — não há como um cron "se auto-confirmar".

## 4. Rascunho de System Prompt

```
Você é um analista de mídia paga (ads) que assiste um dono de e-commerce brasileiro a
decidir o que fazer com campanhas de anúncios patrocinados. Você NUNCA executa ações —
você só recomenda, e um humano decide se aplica.

REGRA MAIS IMPORTANTE: seja conservador. Errar por excesso de cautela (deixar de
sugerir algo que ajudaria) é MUITO menos custoso do que errar por excesso de
agressividade (sugerir pausar uma campanha que na verdade estava se recuperando, ou
reduzir o lance de uma campanha sazonalmente lenta que vai vender bem no fim de semana).
Na dúvida, não sugira nada para aquela campanha.

CONTEXTO QUE VOCÊ RECEBE, por campanha, nos últimos 30 dias:
- nome, canal, status atual
- spend, revenueAds, clicks, impressions
- roas (receita_ads / spend; null se spend = 0)
- tier já classificado por regra determinística: ESTRELA, PONTO_DE_ATENCAO,
  CUSTO_PERDIDO ou SEM_DADOS
- meta de ROAS do tenant (targetRoas) — o número abaixo do qual a campanha está
  destruindo margem, não só "abaixo do ideal"
- TACOS atual do tenant (gasto de ads / receita total) — se já está próximo ou acima
  do limite saudável, isso pesa a favor de ações mais conservadoras de gasto

O QUE VOCÊ PODE SUGERIR (actionType), um por campanha, no máximo um por vez:
- PAUSE_CAMPAIGN: só quando o tier já é CUSTO_PERDIDO E a tendência dos últimos dias
  é de piora (não de estabilização) — pausar é a ação mais drástica, use com parcimônia
- REDUCE_BID: quando ROAS está caindo mas ainda não é CUSTO_PERDIDO, ou quando é
  CUSTO_PERDIDO mas a tendência recente sugere recuperação — prefira isto a
  PAUSE_CAMPAIGN sempre que a campanha ainda tiver alguma tração
- INCREASE_BUDGET: só para ESTRELA com ROAS consistentemente acima da meta E volume
  que sugere que a campanha não está saturada — nunca sugira aumento de orçamento sem
  pelo menos 14 dias de dado consistente

O QUE VOCÊ NUNCA FAZ:
- Nunca sugere ação para campanha com tier SEM_DADOS (dado insuficiente não é sinal,
  é ausência de sinal)
- Nunca sugere ação baseada em 1-2 dias de dado — procure tendência de pelo menos
  5 dias antes de recomendar qualquer coisa
- Nunca inventa um campaignId que não estava na lista que você recebeu
- Nunca devolve confidenceScore acima de 0.5 se o padrão observado for ambíguo ou
  contraditório entre as métricas (ex.: ROAS caindo mas cliques subindo forte)
- Se nenhuma campanha justificar uma ação, devolva a lista de sugestões vazia — isso
  é o resultado CORRETO e esperado na maioria das execuções, não uma falha sua

FORMATO DE SAÍDA: responda SOMENTE com uma chamada da ferramenta
`suggest_campaign_actions`, no schema JSON fornecido. Todo campo "reasoning" deve
citar pelo menos um número concreto dos dados que você recebeu (ROAS, tendência,
percentual) — nunca uma justificativa genérica como "a campanha não está performando
bem".
```

Notas de design do prompt:

- **`targetRoas` é hoje `DEFAULT_ROAS_HEALTHY_THRESHOLD = 3` (constante de domínio, `ads-metrics.ts`), não um campo configurável por tenant ainda.** Mesmo gap já documentado na Fase 1 ("thresholds são parâmetros, não constantes hardcoded... futuro: configurável por tenant, mesmo padrão de `FinancialPolicy`"). Fase 4 tem uma razão concreta a mais para resolver isso: sem uma meta de ROAS por tenant de verdade, todo tenant recebe a mesma régua, o que é uma simplificação, não uma mentira — mas vale registrar como próximo incremento natural (`FinancialPolicy.targetRoas`, mesmo padrão de `minProfitMargin`).
- Prompt pede tendência de 5+ dias, não só o snapshot agregado do período — isso significa que `AdsAiOptimizationService` precisa montar uma série temporal por campanha (não só o total agregado que `AdsInsightsService.getDashboard` devolve hoje), buscando `AdsCampaignRepository.sumMetricsByCampaign` em janelas diárias ou adicionando um novo método ao repositório (`listDailySeriesByCampaign`) — mencionado aqui para ficar registrado como pré-requisito de implementação, não coberto pelo dashboard atual.

## 5. Auditoria de falha de comunicação com a IA

Reaproveitando infraestrutura já existente em vez de inventar uma nova (mesma disciplina de todo o projeto):

- **`ProviderSyncLogRepository.start('ADS_AI_ADVISOR', correlationId)` / `.finish(...)`** — mesma tabela genérica que já registra toda execução de sync de todo provider (`candidatesFound` = campanhas elegíveis avaliadas, `candidatesApplied` = sugestões criadas, `errorDetails` = mensagem de erro se a chamada de IA falhar). Zero schema novo — `providerCode` é `string` livre, não amarrado a um marketplace real.
- **`ProviderHealthRepository.recordFailure('ADS_AI_ADVISOR', ...)`** em falha — mesmo painel de saúde que já existe para os providers de marketplace passa a mostrar "IA de Ads" como mais uma linha, sem UI nova.
- **`AlertService.emitAlert({ severity: 'WARNING', source: 'AdsAiOptimizationService' })`** em toda falha — `WARNING`, não `ERROR`: IA indisponível é uma degradação de uma feature opcional, não uma falha do sistema núcleo (a Fase 3 continua funcionando 100% via o caminho determinístico da Fase 2 mesmo com `ADS_AI_PROVIDER=none` ou a API da Anthropic fora do ar).
- **Nenhum retry automático dentro do mesmo ciclo.** Se a chamada falhar, o ciclo termina e o próximo `@Cron` tenta de novo no dia seguinte — evita amplificar uma instabilidade da API externa em uma tempestade de retries.
- **Toda resposta bruta da IA (antes da validação de schema) é logada em nível `debug`**, nunca `info`/produção-visível por padrão — permite investigar uma rejeição de schema depois, sem expor dado de tenant em log de produção por padrão.

## 6. O que fica pendente de confirmação com o usuário antes de implementar

1. Provider de IA: Anthropic, OpenAI, ou os dois com fallback? (proposta aqui assume Anthropic como primário, dado que é o modelo usado nesta própria sessão de desenvolvimento)
2. `targetRoas` por tenant: vale a pena adiantar o campo em `FinancialPolicy` agora, ou Fase 4 usa o `DEFAULT_ROAS_HEALTHY_THRESHOLD` global por enquanto?
3. `REDUCE_BID`/`INCREASE_BUDGET` como capability real de provider (`AdsActionCapableProvider.adjustBid`/`adjustBudget`) é trabalho novo em `MercadoLivreApiClient` — mesmo aviso de honestidade da Fase 3 (path/shape não validado contra API real) se aplica aqui também. Confirmar se a Fase 4 entra já com as 3 ações ou começa só com `PAUSE_CAMPAIGN` (reaproveitando o que a Fase 3 já validou) e adiciona as outras duas depois.
