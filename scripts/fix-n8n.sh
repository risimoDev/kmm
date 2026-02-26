#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# fix-n8n.sh — Диагностика и восстановление N8N
# Запуск: bash scripts/fix-n8n.sh [--reinstall] [--reset-workflows]
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Цвета ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
info() { echo -e "${CYAN}  → $*${NC}"; }
h1()   { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════${NC}"; echo -e "${BOLD}  $*${NC}"; echo -e "${BOLD}${BLUE}══════════════════════════════════════${NC}"; }
h2()   { echo -e "\n${BOLD}  $*${NC}"; }

REINSTALL=false
RESET_WORKFLOWS=false
for arg in "$@"; do
  case $arg in
    --reinstall)        REINSTALL=true ;;
    --reset-workflows)  RESET_WORKFLOWS=true ;;
  esac
done

cd "$(dirname "$0")/.." || { echo "Не удалось перейти в директорию проекта"; exit 1; }
PROJECT_DIR=$(pwd)

h1 "N8N Диагностика и восстановление"
info "Директория проекта: $PROJECT_DIR"

# ════════════════════════════════════════
# 1. ПРОВЕРКА .env
# ════════════════════════════════════════
h2 "1. Проверка .env"

if [ ! -f .env ]; then
  fail ".env файл не найден!"
  exit 1
fi
ok ".env файл существует"

# Загружаем .env
set -a; source .env; set +a

REQUIRED_VARS=(
  N8N_ENCRYPTION_KEY
  N8N_EDITOR_BASE_URL
  WEBHOOK_URL
  DB_POSTGRESDB_DATABASE
  DB_POSTGRESDB_USER
  DB_POSTGRESDB_PASSWORD
)

