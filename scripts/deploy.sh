#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Контент Завод — Умный идемпотентный деплой v2
# ═══════════════════════════════════════════════════════════════════════
# Использование:
#   ./scripts/deploy.sh                  # полный деплой
#   ./scripts/deploy.sh --quick          # только dashboard (пропустить build)
#   ./scripts/deploy.sh --migrate-only   # только DB миграции
#   ./scripts/deploy.sh --sync-workflows # только синхронизация n8n workflows
#   ./scripts/deploy.sh --rollback       # откат к предыдущей версии
#
# Идемпотентность:
#   - Можно прерывать и перезапускать в любой момент
#   - Каждый шаг сохраняет статус в .deploy-state
#   - Повторный запуск пропускает уже выполненные шаги
#   - Новый деплой (git commit изменился) сбрасывает состояние
#
# Что делает:
#   1. Валидация окружения (.env, необходимые переменные)
#   2. Резервная копия БД и workflows
#   3. Git pull (если remote настроен)
#   4. Сборка контейнеров
#   5. Запуск контейнеров
#   6. DB миграции (через schema_migrations таблицу)
#   7. Синхронизация n8n workflows через REST API
#   8. Финальная проверка health-check
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Цвета ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
log_ok()    { echo -e "${GREEN}✅${NC} $*"; }
log_warn()  { echo -e "${YELLOW}⚠️${NC}  $*"; }
log_error() { echo -e "${RED}❌${NC} $*" >&2; }
log_step()  { echo -e "\n${BOLD}${CYAN}─── $* ───${NC}\n"; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

DEPLOY_MODE="${1:-full}"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
DEPLOY_LOG="$PROJECT_DIR/backups/deploy.log"
STATE_FILE="$PROJECT_DIR/.deploy-state"

mkdir -p "$PROJECT_DIR/backups"

# ═══════════════════════════════════════════════════════════
# УПРАВЛЕНИЕ СОСТОЯНИЕМ (идемпотентность)
# ═══════════════════════════════════════════════════════════
get_state() { grep -m1 "^$1=" "$STATE_FILE" 2>/dev/null | cut -d= -f2- || echo ""; }
set_state() {
  touch "$STATE_FILE"
  sed -i "/^$1=/d" "$STATE_FILE" 2>/dev/null || true
  echo "$1=$2" >> "$STATE_FILE"
}
step_done()     { [ "$(get_state "STEP_$1")" = "done" ]; }
step_complete() { set_state "STEP_$1" "done"; }

# ID деплоя = текущий git hash (или timestamp если не git)
CURRENT_DEPLOY_ID=$(git rev-parse HEAD 2>/dev/null || echo "$TIMESTAMP")
SAVED_DEPLOY_ID=$(get_state "DEPLOY_ID")

# Новый коммит = новый деплой, сбрасываем флаги шагов
if [ "$SAVED_DEPLOY_ID" != "$CURRENT_DEPLOY_ID" ]; then
  if [ -f "$STATE_FILE" ] && [ -s "$STATE_FILE" ]; then
    log_info "Новый деплой (${CURRENT_DEPLOY_ID:0:8}). Сброс состояния шагов."
    > "$STATE_FILE"
  fi
  set_state "DEPLOY_ID" "$CURRENT_DEPLOY_ID"
fi

# ─── Загрузка .env ───
if [ ! -f "$PROJECT_DIR/.env" ]; then
  log_error ".env не найден! Скопируйте .env.example в .env и настройте."
  exit 1
fi
set -a; source "$PROJECT_DIR/.env" 2>/dev/null || true; set +a

DB_USER="${DB_POSTGRESDB_USER:-n8n_user}"
DB_NAME="${DB_POSTGRESDB_DATABASE:-n8n}"
N8N_PORT="${N8N_PORT:-5678}"
N8N_API_BASE="http://127.0.0.1:${N8N_PORT}/api/v1"

# ─── Заголовок ───
echo -e "${BOLD}${CYAN}"
echo "╔═══════════════════════════════════════════════╗"
echo "║   🚀 КОНТЕНТ ЗАВОД — Деплой v2               ║"
printf "║   %s  ID: %s              ║\n" "$(date '+%Y-%m-%d %H:%M')" "${CURRENT_DEPLOY_ID:0:8}"
echo "╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════════════════════════
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ═══════════════════════════════════════════════════════════

# Ожидание healthy-статуса контейнера
wait_healthy() {
  local CONTAINER="$1"
  local MAX="${2:-90}"
  local INTERVAL=3
  local ELAPSED=0
  local STATUS=""
  printf "${BLUE}ℹ${NC}  Ожидаю %s (timeout %ds)..." "$CONTAINER" "$MAX"
  while [ $ELAPSED -lt $MAX ]; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")
    case "$STATUS" in
      healthy) echo; log_ok "$CONTAINER — healthy"; return 0 ;;
      missing) echo; log_warn "$CONTAINER не найден"; return 1 ;;
    esac
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -n "."
  done
  echo
  log_warn "$CONTAINER не стал healthy за ${MAX}s (last: ${STATUS:-unknown})"
  docker logs "$CONTAINER" --tail=15 2>/dev/null || true
  return 1
}

