#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate-project.sh — verificações de qualidade do Kyneti (precifica-saas)
#
# O que faz: roda, em sequência, apenas comandos que EXISTEM neste repositório
# (typecheck, testes, build), parando na primeira falha real.
#
# O que NUNCA faz: instalar dependência, alterar arquivo, tocar em banco de
# produção, rodar migration, fazer commit/push/deploy.
#
# Uso:
#   bash .claude/skills/product-engineering-studio/scripts/validate-project.sh [opções]
#
# Opções:
#   --api-only      valida somente apps/api
#   --web-only      valida somente apps/web
#   --skip-build    pula os builds (mais rápido durante desenvolvimento)
#   --skip-tests    pula os testes
#   --keep-going    não interrompe na primeira falha (relatório completo)
#   -h, --help      mostra esta ajuda
#
# Saída: 0 = tudo que pôde rodar passou · 1 = falha real · 2 = uso incorreto
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
WEB_DIR="$REPO_ROOT/apps/web"

RUN_API=1
RUN_WEB=1
SKIP_BUILD=0
SKIP_TESTS=0
KEEP_GOING=0

if [ -t 1 ]; then
  C_RESET='\033[0m'; C_BOLD='\033[1m'; C_RED='\033[31m'
  C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_BLUE='\033[34m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

FAILURES=0
SKIPPED=0
declare -a SUMMARY=()

step()  { printf "\n${C_BLUE}${C_BOLD}▶ %s${C_RESET}\n" "$1"; }
ok()    { printf "${C_GREEN}✔ %s${C_RESET}\n" "$1"; SUMMARY+=("PASS  $1"); }
skip()  { printf "${C_YELLOW}– %s${C_RESET}\n" "$1"; SUMMARY+=("SKIP  $1"); SKIPPED=$((SKIPPED + 1)); }
fail()  { printf "${C_RED}✘ %s${C_RESET}\n" "$1"; SUMMARY+=("FAIL  $1"); FAILURES=$((FAILURES + 1)); }

usage() { sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# Interrompe na primeira falha, a menos que --keep-going tenha sido pedido.
abort_if_needed() {
  if [ "$KEEP_GOING" -eq 0 ]; then
    printf "\n${C_RED}${C_BOLD}Interrompido na primeira falha.${C_RESET} Use --keep-going para ver o relatório completo.\n"
    exit 1
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --api-only)   RUN_WEB=0 ;;
    --web-only)   RUN_API=0 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --keep-going) KEEP_GOING=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) printf "${C_RED}Opção desconhecida: %s${C_RESET}\n" "$1"; usage; exit 2 ;;
  esac
  shift
done

# --- Gerenciador de pacotes -------------------------------------------------
# Detecção pelo lockfile. Este repositório usa npm (package-lock.json em cada
# app; NÃO há workspaces na raiz — cada app instala e roda isolado).
detect_pm() {
  local dir="$1"
  if   [ -f "$dir/pnpm-lock.yaml" ]; then echo "pnpm"
  elif [ -f "$dir/yarn.lock" ];      then echo "yarn"
  elif [ -f "$dir/bun.lockb" ];      then echo "bun"
  else echo "npm"
  fi
}

has_script() {  # has_script <dir> <nome>
  node -e "const p=require('$1/package.json');process.exit(p.scripts&&p.scripts['$2']?0:1)" 2>/dev/null
}

# run_step "rótulo" <dir> <comando...>
run_step() {
  local label="$1" dir="$2"; shift 2
  printf "  \$ (cd %s && %s)\n" "${dir#"$REPO_ROOT"/}" "$*"
  if (cd "$dir" && "$@"); then ok "$label"; else fail "$label"; abort_if_needed; return 1; fi
}

has_eslint_config() {
  local dir="$1"
  for f in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
           .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
    [ -f "$dir/$f" ] && return 0
  done
  node -e "const p=require('$dir/package.json');process.exit(p.eslintConfig?0:1)" 2>/dev/null && return 0
  return 1
}

printf "${C_BOLD}Validação do projeto — %s${C_RESET}\n" "$REPO_ROOT"
printf "Node: %s · npm: %s\n" "$(node -v 2>/dev/null || echo 'ausente')" "$(npm -v 2>/dev/null || echo 'ausente')"

if ! command -v node >/dev/null 2>&1; then
  printf "${C_RED}Node.js não encontrado no PATH. Abortando.${C_RESET}\n"; exit 1
fi

