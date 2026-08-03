---
name: product-engineering-studio
description: Engenharia de produto full stack — planejar, implementar, integrar, revisar e validar funcionalidades de ponta a ponta (produto, domínio, contrato, banco, backend, frontend, segurança, testes, observabilidade e infraestrutura). Use para SaaS, sistemas administrativos, dashboards, CRM, ERP, portais, páginas institucionais, landing pages, APIs, integrações, rotinas assíncronas e módulos internos. Acione quando a tarefa atravessar mais de uma camada, quando pedir "implemente/planeje/revise" uma funcionalidade, ou quando envolver interface conectada a dados reais.
---

# Product Engineering Studio

Sistema de engenharia de produto full stack, reutilizável. O conhecimento específico do
projeto vive no `CLAUDE.md` da raiz, nos `CLAUDE.md` por app, em `.claude/rules/` e em `docs/` —
**esta skill descreve o processo, não o produto**.

## Princípio central

Nenhuma funcionalidade é "só uma tela", "só um endpoint" ou "só uma tabela". Toda funcionalidade
é um fluxo completo:

```
usuário → interface → validação no cliente → contrato compartilhado → autenticação →
autorização → endpoint/procedure → serviço de aplicação → regra de domínio → persistência →
evento/integração → resposta → atualização da interface → feedback → auditoria →
monitoramento → testes
```

- O frontend nunca é construído isolado do backend.
- O backend nunca é criado sem identificar seus consumidores.
- O banco nunca é alterado sem avaliar contratos, regras, migrations, segurança e impacto na interface.

## Fluxo operacional (A → G)

Para qualquer tarefa não trivial, siga as fases nesta ordem. Fases podem ser compactadas em
tarefas pequenas, mas **nunca puladas em silêncio** — se pular uma, diga qual e por quê.

### Fase A — Entendimento

1. Ler o `CLAUDE.md` da raiz e o do app envolvido.
2. Localizar a documentação relacionada em `docs/`.
3. Localizar o código relacionado: módulo backend, feature frontend, schema, testes.
4. Identificar os padrões já existentes (nomes, camadas, portas, guards, chaves de query).
5. Verificar alterações pendentes no Git e o que já está em andamento.
6. Identificar ator, objetivo, problema, fluxo principal e alternativos.
7. Registrar suposições explicitamente. Suposição não registrada vira bug.

**Nunca implemente antes de terminar a Fase A.** Ver `references/product-discovery.md`.

### Fase B — Contrato

Antes da interface final, definir:

- **Domínio**: entidades, value objects, agregados, invariantes, comandos, consultas, eventos,
  estados e transições, políticas, regras de autorização, requisitos de auditoria
  (`references/domain-modeling.md`, template `templates/domain-model.md`).
- **API**: operação, rota/procedure, método, autenticação, autorização, parâmetros, schema de
  entrada e saída, DTOs, paginação, filtros, ordenação, erros, idempotência, eventos, exemplos
  (`references/api-contracts.md`, template `templates/api-contract.md`).
- **Dados**: o que persiste, onde, com quais constraints (`references/database.md`).

Prefira **uma fonte única de verdade** para schemas/contratos, respeitando a arquitetura
existente. Onde o projeto ainda duplica tipos entre frontend e backend, a duplicação é uma
dívida conhecida: mantenha os dois lados sincronizados **na mesma fatia** e registre o risco.

### Fase C — Planejamento

Produza uma feature spec (`templates/feature-spec.md`) e um plano
(`templates/implementation-plan.md`) contendo: escopo, arquivos a criar/alterar, contratos,
banco, backend, frontend, segurança, testes, infraestrutura, rollout, rollback e pendências.
Identifique riscos antes de escrever código.

Para funcionalidade grande ou de risco, acione os subagentes de arquitetura
(`product-architect`, `software-architect`, `database-architect`) antes de implementar.

### Fase D — Implementação vertical

Implemente em **fatias verticais funcionais**, nesta ordem:

```
contrato → migration → repositório → serviço → endpoint → cliente HTTP → interface → testes → observabilidade
```

Uma fatia entregue e funcionando vale mais que dez telas desconectadas. Nunca implemente todas
as telas primeiro deixando a integração para o fim.

Referências por camada: `references/backend.md`, `references/database.md`,
`references/frontend.md`, `references/motion-design.md`, `references/integrations.md`,
`references/architecture.md`.

### Fase E — Revisão

