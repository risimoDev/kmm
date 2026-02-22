#!/bin/bash
# ═══════════════════════════════════════════════════════
# Контент Завод — Настройка SSL (Let's Encrypt)
# ═══════════════════════════════════════════════════════
# Запускайте ПОСЛЕ install.sh, когда DNS уже прописан:
#   chmod +x scripts/setup-ssl.sh
#   sudo ./scripts/setup-ssl.sh
#
# Что делает скрипт:
#   1. Проверяет, что домен указывает на этот сервер
#   2. Устанавливает certbot (если нужно)
#   3. Получает сертификат Let's Encrypt (--standalone)
#   4. Копирует сертификаты в nginx/ssl/
#   5. Перезапускает Nginx
#   6. Настраивает авто-обновление (cron)
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
  log_error "Запустите скрипт с sudo: sudo ./scripts/setup-ssl.sh"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SSL_DIR="$PROJECT_DIR/nginx/ssl"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║   🔒 КОНТЕНТ ЗАВОД — Настройка SSL  ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# ═══════════════════════════════════════
# 1. ОПРЕДЕЛЯЕМ ДОМЕН
# ═══════════════════════════════════════
log_step "1/5 Определение домена"

# Пробуем взять домен из .env
if [ -f "$PROJECT_DIR/.env" ]; then
  DOMAIN=$(grep -oP '^N8N_HOST=\K.*' "$PROJECT_DIR/.env" 2>/dev/null || echo "")
fi

if [ -z "${DOMAIN:-}" ] || [ "$DOMAIN" = "localhost" ]; then
  read -rp "Домен (например cf.example.com): " DOMAIN
fi

if [ -z "$DOMAIN" ]; then
  log_error "Домен не указан. Прерываю."
  exit 1
fi

log_ok "Домен: $DOMAIN"

# ═══════════════════════════════════════
# 2. ПРОВЕРКА DNS
# ═══════════════════════════════════════
log_step "2/5 Проверка DNS"

SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || \
            curl -s --max-time 5 https://ifconfig.me 2>/dev/null || \
            hostname -I | awk '{print $1}')

DNS_IP=$(dig +short "$DOMAIN" A 2>/dev/null | tail -1 || \
         nslookup "$DOMAIN" 2>/dev/null | grep -A1 'Name:' | tail -1 | awk '{print $2}' || \
         echo "")

log_info "IP этого сервера: $SERVER_IP"
log_info "IP домена $DOMAIN: ${DNS_IP:-не определён}"

if [ -z "$DNS_IP" ]; then
  log_warn "Не удалось определить IP домена (DNS может распространяться)."
  read -rp "Продолжить всё равно? (y/N): " CONTINUE_DNS
  if [[ ! "$CONTINUE_DNS" =~ ^[Yy]$ ]]; then
    log_info "Дождитесь распространения DNS и запустите скрипт снова."
    exit 1
  fi
elif [ "$DNS_IP" != "$SERVER_IP" ]; then
  log_warn "DNS ($DNS_IP) не совпадает с IP сервера ($SERVER_IP)."
  log_warn "Certbot не сможет получить сертификат, пока A-запись не указывает на этот сервер."
  read -rp "Продолжить всё равно? (y/N): " CONTINUE_DNS
  if [[ ! "$CONTINUE_DNS" =~ ^[Yy]$ ]]; then
    log_info "Исправьте DNS и запустите скрипт снова."
    exit 1
  fi
else
  log_ok "DNS совпадает — домен указывает на этот сервер"
fi

# ═══════════════════════════════════════
# 3. УСТАНОВКА CERTBOT
# ═══════════════════════════════════════
log_step "3/5 Certbot"

if ! command -v certbot &>/dev/null; then
  log_info "Устанавливаю certbot..."
  apt-get update -qq
  # Сначала snap (Ubuntu 20.04+), иначе apt
  if command -v snap &>/dev/null; then
    snap install --classic certbot 2>/dev/null && ln -sf /snap/bin/certbot /usr/bin/certbot || \
    apt-get install -y -qq certbot
  else
    apt-get install -y -qq certbot
  fi
  log_ok "Certbot установлен"
else
  log_ok "Certbot: $(certbot --version 2>&1 | grep -oP '[\d.]+' | head -1)"
fi

# ═══════════════════════════════════════
# 4. ПОЛУЧЕНИЕ СЕРТИФИКАТА
# ═══════════════════════════════════════
log_step "4/5 Получение сертификата Let's Encrypt"

