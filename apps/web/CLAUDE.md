# apps/web — contexto de escopo (frontend)

Complementa o `CLAUDE.md` da raiz. Carregado quando você trabalha em arquivos deste app.

## Organização

```
src/routes/            páginas + AppLayout + ProtectedRoute (uma rota = uma página)
src/features/<ctx>/    api.ts (chamadas + tipos do contrato) + components/ + lógica do contexto
src/components/ui/     design system (shadcn/ui copiado para o repo — Radix + Tailwind)
src/components/<área>/ componentes compostos específicos (dashboard, orders, insights)
src/lib/               api-client.ts, utils.ts, module-codes.ts, retry.ts, extract-error-message.ts
src/styles/index.css   tokens CSS + camadas Tailwind
```

`features/<ctx>` espelha o bounded context do backend. Um componente de uma feature não importa
de outra feature — se precisar, o pedaço comum sobe para `components/` ou `lib/`.

## Regras não negociáveis deste app

- **Acesso a dados só pelo `apiClient`** (`lib/api-client.ts`), sempre encapsulado em
  `features/<ctx>/api.ts`. Componente nunca chama `axios`/`fetch` direto.
- **Server state é do TanStack Query**, não de `useState`/Context. Chaves de query estáveis e
  hierárquicas; invalidação explícita após mutação.
- **Os tipos de `features/*/api.ts` são a cópia manual do contrato do backend.** Ao mudar um DTO
  no backend, atualize o tipo aqui na mesma fatia — o compilador **não** vai avisar.
  Divergência aqui é bug de runtime em produção.
- **Toda operação cobre os estados**: inicial, carregando, sucesso, vazio, erro, validação,
  sem permissão, confirmação (para ação destrutiva), atualizando, conflito, offline/retry.
  Use `Skeleton` para carregamento e `extract-error-message.ts` para erro.
- **Permissão no cliente é UX, não segurança.** `module-codes.ts` esconde/desabilita item de
  menu; a negativa real vem do `ModuleAccessGuard` no backend e precisa ser tratada (403).
- **Design system primeiro**: use `components/ui/*` e os tokens da paleta Kyneti
  (`tailwind.config.js`). Não introduza cor solta, nem outra biblioteca de componentes.
- **Dark mode é o padrão da marca** e funciona por classe `.dark` — todo componente novo precisa
  ficar correto nos dois temas.
- **Animação**: hoje só `tailwindcss-animate` + CSS. Não instale lib de motion sem tarefa
  explícita. Toda animação respeita `prefers-reduced-motion` e serve a um propósito
  (orientação, continuidade, feedback) — nunca decoração em tela de uso diário.
- **Sem mock permanente.** Dado fixo só é aceitável dentro do Audit Mode / seed de demonstração,
  que é uma funcionalidade do produto — nunca como substituto de integração não terminada.
- **Componente grande é bug de arquitetura**: extraia quando a página passar de ~250 linhas ou
  acumular mais de uma responsabilidade.

## Comandos

```bash
npm run dev                # http://localhost:5173 (proxy /api -> :3000)
npm run build              # tsc -b && vite build
npm run typecheck          # tsc -b — NÃO use --noEmit: o tsconfig usa project
                           # references e o TS rejeita com TS6310
npm run lint               # ESLint (--max-warnings=3 = baseline conhecido)
npm run lint:fix           # ALTERA arquivos — revise o diff
```

Não há testes nem runner configurado neste app — não afirme que testou a UI automaticamente.

O ESLint aqui barra `import axios` fora de `src/lib/` (acesso a dados passa pelo `apiClient`),
e `exhaustive-deps` é aviso, não erro: as 3 ocorrências atuais exigem mudança de comportamento
para resolver, não conserto mecânico. Ver `docs/decisions/0002-configuracao-do-eslint.md`.

## Regras carregadas neste escopo

@../../.claude/rules/frontend.md
