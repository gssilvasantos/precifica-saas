# Descoberta de produto

Objetivo: entender o que precisa ser construído **antes** de decidir como. Nenhuma linha de
código antes de conseguir responder às perguntas abaixo — ou registrar explicitamente que a
resposta é uma suposição.

## Perguntas obrigatórias

| Dimensão | Pergunta |
|---|---|
| Ator | Quem executa? Que papel/permissão tem? É usuário final, operador interno, sistema externo ou job? |
| Objetivo | O que essa pessoa quer alcançar? Em quanto tempo? Com que frequência? |
| Problema | O que dói hoje? Qual o custo de não resolver? Existe workaround em uso? |
| Fluxo principal | Passo a passo do caminho feliz, do gatilho ao feedback final. |
| Fluxos alternativos | Erro, dado ausente, permissão negada, conflito, cancelamento, retomada, offline. |
| Regras de negócio | O que é sempre verdade? O que é proibido? Quem pode quebrar a regra e como? |
| Estados | Quais estados a entidade assume? Quais transições existem? Quais são irreversíveis? |
| Permissões | Quem vê? Quem cria? Quem edita? Quem aprova? Quem exclui? Quem audita? |
| Integrações | Algum sistema externo é fonte da verdade, destino ou gatilho? |
| Dados | O que é criado, lido, alterado, arquivado? O que é sensível? Quanto cresce por mês? |
| Critérios de aceite | Como saber que está pronto? Enunciados verificáveis, não adjetivos. |
| Riscos | O que pode dar errado em produção? O que é irreversível? |
| Métricas | O que mede sucesso? Onde esse número seria lido? |

## Onde procurar as respostas

1. `CLAUDE.md` (raiz e do app).
2. `docs/` — arquitetura por módulo, decisões, benchmarks.
3. Código existente de módulos análogos — a resposta muitas vezes já está implementada em
   outro contexto e deve ser imitada, não reinventada.
4. Migrations e schema — revelam o modelo real, inclusive o que a documentação não conta.
5. O pedido do usuário. Quando o pedido contradiz o repositório, **assinale a contradição**
   em vez de escolher silenciosamente.

## Regras

- **Não invente funcionalidade, público ou propósito.** Quando não houver base, escreva
  "a definir" e siga.
- **Corrija premissas falsas explicitamente.** Se o pedido assume algo que não existe no
  código ("o sistema de auditoria existente…"), diga que não existe antes de construir.
- Prefira **uma fatia estreita e completa** a uma fatia larga e pela metade. Negocie escopo
  cortando funcionalidade, nunca cortando qualidade de fronteira (validação, autorização,
  isolamento de tenant, erro).
- Escopo fora é tão importante quanto escopo dentro: liste "fora do escopo" na spec.

## Saída da fase

Preencha `templates/feature-spec.md` e salve em `docs/product/<slug>.md`. Para produto novo ou
mudança relevante de rumo, abra também um ADR (`templates/adr.md` → `docs/decisions/`).
