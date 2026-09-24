#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse (Write | Edit)
//
// Varre APENAS o arquivo recém-escrito em busca de segredo aparente
// (chave de API, token, chave privada, senha embutida, connection string
// com credencial). Se encontrar, bloqueia e explica — o agente precisa
// corrigir antes de seguir.
//
// Rápido de propósito: um arquivo, por regex, sem dependência e sem rede.
// Nunca modifica o arquivo. Nunca imprime o valor encontrado.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from 'node:fs';

const MAX_BYTES = 512 * 1024; // arquivo maior que isso não é código-fonte típico

// Arquivos onde placeholders são esperados e não devem gerar ruído.
const ALLOWLIST = [
  /\.env\.example$/,
  /(^|\/)\.claude\/hooks\//,
  /(^|\/)docs\//,
  /\.md$/,
  /package-lock\.json$/,
];

/** @type {{name: string, rule: RegExp}[]} */
const PATTERNS = [
  { name: 'chave privada (PEM)', rule: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/ },
  { name: 'chave de API da Anthropic', rule: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'chave de API da OpenAI', rule: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'token do GitHub', rule: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'chave de acesso da AWS', rule: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'chave de serviço do Google', rule: /"type"\s*:\s*"service_account"/ },
  { name: 'JWT com payload', rule: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'token do Slack', rule: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'chave do Stripe', rule: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    name: 'connection string com credencial',
    rule: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:'"@]+:[^\s:'"@]+@/,
  },
  {
    name: 'segredo atribuído em código',
    // Atribuição literal a nome de variável sensível, com valor longo o bastante
    // para não ser placeholder. Ignora process.env, import.meta.env e vazios.
    rule: /\b(api[_-]?key|secret|password|passwd|token|private[_-]?key|client[_-]?secret|partner[_-]?key|encryption[_-]?key)\b\s*[:=]\s*['"`](?!.*(process\.env|import\.meta|\$\{|troque|change|example|placeholder|your[_-]|xxx|\.\.\.))[^'"`\s]{16,}['"`]/i,
  },
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Estado 3 do contrato de três estados do MPES (D1): o arquivo deveria ter sido
 * varrido e não foi. Avisa o usuário e informa o agente — nunca silêncio, que
 * seria indistinguível de "varrido e limpo".
 */
function naoVerificavel(arquivo, motivo, comoRestaurar) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `[scan-secrets] ESTADO 3 — não foi possível verificar ${arquivo}: ${motivo}.`,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `[scan-secrets] ESTADO 3 — o arquivo ${arquivo} NÃO foi varrido em busca de segredo: ` +
          `${motivo}. ${comoRestaurar} Não trate este arquivo como verificado.`,
      },
    }),
  );
  process.exit(0);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    naoVerificavel(
      '(arquivo desconhecido)',
      'a entrada recebida não é um JSON válido',
      'Verifique a configuração do hook em .claude/settings.json.',
    );
  }

  const path = payload?.tool_input?.file_path;
  if (typeof path !== 'string' || !path) process.exit(0); // N/A

  const normalized = path.replace(/\\/g, '/');
  if (ALLOWLIST.some((r) => r.test(normalized))) process.exit(0); // N/A: isento por allowlist

  let content;
  try {
    const tamanho = statSync(path).size;
    if (tamanho > MAX_BYTES) {
      // Antes: exit(0) silencioso. Um segredo em arquivo grande passava sem
      // varredura E sem aviso — o mesmo defeito do F01, em outro mecanismo.
      naoVerificavel(
        normalized,
        `o arquivo tem ${Math.round(tamanho / 1024)} KB, acima do teto de ${MAX_BYTES / 1024} KB`,
        'Confira manualmente se há credencial neste arquivo.',
      );
    }
    content = readFileSync(path, 'utf8');
  } catch (err) {
    naoVerificavel(
      normalized,
      `não foi possível ler o arquivo (${err?.code ?? 'erro desconhecido'})`,
      'Se o arquivo foi removido ou é binário, ignore este aviso.',
    );
  }

  const hits = [];
  for (const { name, rule } of PATTERNS) {
    const match = rule.exec(content);
    if (!match) continue;
    // Reporta apenas o tipo e a linha — NUNCA o valor.
    const line = content.slice(0, match.index).split('\n').length;
    hits.push(`${name} (linha ${line})`);
  }

  if (hits.length === 0) process.exit(0);

  process.stderr.write(
    `[scan-secrets] Possível segredo em ${normalized}:\n` +
      hits.map((h) => `  - ${h}`).join('\n') +
      '\n\nRemova o valor do código antes de continuar. Segredo vai para variável de ambiente ' +
      'e é documentado (sem o valor) em apps/api/.env.example. Se o segredo for real, ele deve ' +
      'ser considerado comprometido e rotacionado. Se for um falso positivo (dado de teste), ' +
      'diga isso explicitamente ao usuário em vez de ignorar em silêncio.\n',
  );
  process.exit(2); // 2 = bloqueia e devolve o stderr para o agente corrigir.
}

main();
