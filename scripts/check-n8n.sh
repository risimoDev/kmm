#!/bin/bash
# check-n8n.sh — Быстрая проверка состояния N8N (только чтение, ничего не меняет)
# Запуск: bash scripts/check-n8n.sh

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; GRAY='\033[0;90m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
info() { echo -e "${CYAN}→${NC} $*"; }
dim()  { echo -e "${GRAY}  $*${NC}"; }

echo -e "\n${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      N8N DIAGNOSTICS CHECK               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}\n"

cd "$(dirname "$0")/.."

# Загружаем .env
if [ -f .env ]; then set -a; source .env; set +a; ok ".env загружен"
else fail ".env не найден!"; exit 1; fi

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

echo ""
echo -e "${BOLD}[1] Контейнеры${NC}"
docker compose ps --format "  {{.Name}}\t{{.Status}}" 2>/dev/null || docker ps --format "  {{.Names}}\t{{.Status}}" | grep content-factory

echo ""
echo -e "${BOLD}[2] N8N версия и uptime${NC}"
docker exec content-factory-n8n n8n --version 2>/dev/null \
  && info "Uptime контейнера: $(docker inspect content-factory-n8n --format='{{.State.StartedAt}}' 2>/dev/null)" \
  || fail "Не удалось получить версию n8n"

echo ""
echo -e "${BOLD}[3] Health endpoint${NC}"
HEALTH=$(curl -sf --max-time 5 "http://localhost:5678/healthz" 2>/dev/null || echo "TIMEOUT/FAIL")
if echo "$HEALTH" | grep -qi "ok\|{}"; then
  ok "http://localhost:5678/healthz → $HEALTH"
else
  fail "http://localhost:5678/healthz → $HEALTH"
  echo ""
  warn "Последние 30 строк логов:"
  docker logs content-factory-n8n --tail 30 2>&1 | sed 's/^/  /'
fi

echo ""
echo -e "${BOLD}[4] REST API / Метод авторизации${NC}"
SETTINGS_PUBLIC=$(curl -sf --max-time 5 "http://localhost:5678/rest/settings" 2>/dev/null || echo "FAIL")
if echo "$SETTINGS_PUBLIC" | grep -q '"authenticationMethod"'; then
  AUTH_METHOD=$(echo "$SETTINGS_PUBLIC" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); print(d.get('data',d).get('userManagement',{}).get('authenticationMethod','?'))" \
    2>/dev/null || echo "?")
  info "authenticationMethod: $AUTH_METHOD"
  N8N_API_KEY_VAL="${N8N_API_KEY:-}"
  if [ "$AUTH_METHOD" = "email" ]; then
    info "N8N использует User Management (email-аутентификация)"
    if [ -n "$N8N_API_KEY_VAL" ]; then
      WF_TEST=$(make_n8n_request "http://localhost:5678/rest/workflows")
      if echo "$WF_TEST" | grep -q '"id"'; then
        ok "N8N_API_KEY работает корректно"
      else
        fail "N8N_API_KEY задан, но API вернул ошибку — ключ устарел или неверен"
        dim "Пересоздайте: N8N UI → Settings → n8n API"
      fi
    else
      warn "N8N_API_KEY не задан — API вызовы недоступны"
      warn "Создайте: N8N UI → Settings → n8n API → Create API Key"
      warn "Добавьте в .env: N8N_API_KEY=n8n_api_xxxxxxxxxx"
    fi
  elif [ "$AUTH_METHOD" = "basicAuth" ]; then
    ok "Basic Auth: ${N8N_BASIC_AUTH_USER:-не задан}"
  fi
elif [ "$SETTINGS_PUBLIC" = "FAIL" ]; then
  fail "/rest/settings недоступен — N8N не отвечает"
else
  dim "Ответ: ${SETTINGS_PUBLIC:0:200}"
fi

