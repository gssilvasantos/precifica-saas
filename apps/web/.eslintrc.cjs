// Configuração do ESLint do frontend. Criada em 02/08/2026 — até então o
// `eslint` e os plugins react-hooks/react-refresh estavam nas devDependencies
// mas NÃO havia arquivo de configuração, então `npm run lint` falhava por falta
// de config, não por erro de código.
//
// Formato eslintrc (não flat config) porque o projeto usa ESLint 8.57.
// Extensão .cjs é obrigatória: o package.json deste app declara "type": "module".
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  env: {
    browser: true,
    es2022: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '*.cjs', 'vite.config.d.ts'],
  settings: {
    react: { version: '18.3' },
  },
  rules: {
    // Fast Refresh do Vite só funciona se o módulo exportar componentes.
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

    // Dependências de useEffect/useMemo/useCallback são a origem mais comum de
    // bug sutil de estado. Fica em 'warn' (o padrão do próprio plugin) porque
    // as 3 ocorrências existentes hoje exigem mudança de comportamento para
    // resolver — não é conserto mecânico, e "corrigir" adicionando dependência
    // sem entender o caso pode introduzir loop de render. Elas estão listadas
    // como pendência; quando forem tratadas, suba para 'error'.
    'react-hooks/exhaustive-deps': 'warn',

    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],

    // --- Regras que protegem invariantes deste projeto ---------------------

    // Componente nunca fala HTTP direto: acesso a dados vive em
    // features/<contexto>/api.ts, usando o apiClient compartilhado
    // (ver .claude/rules/frontend.md). `fetch` cru também é barrado.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'axios',
            message:
              'Não importe axios direto. Use o apiClient de src/lib/api-client.ts, ' +
              'chamado a partir de features/<contexto>/api.ts.',
          },
        ],
      },
    ],

    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  overrides: [
    {
      // Arquivos de contexto exportam o Provider (componente) E o hook de
      // consumo (useAuth/useTheme/useAppMode) — padrão deliberado do projeto,
      // e o que a documentação do React recomenda para colocalizar contexto e
      // acesso. O custo é perder Fast Refresh nesses 3 arquivos, o que é
      // aceitável: eles quase nunca mudam. Não é dívida a pagar.
      files: ['src/features/*/*-context.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
    {
      // Componentes shadcn/ui exportam o componente E as variantes de `cva`
      // (buttonVariants, badgeVariants) — é assim que o shadcn/ui é publicado
      // upstream, e o projeto copiou os componentes para dentro do repo
      // exatamente para preservar esse formato. Mesmo raciocínio dos contextos.
      files: ['src/components/ui/*.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
    {
      // src/lib/ é a camada de infraestrutura HTTP compartilhada — é ela quem
      // PODE falar com o axios: api-client.ts (instância + interceptor de
      // Bearer) e extract-error-message.ts (isAxiosError, type guard).
      // A restrição continua valendo para routes/ e features/.
      files: ['src/lib/**/*.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
