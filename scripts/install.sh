#!/bin/bash
# ═══════════════════════════════════════════════════════
# Контент Завод — Установка на продакшен-сервер
# ═══════════════════════════════════════════════════════
# Использование:
#   chmod +x scripts/install.sh
#   sudo ./scripts/install.sh
#
# Что делает скрипт:
#   1. Проверяет системные требования (Docker, docker compose)
#   2. Генерирует безопасные пароли и ключи
#   3. Создаёт .env из .env.example с вашими настройками
#   4. Настраивает nginx для вашего домена + SSL (Let's Encrypt)
#   5. Собирает и запускает все контейнеры
#   6. Устанавливает Telegram Webhook
#   7. Настраивает автоматические бэкапы (cron)
# ═══════════════════════════════════════════════════════

set -euo pipefail

# ─── Цвета ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ${NC}  $1"; }
log_ok()    { echo -e "${GREEN}✅${NC} $1"; }
log_warn()  { echo -e "${YELLOW}⚠️${NC}  $1"; }
log_error() { echo -e "${RED}❌${NC} $1"; }
log_step()  { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }

# ─── Проверка root ───
if [ "$(id -u)" -ne 0 ]; then
  log_error "Запустите скрипт с sudo: sudo ./scripts/install.sh"
  exit 1
fi

# Определяем пользователя, который вызвал sudo
REAL_USER="${SUDO_USER:-$(whoami)}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║   🏭 КОНТЕНТ ЗАВОД — Установка      ║"
echo "║          Production v2.0             ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════
# 1. ПРОВЕРКА СИСТЕМНЫХ ТРЕБОВАНИЙ
# ═══════════════════════════════════════
log_step "1/7 Проверка системных требований"

# Docker
if ! command -v docker &>/dev/null; then
  log_info "Docker не найден. Устанавливаю..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  usermod -aG docker "$REAL_USER"
  log_ok "Docker установлен"
else
  DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+\.\d+')
  log_ok "Docker: $DOCKER_VERSION"
fi

# Docker Compose (v2 плагин)
if ! docker compose version &>/dev/null; then
  log_info "Docker Compose плагин не найден. Устанавливаю..."
  apt-get update -qq && apt-get install -y -qq docker-compose-plugin
  log_ok "Docker Compose установлен"
else
  COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "v2")
  log_ok "Docker Compose: $COMPOSE_VERSION"
fi

# Git
if ! command -v git &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq git
fi
log_ok "Git: $(git --version | awk '{print $3}')"

# OpenSSL (для самоподписанного сертификата)
if ! command -v openssl &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq openssl
fi
log_ok "OpenSSL: $(openssl version | awk '{print $2}')"

# ═══════════════════════════════════════
# 2. СБОР НАСТРОЕК
# ═══════════════════════════════════════
log_step "2/7 Настройка"

# Если .env уже есть — спросить
if [ -f "$PROJECT_DIR/.env" ]; then
  echo -e "${YELLOW}Файл .env уже существует.${NC}"
  read -rp "Перезаписать? (y/N): " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    log_info "Использую существующий .env"
    USE_EXISTING_ENV=true
  else
    USE_EXISTING_ENV=false
  fi
else
  USE_EXISTING_ENV=false
fi

