# Materiais de Apoio — Cadastros de Acesso às APIs de Ads

Rascunhos de texto para preencher os formulários/contatos descritos em `docs/marketplace-ads-api-access-plan.md`. Cobre as 4 plataformas, na ordem sugerida do plano (TikTok → Shopee → Amazon → Magalu). Campos entre colchetes `[...]` precisam de dado real (CNPJ, e-mail, nome) antes de submeter — o restante pode ser copiado/adaptado diretamente nos formulários.

---

## Descrição de produto (base comum, adaptar por plataforma)

**Curta (1 frase, para campos com limite de caracteres):**
> Kyneti é um SaaS de precificação e gestão multicanal que ajuda vendedores de marketplace a sincronizar catálogo/pedidos, precificar automaticamente e otimizar campanhas de anúncios em múltiplos canais de venda.

**Longa (para campos de descrição livre):**
> O Kyneti é uma plataforma B2B (SaaS) usada por empresas que vendem em múltiplos marketplaces simultaneamente (hoje: Mercado Livre, Nuvemshop, Olist; em expansão para Shopee, TikTok Shop, Amazon e Magalu). A plataforma sincroniza catálogo e pedidos automaticamente, aplica regras de precificação que respeitam piso de margem e preço mínimo do fornecedor (MAP), e — no módulo de Ads — consolida métricas de campanhas publicitárias (investimento, receita atribuída, ROAS, TACOS) com recomendações de otimização, sempre com confirmação humana antes de qualquer alteração real na campanha. O Kyneti nunca opera como vendedor final nem interage diretamente com o consumidor da loja — toda ação é feita em nome do tenant (o vendedor cliente do Kyneti), com autorização explícita via OAuth2.

**Quem são os usuários finais da integração (campo pedido explicitamente pelo TikTok, útil também para os demais):**
> Os usuários finais são os tenants do Kyneti — empresas vendedoras que já operam uma loja/conta de anúncios nesses marketplaces e contratam o Kyneti para gerenciar precificação e campanhas de forma centralizada. O Kyneti nunca acessa dados de um vendedor sem autorização OAuth2 explícita desse vendedor, e cada tenant só enxerga seus próprios dados (isolamento reforçado por Row-Level Security a nível de banco).

---

## 1. TikTok for Business — Marketing API

Campos do formulário de app registration (`developers.tiktok.com`, passo 5 do plano) costumam pedir: descrição da integração, quem são os usuários finais, e justificativa por escopo/permissão pedido.

**Descrição da integração:**
> Sincronização e leitura de métricas de campanhas de anúncios (Marketing API) para consolidar performance (investimento, receita atribuída, ROAS) dentro do painel Kyneti, permitindo que o vendedor acompanhe todos os seus canais de anúncio num único lugar, com recomendações de otimização sujeitas a confirmação manual do vendedor antes de qualquer mudança ser aplicada de volta na campanha.

**Justificativa de escopo (leitura de métricas/campanhas):**
> Necessário para popular o dashboard de Ads do tenant com dados reais de campanha (nome, status, investimento, métricas de conversão) — sem esse escopo, o módulo de Ads do Kyneti não teria dado nenhum do canal TikTok para exibir.

**Justificativa de escopo (escrita/ajuste de campanha, se solicitado):**
> Usado somente quando o vendedor confirma explicitamente uma recomendação (ex.: pausar campanha com ROAS abaixo do esperado) dentro do próprio painel Kyneti — nenhuma alteração é automática ou ocorre sem confirmação humana.

**Pré-requisito a resolver antes de aplicar:** URL pública da política de privacidade — já redigida em `docs/legal/politica-de-privacidade.md`, falta publicar (ex.: `kyneti.com.br/privacidade`) e usar essa URL no cadastro.

---

## 2. Shopee Open Platform

Tipo de conta: **Third-party Partner Platform** (não "Seller").

**Descrição do produto (campo de cadastro):**
> Ver "Descrição longa" acima. Reforçar explicitamente que o Kyneti se cadastra como parceiro de tecnologia multi-tenant, não como vendedor — cada cliente final (tenant) conecta sua própria conta Shopee via OAuth2, o Kyneti nunca vende diretamente na Shopee em nome próprio.

**Item 3 do retorno deles ("URL de ADMIN para validar o item 2"):** é o próprio painel do Kyneti, não uma conta Shopee. Informar:
> - **URL:** `https://kyneti.com.br`
> - **Login/senha:** conta de revisão dedicada, gerada por `apps/api/create-review-user.ts` (rodar `npx ts-node create-review-user.ts` dentro de `apps/api` — imprime e-mail/senha no console). Papel `VIEWER` — só leitura, não altera nada.
> - O que eles vão ver ao entrar: a tela `/integracoes`, com os cards de Nuvemshop/Olist/Mercado Livre. **Pendência real antes de enviar:** pelo menos um desses cards precisa estar "Conectado" de verdade (credencial real, mesmo que de conta de teste) — hoje nenhum está. Ver checklist no fim deste documento.

**Conta de teste/trial da Shopee (pré-requisito explícito do passo 4 do plano de acesso — isso é diferente do item acima):**
> Essa é uma conta Shopee (não Kyneti) que a própria Shopee usa para validar a integração depois de aprovada — precisa ser providenciada por você diretamente com a Shopee, não é algo que o Kyneti gera.

