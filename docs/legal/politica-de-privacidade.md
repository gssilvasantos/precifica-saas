# Política de Privacidade — Kyneti

**Última atualização:** 24 de julho de 2026

> **Nota para publicação:** este texto foi redigido como ponto de partida para atender ao pré-requisito de "URL de política de privacidade pública" pedido no cadastro de desenvolvedor do TikTok for Business (e como boa prática geral para Shopee/Amazon/Magalu). Os campos entre colchetes `[...]` precisam ser preenchidos com os dados reais da empresa antes de publicar. Recomenda-se revisão por um advogado especializado em LGPD antes da publicação definitiva — este documento não substitui aconselhamento jurídico.

## 1. Quem somos

Esta Política de Privacidade descreve como **[Razão Social da Empresa, ex.: Kyneti Tecnologia Ltda.]**, inscrita no CNPJ sob o nº **[00.000.000/0001-00]**, com sede em **[endereço completo]** ("Kyneti", "nós"), coleta, usa, armazena e protege dados pessoais no contexto da plataforma Kyneti (`https://kyneti.com.br` e `https://api.kyneti.com.br`), um SaaS de precificação e gestão multicanal para vendedores de marketplace.

Esta política é regida pela Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD).

## 2. Papéis: controlador e operador

O Kyneti atua em dois papéis diferentes, dependendo do dado:

- **Como controlador**, para os dados cadastrais das empresas-clientes (tenants) e de seus usuários que acessam a plataforma (nome, e-mail, papel de acesso).
- **Como operador**, para os dados que os tenants processam através da plataforma em nome de sua própria operação comercial — por exemplo, dados de pedidos, produtos e clientes finais sincronizados a partir de marketplaces (Mercado Livre, Nuvemshop, Olist) e, quando aplicável, das APIs de anúncios (Shopee, TikTok Shop, Amazon Ads, Magalu Ads). Nesses casos, o tenant é o controlador desses dados, e o Kyneti os trata estritamente sob as instruções do tenant, para viabilizar as funcionalidades contratadas (sincronização, precificação, relatórios de campanha).

## 3. Quais dados coletamos

**Dados de cadastro e conta:**
- Nome, e-mail e papel de acesso (ADMIN, PRICING_EDITOR, etc.) de cada usuário da plataforma.
- Dados da empresa-tenant (razão social, identificadores comerciais).

**Dados de integração com marketplaces e canais de venda** (fornecidos pelo próprio tenant, via conexão OAuth2 ou credencial de API):
- Tokens de acesso e atualização (access/refresh tokens) das integrações autorizadas pelo tenant (ex.: Mercado Livre, Nuvemshop, Olist e, quando aprovado, Shopee/TikTok/Amazon/Magalu).
- Dados de catálogo, pedidos, preços e métricas de campanhas publicitárias sincronizados a partir dessas plataformas.

**Dados técnicos:**
- Logs de acesso e uso da aplicação, para fins de segurança e diagnóstico.

Não coletamos dados sensíveis (saúde, biometria, origem racial, opinião política, etc.) no funcionamento normal da plataforma.

## 4. Como usamos os dados

- Autenticar usuários e controlar permissões de acesso por papel.
- Sincronizar catálogo, pedidos e métricas de campanhas entre os marketplaces conectados e a plataforma, para viabilizar precificação automatizada e relatórios.
- Gerar recomendações de precificação e otimização de campanhas de anúncios (incluindo sugestões geradas por modelos de IA, sempre sujeitas à confirmação humana do usuário antes de qualquer ação real ser aplicada).
- Cumprir obrigações legais e responder a solicitações de autoridades competentes.

Não vendemos dados pessoais a terceiros, sob nenhuma circunstância.

## 5. Compartilhamento de dados

Dados são compartilhados apenas:

- **Com os próprios marketplaces/plataformas de anúncio conectados pelo tenant** — na medida necessária para executar a sincronização ou ação que o tenant explicitamente autorizou (ex.: atualizar um preço, ler métricas de uma campanha).
- **Com subprocessadores de infraestrutura** que hospedam a aplicação e o banco de dados (atualmente: Render para hospedagem de aplicação, Supabase para banco de dados PostgreSQL, Cloudflare para DNS/CDN/armazenamento de objetos), todos sob obrigações contratuais de confidencialidade e segurança.
- **Quando exigido por lei**, ordem judicial ou autoridade regulatória competente.

## 6. Segurança da informação

- **Isolamento multi-tenant a nível de banco de dados:** cada tenant só acessa seus próprios dados, garantido por Row-Level Security (RLS) no PostgreSQL — políticas aplicadas diretamente no banco, não apenas na camada de aplicação, com um papel de execução (`app_runtime`) dedicado e sem privilégio de contornar essa proteção.
- **Criptografia em repouso para credenciais de terceiros:** todo token de acesso a marketplace/plataforma de anúncio (Mercado Livre, Nuvemshop, Olist e, futuramente, Shopee/TikTok/Amazon/Magalu) é armazenado criptografado com AES-256-GCM (cifra autenticada — qualquer adulteração é detectada), nunca em texto puro.
- **Autenticação:** senhas de usuário nunca são armazenadas em texto puro — usamos hashing bcrypt.
- **Transporte:** toda comunicação com a plataforma ocorre via HTTPS/TLS.

## 7. Retenção de dados

Dados são mantidos pelo tempo necessário para a prestação do serviço contratado pelo tenant, e por prazos adicionais quando exigido por obrigação legal, regulatória ou para exercício regular de direitos. Ao encerrar a conta, o tenant pode solicitar a exclusão de seus dados, observadas as retenções legais aplicáveis.

## 8. Direitos do titular de dados

Nos termos da LGPD, o titular de dados pode solicitar, a qualquer momento: confirmação da existência de tratamento, acesso aos dados, correção de dados incompletos ou desatualizados, anonimização/bloqueio/eliminação de dados desnecessários, portabilidade, informação sobre compartilhamento com terceiros, e revogação de consentimento, quando aplicável.

Solicitações podem ser feitas pelo canal de contato indicado na seção 10.

## 9. Alterações a esta política

Esta política pode ser atualizada periodicamente. A data da última atualização está indicada no topo do documento. Mudanças materiais serão comunicadas aos tenants pelos canais habituais de contato.

## 10. Contato / Encarregado de Dados (DPO)

Para exercer direitos de titular ou esclarecer dúvidas sobre esta política, entre em contato:

- **E-mail:** [privacidade@kyneti.com.br — ou e-mail de contato real]
- **Encarregado de Proteção de Dados (DPO):** [nome, se já designado — ou "a ser designado"]
