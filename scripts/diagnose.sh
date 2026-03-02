#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Контент Завод — Полная диагностика продакшена
# ═══════════════════════════════════════════════════════════
# Запуск на сервере:
#   bash scripts/diagnose.sh
#   или: chmod +x scripts/diagnose.sh && ./scripts/diagnose.sh
#
# Проверяет:
#   1. Docker / docker compose
#   2. Все контейнеры (статус, перезапуски, health)
#   3. Порты (80, 443, 3001, 5678, 5432, 6379, 9000)
#   4. Nginx конфигурация + SSL сертификаты
#   5. Upstream connectivity (nginx → dashboard, nginx → n8n)
#   6. PostgreSQL подключение + таблицы
#   7. Redis подключение
#   8. MinIO health
#   9. Dashboard health API
#  10. N8N health API
#  11. DNS / внешний доступ
#  12. Диск / память / CPU
#  13. Логи (последние ошибки)
#  14. Авторизация SSL (certbot)
# ═══════════════════════════════════════════════════════════

set -uo pipefail

# ─── Цвета ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

OK="${GREEN}✅${NC}"
FAIL="${RED}❌${NC}"
WARN="${YELLOW}⚠️${NC}"
INFO="${CYAN}ℹ️${NC}"

ISSUES=0
WARNINGS=0

ok()   { echo -e "   ${OK} $1"; }
fail() { echo -e "   ${FAIL} $1"; ISSUES=$((ISSUES+1)); }
warn() { echo -e "   ${WARN} $1"; WARNINGS=$((WARNINGS+1)); }
info() { echo -e "   ${INFO} $1"; }
header() { echo -e "\n${BOLD}${CYAN}── $1 ──${NC}"; }

# Определение директории проекта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

DOMAIN="k-m-m.ru"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║   🔍 КОНТЕНТ ЗАВОД — Диагностика продакшена     ║"
echo "║          $(date '+%Y-%m-%d %H:%M:%S')                      ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ══════════════════════════════════════
# 1. Docker
# ══════════════════════════════════════
header "1. Docker Engine"

if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker --version 2>/dev/null | head -1)
    ok "Docker: $DOCKER_VER"
else
    fail "Docker не установлен!"
fi

if docker compose version &>/dev/null; then
    COMPOSE_VER=$(docker compose version --short 2>/dev/null)
    ok "Docker Compose: $COMPOSE_VER"
elif docker-compose --version &>/dev/null; then
    COMPOSE_VER=$(docker-compose --version 2>/dev/null)
    ok "Docker Compose (legacy): $COMPOSE_VER"
else
    fail "Docker Compose не найден!"
fi

if docker info &>/dev/null; then
    ok "Docker daemon запущен"
else
    fail "Docker daemon НЕ запущен (sudo systemctl start docker)"
fi

# ══════════════════════════════════════
# 2. Контейнеры
# ══════════════════════════════════════
header "2. Контейнеры"

CONTAINERS=(
    "content-factory-nginx"
    "content-factory-dashboard"
    "content-factory-n8n"
    "content-factory-postgres"
    "content-factory-redis"
    "content-factory-minio"
)

