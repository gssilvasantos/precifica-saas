# Plano de Solicitação de Acesso — APIs de Ads (Shopee, TikTok Shop, Amazon, Magalu)

**▶ STANDBY LIBERADO (24/07/2026):** a execução deste plano estava pausada (decisão de negócio, 16/07/2026) até o RLS multi-tenant estar validado em produção e o layout/UI do Kyneti estar maduro o suficiente para uma demonstração visual completa. Ambas as condições foram cumpridas — ver README.md, seção "Fase 0 — STANDBY LIBERADO". Este documento passa de planejamento para execução: os 4 processos abaixo devem ser abertos em paralelo, começando pelo checklist da seção 7.

**Status:** documento de planejamento, sem código associado ainda. Cobre só a etapa de **obter acesso de desenvolvedor/parceiro** às APIs de anúncios dessas 4 plataformas — não cobre a implementação do módulo de Ads em si (isso é o passo seguinte, condicionado a essas aprovações). Mercado Livre fica de fora deste documento porque já está resolvido: o Kyneti já é um app OAuth2 registrado no developer portal deles desde o Sprint 22 (ver `docs/auth-security.md`) — a Product Ads API do Mercado Livre usa o mesmo app, só precisa pedir o escopo `advertising/product_ads` a mais.

**Correção de premissa:** os 4 caminhos abaixo **não são o mesmo processo**. Shopee e TikTok seguem um modelo parecido com o que o Kyneti já passou com Mercado Livre/Nuvemshop — portal de desenvolvedor self-service com revisão. Amazon é estruturalmente diferente: é uma auditoria formal de segurança, não um formulário. Magalu é diferente dos dois grupos: a parte de Catálogo/Pedidos é self-service, mas Ads especificamente exige uma conversa comercial com o time de negócios da Magalu antes de qualquer coisa técnica. Detalhe de cada um abaixo.

---

## 1. Shopee Open Platform

**Trilha:** cadastro como **"Third-party Partner Platform"** (não como vendedor individual) — é o tipo de conta correto para um SaaS multi-tenant como o Kyneti, mesmo modelo já usado com Mercado Livre/Nuvemshop.

**Pré-requisitos:**
- CNPJ e documentos societários da empresa.
- Produto "vivo" publicamente acessível — o Kyneti já atende isso.
- URL do produto servida em HTTPS com TLS 1.2 — já atendido.
- Uma conta de teste/trial que a Shopee possa usar para validar o produto funcionando de verdade.

**Correção importante:** a URL a fornecer é a do **painel do produto** (`https://kyneti.com.br`, onde fica a tela de login e a seção de Integrações), não a URL da API (`https://api.kyneti.com.br`, que não tem UI nenhuma — só responde JSON). O pedido deles é explícito: "URL com TLS 1.2 e login e senha válidas... precisamos da URL de ADMIN para validar [a seção de Integrações]" — ou seja, eles vão logar no painel com credencial que a gente fornece, não testar a API diretamente nem conectar uma conta Shopee própria. Ver a conta de revisão dedicada em `apps/api/create-review-user.ts`.

**Passo a passo:**
1. Acessar a homepage do Shopee Open Platform → *Log In* → *Sign Up*, com e-mail corporativo.
2. Escolher o tipo de conta **Third-party Partner Platform** (não "Seller").
3. Preencher os documentos da empresa + descrição do produto (o Kyneti: SaaS de precificação/gestão multicanal) + a URL pública.
4. Fornecer credenciais de uma conta de teste para a Shopee avaliar a integração.
5. Aguardar revisão de perfil da Shopee.
6. Uma vez aprovado: criar o "app" no painel — isso gera `client_id`/`client_secret` (OAuth2), o mesmo padrão técnico já usado em `NuvemshopConnection`/`MercadoLivreConnection`.
7. **Ponto de atenção:** não há confirmação pública clara de que exista um escopo de API dedicado a Ads/Discovery Ads dentro do Open Platform. Perguntar isso explicitamente durante a revisão/onboarding — pode ser um escopo separado do catálogo/pedidos, ou pode nem existir ainda como API pública (precisa validar direto com o time da Shopee antes de prometer prazo).

**Prazo:** não publicado. O gargalo é a revisão de perfil (etapa 5).

---

## 2. TikTok for Business — Marketing API

**Trilha:** `developers.tiktok.com`, atrelado a uma **conta TikTok Business verificada**.

**Pré-requisitos:**
- Conta TikTok Business ativa — de preferência com algum histórico de investimento em anúncios (conta nova sem atividade nenhuma tende a receber mais escrutínio na aprovação).
- Documentos de registro da empresa.
- **URL de política de privacidade pública** — o Kyneti provavelmente ainda não tem uma página pública dedicada a isso; vale criar antes de começar o processo, porque é pedido explicitamente na etapa de app registration.

**Passo a passo:**
1. Criar/verificar a conta TikTok Business.
2. Cadastro em `developers.tiktok.com` usando as credenciais da conta Business.
3. Criar uma "Organization" representando a empresa (Kyneti/CNPJ).
4. Completar a **Business Verification** — pode levar alguns dias, vale começar cedo, em paralelo com outras etapas.
5. Em *Manage apps → Connect a new app*, selecionar **Marketing API** e os escopos necessários. A TikTok pede uma descrição clara: o que a integração faz, quem são os usuários finais (no nosso caso: os tenants/vendedores do Kyneti, não o Kyneti mesmo) e por que cada permissão é necessária.
6. Aguardar revisão.

