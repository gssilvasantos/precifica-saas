# Módulo de Separação e Expedição — Pick & Pack (Sprint 27)

## 0. O pedido e as quatro premissas de negócio

O usuário pediu um sistema "juiz": a tela de conferência mostra o checklist de itens (com fotos) e o botão "Finalizar Embalagem" fica bloqueado até 100% dos itens serem bipados. Em paralelo, cada conferência precisa ser gravada em vídeo e vinculada automaticamente ao pedido, com retenção de 30 dias e resiliência a falhas de rede/travamento no meio da gravação. A escolha de arquitetura de captura (MediaDevices API, RTSP, ou servidor intermediário) e de armazenamento ficou a critério técnico — as decisões e a justificativa estão abaixo.

Decisão estrutural: **não foi criado um módulo novo**. Todo o Pick & Pack estende o `logistics-fulfillment` (o "Hub de Provas" da Sprint 24) — checklist e vídeo penduram em `StockMovementAuditEvent`, a mesma entidade que já carregava `mediaUrl`/`mediaType` e o gate de duas fases (`canApprove`). Criar um módulo separado significaria duplicar o conceito de "evento de auditoria de movimentação" só para hospedar dois campos a mais; a base já tinha o lugar certo.

## 1. Modelo de dados

Duas tabelas novas no schema `logistics_fulfillment` já existente (nenhum schema novo):

- **`StockMovementAuditEventItem`** — uma linha por SKU do checklist (`expectedQuantity`, `scannedQuantity`, único por `(auditEventId, skuCode)`). Montado uma única vez, no momento em que o evento de auditoria é criado (`createPending`), agregando os itens dos pedidos vinculados por SKU (`buildChecklistFromOrderItems`) — é um snapshot, nunca recalculado depois (mesmo padrão de `OrderItem.costPriceUsed`).
- **`VideoCaptureSession`** — 1:1 com o evento de auditoria. Guarda `storageKey` (caminho do arquivo), `status` (`RECORDING` | `FINALIZED`), `receivedChunkCount`/`totalBytes` (para idempotência e observabilidade) e `videoDeletedAt` (marcador de retenção — nunca a linha inteira é apagada, só o arquivo físico).

Itens de pedido sem `skuCode` resolvido (produto não casado com o catálogo) ficam **fora** do checklist — gap conhecido, documentado explicitamente com um `logger.warn` no momento da criação do evento (nunca descartado em silêncio). Se todos os itens de um pedido caírem nesse caso, o checklist fica vazio; ver seção 5 sobre como isso interage com o gate.

## 2. Estratégia de captura de vídeo — por que MediaDevices API, não RTSP

Três opções foram avaliadas:

1. **RTSP / câmera IP dedicada + servidor de mídia** (ex.: um NVR, ou um serviço tipo MediaSoup/Kurento recebendo streaming contínuo). Adequado para monitoramento ao vivo 24/7 de um ambiente fixo. Rejeitado aqui porque a necessidade não é "vigilância contínua da doca" — é uma gravação pontual, de alguns minutos, amarrada à sessão de trabalho de um operador específico em um pedido específico. Usar RTSP forçaria: câmeras IP dedicadas por bancada (custo de hardware), um servidor de mídia rodando 24/7 (custo operacional e superfície de falha extra), e ainda assim precisaríamos de lógica própria para "cortar" o trecho relevante da gravação contínua e associá-lo ao evento certo — a mesma amarração que o MediaDevices já dá de graça, por construção.
2. **Servidor intermediário fazendo proxy do stream** (o navegador manda tudo pra um servidor de sinalização/relay antes de gravar). Adiciona um salto de rede e um componente a mais para operar e escalar, sem ganho: não há múltiplos espectadores nem necessidade de distribuição — é um produtor (o operador) e um consumidor (o disco), então um proxy no meio só adiciona latência e mais um ponto de falha.
3. **MediaDevices API (`getUserMedia`) + `MediaRecorder` no navegador, com upload incremental em chunks** — escolhida. O navegador do operador já é o ponto de captura (câmera do notebook/tablet da bancada de conferência); `MediaRecorder` grava localmente e entrega blobs incrementais via `timeslice`; cada blob sobe para a API assim que fica pronto. Nenhum servidor de mídia dedicado, nenhum protocolo de streaming novo para operar — só HTTP, que a API já fala.

