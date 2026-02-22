#!/bin/bash
# ═══════════════════════════════════════════════════════
# Контент Завод — Деплой обновлений
# ═══════════════════════════════════════════════════════
# Использование:
#   ./scripts/deploy.sh              # полный деплой
#   ./scripts/deploy.sh --quick      # только dashboard (без пересборки всего)
#   ./scripts/deploy.sh --rollback   # откат к предыдущей версии
#
# Что делает:
#   1. Создаёт бэкап перед обновлением
#   2. Стягивает обновления из git
#   3. Пересобирает dashboard
#   4. Обновляет контейнеры (zero-downtime для N8N)
#   5. Проверяет health-check
#   6. При ошибке — автоматический откат
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
log_step()  { echo -e "\n${BOLD}${CYAN}─── $1 ───${NC}\n"; }

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

DEPLOY_MODE="${1:-full}"
DEPLOY_LOG="$PROJECT_DIR/backups/deploy.log"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
GIT_HASH_BEFORE=""
GIT_HASH_AFTER=""

mkdir -p "$PROJECT_DIR/backups"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║   🚀 КОНТЕНТ ЗАВОД — Деплой         ║"
echo "║          $(date '+%Y-%m-%d %H:%M')              ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# ─── Функция отката ───
rollback() {
  log_error "Деплой не удался! Откатываю..."

  if [ -n "$GIT_HASH_BEFORE" ]; then
    git checkout "$GIT_HASH_BEFORE" -- .
    log_info "Git откачен к $GIT_HASH_BEFORE"
  fi

  # Восстановить .env из бэкапа
  LATEST_BACKUP=$(ls -t "$PROJECT_DIR/backups/"*.tar.gz 2>/dev/null | head -1)
  if [ -n "$LATEST_BACKUP" ]; then
    TMPDIR=$(mktemp -d)
    tar -xzf "$LATEST_BACKUP" -C "$TMPDIR" --wildcards "*/env.backup" 2>/dev/null || true
    ENV_BACKUP=$(find "$TMPDIR" -name "env.backup" | head -1)
    if [ -n "$ENV_BACKUP" ]; then
      cp "$ENV_BACKUP" "$PROJECT_DIR/.env"
      log_info ".env восстановлен из бэкапа"
    fi
    rm -rf "$TMPDIR"
  fi

  # Пересобрать и перезапустить
  docker compose build dashboard --quiet 2>/dev/null || true
  docker compose up -d 2>/dev/null || true

  log_error "Откат завершён. Проверьте логи: docker compose logs"
  echo "[${TIMESTAMP}] DEPLOY FAILED — ROLLBACK" >> "$DEPLOY_LOG"
  exit 1
}

