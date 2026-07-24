# Deploy da versão Demo — Render + Supabase + Cloudflare R2

Este documento cobre a subida da primeira versão real (Demo) do Kyneti para infraestrutura gerenciada. Segue a mesma disciplina de honestidade do resto do projeto: nada aqui foi executado a partir deste ambiente de desenvolvimento — os comandos de Prisma/Supabase precisam rodar de uma máquina (ou pipeline de build do Render) com rede real liberada, porque o acesso ao binário do engine do Prisma está bloqueado neste sandbox (confirmado repetidamente ao longo do projeto).

Escopo deste documento, em 4 passos (pedido do usuário). **Passos 1, 2, 3 e 4 concluídos.**

1. Plano de migração de infraestrutura
2. Prisma ↔ Supabase — passo a passo da primeira migration real
3. Adapters de storage (local vs. R2) — código pronto, ver seção 3
4. Variáveis de ambiente do Render — ver seção 4

---

## 1. Plano de migração de infraestrutura

### 1.1 Topologia alvo

| Peça | Hoje (dev) | Depois (Demo) |
|---|---|---|
| Compute (API NestJS) | `npm run start:dev` local | Render Web Service (Node) |
| Banco | Postgres via `docker-compose` local | Supabase Postgres gerenciado |
| Storage de arquivo (fotos/vídeo) | Disco local (`storage/uploads`, servido via `ServeStaticModule`) | Cloudflare R2 (S3-compatible) |
| Frontend | Vite dev server | Render Static Site (ou Vercel/Netlify — fora do escopo deste doc) |

### 1.2 Ordem de execução recomendada (não paralelizar)

1. **Provisionar o projeto Supabase** e capturar as duas connection strings (pooled + direta — seção 2.1). Nenhum outro passo depende de nada além disso.
2. **Consolidar e validar o histórico de migrations do Prisma** contra esse banco (seção 2) — isto precisa acontecer *antes* de qualquer deploy no Render, porque é o primeiro contato real do schema com um Postgres de verdade em toda a vida do projeto.
3. Rodar o seed de demonstração (`seed-demo.ts`) — a versão que vai subir é a Demo, então os 10 pedidos fixos do Audit Mode precisam existir no banco desde o primeiro dia.
4. Só então criar o Web Service no Render, apontando para este repositório, com as variáveis de ambiente (passo 4, próxima etapa) apontando para o Supabase já migrado.
5. Reescrever os adapters de storage para R2 (passo 3, próxima etapa) **antes** do primeiro upload real de foto/vídeo em produção — o filesystem do Render é efêmero (não sobrevive a redeploy/restart), então o `LocalFileStorageService`/`LocalVideoChunkStorageService` atuais quebrariam silenciosamente em produção (arquivo "salvo" seria perdido no próximo deploy).

### 1.3 Por que essa ordem importa

- O Supabase precisa existir primeiro porque a validação da migration (passo 2) é o evento mais crítico de todo o plano: é a **primeira vez em 27 sprints** que o schema Prisma (28 models, 17 enums, 8 schemas Postgres) é verificado contra um engine/banco reais, em vez de só contra os testes com fakes. Achar um problema aqui em um banco descartável de staging é seguro; achar o mesmo problema depois do Render já estar servindo tráfego, não.
- O storage em R2 é bloqueante para produção, mas não bloqueia a migration do banco — por isso pode vir depois, desde que nenhum upload real aconteça antes dele estar pronto.

### 1.4 Achado crítico (bloqueia o passo 2 se ignorado)

Ao inspecionar `prisma/migrations/` para montar o passo a passo abaixo, encontrei uma lacuna real que precisa ser corrigida antes de aplicar qualquer migration no Supabase — detalhada na seção 2.3. Resumo: **o histórico de migrations atual está incompleto** (falta a criação de várias tabelas centrais — `Order`, `Warehouse`, `StockMovementAuditEvent`, `FixedExpense`, `ReceivableRecord`, `Packaging`, entre outras). Aplicá-lo como está contra um banco vazio provavelmente falha no meio do caminho, com erro de "relation does not exist" na primeira migration que referenciar uma dessas tabelas via chave estrangeira.