Trade-off aceito conscientemente: isto é gravação **por sessão de conferência**, não vigilância contínua da área. Se o requisito mudar no futuro para "gravar a doca inteira o tempo todo, não só durante conferências", aí sim a resposta certa vira RTSP + NVR — mas não é o que foi pedido, e construir para esse caso agora seria complexidade paga sem uso.

## 3. Protocolo de chunking e idempotência

`MediaRecorder.start(timeslice)` (3000ms no frontend) dispara `ondataavailable` periodicamente, cada blob sendo enviado para `POST /logistics-fulfillment/audit-events/:id/video-sessions/:sessionId/chunks` com um número de sequência (`0, 1, 2, ...`) controlado pelo cliente.

O servidor (`VideoCaptureService.appendChunk` + `canAcceptChunk` no domínio) decide **antes de tocar disco**:

- `sequence < receivedChunkCount` → chunk já recebido antes (retransmissão por rede instável) — aceita sem reescrever, devolve a sessão como está.
- `sequence === receivedChunkCount` → esperado — grava (`VideoChunkStorage.appendChunk`, sempre um `fs.appendFile`, nunca reescreve do zero) e incrementa o contador.
- `sequence > receivedChunkCount` → lacuna (um chunk se perdeu no meio) — rejeitado com erro explícito, para o cliente saber que precisa reenviar em ordem.
- Sessão já `FINALIZED` → rejeita qualquer chunk novo.

Esse protocolo não depende de nenhum estado do lado do cliente além de "qual o próximo número esperado" — o servidor é a fonte de verdade.

## 4. Por que uma porta nova (`VideoChunkStorage`), não reaproveitar `FileStorage`

`FileStorage.upload(key, content: Buffer)` (a porta que a mídia estática — fotos — já usa) assume o conteúdo inteiro em memória de uma vez. Vídeo de conferência pode ter dezenas de MB, produzido ao longo de minutos; bufferizar tudo antes de escrever jogaria fora exatamente a resiliência pedida (perder o processo no meio da gravação perderia o vídeo inteiro, não só o pedaço final). Por isso `VideoChunkStorage` é uma porta deliberadamente separada, com semântica de append (`createSession` cria o arquivo vazio, `appendChunk` sempre adiciona, nunca reescreve).

Implementação atual (`LocalVideoChunkStorageService`) grava em disco local, reaproveitando a **mesma raiz** (`ERP_STORAGE_ROOT`) e o **mesmo** `ServeStaticModule` já registrado para fotos — nenhuma rota estática nova precisou ser cadastrada. Trocável por um adapter S3/R2 com multipart upload nativo quando o deploy precisar de múltiplas instâncias sem disco compartilhado, sem que nenhum consumidor (o `VideoCaptureService`) precise mudar.

## 5. Resiliência

- Cada chunk é gravado no disco assim que chega — nunca existe um buffer completo do vídeo em memória do servidor.
- Se o navegador travar ou a rede cair no meio, os chunks já enviados estão persistidos; só o pedaço em trânsito no momento da falha se perde (não a gravação inteira).
- Retransmissão de um chunk já recebido é idempotente (seção 3) — o cliente pode reenviar sem medo de duplicar.
- `finalize()` só é aceito se pelo menos um chunk foi recebido (`canFinalize`) — não é possível "fechar" uma sessão vazia.
- O `finalize()` reaproveita o **mesmo** `attachMedia()` que o Hub de Provas já usa para fotos (Sprint 24) — grava `mediaUrl`/`mediaType='VIDEO'` no evento de auditoria. Consequência arquitetural relevante: `canApprove` (o gate que decide se a aprovação pode acontecer) não precisou de nenhuma lógica nova para saber que "tem mídia" — o campo é o mesmo, seja foto ou vídeo.

## 6. Gerenciamento de retenção (30 dias)

