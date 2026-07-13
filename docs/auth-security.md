# Segurança de Autenticação e Credenciais de Integração

**Status:** cobre a criptografia em repouso usada por toda credencial de integração (Olist, Nuvemshop, Mercado Livre) e o fluxo OAuth2 completo do Mercado Livre (Sprint 22) — autorização, callback, renovação automática. Não é um documento de segurança da aplicação inteira (autenticação de usuário/JWT já é tratada em `identity-access`); o escopo aqui é especificamente "como o Kyneti guarda e usa a chave de outra empresa em nome do tenant".

## 1. Por que este documento existe agora

Até a Sprint 21, toda credencial de integração era um token estático (Olist, Nuvemshop) — conectar era "cole o token aqui". O Mercado Livre é o primeiro canal com OAuth2 completo (autorização por navegador, `access_token` de vida curta, `refresh_token` para renovar sem novo login). Isso introduz três problemas novos que os canais anteriores não tinham: proteger o `code`/`state` durante o redirect público, renovar automaticamente antes de cada chamada, e nunca deixar o par de tokens "vazar" nos dois sentidos (nem em repouso no banco, nem em trânsito por uma URL de callback pública).

## 2. Criptografia em repouso — `CredentialEncryptionService`

Toda credencial de terceiro (Olist `apiTokenEnc`, Nuvemshop `accessTokenEnc`, Mercado Livre `accessTokenEnc`/`refreshTokenEnc`) é criptografada com o mesmo serviço compartilhado (`shared/security/credential-encryption.service.ts`), em uso desde a Etapa 5 e reaproveitado sem alteração nesta sprint:

- **Algoritmo:** AES-256-GCM (autenticado — qualquer adulteração do ciphertext é detectada na descriptografia via `authTag`, não só a confidencialidade é protegida).
- **Chave:** derivada de `ERP_CREDENTIALS_ENCRYPTION_KEY` (variável de ambiente) via `scryptSync` com salt fixo (`'precifica-erp-integration'`). Sem essa variável, o serviço usa uma chave de desenvolvimento fixa e **loga um aviso explícito** — nunca falha silenciosamente, mas também nunca deveria rodar assim em produção.
- **Formato armazenado:** `iv.authTag.cipherText`, cada parte em base64, concatenada com `.` — autocontido, sem precisar de coluna extra para o IV.
- **Nunca reversível sem a chave:** decriptar sem a `ERP_CREDENTIALS_ENCRYPTION_KEY` correta lança erro (formato ou `authTag` inválido), nunca devolve dado parcial.

**Gap honesto, documentado de propósito:** a chave é única para toda a plataforma (não uma por tenant, não uma por integração) e vive em uma env var, não em um KMS gerenciado (AWS KMS/GCP KMS/Vault). Isso é uma simplificação consciente de estágio — trocar por um KMS é um adapter (`CredentialEncryptionService` continua com a mesma interface `encrypt`/`decrypt`, só a implementação de onde a chave vem muda), não uma reescrita. Rotação de chave também não existe ainda: trocar `ERP_CREDENTIALS_ENCRYPTION_KEY` hoje torna todas as credenciais já armazenadas ilegíveis (precisariam ser reconectadas) — um mecanismo de rotação com re-criptografia em lote é uma extensão futura, não coberta aqui.

**Bug corrigido (deploy Demo, 2026-07-13) — export de módulo ausente:** `CredentialEncryptionService` é registrado como `provider` em `ErpIntegrationModule` (não tem módulo próprio). `MercadoLivreConnectionService` (em `MarketplaceIntelligenceModule`) sempre dependeu dele, e `MarketplaceIntelligenceModule` sempre importou `ErpIntegrationModule` — mas `ErpIntegrationModule` nunca listava `CredentialEncryptionService` no seu `exports`. Isso só quebra em runtime (`Test.createTestingModule`/`NestFactory.create`, não em `tsc`/`nest build`, que não resolvem o grafo de DI), e por isso passou despercebido até o primeiro boot real fora deste sandbox de desenvolvimento (Render). Corrigido adicionando `CredentialEncryptionService` ao `exports` de `apps/api/src/modules/erp-integration/erp-integration.module.ts` — mesmo padrão já usado ali para `NuvemshopFeeRuleProvider`/`NuvemshopOrderProvider`/`FILE_STORAGE`. Auditoria manual de todos os 15 módulos do backend não encontrou nenhum outro caso do mesmo padrão (classe concreta usada fora do módulo que a declara sem estar em `exports`).