**Pergunta a fazer explicitamente durante a revisão (ponto de atenção já registrado no plano):**
> "Existe um escopo de API dedicado a Ads/Discovery Ads dentro do Shopee Open Platform, disponível para parceiros terceiros (não só vendedores diretos)? Se sim, qual o nome do escopo e como solicitá-lo?"

---

## 3. Amazon Advertising API

Este é o processo mais longo (Security Onboarding Review) — não é preenchimento de formulário, é uma revisão de segurança em etapas.

**Business Offering & Privacy Review — descrição do que o Kyneti oferece:**
> Ver "Descrição longa" acima, com ênfase em: o Kyneti trata dados de terceiros (dos tenants e de suas campanhas) sob relação contratual de operador de dados, nunca compartilha ou vende esses dados, e aplica isolamento multi-tenant reforçado a nível de banco de dados (Row-Level Security).

**Evidências de segurança para o questionário do Security Onboarding Review (SOR)** — o Kyneti já tem essas respostas documentadas em `docs/auth-security.md`:

- **Como credenciais/tokens de terceiro são armazenados:** criptografados em repouso com AES-256-GCM (cifra autenticada — detecta qualquer adulteração do ciphertext), chave derivada via `scryptSync` a partir de variável de ambiente dedicada, nunca em texto puro. Implementado em `CredentialEncryptionService`, reutilizado por todas as integrações (Mercado Livre, Nuvemshop, Olist), mesmo padrão será aplicado ao token da Amazon Ads.
- **Isolamento entre clientes (multi-tenancy):** Row-Level Security do PostgreSQL, aplicada diretamente no banco (não só na aplicação), com um papel de conexão de aplicação (`app_runtime`) sem privilégio de contornar essa política — validado com teste de acesso cruzado entre tenants em produção.
- **Transporte:** toda comunicação via HTTPS/TLS.
- **Autenticação de usuário:** hashing bcrypt para senhas, nunca texto puro.
- **Fluxo OAuth2:** já implementado e em produção para Mercado Livre (`state` do OAuth2 também criptografado com AES-256-GCM, contendo tenantId + timestamp com janela de validade de 10 minutos, protegendo contra CSRF e reaproveitamento de link antigo) — mesmo padrão arquitetural será replicado para Amazon Ads.

**Nota de prazo:** iniciar o quanto antes, mesmo em paralelo aos outros três — é o único dos quatro com barreira formal de compliance antes do acesso técnico, e historicamente o mais demorado.

---

## 4. Magalu Ads

Diferente dos três anteriores: não é formulário self-service, é relacionamento comercial via "Acelera com Magalu".

**Mensagem de contato inicial (rascunho para abrir o canal comercial):**
> Assunto: Parceria de tecnologia — integração de Ads via API (Programa Acelera com Magalu)
>
> Olá! Somos o Kyneti, uma plataforma SaaS de precificação e gestão multicanal para vendedores de marketplace [ex.: já integrada com Mercado Livre, Nuvemshop e Olist]. Gostaríamos de iniciar uma conversa sobre o programa "Acelera com Magalu" para viabilizar acesso à API de Ads da Magalu, permitindo que nossos clientes (vendedores que já operam no Magalu) gerenciem e otimizem suas campanhas publicitárias diretamente pelo painel Kyneti, com sincronização de métricas e recomendações de otimização. Já operamos integração self-service de Catálogo/Pedidos com outros marketplaces via OAuth2 e temos arquitetura de segurança documentada (criptografia de credenciais em repouso, isolamento multi-tenant a nível de banco). Podemos agendar uma conversa para entender os próximos passos do programa?
>
> [Nome do contato] — [cargo] — [e-mail] — [telefone, se aplicável]

**Canal:** abrir via "Acelera com Magalu" e, em paralelo, um chamado em `developers.magalu.com` (opção "Developers Magalu") citando explicitamente o interesse em onboarding de Ads.

**Nota:** a parte de Catálogo/Pedidos do Magalu Devs é self-service (mesmo fluxo OAuth2 já usado no resto do Kyneti) — só a parte de Ads exige esse contato comercial antes de qualquer passo técnico.

---

## Checklist de uso deste documento

- [ ] Publicar `docs/legal/politica-de-privacidade.md` em uma URL pública antes de aplicar ao TikTok.
- [ ] Preencher os campos `[...]` (CNPJ, e-mail, nome de contato) em ambos os documentos antes de submeter qualquer formulário.
- [ ] Providenciar conta de teste/trial da Shopee (pré-requisito explícito, não coberto por texto).
- [ ] Revisar os textos de descrição de produto com quem vai efetivamente submeter o formulário — ajustar tom/formalidade conforme o campo aceitar.

**Bloqueador específico da Shopee, antes de responder o item 3 do retorno deles:**

- [ ] Conectar Nuvemshop e/ou Olist com credencial REAL (pode ser conta de teste, não precisa ser cliente de produção) na tela `/integracoes` de `https://kyneti.com.br` — hoje nenhuma está conectada, só a UI foi construída.
- [ ] Rodar `cd apps/api && npx ts-node create-review-user.ts` (contra o `.env` de produção) para gerar/confirmar a conta de revisão dedicada — anotar a senha impressa no console.
- [ ] Responder ao e-mail/formulário da Shopee com a URL do painel + essas credenciais.