if [ "$USE_EXISTING_ENV" = false ]; then
  # Домен
  read -rp "Домен (например cf.example.com): " DOMAIN
  if [ -z "$DOMAIN" ]; then
    log_error "Домен обязателен для продакшена"
    exit 1
  fi

  # Telegram Bot Token
  read -rp "Telegram Bot Token (от @BotFather): " TG_BOT_TOKEN
  if [ -z "$TG_BOT_TOKEN" ]; then
    log_error "Токен Telegram бота обязателен"
    exit 1
  fi

  # Telegram Allowed IDs
  read -rp "Telegram ID администраторов (через запятую): " TG_ALLOWED_IDS

  # Telegram Login Secret
  read -rp "Секретная фраза для /login бота: " TG_LOGIN_SECRET
  if [ -z "$TG_LOGIN_SECRET" ]; then
    TG_LOGIN_SECRET=$(openssl rand -hex 4)
    log_warn "Сгенерирована случайная фраза: $TG_LOGIN_SECRET"
  fi

  # Dashboard — логин и пароль администратора
  read -rp "Логин администратора Dashboard [admin]: " DASHBOARD_ADMIN_LOGIN
  DASHBOARD_ADMIN_LOGIN=${DASHBOARD_ADMIN_LOGIN:-admin}
  read -rsp "Пароль администратора Dashboard: " DASHBOARD_ADMIN_PWD
  echo
  if [ -z "$DASHBOARD_ADMIN_PWD" ]; then
    DASHBOARD_ADMIN_PWD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
    log_warn "Сгенерирован случайный пароль: $DASHBOARD_ADMIN_PWD"
  fi

  # Опционально: бизнес-владелец
  read -rp "Логин владельца бизнеса (пусто = пропустить): " DASHBOARD_BIZ_LOGIN
  if [ -n "$DASHBOARD_BIZ_LOGIN" ]; then
    read -rsp "Пароль владельца бизнеса: " DASHBOARD_BIZ_PWD
    echo
    if [ -z "$DASHBOARD_BIZ_PWD" ]; then
      DASHBOARD_BIZ_PWD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
      log_warn "Сгенерирован случайный пароль: $DASHBOARD_BIZ_PWD"
    fi
  fi

  # AI Provider
  read -rp "AI API ключ (GPTunnel/OpenRouter): " AI_KEY
  read -rp "AI Base URL [https://gptunnel.ru/v1]: " AI_URL
  AI_URL=${AI_URL:-https://gptunnel.ru/v1}
  read -rp "AI модель [gpt-4o]: " AI_MDL
  AI_MDL=${AI_MDL:-gpt-4o}
  read -rp "AI Auth Prefix (пусто для GPTunnel, 'Bearer ' для остальных) []: " AI_PREFIX
  AI_PREFIX=${AI_PREFIX:-}

  # Телеграм Chat IDs
  read -rp "Telegram Chat ID для уведомлений [${TG_ALLOWED_IDS%%,*}]: " TG_CHAT_ID
  TG_CHAT_ID=${TG_CHAT_ID:-${TG_ALLOWED_IDS%%,*}}
  read -rp "Telegram Moderator Chat ID [${TG_CHAT_ID}]: " TG_MOD_CHAT
  TG_MOD_CHAT=${TG_MOD_CHAT:-$TG_CHAT_ID}

  # ─── Генерация безопасных паролей ───
  log_info "Генерирую безопасные пароли..."
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  REDIS_PWD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  MINIO_PWD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
  N8N_ENCRYPTION=$(openssl rand -hex 32)
  N8N_AUTH_PWD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)

  # ─── Создание .env ───
  cat > "$PROJECT_DIR/.env" << ENVEOF
# ═══════════════════════════════════════
# КОНТЕНТ ЗАВОД — Продакшен конфигурация
# Сгенерировано: $(date '+%Y-%m-%d %H:%M:%S')
# Сервер: $(hostname)
# Домен: ${DOMAIN}
# ═══════════════════════════════════════

# --- N8N ---
N8N_PROTOCOL=https
N8N_HOST=${DOMAIN}
N8N_PORT=5678
N8N_EDITOR_BASE_URL=https://${DOMAIN}/n8n
N8N_PATH=/n8n
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=${N8N_AUTH_PWD}
GENERIC_TIMEZONE=Europe/Moscow
TZ=Europe/Moscow
WEBHOOK_URL=https://${DOMAIN}
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION}
N8N_API_KEY=$(openssl rand -hex 24)
EXECUTIONS_TIMEOUT=-1

# --- PostgreSQL ---
DB_TYPE=postgresdb
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_HOST=postgres
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_USER=n8n_user
DB_POSTGRESDB_PASSWORD=${DB_PASSWORD}

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PWD}

# --- MinIO ---
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=${MINIO_PWD}

# --- Dashboard ---
JWT_SECRET=${JWT_SECRET}
DASHBOARD_USERS=${DASHBOARD_ADMIN_LOGIN}:${DASHBOARD_ADMIN_PWD}:tech_admin$([ -n "$DASHBOARD_BIZ_LOGIN" ] && echo ",${DASHBOARD_BIZ_LOGIN}:${DASHBOARD_BIZ_PWD}:business_owner")
DASHBOARD_URL=https://${DOMAIN}
CORS_ORIGIN=https://${DOMAIN}

# --- Контроль доступа ---
TELEGRAM_ALLOWED_IDS=${TG_ALLOWED_IDS}
TELEGRAM_LOGIN_SECRET=${TG_LOGIN_SECRET}

# --- AI Провайдер ---
AI_API_KEY=${AI_KEY}
AI_MODEL=${AI_MDL}
AI_BASE_URL=${AI_URL}
AI_AUTH_PREFIX=${AI_PREFIX}

# --- Telegram Bot ---
TELEGRAM_BOT_TOKEN=${TG_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TG_CHAT_ID:-0}
TELEGRAM_CHANNEL_ID=0
TELEGRAM_MODERATOR_CHAT_ID=${TG_MOD_CHAT:-0}

# --- VK ---
VK_ACCESS_TOKEN=
VK_GROUP_ID=