## 3. Fluxo OAuth2 do Mercado Livre (Sprint 22)

```
1. AUTORIZAÇÃO (frontend, autenticado)
   GET /marketplace-intelligence/mercado-livre/authorize  [JWT, ADMIN]
        │ MercadoLivreConnectionService.buildAuthorizationUrl(tenantId)
        │   state = encrypt({ tenantId, issuedAt: now })   — AES-256-GCM, mesma chave da seção 2
        ▼
   { authorizeUrl: "https://auth.mercadolivre.com.br/authorization?...&state=<criptografado>" }
        │ (frontend redireciona o navegador do usuário para essa URL)
        ▼
2. TELA DE LOGIN/APROVAÇÃO — 100% no domínio do Mercado Livre, o Kyneti não participa
        │ (vendedor aprova o acesso)
        ▼
3. CALLBACK (público, SEM guard JWT — o Mercado Livre chama isto, não o nosso frontend)
   GET /marketplace-intelligence/mercado-livre/callback?code=...&state=...
        │ MercadoLivreConnectionService.handleCallback(code, state)
        │   1. decrypt(state) -> { tenantId, issuedAt }        (rejeita se corrompido/adulterado)
        │   2. valida issuedAt (janela de 10 min)               (rejeita se expirado)
        │   3. MercadoLivreApiClient.exchangeCodeForToken(...)  POST https://api.mercadolibre.com/oauth/token
        │   4. encrypt(access_token) + encrypt(refresh_token) -> upsert em MercadoLivreConnection
        ▼
   { connected: true }

4. RENOVAÇÃO AUTOMÁTICA (toda chamada subsequente à API, nunca manual)
   MercadoLivreOrderProvider.fetchOrders()
        │ MercadoLivreConnectionService.getValidAccessToken(tenantId)
        │   expiresAt - now <= 5 min?  ──não──▶ decrypt(accessTokenEnc) e devolve
        │              │
        │             sim
        │              ▼
        │   MercadoLivreApiClient.refreshAccessToken(refresh_token atual)
        │   encrypt(novo access_token) + encrypt(novo refresh_token) -> upsert
        ▼
   token sempre válido antes de qualquer chamada a /orders/search
```

## 4. Proteção do parâmetro `state` — por que criptografar, não só assinar

O `state` do OAuth2 existe classicamente para prevenir CSRF (garantir que o callback corresponde a uma autorização que nós mesmos iniciamos). Aqui ele tem uma segunda função: carregar o `tenantId`, porque o callback é público e não tem sessão/JWT para descobrir de qual conta se trata.

Duas propriedades, ambas entregues pelo mesmo mecanismo (`CredentialEncryptionService`, AES-256-GCM):

- **Integridade:** o `authTag` do GCM detecta qualquer adulteração — um `state` modificado (ex.: trocar o tenantId por outro, na tentativa de associar a conexão de um vendedor à conta errada) falha a descriptografia e é rejeitado com `BadRequestException`, nunca processado.
- **Confidencialidade:** diferente de um JWT assinado (que qualquer um pode decodificar o payload, só não forjar), o `state` aqui é opaco — ninguém que veja a URL de callback nos logs de um proxy, no histórico do navegador do vendedor, ou em uma ferramenta de monitoramento consegue ler qual `tenantId` está embutido.
- **Janela de validade (10 minutos):** um `state` reaproveitado depois desse tempo é rejeitado (`issuedAt` validado em `decodeState`) — reduz a superfície de um link de autorização antigo sendo reenviado ou reaberto por engano.

## 5. Renovação automática — garantias e limites

