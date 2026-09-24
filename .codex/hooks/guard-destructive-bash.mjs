#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PreToolUse (Bash | PowerShell)
//
// Barra comandos destrutivos ou fora de escopo antes de executarem:
// reset de banco, migrations contra ambiente remoto, push/deploy, instalação
// de dependência, force push, remoção em massa, leitura de segredo.
//
// "deny" = nunca deve acontecer por iniciativa do agente.
// "ask"  = pode ser legítimo, mas exige decisão consciente do usuário.
//
// Correção do achado F02 (03/08/2026): a versão anterior só era acionada pela
// ferramenta Bash, e suas regras eram sintaticamente POSIX. No Windows, onde o
// PowerShell é o shell primário, TODAS as barreiras eram contornáveis apenas
// trocando de ferramenta — sem má intenção, pelo caminho mais natural.
//
// Arquitetura: o matcher em settings.json filtra apenas pelo NOME da ferramenta
// ("Bash|PowerShell") e toda a decisão vive aqui, lendo tool_input.command.
// Isso é deliberado: padrões específicos do tipo PowerShell(<algo>) em cláusulas
// de permissão falham em silêncio (issue anthropics/claude-code#57137), e falha
// silenciosa é exatamente o que este hook existe para eliminar.
//
// Implementa o contrato de três estados do MPES (D1).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const HOOK = 'guard-destructive-bash';

/** @type {{rule: RegExp, decision: 'deny'|'ask', reason: string}[]} */
const RULES = [
  // === MULTIPLATAFORMA (mesma sintaxe em bash e PowerShell) =================

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

  // === SINTAXE POSIX / BASH ================================================
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
  {
    rule: /\b(cat|less|more|head|tail|bat|xxd|strings)\b[^\n|;]*\.env(?!\.example)(\s|$|\.)/,
    decision: 'deny',
    reason:
      'Não leia arquivos .env — eles contêm segredos reais. Consulte apps/api/.env.example ' +
      'para saber quais variáveis existem.',
  },

  // === SINTAXE POWERSHELL ==================================================
  // Espelham as regras POSIX acima. Entram como 'ask' quando o comando tem uso
  // legítimo frequente (limpar dist/), e 'deny' quando não há uso legítimo.
  {
    // Remoção recursiva em raiz de drive, home ou curinga.
    rule: /\bRemove-Item\b[^\n]*-Recurse\b[^\n]*(-Force\b[^\n]*)?(\s|["'])([A-Za-z]:\\?\s*["']?$|[A-Za-z]:\\\*|\$HOME|\$env:USERPROFILE|~[\\/]?\s*$|\*\s*$)/i,
    decision: 'deny',
    reason: 'Remoção recursiva em raiz de disco, home ou curinga. Nunca.',
  },
  {
    // Remoção recursiva em geral: legítima para dist/, perigosa em qualquer outro lugar.
    rule: /\b(Remove-Item|ri|rd|rmdir|del|erase)\b[^\n]*-Recurse\b/i,
    decision: 'ask',
    reason:
      'Remoção recursiva no PowerShell. Confirme o alvo — apagar dist/ é legítimo, ' +
      'apagar código ou dados não é.',
  },
  {
    // Download e execução direta: iwr/curl/Invoke-WebRequest canalizado para iex.
    rule: /\b(Invoke-WebRequest|iwr|curl|wget|Invoke-RestMethod|irm)\b[^\n]*\|\s*(iex|Invoke-Expression)\b/i,
    decision: 'deny',
    reason: 'Executar script baixado da internet sem inspeção é vetor de comprometimento.',
  },
  {
    // Leitura de .env por qualquer cmdlet/alias de leitura.
    rule: /\b(Get-Content|gc|cat|type|Import-Csv|Select-String|sls)\b[^\n|;]*\.env(?!\.example)(\s|$|["'])/i,
    decision: 'deny',
    reason:
      'Não leia arquivos .env — eles contêm segredos reais. Consulte apps/api/.env.example ' +
      'para saber quais variáveis existem.',
  },
  {
    // Escrita em .env por qualquer cmdlet de escrita.
    rule: /\b(Set-Content|Out-File|Add-Content|ac|sc)\b[^\n|;]*\.env(?!\.example)(\s|$|["'])/i,
    decision: 'deny',
    reason: 'Arquivos .env nunca devem ser escritos por um agente. Documente em .env.example.',
  },
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Estado 3: o hook foi acionado e não conseguiu avaliar o comando. */
function naoVerificavel(motivo) {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        `[${HOOK}] ESTADO 3 — não foi possível verificar: ${motivo}. ` +
        'O comando NÃO foi avaliado contra as regras de segurança — confira antes de aprovar.',
    }),
  );
  process.exit(0); // Sem permissionDecision: o fluxo normal de permissão vale.
}

function main() {
  const bruto = readStdin();

  let payload;
  try {
    payload = JSON.parse(bruto);
  } catch {
    naoVerificavel('a entrada recebida não é um JSON válido');
  }

  const entrada = payload?.tool_input ?? {};
  const ferramenta = payload?.tool_name ?? '(desconhecida)';

  // O comando pode vir em `command` (Bash e PowerShell). Aceita variações
  // defensivamente para não depender de um único nome de campo.
  const command = entrada.command ?? entrada.script ?? entrada.cmd;

  if (typeof command !== 'string' || command.length === 0) {
    // Ferramenta de shell sem comando legível: não dá para avaliar. Estado 3.
    if (/bash|powershell|shell|pwsh/i.test(String(ferramenta))) {
      naoVerificavel(
        `a ferramenta ${ferramenta} não trouxe um comando legível ` +
          `(campos vistos: ${Object.keys(entrada).join(', ') || 'nenhum'})`,
      );
    }
    process.exit(0); // N/A: não é uma ferramenta de shell.
  }

  for (const { rule, decision, reason } of RULES) {
    if (rule.test(command)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason: `[${HOOK}] ${reason}`,
          },
        }),
      );
      process.exit(0);
    }
  }

  process.exit(0); // ESTADO 1: avaliado contra todas as regras, nada casou.
}

main();
