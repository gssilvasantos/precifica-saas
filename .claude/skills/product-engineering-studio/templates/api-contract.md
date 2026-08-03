# Contrato — <nome da operação>

> Salvar em `docs/api/<modulo>.md` (uma seção por operação).

| | |
|---|---|
| **Operação** | |
| **Módulo** | |
| **Rota / procedure** | |
| **Método** | |
| **Autenticação** | obrigatória / opcional / nenhuma — mecanismo |
| **Autorização** | papel · permissão de módulo · propriedade do recurso · escopo de tenant |
| **Idempotente** | sim / não — chave usada |
| **Status** | proposto / implementado / descontinuado |

## Parâmetros

| Local | Nome | Tipo | Obrigatório | Default | Regras |
|---|---|---|---|---|---|
| path | | | | | |
| query | | | | | |

## Request

```jsonc
{
}
```

| Campo | Tipo | Obrigatório | Validação |
|---|---|---|---|
| | | | |

Campos desconhecidos são rejeitados. Limites de tamanho: ...

## Response (sucesso)

Status: `200` / `201`

```jsonc
{
}
```

| Campo | Tipo | Observação |
|---|---|---|
| | | |

## Paginação

Estratégia (offset/cursor) · parâmetros · limite máximo · envelope de resposta.

## Filtros e ordenação

Campos permitidos (lista fechada) e direções aceitas.

## Erros

| Status | Código | Quando | Mensagem ao usuário |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Entrada inválida | Lista de campos |
| 401 | | | |
| 403 | | | |
| 404 | | | |
| 409 | | | |
| 422 | | | |
| 429 | | | |

## Eventos emitidos

| Evento | Quando | Consumidores |
|---|---|---|

## Exemplos

**Sucesso**

```bash
curl -X POST https://<host>/api/... \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ }'
```

**Erro**

```jsonc
{
}
```

## Sincronização de tipos

Onde o tipo vive no backend e onde vive no cliente. Se houver duplicação manual, registre aqui —
os dois lados mudam no mesmo commit.