for CNAME in "${CONTAINERS[@]}"; do
    SHORT="${CNAME#content-factory-}"
    
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${CNAME}$"; then
        fail "${SHORT}: контейнер НЕ СУЩЕСТВУЕТ"
        continue
    fi
    
    STATE=$(docker inspect --format='{{.State.Status}}' "$CNAME" 2>/dev/null)
    HEALTH=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CNAME" 2>/dev/null)
    RESTARTS=$(docker inspect --format='{{.RestartCount}}' "$CNAME" 2>/dev/null)
    STARTED=$(docker inspect --format='{{.State.StartedAt}}' "$CNAME" 2>/dev/null | cut -c1-19)
    
    STATUS_LINE="${SHORT}: state=${STATE}, health=${HEALTH}, restarts=${RESTARTS}, started=${STARTED}"
    
    if [ "$STATE" != "running" ]; then
        fail "$STATUS_LINE"
        # Показать причину остановки
        EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' "$CNAME" 2>/dev/null)
        ERROR=$(docker inspect --format='{{.State.Error}}' "$CNAME" 2>/dev/null)
        if [ -n "$ERROR" ]; then
            info "   Exit code: $EXIT_CODE, Error: $ERROR"
        fi
        # Последние 5 строк лога
        echo -e "${DIM}"
        docker logs --tail 5 "$CNAME" 2>&1 | sed 's/^/      /'
        echo -e "${NC}"
    elif [ "$HEALTH" = "unhealthy" ]; then
        fail "$STATUS_LINE"
        # Показать последний health check лог
        HEALTH_LOG=$(docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' "$CNAME" 2>/dev/null | tail -3)
        if [ -n "$HEALTH_LOG" ]; then
            info "   Health check: $HEALTH_LOG"
        fi
    elif [ "$RESTARTS" -gt 3 ] 2>/dev/null; then
        warn "${STATUS_LINE} (много перезапусков!)"
    else
        ok "$STATUS_LINE"
    fi
done

# Проверка n8n-worker (может не быть, если EXECUTIONS_MODE != queue)
if docker ps -a --format '{{.Names}}' | grep -q "content-factory-n8n-worker"; then
    W_STATE=$(docker inspect --format='{{.State.Status}}' "content-factory-n8n-worker" 2>/dev/null)
    ok "n8n-worker: state=${W_STATE} (queue mode)"
else
    info "n8n-worker: не запущен (режим regular — ОК)"
fi

# ══════════════════════════════════════
# 3. Порты
# ══════════════════════════════════════
header "3. Порты"

check_port() {
    local PORT=$1
    local DESC=$2
    if ss -tlnp 2>/dev/null | grep -q ":${PORT} " || netstat -tlnp 2>/dev/null | grep -q ":${PORT} "; then
        ok "Порт $PORT ($DESC) — слушает"
    else
        # Попробуем через docker
        if docker port "content-factory-nginx" "$PORT" &>/dev/null 2>&1; then
            ok "Порт $PORT ($DESC) — слушает (docker)"
        else
            fail "Порт $PORT ($DESC) — НЕ слушает"
        fi
    fi
}

check_port 80   "HTTP"
check_port 443  "HTTPS"
check_port 3001 "Dashboard"
check_port 5678 "N8N"
check_port 5432 "PostgreSQL"  2>/dev/null || true
check_port 9000 "MinIO API"

# Проверка, не блокирует ли firewall
if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "active"; then
        UFW_80=$(ufw status 2>/dev/null | grep -E "80\s" | head -1)
        UFW_443=$(ufw status 2>/dev/null | grep -E "443\s" | head -1)
        if [ -z "$UFW_80" ] || [ -z "$UFW_443" ]; then
            warn "UFW активен, но порты 80/443 могут быть не открыты"
            info "   Выполните: ufw allow 80/tcp && ufw allow 443/tcp"
        else
            ok "UFW: порты 80, 443 открыты"
        fi
    else
        info "UFW: неактивен"
    fi
fi

if command -v firewall-cmd &>/dev/null; then
    if firewall-cmd --state &>/dev/null 2>&1; then
        FW_HTTP=$(firewall-cmd --list-services 2>/dev/null)
        if echo "$FW_HTTP" | grep -q "http"; then
            ok "firewalld: HTTP/HTTPS открыты"
        else
            warn "firewalld: HTTP/HTTPS могут быть закрыты"
        fi
    fi
fi

# ══════════════════════════════════════
# 4. Nginx
# ══════════════════════════════════════
header "4. Nginx"

NGINX_C="content-factory-nginx"
if docker ps --format '{{.Names}}' | grep -q "^${NGINX_C}$"; then
    # Проверка конфигурации
    NGINX_TEST=$(docker exec "$NGINX_C" nginx -t 2>&1)
    if echo "$NGINX_TEST" | grep -q "successful"; then
        ok "nginx -t: конфигурация валидна"
    else
        fail "nginx -t: ошибка конфигурации"
        echo -e "${RED}${NGINX_TEST}${NC}" | sed 's/^/      /'
    fi
    
    # Версия nginx
    NGINX_VER=$(docker exec "$NGINX_C" nginx -v 2>&1 | head -1)
    info "Версия: $NGINX_VER"
    
    # SSL сертификаты
    if docker exec "$NGINX_C" test -f /etc/nginx/ssl/fullchain.pem 2>/dev/null; then
        EXPIRY=$(docker exec "$NGINX_C" sh -c 'echo | openssl x509 -in /etc/nginx/ssl/fullchain.pem -noout -enddate 2>/dev/null' 2>/dev/null | sed 's/notAfter=//')
        if [ -n "$EXPIRY" ]; then
            EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s 2>/dev/null || echo "0")
            NOW_EPOCH=$(date +%s)
            DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
            if [ "$DAYS_LEFT" -lt 0 ]; then
                fail "SSL сертификат ИСТЁК ($EXPIRY)"
            elif [ "$DAYS_LEFT" -lt 7 ]; then
                fail "SSL сертификат истекает через $DAYS_LEFT дней! ($EXPIRY)"
            elif [ "$DAYS_LEFT" -lt 30 ]; then
                warn "SSL сертификат истекает через $DAYS_LEFT дней ($EXPIRY)"
            else
                ok "SSL сертификат: $DAYS_LEFT дней до истечения ($EXPIRY)"
            fi
        else
            warn "Не удалось прочитать срок SSL"
        fi        
    else
        fail "SSL сертификат НЕ НАЙДЕН (/etc/nginx/ssl/fullchain.pem)"
        info "   Это причина 502! Nginx не может запустить HTTPS без сертификата."
        info "   Решение: certbot certonly --webroot -w /var/www/certbot -d $DOMAIN"
    fi
    
    # Проверить что upstream'ы резолвятся 
    DASH_RESOLVE=$(docker exec "$NGINX_C" sh -c 'getent hosts dashboard 2>/dev/null' 2>/dev/null)
    N8N_RESOLVE=$(docker exec "$NGINX_C" sh -c 'getent hosts n8n 2>/dev/null' 2>/dev/null)
    
    if [ -n "$DASH_RESOLVE" ]; then
        ok "Upstream dashboard резолвится: $(echo $DASH_RESOLVE | awk '{print $1}')"
    else
        fail "Upstream dashboard НЕ РЕЗОЛВИТСЯ (контейнер dashboard не в сети?)"
    fi
    
    if [ -n "$N8N_RESOLVE" ]; then
        ok "Upstream n8n резолвится: $(echo $N8N_RESOLVE | awk '{print $1}')"
    else
        fail "Upstream n8n НЕ РЕЗОЛВИТСЯ (контейнер n8n не в сети?)"
    fi
    
    # Попробовать curl dashboard изнутри nginx
    DASH_CURL=$(docker exec "$NGINX_C" sh -c 'wget -q -O- --timeout=5 http://dashboard:3001/api/health 2>&1' 2>/dev/null)
    if echo "$DASH_CURL" | grep -qi "ok\|healthy\|status"; then
        ok "Nginx → Dashboard:3001 — доступен"
    else
        fail "Nginx → Dashboard:3001 — НЕ ОТВЕЧАЕТ"
        info "   Ответ: $DASH_CURL"
    fi
    
    N8N_CURL=$(docker exec "$NGINX_C" sh -c 'wget -q -O- --timeout=5 http://n8n:5678/healthz 2>&1' 2>/dev/null)
    if echo "$N8N_CURL" | grep -qi "ok\|healthy\|status"; then
        ok "Nginx → N8N:5678 — доступен"
    else
        fail "Nginx → N8N:5678 — НЕ ОТВЕЧАЕТ"
        info "   Ответ: $N8N_CURL"
    fi
    
    # Последние ошибки nginx
    NGINX_ERRORS=$(docker logs --tail 30 "$NGINX_C" 2>&1 | grep -iE 'error|emerg|crit|alert|warn|502|503|504|upstream' | tail -10)
    if [ -n "$NGINX_ERRORS" ]; then
        warn "Последние ошибки nginx:"
        echo -e "${DIM}${NGINX_ERRORS}${NC}" | sed 's/^/      /'
    else
        ok "Нет ошибок в логах nginx (последние 30 строк)"
    fi