---

## 2. Prisma ↔ Supabase — passo a passo da primeira migration real

### 2.0 Pré-requisito

Rode os comandos abaixo a partir da sua máquina local (ou de um step de build do Render com rede liberada) — **nunca a partir deste ambiente de Cowork**, que não tem acesso à rede do Prisma nem ao Supabase.

### 2.1 Obter as connection strings do Supabase

No painel do Supabase: **Project Settings → Database → Connection string**. O Supabase expõe duas formas de conexão — usar a errada no lugar errado é o erro mais comum nesta etapa:

| Uso | String | Porta | Por quê |
|---|---|---|---|
| Runtime da aplicação (`DATABASE_URL`) | **Connection pooling** (modo *Transaction*, via PgBouncer) | 6543 | O app abre/fecha conexões a cada requisição; sem pooler, um único deploy do Render pode saturar o limite de conexões diretas do Supabase (mesmo risco já sinalizado no inventário de governança: nenhum `connection_limit` configurado hoje). |
| Migrations (`DIRECT_URL`) | **Connection string direta** | 5432 | `prisma migrate` precisa de recursos de sessão (advisory locks, `CREATE SCHEMA`, DDL transacional) que o PgBouncer em modo *Transaction* não suporta corretamente. |

### 2.2 Atualizar `prisma/schema.prisma`

Adicionar `directUrl` ao datasource (hoje só tem `url`):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["identity", "catalog", "logistics_intelligence", "marketplace_intelligence",
               "integration_ops", "erp_integration", "channel_integration",
               "competition_intelligence", "financial_intelligence", "orders",
               "logistics_fulfillment", "promotion_intelligence"]
}
```

E no `.env` (local, nunca commitado):

```
DATABASE_URL="postgresql://postgres.[ref]:[senha]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[senha]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

(Os valores exatos de `[ref]`/`[senha]`/`[region]` vêm do painel do Supabase — nunca reutilizar a senha do Postgres local de dev.)

### 2.3 Corrigir o histórico de migrations antes de aplicar (achado crítico)

Inspecionei os 7 arquivos em `prisma/migrations/` para preparar este passo a passo e encontrei o seguinte:

- A primeira migration (`20260711111209_pricing_decision`) contém, na prática, uma baseline razoavelmente completa: 8 `CREATE SCHEMA` + 20 `CREATE TABLE` (Tenant, User, Product, CatalogSettings, MarketplaceRule, ProviderSyncLog, NuvemshopConnection, ChannelListing, CompetitiveOpportunity, etc.).
- As 6 migrations seguintes adicionam `ALTER TABLE` (colunas novas em `Product`/`Order`) e `CREATE TABLE` só para: `MercadoLivreConnection`, `PromotionCampaign`, `PromotionEnrollment`, `StockMovementAuditEventItem`, `VideoCaptureSession`.
- **Nenhuma migration cria**: `Order`, `OrderItem`, `Warehouse`, `StockMovementAuditEvent`, `StockMovementAuditEventOrder`, `StockLedgerEntry`, `FixedExpense`, `ReceivableRecord`, `Packaging`, `PackagingUsageEvent` — todas presentes em `schema.prisma` (28 models no total), mas sem `CREATE TABLE` correspondente em nenhum arquivo `.sql` do histórico.

Isso confirma, de forma concreta, o que o inventário de governança já sinalizava de forma geral ("nenhuma migration validada contra Postgres real"): aqui está o efeito prático disso — o histórico de migrations, se aplicado como está contra um banco vazio, provavelmente falha (por exemplo, `video_capture_sessions` deve ter uma FK para `stock_movement_audit_events`, que nunca foi criada).