# --- Режим работы ---
NODE_ENV=production
ENVEOF

  chmod 600 "$PROJECT_DIR/.env"
  chown "$REAL_USER:$REAL_USER" "$PROJECT_DIR/.env"
  log_ok ".env создан с безопасными паролями"

else
  # Читаем домен из существующего .env
  DOMAIN=$(grep -oP '^N8N_HOST=\K.*' "$PROJECT_DIR/.env" 2>/dev/null || echo "")
  TG_BOT_TOKEN=$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.*' "$PROJECT_DIR/.env" 2>/dev/null || echo "")

  if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "localhost" ]; then
    read -rp "Домен для продакшена: " DOMAIN
    sed -i "s|^N8N_HOST=.*|N8N_HOST=${DOMAIN}|" "$PROJECT_DIR/.env"
    sed -i "s|^WEBHOOK_URL=.*|WEBHOOK_URL=https://${DOMAIN}|" "$PROJECT_DIR/.env"
    sed -i "s|^DASHBOARD_URL=.*|DASHBOARD_URL=https://${DOMAIN}|" "$PROJECT_DIR/.env"
    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://${DOMAIN}|" "$PROJECT_DIR/.env"
    sed -i "s|^N8N_PROTOCOL=.*|N8N_PROTOCOL=https|" "$PROJECT_DIR/.env"
    sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" "$PROJECT_DIR/.env"
  fi
fi

# ═══════════════════════════════════════
# 3. НАСТРОЙКА SSL (самоподписанный)
# ═══════════════════════════════════════
log_step "3/7 SSL — самоподписанный сертификат"

SSL_DIR="$PROJECT_DIR/nginx/ssl"
mkdir -p "$SSL_DIR"

