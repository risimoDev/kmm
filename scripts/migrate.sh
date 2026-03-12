#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Контент Завод — Умный менеджер миграций БД v1
# ═══════════════════════════════════════════════════════════════════════
# Использование:
#   ./scripts/migrate.sh               # применить все pending миграции
#   ./scripts/migrate.sh --status      # статус всех миграций
#   ./scripts/migrate.sh --dry-run     # что будет применено (без изменений)
#   ./scripts/migrate.sh --check       # только проверка подключения к БД
#   ./scripts/migrate.sh --mark-all    # ⚠️ пометить всё как применённое (emergency)
#
# Файлы миграций: scripts/migrations/YYYYMMDD_NNN_name.sql
# Таблица учёта:  schema_migrations (version, applied_at, checksum)
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Цвета ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
log_ok()    { echo -e "${GREEN}✅${NC} $*"; }
log_warn()  { echo -e "${YELLOW}⚠️${NC}  $*"; }
log_error() { echo -e "${RED}❌${NC} $*" >&2; }
log_step()  { echo -e "\n${BOLD}${CYAN}─── $* ───${NC}"; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$PROJECT_DIR/scripts/migrations"
MODE="${1:---run}"
EXIT_CODE=0

CONTAINER="content-factory-postgres"

# ─── Загрузка .env ───
if [ ! -f "$PROJECT_DIR/.env" ]; then
  log_error ".env не найден! Скопируйте .env.example в .env и настройте."
  exit 1
fi
# shellcheck disable=SC1091
set -a; source "$PROJECT_DIR/.env" 2>/dev/null || true; set +a

DB_USER="${DB_POSTGRESDB_USER:-n8n_user}"
DB_NAME="${DB_POSTGRESDB_DATABASE:-n8n}"

# ─── Заголовок ───
header() {
  echo -e "${BOLD}${CYAN}"
  echo "╔═══════════════════════════════════════════════════╗"
  echo "║   🗄️  КОНТЕНТ ЗАВОД — Менеджер миграций          ║"
  printf "║   DB: %-44s║\n" "${DB_NAME}@${CONTAINER}"
  echo "╚═══════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

# ─── Проверка Docker и контейнера ───
check_container() {
  if ! command -v docker &>/dev/null; then
    log_error "docker не найден. Установите Docker."
    return 1
  fi

  local STATUS
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")

  case "$STATUS" in
    running)
      local HEALTH
      HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "none")
      if [ "$HEALTH" = "unhealthy" ]; then
        log_error "Контейнер $CONTAINER — unhealthy"
        docker logs "$CONTAINER" --tail=10 2>/dev/null || true
        return 1
      fi
      ;;
    missing)
      log_error "Контейнер $CONTAINER не найден. Запустите: docker compose up -d postgres"
      return 1
      ;;
    *)
      log_error "Контейнер $CONTAINER — статус: $STATUS. Запустите: docker compose start postgres"
      return 1
      ;;
  esac
  return 0
}

# ─── psql: выполнить одну команду ───
psql_q() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAqc "$1" 2>/dev/null || echo ""
}

# ─── psql: выполнить файл ───
psql_file() {
  docker exec -i "$CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" \
    --set ON_ERROR_STOP=1 \
    --set VERBOSITY=default \
    < "$1"
}

# ─── psql: выполнить файл с выводом ошибок ───
psql_file_stderr() {
  docker exec -i "$CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" \
    --set ON_ERROR_STOP=1 \
    < "$1" 2>&1
}

# ─── Инициализация таблицы миграций ───
init_migrations_table() {
  psql_q "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ  DEFAULT NOW(),
      checksum    VARCHAR(64)
    );
  " > /dev/null

  # Добавить checksum если колонки ещё нет (совместимость со старой версией)
  psql_q "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);" \
    > /dev/null 2>&1 || true
}

# ─── Контрольная сумма файла ───
file_checksum() {
  sha256sum "$1" 2>/dev/null | cut -d' ' -f1 \
    || md5sum "$1" 2>/dev/null | cut -d' ' -f1 \
    || echo "no-checksum"
}

# ─── Собрать список файлов миграций ───
collect_migrations() {
  if [ ! -d "$MIGRATIONS_DIR" ]; then
    log_warn "Директория миграций не найдена: $MIGRATIONS_DIR"
    echo ""
    return
  fi
  # Вернуть файлы, отсортированные по имени
  find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort
}

