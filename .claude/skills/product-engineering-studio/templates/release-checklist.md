# Checklist de release — <funcionalidade / versão>

| | |
|---|---|
| **Data** | AAAA-MM-DD |
| **Escopo** | |
| **Responsável** | |

> Marque apenas o que **foi executado**. Item não executado fica desmarcado com a justificativa
> ao lado — nunca marcado "por presunção".

## Contratos

- [ ] Operações novas/alteradas documentadas
- [ ] Compatibilidade avaliada (retrocompatível? exige versão?)
- [ ] Tipos do cliente sincronizados com o backend no mesmo commit
- [ ] Consumidores identificados e avisados

## Banco

- [ ] Migrations revisadas (diff, não só o arquivo final)
- [ ] Nenhuma operação destrutiva não declarada
- [ ] Backfill idempotente e com custo estimado
- [ ] Rollback escrito (ou irreversibilidade declarada)
- [ ] Artefatos complementares aplicados (isolamento de tenant, grants, índices)
- [ ] Aplicada com sucesso em banco descartável

## Qualidade

- [ ] Formatação — comando: ______ · resultado: ______
- [ ] Lint — comando: ______ · resultado: ______
- [ ] Typecheck — comando: ______ · resultado: ______
- [ ] Testes unitários — comando: ______ · resultado: ______
- [ ] Testes de integração/e2e — comando: ______ · resultado: ______
- [ ] Build — comando: ______ · resultado: ______

## Segurança

- [ ] Revisão de segurança do escopo (`security-review.md`)
- [ ] Autorização testada, inclusive o caso negativo
- [ ] Isolamento entre tenants testado
- [ ] Nenhum segredo em código, log ou documentação
- [ ] Variáveis novas documentadas no arquivo de exemplo

## Observabilidade

- [ ] Log estruturado nos caminhos novos
- [ ] Alerta em falha de integração/job
- [ ] Runbook criado/atualizado para alertas novos

## Documentação

- [ ] `CLAUDE.md` atualizado se comandos/arquitetura mudaram
- [ ] Documento de arquitetura do módulo atualizado
- [ ] ADR aberto para decisões relevantes
- [ ] Limitações e pendências registradas

## Deploy

- [ ] Ordem definida (migration antes do código novo, compatível com o código antigo)
- [ ] Variáveis de ambiente configuradas no destino
- [ ] Feature flag definida (se aplicável), com dono e data de remoção
- [ ] Janela e comunicação combinadas

## Rollback

- [ ] Procedimento escrito e viável
- [ ] Ponto de não retorno identificado

## Validação pós-deploy

- [ ] Fluxo principal exercitado em produção
- [ ] Logs e alertas sem erro novo
- [ ] Métrica de saúde estável
- [ ] Pendências abertas registradas