ENV_ERRORS=0
for var in "${REQUIRED_VARS[@]}"; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    fail "$var не задан в .env!"
    ENV_ERRORS=$((ENV_ERRORS+1))
  else
    len=${#val}
    masked="${val:0:4}****"
    ok "$var = ${masked} (длина: ${len})"
  fi
done

# Хелпер для запросов к N8N (поддерживает N8N_API_KEY и basic auth)
make_n8n_request() {
  local url="$1"
  local N8N_API_KEY_VAL="${N8N_API_KEY:-}"
  local N8N_USER="${N8N_BASIC_AUTH_USER:-}"
  local N8N_PASS="${N8N_BASIC_AUTH_PASSWORD:-}"
  if [ -n "$N8N_API_KEY_VAL" ]; then
    curl -sf --max-time 10 -H "X-N8N-API-KEY: ${N8N_API_KEY_VAL}" "$url" 2>/dev/null || echo "FAIL"
  elif [ -n "$N8N_USER" ] && [ -n "$N8N_PASS" ]; then
    curl -sf --max-time 10 -u "${N8N_USER}:${N8N_PASS}" "$url" 2>/dev/null || echo "FAIL"
  else
    curl -sf --max-time 10 "$url" 2>/dev/null || echo "FAIL"
  fi
}

# Проверка N8N_ENCRYPTION_KEY (минимум 32 символа)
KEY_LEN="${#N8N_ENCRYPTION_KEY}"
if [ "$KEY_LEN" -lt 32 ] 2>/dev/null; then
  fail "N8N_ENCRYPTION_KEY слишком короткий ($KEY_LEN символов, нужно ≥32)"
  ENV_ERRORS=$((ENV_ERRORS+1))
fi

# Проверка WEBHOOK_URL (должен быть https://)
if [[ "${WEBHOOK_URL:-}" != https://* ]]; then
  warn "WEBHOOK_URL не начинается с https:// → вебхуки могут не работать: ${WEBHOOK_URL:-пусто}"
fi

if [ $ENV_ERRORS -gt 0 ]; then
  fail "Найдено $ENV_ERRORS ошибок в .env, исправьте их перед продолжением"
  exit 1
fi

# ════════════════════════════════════════
# 2. СТАТУС КОНТЕЙНЕРОВ
# ════════════════════════════════════════
h2 "2. Статус контейнеров"

CONTAINERS=(content-factory-n8n content-factory-postgres content-factory-redis content-factory-nginx)
for c in "${CONTAINERS[@]}"; do
  status=$(docker inspect --format='{{.State.Status}}' "$c" 2>/dev/null || echo "not_found")
  health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo "")
  if [ "$status" = "running" ]; then
    if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
      ok "$c  [${status}/${health}]"
    else
      warn "$c  [${status}/${health}]"
    fi
  else
    fail "$c  [${status}]"
  fi
done

# ════════════════════════════════════════
# 3. ЛОГИ N8N (последние 50 строк)
# ════════════════════════════════════════
h2 "3. Последние ошибки в логах N8N"

N8N_ERRORS=$(docker logs content-factory-n8n --tail 100 2>&1 | grep -iE "error|FATAL|cannot|failed|permission|denied|EACCES|ENOENT|crash" | tail -20 || true)
if [ -n "$N8N_ERRORS" ]; then
  warn "Найдены ошибки в логах N8N:"
  echo "$N8N_ERRORS" | sed 's/^/    /'
else
  ok "Критических ошибок в последних 100 строках логов нет"
fi

# ════════════════════════════════════════
# 4. ПРАВА НА VOLUME N8N
# ════════════════════════════════════════
h2 "4. Права доступа к /home/node/.n8n (внутри контейнера)"

# Проверяем изнутри контейнера
INNER_LS=$(docker exec content-factory-n8n ls -la /home/node/.n8n/ 2>/dev/null || echo "нет доступа")
echo "$INNER_LS" | head -10 | sed 's/^/  /'
OWNER_INNER=$(docker exec content-factory-n8n stat -c '%u:%g' /home/node/.n8n 2>/dev/null || echo "?")
info "Владелец .n8n внутри контейнера: $OWNER_INNER"
if [ "$OWNER_INNER" != "1000:1000" ] && [ "$OWNER_INNER" != "0:0" ] && [ "$OWNER_INNER" != "?" ]; then
  warn "Неверный владелец $OWNER_INNER — исправляю..."
  docker exec -u root content-factory-n8n chown -R 1000:1000 /home/node/.n8n && ok "Права исправлены" || fail "Не удалось исправить права"
else
  ok "Права в норме ($OWNER_INNER)"
fi
# Путь volume
VOL_PATH=$(docker inspect content-factory-n8n --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || echo "")
[ -n "$VOL_PATH" ] && info "Volume path на хосте: $VOL_PATH" || true

# ════════════════════════════════════════
# 5. ПОДКЛЮЧЕНИЕ К POSTGRESQL
# ════════════════════════════════════════
h2 "5. Подключение к PostgreSQL"

PG_CHECK=$(docker exec content-factory-postgres psql -U "${DB_POSTGRESDB_USER}" -d "${DB_POSTGRESDB_DATABASE}" -c "SELECT version();" -t 2>&1 || echo "ERROR")
if echo "$PG_CHECK" | grep -q "PostgreSQL"; then
  ok "PostgreSQL доступен: $(echo $PG_CHECK | tr -d '\n' | cut -c1-60)"
else
  fail "PostgreSQL недоступен: $PG_CHECK"
fi

# Проверяем таблицы N8N
N8N_TABLES=$(docker exec content-factory-postgres psql -U "${DB_POSTGRESDB_USER}" -d "${DB_POSTGRESDB_DATABASE}" \
  -c "\dt" -t 2>/dev/null | grep -c "n8n\|execution\|workflow\|credential" || echo "0")
info "Таблицы N8N в БД: $N8N_TABLES"
if [ "$N8N_TABLES" -gt 0 ]; then
  ok "Таблицы N8N существуют"
else
  warn "Таблицы N8N ещё не созданы (нормально при первом запуске)"
fi

# ════════════════════════════════════════
# 6. ПРОВЕРКА N8N API
# ════════════════════════════════════════
h2 "6. Проверка N8N API"

N8N_HEALTH=$(curl -sf "http://localhost:5678/healthz" 2>/dev/null || echo "FAIL")
if echo "$N8N_HEALTH" | grep -qi "ok\|{}"; then
  ok "N8N healthz отвечает"
else
  fail "N8N healthz не отвечает: $N8N_HEALTH"
  info "Последние 20 строк логов n8n:"
  docker logs content-factory-n8n --tail 20 2>&1 | sed 's/^/    /'
fi

# Проверка авторизации
SETTINGS_RESP=$(curl -sf --max-time 5 "http://localhost:5678/rest/settings" 2>/dev/null || echo "FAIL")
if echo "$SETTINGS_RESP" | grep -q '"authenticationMethod"'; then
  AUTH_METHOD=$(echo "$SETTINGS_RESP" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('data',d).get('userManagement',{}).get('authenticationMethod','?'))" \
    2>/dev/null || echo "?")
  info "authenticationMethod: $AUTH_METHOD"
  if [ "$AUTH_METHOD" = "email" ]; then
    if [ -n "${N8N_API_KEY:-}" ]; then
      WF_TEST=$(make_n8n_request "http://localhost:5678/rest/workflows")
      if echo "$WF_TEST" | grep -q '"id"'; then
        ok "N8N_API_KEY работает"
      else
        warn "N8N_API_KEY устарел — пересоздайте: N8N UI → Settings → n8n API"
      fi
    else
      warn "N8N_API_KEY не задан! Добавьте в .env: N8N_API_KEY=n8n_api_xxx"
      warn "Создайте: N8N UI → Settings → n8n API → Create an API key"
    fi
  fi
else
  warn "REST API /rest/settings не ответил корректно"
fi

# ════════════════════════════════════════
# 7. ПРОВЕРКА WEBHOOK URL
# ════════════════════════════════════════
h2 "7. Проверка Webhook URL"

INNER_WEBHOOK="${WEBHOOK_URL}/webhook/"
WEBHOOK_TEST=$(curl -sf -o /dev/null -w "%{http_code}" "$INNER_WEBHOOK" 2>/dev/null || echo "000")
if [ "$WEBHOOK_TEST" = "404" ] || [ "$WEBHOOK_TEST" = "200" ] || [ "$WEBHOOK_TEST" = "302" ]; then
  ok "Вебхук URL доступен снаружи (HTTP $WEBHOOK_TEST) → ${WEBHOOK_URL}"
elif [ "$WEBHOOK_TEST" = "000" ]; then
  warn "Вебхук URL не отвечает (сетевая ошибка/таймаут) → возможно не прод-сервер"
else
  warn "Вебхук URL вернул HTTP $WEBHOOK_TEST → ${WEBHOOK_URL}"
fi

# ════════════════════════════════════════
# 8. ПРОВЕРКА NGINX
# ════════════════════════════════════════
h2 "8. Nginx"

if docker exec content-factory-nginx nginx -t 2>&1 | grep -q "ok"; then
  ok "Nginx конфигурация валидна"
else
  fail "Ошибка в конфигурации nginx:"
  docker exec content-factory-nginx nginx -t 2>&1 | sed 's/^/    /'
fi

# ════════════════════════════════════════
# 9. ВОРКФЛОУ — АКТИВАЦИЯ
# ════════════════════════════════════════
h2 "9. Статус воркфлоу"

WF_LIST=$(make_n8n_request "http://localhost:5678/rest/workflows")
if echo "$WF_LIST" | grep -q '"id"'; then
  ACTIVE_COUNT=$(echo "$WF_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data', d if isinstance(d,list) else []); print(sum(1 for w in lst if w.get('active')))" 2>/dev/null || echo "0")
  TOTAL_COUNT=$(echo "$WF_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data', d if isinstance(d,list) else []); print(len(lst))" 2>/dev/null || echo "0")
  info "Воркфлоу: $ACTIVE_COUNT активных из $TOTAL_COUNT"
  if [ "$ACTIVE_COUNT" -lt 3 ] 2>/dev/null; then
    warn "Мало активных воркфлоу! Нужно активировать хотя бы: 01-content-brain, 02-video-factory, 03-publisher"
  else
    ok "Воркфлоу активированы"
  fi
else
  if [ -z "${N8N_API_KEY:-}" ]; then
    warn "N8N_API_KEY не задан — список воркфлоу недоступен"
  else
    warn "Не удалось получить список воркфлоу"
  fi
fi

# ════════════════════════════════════════
# 10. ИМПОРТ ВОРКФЛОУ (если нужен)
# ════════════════════════════════════════
h2 "10. Проверка импорта воркфлоу"

TOTAL_WF_RESP=$(make_n8n_request "http://localhost:5678/rest/workflows")
TOTAL_WF=$(echo "$TOTAL_WF_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data', d if isinstance(d,list) else []); print(len(lst))" 2>/dev/null || echo "0")

if [ "$TOTAL_WF" -lt 5 ]; then
  warn "В N8N меньше 5 воркфлоу ($TOTAL_WF найдено). Импортирую из ./workflows/..."
  for wf_file in ./workflows/*.json; do
    [ -f "$wf_file" ] || continue
    wf_name=$(basename "$wf_file" .json)
    IMPORT_RESULT=$(docker exec content-factory-n8n \
      n8n import:workflow --input="/home/node/workflows/$(basename $wf_file)" 2>&1 || echo "ERROR")
    if echo "$IMPORT_RESULT" | grep -qi "imported\|success\|Imported"; then
      ok "Импортирован: $wf_name"
    elif echo "$IMPORT_RESULT" | grep -qi "already exists\|already imported"; then
      info "Уже существует: $wf_name"
    else
      warn "Импорт $wf_name: $IMPORT_RESULT"
    fi
  done
else
  ok "Воркфлоу уже загружены ($TOTAL_WF шт.)"
fi

# ════════════════════════════════════════
# ПОЛНАЯ ПЕРЕУСТАНОВКА (--reinstall)
# ════════════════════════════════════════
if [ "$REINSTALL" = true ]; then
  h1 "ПОЛНАЯ ПЕРЕУСТАНОВКА N8N"
  warn "Это удалит данные N8N (воркфлоу, credentials, настройки)!"
  warn "Данные PostgreSQL и Dashboard НЕ затрагиваются."
  read -p "Продолжить? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Отменено."
    exit 0
  fi

  info "Останавливаю N8N..."
  docker compose stop n8n
  docker rm -f content-factory-n8n 2>/dev/null || true

  info "Удаляю volume n8n_data..."
  docker volume rm n8n_data 2>/dev/null || true

  info "Пересборка образа N8N..."
  docker compose build --no-cache n8n

  info "Запуск N8N..."
  docker compose up -d n8n

  info "Ожидание готовности N8N (60 сек)..."
  sleep 60

  # Проверяем готовность
  for i in $(seq 1 12); do
    HEALTH=$(curl -sf "http://localhost:5678/healthz" 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -qi "ok\|{}"; then
      ok "N8N готов!"
      break
    fi
    info "Ожидание... ($((i*5))s)"
    sleep 5
  done

  # Импортируем воркфлоу после переустановки
  info "Импорт воркфлоу..."
  sleep 5
  for wf_file in ./workflows/*.json; do
    [ -f "$wf_file" ] || continue
    docker exec content-factory-n8n \
      n8n import:workflow --input="/home/node/workflows/$(basename $wf_file)" 2>&1 \
      | grep -iE "imported|error|warn" | sed 's/^/    /' || true
  done

  ok "Переустановка завершена!"
  warn "Не забудьте:"
  warn "  1. Зайти в N8N и создать credential 'A2E API' (Header Auth: Authorization = Bearer TOKEN)"
  warn "  2. Активировать воркфлоу: 01, 02, 02a, 02c, 03"
  warn "  3. Если нужно — пересоздать Telegram бот-вебхук"
fi

# ════════════════════════════════════════
# ИТОГ
# ════════════════════════════════════════
h1 "Итог"

# Быстрый финальный тест
FINAL_HEALTH=$(curl -sf "http://localhost:5678/healthz" 2>/dev/null || echo "FAIL")
if echo "$FINAL_HEALTH" | grep -qi "ok\|{}"; then
  ok "N8N работает: http://localhost:5678"
  ok "N8N через nginx: ${N8N_EDITOR_BASE_URL:-https://YOUR_DOMAIN/n8n/}"
else
  fail "N8N не отвечает — нужна ручная проверка логов: docker logs content-factory-n8n --tail 50"
fi

echo ""
info "Полезные команды:"
echo "  docker logs content-factory-n8n --tail 50 -f      # следить за логами"
echo "  docker exec content-factory-n8n n8n --version     # версия N8N"
echo "  docker compose restart n8n                         # перезапуск"
echo "  bash scripts/fix-n8n.sh --reinstall                # полный сброс"
echo ""