else
    fail "Контейнер nginx НЕ ЗАПУЩЕН"
    info "   Запустите: docker compose --profile production up -d nginx"
    
    # Почему не запустился?
    if docker ps -a --format '{{.Names}}' | grep -q "^${NGINX_C}$"; then
        EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' "$NGINX_C" 2>/dev/null)
        info "   Exit code: $EXIT_CODE"
        echo -e "${DIM}"
        docker logs --tail 15 "$NGINX_C" 2>&1 | sed 's/^/      /'
        echo -e "${NC}"
    fi
fi

# ══════════════════════════════════════
# 5. PostgreSQL
# ══════════════════════════════════════
header "5. PostgreSQL"

PG_C="content-factory-postgres"
if docker ps --format '{{.Names}}' | grep -q "^${PG_C}$"; then
    PG_VER=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SHOW server_version" 2>/dev/null)
    if [ -n "$PG_VER" ]; then
        ok "PostgreSQL $PG_VER — подключение ОК"
        
        # Кол-во наших таблиц
        TABLE_COUNT=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null)
        ok "Таблиц: $TABLE_COUNT"
        
        # Проверка app_settings
        SETTINGS_COUNT=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SELECT COUNT(*) FROM app_settings" 2>/dev/null || echo "ERR")
        if [ "$SETTINGS_COUNT" = "ERR" ]; then
            fail "Таблица app_settings не найдена (миграция не выполнена)"
        else
            ok "app_settings: $SETTINGS_COUNT настроек"
        fi
        
        # Проверка product_cards
        CARDS_CHECK=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SELECT COUNT(*) FROM product_cards" 2>/dev/null || echo "ERR")
        if [ "$CARDS_CHECK" = "ERR" ]; then
            warn "Таблица product_cards не найдена (нужна миграция)"
        else
            ok "product_cards: $CARDS_CHECK карточек"
        fi
        
        # Размер БД
        DB_SIZE=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SELECT pg_size_pretty(pg_database_size('n8n'))" 2>/dev/null)
        info "Размер БД: $DB_SIZE"
        
        # Активные подключения
        CONN_COUNT=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='n8n'" 2>/dev/null)
        MAX_CONN=$(docker exec "$PG_C" psql -U n8n_user -d n8n -tAc "SHOW max_connections" 2>/dev/null)
        if [ -n "$CONN_COUNT" ] && [ -n "$MAX_CONN" ]; then
            info "Подключения: $CONN_COUNT / $MAX_CONN"
            if [ "$CONN_COUNT" -gt "$((MAX_CONN * 80 / 100))" ] 2>/dev/null; then
                warn "Подключений больше 80% от максимума!"
            fi
        fi
    else
        fail "PostgreSQL — не удалось подключиться"
    fi