# psql одной командой
psql_cmd() {
  docker exec content-factory-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -tAqc "$1" 2>/dev/null || echo ""
}

# psql из файла (stdin)
psql_file() {
  docker exec -i content-factory-postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -q < "$1"
}

# n8n REST API: GET
n8n_get() {
  curl -sf -H "X-N8N-API-KEY: ${N8N_API_KEY:-}" \
    "$N8N_API_BASE$1" 2>/dev/null || echo "{}"
}

# n8n REST API: POST файл
n8n_post_file() {
  curl -sf -X POST \
    -H "X-N8N-API-KEY: ${N8N_API_KEY:-}" \
    -H "Content-Type: application/json" \
    --data-binary "@$2" \
    "$N8N_API_BASE$1" 2>/dev/null || echo "{}"
}

# n8n REST API: PUT файл
n8n_put_file() {
  curl -sf -X PUT \
    -H "X-N8N-API-KEY: ${N8N_API_KEY:-}" \
    -H "Content-Type: application/json" \
    --data-binary "@$2" \
    "$N8N_API_BASE$1" 2>/dev/null || echo "{}"
}

# n8n REST API: PATCH inline
n8n_patch() {
  curl -sf -X PATCH \
    -H "X-N8N-API-KEY: ${N8N_API_KEY:-}" \
    -H "Content-Type: application/json" \
    -d "$2" \
    "$N8N_API_BASE$1" 2>/dev/null || echo "{}"
}

# Глобальный пул temp-файлов (чистятся по EXIT)
_TMPFILES=()
_cleanup_tmp() { for f in "${_TMPFILES[@]:-}"; do rm -f "$f" 2>/dev/null; done; }
trap _cleanup_tmp EXIT
_mktemp() { local f; f=$(mktemp); _TMPFILES+=("$f"); echo "$f"; }