**Recomendação** (o Supabase é um projeto novo e vazio — não há dado real para preservar, então o caminho mais seguro é resetar o histórico em vez de tentar remendar 7 arquivos manualmente):

```bash
# 1. Arquivar o histórico hand-written (nunca validado) — não apagar, só tirar do caminho
mv prisma/migrations prisma/migrations.hand-written.bak

# 2. Gerar UMA migration nova, completa, a partir do schema.prisma atual — isto conecta
#    de fato no Supabase (via DIRECT_URL), roda o parser/engine real do Prisma, e cria
#    todas as 28 tabelas + 17 enums + 8 schemas numa única migration verificada.
npx prisma migrate dev --name baseline_completo
```

Esse comando único resolve, na mesma execução, o outro gap crônico documentado desde as primeiras sprints: o Prisma Client gerado localmente neste projeto nunca foi regenerado contra o schema real (ficou preso nos models originais). Rodar `migrate dev` de verdade gera o client certo, com todos os 28 models tipados.

### 2.4 Aplicar e verificar

```bash
# Depois da migration inicial (2.3), toda aplicação subsequente do MESMO histórico
# (outro ambiente, ou o próprio Render em cada deploy) usa migrate deploy, nunca
# migrate dev — deploy só aplica migrations existentes, sem gerar nada novo nem
# pedir confirmação interativa.
npx prisma migrate deploy

# Confirma visualmente que as tabelas existem nos 8 schemas
npx prisma studio
```

### 2.5 Popular os dados de demonstração

Já que o objetivo desta subida é a **versão Demo**, rodar o seed fixo do Audit Mode logo depois da migration, antes de qualquer acesso externo ao ambiente:

```bash
npx ts-node prisma/seed-demo.ts
# ou, se preferir via script do package.json:
npm run prisma:seed:demo
```

Isso popula os 10 pedidos fixos (`DEMO-AUDIT-001..010`) usados pelo `AppModeProvider`/toggle de Demo no frontend — sem isso, a versão Demo sobe com o banco vazio.

### 2.6 Checklist de saída deste passo

- [ ] Projeto Supabase criado, `DATABASE_URL` (pooled) e `DIRECT_URL` (direta) capturados.
- [ ] `schema.prisma` com `directUrl` adicionado.
- [ ] Histórico de migrations antigo arquivado (`prisma/migrations.hand-written.bak`).
- [ ] `npx prisma migrate dev --name baseline_completo` executado com sucesso contra o Supabase, a partir de um ambiente com rede real.
- [ ] `npx prisma studio` confirma as 28 tabelas nos 8 schemas.
- [ ] Prisma Client regenerado (resolve o gap histórico de client desatualizado).
- [ ] Seed de demo rodado (`seed-demo.ts`).

Com isso, o banco está pronto para o Render se conectar (passo 4, próxima etapa).

---

## 3. Adapters de storage — local (dev) vs. Cloudflare R2 (produção)

### 3.1 Como o R2 se integra (S3-compatible)

Cloudflare R2 expõe a mesma API do S3, então usamos `@aws-sdk/client-s3` (dependência nova, adicionada a `apps/api/package.json`) apontando para o endpoint do R2 em vez do endpoint da AWS. Duas URLs distintas do R2 nunca devem ser confundidas:

| Variável | O que é | Uso |
|---|---|---|
| `R2_ENDPOINT` | API S3 autenticada da conta (`https://<account_id>.r2.cloudflarestorage.com`) | Usada pelo SDK para `PutObject`/multipart upload — nunca serve GET público. |
| `R2_PUBLIC_BASE_URL` | Domínio público de LEITURA do bucket — "Public Development URL" (`https://pub-xxxx.r2.dev`) ou domínio custom vinculado no painel R2 | Usada para montar a URL final salva no banco (`mediaUrl`, foto de produto). |

