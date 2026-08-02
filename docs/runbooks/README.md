# docs/runbooks

Procedimentos operacionais: o que fazer quando algo quebra, ou quando uma operação delicada
precisa ser executada.

## Quando escrever um runbook

- **Todo alerta novo nasce com um runbook.** Alerta que ninguém sabe o que fazer ao receber é
  ruído com atraso.
- Operação manual delicada e repetível: aplicar migration em produção, rotacionar credencial de
  integração, reprocessar sincronização, restaurar backup, reverter deploy.

## Estrutura de um runbook

```markdown
# <Nome do procedimento / alerta>

**Quando isto acontece:** sintoma observável, alerta disparado, mensagem exata.
**Impacto:** quem é afetado e quão grave é.
**Confirmar:** como verificar que é mesmo este caso (comando, log, consulta).
**Resolver:** passos numerados, com o comando exato de cada um.
**Verificar:** como saber que acabou.
**Escalar:** quando parar e chamar alguém, e quem.
**Causa raiz conhecida:** se houver, e o link para a correção definitiva.
```

## Regras

- Comando exato, copiável, com o ambiente explícito. Nada de "ajuste conforme necessário".
- Passo destrutivo vem marcado, com o rollback ao lado.
- Runbook desatualizado é pior que nenhum: revise depois de todo incidente que o usou.
- Nenhum segredo, token ou credencial dentro do runbook — só o nome da variável e onde obtê-la.

## Índice

*(vazio — o primeiro runbook entra aqui)*
