# Frontend

A interface é construída a partir dos **contratos e fluxos reais**, nunca de um layout imaginado
primeiro e integrado depois.

## Estados obrigatórios de toda operação

Para cada tela/ação, decida e implemente:

| Estado | Pergunta |
|---|---|
| Inicial | O que aparece antes de qualquer dado? |
| Carregando | Skeleton (preferido) ou spinner? Bloqueia a tela ou só a região? |
| Sucesso | Como o usuário sabe que funcionou? |
| Vazio | Primeira vez ≠ filtro sem resultado ≠ dado removido — mensagens diferentes |
| Erro | Recuperável? Como tentar de novo? Mensagem em linguagem de usuário |
| Validação | Por campo, no blur/submit, com texto que diz como corrigir |
| Sem permissão | Esconder, desabilitar com motivo, ou mostrar 403? Sempre tratar a resposta do servidor |
| Confirmação | Ação destrutiva/irreversível exige confirmação explícita e específica |
| Atualizando | Mutação em andamento: botão desabilitado, feedback otimista só se reversível |
| Conflito | Alguém alterou o mesmo recurso — mostrar, não sobrescrever calado |
| Assíncrono | Job/processo longo: progresso, resultado, e o que fazer se falhar |
| Recuperação | Retry, refetch, voltar ao estado anterior |

Uma tela sem estado vazio e sem estado de erro **não está pronta**.

## Separação de responsabilidades

```
apresentação   componente que recebe props e renderiza — sem fetch, sem regra
domínio        funções puras de cálculo/formatação/derivação de estado
acesso a dados uma camada por contexto, encapsulando o cliente HTTP e os tipos do contrato
estado local   useState/useReducer para o que é da tela
estado servidor cache de dados remotos (React Query e similares) — nunca duplicado em useState
formulários    controle + validação declarativa, mensagens por campo
navegação      rotas declarativas, parâmetros tipados, guarda de rota
```

Sinais de que a separação quebrou: componente com mais de uma responsabilidade; `useEffect`
sincronizando cache remoto para `useState`; regra de negócio dentro do JSX; página com centenas
de linhas.

## Formulários

- Validação no cliente é para **UX**; a autoridade é o backend. Espelhe as regras, não as substitua.
- Mostre erro depois da primeira interação, não enquanto o usuário digita o primeiro caractere.
- Erros do servidor por campo devem ser mapeados de volta aos campos.
- Estado do formulário sobrevive a erro de submit — nunca limpe o que o usuário digitou.
- Campo de valor monetário, percentual e documento: componente próprio, com máscara e parsing
  consistentes; nunca `parseFloat` espalhado.

## Listas e tabelas (produto administrativo)

- Paginação vinda do servidor, com limite máximo respeitado.
- Filtro e ordenação refletidos na URL (compartilhável, sobrevive a refresh).
- Seleção em massa exige contagem visível e confirmação para ação destrutiva.
- Colunas densas mas legíveis: alinhe número à direita, use tabular numbers, evite truncar
  identificadores.
- Linha clicável tem também um alvo acessível por teclado.

## Design de produto

Para SaaS/admin, priorize nesta ordem: **clareza → produtividade → consistência → estética**.

- Densidade equilibrada: informação suficiente sem ruído; agrupamento visual claro.
- Navegação previsível: mesma ação no mesmo lugar em todas as telas.
- Atalhos onde há uso repetitivo (busca, salvar, fechar modal com Esc).
- Hierarquia tipográfica consistente; espaçamento em escala; contraste que passa em AA.
- Use o design system do projeto. Não introduza cor, sombra, raio ou fonte fora dos tokens.
- Evite aparência genérica de template: refinamento vem de espaçamento, hierarquia e detalhe de
  estado (hover, foco, seleção, disabled), não de efeito visual chamativo.

## Acessibilidade

- Todo controle é operável por teclado, na ordem correta, com foco visível.
- HTML semântico primeiro; ARIA só quando não houver elemento nativo.
- Label real em todo campo; erro associado ao campo (`aria-describedby`).
- Contraste mínimo AA nos dois temas (claro e escuro).
- Nada comunicado só por cor.
- Modal/drawer: foco preso dentro, retorno ao gatilho ao fechar, fecha com Esc.
- Respeite `prefers-reduced-motion` — ver `motion-design.md`.

## Desempenho

- Code splitting por rota; não carregue o app inteiro na tela de login.
- Não instale biblioteca pesada por conveniência de um único componente.
- Evite re-render em cascata: memoize o que é caro, estabilize props de callback.
- Imagem com dimensão declarada (evita layout shift) e formato adequado.
- Meça antes de otimizar; registre o número no relatório.

## Proibições

- Mock permanente ou dado fixo no caminho de produção.
- `fetch`/`axios` chamado direto de dentro de componente.
- Autorização decidida no cliente como única barreira.
- Componente "faz-tudo" que cresce a cada funcionalidade.
- Tipo de contrato divergindo do backend sem registro da dívida.
