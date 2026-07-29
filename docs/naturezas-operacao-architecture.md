# Naturezas de Operação — CFOP configurável (Projeto Estruturante 4, benchmark Bling ERP)

Implementado em 29/07/2026, a partir de `docs/bling-erp-benchmark-analysis.md`, seção 2 (`NaturezasOperacoesDadosDTO`). Antes desta rodada, `tax-code-resolver.ts` (`resolveCfop`) resolvia o CFOP de toda NF-e emitida com um único par de códigos hardcoded (5102/6102, venda de mercadoria adquirida ou recebida de terceiros — o caso comum de revenda simples no Simples Nacional), sem nenhuma forma de o tenant configurar um CFOP diferente para um cenário fiscal distinto (industrialização própria, substituição tributária, etc.).

## 1. Escopo desta rodada (decisão deliberada)

O Bling modela `Natureza de Operação` como um cadastro completo, com regra por tipo de operação (venda física/jurídica/consumidor final/compra/devolução) e um endpoint dedicado que devolve a tributação inteira calculada (CFOP + CST de ICMS/PIS/COFINS) para aquela natureza.

**Decisão**: esta rodada generaliza especificamente o CFOP — o ponto mais hardcoded e mais citado no benchmark — para um cadastro configurável (`NaturezaOperacao`). CST de ICMS/PIS/COFINS (`ICMS_SITUACAO_TRIBUTARIA_DEFAULT` etc.) e os campos `consumidor_final`/`indicador_inscricao_estadual_destinatario` do payload (hoje fixos, assumindo sempre B2C não-contribuinte) permanecem como estão — generalizar a tributação inteira exigiria capturar mais dados do destinatário (tipo de inscrição estadual, se é contribuinte) que `EmitInvoiceInput` não coleta hoje, e é um escopo maior que "CFOP configurável".

**AVISO DE HONESTIDADE (mesmo racional de `FiscalMarketplaceIntermediary`)**: o Kyneti NUNCA fabrica um código CFOP para um cenário que não verificou — o único CFOP "de fábrica" continua sendo o fallback hardcoded histórico (5102/6102 venda, 5202/6202 devolução). Uma `NaturezaOperacao` customizada exige que o tenant (ou seu contador) preencha os códigos conscientemente; o Kyneti só garante o formato (4 dígitos), nunca a correção fiscal do valor.

**Gap conhecido, documentado, não escondido**: sem split de venda/devolução automático por fórmula — o CFOP de devolução de uma natureza customizada, quando informado, é um campo explícito (`cfopDevolucaoInterno`/`cfopDevolucaoInterestadual`), nunca derivado do CFOP de venda por regra (a correspondência venda→devolução não é universal para qualquer CFOP).

## 2. Cadastro — `NaturezaOperacao` (schema `fiscal`)

Tabela nova no schema `fiscal` já existente. Campos: `nome` (único por tenant), `cfopVendaInterno`/`cfopVendaInterestadual` (obrigatórios — usados para finalidade NORMAL/COMPLEMENTAR/AJUSTE, mesmo racional já documentado em `tax-code-resolver.ts`: só DEVOLUCAO muda o CFOP), `cfopDevolucaoInterno`/`cfopDevolucaoInterestadual` (opcionais — ausentes caem no fallback hardcoded 5202/6202), `isActive` (soft toggle, nunca DELETE físico — mesma filosofia de `VendedorService`, uma natureza já usada numa emissão passada não pode desaparecer do histórico).

`NaturezaOperacaoService` (CRUD): `create`/`update` validam formato via `isValidNaturezaOperacaoCfopConfig` (4 dígitos numéricos) e rejeitam nome duplicado no tenant. `setActive` alterna ativo/inativo. `requireActiveForEmission` (consumido só por `FiscalInvoiceService`) rejeita natureza inativa antes de emitir.

## 3. Domínio — `resolveCfopFromNatureza` (`domain/tax-code-resolver.ts`)

Generaliza `resolveCfop`: em vez do único CFOP hardcoded, recebe um `NaturezaOperacaoCfopConfig` (os 4 campos de CFOP acima) e resolve por `ufEmitente`/`ufDestinatario`/`finalidade`, com a MESMA regra estrutural de antes (só `DEVOLUCAO` muda o CFOP; Complementar/Ajuste mantêm o de venda). Quando a natureza não define CFOP de devolução, cai exatamente no mesmo fallback que `resolveCfop` usa (`CFOP_DEVOLUCAO_INTERNA_DEFAULT`/`CFOP_DEVOLUCAO_INTERESTADUAL_DEFAULT`, os mesmos `'5202'`/`'6202'` de sempre — constantes agora exportadas e compartilhadas entre as duas funções, nunca duplicadas).