# Освобождаем порт 80
log_info "Освобождаю порт 80..."
systemctl stop nginx 2>/dev/null || true
docker stop content-factory-nginx 2>/dev/null || true
sleep 2

EMAIL="admin@${DOMAIN}"

log_info "Запрашиваю сертификат для $DOMAIN..."
if certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    --preferred-challenges http; then

  log_ok "Сертификат Let's Encrypt получен!"

  # Копируем в nginx/ssl/
  mkdir -p "$SSL_DIR"
  cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$SSL_DIR/fullchain.pem"
  cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   "$SSL_DIR/privkey.pem"
  chmod 644 "$SSL_DIR/fullchain.pem"
  chmod 600 "$SSL_DIR/privkey.pem"
  log_ok "Сертификаты скопированы в nginx/ssl/"

else
  log_error "Не удалось получить сертификат."
  echo
  log_info "Возможные причины:"
  log_info "  - Порт 80 заблокирован firewall / провайдером"
  log_info "  - DNS ещё не распространился (подождите 5–30 мин)"
  log_info "  - Домен $DOMAIN не указывает на этот сервер"
  echo
  log_info "Nginx возобновляет работу с текущими сертификатами..."
  docker start content-factory-nginx 2>/dev/null || true
  exit 1
fi

# Перезапускаем nginx
log_info "Перезапускаю Nginx..."
docker start content-factory-nginx 2>/dev/null || \
  docker compose -f "$PROJECT_DIR/docker-compose.yml" restart nginx 2>/dev/null || true
sleep 3

# Проверяем HTTPS
if curl -sk --max-time 10 "https://$DOMAIN/api/health" | grep -q 'ok\|status\|healthy' 2>/dev/null; then
  log_ok "HTTPS работает: https://$DOMAIN"
else
  log_warn "HTTPS не ответил (это нормально если nginx ещё стартует)."
  log_info "Проверьте вручную: curl -sk https://$DOMAIN/api/health"
fi

# ═══════════════════════════════════════
# 5. АВТО-ОБНОВЛЕНИЕ СЕРТИФИКАТА
# ═══════════════════════════════════════
log_step "5/5 Авто-обновление (cron)"

RENEW_SCRIPT="$PROJECT_DIR/scripts/renew-ssl.sh"
cat > "$RENEW_SCRIPT" << RENEWEOF
#!/bin/bash
# Контент Завод — Авто-обновление SSL
set -euo pipefail

DOMAIN="${DOMAIN}"
SSL_DIR="${SSL_DIR}"
LOG="$PROJECT_DIR/backups/ssl-renew.log"

echo "[\$(date)] Проверка обновления сертификата..." >> "\$LOG"

certbot renew --quiet --deploy-hook "
  cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ${SSL_DIR}/fullchain.pem
  cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem   ${SSL_DIR}/privkey.pem
  chmod 644 ${SSL_DIR}/fullchain.pem
  chmod 600 ${SSL_DIR}/privkey.pem
  docker restart content-factory-nginx
  echo [\$(date)] Сертификат обновлён и Nginx перезапущен >> ${SSL_DIR}/../../../backups/ssl-renew.log
" >> "\$LOG" 2>&1
RENEWEOF

chmod +x "$RENEW_SCRIPT"

# Cron: 1-го и 15-го числа в 02:15
SSL_CRON="15 2 1,15 * * $RENEW_SCRIPT"
(crontab -l 2>/dev/null | grep -v "renew-ssl.sh"; echo "$SSL_CRON") | crontab -
log_ok "Авто-обновление: 1-го и 15-го числа каждого месяца в 02:15"

# ═══════════════════════════════════════
# ИТОГ
# ═══════════════════════════════════════
echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   🔒 SSL настроен успешно!               ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}"
echo
echo -e "  ${BOLD}Сертификат:${NC}  Let's Encrypt (90 дней)"
echo -e "  ${BOLD}Домен:${NC}       https://${DOMAIN}"
EXPIRY=$(openssl x509 -noout -enddate -in "$SSL_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2 || echo "?")
echo -e "  ${BOLD}Истекает:${NC}    $EXPIRY"
echo -e "  ${BOLD}Авто-обновление:${NC} 1-го и 15-го числа каждого месяца"
echo
echo -e "  ${BOLD}Ручное обновление:${NC}"
echo -e "    ${CYAN}sudo certbot renew --dry-run${NC}   (тест)"
echo -e "    ${CYAN}sudo ./scripts/renew-ssl.sh${NC}    (принудительно)"
echo
