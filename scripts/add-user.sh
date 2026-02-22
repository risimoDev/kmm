#!/bin/bash
# ═══════════════════════════════════════════════════════
# Контент Завод — Добавление пользователя в Dashboard
# ═══════════════════════════════════════════════════════
# Использование:
#   chmod +x scripts/add-user.sh
#   sudo ./scripts/add-user.sh
#
# Или с аргументами:
#   sudo ./scripts/add-user.sh --login vasya --password secret123 --role tech_admin
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

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║   👤 КОНТЕНТ ЗАВОД — Добавить юзера  ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# ─── Defaults ───
ARG_LOGIN=""
ARG_PASSWORD=""
ARG_ROLE=""
ARG_FIRST=""
ARG_LAST=""

# ─── Парсим аргументы ───
while [[ $# -gt 0 ]]; do
  case "$1" in
    --login)     ARG_LOGIN="$2";    shift 2 ;;
    --password)  ARG_PASSWORD="$2"; shift 2 ;;
    --role)      ARG_ROLE="$2";     shift 2 ;;
    --first)     ARG_FIRST="$2";    shift 2 ;;
    --last)      ARG_LAST="$2";     shift 2 ;;
    *) shift ;;
  esac
done

# ─── Интерактивный ввод если аргументы не переданы ───
if [ -z "$ARG_LOGIN" ]; then
  read -rp "Логин нового пользователя: " ARG_LOGIN
fi
if [ -z "$ARG_LOGIN" ] || [ ${#ARG_LOGIN} -lt 3 ]; then
  log_error "Логин должен быть не менее 3 символов."
  exit 1
fi

if [ -z "$ARG_PASSWORD" ]; then
  read -rsp "Пароль (мин. 6 символов): " ARG_PASSWORD
  echo
fi
if [ -z "$ARG_PASSWORD" ] || [ ${#ARG_PASSWORD} -lt 6 ]; then
  log_error "Пароль должен быть не менее 6 символов."
  exit 1
fi

if [ -z "$ARG_ROLE" ]; then
  echo -e "Роль:"
  echo -e "  ${CYAN}1${NC}) tech_admin      — полный доступ"
  echo -e "  ${CYAN}2${NC}) business_owner  — только просмотр"
  read -rp "Выберите [1]: " ROLE_CHOICE
  case "${ROLE_CHOICE:-1}" in
    2) ARG_ROLE="business_owner" ;;
    *) ARG_ROLE="tech_admin" ;;
  esac
fi

if [[ "$ARG_ROLE" != "tech_admin" && "$ARG_ROLE" != "business_owner" ]]; then
  log_error "Неверная роль: $ARG_ROLE. Допустимо: tech_admin, business_owner"
  exit 1
fi

if [ -z "$ARG_FIRST" ]; then
  read -rp "Имя (опционально): " ARG_FIRST
fi
if [ -z "$ARG_LAST" ]; then
  read -rp "Фамилия (опционально): " ARG_LAST
fi

echo
log_info "Создаю пользователя:"
log_info "  Логин:    $ARG_LOGIN"
log_info "  Роль:     $ARG_ROLE"
[ -n "$ARG_FIRST" ] && log_info "  Имя:      $ARG_FIRST"
[ -n "$ARG_LAST"  ] && log_info "  Фамилия:  $ARG_LAST"
echo

# ─── Проверка что контейнер postgres запущен ───
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'content-factory-postgres'; then
  log_error "Контейнер content-factory-postgres не запущен."
  log_info  "Запустите стек: docker compose up -d"
  exit 1
fi

# ─── Хешируем пароль (HMAC-SHA256, совместимо с dashboard/src/routes/users.js) ───
SALT=$(openssl rand -hex 16)
HASH=$(echo -n "$ARG_PASSWORD" | openssl dgst -sha256 -hmac "$SALT" | awk '{print $NF}')

# ─── NULL-значения для опциональных полей ───
FIRST_SQL=$([ -n "$ARG_FIRST" ] && echo "'$(echo "$ARG_FIRST" | sed "s/'/''/g")'" || echo "NULL")
LAST_SQL=$([ -n "$ARG_LAST"  ] && echo "'$(echo "$ARG_LAST"  | sed "s/'/''/g")'" || echo "NULL")

# ─── Вставка в PostgreSQL ───
RESULT=$(docker exec content-factory-postgres psql \
  -U n8n_user -d n8n -t -A \
  -c "
INSERT INTO users (login, password_hash, password_salt, role, first_name, last_name, is_active)
VALUES (
  '$(echo "$ARG_LOGIN" | sed "s/'/''/g")',
  '$HASH',
  '$SALT',
  '$ARG_ROLE',
  $FIRST_SQL,
  $LAST_SQL,
  TRUE
)
ON CONFLICT (login) DO NOTHING
RETURNING id, login, role;
" 2>&1)

if echo "$RESULT" | grep -qE '^\d+\|'; then
  USER_ID=$(echo "$RESULT" | grep -oP '^\d+')
  log_ok "Пользователь создан (id=$USER_ID)"
  echo
  echo -e "${BOLD}Данные для входа:${NC}"
  echo -e "  URL:      ${CYAN}https://ваш-домен/login${NC}"
  echo -e "  Логин:    ${BOLD}$ARG_LOGIN${NC}"
  echo -e "  Пароль:   ${BOLD}$ARG_PASSWORD${NC}"
  echo -e "  Роль:     ${BOLD}$ARG_ROLE${NC}"
elif echo "$RESULT" | grep -qi 'duplicate\|already exists\|DO NOTHING' || [ -z "$RESULT" ]; then
  log_warn "Пользователь с логином '$ARG_LOGIN' уже существует."
  log_info "Чтобы сменить пароль, используйте Dashboard → Пользователи → Сменить пароль"
else
  log_error "Ошибка при создании пользователя:"
  echo "$RESULT"
  exit 1
fi