# ═══════════════════════════════════════════════════════════
# РЕЖИМ --rollback
# ═══════════════════════════════════════════════════════════
if [ "$DEPLOY_MODE" = "--rollback" ]; then
  log_step "Откат к предыдущей версии"
  LATEST_BACKUP=$(ls -t "$PROJECT_DIR/backups/"pre-deploy_*.tar.gz 2>/dev/null | head -1 || echo "")
  if [ -z "$LATEST_BACKUP" ]; then
    log_error "Бэкапы не найдены в $PROJECT_DIR/backups/"
    exit 1
  fi
  log_info "Откатываю из: $(basename "$LATEST_BACKUP")"
  TMP_RB=$(mktemp -d)
  trap "rm -rf '$TMP_RB'" EXIT
  tar -xzf "$LATEST_BACKUP" -C "$TMP_RB"

  DB_DUMP=$(find "$TMP_RB" -name "database.dump" | head -1 || echo "")
  if [ -n "$DB_DUMP" ]; then
    log_info "Восстанавливаю базу данных..."
    docker exec -i content-factory-postgres \
      pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$DB_DUMP" 2>/dev/null || true
    log_ok "БД восстановлена"
  fi

  ENV_BK=$(find "$TMP_RB" -name "env.backup" | head -1 || echo "")
  [ -n "$ENV_BK" ] && { cp "$ENV_BK" "$PROJECT_DIR/.env"; log_ok ".env восстановлен"; }

  WF_DIR_BK=$(find "$TMP_RB" -type d -name "workflows" | head -1 || echo "")
  [ -n "$WF_DIR_BK" ] && { cp -r "$WF_DIR_BK/"* "$PROJECT_DIR/workflows/"; log_ok "Workflows восстановлены"; }

  docker compose restart
  log_ok "Откат завершён. Проверьте: docker compose logs"
  echo "[${TIMESTAMP}] ROLLBACK from $(basename "$LATEST_BACKUP")" >> "$DEPLOY_LOG"
  exit 0
fi

# ═══════════════════════════════════════════════════════════
# ФУНКЦИЯ: DB МИГРАЦИИ (делегируется в migrate.sh)
# ═══════════════════════════════════════════════════════════
run_migrations() {
  local MIGRATE_SH="$PROJECT_DIR/scripts/migrate.sh"
  if [ ! -f "$MIGRATE_SH" ]; then
    log_error "scripts/migrate.sh не найден!"
    return 1
  fi
  bash "$MIGRATE_SH" --run
}

# ═══════════════════════════════════════════════════════════
# ФУНКЦИЯ: СИНХРОНИЗАЦИЯ N8N WORKFLOWS
# ═══════════════════════════════════════════════════════════
sync_n8n_workflows() {
  log_step "Синхронизация n8n Workflows"

  if [ -z "${N8N_API_KEY:-}" ]; then
    log_warn "N8N_API_KEY не задан в .env. Пропускаю синхронизацию."
    return 0
  fi

  # Ждём доступности n8n API
  local RETRIES=0
  printf "${BLUE}ℹ${NC}  Ожидаю n8n API..."
  while [ $RETRIES -lt 15 ]; do
    if curl -sf -H "X-N8N-API-KEY: $N8N_API_KEY" \
        "$N8N_API_BASE/workflows?limit=1" > /dev/null 2>&1; then
      echo; break
    fi
    RETRIES=$((RETRIES + 1))
    sleep 4; echo -n "."
  done
  echo

  if [ $RETRIES -ge 15 ]; then
    log_warn "n8n API не ответил за 60s. Пропускаю синхронизацию workflows."
    return 0
  fi

  # Загрузить список существующих workflows в temp-файл
  local EXISTING_TMP
  EXISTING_TMP=$(_mktemp)
  n8n_get "/workflows?limit=250" > "$EXISTING_TMP"

  local CREATED=0 UPDATED=0 FAILED=0

  for WF_FILE in "$PROJECT_DIR/workflows/"*.json; do
    [ -f "$WF_FILE" ] || continue
    local WF_BASENAME
    WF_BASENAME=$(basename "$WF_FILE")

    # Извлечь имя workflow
    local WF_NAME=""
    if command -v python3 > /dev/null 2>&1; then
      WF_NAME=$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get('name', ''))
except Exception:
    pass
