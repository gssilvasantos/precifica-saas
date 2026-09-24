# Contratos de API

O contrato vem **antes** da interface final. Ele é o acordo entre quem produz e quem consome.

## Checklist por operação

- [ ] **Operação**: nome de negócio (`Listar pedidos do canal`), não `getOrders2`
- [ ] **Rota/procedure** e **método** — REST semântico ou RPC explícito, consistente com o projeto
- [ ] **Autenticação**: obrigatória? qual mecanismo? o que acontece sem token/expirado?
- [ ] **Autorização**: papel, permissão de módulo, propriedade do recurso, escopo de tenant
- [ ] **Parâmetros**: path, query, header — tipos, obrigatoriedade, valores default
- [ ] **Schema de entrada**: tipos, formatos, limites de tamanho, campos desconhecidos rejeitados
- [ ] **Schema de saída**: forma estável, sem vazar campo interno ou de outro tenant
- [ ] **Paginação**: estratégia (offset/cursor), limite máximo, formato do envelope
- [ ] **Filtros e ordenação**: campos permitidos (lista fechada — nunca ordenar por string livre)
- [ ] **Erros**: catálogo por código, com significado, status HTTP e mensagem segura
- [ ] **Idempotência**: a operação pode ser repetida? com qual chave?
- [ ] **Eventos** emitidos como consequência
- [ ] **Exemplos** de requisição e resposta, incluindo pelo menos um caso de erro

## Fonte única de verdade

Preferência, em ordem:

1. Um schema declarado uma vez, do qual saem validação em runtime e tipos estáticos dos dois lados.
2. Um pacote/módulo de tipos compartilhado, gerado a partir do backend.
3. Cópia manual sincronizada **na mesma fatia** de trabalho — aceitável apenas como dívida
   registrada, nunca como escolha nova de arquitetura.

Quando o projeto está no nível 3, a regra prática é: **mudou o DTO no backend, atualize o tipo
do cliente no mesmo commit**, e cite isso no relatório final. O compilador não vai te salvar.

## Erros

Padronize um envelope de erro: código estável (para o cliente decidir comportamento), mensagem
para humano, e detalhes de validação por campo. Regras:

- Mensagem de erro nunca contém stack trace, SQL, credencial, ou dado de outro tenant.
- Falha de autorização e recurso inexistente devem ser indistinguíveis quando revelar a
  existência do recurso já é vazamento.
- Erro de validação retorna **todos** os campos inválidos, não só o primeiro.
- Todo erro que o frontend precisa tratar de forma diferente tem código próprio.

## Paginação

- Defina limite máximo por página e aplique no servidor (cliente não escolhe `limit=100000`).
- Sempre retorne o suficiente para o cliente saber se há próxima página.
- Cursor é preferível quando os dados mudam durante a navegação; offset é aceitável em listas
  administrativas estáveis.
- Contagem total é cara em tabela grande — decida se é necessária.

## Idempotência

Obrigatória em: operação disparada por webhook, retry automático, ação de pagamento/estoque, e
qualquer POST que o usuário possa duplicar por clique. Implemente com chave de idempotência
persistida ou com unicidade natural no banco (`@@unique` na referência externa).

## Versionamento e compatibilidade

Mudança compatível: adicionar campo opcional, adicionar valor de enum que o cliente ignora.
Mudança incompatível: remover/renomear campo, tornar campo obrigatório, mudar tipo ou semântica,
restringir intervalo aceito. Incompatível exige nova versão ou expand→migrate→contract.

## Saída da fase

Preencha `templates/api-contract.md`. Contratos de módulos relevantes ficam em `docs/api/`.