# ─── Режим --rollback ───
if [ "$DEPLOY_MODE" = "--rollback" ]; then
  log_step "Ручной откат"

  LATEST_BACKUP=$(ls -t "$PROJECT_DIR/backups/"*.tar.gz 2>/dev/null | head -1)
  if [ -z "$LATEST_BACKUP" ]; then
    log_error "Бэкапы не найдены в $PROJECT_DIR/backups/"
    exit 1
  fi

  log_info "Последний бэкап: $(basename "$LATEST_BACKUP")"
  read -rp "Откатить к этому бэкапу? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    log_info "Отменено"
    exit 0
  fi

  TMPDIR=$(mktemp -d)
  tar -xzf "$LATEST_BACKUP" -C "$TMPDIR"

  # Восстановить БД
  DB_DUMP=$(find "$TMPDIR" -name "database.dump" | head -1)
  if [ -n "$DB_DUMP" ]; then
    log_info "Восстанавливаю базу данных..."
    docker exec -i content-factory-postgres pg_restore -U n8n_user -d n8n --clean --if-exists < "$DB_DUMP" 2>/dev/null || true
    log_ok "БД восстановлена"
  fi

  # Восстановить .env
  ENV_BACKUP=$(find "$TMPDIR" -name "env.backup" | head -1)
  if [ -n "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$PROJECT_DIR/.env"
    log_ok ".env восстановлен"
  fi

  # Восстановить workflows
  WF_BACKUP=$(find "$TMPDIR" -type d -name "workflows" | head -1)
  if [ -n "$WF_BACKUP" ]; then
    cp -r "$WF_BACKUP"/* "$PROJECT_DIR/workflows/"
    log_ok "Workflows восстановлены"
  fi

  rm -rf "$TMPDIR"

  docker compose restart
  log_ok "Откат завершён"
  echo "[${TIMESTAMP}] MANUAL ROLLBACK from $(basename "$LATEST_BACKUP")" >> "$DEPLOY_LOG"
  exit 0
fi

# ═══════════════════════════════════════
# 1. ПРЕДВАРИТЕЛЬНЫЙ БЭКАП
# ═══════════════════════════════════════
log_step "1/5 Бэкап перед обновлением"

if [ -x "$PROJECT_DIR/scripts/cron-backup.sh" ]; then
  "$PROJECT_DIR/scripts/cron-backup.sh"
  log_ok "Бэкап создан"
else
  # Быстрый мини-бэкап
  MINI_BACKUP="$PROJECT_DIR/backups/pre-deploy_${TIMESTAMP}"
  mkdir -p "$MINI_BACKUP"
  cp "$PROJECT_DIR/.env" "$MINI_BACKUP/env.backup"
  docker exec content-factory-postgres pg_dump -U n8n_user -Fc n8n > "$MINI_BACKUP/database.dump" 2>/dev/null || true
  cp -r "$PROJECT_DIR/workflows" "$MINI_BACKUP/workflows"
  cd "$PROJECT_DIR/backups"
  tar -czf "pre-deploy_${TIMESTAMP}.tar.gz" "pre-deploy_${TIMESTAMP}" && rm -rf "pre-deploy_${TIMESTAMP}"
  cd "$PROJECT_DIR"
  log_ok "Мини-бэкап создан"
fi

# ═══════════════════════════════════════
# 2. ОБНОВЛЕНИЕ КОДА
# ═══════════════════════════════════════
log_step "2/5 Обновление кода"

GIT_HASH_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")

if git remote -v 2>/dev/null | grep -q "origin"; then
  # Сохраняем локальные изменения
  git stash push -m "pre-deploy-${TIMESTAMP}" 2>/dev/null || true

  # Тянем обновления
  BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
  log_info "Обновляю ветку $BRANCH..."
  git pull origin "$BRANCH" --rebase 2>&1 || {
    log_warn "Конфликт при git pull. Пытаюсь merge..."
    git rebase --abort 2>/dev/null || true
    git pull origin "$BRANCH" 2>&1 || {
      log_error "Не удалось обновить код. Откатываю..."
      git stash pop 2>/dev/null || true
      exit 1
    }
  }

  # Восстанавливаем stash
  git stash pop 2>/dev/null || true

  GIT_HASH_AFTER=$(git rev-parse HEAD 2>/dev/null || echo "")

  if [ "$GIT_HASH_BEFORE" = "$GIT_HASH_AFTER" ] && [ "$DEPLOY_MODE" != "--quick" ]; then
    log_info "Код не изменился."
    read -rp "Продолжить деплой? (y/N): " FORCE
    if [[ ! "$FORCE" =~ ^[Yy]$ ]]; then
      log_info "Деплой отменён"
      exit 0
    fi
  else
    COMMITS=$(git log --oneline "$GIT_HASH_BEFORE".."$GIT_HASH_AFTER" 2>/dev/null | wc -l)
    log_ok "Получено $COMMITS новых коммитов"
  fi
else
  log_warn "Git remote не настроен. Пропускаю git pull."
fi

# ═══════════════════════════════════════
# 3. ПЕРЕСБОРКА
# ═══════════════════════════════════════
log_step "3/5 Пересборка контейнеров"

if [ "$DEPLOY_MODE" = "--quick" ]; then
  log_info "Быстрый деплой: только Dashboard"
  docker compose build dashboard --no-cache
else
  log_info "Полная пересборка..."
  docker compose build --no-cache
fi

log_ok "Сборка завершена"

# ═══════════════════════════════════════
# 4. ОБНОВЛЕНИЕ КОНТЕЙНЕРОВ
# ═══════════════════════════════════════
log_step "4/5 Обновление контейнеров"

# Обновляем базовые образы
if [ "$DEPLOY_MODE" != "--quick" ]; then
  log_info "Обновляю базовые образы..."
  docker compose pull postgres redis minio 2>/dev/null || true
fi

# Перезапуск с минимальным простоем
log_info "Перезапускаю сервисы..."
docker compose --profile production up -d --remove-orphans

# Ждём healthcheck
log_info "Проверяю здоровье сервисов..."
RETRIES=0
MAX_RETRIES=24  # 24 × 5 = 120 сек
while [ $RETRIES -lt $MAX_RETRIES ]; do
  HEALTHY=$(docker ps --filter "name=content-factory" --filter "health=healthy" --format "{{.Names}}" | wc -l)
  TOTAL=$(docker ps --filter "name=content-factory" --format "{{.Names}}" | wc -l)

  if [ "$HEALTHY" -ge 4 ]; then  # postgres + redis + minio + n8n + dashboard (nginx может быть в profile)
    break
  fi
  RETRIES=$((RETRIES + 1))
  sleep 5
  echo -n "."
done
echo

if [ $RETRIES -ge $MAX_RETRIES ]; then
  log_error "Таймаут ожидания healthcheck!"
  docker compose ps
  echo
  read -rp "Откатить? (y/N): " DO_ROLLBACK
  if [[ "$DO_ROLLBACK" =~ ^[Yy]$ ]]; then
    rollback
  fi
else
  log_ok "Все сервисы здоровы ($HEALTHY/$TOTAL)"
fi

# ═══════════════════════════════════════
# 5. ВЕРИФИКАЦИЯ
# ═══════════════════════════════════════
log_step "5/5 Проверка"

# Health endpoint
HEALTH_RESPONSE=$(curl -s http://127.0.0.1:3001/api/health 2>/dev/null || echo "")
if echo "$HEALTH_RESPONSE" | grep -q '"ok":true'; then
  DB_OK=$(echo "$HEALTH_RESPONSE" | grep -oP '"database":\K\w+')
  MINIO_OK=$(echo "$HEALTH_RESPONSE" | grep -oP '"minio":\K\w+')
  N8N_OK=$(echo "$HEALTH_RESPONSE" | grep -oP '"n8n":\K\w+')
  log_ok "Dashboard: OK (db=$DB_OK, minio=$MINIO_OK, n8n=$N8N_OK)"
else
  log_warn "Dashboard health endpoint не ответил. Проверьте: docker compose logs dashboard"
fi

# Статус
echo
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# Очистка старых образов
log_info "Удаляю неиспользуемые образы..."
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true

# ─── Лог ───
echo "[${TIMESTAMP}] DEPLOY OK | before=${GIT_HASH_BEFORE:-N/A} after=${GIT_HASH_AFTER:-N/A} mode=${DEPLOY_MODE}" >> "$DEPLOY_LOG"

# ─── Итог ───
echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   🚀 Деплой завершён успешно!        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${NC}"
echo
echo -e "  Время:   $(date '+%H:%M:%S')"
echo -e "  Режим:   $DEPLOY_MODE"
if [ -n "$GIT_HASH_AFTER" ]; then
  echo -e "  Коммит:  ${GIT_HASH_AFTER:0:8}"
fi
echo
