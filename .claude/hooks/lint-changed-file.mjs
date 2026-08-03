#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse (Write | Edit)
//
// Roda o ESLint APENAS no arquivo recém-editado. Bloqueia se houver erro;
// avisos passam (existe um baseline conhecido, ver o script `lint` de cada app).
//
// Só ficou possível em 02/08/2026, quando o projeto ganhou .eslintrc.cjs nos
// dois apps — antes disso o ESLint estava instalado mas sem configuração, e
// qualquer hook de lint falharia por config ausente, não por erro de código.
//
// Nunca usa --fix: um verificador não altera o que está verificando.
// Degrada em silêncio quando não há node_modules ou o arquivo está fora dos apps.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }

  const raw = payload?.tool_input?.file_path;
  if (typeof raw !== 'string' || !raw) process.exit(0);

  const filePath = resolve(raw);
  if (!/\.(ts|tsx)$/.test(filePath)) process.exit(0);
  if (!existsSync(filePath)) process.exit(0);

  // Descobre a qual app o arquivo pertence — o ESLint precisa rodar com o cwd
  // do app, senão não acha o .eslintrc.cjs nem os plugins.
  const normalized = filePath.replace(/\\/g, '/');
  const appDir = ['apps/api', 'apps/web']
    .map((a) => join(PROJECT_DIR, a))
    .find((dir) => normalized.startsWith(dir.replace(/\\/g, '/') + '/'));

  if (!appDir) process.exit(0);
  if (!existsSync(join(appDir, 'node_modules'))) process.exit(0);
  if (!existsSync(join(appDir, '.eslintrc.cjs'))) process.exit(0);

  // Migrations, dist e afins já estão em ignorePatterns; o ESLint avisa que o
  // arquivo foi ignorado, o que não é erro — --no-warn-ignored não existe no
  // ESLint 8, então tratamos a mensagem abaixo.
  let output = '';
  try {
    execFileSync(
      'npx',
      ['--no-install', 'eslint', '--format=stylish', '--no-error-on-unmatched-pattern', filePath],
      { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60_000 },
    );
    process.exit(0); // Sem erro de lint.
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    // npx/eslint indisponível ou arquivo ignorado: não é erro de código.
    if (!output || /--no-ignore|was ignored|Cannot find module|not found/i.test(output)) {
      process.exit(0);
    }
  }

  process.stderr.write(
    `[lint-changed-file] ESLint reprovou ${normalized.replace(PROJECT_DIR + '/', '')}:\n\n${output}\n\n` +
      'Corrija antes de continuar. Para o que for puramente mecânico, ' +
      `\`npm run lint:fix\` dentro de ${appDir.replace(PROJECT_DIR + '/', '')} resolve — ` +
      'mas revise o diff, porque --fix altera arquivos.\n',
  );
  process.exit(2);
}

main();
