#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PreToolUse (Bash)
//
// Barra comandos destrutivos ou fora de escopo antes de executarem:
// reset de banco, migrations contra ambiente remoto, push/deploy, instalação
// de dependência, force push, remoção em massa.
//
// "deny"  = nunca deve acontecer por iniciativa do agente.
// "ask"   = pode ser legítimo, mas exige decisão consciente do usuário.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** @type {{rule: RegExp, decision: 'deny'|'ask', reason: string}[]} */
const RULES = [
  // --- Banco de dados -----------------------------------------------------
  {
    rule: /prisma\s+migrate\s+reset|prisma\s+db\s+push[^\n]*--(force-reset|accept-data-loss)/,
    decision: 'deny',
    reason: 'Reset de banco apaga TODOS os dados. Se for mesmo necessário, execute você mesmo.',
  },
  {
    rule: /prisma\s+migrate\s+deploy/,
    decision: 'ask',
    reason:
      'migrate deploy aplica migrations em um ambiente real (o alvo depende de DATABASE_URL). ' +
      'Confirme o ambiente antes de prosseguir.',
  },
  {
    rule: /\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s+TABLE?|DELETE\s+FROM\s+\w+\s*;)/i,
    decision: 'deny',
    reason: 'SQL destrutivo direto. Mudança de schema passa por migration revisada, com rollback.',
  },
  {
    rule: /\bpsql\b|\bpg_dump\b|\bpg_restore\b/,
    decision: 'ask',
    reason: 'Acesso direto ao Postgres. Confirme que o alvo é um banco local descartável.',
  },

  // --- Git / publicação ---------------------------------------------------
  {
    rule: /git\s+push[^\n]*(--force(?!-with-lease)|\s-f\b)/,
    decision: 'deny',
    reason: 'Force push reescreve histórico remoto. Exige pedido explícito do usuário.',
  },
  {
    rule: /git\s+(push|commit)\b/,
    decision: 'ask',
    reason: 'Commit e push só acontecem quando o usuário pede explicitamente.',
  },
  {
    rule: /git\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.)/,
    decision: 'ask',
    reason: 'Descarta alterações locais de forma irreversível. Confirme que nada será perdido.',
  },
  {
    rule: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/,
    decision: 'deny',
    reason: 'Publicação de pacote nunca é feita por iniciativa do agente.',
  },

  // --- Dependências -------------------------------------------------------
  {
    rule: /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(?!$)(?!--?[a-z])/,
    decision: 'ask',
    reason:
      'Instalar dependência nova exige aprovação explícita (ver CLAUDE.md, seção Limites). ' +
      '`npm install` sem pacote, para restaurar node_modules, é permitido.',
  },

  // --- Deploy / infraestrutura -------------------------------------------
  {
    rule: /\b(vercel|netlify|render|fly|heroku|wrangler)\s+(deploy|publish|up)\b/,
    decision: 'deny',
    reason: 'Deploy nunca é executado pelo agente. Proponha o comando e deixe a execução ao usuário.',
  },
  {
    rule: /\b(docker\s+compose\s+down\s+-v|docker\s+volume\s+rm|docker\s+system\s+prune)/,
    decision: 'ask',
    reason: 'Remove volumes — o banco de desenvolvimento local seria perdido.',
  },

  // --- Sistema de arquivos ------------------------------------------------
  {
    rule: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|~|\$HOME|\.\s*$|\*)/,
    decision: 'deny',
    reason: 'Remoção recursiva em raiz, home ou curinga. Nunca.',
  },
  {
    rule: /\bcurl\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b|\bwget\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/,
    decision: 'deny',
    reason: 'Executar script baixado da internet sem inspeção é vetor de comprometimento.',
  },

  // --- Segredos -----------------------------------------------------------
  {
    rule: /\b(cat|less|more|head|tail|bat|xxd|strings)\b[^\n|;]*\.env(?!\.example)(\s|$|\.)/,
    decision: 'deny',
    reason:
      'Não leia arquivos .env — eles contêm segredos reais. Consulte apps/api/.env.example ' +
      'para saber quais variáveis existem.',
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
    process.exit(0);
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || command.length === 0) process.exit(0);

  for (const { rule, decision, reason } of RULES) {
    if (rule.test(command)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason: `[guard-destructive-bash] ${reason}`,
          },
        }),
      );
      process.exit(0);
    }
  }

  process.exit(0);
}

main();