A escolha entre disco local e R2 é decidida em runtime por `resolveStorageDriver()` (`shared/config/storage-environment.ts`): `STORAGE_DRIVER` explícito (`local`/`r2`) tem prioridade; na ausência dele, cai para `NODE_ENV` (`production` → `r2`). Os dois módulos que consomem storage (`ErpIntegrationModule` para fotos, `LogisticsFulfillmentModule` para vídeo) trocam `useClass` fixo por `useFactory`, escolhendo o adapter certo sem nenhum consumidor (`ProductPhotoMirrorService`, `VideoCaptureService`) precisar mudar — mesmo princípio de porta/adapter usado no resto do projeto.

### 3.2 Código

- `shared/config/storage-environment.ts` — `resolveStorageDriver()`.
- `shared/infrastructure/storage/r2-env.ts` + `r2-client.factory.ts` — leitura de env var obrigatória + `S3Client` único reaproveitado por todos os adapters.
- `modules/erp-integration/infrastructure/storage/r2-file-storage.service.ts` — implementa `FileStorage` (fotos de produto) via `PutObjectCommand` simples (conteúdo já vem inteiro em memória).
- `modules/logistics-fulfillment/infrastructure/r2-video-chunk-storage.service.ts` — implementa `VideoChunkStorage` (vídeo de conferência) via **Multipart Upload** do S3.

### 3.3 Achado técnico: por que o vídeo precisou de Multipart Upload (não um PutObject simples)

O S3 (e o R2, que implementa a mesma API) exige que toda Part de um multipart upload tenha **no mínimo 5 MiB**, exceto a última. O `MediaRecorder` do navegador manda chunks bem menores que isso — na casa de KBs a poucas centenas de KB, ainda mais depois do `videoBitsPerSecond` já ter sido limitado a 500 kbps na análise de carga (Item 3). Um `PutObjectCommand` por chunk também não serviria: cada chamada reescreveria o objeto inteiro do zero, perdendo exatamente a resiliência pedida (sobreviver a um chunk perdido no meio da gravação).

A solução implementada: `R2VideoChunkStorageService` **bufferiza os chunks em memória por sessão** até acumular >= 5 MiB, e só então sobe uma Part de verdade (`UploadPartCommand`). `appendChunk` nunca bloqueia esperando o buffer encher — grava em memória e retorna na hora; o upload real acontece de forma amortizada. No `finalize()` da sessão, o que sobrar no buffer (mesmo abaixo de 5 MiB) vira a Part final, e um `CompleteMultipartUploadCommand` fecha o objeto.

Isso exigiu um ajuste pequeno, porém real, na porta `VideoChunkStorage` (`application/ports/video-chunk-storage.port.ts`): adicionei `finalizeSession(key): Promise<string>`, chamado por `VideoCaptureService.finalize()` no lugar do antigo `getPublicUrl()` síncrono. Motivo: no adapter R2, o objeto só existe de fato no bucket depois do `CompleteMultipartUploadCommand` — um método síncrono não tem como esperar essa chamada assíncrona. O adapter local (`LocalVideoChunkStorageService.finalizeSession`) é um no-op que só delega para `getPublicUrl`, já que cada `appendChunk` local já commita o byte na hora (sem alterar o comportamento em dev).

**Risco assumido, documentado no código** (`r2-video-chunk-storage.service.ts`): o estado do multipart upload (uploadId, Parts já commitadas, buffer pendente) vive em memória do processo Node — mesma categoria de risco de instância única já sinalizada no inventário de governança pós-Sprint 27 (cache do `FinancialPolicyReaderService`, rate limiter por marketplace). Se o processo cair no meio de uma gravação, a sessão fica órfã no R2 (upload incompleto, nunca fica visível). Aceitável para a versão Demo (uma única instância no Render); recomendação para quando escalar: mover esse estado para Redis, e/ou configurar uma **lifecycle rule no bucket R2** para abortar multipart uploads incompletos automaticamente após alguns dias (evita acúmulo de lixo).

