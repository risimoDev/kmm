# 🏭 Workflows — Контент Завод

## Обзор

Три рабочих процесса N8N, которые образуют полный конвейер производства видеоконтента:

```
01 Контент-мозг → 02 Видео-фабрика → 03 Публикация
    (идеи)         (видео)           (соцсети)
```

Все AI-ключи хранятся **внутри N8N Credentials** (зашифровано), а не в `.env` файле.  
Настройки модели / URL / промпта хранятся в таблице `app_settings` в PostgreSQL.

---

## 📋 Список Workflow

### 01 — Контент-мозг (`01-content-brain.json`)

**Назначение:** AI генерирует идеи → сценарии → видео-промпты

**Триггер:** Webhook `POST /webhook/content-brain` или Cron (отключён по умолчанию)

**Ноды:**
| # | Нода | Что делает |
|---|------|------------|
| 1 | 📥 Webhook / ⏰ Cron | Принимает запрос или срабатывает по расписанию |
| 2 | ⚙️ Настройки из БД | Загружает `ai_model`, `ai_base_url`, `ai_system_prompt` из `app_settings` |
| 3 | 🔧 Подготовка конфига | Объединяет настройки из БД и входные параметры webhook |
| 4 | 🧠 Генерация идей | AI через HTTP Request → `/chat/completions` |
| 5 | 📋 Парсинг идей | Извлекает JSON из ответа AI |
| 6 | 💾 Сохранение идей | INSERT в `content_ideas` через PostgreSQL |
| 7 | 📝 Генерация сценария | AI создаёт голосовой сценарий на основе идеи |
| 8 | 🎬 Генерация видео-промпта | AI создаёт промпт для генерации видео |
| 9 | 📡 Callback → Dashboard | Уведомляет Dashboard о готовности контента |
| 10 | 📤 Ответ webhook | Возвращает результат |

**Credentials:**

- `httpHeaderAuth` → **AI Provider** (для AI-запросов)
- `postgres` → **Content Factory DB** (для записи в БД)

---

### 02 — Видео-фабрика (`02-video-factory.json`)

**Назначение:** Озвучка → генерация видео → монтаж с субтитрами и водяным знаком

**Триггер:** Webhook `POST /webhook/video-factory`

**Ноды:**
| # | Нода | Что делает |
|---|------|------------|
| 1 | 📥 Webhook | Принимает запрос с `session_id` |
| 2 | 🔍 Валидация | Проверяет входные данные |
| 3 | ✅ Ответ 200 | Немедленный ответ (async processing) |
| 4 | 📂 Загрузка данных | Загружает сценарий, промпт, данные из БД |
| 5 | 🔊 TTS генерация | Озвучка через OpenAI TTS API |
| 6 | 🎥 GPTunnel видео | Генерация видео через GPTunnel Veo-3.1 |
| 7 | 🔄 Полинг статуса | Цикл ожидания готовности видео (до 10 мин) |
| 8 | 📝 Субтитры SRT | Генерация файла субтитров |
| 9 | 🎞️ FFmpeg монтаж | Сборка: видео + аудио + субтитры + водяной знак |
| 10 | 📡 Callback | Уведомление Dashboard |
| 11 | 📬 Telegram | Уведомление (опционально, отключён) |

**Credentials:**

- `httpHeaderAuth` → **TTS Provider** (OpenAI / ElevenLabs)
- `httpHeaderAuth` → **AI Provider (GPTunnel)** — для TTS и видео
- `httpHeaderAuth` → **Telegram Bot** (опционально)
- `postgres` → **Content Factory DB**

---

### 03 — Публикация (`03-publisher.json`)

**Назначение:** AI-генерация описания + публикация в Telegram / VK

**Триггер:** Webhook `POST /webhook/publisher`

**Ноды:**
| # | Нода | Что делает |
|---|------|------------|
| 1 | 📥 Webhook | Принимает запрос с `session_id` и `channels` |
| 2 | ⚙️ Настройки из БД | Загружает AI-настройки |
| 3 | 📂 Загрузка сессии | Загружает данные сессии из БД |
| 4 | 🧠 AI → Описание | Генерация текста поста через AI |
| 5 | 🔀 Разделить каналы | Разделяет на отдельные публикации |
| 6 | 📬 Telegram / 📘 VK | Публикация в выбранные каналы |
| 7 | 💾 Сохранение | Запись в таблицу `publications` |
| 8 | 📡 Callback | Уведомление Dashboard |

**Credentials:**

