# Emissão de NF-e (Fase 3, benchmark Tiny ERP)

Implementado em 28/07/2026, a partir de `docs/tiny-erp-benchmark-analysis.md`, seção 1.1 — o maior gap identificado no benchmark contra o Tiny ERP. Absorve o *conceito* de emissão fiscal do Tiny (`POST /notas/{idNota}/emitir`), mas via um provedor especializado (Focus NFe), não um motor fiscal próprio.

## 1. Por que Focus NFe (recap da Fase 0)

Emitir NF-e de verdade exige certificado digital A1, comunicação direta com a SEFAZ de cada estado, contingência em caso de indisponibilidade — reimplementar isso do zero não vale o esforço frente ao valor que destrava. A Fase 0 (task #309) já havia decidido por um provedor de API REST (Focus NFe ou eNotas); nesta fase, confirmado com o usuário: **Focus NFe**, API v2, autenticação HTTP Basic (token da empresa como usuário, senha em branco), dois ambientes (`homologacao.focusnfe.com.br` / `api.focusnfe.com.br`).

**Aviso de honestidade**: a integração foi implementada a partir da documentação pública da Focus NFe — ainda não foi exercitada contra uma emissão real. O usuário já tem certificado A1 ativo, mas hoje emite pelo Olist/Tiny — ver seção 7 sobre o risco de colisão de série.

## 2. Bounded context próprio (schema `fiscal`)

Novo schema Postgres `fiscal`, dois models:

- `FiscalSettings` — singleton por tenant (mesmo padrão de `CatalogSettings`): CNPJ, razão social, endereço do emitente, regime tributário, token Focus NFe **criptografado em repouso** (reaproveita `CredentialEncryptionService`, `shared/security/`, o mesmo usado para o token do Olist), ambiente (homologação/produção), `autoEmitOnApproval` (opt-in) e `nfeSerie`.
- `FiscalInvoice` — uma linha por **tentativa** de emissão, nunca sobrescrita. Referência solta a `Order` (`orderId String`, sem FK — Orders vive num schema diferente, mesmo racional de `PurchaseOrder.supplierId`). Guarda o destinatário **como snapshot no momento da emissão** (`destNome`/`destDocumento`/`destEndereco`/`destTelefone`) — uma NF-e autorizada é um documento fiscal imutável, nunca deve mudar se o pedido for editado depois.

## 3. Reemissão sem sobrescrita

`FiscalInvoice` é append-only por pedido: cada tentativa gera uma linha nova, com `focusRef` construído por `buildFocusRef(tenantId, orderId, attempt)` (ex.: `tenant1-order1-2` na segunda tentativa). O gate `canEmit` (`domain/fiscal-invoice.entity.ts`) só libera uma nova tentativa se:

- o pedido não estiver `EM_ABERTO` nem `CANCELADO`;
- não existir nenhuma tentativa anterior `PENDENTE`, `PROCESSANDO` ou `AUTORIZADA` (bloqueia duplicidade — só reemite em cima de uma tentativa que terminou em `ERRO`, ou se não existe nenhuma ainda).

Uma NF-e `AUTORIZADA` nunca é reemitida por cima — para desfazer, o caminho é `cancel` (gate `canCancel`, só a partir de `AUTORIZADA`, com justificativa de 15-255 caracteres, mesma exigência da SEFAZ/Focus NFe).

## 4. Defaults de Simples Nacional (decisão do usuário, MVP)

O Kyneti hoje só guarda um percentual de imposto estimado por `TaxProfile` — não o suficiente para montar um payload fiscal real (CST/CSOSN, CFOP, origem da mercadoria são códigos específicos, não um percentual). Em vez de expandir `TaxProfile` num modelo tributário completo (esforço grande, baixo retorno para o público-alvo do Kyneti), a decisão (28/07/2026, confirmada via pergunta direta ao usuário) foi: **defaults fixos de Simples Nacional**, aplicados a todo item, sem configuração por produto:

- ICMS: CST `102` (tributada pelo Simples Nacional sem permissão de crédito).
- PIS/COFINS: CST `07` para ambos (isenta).
- Origem da mercadoria: usa `Product.fiscalOriginCode` quando cadastrado (Fase 0), senão cai para `0` (nacional).
- CFOP: resolvido dinamicamente por `resolveCfop(ufEmitente, ufDestinatario)` — `5102` (venda dentro do estado) ou `6102` (venda interestadual), a única variação real de CFOP que depende do pedido, não do regime.

**Limitação conhecida e deliberada**: isto só é correto para lojistas efetivamente enquadrados no Simples Nacional. Um lojista em Lucro Presumido/Real emitiria uma nota fiscal com tributação incorreta. Não há validação automática do regime real do lojista contra esse default — é responsabilidade do usuário confirmar o enquadramento antes de habilitar a emissão em produção.

CFOP de devolução (5202/6202) e finalidades Complementar/Ajuste (seção 12) já são cobertos — a limitação de Simples Nacional acima permanece só para CST/CSOSN de ICMS-PIS-COFINS.

## 5. Gap conhecido: Order não tem nome/endereço do comprador

Nenhum provider de canal (Nuvemshop, Mercado Livre, Shopee) normaliza nome/endereço estruturado do comprador — `Order` só guarda `buyerTaxId` (CPF/CNPJ), adicionado na Fase 0. Isso significa que o Kyneti **não pode montar sozinho** o destinatário completo de uma NF-e a partir de um pedido.

Solução adotada (decisão do usuário: "deve ter botão manual E opção de automatizar"):

- **Emissão manual** (`POST /fiscal/invoices/orders/:orderId/emit`): quem chama informa `destinatario` (nome + endereço) no corpo da requisição; só `documento` cai para `Order.buyerTaxId` se não informado.
- **Auto-emissão** (`FiscalSettings.autoEmitOnApproval`, opt-in): o listener `OrderApprovedAutoEmitListener` escuta `ORDER_EVENTS.PAID` (a transição mais próxima de "pedido aprovado" no vocabulário desta base — mesmo evento que `ReceivableFromOrderListener` já consome). Hoje ele **nunca chama `emit` de fato** — só emite um alerta `WARNING` (`AlertService`) avisando que a emissão automática não é possível por falta de endereço estruturado, e direciona para o endpoint manual. Nenhum dado é inventado. No dia em que `Order` ganhar campos de endereço estruturado (item de roadmap futuro, fora do escopo desta fase), este listener passa a montar o destinatário de verdade e chamar `FiscalInvoiceService.emit` — sem precisar alterar o resto do fluxo.

## 6. Fluxo de emissão e resposta assíncrona

Focus NFe processa a emissão de forma assíncrona por padrão (`POST /v2/nfe?ref=REF` devolve 202 + `processando_autorizacao` na maioria dos casos). `FiscalInvoiceService` trata a resposta (própria ou de webhook) de forma unificada em `handleFocusResponse`:

- HTTP `>= 400` ou `body.status === 'erro_autorizacao'`/`'cancelado'` → `markError`.
- `body.status === 'autorizado'` → `markAuthorized` (número, série, chave de acesso, URLs de XML/DANFE).
- qualquer outro status (`processando_autorizacao`, desconhecido) → `markProcessing`, aguardando nova consulta ou webhook.

Dois caminhos alimentam essa máquina de estado: consulta manual (`POST /fiscal/invoices/:id/check-status` → `GET /v2/nfe/REF`) e o webhook da Focus NFe (`POST /fiscal/webhooks/focus-nfe`, sem guard — a Focus NFe não tem como enviar um JWT nosso, mesma justificativa do webhook de Orders). O webhook identifica a nota só pelo campo `ref`; `ref` ausente ou desconhecido é ignorado silenciosamente (não lança erro, para a Focus NFe não reenviar indefinidamente).

**Gap conhecido**: não existe um job de reconciliação/polling automático para notas presas em `PROCESSANDO` sem que o webhook chegue — hoje depende de consulta manual ou do webhook funcionar. Um poller periódico (mesmo padrão de `AdsAiOptimizationSchedulerJob`) é um incremento futuro natural.

## 7. Risco operacional: colisão de série com o Olist

O usuário confirmou que **hoje emite NF-e pela mesma empresa através do Olist/Tiny**. Se o Focus NFe for configurado com o mesmo CNPJ e a mesma série de NF-e já usada pelo Olist, ocorrerá colisão de numeração na SEFAZ (duas notas com o mesmo número/série, uma delas rejeitada ou pior, ambas aceitas indevidamente). `FiscalSettings.nfeSerie` existe exatamente para isto — o comentário no schema já registra a exigência ("DEVE ser diferente de qualquer série já usada pelo mesmo CNPJ em outro emissor"), mas **nada no Kyneti valida isso automaticamente** — é um passo manual que o usuário precisa fazer no painel da Focus NFe antes da primeira emissão real: cadastrar uma série nova, exclusiva do Kyneti.

## 8. Itens sem NCM nunca são emitidos com dado inventado

`FiscalInvoiceService.resolveItems` busca o NCM de cada item via `PRODUCT_CATALOG_READER` (campo `ncm`, Fase 0). Se qualquer item do pedido não tiver SKU resolvido ou não tiver NCM cadastrado no produto, a emissão inteira é rejeitada (`BadRequestException`, lista os SKUs faltantes) — nunca envia um NCM "chutado" ou genérico para a Focus NFe. Cabe ao usuário completar o cadastro fiscal do produto antes de emitir.

## 9. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/fiscal/settings` | Configuração fiscal do emitente (sem o token) |
| `PUT` | `/fiscal/settings` | Cria/atualiza a configuração (ADMIN) |
| `POST` | `/fiscal/invoices/orders/:orderId/emit` | Emite NF-e para um pedido (informa destinatário) |
| `GET` | `/fiscal/invoices` | Lista todas as notas do tenant (`?status=`) |
| `GET` | `/fiscal/invoices/orders/:orderId` | Lista as notas (tentativas) de um pedido |
| `GET` | `/fiscal/invoices/:id` | Detalhe de uma nota |
| `POST` | `/fiscal/invoices/:id/check-status` | Consulta o status atual na Focus NFe |
| `POST` | `/fiscal/invoices/:id/cancel` | Cancela uma nota autorizada (justificativa) |
| `POST` | `/fiscal/webhooks/focus-nfe` | Gatilho/webhook da Focus NFe (sem guard) |
| `GET` | `/fiscal/marketplace-intermediaries` | Lista as configs de Grupo G (Seção 11), por canal |
| `PUT` | `/fiscal/marketplace-intermediaries` | Cria/atualiza a config de um canal (ADMIN) |
| `DELETE` | `/fiscal/marketplace-intermediaries/:channelCode` | Remove a config de um canal (ADMIN) |

## 10. O que falta (MVP, gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- Sem job de reconciliação/polling automático (seção 6).
- Auto-emissão real depende de `Order` ganhar nome/endereço estruturado do comprador (seção 5) — hoje só alerta.
- Defaults de Simples Nacional não validam o regime tributário real do lojista (seção 4) — ICMS-ST tem o campo CEST no produto (Quick Win 2), mas continua sem cálculo de substituição tributária.
- Colisão de série com o Olist é um risco puramente operacional, não mitigado por código (seção 7).

## 11. Grupo G — Identificação do Intermediador da Transação (benchmark Bling, 29/07/2026)

Achado do benchmark Bling ERP (`docs/bling-erp-benchmark-analysis.md`, seção 1.4): toda venda emitida através de um marketplace (Mercado Livre, Shopee, Amazon, Magalu, TikTok Shop) precisa, pela NT 2020.006/Ajuste SINIEF 21-22/2020, informar o Grupo G da NF-e — `indIntermed` + `infIntermed.CNPJ` + `infIntermed.idCadIntTran`. Até esta correção, `nfe-payload-builder.ts` **nunca** enviava esse grupo — gap de compliance, não só de feature.

**Modelagem:** `FiscalMarketplaceIntermediary` (schema `fiscal`), uma linha por `(tenantId, channelCode)` — o CNPJ do intermediador é da PLATAFORMA (nunca do vendedor) e varia por canal, então não cabe como campo único em `FiscalSettings` (que é singleton por tenant). `idCadIntTran` é o identificador do PRÓPRIO vendedor cadastrado naquele marketplace (login/nickname), não um valor global do canal.

**Aviso de honestidade:** o Kyneti NÃO pré-preenche nenhum CNPJ de marketplace. CNPJs de intermediador circulam em bases públicas (ex.: Mercado Livre é comumente associado à EBAZAR.COM.BR LTDA, `03.007.331/0001-41`), mas nenhuma fonte oficial do próprio marketplace confirma isso como "o CNPJ certo para o campo intermediador" perante a SEFAZ — o tenant (ou seu contador) precisa configurar esse valor conscientemente via `PUT /fiscal/marketplace-intermediaries`, canal por canal. Ausência de config para um canal é um caso válido (ex.: Nuvemshop, loja própria — não um marketplace de terceiros no sentido da NT): `FiscalInvoiceService.emit` simplesmente envia `indicador_intermediario: 0`.

**Payload (nomes de campo conforme a API da Focus NFe):** `indicador_intermediario` (sempre explícito, 0 ou 1), `cnpj_intermediario` e `id_intermediario` (só presentes quando `indicador_intermediario = 1`).

## 12. Finalidade da emissão + CFOP de devolução (Quick Win 7, benchmark Bling, 29/07/2026)

Até esta correção, `finalidade_emissao` era hardcoded em `1` (Normal) e `resolveCfop` só resolvia venda normal (5102/6102) — o Kyneti não conseguia emitir uma NF-e de devolução, complementar ou de ajuste.

**Modelagem:** `NfeFinalidade` (`domain/tax-code-resolver.ts`) — union `'NORMAL' | 'COMPLEMENTAR' | 'AJUSTE' | 'DEVOLUCAO'`, mapeada para os códigos SEFAZ/Focus NFe (`resolveNfeFinalidadeCode`: 1/2/3/4). `resolveCfop` ganhou um 3º parâmetro opcional (`finalidade`, default `'NORMAL'`) — só a devolução muda o CFOP (5202/6202); Complementar/Ajuste mantêm o CFOP de venda normal, pois a nota referencia a operação original sem desfazê-la.

**Aviso de honestidade:** os 4 valores de `finalidade_emissao` (1/2/3/4) foram confirmados na documentação oficial da Focus NFe (`doc.focusnfe.com.br/reference/emitir_nfe`). O benchmark Bling citava 6 valores (incluindo Crédito/Débito) — esses dois **não existem** no schema da Focus NFe e foram deliberadamente excluídos. Já o nome do campo `notas_referenciadas` (usado para o array de `documentoReferenciado`) **não foi confirmado** contra a referência de campos completa da Focus NFe (página grande demais para buscar no sandbox) — foi implementado com base em fontes secundárias (documentação da TagPlus, que também integra com Focus NFe). Revisar contra a documentação primária antes de emitir em produção qualquer finalidade diferente de Normal.

**Validação:** `isValidReferencedDocuments` exige ao menos uma chave de acesso (44 dígitos) sempre que `finalidade !== 'NORMAL'` — `FiscalInvoiceService.emit` rejeita com `BadRequestException` antes de chamar a Focus NFe se a validação falhar.

**Endpoint:** `POST /fiscal/invoices/orders/:orderId/emit` — `EmitInvoiceDto` ganhou `finalidade?` (default Normal, omitido) e `documentoReferenciado?: string[]` (chaves de 44 dígitos da NF-e de origem).

**Consumidores verificados:** `OrderApprovedAutoEmitListener` (auto-emissão) hoje nunca chama `emit` de fato — só emite alerta (seção 5), então não precisou de alteração. Nenhum outro consumidor de `FiscalInvoiceService.emit` existe além do controller.
