# Modelagem de domínio

## Elementos

| Elemento | Definição prática | Teste rápido |
|---|---|---|
| **Entidade** | Tem identidade própria e ciclo de vida | Dois objetos com os mesmos campos são a mesma coisa? Se não, é entidade |
| **Value object** | Definido pelos valores, imutável | Dinheiro, peso, percentual, período, e-mail, documento |
| **Agregado** | Grupo alterado sob a mesma invariante, com uma raiz | Consigo escrever a invariante que só é verificável olhando o grupo inteiro? |
| **Comando** | Intenção de mudar estado | Nome no imperativo: `AprovarPedido`, `ReprecificarSku` |
| **Consulta** | Leitura sem efeito colateral | Pode ser cacheada sem alterar comportamento? |
| **Evento** | Fato consumado, no passado | `PedidoAprovado`, `PrecoAtualizado` |
| **Política** | "Quando X acontece, faça Y" | Liga evento a comando |

## Invariantes

Escreva as invariantes como frases verificáveis, **antes** de modelar tabelas:

- "Margem mínima nunca é maior que a margem desejada."
- "Preço publicado nunca fica abaixo do preço mínimo anunciado."
- "Movimentação de estoque só existe com evento de auditoria aprovado."

Depois decida **onde cada invariante é garantida**:

1. **Domínio** (sempre) — a regra vive em código testável sem banco.
2. **Banco** (quando o custo de violação é alto) — constraint, unique, check, FK.
3. **Fronteira** (sempre) — validação de entrada rejeita o que nem chega ao domínio.

Invariante garantida só na UI não é garantida.

## Estados e transições

Modele máquina de estados explícita quando houver mais de dois estados:

```
RASCUNHO → PENDENTE → APROVADO → CONCLUÍDO
              ↓           ↓
          REJEITADO   CANCELADO
```

Para cada transição, defina: quem pode executar, quais pré-condições, quais efeitos colaterais
(evento, integração, auditoria), e se é reversível. Transição inválida deve falhar com erro
específico, não silenciosamente.

## Autorização como parte do domínio

Regras do tipo "só o dono da conta pode alterar margem mínima" ou "vendedor só vê os próprios
pedidos" são **regra de domínio**, não detalhe de controller. Modele explicitamente:
sujeito (quem), ação (o quê), recurso (sobre o quê), condição (quando).

## Auditoria

Decida, por entidade: precisa de histórico de quem-mudou-o-quê-quando? Se sim, isso é uma
decisão de modelo (tabela de eventos/log dedicada), não um `console.log`. Escopo de auditoria
deve ser explícito — audite campos de governança e ações irreversíveis, não tudo por reflexo.

## Nomes

Use a linguagem do negócio, em um único idioma por camada, consistente com o resto do
repositório. Se o código existente usa um termo, não introduza sinônimo — renomeie tudo ou
mantenha tudo.

## Saída da fase

Preencha `templates/domain-model.md`. Para domínio complexo, salve em
`docs/architecture/<modulo>-domain.md` e referencie na spec.