- `httpHeaderAuth` → **AI Provider** (для генерации описания)
- `httpHeaderAuth` → **Telegram Bot**
- `httpHeaderAuth` → **VK API Token**
- `postgres` → **Content Factory DB**

---

## 🔐 Настройка Credentials в N8N

> **Почему через Credentials, а не `.env`?**  
> N8N шифрует credentials с помощью `N8N_ENCRYPTION_KEY`.  
> Ключи в `.env` хранятся в открытом виде — это небезопасно.

### Шаг 1: Postgres Credential

1. Откройте N8N → **Settings → Credentials → Add Credential**
2. Тип: **Postgres**
3. Заполните:
   - **Host:** `postgres`
   - **Database:** ваша БД (значение `DB_POSTGRESDB_DATABASE` из `.env`)
   - **User:** `DB_POSTGRESDB_USER`
   - **Password:** `DB_POSTGRESDB_PASSWORD`
   - **Port:** `5432`
4. **Имя:** `Content Factory DB`
5. Нажмите **Save**

### Шаг 2: AI Credential (Header Auth)

1. **Add Credential** → Тип: **Header Auth**
2. Заполните:
   - **Header Name:** `Authorization`
   - **Header Value:** `Bearer ВАШ_API_КЛЮЧ`

   > Примеры:
   >
   > - GPTunnel: `Bearer sk-gpt-xxx`
   > - OpenAI: `Bearer sk-xxx`
   > - OpenRouter: `Bearer sk-or-xxx`

3. **Имя:** `AI Provider (GPTunnel / OpenAI / OpenRouter)`

### Шаг 3: TTS Credential

1. Тип: **Header Auth**
2. **Header Name:** `Authorization`
3. **Header Value:** `Bearer ВАШ_OPENAI_KEY` (или ElevenLabs key)
4. **Имя:** `TTS Provider (OpenAI / ElevenLabs)`

### Шаг 4: Telegram Bot Credential

1. Тип: **Header Auth**
2. **Header Name:** оставьте пустым (токен передаётся в URL)
3. **Имя:** `Telegram Bot`

> Или используйте встроенный тип **Telegram API** с BotFather токеном.

### Шаг 6: VK Credential

1. Тип: **Header Auth**
2. **Header Name:** `Authorization`
3. **Header Value:** `Bearer ВАШ_VK_TOKEN`
4. **Имя:** `VK API Token`

---

## ⚙️ Настройки AI через Dashboard

Вместо env-переменных, настройки AI хранятся в таблице `app_settings`:

| Ключ               | Описание         | Пример                          |
| ------------------ | ---------------- | ------------------------------- |
| `ai_model`         | Модель AI        | `gpt-4o-mini`                   |
| `ai_base_url`      | Базовый URL API  | `https://gptunnel.ru/v1`        |
| `ai_system_prompt` | Системный промпт | `Ты — эксперт по маркетингу...` |

**Менять через:** Dashboard → Настройки → AI

Каждый workflow при запуске читает настройки из БД автоматически.

---

## 🔄 Импорт Workflow в N8N

### Автоматически (при первом запуске)

Workflow файлы монтируются в контейнер N8N через Docker volume:

```yaml
volumes:
  - ./workflows:/home/node/workflows
```

### Вручную (через UI)

1. Откройте N8N: `http://ваш-сервер:5678`
2. **Workflows → Import from File**
3. Выберите JSON файл
4. **Обязательно:** обновите Credential references (см. ниже)

### Замена Credential ID

В JSON файлах используются плейсхолдеры. После импорта замените на реальные ID:

| Плейсхолдер              | На что менять                  |
| ------------------------ | ------------------------------ |
| `POSTGRES_CREDENTIAL_ID` | ID вашего Postgres credential  |
| `AI_CREDENTIAL_ID`       | ID вашего AI credential        |
| `TTS_CREDENTIAL_ID`      | ID TTS credential              |
| `GPTUNNEL_CREDENTIAL_ID` | ID GPTunnel credential (video) |
| `TELEGRAM_CREDENTIAL_ID` | ID Telegram credential         |
| `VK_CREDENTIAL_ID`       | ID VK credential               |

> 💡 **Как найти ID:** в N8N откройте credential → посмотрите ID в адресной строке браузера

---

## 📁 Структура файлов

```
workflows/
├── 01-content-brain.json   # 🧠 AI генерация контента
├── 02-video-factory.json   # 🎬 Производство видео
├── 03-publisher.json       # 📡 Публикация в соцсети
└── README.md               # 📖 Этот файл
```