`isValidCfopCode`/`isValidNaturezaOperacaoCfopConfig`: validam só o FORMATO (regex `^\d{4}$`) — nunca a correção fiscal do valor, que é responsabilidade do tenant/contador.

## 4. Integração com a emissão — `FiscalInvoiceService`/`buildNfePayload`

`EmitInvoiceInput` ganhou `naturezaOperacaoId?: string`. Ordem de resolução em `FiscalInvoiceService.emit`: **(1)** `naturezaOperacaoId` explícito no input da emissão, **(2)** `FiscalSettings.defaultNaturezaOperacaoId` (natureza padrão do tenant, configurável em `PUT /fiscal/settings`), **(3)** ausência de ambos — `buildNfePayload` cai no `resolveCfop` hardcoded histórico, **zero mudança de comportamento** para qualquer tenant que nunca configurou nada.

`NfePayloadInput` ganhou `cfopConfig?: NaturezaOperacaoCfopConfig` — `buildNfePayload` (domínio puro) decide internamente entre `resolveCfopFromNatureza` (quando presente) e `resolveCfop` (quando ausente), mantendo toda a lógica de resolução de CFOP no mesmo lugar (nunca duplicada no `FiscalInvoiceService`).

`FiscalSettingsService.upsert` ganhou `defaultNaturezaOperacaoId` no `UpsertFiscalSettingsInput`: `undefined` (campo não enviado) mantém o valor já salvo; `null` explícito remove a natureza padrão (volta ao fallback hardcoded); uma string valida, via `NaturezaOperacaoService.findOne`, que a natureza existe e pertence a este tenant ANTES de gravar — nunca aponta para um id inexistente ou de outro tenant.

## 5. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/fiscal/naturezas-operacao` | Cadastra uma Natureza de Operação (ADMIN) |
| `GET` | `/fiscal/naturezas-operacao` | Lista as naturezas do tenant |
| `GET` | `/fiscal/naturezas-operacao/:id` | Detalhe de uma natureza |
| `PATCH` | `/fiscal/naturezas-operacao/:id` | Atualiza CFOPs/nome (ADMIN) |
| `PATCH` | `/fiscal/naturezas-operacao/:id/active` | Ativa/inativa (ADMIN) |
| `PUT` | `/fiscal/settings` | Ganhou `defaultNaturezaOperacaoId` (natureza padrão do tenant) |
| `POST` | `/fiscal/invoices/:orderId/emit` | Ganhou `naturezaOperacaoId` (sobrepõe a padrão só nesta emissão) |

## 6. Aplicação manual pendente (tabela nova em schema existente)

`fiscal.naturezas_operacao` é tabela nova num schema já existente — não precisa de grant separado (coberto pelo `ALTER DEFAULT PRIVILEGES` de `fiscal` desde a Fase 3), só da policy:

```
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_naturezas_operacao_rls_only.sql
```

A mesma policy também foi anexada ao arquivo mestre `2026-07-17_enable_row_level_security.sql`. A coluna nova `fiscal.fiscal_settings.defaultNaturezaOperacaoId` não precisa de policy nem grant novos (RLS é por linha, não por coluna). Precisa rodar `npx prisma migrate deploy` ANTES (cria a tabela/coluna novas), só depois o script de RLS acima.

## 7. O que falta (gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- CST de ICMS/PIS/COFINS continuam hardcoded (Simples Nacional) — fora do escopo desta rodada (só CFOP).
- `consumidor_final`/`indicador_inscricao_estadual_destinatario` no payload continuam fixos (perfil B2C não-contribuinte) — generalizar isso exigiria capturar mais dados do destinatário, que `EmitInvoiceInput` não coleta hoje.
- Sem endpoint que devolva a "tributação calculada" completa para uma natureza (como o Bling expõe) — hoje o tenant só vê os CFOPs cadastrados, a aplicação deles acontece implicitamente na emissão.
- Sem fórmula de derivação venda→devolução — CFOP de devolução customizado é sempre um campo explícito, nunca calculado.
