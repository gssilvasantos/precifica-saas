#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse (Write | Edit)
//
// Roda o ESLint APENAS no arquivo recém-editado.
//
// Implementa o contrato de três estados do MPES (D1):
//   1. verificado e aprovado  -> silêncio
//   2. verificado e reprovado -> avisa (MODO='aviso') ou bloqueia (MODO='bloqueio')
//   3. NÃO foi possível verificar -> systemMessage + additionalContext, NUNCA silêncio
//
// Correção do achado F01 (03/08/2026): a versão anterior chamava `npx` via
// execFileSync sem shell. No Windows `npx` é um shim .cmd, não um executável:
// o spawn falhava com ENOENT, err.stdout/err.stderr vinham `undefined`, e o
// hook saía com exit 0 SILENCIOSO. Na prática o lint nunca rodou nesta máquina.
//
// A estratégia agora é a oficial: invocar o script do ESLint com `node`
// diretamente. `node` é um executável real em todo sistema operacional, então
// não há shim, não há shell, e caminhos com espaço ou parênteses não quebram.
//
// Nunca usa --fix: um verificador não altera o que está verificando.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';

const HOOK = 'lint-changed-file';

// 'aviso'    = fase 1: reprovação vira aviso, não bloqueia (rollout controlado)
// 'bloqueio' = fase 2: reprovação bloqueia com exit 2
// Trocar esta linha é a única mudança necessária entre as duas fases.
const MODO = 'aviso';

/** Estado 3: não foi possível verificar. Avisa o usuário e informa o agente. */
function naoVerificavel(motivo, comoRestaurar) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `[${HOOK}] ESTADO 3 — não foi possível verificar: ${motivo}. ${comoRestaurar}`,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `[${HOOK}] ESTADO 3 — o lint NÃO foi executado neste arquivo: ${motivo}. ` +
          `${comoRestaurar} Não trate este arquivo como verificado.`,
      },
    }),
  );
  process.exit(0);
}

/** N/A ou estado 1: silêncio é correto. */
function silencio() {
  process.exit(0);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Sobe a partir do arquivo até achar a raiz que contém `apps/`. */
function acharRaiz(caminhoArquivo) {
  let dir = dirname(caminhoArquivo);
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(join(dir, 'apps'))) return dir;
    const pai = dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
  return null;
}

function main() {
  const bruto = readStdin();
  let payload;
  try {
    payload = JSON.parse(bruto);
  } catch {
    // Entrada malformada: o hook foi chamado e não conseguiu sequer ler o pedido.
    naoVerificavel(
      'a entrada recebida não é um JSON válido',
      'Verifique a configuração do hook em .claude/settings.json.',
    );
  }

  const bruto_path = payload?.tool_input?.file_path;
  if (typeof bruto_path !== 'string' || !bruto_path) silencio(); // N/A: sem arquivo

  const filePath = resolve(bruto_path);
  if (!/\.(ts|tsx)$/.test(filePath)) silencio(); // N/A: o ESLint daqui só cobre TS

  if (!existsSync(filePath)) {
    naoVerificavel(
      `o arquivo ${filePath} não existe mais`,
      'Se ele foi removido de propósito, ignore este aviso.',
    );
  }

  const raiz = acharRaiz(filePath);
  if (!raiz) {
    naoVerificavel(
      'não foi possível localizar a raiz do repositório (nenhum diretório apps/ acima do arquivo)',
      'Este hook espera a estrutura <raiz>/apps/<app>/.',
    );
  }

  // A qual app o arquivo pertence? O ESLint precisa rodar com o cwd do app.
  const prefixo = (d) => d.endsWith(sep) ? d : d + sep;
  const appDir = ['apps/api', 'apps/web']
    .map((a) => join(raiz, a))
    .find((dir) => filePath.startsWith(prefixo(dir)));

  // Arquivo .ts fora de apps/: fora do escopo de lint deste projeto. N/A legítimo.
  if (!appDir) silencio();

  if (!existsSync(join(appDir, '.eslintrc.cjs'))) {
    naoVerificavel(
      `${appDir} não tem .eslintrc.cjs`,
      'Sem configuração o ESLint falharia por config ausente, não por erro de código.',
    );
  }

  // Estratégia oficial: `node <script>` — sem npx, sem shell, sem shim .cmd.
  const eslintJs = join(appDir, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(eslintJs)) {
    naoVerificavel(
      `o ESLint não está instalado em ${appDir}`,
      `Rode 'npm install' dentro de ${appDir} para restaurar a verificação.`,
    );
  }

  const r = spawnSync(
    process.execPath,
    [eslintJs, '--format=stylish', '--no-error-on-unmatched-pattern', filePath],
    { cwd: appDir, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Falha de spawn (binário some, timeout, sinal): estado 3, jamais aprovação.
  if (r.error || r.status === null) {
    naoVerificavel(
      `o ESLint não pôde ser executado (${r.error?.code ?? 'encerrado por sinal ou timeout'})`,
      `Verifique a instalação em ${appDir}.`,
    );
  }

  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();

  // 0 = limpo. 1 = erros de lint. Qualquer outro = falha do próprio ESLint.
  if (r.status === 0) silencio(); // ESTADO 1

  if (r.status !== 1) {
    naoVerificavel(
      `o ESLint terminou com código ${r.status} (falha da ferramenta, não do código)`,
      saida ? `Saída: ${saida.slice(0, 400)}` : 'Sem saída.',
    );
  }

  // ESTADO 2 — verificado e reprovado.
  const arquivoCurto = filePath.startsWith(raiz) ? filePath.slice(raiz.length + 1) : filePath;
  const appCurto = appDir.startsWith(raiz) ? appDir.slice(raiz.length + 1) : appDir;

  if (MODO === 'aviso') {
    process.stdout.write(
      JSON.stringify({
        systemMessage: `[${HOOK}] ESTADO 2 — ESLint reprovou ${arquivoCurto} (fase de aviso, não bloqueado).`,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `[${HOOK}] ESTADO 2 — o ESLint reprovou ${arquivoCurto}:\n\n${saida}\n\n` +
            `O hook está em FASE DE AVISO e não bloqueou. Corrija mesmo assim. ` +
            `Para o que for mecânico, 'npm run lint:fix' dentro de ${appCurto} resolve — revise o diff.`,
        },
      }),
    );
    process.exit(0);
  }

  process.stderr.write(
    `[${HOOK}] ESLint reprovou ${arquivoCurto}:\n\n${saida}\n\n` +
      `Corrija antes de continuar. Para o que for puramente mecânico, ` +
      `'npm run lint:fix' dentro de ${appCurto} resolve — mas revise o diff, porque --fix altera arquivos.\n`,
  );
  process.exit(2);
}

main();
