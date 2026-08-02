# Regras — Frontend

> Carregadas via `apps/web/CLAUDE.md`. Aplicam-se a todo código em `apps/web/`.

## Componentes

- Reutilize antes de criar. Antes de escrever um componente, procure em `src/components/ui/`,
  `src/components/<área>/` e nas features existentes.
- Um componente tem **uma** responsabilidade. Página acima de ~250 linhas ou componente que
  acumula fetch + regra + layout deve ser dividido.
- Componente de apresentação recebe props e renderiza; não busca dados, não decide regra.
- Props explícitas e tipadas. Nada de `any`, nada de objeto "config" com dez campos opcionais.

## Separação de responsabilidades

- **Acesso a dados** vive em `features/<contexto>/api.ts`, usando o cliente HTTP compartilhado.
  Componente nunca chama `axios`/`fetch` direto.
- **Estado de servidor** é do cache de dados remotos (TanStack Query). Nunca copie resposta de
  API para `useState` via `useEffect`.
- **Estado local** é do componente. Contexto global só para o que é realmente global
  (sessão, tema, modo de operação).
- **Regra e derivação** ficam em funções puras, testáveis, fora do JSX.

## Estados completos

Toda operação implementa: inicial · carregando · sucesso · vazio · erro · validação ·
sem permissão · confirmação · atualizando · conflito · assíncrono · recuperação.

- Vazio de primeira vez ≠ vazio por filtro ≠ vazio por remoção: mensagens diferentes.
- Erro sempre oferece um próximo passo (tentar de novo, corrigir, contatar).
- Ação destrutiva ou irreversível exige confirmação específica (diga **o que** será excluído).

## Contratos reais

- Os tipos em `features/*/api.ts` são cópia manual dos DTOs do backend. **Mudou o DTO, atualize o
  tipo na mesma fatia** — o compilador não avisa e a falha aparece só em produção.
- Nunca "conserte" divergência de contrato com `as any`, `?.` em cascata ou valor default no
  cliente. Corrija o contrato.
- Campo que a UI precisa e o contrato não tem é mudança de contrato, não transformação local.

## Proibições

- **Mock permanente**: dado fixo, `TODO: conectar API`, ou array literal simulando resposta no
  caminho de produção. Dado de demonstração só dentro da funcionalidade de demonstração do produto.
- **Autorização no cliente** como única barreira. Esconder botão é UX; a negativa vem do servidor
  e o 403 precisa ser tratado.
- Segunda biblioteca de componentes, de estado, de estilo ou de requisição.
- Cor, sombra, raio, fonte ou espaçamento fora dos tokens do projeto.
- Instalação de biblioteca (animação, gráfico, validação, datas) sem aprovação explícita.

## Acessibilidade

- Operável por teclado, ordem de foco correta, foco visível.
- HTML semântico primeiro; ARIA só quando não houver elemento nativo.
- Label real em todo campo; erro associado ao campo.
- Contraste AA nos **dois** temas (claro e escuro).
- Nada comunicado apenas por cor.
- Modal/drawer: foco preso, Esc fecha, foco volta ao gatilho.

## Responsividade

- Layout funciona de ~360 px até telas largas. Tabela densa tem estratégia definida em telas
  pequenas (scroll horizontal, cartão, ou colunas prioritárias) — nunca quebra silenciosa.
- Alvo de toque mínimo confortável; nada de ação crítica dependendo de hover.

## Animação

- Só com propósito: orientação, continuidade, feedback ou atenção pontual.
- Rápida em ferramenta de uso diário (100–300 ms), em `transform`/`opacity`.
- `prefers-reduced-motion` é obrigatório — substitua a animação, não apenas a acelere.
- Use o que o projeto já tem (CSS + utilitários do Tailwind). Nada de nova dependência sem aprovação.

## Desempenho

- Code splitting por rota. Nada de carregar o app inteiro na tela de login.
- Imagem com dimensão declarada; sem layout shift.
- Lista longa é paginada pelo servidor; virtualização só quando medida for necessária.