`VIDEO_RETENTION_DAYS = 30`. Estratégia: **rotina de limpeza em background** (`VideoRetentionCleanupJob`, `@Cron` diário às 3h, mesmo padrão de `OrdersSyncSchedulerJob`), não uma Lifecycle Policy de serviço de nuvem — porque o storage de disco local não tem esse recurso nativo. `runRetentionCleanup`:

1. Busca no banco as sessões `FINALIZED`, ainda não apagadas, finalizadas antes do corte (`findExpiredForCleanup`).
2. Para cada uma, **reconfere** `isExpiredForRetention` no domínio antes de agir — defesa em profundidade (mesmo racional do piso redundante do `PricingDecisionService`): mesmo que a query já tenha filtrado, o cálculo de expiração não confia cegamente na query.
3. Apaga só o **arquivo físico** (`VideoChunkStorage.delete`, idempotente — nunca lança se o arquivo já não existir) e marca `videoDeletedAt`. A **linha** de `VideoCaptureSession` nunca é apagada — é o registro permanente de que a conferência visual aconteceu, mesmo depois que os bytes pesados já foram descartados.
4. Uma falha ao apagar um arquivo específico (disco indisponível, etc.) não impede os demais de serem processados, e não marca `videoDeletedAt` — a sessão continua aparecendo como candidata na próxima execução do job.

**Nota de produção:** se o deploy migrar para S3/R2, a recomendação é trocar esta rotina por uma **Lifecycle Policy nativa do bucket** (expiração automática por prefixo/idade), que não consome ciclo de CPU do servidor de aplicação — documentado aqui para quando essa migração acontecer, mas não implementado agora porque o storage atual é disco local.

## 7. Fluxo completo (frontend → backend)

1. Operador abre `/conferencia` (fila de eventos `PENDENTE`, FIFO — `GET /logistics-fulfillment/audit-events/pending`) e escolhe um item.
2. Tela `/conferencia/:eventId` carrega o checklist (`GET .../:id/checklist`) e mostra cada SKU com a foto do produto (cruzada com o catálogo pelo frontend).
3. Operador bipa cada item (`POST .../:id/scan`, sempre +1, nunca aceita quantidade absoluta) — o checklist é revalidado a cada bipagem.
4. Em paralelo, operador liga a câmera (`getUserMedia`) e inicia a gravação — `POST .../:id/video-sessions` cria a sessão (idempotente: reabrir a tela não cria uma segunda), chunks sobem incrementalmente (seção 3).
5. Quando 100% dos itens estão bipados **e** o vídeo foi finalizado (`POST .../:id/video-sessions/:sessionId/finalize`), o botão "Finalizar Embalagem" libera no frontend.
6. `POST .../:id/approve` — o backend reconfere tudo (`canApprove`: mídia presente + checklist 100% bipado) antes de gravar qualquer linha de `StockLedgerEntry`. O frontend nunca é a autoridade — só um espelho de UX do mesmo gate.

## 8. Gaps conhecidos (honestidade)

- Itens de pedido sem `skuCode` resolvido ficam fora do checklist (seção 1). Se **todos** os itens de um pedido caírem nesse caso, o checklist fica vazio e — por preservar o comportamento legado de `FULL_DISPATCH` de reabastecimento preventivo (que nunca teve pedido nenhum atrás) — seria vacuamente aprovado só com mídia. Mitigado hoje só pelo `logger.warn`; um guard mais rígido (ex.: bloquear aprovação de `RETAIL_SHIPMENT` com checklist vazio quando existiam `orderIds`) não foi implementado nesta sprint.
- A tela de conferência não cobre o fluxo de `FULL_DISPATCH` manual (lote de reabastecimento sem pedido, cujo checklist é intencionalmente vazio) — esse caminho continua exigindo interação direta com a API (`approve` com uma linha manual de SKU/quantidade), sem UI dedicada.
- Sem paginação na fila de pendentes (`getPendingQueue`) — aceitável hoje porque o volume de eventos `PENDENTE` simultâneos é naturalmente pequeno (só existem enquanto ninguém confere o despacho), mas não escala indefinidamente.
- Retenção via `@Cron` local, não Lifecycle Policy de nuvem (seção 6) — decisão correta para o storage atual (disco), mas precisa ser revisitada na migração para S3/R2.