if [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
  log_ok "SSL сертификаты уже существуют ($(openssl x509 -noout -subject -in "$SSL_DIR/fullchain.pem" 2>/dev/null | grep -oP 'CN\s*=\s*\K[^,/]+' || echo '?'))"
else
  log_info "Создаю самоподписанный сертификат для $DOMAIN..."
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" \
    -out   "$SSL_DIR/fullchain.pem" \
    -subj  "/CN=$DOMAIN" 2>/dev/null
  log_ok "Самоподписанный сертификат создан"
fi

log_warn "Используется самоподписанный сертификат."
log_info "Для получения бесплатного Let's Encrypt сертификата запустите после установки:"
log_info "  sudo ./scripts/setup-ssl.sh"

# ═══════════════════════════════════════
# 4. НАСТРОЙКА NGINX
# ═══════════════════════════════════════
log_step "4/7 Настройка Nginx"

# Заменяем домен в nginx.conf
sed -i "s/your-domain.com/${DOMAIN}/g" "$PROJECT_DIR/nginx/nginx.conf"
log_ok "Nginx настроен для $DOMAIN"

# ═══════════════════════════════════════
# 5. СБОРКА И ЗАПУСК
# ═══════════════════════════════════════
log_step "5/7 Сборка и запуск контейнеров"

cd "$PROJECT_DIR"

# Создать необходимые директории
mkdir -p output workflows credentials backups nginx/ssl
chown -R "$REAL_USER:$REAL_USER" "$PROJECT_DIR"

# Сборка Dashboard
log_info "Собираю Dashboard..."
docker compose build dashboard --no-cache

# Запуск core-сервисов
log_info "Запускаю сервисы..."
docker compose --profile production up -d

# Ожидание готовности
log_info "Ожидаю готовности сервисов..."
RETRIES=0
MAX_RETRIES=30
while [ $RETRIES -lt $MAX_RETRIES ]; do
  if docker exec content-factory-dashboard wget -q --spider http://127.0.0.1:3001/api/health 2>/dev/null; then
    break
  fi
  RETRIES=$((RETRIES + 1))
  sleep 5
  echo -n "."
done
echo

if [ $RETRIES -ge $MAX_RETRIES ]; then
  log_warn "Dashboard не ответил за ${MAX_RETRIES}×5 сек. Проверьте логи:"
  log_info "docker compose logs dashboard"
else
  log_ok "Все сервисы запущены"
fi

# Проверка статуса
echo
docker compose ps --format "table {{.Name}}\t{{.Status}}"
echo

# ═══════════════════════════════════════
# 6. TELEGRAM WEBHOOK
# ═══════════════════════════════════════
log_step "6/7 Настройка Telegram Webhook"

if [ -n "$TG_BOT_TOKEN" ]; then
  WEBHOOK_RESULT=$(curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook?url=https://${DOMAIN}/webhook/telegram-bot")

  if echo "$WEBHOOK_RESULT" | grep -q '"ok":true'; then
    log_ok "Telegram Webhook установлен: https://${DOMAIN}/webhook/telegram-bot"
  else
    log_warn "Не удалось установить webhook: $WEBHOOK_RESULT"
    log_info "Установите вручную:"
    log_info "curl \"https://api.telegram.org/bot\${TOKEN}/setWebhook?url=https://${DOMAIN}/webhook/telegram-bot\""
  fi
else
  log_warn "Telegram Bot Token не найден в .env. Webhook не установлен."
fi

# ═══════════════════════════════════════
# 7. АВТОМАТИЧЕСКИЕ БЭКАПЫ
# ═══════════════════════════════════════
log_step "7/7 Настройка автоматических бэкапов"

BACKUP_SCRIPT="$PROJECT_DIR/scripts/cron-backup.sh"
cat > "$BACKUP_SCRIPT" << 'BACKUPEOF'
#!/bin/bash
# Контент Завод — Ежедневный бэкап
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
DATE=$(date '+%Y-%m-%d_%H-%M')
BACKUP_PATH="$BACKUP_DIR/$DATE"
KEEP_DAYS=14

mkdir -p "$BACKUP_PATH"

# PostgreSQL dump
docker exec content-factory-postgres pg_dump -U n8n_user -Fc n8n > "$BACKUP_PATH/database.dump" 2>/dev/null

# N8N credentials
docker cp content-factory-n8n:/home/node/.n8n/config "$BACKUP_PATH/n8n_config" 2>/dev/null || true

# .env
cp "$PROJECT_DIR/.env" "$BACKUP_PATH/env.backup"

# Workflows
cp -r "$PROJECT_DIR/workflows" "$BACKUP_PATH/workflows"

# Архивировать
cd "$BACKUP_DIR"
tar -czf "${DATE}.tar.gz" "$DATE" && rm -rf "$DATE"

# Удалить старые бэкапы
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +${KEEP_DAYS} -delete

echo "[$(date)] Backup completed: ${DATE}.tar.gz"
BACKUPEOF

chmod +x "$BACKUP_SCRIPT"

# Добавляем в cron (ежедневно в 3:00)
CRON_LINE="0 3 * * * $BACKUP_SCRIPT >> $PROJECT_DIR/backups/cron.log 2>&1"
(crontab -u "$REAL_USER" -l 2>/dev/null | grep -v "cron-backup.sh"; echo "$CRON_LINE") | crontab -u "$REAL_USER" -
log_ok "Автоматические бэкапы: ежедневно в 03:00 (хранение 14 дней)"

# Примечание: cron для авто-обновления SSL создаётся скриптом setup-ssl.sh

# ═══════════════════════════════════════
# UFW FIREWALL
# ═══════════════════════════════════════
if command -v ufw &>/dev/null; then
  log_info "Настройка firewall (ufw)..."
  ufw allow 22/tcp   >/dev/null 2>&1  # SSH
  ufw allow 80/tcp   >/dev/null 2>&1  # HTTP
  ufw allow 443/tcp  >/dev/null 2>&1  # HTTPS
  # НЕ открываем 5678, 3001, 9000, 9001 — они через nginx
  ufw --force enable >/dev/null 2>&1
  log_ok "Firewall: открыты порты 22, 80, 443"
fi

# ═══════════════════════════════════════
# ИТОГ
# ═══════════════════════════════════════
echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   🏭 КОНТЕНТ ЗАВОД — Установка завершена!║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}"
echo
echo -e "  ${BOLD}Dashboard:${NC}     https://${DOMAIN}"
echo -e "  ${BOLD}N8N Panel:${NC}     https://${DOMAIN}/n8n/"
echo -e "  ${BOLD}N8N Логин:${NC}     admin / (см. .env)"
echo -e "  ${BOLD}MinIO Console:${NC} http://<server-ip>:9001 (внутри сети)"
echo
echo -e "  ${BOLD}Управление:${NC}"
echo -e "    Логи:        ${CYAN}docker compose logs -f${NC}"
echo -e "    Статус:      ${CYAN}docker compose ps${NC}"
echo -e "    Рестарт:     ${CYAN}docker compose restart${NC}"
echo -e "    Бэкап:       ${CYAN}./scripts/cron-backup.sh${NC}"
echo -e "    Обновление:  ${CYAN}./scripts/deploy.sh${NC}"
echo -e "    SSL (Let's Encrypt): ${CYAN}sudo ./scripts/setup-ssl.sh${NC}"
echo
echo -e "  ${YELLOW}Пароли сохранены в .env (chmod 600)${NC}"
echo -e "  ${YELLOW}Не забудьте активировать workflows в N8N!${NC}"
echo
