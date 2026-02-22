# 🏭 Контент Завод v3.0

> Полностью автоматизированная платформа для создания видеоконтента и карточек товаров для маркетплейсов (Wildberries, Ozon, Яндекс.Маркет).

## Что это

**Контент Завод** — Docker-стек для автоматизации производства контента:

- 💡 **AI генерирует идеи** для продающих видео
- 🎬 **Автоматическое производство видео** — озвучка, AI-генерация, монтаж
- 🧑 **HeyGen аватар-видео** — говорящий AI-аватар рассказывает о товаре
- 📦 **Карточки товаров** — AI анализирует фото товара и генерирует полные карточки для маркетплейсов
- 📢 **Автопубликация** — Telegram, VK, YouTube Shorts
- 📊 **Веб-панель** — управление, аналитика, настройки

## Возможности

### 🎬 Видео-производство (2 режима)

| Режим             | Описание                                             | Технологии                          |
| ----------------- | ---------------------------------------------------- | ----------------------------------- |
| **Обычное видео** | TTS-озвучка + AI-генерация видео + субтитры + монтаж | OpenAI TTS → Minimax Video → FFmpeg |
| **HeyGen аватар** | AI-аватар говорит текст сценария на видео            | HeyGen API v2 (аватар + голос)      |

### 📦 Карточки товаров

Загрузите фото товара → AI анализирует через Vision API и генерирует:

- Заголовок и подзаголовок для маркетплейса
- Буллет-пойнты (USP/ключевые преимущества)
- CTA-текст (призыв к действию)
- SEO: title, description, ключевые слова
- Рекомендации по цветовой палитре и визуалу
- Rich-контент блоки и A+ контент
- Промпты для инфографики

### 💡 Контент-мозг

AI-генерация связок «идея → сценарий → видео-промпт» с полными настройками:

- Тональность, стиль, целевая аудитория
- Адаптация под маркетплейс
- SEO-оптимизация контента

## Быстрый старт

### 1. Настройка

```bash
cp .env.example .env
# Отредактируйте .env:
#   - AI_API_KEY, AI_MODEL, AI_BASE_URL (GPTunnel / OpenRouter / Ollama)
#   - Пароли БД, Redis, MinIO
#   - DASHBOARD_USERS (логин:пароль:роль через запятую)
#   - HEYGEN_API_KEY (опционально, для HeyGen аватаров)
```

### 2. Запуск

```bash
# Поднять весь стек
docker compose up -d

# Инициализация БД (первый раз)
docker cp scripts/init-db.sql content-factory-postgres:/tmp/init.sql
docker exec content-factory-postgres psql -U n8n_user -d n8n -f /tmp/init.sql
```

### 3. Настройка N8N

1. Откройте N8N: `http://localhost:5678`
2. **Credentials** → создайте:
   - **PostgreSQL**: Host=`postgres`, Port=`5432`, DB/User/Pass из `.env`
   - **Header Auth**: Name=`Authorization`, Value=`Bearer <AI_API_KEY>`
3. Workflow уже импортированы и активны при первом запуске

### 4. Настройки через панель

1. Зайдите на Dashboard: `http://localhost:3001`
2. **Настройки → AI** — API ключ, модель, базовый URL
3. **Настройки → TTS** — провайдер озвучки, голос, скорость
4. **Настройки → Видео** — провайдер генерации видео
5. **Настройки → HeyGen** — API ключ, аватар и голос по умолчанию

## Интерфейсы

| Сервис    | URL                     | Описание                         |
| --------- | ----------------------- | -------------------------------- |
| Dashboard | `http://localhost:3001` | Веб-панель управления            |
| N8N       | `http://localhost:5678` | Редактор workflow                |
| MinIO     | `http://localhost:9001` | S3-хранилище файлов              |
| Grafana   | `http://localhost:3000` | Мониторинг (profile: monitoring) |

## Архитектура

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     Dashboard (SPA)                         │
 │  Контент-банк │ Видео │ Карточки │ Расписание │ Настройки  │
 └────────────────────────┬────────────────────────────────────┘
                          │ REST API + WebSocket
 ┌────────────────────────▼────────────────────────────────────┐
 │              Dashboard Backend (Express.js)                  │
 │  JWT Auth │ 12 REST Routes │ Socket.IO │ MinIO Upload       │
 └──────┬─────────────┬──────────────┬─────────────┬───────────┘
        │             │              │             │
 ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐ ┌───▼────┐
 │ PostgreSQL  │ │   N8N    │ │   MinIO    │ │ Redis  │
 │   15        │ │  5 WF    │ │  S3 Files  │ │ Cache  │
 └─────────────┘ └────┬─────┘ └────────────┘ └────────┘
                      │
              ┌───────┴────────┐
              │  5 Workflows:  │
              │ 01-Контент-мозг│
              │ 02a-Обычное    │
              │ 02b-HeyGen     │
              │ 03-Публикатор  │
              │ 04-Карточки    │
              └────────────────┘
                      │
           ┌──────────┼──────────┐
           ▼          ▼          ▼
      GPTunnel    Minimax    HeyGen
      (AI/TTS)   (Video)   (Avatar)