Revisar arquitetura, segurança, QA, acessibilidade, desempenho e documentação. Use os
subagentes: `security-reviewer`, `qa-reviewer`, `frontend-architect`, `devops-reviewer`.
Achados de segurança vêm por severidade (`templates/security-review.md`).

### Fase F — Validação

Execute o que existe no projeto, na ordem, parando na primeira falha real:

```
formatação → lint → typecheck → testes unitários → testes de integração/e2e → build →
validação de migrations → contratos → autenticação → autorização → isolamento de tenant →
responsividade → acessibilidade → erros no console do navegador e do servidor
```

Atalho: `bash .claude/skills/product-engineering-studio/scripts/validate-project.sh`

**Regras absolutas da validação:**
- Não declare sucesso se build, lint, typecheck ou teste falharem — reporte a saída real.
- Não afirme que executou o que não executou. Se um comando não existe ou não pôde rodar
  (dependência ausente, sem rede, sem banco), diga isso explicitamente.
- Verifique se não sobrou mock, `TODO` de integração ou dado fixo no caminho de produção.

### Fase G — Relatório final

Sempre reporte, nesta estrutura:

1. **Plano** executado (e desvios em relação ao planejado)
2. **Decisões** tomadas e alternativas descartadas
3. **Arquivos** criados/alterados
4. **Contratos** definidos ou alterados
5. **Banco**: migrations, índices, constraints, RLS
6. **Backend**: services, regras, autorização, eventos
7. **Frontend**: rotas, componentes, estados cobertos, animações
8. **Segurança**: o que foi verificado e o que ficou aberto
9. **Testes**: executados (com resultado) vs. apenas recomendados
10. **Comandos executados** e sua saída resumida
11. **Limitações, pendências e riscos**

## Checklists por área

Consulte a referência antes de trabalhar na área correspondente:

| Área | Referência |
|---|---|
| Descoberta de produto | `references/product-discovery.md` |
| Arquitetura e fronteiras | `references/architecture.md` |
| Modelagem de domínio | `references/domain-modeling.md` |
| Frontend e estados de UI | `references/frontend.md` |
| Backend e serviços | `references/backend.md` |
| Banco e migrations | `references/database.md` |
| Contratos de API | `references/api-contracts.md` |
| Segurança | `references/security.md` |
| Testes | `references/testing.md` |
| Observabilidade | `references/observability.md` |
| Integrações externas | `references/integrations.md` |
| Infraestrutura e deploy | `references/infrastructure.md` |
| Animação e recursos gráficos | `references/motion-design.md` |

Templates preenchíveis em `templates/`. Documentos gerados vão para `docs/` (produto em
`docs/product/`, decisões em `docs/decisions/`, contratos em `docs/api/`, etc.).

## Adaptação por tipo de produto

O processo é o mesmo; a ênfase muda.

- **SaaS / admin / ERP / CRM / dashboard**: multi-tenancy, autorização, auditoria, densidade de
  informação, produtividade, atalhos, estados de tabela (filtro/ordenação/paginação/seleção em
  massa), animação curta e funcional.
- **Portal / área logada de cliente**: onboarding, permissões reduzidas, clareza acima de densidade.
- **Landing page / site institucional**: performance (LCP/CLS), SEO, acessibilidade, conteúdo
  real, formulário com destino real e proteção contra abuso. Animação pode ser expressiva —
  ainda assim respeita `prefers-reduced-motion`. **Nunca misture o site institucional com o
  aplicativo SaaS** (rotas, bundle, sessão e deploy separados).
- **API / integração / rotina assíncrona**: contrato versionado, idempotência, retry com backoff,
  deduplicação, dead-letter, reconciliação, observabilidade. Consumidor identificado antes de
  qualquer endpoint.
- **Módulo interno**: fronteira explícita, porta de comunicação, sem acoplamento a tabela alheia.

## Limites permanentes

Não fazer, sem pedido explícito:

- implementar antes de inspecionar;
- inventar funcionalidade, público ou propósito do produto;
- entregar dado fictício como solução final;
- duplicar tipos entre frontend e backend sem registrar a dívida;
- confiar no frontend para autorização, ou ignorar o isolamento de tenant;
- criar migration destrutiva silenciosa;
- instalar dependência desnecessária ou framework concorrente ao existente;
- espalhar regra de negócio pela interface, ou criar componentes gigantes;
- esconder falha de build/teste ou afirmar que testes passaram sem executá-los;
- fazer commit, push, deploy, tocar em produção, ou expor segredo;
- reescrever o projeto por preferência arquitetural.
