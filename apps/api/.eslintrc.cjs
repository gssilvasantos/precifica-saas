// Configuração do ESLint do backend. Criada em 02/08/2026 — até então o
// `eslint` estava nas devDependencies mas NÃO havia arquivo de configuração,
// então `npm run lint` falhava por falta de config, não por erro de código.
//
// Formato eslintrc (não flat config) porque o projeto usa ESLint 8.57.
//
// Escopo deliberadamente conservador: regras *recomendadas*, sem linting
// type-aware (`parserOptions.project`). Type-aware é mais poderoso, mas exige
// carregar o programa TypeScript inteiro a cada execução — em 642 arquivos
// isso torna o lint lento demais para rodar em hook ou em CI curto, e o
// typecheck (`tsc --noEmit`) já cobre a parte de tipos. Se um dia valer a pena,
// a mudança é habilitar `plugin:@typescript-eslint/recommended-requiring-type-checking`
// e apontar `project: './tsconfig.json'`.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
    es2022: true,
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '.buildlogs/',
    '*.js',
    '*.cjs',
    'prisma/migrations/',
  ],
  rules: {
    // --- Ajustes ao estilo real desta base de código -----------------------

    // NestJS usa decorators e injeção por construtor; parâmetros de
    // construtor "não usados" no corpo são a norma, não um erro.
    '@typescript-eslint/no-useless-constructor': 'off',

    // Aviso, não erro: `any` aparece em fronteiras de integração (respostas
    // cruas de marketplace) onde tipar de verdade é uma tarefa própria.
    // Marcado para ser reduzido, não tolerado em silêncio.
    '@typescript-eslint/no-explicit-any': 'warn',

    // Variável não usada é erro, exceto quando prefixada com _ (padrão para
    // "sei que não uso, está aqui por causa da assinatura").
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],

    // --- Regras que protegem invariantes deste projeto ---------------------

    // `catch` vazio engole falha de integração — o projeto exige AlertService.
    'no-empty': ['error', { allowEmptyCatch: false }],

    // `while (true)` com `break` é o padrão de paginação dos clientes de
    // marketplace (Mercado Livre, Nuvemshop): busca página, para quando a
    // resposta vem vazia ou o offset estoura. É idiomático e proposital —
    // a regra continua valendo para condição constante em `if`/ternário.
    'no-constant-condition': ['error', { checkLoops: false }],

    // Promise não aguardada em service/job é fonte de falha silenciosa.
    'no-async-promise-executor': 'error',
    'require-atomic-updates': 'warn',

    // console.log solto em produção. `console.warn`/`console.error` seguem
    // permitidos (usados por ConsoleAlertService e pelo bootstrap).
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // Comparação frouxa esconde bug com null/undefined vindo do banco.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  overrides: [
    {
      // Testes e scripts utilitários da raiz do app: console é legítimo.
      files: ['**/*.spec.ts', 'test/**/*.ts', 'prisma/**/*.ts'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