# ===========================================================================
# BACKEND — apps/api
# ===========================================================================
if [ "$RUN_API" -eq 1 ]; then
  step "Backend (apps/api) — gerenciador: $(detect_pm "$API_DIR")"

  if [ ! -d "$API_DIR/node_modules" ]; then
    skip "apps/api: dependências não instaladas (rode 'cd apps/api && npm install' — este script NÃO instala nada)"
  else
    # 1. Formatação — não há Prettier configurado neste repositório.
    skip "apps/api: formatação (Prettier não está configurado no projeto)"

    # 2. Lint — ESLint está nas devDependencies, mas não há arquivo de config.
    if has_script "$API_DIR" lint && has_eslint_config "$API_DIR"; then
      run_step "apps/api: lint" "$API_DIR" npm run lint || true
    else
      skip "apps/api: lint (não há configuração de ESLint — 'npm run lint' falharia por falta de config, não por erro de código)"
    fi

    # 3. Typecheck — não há script; chamamos o compilador diretamente.
    run_step "apps/api: typecheck" "$API_DIR" npx --no-install tsc -p tsconfig.json --noEmit

    # 4. Schema do Prisma — validação estática, NÃO toca em banco nenhum.
    if [ -f "$API_DIR/prisma/schema.prisma" ]; then
      run_step "apps/api: prisma validate (somente schema, sem acesso ao banco)" \
        "$API_DIR" npx --no-install prisma validate || true
    fi

    # 5. Testes unitários.
    if [ "$SKIP_TESTS" -eq 1 ]; then
      skip "apps/api: testes (--skip-tests)"
    elif has_script "$API_DIR" test; then
      run_step "apps/api: testes unitários" "$API_DIR" npm test
    fi

    # 6. Build.
    if [ "$SKIP_BUILD" -eq 1 ]; then
      skip "apps/api: build (--skip-build)"
    elif has_script "$API_DIR" build; then
      run_step "apps/api: build" "$API_DIR" npm run build
    fi

    # Testes e2e ficam de fora: exigem Postgres real e são disparados à mão
    # ('npm run test:e2e'), para este script nunca depender de infraestrutura.
    skip "apps/api: testes e2e (exigem banco real — rode 'npm run test:e2e' manualmente)"
  fi
fi

# ===========================================================================
# FRONTEND — apps/web
# ===========================================================================
if [ "$RUN_WEB" -eq 1 ]; then
  step "Frontend (apps/web) — gerenciador: $(detect_pm "$WEB_DIR")"

  if [ ! -d "$WEB_DIR/node_modules" ]; then
    skip "apps/web: dependências não instaladas (rode 'cd apps/web && npm install' — este script NÃO instala nada)"
  else
    skip "apps/web: formatação (Prettier não está configurado no projeto)"

    if has_script "$WEB_DIR" lint && has_eslint_config "$WEB_DIR"; then
      run_step "apps/web: lint" "$WEB_DIR" npm run lint || true
    else
      skip "apps/web: lint (não há configuração de ESLint)"
    fi

    run_step "apps/web: typecheck" "$WEB_DIR" npx --no-install tsc -b --noEmit

    if [ "$SKIP_TESTS" -eq 1 ]; then
      skip "apps/web: testes (--skip-tests)"
    elif has_script "$WEB_DIR" test; then
      run_step "apps/web: testes" "$WEB_DIR" npm test
    else
      skip "apps/web: testes (não existe suíte de testes neste app)"
    fi

    if [ "$SKIP_BUILD" -eq 1 ]; then
      skip "apps/web: build (--skip-build)"
    elif has_script "$WEB_DIR" build; then
      run_step "apps/web: build" "$WEB_DIR" npm run build
    fi
  fi
fi

# ===========================================================================
# VERIFICAÇÕES DE REPOSITÓRIO (baratas, sem dependência)
# ===========================================================================
step "Repositório"

# .env versionado por engano
if git -C "$REPO_ROOT" ls-files --error-unmatch '*.env' >/dev/null 2>&1; then
  fail "arquivo .env rastreado pelo Git — remova do índice e rotacione os segredos"
else
  ok "nenhum arquivo .env rastreado pelo Git"
fi

# settings.local.json do Claude Code não pode ser versionado
if git -C "$REPO_ROOT" ls-files --error-unmatch '.claude/settings.local.json' >/dev/null 2>&1; then
  fail ".claude/settings.local.json está versionado — deve ficar apenas local"
else
  ok ".claude/settings.local.json não está versionado"
fi

# Migration criando tabela sem o par de RLS/grant correspondente é o risco de
# drift nº 1 deste projeto (ver docs/row-level-security-architecture.md).
MIG_DIR="$API_DIR/prisma/migrations"
MAN_DIR="$API_DIR/prisma/manual-migrations"
if [ -d "$MIG_DIR" ] && [ -d "$MAN_DIR" ]; then
  recent_create=$(grep -rl --include='migration.sql' -i 'CREATE TABLE' "$MIG_DIR" 2>/dev/null | wc -l | tr -d ' ')
  rls_files=$(ls "$MAN_DIR" 2>/dev/null | grep -ci 'rls\|grant' || true)
  printf "  migrations com CREATE TABLE: %s · arquivos de RLS/grant manuais: %s\n" "$recent_create" "$rls_files"
  ok "lembrete: toda tabela nova precisa do par apply_*_rls_only.sql + grant_app_runtime_*.sql"
fi

# ===========================================================================
# RESUMO
# ===========================================================================
step "Resumo"
for line in "${SUMMARY[@]}"; do
  case "$line" in
    PASS*) printf "  ${C_GREEN}%s${C_RESET}\n" "$line" ;;
    SKIP*) printf "  ${C_YELLOW}%s${C_RESET}\n" "$line" ;;
    FAIL*) printf "  ${C_RED}%s${C_RESET}\n" "$line" ;;
  esac
done

printf "\n"
if [ "$FAILURES" -gt 0 ]; then
  printf "${C_RED}${C_BOLD}%d verificação(ões) falharam.${C_RESET} %d pulada(s).\n" "$FAILURES" "$SKIPPED"
  printf "Não declare a tarefa concluída enquanto isso não estiver verde.\n"
  exit 1
fi

printf "${C_GREEN}${C_BOLD}Todas as verificações executáveis passaram.${C_RESET} %d pulada(s).\n" "$SKIPPED"
printf "Atenção: item PULADO não é item aprovado — verifique a lista acima antes de reportar.\n"
exit 0