### 3.4 Testes

- `shared/config/storage-environment.spec.ts` — 5 casos cobrindo a precedência `STORAGE_DRIVER` vs. `NODE_ENV`.
- `modules/erp-integration/infrastructure/storage/r2-file-storage.service.spec.ts` — `PutObjectCommand` com o conteúdo certo, URL pública montada a partir de `R2_PUBLIC_BASE_URL`, erro explícito se faltar `R2_BUCKET`/`R2_PUBLIC_BASE_URL`.
- `modules/logistics-fulfillment/infrastructure/r2-video-chunk-storage.service.spec.ts` — bufferização até 5 MiB antes do primeiro `UploadPartCommand`, Part final abaixo do mínimo no `finalizeSession`, múltiplas Parts na ordem certa, `delete` via `DeleteObjectCommand`.
- `application/video-capture.service.spec.ts` — atualizado para o novo `finalizeSession` na porta.

O `@aws-sdk/client-s3` real é usado nos adapters; nos testes, `@aws-sdk/client-s3` é mockado via `jest.mock` (sem rede) — mesmo racional de todo o resto do projeto (fakes com estado real em vez de mocks vazios): o `S3Client` fake decide a resposta por tipo de comando (`CreateMultipartUploadCommand`, `UploadPartCommand`, etc.), permitindo testar o fluxo completo de principio a fim.

Todos os 4 arquivos de teste passam (26 testes) e nenhum arquivo novo/editado deste passo aparece nos erros de um `tsc --noEmit` completo do projeto — os únicos erros restantes são 100% relacionados ao Prisma Client não gerado neste sandbox (gap já documentado na seção 2.3), pré-existente e sem relação com o código de storage.

### 3.5 Credenciais reais configuradas (2026-07-12) + vinculação do domínio custom

O usuário provisionou o bucket real no painel Cloudflare e forneceu as credenciais, já configuradas em `apps/api/.env` (nunca commitado — `.env` está no `.gitignore` de `apps/api`):

| Variável | Valor |
|---|---|
| `R2_BUCKET` | `kyneti-assets` |
| `R2_ENDPOINT` | `https://45ab8972f03ccd279a60b338dcf5aca7.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY` / `R2_SECRET_KEY` | configurados (não repetidos aqui — ver `.env` local) |
| `R2_PUBLIC_BASE_URL` | `https://assets.kyneti.com.br` (domínio custom escolhido pelo usuário) |

**Passo pendente do lado do usuário — vincular `assets.kyneti.com.br` ao bucket:**

1. Painel Cloudflare → R2 → bucket `kyneti-assets` → aba **Settings** → seção **Custom Domains** → **Connect Domain**.
2. Informar `assets.kyneti.com.br`. Se o domínio raiz (`kyneti.com.br`) já estiver na mesma conta Cloudflare (pré-requisito), o próprio painel cria o registro DNS (CNAME) automaticamente.
3. Aguardar a validação (normalmente minutos, pode levar até algumas horas dependendo da propagação DNS) — o painel mostra o status mudando de "Pending" para "Active".
4. Confirmar testando `https://assets.kyneti.com.br/qualquer-coisa` no navegador — antes de qualquer upload real, deve devolver 404 do R2 (não erro de DNS/certificado), o que já confirma que o domínio está servindo o bucket.

**Achado/limite deste ambiente:** tentei validar a conexão real com o R2 (`HeadBucket`/`ListObjectsV2`, `@aws-sdk/client-s3`) a partir deste sandbox de Cowork, e o proxy de rede do ambiente devolve **403 no CONNECT** para `*.r2.cloudflarestorage.com` — mesma categoria de restrição já documentada para `binaries.prisma.sh` (o sandbox só libera uma lista específica de domínios, e o do R2 não está nela). Não é um problema de credenciais nem do código: `registry.npmjs.org`, por exemplo, responde normalmente do mesmo ambiente. A validação real (upload de uma foto de teste, leitura via `assets.kyneti.com.br`) só vai poder acontecer a partir da sua máquina local (`npm run start:dev` com `STORAGE_DRIVER=r2`) ou já em produção no Render — ambos com rede irrestrita, ao contrário deste sandbox.

