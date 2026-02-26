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
echo -e "${BOLD}[4] REST API (авторизация)${NC}"
API_RESP=$(curl -sf --max-time 5 \
  -u "${N8N_BASIC_AUTH_USER:-admin}:${N8N_BASIC_AUTH_PASSWORD:-}" \
  "http://localhost:5678/rest/settings" 2>/dev/null | head -c 200 || echo "FAIL")
if echo "$API_RESP" | grep -qi "timezone\|instanceId\|oauthCallbackUrl"; then
  ok "REST API /rest/settings — OK"
  dim "N8N_BASIC_AUTH работает"
else
  fail "REST API не отвечает или неверный логин/пароль"
  dim "Ответ: $API_RESP"
  warn "Переменные: N8N_BASIC_AUTH_USER=${N8N_BASIC_AUTH_USER:-ПУСТО}"
fi

echo ""
echo -e "${BOLD}[5] Воркфлоу${NC}"
WF=$(curl -sf --max-time 10 \
  -u "${N8N_BASIC_AUTH_USER:-admin}:${N8N_BASIC_AUTH_PASSWORD:-}" \
  "http://localhost:5678/rest/workflows" 2>/dev/null || echo "FAIL")
if echo "$WF" | grep -q '"id"'; then
  TOTAL=$(echo "$WF" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',d)))" 2>/dev/null || echo "$WF" | grep -o '"id"' | wc -l)
  ACTIVE=$(echo "$WF" | python3 -c "import sys,json; d=json.load(sys.stdin); lst=d.get('data',d); print(sum(1 for w in lst if w.get('active')))" 2>/dev/null || echo "$WF" | grep -o '"active":true' | wc -l)
  echo "  Всего: $TOTAL | Активных: $ACTIVE"
  if [ "$ACTIVE" -lt 3 ]; then
    warn "Мало активных воркфлоу! Активируйте в UI: /n8n/"
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
  warn "Не удалось получить список воркфлоу (api недоступен или нет воркфлоу)"
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
info "N8N_ENCRYPTION_KEY  = ****(длина: ${#N8N_ENCRYPTION_KEY})"
if [ "${#N8N_ENCRYPTION_KEY}" -lt 32 ]; then
  warn "N8N_ENCRYPTION_KEY меньше 32 символов — может вызывать проблемы с credentials!"
fi

echo ""
echo -e "${BOLD}[8] Права на volume n8n_data${NC}"
VOL=$(docker volume inspect n8n_data --format '{{.Mountpoint}}' 2>/dev/null || echo "")
if [ -n "$VOL" ] && [ -d "$VOL" ]; then
  OWNER=$(stat -c '%u:%g' "$VOL")
  info "Путь: $VOL | Владелец: $OWNER"
  if [ "$OWNER" = "1000:1000" ]; then ok "Права корректны (1000:1000 = node)"
  else warn "Неверный владелец $OWNER (ожидается 1000:1000)"; fi
  ls -la "$VOL" 2>/dev/null | head -10 | sed 's/^/  /'
else
  warn "Volume n8n_data не найден или путь недоступен"
fi

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
echo -e "${BOLD}Использование:${NC}"
echo "  bash scripts/check-n8n.sh             # только диагностика"
echo "  bash scripts/fix-n8n.sh               # диагностика + автоисправление"
echo "  bash scripts/fix-n8n.sh --reinstall   # полная переустановка N8N"
echo ""