echo ""
echo -e "${BOLD}[5] Воркфлоу${NC}"
WF=$(make_n8n_request "http://localhost:5678/rest/workflows")
if echo "$WF" | grep -q '"id"'; then
  TOTAL=$(echo "$WF" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data', d if isinstance(d,list) else []); print(len(lst))" 2>/dev/null || echo "?")
  ACTIVE=$(echo "$WF" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data', d if isinstance(d,list) else []); print(sum(1 for w in lst if w.get('active')))" 2>/dev/null || echo "?")
  info "Всего: $TOTAL | Активных: $ACTIVE"
  if [ "$ACTIVE" != "?" ] && [ "${ACTIVE}" -lt 3 ] 2>/dev/null; then
    warn "Мало активных воркфлоу — активируйте в UI: ${N8N_EDITOR_BASE_URL:-/n8n/}"
  else
    ok "Воркфлоу активированы"
  fi
  # Показываем список
  echo "$WF" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  lst=d.get('data',d)
  for w in lst:
    status='✓' if w.get('active') else '✗'
    print(f'  {status} [{w.get(\"id\",\"?\")}] {w.get(\"name\",\"?\")}')
except: pass
" 2>/dev/null || true
else
  if [ -z "${N8N_API_KEY:-}" ]; then
    warn "N8N_API_KEY не задан — список воркфлоу недоступен"
  else
    warn "Не удалось получить список воркфлоу"
    dim "${WF:0:200}"
  fi
fi

echo ""
echo -e "${BOLD}[6] База данных (PostgreSQL)${NC}"
PG=$(docker exec content-factory-postgres psql \
  -U "${DB_POSTGRESDB_USER}" -d "${DB_POSTGRESDB_DATABASE}" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" -t 2>/dev/null | tr -d ' ' || echo "FAIL")
if [[ "$PG" =~ ^[0-9]+$ ]]; then
  ok "PostgreSQL подключен, таблиц в БД: $PG"
else
  fail "PostgreSQL: $PG"
fi

echo ""
echo -e "${BOLD}[7] Переменные N8N${NC}"
info "N8N_EDITOR_BASE_URL = ${N8N_EDITOR_BASE_URL:-ПУСТО ⚠}"
info "WEBHOOK_URL         = ${WEBHOOK_URL:-ПУСТО ⚠}"
info "N8N_HOST            = ${N8N_HOST:-localhost}"
ENC_KEY_LEN="${#N8N_ENCRYPTION_KEY}"
info "N8N_ENCRYPTION_KEY  = ****(длина: ${ENC_KEY_LEN})"
if [ -n "${N8N_API_KEY:-}" ]; then
  API_KEY_LEN="${#N8N_API_KEY}"
  info "N8N_API_KEY         = ****(длина: ${API_KEY_LEN})"
else
  warn "N8N_API_KEY         = НЕ ЗАДАН"
fi
if [ "$ENC_KEY_LEN" -lt 32 ]; then
  warn "N8N_ENCRYPTION_KEY меньше 32 символов — может вызывать проблемы с credentials!"
fi

echo ""
echo -e "${BOLD}[8] Права на /home/node/.n8n (внутри контейнера)${NC}"
INNER=$(docker exec content-factory-n8n ls -la /home/node/.n8n/ 2>/dev/null || echo "нет доступа")
echo "$INNER" | head -10 | sed 's/^/  /'
OWNER_INNER=$(docker exec content-factory-n8n stat -c '%u:%g' /home/node/.n8n 2>/dev/null || echo "?")
info "Владелец .n8n: $OWNER_INNER"
if [ "$OWNER_INNER" = "1000:1000" ] || [ "$OWNER_INNER" = "0:0" ] || [ "$OWNER_INNER" = "?" ]; then
  ok "Права в норме"
else
  warn "Неожиданный владелец: $OWNER_INNER"
fi
# Дополнительно: путь к volume на хосте (может быть недоступен)
VOL_PATH=$(docker inspect content-factory-n8n --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || echo "")
[ -n "$VOL_PATH" ] && dim "Volume path на хосте: $VOL_PATH" || true

echo ""
echo -e "${BOLD}[9] Nginx${NC}"
if docker exec content-factory-nginx nginx -t 2>&1 | grep -q "successful"; then
  ok "Nginx конфигурация OK"
else
  fail "Ошибка в nginx.conf:"
  docker exec content-factory-nginx nginx -t 2>&1 | sed 's/^/  /'
fi

echo ""
echo -e "${BOLD}[10] Последние ошибки в логах N8N${NC}"
ERRORS=$(docker logs content-factory-n8n --tail 200 2>&1 \
  | grep -iE "error|FATAL|EACCES|ENOENT|permission denied|Cannot|Unhandled" \
  | grep -v "ECONNREFUSED\|EHOSTUNREACH\|healthz\|telemetry\|posthog" \
  | tail -15 || true)
if [ -n "$ERRORS" ]; then
  warn "Ошибки найдены:"
  echo "$ERRORS" | sed 's/^/  /'
else
  ok "Критических ошибок в логах нет"
fi

echo ""
echo -e "${BOLD}════════════════════════════════════════════${NC}"
if [ -z "${N8N_API_KEY:-}" ]; then
  echo -e "\n${YELLOW}⚠  Добавьте N8N_API_KEY в .env для полной диагностики:${NC}"
  echo "   1. Откройте ${N8N_EDITOR_BASE_URL:-https://YOUR_DOMAIN/n8n/}"
  echo "   2. Settings → n8n API → Create an API key"
  echo "   3. echo 'N8N_API_KEY=n8n_api_xxx' >> .env"
  echo "   4. docker compose up -d n8n"
fi
echo -e "${BOLD}Использование:${NC}"
echo "  bash scripts/check-n8n.sh             # только диагностика"
echo "  bash scripts/fix-n8n.sh               # диагностика + автоисправление"
echo "  bash scripts/fix-n8n.sh --reinstall   # полная переустановка N8N"
echo ""