### 3.6 Checklist de saída deste passo

- [x] `@aws-sdk/client-s3` adicionado a `apps/api/package.json`.
- [x] Porta `VideoChunkStorage` estendida com `finalizeSession`.
- [x] `R2FileStorageService` e `R2VideoChunkStorageService` implementados.
- [x] Wiring condicional (`useFactory` + `resolveStorageDriver()`) em `ErpIntegrationModule` e `LogisticsFulfillmentModule`.
- [x] `ServeStaticModule` (`/uploads`) só registrado quando `STORAGE_DRIVER=local`.
- [x] Testes unitários dos dois adapters + do `resolveStorageDriver` + atualização do spec existente do `VideoCaptureService`.
- [x] Bucket R2 criado de verdade no painel Cloudflare (`kyneti-assets`), credenciais configuradas em `apps/api/.env`.
- [~] Domínio custom `assets.kyneti.com.br` vinculado ao bucket no painel R2 — status **"Inicializando"** no painel (2026-07-12), aguardando validação DNS. Ver seção 3.5.
- [ ] Upload real de teste + leitura via `https://assets.kyneti.com.br/...` confirmados a partir de uma máquina com rede real (`STORAGE_DRIVER=r2` local, ou já em produção no Render).
- [ ] Lifecycle rule de abort de multipart incompleto configurada no bucket (recomendado, não bloqueante).

---

## 4. Variáveis de ambiente do Render

### 4.1 Configuração do Web Service

O `apps/api` vive num monorepo — no Render, o serviço precisa apontar o **Root Directory** para `apps/api` (não para a raiz do repo). Configuração do serviço (New → Web Service):

| Campo | Valor |
|---|---|
| Root Directory | `apps/api` |
| Runtime | Node |
| Build Command | `npm install && npx prisma generate && npm run build` |
| Start Command | `npm run start:prod` |
| Node Version | 20.x (mesma major usada em dev — ver `apps/api/package.json` engines, se existir; senão fixar via `NODE_VERSION` nas env vars abaixo) |

`npx prisma generate` precisa estar no Build Command porque o `@prisma/client` gerado não é commitado (está no `.gitignore`) — sem isso, o build quebra com os mesmos erros de "Property X does not exist on PrismaService" já documentados neste projeto quando o client não foi gerado.

A *migration* em si (`prisma migrate deploy`) **não** deve rodar automaticamente a cada deploy do Web Service — ela já foi aplicada manualmente contra o Supabase no passo 2. Se quiser automatizá-la em deploys futuros, o padrão recomendado do Render é um **Pre-Deploy Command** separado (`npx prisma migrate deploy`) na aba Settings do serviço, não dentro do Build Command — assim uma migration que falhe não deixa o serviço num estado parcialmente buildado.

### 4.2 Lista completa de variáveis de ambiente

Levantamento exaustivo de todo `process.env.*` lido em `apps/api/src` + `prisma/schema.prisma` (nenhuma variável fora desta lista é lida pelo código hoje).

**Banco de dados** (valores vêm do painel do Supabase → Project Settings → Database → Connection string; ver seção 2.1/2.2 deste doc para qual porta usar em cada uma):

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Connection string **pooled** do Supabase (PgBouncer, porta `6543`, com `?pgbouncer=true`) |
| `DIRECT_URL` | Connection string **direta** do Supabase (porta `5432`) — usada só por `prisma migrate`/`generate` |

**Segurança** (gerados abaixo com `openssl rand`, únicos para este deploy — não reutilizar os valores de dev):

