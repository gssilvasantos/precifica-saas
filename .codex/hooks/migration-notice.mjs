#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse (Write | Edit) em prisma/schema.prisma e prisma/migrations/**
//
// Não bloqueia, não altera arquivo: injeta um lembrete no contexto do agente
// com as duas coisas que este projeto exige e que são fáceis de esquecer:
//
//   1. tabela nova precisa do par apply_*_rls_only.sql + grant_app_runtime_*.sql
//      (ver docs/row-level-security-architecture.md);
//   2. operação destrutiva precisa ser declarada, com rollback, e confirmada.
//
// Só fala quando tem o que dizer — silêncio é o caso comum.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from 'node:fs';

const DESTRUCTIVE = [
  { name: 'DROP TABLE', rule: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', rule: /\bDROP\s+COLUMN\b/i },
  { name: 'DROP SCHEMA', rule: /\bDROP\s+SCHEMA\b/i },
  { name: 'RENAME', rule: /\bRENAME\s+(TO|COLUMN)\b/i },
  { name: 'ALTER COLUMN ... TYPE', rule: /\bALTER\s+COLUMN\b[^\n;]*\bTYPE\b/i },
  { name: 'SET NOT NULL', rule: /\bSET\s+NOT\s+NULL\b/i },
  { name: 'TRUNCATE', rule: /\bTRUNCATE\b/i },
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: text,
      },
    }),
  );
  process.exit(0);
}

/**
 * Estado 3 do contrato de três estados do MPES (D1): o arquivo é de schema ou
 * migration e não pôde ser analisado. Avisa — nunca silêncio, que seria lido
 * como "analisado e sem pendência de RLS".
 */
function naoVerificavel(arquivo, motivo, comoRestaurar) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: `[migration-notice] ESTADO 3 — não foi possível verificar ${arquivo}: ${motivo}.`,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `[migration-notice] ESTADO 3 — ${arquivo} NÃO foi analisado: ${motivo}. ` +
          `${comoRestaurar} Confira à mão se há tabela nova sem o par ` +
          'apply_*_rls_only.sql + grant_app_runtime_*.sql, e se há operação destrutiva.',
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
  const isSchema = /prisma\/schema\.prisma$/.test(normalized);
  const isMigration = /prisma\/(migrations|manual-migrations)\/.+\.sql$/.test(normalized);
  if (!isSchema && !isMigration) process.exit(0); // N/A

  const MAX_BYTES = 2 * 1024 * 1024;
  let content = '';
  try {
    const tamanho = statSync(path).size;
    if (tamanho >= MAX_BYTES) {
      // Antes: content ficava vazio e o hook "aprovava" em silêncio.
      naoVerificavel(
        normalized,
        `o arquivo tem ${Math.round(tamanho / 1024)} KB, acima do teto de ${MAX_BYTES / 1024} KB`,
        'Analise o conteúdo manualmente.',
      );
    }
    content = readFileSync(path, 'utf8');
  } catch (err) {
    naoVerificavel(
      normalized,
      `não foi possível ler o arquivo (${err?.code ?? 'erro desconhecido'})`,
      'Se o arquivo foi removido, ignore este aviso.',
    );
  }

  const notes = [];

  const createdTables = [...content.matchAll(/\bCREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?/gi)]
    .map((m) => m[1])
    .slice(0, 12);
  const newModels = isSchema
    ? [...content.matchAll(/^\s*model\s+(\w+)/gm)].map((m) => m[1]).length
    : 0;

  if (createdTables.length > 0) {
    notes.push(
      `Tabelas criadas nesta migration: ${createdTables.join(', ')}.\n` +
        'Este projeto NÃO aplica RLS automaticamente. Cada tabela nova precisa do par em ' +
        'apps/api/prisma/manual-migrations/:\n' +
        '  - apply_<contexto>_rls_only.sql  (políticas de linha por tenant)\n' +
        '  - grant_app_runtime_<contexto>.sql  (GRANTs do papel app_runtime)\n' +
        'Sem isso, ou o dado fica inacessível em produção, ou fica visível para outro tenant. ' +
        'Ver docs/row-level-security-architecture.md.',
    );
  }

  const found = DESTRUCTIVE.filter(({ rule }) => rule.test(content)).map(({ name }) => name);
  if (found.length > 0) {
    notes.push(
      `Operações potencialmente destrutivas detectadas: ${found.join(', ')}.\n` +
        'Antes de seguir: declare o que se perde, quantos registros são afetados, o backfill e o ' +
        'rollback; use expand → migrate → contract para mudança incompatível; e peça confirmação ' +
        'explícita ao usuário. Nunca aplique isso silenciosamente.',
    );
  }

  if (isSchema && newModels > 0 && createdTables.length === 0) {
    notes.push(
      `schema.prisma alterado (${newModels} models no arquivo). Lembretes: multiSchema exige ` +
        '@@schema em todo model; tabela de negócio precisa de tenantId nos índices e nas ' +
        'políticas de RLS; rode `npm run prisma:generate` e o typecheck depois da mudança.',
    );
  }

  if (notes.length === 0) process.exit(0);

  emit(`[migration-notice] ${normalized}\n\n${notes.join('\n\n')}`);
}

main();