else
    fail "Контейнер postgres НЕ ЗАПУЩЕН"
fi

# ══════════════════════════════════════
# 6. Redis
# ══════════════════════════════════════
header "6. Redis"

REDIS_C="content-factory-redis"
if docker ps --format '{{.Names}}' | grep -q "^${REDIS_C}$"; then
    REDIS_PING=$(docker exec "$REDIS_C" redis-cli ping 2>/dev/null)
    if [ "$REDIS_PING" = "PONG" ]; then
        ok "Redis PING → PONG"
    else
        # Может быть с паролем
        REDIS_PING2=$(docker exec "$REDIS_C" redis-cli -a "${REDIS_PASSWORD:-password}" ping 2>/dev/null)
        if [ "$REDIS_PING2" = "PONG" ]; then
            ok "Redis PING → PONG (с паролем)"
        else
            fail "Redis не отвечает на PING"
        fi
    fi
    
    REDIS_MEM=$(docker exec "$REDIS_C" redis-cli -a "${REDIS_PASSWORD:-password}" info memory 2>/dev/null | grep used_memory_human | tr -d '\r')
    if [ -n "$REDIS_MEM" ]; then
        info "Память: $REDIS_MEM"
    fi
else
    fail "Контейнер redis НЕ ЗАПУЩЕН"
fi

# ══════════════════════════════════════
# 7. MinIO
# ══════════════════════════════════════
header "7. MinIO"