| Variável | Valor |
|---|---|
| `JWT_SECRET` | `oMeTsMUAt+5WF9NNDtQsEdtYcRhURO7RKE4QeLntUS9ZPDDV5sBCTD9DKqmopax3` |
| `JWT_EXPIRES_IN` | `8h` |
| `ERP_CREDENTIALS_ENCRYPTION_KEY` | `At8hNLubPkw11VoF1nusjsq70TEWz9pz5LMwUEG/J4E=` |

Sem `ERP_CREDENTIALS_ENCRYPTION_KEY` configurada, o `CredentialEncryptionService` cai silenciosamente para uma chave de dev fixa (apenas loga um aviso, não derruba o boot) — isso criptografaria credenciais reais de integração (Mercado Livre/Nuvemshop) com uma chave pública/conhecida. **Bloqueante de segurança, não só de boot.**

**App/servidor:**

| Variável | Valor |
|---|---|
| `PORT` | Render injeta a própria `PORT` automaticamente — não precisa (nem deve) ser setada manualmente; o código já lê `process.env.PORT` com fallback 3000. |
| `NODE_ENV` | `production` |

**Storage (Cloudflare R2 — passo 3):**

| Variável | Valor |
|---|---|
| `STORAGE_DRIVER` | `r2` (**obrigatório setar explicitamente** — sem isso o fallback por `NODE_ENV=production` cobre o mesmo caso, mas deixar explícito remove qualquer ambiguidade) |
| `R2_ENDPOINT` | `https://45ab8972f03ccd279a60b338dcf5aca7.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY` | `69fb448f093d40fb4a855339e4152e06` |
| `R2_SECRET_KEY` | *(o mesmo valor já configurado em `apps/api/.env` local — não repetido aqui por já estar em um arquivo gitignored; copiar de lá para o painel do Render)* |
| `R2_BUCKET` | `kyneti-assets` |
| `R2_PUBLIC_BASE_URL` | `https://assets.kyneti.com.br` |

`PUBLIC_BASE_URL` (usado pelos adapters *locais* de storage) **não precisa** ser setada no Render — com `STORAGE_DRIVER=r2`, `LocalFileStorageService`/`LocalVideoChunkStorageService` nunca são instanciados (ver `useFactory` em `erp-integration.module.ts`/`logistics-fulfillment.module.ts`), então essa variável fica sem efeito em produção.

**Integrações (Mercado Livre OAuth2 — Sprint 22):**

| Variável | Valor |
|---|---|
| `MERCADO_LIVRE_CLIENT_ID` | Do app cadastrado em https://developers.mercadolivre.com.br/devcenter |
| `MERCADO_LIVRE_CLIENT_SECRET` | Idem |
| `MERCADO_LIVRE_REDIRECT_URI` | Precisa ser a URL **HTTPS real do Render** (ex.: `https://kyneti-api.onrender.com/api/marketplace-intelligence/mercado-livre/callback`) — tem que bater **exatamente** (protocolo/host/path) com o que está cadastrado no painel do app do Mercado Livre, senão o callback falha com erro de redirect_uri mismatch. Atualizar em ambos os lugares ao mesmo tempo. |

Sem essas três, `MercadoLivreConnectionService` lança `InternalServerErrorException` explicitamente no boot da primeira tentativa de conexão — não silencioso, mas só descoberto ao usar a tela de conexão do Mercado Livre.

### 4.3 O que NÃO existe (evita configuração fantasma)

Não crie/procure estas variáveis — não são lidas em nenhum lugar do código hoje:

- Nenhuma variável de **CORS** (`main.ts` chama `app.enableCors()` sem argumentos — libera qualquer origem hoje; se quiser restringir por domínio do frontend, é uma mudança de código antes de virar uma env var).
- Nenhuma variável de **Nuvemshop** (client id/secret) — credenciais Nuvemshop são por-tenant, guardadas criptografadas no banco (`NuvemshopConnection`), não em env var.
- Nenhuma variável de **rate limit** ou **cron** — ambos são valores fixos no código (`marketplace-rate-limits.ts`, `@Cron(CronExpression...)` nos jobs).

