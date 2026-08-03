# Revisão de segurança — <escopo>

| | |
|---|---|
| **Data** | AAAA-MM-DD |
| **Escopo revisado** | arquivos / módulos / fluxo |
| **Tipo** | mudança nova / revisão periódica / incidente |
| **Executado por** | |

## Superfície de ataque

Endpoints, formulários, uploads, webhooks, jobs, integrações e telas administrativas tocados.

| Superfície | Autenticada? | Autorização | Entrada externa |
|---|---|---|---|
| | | | |

## Ativos

O que um atacante quer aqui.

| Ativo | Sensibilidade | Onde vive |
|---|---|---|
| | | |

## Atores de ameaça

- [ ] Anônimo
- [ ] Usuário de outro tenant
- [ ] Usuário do mesmo tenant com papel reduzido
- [ ] Colaborador com acesso parcial a módulos
- [ ] Integração externa comprometida
- [ ] Administrador da plataforma (abuso ou conta comprometida)

## Ameaças analisadas

| # | Ameaça | Vetor | Controle existente | Suficiente? |
|---|---|---|---|---|
| T1 | | | | |

## Controles verificados

- [ ] Autenticação e sessão (expiração, revogação)
- [ ] Autorização por papel / módulo / propriedade do recurso
- [ ] Isolamento entre tenants (leitura **e** escrita)
- [ ] Validação e normalização de entrada; rejeição de campo desconhecido
- [ ] Injeção (SQL, comando, caminho de arquivo)
- [ ] XSS e renderização de conteúdo do usuário
- [ ] CSRF (ou justificativa de não aplicabilidade)
- [ ] CORS e cabeçalhos
- [ ] Upload (tipo, tamanho, nome, local, execução)
- [ ] Segredos fora de código, log e documentação
- [ ] Webhook: assinatura, replay, idempotência
- [ ] Rate limiting em endpoints sensíveis e caros
- [ ] Exposição de dados na resposta e no log
- [ ] Ações destrutivas: confirmação e auditoria
- [ ] Dependências novas justificadas

## Achados

| # | Severidade | Título | Local (arquivo:linha) | Cenário de exploração | Impacto | Correção proposta | Status |
|---|---|---|---|---|---|---|---|
| F1 | Crítico / Alto / Médio / Baixo / Informativo | | | | | | aberto / corrigido / aceito |

> Achado sem cenário de exploração concreto deve ser marcado como **especulativo**.

## Risco residual aceito

O que fica em aberto, por decisão consciente, e por quanto tempo.

## Recomendações de acompanhamento

-