```

## N8N Workflows

| #   | Файл                             | Webhook                         | Описание                                            |
| --- | -------------------------------- | ------------------------------- | --------------------------------------------------- |
| 01  | `01-content-brain.json`          | `/webhook/content-brain`        | AI-генерация идей + сценариев + видео-промптов      |
| 02a | `02a-video-factory-regular.json` | `/webhook/video-factory`        | Обычное видео: TTS → Minimax → Монтаж               |
| 02b | `02b-video-factory-heygen.json`  | `/webhook/video-factory-heygen` | HeyGen аватар: текст → говорящий аватар             |
| 03  | `03-publisher.json`              | `/webhook/publisher`            | Публикация в Telegram, VK, YouTube                  |
| 04  | `04-product-card.json`           | `/webhook/product-card`         | Карточка товара: Vision API анализ фото + генерация |

## Структура проекта

```
├── dashboard/                  # Веб-панель управления
│   ├── server.js               # Express.js (JWT, Socket.IO, 12 routes)
│   ├── Dockerfile
│   ├── public/
│   │   └── index.html          # SPA Dashboard
│   └── src/
│       ├── db.js               # PostgreSQL connection pool
│       ├── socket.js           # Socket.IO (real-time updates)
│       ├── middleware/
│       │   ├── auth.js         # JWT авторизация
│       │   └── rateLimit.js    # Rate limiting
│       └── routes/
│           ├── auth.js         # Login/logout/me
│           ├── content.js      # CRUD идей/сценариев/промптов
│           ├── videos.js       # CRUD видео + запуск пайплайнов
│           ├── cards.js        # CRUD карточек товаров
│           ├── schedule.js     # Автогенерация по расписанию
│           ├── analytics.js    # Статистика и метрики
│           ├── settings.js     # Управление настройками AI/TTS/видео
│           ├── errors.js       # Лог ошибок workflow
│           ├── media.js        # Загрузка файлов в MinIO
│           ├── internal.js     # Callbacks из N8N (без auth)
│           └── health.js       # Healthcheck
├── workflows/                  # N8N workflow JSON-файлы
│   ├── 01-content-brain.json
│   ├── 02a-video-factory-regular.json
│   ├── 02b-video-factory-heygen.json
│   ├── 03-publisher.json
│   └── 04-product-card.json
├── scripts/
│   ├── init-db.sql             # Инициализация БД (таблицы, настройки)
│   ├── migration-cards.sql     # Миграция: карточки + video_type
│   ├── backup.js               # Бэкап данных
│   └── test-aggregators.js     # Тест AI-агрегаторов
├── nginx/
│   └── nginx.conf              # Reverse proxy (production)
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/dashboards/
├── docker-compose.yml          # Весь стек
└── docs/
    ├── GUIDE-AI-AGGREGATORS.md
    ├── GUIDE-WORKFLOW-DEV.md
    └── SERVER-SETUP.md
```

## Dashboard — Страницы

| Страница             | Описание                                                 |
| -------------------- | -------------------------------------------------------- |
| **Дашборд**          | Статистика: идеи, видео, ревью, публикации, ошибки       |
| **Контент-банк**     | Управление идеями, сценариями, видео-промптами           |
| **Создать видео**    | Запуск производства (обычное / HeyGen аватар)            |
| **Видео**            | Список видео, одобрение, публикация                      |
| **Карточки товаров** | Генерация карточек из фото, просмотр, одобрение          |
| **Расписание**       | Автогенерация контента по cron                           |
| **Ошибки**           | Лог ошибок N8N workflow                                  |
| **Настройки**        | AI, TTS, Видео, Субтитры, Брендинг, HeyGen, Telegram, VK |

## AI Провайдеры

| Провайдер      | URL                             | Примечание                                |
| -------------- | ------------------------------- | ----------------------------------------- |
| **GPTunnel**   | `gptunnel.ru/v1`                | Рекомендуемый, поддерживает GPT-4o Vision |
| **OpenRouter** | `openrouter.ai/api/v1`          | Альтернатива с множеством моделей         |
| **Ollama**     | `host.docker.internal:11434/v1` | Локальный, бесплатный                     |

Настраивается в Dashboard → Настройки → AI или через `.env`.

## База данных

Ключевые таблицы:

| Таблица             | Назначение                            |
| ------------------- | ------------------------------------- |
| `content_ideas`     | Идеи контента (AI-генерация)          |
| `voice_scripts`     | Сценарии для озвучки                  |
| `video_prompts`     | Промпты для генерации видео           |
| `pipeline_sessions` | Сессии видео-производства             |
| `pipeline_steps`    | Шаги пайплайна (TTS, video, montage)  |
| `product_cards`     | Карточки товаров (AI Vision)          |
| `publications`      | Публикации в соцсетях                 |
| `media_files`       | Загруженные файлы (MinIO)             |
| `app_settings`      | Настройки приложения (50+ параметров) |
| `workflow_errors`   | Ошибки N8N workflow                   |
| `ai_costs`          | Расходы на AI API                     |
| `users`             | Пользователи панели                   |

## Роли пользователей

| Роль             | Возможности                                         |
| ---------------- | --------------------------------------------------- |
| `tech_admin`     | Полный доступ: настройки, N8N, все функции          |
| `business_owner` | Контент, видео, карточки, расписание (без настроек) |

## Требования

- Docker + Docker Compose v2
- 4GB+ RAM (для N8N + PostgreSQL + ML)
- API-ключ: GPTunnel / OpenRouter / Ollama
- Для HeyGen: ключ HeyGen API
- Для продакшена: домен + SSL

## Лицензия

MIT