### 4.4 Checklist de saída deste passo

- [x] Build/Start Command e Root Directory documentados.
- [x] Lista exaustiva de env vars levantada via grep de `process.env` em todo `src/`.
- [x] Segredos fortes gerados (`JWT_SECRET`, `ERP_CREDENTIALS_ENCRYPTION_KEY`) — únicos para produção, nunca reaproveitar os de dev.
- [x] Variáveis cadastradas no painel do Render.
- [x] Primeiro deploy + healthcheck (`GET /api/health` → `{"status":"ok"}`) confirmados em produção.
- [ ] `MERCADO_LIVRE_REDIRECT_URI` atualizada tanto no Render quanto no painel de app do Mercado Livre, apontando para `https://api.kyneti.com.br/...` (só faz sentido antes do primeiro teste real de conexão com o Mercado Livre em produção).
- [ ] Smoke test funcional completo (login, listagem de produtos, um upload de foto) — health check passou, mas isso ainda não foi confirmado.

### 4.5 Estado real em produção (2026-07-13)

Backend no ar. Ajustes feitos durante o primeiro deploy real que não estavam previstos nas seções 4.1–4.4, registrados aqui para não se perderem:

- **Build Command real:** precisou de `--include=dev` no `npm install` — o Render, por padrão, não instala `devDependencies` em builds de produção (`NODE_ENV=production` implícito faz o npm pular essa lista), mas `@nestjs/cli` (usado pelo `npm run build`) e `prisma` (usado pelo `npx prisma migrate deploy`/`generate`) estão em `devDependencies` neste projeto — sem a flag, o build falha por comando não encontrado. Build Command atualizado: `npm install --include=dev && npx prisma generate && npm run build`.
- **Migration automática no deploy:** ao contrário do que a seção 4.1 recomendava (Pre-Deploy Command separado), a prática adotada foi rodar `npx prisma migrate deploy` no próprio Build/Start Command a cada deploy. Funciona porque `migrate deploy` é idempotente (só aplica migrations pendentes), mas vale registrar o desvio da recomendação original — o risco documentado na seção 1.3/2 (uma migration ruim quebrando o deploy) continua valendo, só que agora acoplado ao boot em vez de isolado.
- **Supabase — caracteres especiais na senha:** a senha do Postgres do Supabase tinha caracteres que precisam de URL-encoding dentro da connection string (`DATABASE_URL`/`DIRECT_URL`) — sem isso, o Prisma falha ao parsear a URL. Resolvido codificando os caracteres especiais antes de colar no Render.
- **Domínio real da API:** `https://api.kyneti.com.br`, com SSL ativo, domínio customizado configurado no Render via Cloudflare (mesma conta/domínio raiz usada para `assets.kyneti.com.br` no R2 — seção 3.5). **Isso muda `MERCADO_LIVRE_REDIRECT_URI`**: o valor de exemplo na seção 4.2 (`kyneti-api.onrender.com`) fica obsoleto — usar `https://api.kyneti.com.br/api/marketplace-intelligence/mercado-livre/callback` quando for configurar a conexão real.
- **Health check confirmado:** `GET /api/health` → `{"status":"ok"}`.
- **Bug de DI corrigido antes deste deploy funcionar:** `CredentialEncryptionService` não estava exportado por `ErpIntegrationModule` — ver `docs/auth-security.md`, seção 2, para o detalhe completo (root cause + fix + porque `nest build` não pega esse tipo de erro).

Com isso, os 4 passos deste documento estão concluídos e o backend está servindo tráfego real. Próximos passos (deploy do frontend, integrações de marketplace) ficam fora do escopo deste documento.
