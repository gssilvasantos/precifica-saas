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

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    process.exit(0); // Entrada inesperada: não atrapalha o fluxo.
  }

  const input = payload?.tool_input ?? {};
  const path = input.file_path ?? input.notebook_path ?? '';
  if (!path) process.exit(0);

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