- **Margem de segurança de 5 minutos:** o token é renovado quando faltam 5 minutos ou menos para expirar (não exatamente no vencimento) — absorve latência de rede e pequenas divergências de relógio entre o Kyneti e a API do Mercado Livre.
- **Rotação de refresh_token respeitada:** o Mercado Livre invalida o `refresh_token` anterior a cada uso e devolve um par novo — `persistToken` sempre substitui os DOIS campos (`accessTokenEnc` e `refreshTokenEnc`), nunca só o primeiro. Um bug que só atualizasse o `access_token` deixaria a conexão inutilizável na renovação seguinte (refresh_token velho, já invalidado).
- **Nenhuma race condition entre requisições concorrentes coberta ainda:** se duas chamadas a `fetchOrders` do mesmo tenant chegarem simultaneamente com o token igualmente perto de expirar, ambas podem disparar `refreshAccessToken` em paralelo — o Mercado Livre provavelmente invalidaria o resultado de uma delas (o refresh_token usado por uma já teria sido consumido pela outra). Não é um cenário exercitado hoje (o scheduler de sync roda um provider de cada vez, `OrdersSyncSchedulerJob`), mas seria um gap real sob paralelismo maior — a extensão natural é um lock por tenant em torno do refresh.
- **Falha de renovação não é silenciosa:** se `refreshAccessToken` lançar (ex.: refresh_token também expirado — o Mercado Livre invalida após ~6 meses de inatividade), a exceção propaga até `OrderSyncOrchestrator.syncTenant`, que já registra isso como `FAILED` no `ProviderSyncLogRepository` com a mensagem de erro (ver seção 6) — nunca um pedido "sincroniza silenciosamente errado".

## 6. Integração com a auditoria de sync (Etapa 20 / Sprint 21)

Nenhuma peça nova de logging foi construída para isto — o mecanismo já existia (`ProviderSyncLogRepository.start/finish`, Etapa 16) e cobre automaticamente qualquer falha desta camada:

- Tenant sem conexão ativa → `MercadoLivreConnectionService.getValidAccessToken` lança `NotFoundException` → `OrderSyncOrchestrator` captura, grava `status: FAILED` + `errorDetails` claros, chama `health.recordFailure`.
- Falha ao renovar (refresh_token inválido/expirado) → mesma propagação, mesmo registro.
- Isso conecta diretamente com a Regra de Ouro da Etapa 20: uma falha de autenticação nunca produz um DRE silenciosamente incompleto — ela aparece como uma sincronização `FAILED` auditável, antes mesmo de qualquer pedido ser processado.

## 7. Variáveis de ambiente exigidas

```
ERP_CREDENTIALS_ENCRYPTION_KEY   # chave de criptografia em repouso (seção 2) — gerar com `openssl rand -base64 32`
MERCADO_LIVRE_CLIENT_ID          # do app criado em developers.mercadolivre.com.br/devcenter
MERCADO_LIVRE_CLIENT_SECRET      # idem — NUNCA commitado, só em .env local/secret manager de produção
MERCADO_LIVRE_REDIRECT_URI       # precisa bater EXATAMENTE com a URL cadastrada no painel do app (protocolo+host+path)
```

Nenhuma dessas é lida via um `ConfigModule` tipado — segue o mesmo padrão já usado por `CredentialEncryptionService` desde a Etapa 5 (`process.env` direto, com erro claro se ausente). Ver `.env.example` para os placeholders.

## 8. O que falta / simplificações conscientes

- Chave de criptografia única para toda a plataforma, sem KMS gerenciado e sem rotação (seção 2) — troca de implementação é isolada (`CredentialEncryptionService`), mas ainda não feita.
- Sem lock por tenant contra renovação concorrente (seção 5) — não exercitado no volume atual, mas um gap real sob paralelismo.
- Sem revogação ativa do token no Mercado Livre ao desconectar (`disconnect()` só marca `isActive = false` localmente — não chama nenhum endpoint de revogação do lado do Mercado Livre). O token antigo continua tecnicamente válido do lado deles até expirar sozinho.
- Callback (`GET /marketplace-intelligence/mercado-livre/callback`) devolve JSON simples, sem página de confirmação no frontend — mesma simplificação consciente de outras telas "aguardando implementação" já registradas em etapas anteriores.
- Fluxo nunca exercitado contra credenciais reais de um app Mercado Livre neste ambiente (sandbox sem rede) — a implementação segue a documentação pública (RFC 6749 + extensões do ML) à risca, mas a primeira conexão real de um tenant é o teste definitivo de que o formato de resposta bate exatamente com o assumido em `MlOAuthTokenResponse`.

Testes: `mercado-livre-connection.service.spec.ts` (URL de autorização não vaza tenantId, callback decodifica/valida state, state adulterado/expirado rejeitado, renovação automática quando vencido ou perto de vencer, token válido nunca renova, disconnect/getStatus/listActiveTenantIds), `mercado-livre-order.provider.spec.ts` (atualizado para consumir a conexão real em vez de lançar `NotImplementedException`).