" "$WF_FILE" 2>/dev/null || echo "")
    fi
    if [ -z "$WF_NAME" ] && command -v node > /dev/null 2>&1; then
      WF_NAME=$(node -e "try{console.log(require('$WF_FILE').name||'')}catch(e){}" 2>/dev/null || echo "")
    fi
    if [ -z "$WF_NAME" ]; then
      WF_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' "$WF_FILE" 2>/dev/null | head -1 || echo "")
    fi

    if [ -z "$WF_NAME" ]; then
      log_warn "  Не удалось извлечь имя из $WF_BASENAME — пропуск"
      FAILED=$((FAILED + 1))
      continue
    fi

    # Найти существующий workflow по имени
    local EXISTING_ID=""
    if command -v python3 > /dev/null 2>&1; then
      EXISTING_ID=$(python3 -c "
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    name = sys.argv[2]
    for wf in data.get('data', []):
        if wf.get('name') == name:
            print(str(wf.get('id', '')))
            break
except Exception:
    pass
" "$EXISTING_TMP" "$WF_NAME" 2>/dev/null || echo "")
    fi

    # Подготовить файл тела запроса
    local REQ_FILE
    REQ_FILE=$(_mktemp)

    if [ -n "$EXISTING_ID" ]; then
      # Обновить существующий (передаём JSON как есть)
      cp "$WF_FILE" "$REQ_FILE"
      local RESP
      RESP=$(n8n_put_file "/workflows/$EXISTING_ID" "$REQ_FILE")
      local RESP_ID
      RESP_ID=$(echo "$RESP" | python3 -c "
import json, sys
try: print(str(json.load(sys.stdin).get('id','')))
except: pass
" 2>/dev/null || echo "")
      if [ -n "$RESP_ID" ]; then
        log_ok "  [обновлён]  '$WF_NAME' (id=$EXISTING_ID)"
        UPDATED=$((UPDATED + 1))
      else
        log_warn "  Ошибка обновления '$WF_NAME': $(echo "$RESP" | head -c 150)"
        FAILED=$((FAILED + 1))
      fi
    else
      # Создать новый: удалить поле id чтобы n8n назначил свой
      if command -v python3 > /dev/null 2>&1; then
        python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
d.pop('id', None)
print(json.dumps(d))" "$WF_FILE" > "$REQ_FILE" 2>/dev/null || cp "$WF_FILE" "$REQ_FILE"
      else
        cp "$WF_FILE" "$REQ_FILE"
      fi
      local RESP
      RESP=$(n8n_post_file "/workflows" "$REQ_FILE")
      local NEW_ID
      NEW_ID=$(echo "$RESP" | python3 -c "
import json, sys
try: print(str(json.load(sys.stdin).get('id','')))
except: pass
" 2>/dev/null || echo "")
      if [ -n "$NEW_ID" ]; then
        log_ok "  [создан]    '$WF_NAME' (id=$NEW_ID)"
        # Активировать workflow
        n8n_patch "/workflows/$NEW_ID/activate" '{}' > /dev/null 2>&1 || true
        CREATED=$((CREATED + 1))
      else
        log_warn "  Ошибка создания '$WF_NAME': $(echo "$RESP" | head -c 150)"
        FAILED=$((FAILED + 1))
      fi
    fi
  done

  log_ok "Workflows: создано $CREATED, обновлено $UPDATED, ошибок $FAILED"
  return 0
}

# ═══════════════════════════════════════════════════════════
# СПЕЦРЕЖИМЫ
# ═══════════════════════════════════════════════════════════
if [ "$DEPLOY_MODE" = "--migrate-only" ]; then
  bash "$PROJECT_DIR/scripts/migrate.sh" --run
  echo "[${TIMESTAMP}] MIGRATE-ONLY OK" >> "$DEPLOY_LOG"
  exit 0
fi

if [ "$DEPLOY_MODE" = "--sync-workflows" ]; then
  sync_n8n_workflows
  echo "[${TIMESTAMP}] SYNC-WORKFLOWS OK" >> "$DEPLOY_LOG"
  exit 0
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 1: БЭКАП
# ═══════════════════════════════════════════════════════════
if step_done "BACKUP"; then
  log_info "[пропуск] Бэкап уже выполнен в этом деплое"
else
  log_step "1/7 Бэкап"
  MINI_DIR="$PROJECT_DIR/backups/pre-deploy_${TIMESTAMP}"
  mkdir -p "$MINI_DIR"
  cp "$PROJECT_DIR/.env" "$MINI_DIR/env.backup" 2>/dev/null || true
  docker exec content-factory-postgres \
    pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$MINI_DIR/database.dump" 2>/dev/null \
    && log_ok "БД сохранена" \
    || log_warn "pg_dump не удался (контейнер не запущен?)"
  cp -r "$PROJECT_DIR/workflows" "$MINI_DIR/workflows" 2>/dev/null || true
  cd "$PROJECT_DIR/backups"
  tar -czf "pre-deploy_${TIMESTAMP}.tar.gz" "pre-deploy_${TIMESTAMP}" 2>/dev/null \
    && rm -rf "pre-deploy_${TIMESTAMP}" \
    && log_ok "Бэкап: backups/pre-deploy_${TIMESTAMP}.tar.gz"
  cd "$PROJECT_DIR"
  step_complete "BACKUP"
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 2: GIT PULL
# ═══════════════════════════════════════════════════════════
if step_done "GIT"; then
  log_info "[пропуск] Git pull уже выполнен в этом деплое"
else
  log_step "2/7 Обновление кода"
  if git remote -v 2>/dev/null | grep -q "origin"; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
    git stash push -m "pre-deploy-${TIMESTAMP}" 2>/dev/null || true
    if git pull origin "$BRANCH" --rebase 2>&1; then
      git stash pop 2>/dev/null || true
      COMMITS=$(git rev-list --count "HEAD@{1}..HEAD" 2>/dev/null || echo "?")
      log_ok "Получено $COMMITS новых коммитов (ветка: $BRANCH)"
    else
      git rebase --abort 2>/dev/null || true
      git stash pop 2>/dev/null || true
      log_warn "git pull не удался. Продолжаю с текущим кодом."
    fi
  else
    log_warn "Git remote не настроен. Пропускаю git pull."
  fi
  # Обновить домен в nginx.conf
  DOMAIN="${N8N_HOST:-}"
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ -f "$PROJECT_DIR/nginx/nginx.conf" ]; then
    sed -i "s/your-domain\.com/${DOMAIN}/g" "$PROJECT_DIR/nginx/nginx.conf" 2>/dev/null || true
  fi
  step_complete "GIT"
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 3: СБОРКА КОНТЕЙНЕРОВ
# ═══════════════════════════════════════════════════════════
if step_done "BUILD"; then
  log_info "[пропуск] Сборка уже выполнена в этом деплое"
else
  log_step "3/7 Сборка"
  if [ "$DEPLOY_MODE" = "--quick" ]; then
    log_info "Quick-режим: пересобираю только dashboard"
    docker compose build dashboard
  else
    docker compose build
  fi
  step_complete "BUILD"
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 4: ЗАПУСК КОНТЕЙНЕРОВ
# ═══════════════════════════════════════════════════════════
if step_done "CONTAINERS"; then
  log_info "[пропуск] Контейнеры уже запущены в этом деплое"
else
  log_step "4/7 Запуск контейнеров"
  if [ "$DEPLOY_MODE" = "--quick" ]; then
    docker compose up -d dashboard
  else
    docker compose up -d --remove-orphans
  fi
  # Ждём базовые сервисы
  wait_healthy "content-factory-postgres"  90  || true
  wait_healthy "content-factory-redis"     60  || true
  wait_healthy "content-factory-minio"     60  || true
  wait_healthy "content-factory-n8n"       120 || true
  wait_healthy "content-factory-dashboard" 60  || true
  step_complete "CONTAINERS"
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 5: DB МИГРАЦИИ
# ═══════════════════════════════════════════════════════════
if step_done "MIGRATE"; then
  log_info "[пропуск] Миграции уже выполнены в этом деплое"
else
  run_migrations
  step_complete "MIGRATE"
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 6: СИНХРОНИЗАЦИЯ N8N WORKFLOWS
# ═══════════════════════════════════════════════════════════
if [ "$DEPLOY_MODE" != "--quick" ]; then
  if step_done "WORKFLOWS"; then
    log_info "[пропуск] Workflows уже синхронизированы в этом деплое"
  else
    sync_n8n_workflows
    step_complete "WORKFLOWS"
  fi
fi

# ═══════════════════════════════════════════════════════════
# ШАГ 7: ФИНАЛЬНАЯ ПРОВЕРКА
# ═══════════════════════════════════════════════════════════
log_step "7/7 Финальная проверка"

HEALTH=$(curl -sf "http://127.0.0.1:3001/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"ok":true'; then
  if command -v python3 > /dev/null 2>&1; then
    DB_S=$(echo "$HEALTH"  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('database','?'))" 2>/dev/null || echo "?")
    MIO_S=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('minio','?'))"    2>/dev/null || echo "?")
    N8N_S=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('n8n','?'))"      2>/dev/null || echo "?")
  else
    DB_S=$(echo "$HEALTH"  | grep -oP '"database":\K[^,}]+' | tr -d '"' | head -1 || echo "?")
    MIO_S=$(echo "$HEALTH" | grep -oP '"minio":\K[^,}]+'    | tr -d '"' | head -1 || echo "?")
    N8N_S=$(echo "$HEALTH" | grep -oP '"n8n":\K[^,}]+'      | tr -d '"' | head -1 || echo "?")
  fi
  log_ok "Dashboard: OK (db=$DB_S, minio=$MIO_S, n8n=$N8N_S)"