**Prazo:** 3–7 dias para aprovação padrão. Uso de maior volume ou mais sensível pode exigir "Partner status" — um programa à parte, com revisão mais profunda e contato direto com a TikTok (sem prazo público).

---

## 3. Amazon Advertising API

**Trilha:** registro de desenvolvedor terceiro em `advertising.amazon.com/about-api` — **estruturalmente diferente dos dois anteriores**. Não é um formulário de app, é uma auditoria de segurança formal.

**Pré-requisitos:**
- Aceitar os termos da Amazon Ads API (login com conta Amazon).
- Passar, em sequência, por: **Identity Verification** → **Business Offering & Privacy Review** → só então é liberado o convite para o **Security Onboarding Review (SOR)**.

**Passo a passo:**
1. Login em `advertising.amazon.com/about-api`, aceitar os termos.
2. Criar conta de desenvolvedor.
3. Completar a Identity Verification.
4. Completar a Business Offering & Privacy Review — a Amazon avalia o que o Kyneti oferece como produto e como trata dado de terceiro (dos tenants).
5. Ser convidado para o **Security Onboarding Review** no portal **Third-Party Security (TPS)**: preencher um questionário de segurança + enviar evidências (política de segurança, como credenciais/tokens são armazenados, etc.).
   - **Vantagem real que o Kyneti já tem aqui:** essa resposta já está pronta e documentada — `CredentialEncryptionService` (AES-256-GCM, chave via env var, nunca texto puro em repouso), descrito em `docs/auth-security.md`. Isso é exatamente o tipo de evidência que a Amazon pede nessa etapa.
6. Amazon responde a dúvidas em até 3 dias úteis por rodada, mas o processo completo (as 3 etapas antes da SOR + a SOR em si) é o mais longo dos quatro por natureza — não é um formulário, é uma revisão de segurança de verdade.

**Prazo:** semanas, não dias. É o único dos quatro com uma barreira de compliance formal antes mesmo de chegar no acesso técnico.

---

## 4. Magalu Ads

**Trilha:** diferente dos três anteriores. A parte de **Catálogo/Pedidos** do Magalu Devs é self-service (ID Magalu + OAuth2 — mesmo padrão que o Kyneti já usa em todo o resto). **Ads especificamente não é self-service**: exige um onboarding com o time de negócios da Magalu antes de liberar a criação/parametrização de campanha.

**Pré-requisitos:**
- Conta **ID Magalu** (reaproveita login do SuperApp/Portal do Seller, se já existir).
- Caminho mais indicado para um parceiro de tecnologia (não um vendedor único): o programa formal de parcerias **"Acelera com Magalu"** — é o canal direto com parceiros homologados, feito para esse tipo de integração.

**Passo a passo:**
1. Criar/usar conta ID Magalu.
2. Configurar a aplicação no ID Magalu para obter `client_id`/`client_secret` (fluxo OAuth2 padrão) — igual ao que já é feito para Catálogo/Pedidos.
3. Testar em ambiente de staging primeiro — a Magalu só libera credenciais de produção depois de um pedido completo com pagamento confirmado em staging (processo deles, não é opcional).
4. **Para Ads especificamente:** abrir contato via "Acelera com Magalu" e/ou abrir um chamado em `developers.magalu.com` (opção "Developers Magalu") pedindo onboarding do time de negócios voltado a Ads. É aqui que o caminho diverge de tudo mais: não existe um "toggle de escopo" self-service para Ads — é aprovação por relacionamento comercial, não uma etapa técnica.

**Prazo:** incerto, depende do ciclo comercial da Magalu — historicamente o menos previsível dos quatro.

---

## 5. Resumo comparativo

| Plataforma | Tipo de barreira | Self-service? | Ponto crítico |
|---|---|---|---|
| Shopee | Revisão de perfil de parceiro | Sim | Escopo de Ads na API não está confirmado publicamente — validar direto com eles |
| TikTok | Verificação de negócio + revisão de app | Sim | Precisa de política de privacidade pública antes de aplicar |
| Amazon | Auditoria formal de segurança (SOR) | Não (revisão em várias etapas) | Processo mais longo; Kyneti já tem a documentação de segurança pronta para isso |
| Magalu | Onboarding comercial (não técnico) | Não, para Ads | Não é formulário — é relacionamento com o time de negócios deles |

## 6. Ordem sugerida para iniciar os pedidos

Como os prazos são incertos e não competem por esforço de desenvolvimento (é preenchimento de formulário/contato comercial, não código), a recomendação é **abrir os quatro processos em paralelo, já esta semana**, e deixar o trabalho de desenvolvimento do módulo de Ads (Fase 1, escopo Mercado Livre) andar em paralelo, sem esperar nenhuma dessas aprovações. Prioridade de abertura, do mais rápido para o mais lento historicamente: TikTok → Shopee → Amazon → Magalu (esse último por depender de um ciclo comercial, não de uma fila de revisão).

## 7. Checklist de saída deste documento

- [ ] Conta corporativa Shopee Open Platform criada, tipo Third-party Partner Platform.
- [ ] Conta corporativa TikTok Business + developer.tiktok.com com Business Verification iniciada.
- [ ] Página pública de política de privacidade do Kyneti publicada (pré-requisito do TikTok, provavelmente não existe ainda).
- [ ] Conta de desenvolvedor Amazon Ads criada + Identity Verification iniciada.
- [ ] Contato aberto com "Acelera com Magalu" para onboarding de Ads.
- [ ] Confirmação por escrito da Shopee sobre existência (ou não) de escopo de Ads na Open Platform.