MINIO_C="content-factory-minio"
if docker ps --format '{{.Names}}' | grep -q "^${MINIO_C}$"; then
    MINIO_HEALTH=$(docker exec "$MINIO_C" curl -sf http://localhost:9000/minio/health/live 2>/dev/null)
    if [ $? -eq 0 ]; then
        ok "MinIO health — OK"
    else
        fail "MinIO health — НЕ ОТВЕЧАЕТ"
    fi
    
    # Проверить bucket
    BUCKET_LIST=$(docker exec "$MINIO_C" sh -c 'ls /data/ 2>/dev/null' 2>/dev/null)
    if echo "$BUCKET_LIST" | grep -q "content-factory"; then
        ok "Bucket content-factory существует"
    else
        warn "Bucket content-factory не найден в /data/"
    fi
else
    fail "Контейнер minio НЕ ЗАПУЩЕН"
fi

# ══════════════════════════════════════
# 8. Dashboard
# ══════════════════════════════════════
header "8. Dashboard"

DASH_C="content-factory-dashboard"
if docker ps --format '{{.Names}}' | grep -q "^${DASH_C}$"; then
    # Health check изнутри
    DASH_HEALTH=$(docker exec "$DASH_C" wget -q -O- --timeout=5 http://127.0.0.1:3001/api/health 2>/dev/null)
    if echo "$DASH_HEALTH" | grep -qi "ok\|healthy"; then
        ok "Dashboard /api/health — OK"
    else
        fail "Dashboard /api/health — НЕ ОТВЕЧАЕТ"
        info "   Ответ: $DASH_HEALTH"
    fi
    
    # Проверить что main page отдаётся
    DASH_INDEX=$(docker exec "$DASH_C" wget -q -O- --timeout=5 http://127.0.0.1:3001/ 2>&1 | head -5)
    if echo "$DASH_INDEX" | grep -qi "html\|DOCTYPE\|Контент"; then
        ok "Dashboard / — отдаёт HTML"
    else
        fail "Dashboard / — не отдаёт HTML"
    fi
    
    # Ошибки в логах
    DASH_ERRORS=$(docker logs --tail 50 "$DASH_C" 2>&1 | grep -iE 'error|ECONNREFUSED|ENOTFOUND|cannot|failed|fatal|crash|unhandled' | tail -5)
    if [ -n "$DASH_ERRORS" ]; then
        warn "Ошибки в логах dashboard:"
        echo -e "${DIM}${DASH_ERRORS}${NC}" | sed 's/^/      /'
    else
        ok "Нет критических ошибок в логах (последние 50 строк)"
    fi
else
    fail "Контейнер dashboard НЕ ЗАПУЩЕН"
    info "   Это главная причина 502!"
    info "   Запустите: docker compose up -d dashboard"
fi

# ══════════════════════════════════════
# 9. N8N
# ══════════════════════════════════════
header "9. N8N"

N8N_C="content-factory-n8n"
if docker ps --format '{{.Names}}' | grep -q "^${N8N_C}$"; then
    N8N_HEALTH=$(docker exec "$N8N_C" wget -q -O- --timeout=10 http://localhost:5678/healthz 2>/dev/null)
    if echo "$N8N_HEALTH" | grep -qi "ok\|healthy\|status"; then
        ok "N8N /healthz — OK"
    else
        fail "N8N /healthz — НЕ ОТВЕЧАЕТ (может стартовать, ждите start_period=60s)"
        info "   Ответ: $N8N_HEALTH"
    fi
    
    # Ошибки
    N8N_ERRORS=$(docker logs --tail 50 "$N8N_C" 2>&1 | grep -iE 'error|ECONNREFUSED|fatal|crash|cannot' | grep -v "ErrorReporter\|noExpressionError" | tail -5)
    if [ -n "$N8N_ERRORS" ]; then
        warn "Ошибки в логах n8n:"
        echo -e "${DIM}${N8N_ERRORS}${NC}" | sed 's/^/      /'
    else
        ok "Нет критических ошибок в логах n8n"
    fi
else
    fail "Контейнер n8n НЕ ЗАПУЩЕН"
fi

# ══════════════════════════════════════
# 10. Сеть Docker
# ══════════════════════════════════════
header "10. Docker Network"

NETWORK="contend-factory_content-factory-network"
# Может называться по-разному
NETWORK_EXISTS=$(docker network ls --format '{{.Name}}' | grep "content-factory-network" | head -1)

if [ -n "$NETWORK_EXISTS" ]; then
    ok "Сеть: $NETWORK_EXISTS"
    
    # Какие контейнеры в сети
    NET_CONTAINERS=$(docker network inspect "$NETWORK_EXISTS" --format='{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)
    info "Контейнеры в сети: $NET_CONTAINERS"
    
    # Проверить что nginx и dashboard в одной сети
    if echo "$NET_CONTAINERS" | grep -q "nginx" && echo "$NET_CONTAINERS" | grep -q "dashboard"; then
        ok "nginx + dashboard в одной сети"
    else
        if ! echo "$NET_CONTAINERS" | grep -q "nginx"; then
            fail "nginx НЕ в сети content-factory-network!"
        fi
        if ! echo "$NET_CONTAINERS" | grep -q "dashboard"; then
            fail "dashboard НЕ в сети content-factory-network!"
        fi
    fi
else
    fail "Сеть content-factory-network не найдена!"
    info "   Все контейнеры должны быть в одной docker-сети"
fi

# ══════════════════════════════════════
# 11. DNS и внешний доступ
# ══════════════════════════════════════
header "11. DNS и внешний доступ"

# DNS резолвинг
if command -v dig &>/dev/null; then
    DNS_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -1)
elif command -v nslookup &>/dev/null; then
    DNS_IP=$(nslookup "$DOMAIN" 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}')
elif command -v host &>/dev/null; then
    DNS_IP=$(host "$DOMAIN" 2>/dev/null | grep 'has address' | awk '{print $4}' | head -1)
else
    DNS_IP=""
fi

if [ -n "$DNS_IP" ]; then
    ok "DNS $DOMAIN → $DNS_IP"
    
    # Проверить что IP совпадает с нашим
    MY_IP=$(curl -sf --max-time 5 https://ifconfig.me 2>/dev/null || curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    if [ -n "$MY_IP" ]; then
        if [ "$DNS_IP" = "$MY_IP" ]; then
            ok "IP совпадает с сервером ($MY_IP)"
        else
            warn "DNS IP ($DNS_IP) ≠ IP сервера ($MY_IP)"
        fi
    fi
else
    warn "Не удалось резолвить DNS для $DOMAIN"
fi

# Curl к себе
CURL_HTTP=$(curl -sf --max-time 10 -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "000")
CURL_HTTPS=$(curl -skf --max-time 10 -o /dev/null -w "%{http_code}" https://localhost/ 2>/dev/null || echo "000")

if [ "$CURL_HTTP" = "301" ] || [ "$CURL_HTTP" = "200" ]; then
    ok "HTTP localhost → $CURL_HTTP"
else
    fail "HTTP localhost → $CURL_HTTP"
fi

if [ "$CURL_HTTPS" = "200" ]; then
    ok "HTTPS localhost → $CURL_HTTPS"
elif [ "$CURL_HTTPS" = "000" ]; then
    fail "HTTPS localhost — НЕТ ОТВЕТА (SSL не работает)"
else
    warn "HTTPS localhost → $CURL_HTTPS"
fi

# Внешний curl
CURL_EXT=$(curl -skf --max-time 15 -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>/dev/null || echo "000")
if [ "$CURL_EXT" = "200" ]; then
    ok "https://$DOMAIN → $CURL_EXT"
elif [ "$CURL_EXT" = "502" ]; then
    fail "https://$DOMAIN → 502 Bad Gateway"
elif [ "$CURL_EXT" = "000" ]; then
    fail "https://$DOMAIN — НЕТ ОТВЕТА"
else
    warn "https://$DOMAIN → $CURL_EXT"
fi

# ══════════════════════════════════════
# 12. Системные ресурсы
# ══════════════════════════════════════
header "12. Системные ресурсы"

# Диск
DISK_USAGE=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
DISK_TOTAL=$(df -h / 2>/dev/null | tail -1 | awk '{print $2}')
DISK_AVAIL=$(df -h / 2>/dev/null | tail -1 | awk '{print $4}')

if [ -n "$DISK_USAGE" ]; then
    if [ "$DISK_USAGE" -gt 95 ] 2>/dev/null; then
        fail "Диск: ${DISK_USAGE}% использовано (${DISK_AVAIL} осталось из ${DISK_TOTAL}) — КРИТИЧНО!"
        info "   Очистите: docker system prune -a --volumes"
    elif [ "$DISK_USAGE" -gt 85 ] 2>/dev/null; then
        warn "Диск: ${DISK_USAGE}% (${DISK_AVAIL} свободно из ${DISK_TOTAL})"
    else
        ok "Диск: ${DISK_USAGE}% (${DISK_AVAIL} свободно из ${DISK_TOTAL})"
    fi
fi

# Docker диск
DOCKER_DISK=$(docker system df 2>/dev/null | grep -E "Images|Containers|Volumes" | head -3)
if [ -n "$DOCKER_DISK" ]; then
    info "Docker:"
    echo -e "${DIM}${DOCKER_DISK}${NC}" | sed 's/^/      /'
fi

# Память
MEM_TOTAL=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
MEM_USED=$(free -m 2>/dev/null | awk '/^Mem:/{print $3}')
MEM_AVAIL=$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')
SWAP_USED=$(free -m 2>/dev/null | awk '/^Swap:/{print $3}')

if [ -n "$MEM_TOTAL" ]; then
    MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))
    if [ "$MEM_PCT" -gt 95 ]; then
        fail "Память: ${MEM_USED}/${MEM_TOTAL}MB (${MEM_PCT}%) — КРИТИЧНО! Свободно: ${MEM_AVAIL}MB"
        info "   Контейнеры могут убиваться OOM killer-ом!"
    elif [ "$MEM_PCT" -gt 85 ]; then
        warn "Память: ${MEM_USED}/${MEM_TOTAL}MB (${MEM_PCT}%). Свободно: ${MEM_AVAIL}MB"
    else
        ok "Память: ${MEM_USED}/${MEM_TOTAL}MB (${MEM_PCT}%). Свободно: ${MEM_AVAIL}MB"
    fi
    
    if [ -n "$SWAP_USED" ] && [ "$SWAP_USED" -gt 500 ] 2>/dev/null; then
        warn "Swap: ${SWAP_USED}MB используется (система свопит — может быть медленно)"
    fi
fi

# CPU Load
LOAD=$(uptime 2>/dev/null | awk -F'load average:' '{print $2}' | tr -d ' ')
CPU_COUNT=$(nproc 2>/dev/null || echo "1")
if [ -n "$LOAD" ]; then
    LOAD_1=$(echo "$LOAD" | cut -d',' -f1)
    ok "CPU: ${CPU_COUNT} ядер, load avg: $LOAD"
    # Проверка перегрузки
    LOAD_INT=$(echo "$LOAD_1" | cut -d'.' -f1)
    if [ "$LOAD_INT" -gt "$((CPU_COUNT * 2))" ] 2>/dev/null; then
        warn "CPU перегружен! Load ($LOAD_1) > cores × 2 ($((CPU_COUNT * 2)))"
    fi
fi

# ══════════════════════════════════════
# 13. Логи — последние ошибки всех контейнеров
# ══════════════════════════════════════
header "13. Свежие ошибки в логах (последние 5 мин)"

for CNAME in "${CONTAINERS[@]}"; do
    if ! docker ps --format '{{.Names}}' | grep -q "^${CNAME}$"; then continue; fi
    SHORT="${CNAME#content-factory-}"
    
    RECENT_ERRORS=$(docker logs --since 5m "$CNAME" 2>&1 | grep -iE 'error|fatal|panic|OOM|killed|segfault|ECONNREFUSED|ENOTFOUND|502|503' | grep -v "ErrorReporter" | tail -3)
    if [ -n "$RECENT_ERRORS" ]; then
        warn "${SHORT}:"
        echo -e "${DIM}${RECENT_ERRORS}${NC}" | sed 's/^/      /'
    fi
done

ok "Проверка логов завершена"

# ══════════════════════════════════════
# 14. Файлы и git
# ══════════════════════════════════════
header "14. Git и файлы"

if command -v git &>/dev/null && [ -d .git ]; then
    GIT_BRANCH=$(git branch --show-current 2>/dev/null)
    GIT_HASH=$(git log -1 --format='%h %s' 2>/dev/null)
    GIT_STATUS=$(git status --short 2>/dev/null | wc -l)
    ok "Branch: $GIT_BRANCH"
    ok "Last commit: $GIT_HASH"
    if [ "$GIT_STATUS" -gt 0 ] 2>/dev/null; then
        warn "Незакоммиченных файлов: $GIT_STATUS"
    fi
fi

# .env файл
if [ -f .env ]; then
    ok ".env файл существует"
else
    fail ".env файл НЕ НАЙДЕН — контейнеры не видят переменные!"
fi

# SSL файлы
if [ -f nginx/ssl/fullchain.pem ] && [ -f nginx/ssl/privkey.pem ]; then
    ok "SSL файлы на месте (nginx/ssl/)"
else
    fail "SSL файлы отсутствуют в nginx/ssl/"
    info "   Нужны: fullchain.pem, privkey.pem"
    info "   Скопируйте из /etc/letsencrypt/live/$DOMAIN/ или сгенерируйте:"
    info "   certbot certonly --standalone -d $DOMAIN"
    info "   cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem nginx/ssl/"
    info "   cp /etc/letsencrypt/live/$DOMAIN/privkey.pem nginx/ssl/"
fi

# ══════════════════════════════════════
# ИТОГИ
# ══════════════════════════════════════
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   📊 ИТОГИ ДИАГНОСТИКИ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

if [ $ISSUES -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "   ${OK} ${GREEN}${BOLD}Всё отлично! Проблем не обнаружено.${NC}"
elif [ $ISSUES -eq 0 ]; then
    echo -e "   ${WARN} ${BOLD}Предупреждений: ${YELLOW}$WARNINGS${NC}"
    echo -e "   ${OK} ${BOLD}Критических проблем нет${NC}"
else
    echo -e "   ${FAIL} ${BOLD}Проблем: ${RED}$ISSUES${NC}"
    echo -e "   ${WARN} ${BOLD}Предупреждений: ${YELLOW}$WARNINGS${NC}"
fi

echo ""

# ── Типичные решения 502 ──
if [ $ISSUES -gt 0 ]; then
    echo -e "${BOLD}${YELLOW}── Типичные решения 502 Bad Gateway ──${NC}"
    echo ""
    echo -e "   ${BOLD}1. Контейнеры не запущены:${NC}"
    echo "      docker compose --profile production up -d"
    echo ""
    echo -e "   ${BOLD}2. Dashboard упал / не стартует:${NC}"
    echo "      docker compose up -d --build dashboard"
    echo "      docker logs -f content-factory-dashboard"
    echo ""
    echo -e "   ${BOLD}3. SSL сертификат истёк / отсутствует:${NC}"
    echo "      docker compose --profile production stop nginx"
    echo "      certbot certonly --standalone -d $DOMAIN"
    echo "      cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem nginx/ssl/"
    echo "      cp /etc/letsencrypt/live/$DOMAIN/privkey.pem nginx/ssl/"
    echo "      docker compose --profile production up -d nginx"
    echo ""
    echo -e "   ${BOLD}4. Nginx конфиг ошибка:${NC}"
    echo "      docker exec content-factory-nginx nginx -t"
    echo "      docker compose --profile production restart nginx"
    echo ""
    echo -e "   ${BOLD}5. Диск 100% / память 100%:${NC}"
    echo "      docker system prune -a  # почистить Docker"
    echo "      journalctl --vacuum-size=100M  # почистить логи"
    echo ""
    echo -e "   ${BOLD}6. PostgreSQL не запускается (диск/данные):${NC}"
    echo "      docker compose restart postgres"
    echo "      docker logs content-factory-postgres"
    echo ""
    echo -e "   ${BOLD}7. Полный перезапуск всех сервисов:${NC}"
    echo "      docker compose --profile production down"
    echo "      docker compose --profile production up -d"
    echo ""
fi

exit $ISSUES