else
  log_warn "Dashboard health не ответил. Проверьте: docker compose logs dashboard"
fi

echo
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps

# Очистить старые образы (старше 1 недели)
docker image prune -f --filter "until=168h" > /dev/null 2>&1 || true

# Сбросить флаги завершённых шагов (деплой успешен)
> "$STATE_FILE"
set_state "DEPLOY_ID" "$CURRENT_DEPLOY_ID"
set_state "LAST_DEPLOY" "$TIMESTAMP"

FINAL_HASH=$(git rev-parse HEAD 2>/dev/null || echo "N/A")
echo "[${TIMESTAMP}] DEPLOY OK | mode=$DEPLOY_MODE hash=${FINAL_HASH:0:8}" >> "$DEPLOY_LOG"

# ─── Итог ───
echo
echo -e "${BOLD}${GREEN}╔═════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   ✅ Деплой успешно завершён!                   ║${NC}"
echo -e "${BOLD}${GREEN}╚═════════════════════════════════════════════════╝${NC}"
echo
echo -e "  Время:      $(date '+%H:%M:%S')"
echo -e "  Режим:      $DEPLOY_MODE"
echo -e "  Коммит:     ${FINAL_HASH:0:8}"
echo -e "  Миграции:   ./scripts/migrations/"
echo -e "  Workflows:  ./workflows/"
echo -e "  Логи:       ./backups/deploy.log"
echo
echo -e "  Полезные команды:"
echo -e "  ${CYAN}docker compose logs -f dashboard${NC}      # логи dashboard"
echo -e "  ${CYAN}docker compose logs -f n8n${NC}            # логи n8n"
  echo -e "  ${CYAN}./scripts/migrate.sh${NC}                  # применить миграции"
  echo -e "  ${CYAN}./scripts/migrate.sh --status${NC}         # статус всех миграций"
  echo -e "  ${CYAN}./scripts/migrate.sh --check${NC}          # проверка подключения к БД"
  echo -e "  ${CYAN}./scripts/deploy.sh --migrate-only${NC}    # только миграции (через deploy)"
