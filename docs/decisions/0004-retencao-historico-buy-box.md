# ADR 0004 — Retenção de 365 dias para o histórico de transições de buy box

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-10-14 |
| **Decisores** | Gui (produto), Claude (implementação) |
| **Escopo** | módulo `competition-intelligence` |

## Contexto

`CompetitiveOpportunityStatusChange` (ver `docs/competition-intelligence-architecture.md`, seção
11) foi implementada em 14/10/2026 para responder "quais SKUs passaram a perder o buy box desde
ontem" — pergunta real, feita a partir de uma notificação do Mercado Livre. A tabela nasceu sem
política de retenção, o que `.claude/rules/database.md` ("Auditoria e histórico") exige definir
**antes** de a tabela crescer. Sem decisão, a tabela cresceria sem limite, mesmo problema que já
existe e está registrado (não resolvido por este ADR) para `CompetitorOfferSnapshot`.

## Decisão

Mantemos 365 dias de histórico em `competitive_opportunity_status_changes`, com apagamento
físico (hard delete) das linhas mais antigas, rodado uma vez por dia por
`BuyBoxStatusChangeRetentionCleanupJob` (`@Cron(EVERY_DAY_AT_4AM)`). A regra de corte é pura
(`domain/status-change-retention.ts`), separada do I/O (`BuyBoxStatusChangeRetentionService` →
`BuyBoxStatusChangeRepository.deleteOlderThan()`), mesmo desenho de
`VideoRetentionCleanupJob`/`VideoCaptureService.runRetentionCleanup` em `logistics-fulfillment`.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| 30 dias (mesmo prazo do vídeo de conferência) | Volume minúsculo, consistente com outro precedente do repositório | Destrói justamente o dado que motivou a feature — análise de tendência/sazonalidade de buy box precisa de mais que um mês | A própria motivação da seção 11 é "desde ontem", mas o valor de longo prazo é comparar períodos (ex.: "perdemos esse SKU todo dezembro?") |
| Sem retenção (manter para sempre) | Nenhuma perda de dado histórico | Viola `.claude/rules/database.md` diretamente; tabela de log sem TTL é dívida que só cresce | Regra do projeto já diz que isso não é aceitável a partir do momento em que a tabela existe |
| Soft delete / archival em storage frio | Permite recuperação depois do corte | Mais uma camada (coluna + filtro em toda query, ou pipeline de export) para um dado que não é fonte de verdade de nada — `CompetitiveOpportunity` (consumida pelo Pricing Engine) não depende desta tabela | Custo não se paga para um histórico que é, por natureza, derivado e reconstruível a partir de nova coleta a partir de agora |

## Consequências

**Positivas**
- Tabela de evento/log passa a ter política de retenção definida, fechando a lacuna apontada em
  `.claude/rules/database.md`.
- 365 dias cobre o caso de uso real (comparação sazonal), sem exigir infraestrutura nova.
- Mesmo padrão de job já existente no repositório (`VideoRetentionCleanupJob`) — nada de
  framework ou dependência nova.

**Negativas / custo aceito**
- Histórico de buy box mais antigo que 1 ano deixa de existir — análise multi-ano não é possível
  sem decisão futura de archival.
- Hard delete é irreversível linha a linha (diferente do soft delete) — aceito porque o dado é
  derivado, não auditoria regulatória nem financeira.

**O que fica mais difícil depois desta decisão**
- Se o produto precisar de histórico além de 1 ano no futuro (ex.: comparar duas Black Fridays),
  será preciso archival explícito antes do corte, não só aumentar a constante.

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| Job de limpeza falha silenciosamente e a tabela cresce sem controle | Alerta de observabilidade ausente hoje — falha só aparece em log (`Logger.error`), sem `AlertService` | Cobrir com `AlertService` se o volume real em produção justificar (hoje, cresce só por transição real, volume baixo) |
| 365 dias se mostrar curto demais na prática (usuário pede comparação com ano anterior) | Pedido explícito do usuário por histórico mais antigo que já foi apagado | Reabrir este ADR, decidir archival ou aumentar o prazo antes de implementar |

## Reversibilidade

Alta. Mudar o valor de `BUY_BOX_STATUS_CHANGE_RETENTION_DAYS` é uma linha, sem migration — afeta
só o próximo ciclo do job. Aumentar o prazo nunca perde dado adicional (o que já foi apagado,
porém, não volta). Desligar o job inteiro (remover do módulo) volta ao estado "sem retenção",
mesmo estado de antes deste ADR.

## Referências

- `docs/competition-intelligence-architecture.md`, seção 11.
- `.claude/rules/database.md`, "Auditoria e histórico".
- Precedente: `apps/api/src/modules/logistics-fulfillment/application/video-capture.service.ts`
  (`VIDEO_RETENTION_DAYS`, 30 dias) e
  `apps/api/src/modules/logistics-fulfillment/infrastructure/scheduler/video-retention-cleanup.job.ts`.