## 9. Testes

`domain/stock-movement-audit-event.spec.ts` (checklist: `buildChecklistFromOrderItems`, `isFullyScanned`, `canScanItem`, `canApprove` com checklist) e `domain/video-capture.spec.ts` (`canAcceptChunk`, `canFinalize`, `isExpiredForRetention`) cobrem as regras puras. `application/stock-movement-audit-event.service.spec.ts` e `application/video-capture.service.spec.ts` cobrem a orquestração (incluindo os cenários de idempotência de chunk, falha parcial na limpeza de retenção, e o regression test explícito do checklist vazio preservando o comportamento legado da Sprint 24). Suíte completa do módulo (`npx jest logistics-fulfillment`) e dos módulos consumidos/consumidores (`financial-intelligence`, `orders`, `promotion-intelligence`, `catalog`) verificada em conjunto — 28 suítes / 227 testes, todos passando, sem regressão. Frontend (`npx tsc --noEmit`) limpo.

## 10. Validação em produção — E2E e análise de carga (pós-Sprint 27)

Fase adicional pedida pelo usuário, "um por um": (1) script de teste de integração ponta a ponta, (2) UI de conferência com feedback visual/sonoro, (3) análise de gargalo sob carga de 20 pedidos simultâneos.

### 10.1 Suíte E2E (`apps/api/test/`)

`pick-pack.e2e-spec.ts` sobe um `TestingModule` real do NestJS (guards, `ValidationPipe`, controllers e application services genuínos) trocando só a persistência por fakes em memória com estado real (`test/fakes/pick-pack-fakes.ts`) — Postgres real segue bloqueado neste ambiente de desenvolvimento (sem acesso ao binário do engine do Prisma). Cobre o fluxo completo criação → checklist → bipagem 100% → vídeo em chunks → finalize → aprovação, com verificação byte-a-byte da persistência do vídeo no storage fake, e um segundo teste confirmando que o `RolesGuard` real (não sobrescrito) bloqueia um papel sem permissão.

### 10.2 UI de conferência: gravação automática + feedback

`ConferenciaDetalhePage.tsx` ganhou: início automático da gravação no primeiro item bipado (`useEffect` reagindo ao estado real do checklist, nunca ao clique manual); feedback sonoro via Web Audio API nativa (`lib/audio-feedback.ts` — bipe de sucesso, tom de erro, arpejo de checklist 100%, sem nenhum arquivo de áudio externo); feedback visual (barra de progresso, flash na linha bipada, indicador "Gravando" pulsante, banner de conclusão); e correção de uma divergência real entre o gate de UX e o gate do backend — `checklistComplete` exigia `length > 0`, enquanto `isFullyScanned` no domínio trata lista vazia como vacuamente aprovada (reabastecimento preventivo). Ambos batem 1:1 agora.

### 10.3 Análise de carga — 20 pedidos simultâneos

`apps/api/test/pick-pack-load.e2e-spec.ts` simula 20 fluxos completos em paralelo (`Promise.all`) contra o mesmo backend compartilhado (mesmos fakes, mesma instância de app — o mais próximo de "20 operadores batendo no mesmo servidor" que este ambiente permite simular sem Postgres real). Resultado: 20 eventos únicos, todos `APROVADO`, 80 linhas de ledger (20 × 2 SKUs × 2 linhas de débito/crédito), zero vazamento de estado entre pedidos concorrentes. **Aviso de honestidade**: os tempos medidos (~1s de parede para 20 fluxos × ~13 requisições cada) são os de um `Map` em memória, não os de Postgres/disco reais — não são usados aqui como prova de performance, só de corretude de orquestração sob concorrência.

A análise de gargalo real vem da leitura direta do código de infraestrutura, não do teste acima:

- **Incrementos são atômicos no banco** (`{ increment: 1 }` do Prisma, nunca lê-modifica-escreve em código de aplicação) tanto em `PrismaVideoCaptureSessionRepository.recordChunkReceived` quanto em `incrementScanned` do checklist — não é fonte de corrupção sob concorrência.
- **Um único `PrismaClient` (uma única pool de conexões) compartilhado por todo o processo** (`PrismaModule` é `@Global()`), sem `connection_limit`/`pool_timeout` configurado no `DATABASE_URL` — a pool usa o tamanho default do Prisma (`num_cpus * 2 + 1`). Sob 20 operadores gravando simultaneamente (chunk a cada 3s) mais o resto do tráfego normal da plataforma disputando a mesma pool, isto é o primeiro candidato a ajuste se latência de escrita virar problema em produção — recomendação: definir `connection_limit` explícito no `DATABASE_URL` calibrado para o hardware do banco.
- **Storage de vídeo é disco local, single-node**, via `fs.promises.appendFile` (não bloqueia o event loop, mas usa o threadpool do libuv — default 4 threads, compartilhado por TODA operação de arquivo do processo, incluindo fotos do ERP e o `ServeStaticModule` servindo da mesma raiz). Não há mutex de aplicação nem lock distribuído — o design já assume single-instância (documentado desde a seção 4). Se o deploy for multi-instância, a migração para S3/R2 (já prevista) resolve isso.
- **Chunks trafegam como base64 dentro do corpo JSON**, com limite global de 15mb no body-parser — cada chunk paga ~33% de inflação e é totalmente bufferizado/decodificado em memória antes de chegar no storage; aceitável para o timeslice de 3s atual, mas um ponto a rever se o timeslice ou a resolução de vídeo aumentarem no futuro.
- **Nenhuma fila de background (Bull/BullMQ)** — tudo roda de forma síncrona dentro do ciclo de vida da requisição HTTP, em um único processo Node (sem cluster/worker_threads). Não é um problema pelo volume atual (20 operadores, chunks pequenos), mas é o teto de escala natural antes de precisar de múltiplas instâncias.

### 10.4 Achado crítico e correção: lacuna de sequência sob falha de rede

A pergunta do usuário ("processamento de vídeo em 20 máquinas pode causar lentidão ou queda na rede?") revelou o risco mais sério real: Web Audio e `MediaRecorder` rodam localmente em CADA máquina do operador, de forma independente — **não há concorrência de CPU entre os 20 navegadores**, isso é "embaraçosamente paralelo" por construção (20 máquinas, 20 CPUs distintas). O risco genuíno é de REDE, não de processamento: sem restrição de resolução/bitrate, `getUserMedia({video:true})` deixava o navegador escolher a resolução "ideal" da câmera (facilmente 1080p+), e 20 gravações concorrentes na mesma rede da doca poderiam somar dezenas de Mbps de upload — o suficiente para saturar um uplink comercial típico.

Pior: um teste dedicado (`pick-pack-load.e2e-spec.ts`, segundo `describe`) confirmou empiricamente que uma falha de rede em UM chunk **corrompe silenciosamente o resto da gravação**: o contador de sequência do navegador (`sequenceRef.current`) avançava antes de saber se o upload tinha sucesso, então todo chunk seguinte era rejeitado pelo servidor como "fora de ordem" (`canAcceptChunk`) — e como `canFinalize` só exige "pelo menos 1 chunk recebido" (não "todos os chunks", conceito que nem existe num stream ao vivo), a sessão finalizava com sucesso mesmo truncada no primeiro chunk perdido, sem nenhum sinal de erro para o backend detectar.

Correções aplicadas em `ConferenciaDetalhePage.tsx`:

1. **Resolução/bitrate contidos** (`640×480`, `videoBitsPerSecond: 500_000`) — vídeo de auditoria, não cinema; reduz a banda exigida por operador em ~5x frente ao default do navegador.
2. **Retry com backoff** (`lib/retry.ts`, 3 tentativas) antes de desistir de um chunk — cobre a maioria das falhas transitórias de rede antes que a lacuna aconteça.
3. **Hard-stop + bloqueio de "Finalizar Embalagem"** se o retry se esgotar (`videoSessionCorrupted`) — nunca mais permite que uma gravação truncada passe silenciosamente pelo gate; o operador é direcionado para "Reportar divergência", o mecanismo que já existe para exceção operacional.
