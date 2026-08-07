#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PreToolUse (Write | Edit | NotebookEdit)
//
// Bloqueia escrita em arquivos que nunca devem ser alterados por um agente:
// segredos, migrations já aplicadas, lockfiles e artefatos de build.
//
// Não modifica nada. Só decide permitir/perguntar/negar.
// Sem dependências — roda com o Node já exigido pelo projeto.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** @type {{rule: RegExp, decision: 'deny'|'ask', reason: string}[]} */
const RULES = [
  {
    rule: /(^|\/)\.env(\.|$)(?!example)/,
    decision: 'deny',
    reason:
      'Arquivos .env contêm segredos reais e nunca devem ser escritos por um agente. ' +
      'Para documentar uma variável nova, edite apps/api/.env.example.',
  },
  {
    rule: /(^|\/)\.claude\/settings\.local\.json$/,
    decision: 'ask',
    reason:
      'settings.local.json é configuração pessoal e não versionada. Confirme antes de alterar; ' +
      'mudanças que valem para o time vão em .claude/settings.json.',
  },
  {
    rule: /prisma\/migrations\/[^/]+\/migration\.sql$/,
    decision: 'ask',
    reason:
      'Migration já existente. Migration aplicada em outro ambiente NUNCA deve ser editada — ' +
      'crie uma nova. Confirme apenas se esta migration ainda não saiu da sua máquina.',
  },
  {
    rule: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/,
    decision: 'ask',
    reason:
      'Lockfile deve ser alterado pelo gerenciador de pacotes, não editado à mão. ' +
      'Adicionar dependência exige aprovação explícita do usuário.',
  },
  {
    rule: /(^|\/)(dist|build|node_modules|\.next|coverage|\.buildlogs)\//,
    decision: 'deny',
    reason: 'Artefato de build ou dependência instalada — gerado, não editado.',
  },
  {
    rule: /\.(pem|key|p12|pfx|keystore|jks)$/,
    decision: 'deny',
    reason: 'Arquivo de chave/certificado. Nunca deve ser criado ou alterado por um agente.',
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
 * Estado 3 do contrato de três estados do MPES (D1): o hook foi acionado e não
 * conseguiu avaliar o pedido. Avisa sem bloquear e sem pedir autorização —
 * exit 0 SEM permissionDecision deixa o fluxo normal de permissão valer.
 */
function naoVerificavel(motivo) {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        `[guard-sensitive-write] ESTADO 3 — não foi possível verificar: ${motivo}. ` +
        'A escrita NÃO foi avaliada contra as regras de arquivo sensível.',
    }),
  );
  process.exit(0);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    naoVerificavel('a entrada recebida não é um JSON válido');
  }

  const input = payload?.tool_input ?? {};
  const path = input.file_path ?? input.notebook_path ?? '';

  // Ferramenta de escrita sem caminho legível: não dá para avaliar (estado 3).
  // Qualquer outra ferramenta: N/A, silêncio correto.
  if (!path) {
    const ferramenta = String(payload?.tool_name ?? '');
    if (/write|edit|notebook/i.test(ferramenta)) {
      naoVerificavel(
        `a ferramenta ${ferramenta} não trouxe um caminho de arquivo legível ` +
          `(campos vistos: ${Object.keys(input).join(', ') || 'nenhum'})`,
      );
    }
    process.exit(0);
  }

  const normalized = String(path).replace(/\\/g, '/');

  for (const { rule, decision, reason } of RULES) {
    if (rule.test(normalized)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason: `[guard-sensitive-write] ${reason}`,
          },
        }),
      );
      process.exit(0);
    }
  }

  process.exit(0);
}

main();