# ══════════════════════════════════════════════════════════════════
# РЕЖИМ --check: только проверка подключения к БД
# ══════════════════════════════════════════════════════════════════
if [ "$MODE" = "--check" ]; then
  header
  log_step "Проверка подключения к БД"

  check_container || exit 1

  RESULT=$(docker exec "$CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tAqc "SELECT version();" 2>&1 || echo "ERROR")

  if echo "$RESULT" | grep -qi "error\|fatal"; then
    log_error "Не удалось подключиться к БД: $RESULT"
    exit 1
  fi

  log_ok "Подключение: ${RESULT%%,*}"

  TABLES=$(psql_q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
  MIGRATIONS_COUNT=$(psql_q "SELECT count(*) FROM schema_migrations;" 2>/dev/null || echo "0 (таблица не создана)")

  log_info "Таблиц в БД:       ${TABLES:-?}"
  log_info "Записей миграций:  ${MIGRATIONS_COUNT:-0}"

  # Список таблиц
  echo
  echo -e "${DIM}  Таблицы в public:${NC}"
  psql_q "
    SELECT '  • ' || table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
  " | while IFS= read -r line; do echo -e "${DIM}${line}${NC}"; done
  echo

  log_ok "БД доступна и работает корректно."
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# Общая инициализация для остальных режимов
# ══════════════════════════════════════════════════════════════════
header
check_container || exit 1
init_migrations_table

mapfile -t MIG_FILES < <(collect_migrations)
TOTAL=${#MIG_FILES[@]}

if [ "$TOTAL" -eq 0 ]; then
  log_info "Нет файлов миграций в $MIGRATIONS_DIR"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# РЕЖИМ --status: таблица статуса всех миграций
# ══════════════════════════════════════════════════════════════════
if [ "$MODE" = "--status" ]; then
  log_step "Статус миграций (${TOTAL} файлов)"
  echo

  PENDING_COUNT=0
  APPLIED_COUNT=0
  CHANGED_COUNT=0

  printf "  ${BOLD}%-46s  %-9s  %-16s  %s${NC}\n" "Версия" "Статус" "Применена" "Контрольная сумма"
  printf "  %s\n" "$(printf '─%.0s' {1..90})"

  for MIG_FILE in "${MIG_FILES[@]}"; do
    VERSION=$(basename "$MIG_FILE" .sql)
    CURR_CHECKSUM=$(file_checksum "$MIG_FILE")

    # Одним запросом получаем applied_at и checksum
    ROW=$(psql_q "SELECT to_char(applied_at,'YYYY-MM-DD HH24:MI'), checksum FROM schema_migrations WHERE version='${VERSION}';")

    if [ -z "$ROW" ]; then
      printf "  ${YELLOW}%-46s  %-9s${NC}\n" "$VERSION" "PENDING"
      PENDING_COUNT=$((PENDING_COUNT + 1))
    else
      APPLIED_AT=$(echo "$ROW" | cut -d'|' -f1)
      DB_CHECKSUM=$(echo "$ROW" | cut -d'|' -f2 | xargs 2>/dev/null || echo "")

      if [ -n "$DB_CHECKSUM" ] && [ "$DB_CHECKSUM" != "$CURR_CHECKSUM" ] && [ "$DB_CHECKSUM" != "no-checksum" ]; then
        printf "  ${RED}%-46s  %-9s  %-16s  ⚠️  изменён${NC}\n" "$VERSION" "CHANGED" "${APPLIED_AT:0:16}"
        CHANGED_COUNT=$((CHANGED_COUNT + 1))
      else
        printf "  ${GREEN}%-46s  %-9s  %-16s  %s${NC}\n" "$VERSION" "applied" "${APPLIED_AT:0:16}" "${DB_CHECKSUM:0:12}..."
        APPLIED_COUNT=$((APPLIED_COUNT + 1))
      fi
    fi
  done

  echo
  printf "  ${BOLD}Итого: ${GREEN}%d применено${NC}${BOLD}, ${YELLOW}%d ожидает${NC}${BOLD}%s${NC}\n" \
    "$APPLIED_COUNT" "$PENDING_COUNT" \
    "$([ "$CHANGED_COUNT" -gt 0 ] && echo ", ${RED}${CHANGED_COUNT} изменено${NC}" || echo "")"
  echo

  [ "$PENDING_COUNT" -gt 0 ] && log_warn "${PENDING_COUNT} миграций не применено → запустите: ./scripts/migrate.sh"
  [ "$CHANGED_COUNT"  -gt 0 ] && log_warn "Файлы уже применённых миграций изменились! Проверьте вручную."

  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# РЕЖИМ --mark-all: экстренно пометить всё как применённое
# ══════════════════════════════════════════════════════════════════
if [ "$MODE" = "--mark-all" ]; then
  log_warn "⚠️  Режим --mark-all: все миграции будут помечены как применённые БЕЗ выполнения SQL!"
  log_warn "    Используйте только если миграции уже были применены вручную."
  echo
  read -r -p "  Введите 'yes' для подтверждения: " CONFIRM
  [ "$CONFIRM" != "yes" ] && { log_info "Отменено."; exit 0; }
  echo

  MARKED=0
  for MIG_FILE in "${MIG_FILES[@]}"; do
    VERSION=$(basename "$MIG_FILE" .sql)
    CHECKSUM=$(file_checksum "$MIG_FILE")
    psql_q "INSERT INTO schema_migrations (version, checksum)
            VALUES ('${VERSION}','${CHECKSUM}')
            ON CONFLICT (version) DO NOTHING;" > /dev/null
    log_ok "  Помечена: $VERSION"
    MARKED=$((MARKED + 1))
  done

  echo
  log_ok "Готово. ${MARKED} миграций помечены как применённые."
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# Определить pending миграции (для --dry-run и --run)
# ══════════════════════════════════════════════════════════════════
log_step "Анализ миграций"

PENDING_LIST=()
for MIG_FILE in "${MIG_FILES[@]}"; do
  VERSION=$(basename "$MIG_FILE" .sql)
  ALREADY=$(psql_q "SELECT 1 FROM schema_migrations WHERE version='${VERSION}';")
  [ "$ALREADY" != "1" ] && PENDING_LIST+=("$MIG_FILE")
done

PENDING=${#PENDING_LIST[@]}
ALREADY_APPLIED=$(( TOTAL - PENDING ))

echo
printf "  Всего файлов:    %d\n" "$TOTAL"
printf "  Уже применено:   %d\n" "$ALREADY_APPLIED"
printf "  Ожидает:         %d\n" "$PENDING"
echo

# ══════════════════════════════════════════════════════════════════
# РЕЖИМ --dry-run
# ══════════════════════════════════════════════════════════════════
if [ "$MODE" = "--dry-run" ]; then
  if [ "$PENDING" -eq 0 ]; then
    log_ok "БД актуальна. Нет миграций для применения."
    exit 0
  fi

  log_step "Dry-run: будут применены"
  for MIG_FILE in "${PENDING_LIST[@]}"; do
    VERSION=$(basename "$MIG_FILE" .sql)
    LINES=$(wc -l < "$MIG_FILE" 2>/dev/null || echo "?")
    printf "  ${CYAN}→${NC}  %-46s  (%s строк)\n" "$VERSION" "$LINES"
  done

  echo
  log_warn "Dry-run завершён. Для применения запустите: ./scripts/migrate.sh"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
# РЕЖИМ --run (default): применить pending миграции
# ══════════════════════════════════════════════════════════════════
if [ "$PENDING" -eq 0 ]; then
  log_ok "БД актуальна. Все ${TOTAL} миграций применены."
  exit 0
fi

log_step "Применение ${PENDING} миграций"
echo

APPLIED=0
FAILED=0
FAILED_LIST=()

for MIG_FILE in "${PENDING_LIST[@]}"; do
  VERSION=$(basename "$MIG_FILE" .sql)
  LINES=$(wc -l < "$MIG_FILE" 2>/dev/null || echo "?")

  printf "  ${CYAN}→${NC}  %-46s  (%4s стр)  " "$VERSION" "$LINES"

  # Применить миграцию
  PSQL_ERR=$(psql_file "$MIG_FILE" 2>&1 >/dev/null) && PSQL_OK=true || PSQL_OK=false

  if $PSQL_OK; then
    CHECKSUM=$(file_checksum "$MIG_FILE")
    psql_q "INSERT INTO schema_migrations (version, checksum)
            VALUES ('${VERSION}','${CHECKSUM}')
            ON CONFLICT (version) DO NOTHING;" > /dev/null
    echo -e "${GREEN}✓ OK${NC}"
    APPLIED=$((APPLIED + 1))
  else
    echo -e "${RED}✗ ОШИБКА${NC}"
    # Вывести детали ошибки
    echo "$PSQL_ERR" \
      | grep -E 'ERROR|FATAL|DETAIL|CONTEXT|HINT' \
      | sed 's/^/     /' \
      | head -8 \
      | while IFS= read -r line; do echo -e "     ${RED}${line}${NC}"; done
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$VERSION")
    # Продолжаем попытку остальных (каждая миграция независима)
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  log_ok "Успешно применено: ${APPLIED}/${PENDING} миграций."
else
  log_warn "Применено: ${APPLIED}, ошибок: ${FAILED}"
  for V in "${FAILED_LIST[@]}"; do
    log_error "  Не применена: $V"
  done
  EXIT_CODE=1
fi

exit $EXIT_CODE
