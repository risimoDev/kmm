-- ═══════════════════════════════════════════════════════════
-- Контент Завод — Схема базы данных v3.0
-- ═══════════════════════════════════════════════════════════
-- Идемпотентно: безопасно запускать повторно.

-- ─────────────────────────────────────────
-- 1. Пользователи
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  login         VARCHAR(100) UNIQUE,
  telegram_id   BIGINT,
  username      VARCHAR(100),
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  photo_url     TEXT,
  password_hash VARCHAR(128),
  password_salt VARCHAR(64),
  role          VARCHAR(20) DEFAULT 'business_owner'
                CHECK (role IN ('tech_admin', 'business_owner')),
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_unique
  ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);

-- ─────────────────────────────────────────
-- 2. Одноразовые токены для входа через Telegram
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_tokens (
  id            SERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  token         VARCHAR(64) UNIQUE NOT NULL,
  used          BOOLEAN DEFAULT FALSE,
  expires_at    TIMESTAMP NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_token   ON login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expires  ON login_tokens(expires_at);

-- ─────────────────────────────────────────
-- 3. Настройки (key-value из Dashboard)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id            SERIAL PRIMARY KEY,
  key           VARCHAR(100) UNIQUE NOT NULL,
  value         TEXT,
  type          VARCHAR(20) DEFAULT 'string'
                CHECK (type IN ('string', 'number', 'boolean', 'json')),
  category      VARCHAR(50) NOT NULL,
  label         VARCHAR(200),
  description   TEXT,
  is_secret     BOOLEAN DEFAULT FALSE,
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_settings_category ON app_settings(category);
CREATE INDEX IF NOT EXISTS idx_app_settings_key      ON app_settings(key);

-- Дефолтные настройки
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  -- AI
  ('ai_api_key',          '',                         'string', 'ai',       'API ключ',             'Ключ для AI API (GPTunnel, OpenRouter и др.)', TRUE),
  ('ai_base_url',         'https://gptunnel.ru/v1',  'string', 'ai',       'Base URL',             'Базовый URL AI API', FALSE),
  ('ai_model',            'gpt-4o',                  'string', 'ai',       'Модель',               'Модель AI для генерации контента', FALSE),
  ('ai_auth_prefix',      '',                         'string', 'ai',       'Auth prefix',          'Префикс авторизации (Bearer, пусто для GPTunnel)', FALSE),
  ('ai_system_prompt',    'Ты — креативный маркетолог. Генерируй вирусный контент для коротких видео (Reels/Shorts/TikTok). Tone of voice: дружелюбный, профессиональный.', 'string', 'ai', 'Системный промпт', 'Единый tone-of-voice для всех генераций', FALSE),
  -- TTS
  ('tts_provider',            'gptunnel',                  'string', 'tts',      'TTS провайдер',        'openai / gptunnel / elevenlabs / azure', FALSE),
  ('tts_voice',               'alloy',                     'string', 'tts',      'Голос по умолч.',      'ID голоса для OpenAI / ElevenLabs TTS', FALSE),
  ('tts_speed',               '1.0',                       'string', 'tts',      'Скорость речи',       '0.5 — 2.0', FALSE),
  ('tts_gptunnel_voice_id',   '65f4092eddc5862248a18111',  'string', 'tts',      'GPTunnel Voice ID',   'ID голоса GPTunnel TTS (см. список голосов)', FALSE),
  ('tts_gptunnel_voice_name', 'ALEX',                      'string', 'tts',      'GPTunnel голос',      'Имя выбранного голоса GPTunnel', FALSE),
  -- Video generation
  ('video_provider',          'minimax',                  'string', 'video',    'Видео провайдер',      'minimax / gptunnel / runway / kling', FALSE),
  ('max_video_duration',      '60',                       'number', 'video',    'Макс. длительность',   'Максимальная длительность видео в секундах', FALSE),
  ('video_gptunnel_model',    'glabs-veo-3-1',            'string', 'video',    'GPTunnel модель видео', 'glabs-veo-3-1 (Quality) / glabs-veo-3-1-fast', FALSE),
  -- Карточки товаров (генерация изображений)
  ('card_image_provider',     'gptunnel',                 'string', 'cards',    'Провайдер изображений', 'gptunnel / openai — генерация картинок для карточек', FALSE),
  ('card_image_model',        'google-imagen-3',          'string', 'cards',    'Модель изображений',   'google-imagen-3 / flux-dev / seedream-3', FALSE),
  ('card_image_ar',           '1:1',                      'string', 'cards',    'Соотношение сторон',   '1:1 / 9:16 / 16:9 / 4:3', FALSE),
  -- Subtitles
  ('subtitle_font',      'Arial',                   'string', 'subtitle', 'Шрифт субтитров',     'Название шрифта для субтитров', FALSE),
  ('subtitle_size',      '42',                      'number', 'subtitle', 'Размер субтитров',    'Размер шрифта субтитров (px)', FALSE),
  ('subtitle_color',     'white',                   'string', 'subtitle', 'Цвет субтитров',      'Цвет текста субтитров', FALSE),
  ('subtitle_outline',   '2',                       'number', 'subtitle', 'Обводка субтитров',   'Толщина обводки (px)', FALSE),
  -- Branding
  ('watermark_url',      '',                        'string', 'branding', 'URL водяного знака',   'URL логотипа для водяного знака', FALSE),
  ('watermark_position', 'top-right',               'string', 'branding', 'Позиция логотипа',    'top-left / top-right / bottom-left / bottom-right', FALSE),
  ('watermark_opacity',  '0.7',                     'string', 'branding', 'Прозрачность лого',   '0.0 — 1.0', FALSE),
  -- Telegram
  ('telegram_bot_token',      '',    'string', 'telegram', 'Токен бота',           'Токен от @BotFather', TRUE),
  ('telegram_chat_id',        '0',   'string', 'telegram', 'Chat ID уведомл.',     'ID чата для уведомлений', FALSE),
  ('telegram_channel_id',     '0',   'string', 'telegram', 'Channel ID',           'ID канала для публикации', FALSE),
  ('telegram_moderator_chat', '0',   'string', 'telegram', 'Moderator Chat ID',    'ID чата модерации', FALSE),
  -- HeyGen
  ('heygen_api_key',    '',    'string', 'heygen', 'HeyGen API Key',      'Ключ API HeyGen для аватаров', TRUE),
  ('heygen_avatar_id',  '',    'string', 'heygen', 'Аватар по умолч.',    'ID аватара HeyGen по умолчанию', FALSE),
  ('heygen_voice_id',   '',    'string', 'heygen', 'Голос по умолч.',     'ID голоса HeyGen по умолчанию', FALSE),
  -- A2E (AI Avatar)
  ('a2e_api_token',     '',    'string', 'a2e', 'A2E API Token',       'Bearer-токен A2E API (video.a2e.ai → профиль → API Token)', TRUE),
  ('a2e_base_url',      'https://video.a2e.ai', 'string', 'a2e', 'Base URL',    'Базовый URL A2E API (US: video.a2e.ai, China: video.a2e.com.cn)', FALSE),
  ('a2e_avatar_id',     '',    'string', 'a2e', 'Аватар по умолч.',    'ID аватара A2E по умолчанию (_id из списка аватаров)', FALSE),
  ('a2e_voice_id',      '',    'string', 'a2e', 'TTS голос по умолч.', 'ID голоса A2E TTS (value из списка голосов)', FALSE),
  ('a2e_voice_country', 'ru',  'string', 'a2e', 'Страна голоса',      'Код страны для TTS (ru, en, zh и др.)', FALSE),
  ('a2e_voice_region',  '',    'string', 'a2e', 'Регион голоса',       'Регион для TTS (необязательно)', FALSE),
  ('a2e_speech_rate',   '1.0', 'string', 'a2e', 'Скорость речи',      'Скорость TTS: 0.5 — 2.0', FALSE),
  ('a2e_resolution',    '1080','string', 'a2e', 'Разрешение',         'Разрешение видео: 480 / 720 / 1080', FALSE),
  ('a2e_background',    '',    'string', 'a2e', 'Фон видео',          'Цвет фона (#RRGGBB) или ID фона. Пусто = фон аватара', FALSE),
  ('a2e_captions',      'false','boolean','a2e', 'Субтитры A2E',      'Включить встроенные субтитры A2E', FALSE),
  -- VK
  ('vk_access_token',   '',    'string', 'vk', 'VK Access Token', 'Токен VK API', TRUE),
  ('vk_group_id',        '',    'string', 'vk', 'VK Group ID',     'ID сообщества VK', FALSE),
  -- Schedule
  ('auto_generate_enabled',  'false', 'boolean', 'schedule', 'Автогенерация',       'Включена ли автогенерация идей по расписанию', FALSE),
  ('auto_generate_cron',     '0 9 * * 1-5', 'string', 'schedule', 'Cron расписание', 'Расписание автогенерации (cron выражение)', FALSE),
  ('auto_generate_count',    '3',     'number', 'schedule', 'Кол-во идей',         'Сколько идей генерировать за раз', FALSE),
  ('default_channels',       '["telegram"]', 'json', 'schedule', 'Каналы по умолч.', 'Каналы для автопубликации', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────
-- 4. Контент — Идеи
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_ideas (
  id                  SERIAL PRIMARY KEY,
  category            VARCHAR(100),
  title               VARCHAR(500) NOT NULL,
  concept             TEXT,
  visual_description  TEXT,
  target_audience     VARCHAR(500),
  tone                VARCHAR(100),
  status              VARCHAR(20) DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'rejected', 'used')),
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ideas_status  ON content_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_created ON content_ideas(created_at DESC);

-- ─────────────────────────────────────────
-- 5. Контент — Сценарии озвучки
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_scripts (
  id               SERIAL PRIMARY KEY,
  idea_id          INTEGER REFERENCES content_ideas(id) ON DELETE CASCADE,
  script_text      TEXT NOT NULL,
  word_count       INTEGER DEFAULT 0,
  duration_hint    INTEGER DEFAULT 0,
  timing_marks     JSONB DEFAULT '[]',
  status           VARCHAR(20) DEFAULT 'draft'
                   CHECK (status IN ('draft', 'approved', 'rejected', 'used')),
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_scripts_idea   ON voice_scripts(idea_id);
CREATE INDEX IF NOT EXISTS idx_voice_scripts_status ON voice_scripts(status);

-- ─────────────────────────────────────────
-- 6. Контент — Промпты для видеогенерации
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_prompts (
  id                  SERIAL PRIMARY KEY,
  idea_id             INTEGER REFERENCES content_ideas(id) ON DELETE CASCADE,
  prompt_text         TEXT NOT NULL,
  scene_descriptions  JSONB DEFAULT '[]',
  style_reference     VARCHAR(200),
  status              VARCHAR(20) DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'rejected', 'used')),
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_prompts_idea   ON video_prompts(idea_id);
CREATE INDEX IF NOT EXISTS idx_video_prompts_status ON video_prompts(status);

-- ─────────────────────────────────────────
-- 7. Сессии видео-пайплайна
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_sessions (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source               VARCHAR(20) DEFAULT 'web',

  -- Статус и прогресс
  status               VARCHAR(50) DEFAULT 'created'
                       CHECK (status IN (
                         'created', 'processing', 'ready_for_review',
                         'approved', 'publishing', 'published',
                         'rejected', 'error', 'cancelled'
                       )),
  current_step         VARCHAR(50) DEFAULT 'created',
  error_message        TEXT,
  error_step           VARCHAR(50),

  -- Данные о товаре
  product_name         VARCHAR(500),
  product_image_url    TEXT,
  artikul              VARCHAR(100),
  show_artikul         BOOLEAN DEFAULT FALSE,

  -- Привязки к контенту
  idea_id              INTEGER REFERENCES content_ideas(id) ON DELETE SET NULL,
  voice_script_id      INTEGER REFERENCES voice_scripts(id) ON DELETE SET NULL,
  video_prompt_id      INTEGER REFERENCES video_prompts(id) ON DELETE SET NULL,

  -- Результаты пайплайна
  product_image_clean_url TEXT,
  voice_file_url       TEXT,
  voice_duration       DECIMAL(10,2),
  raw_video_url        TEXT,
  subtitle_file_url    TEXT,
  final_video_url      TEXT,
  thumbnail_url        TEXT,

  -- Публикация
  auto_publish         BOOLEAN DEFAULT FALSE,

  -- Тип видео
  video_type           VARCHAR(30) DEFAULT 'regular'
                       CHECK (video_type IN ('regular', 'gptunnel', 'heygen', 'a2e')),

  -- Управление N8N
  execution_id         VARCHAR(100),

  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON pipeline_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON pipeline_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON pipeline_sessions(created_at DESC);

-- ─────────────────────────────────────────
-- 8. Шаги пайплайна
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_steps (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES pipeline_sessions(id) ON DELETE CASCADE,
  step_name       VARCHAR(50) NOT NULL,
  step_order      INTEGER NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  input_data      JSONB DEFAULT '{}',
  output_data     JSONB DEFAULT '{}',
  ai_model        VARCHAR(100),
  tokens_used     INTEGER DEFAULT 0,
  duration_ms     INTEGER DEFAULT 0,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_steps_session ON pipeline_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_steps_status  ON pipeline_steps(status);

-- ─────────────────────────────────────────
-- 9. Лог ошибок workflow
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_errors (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  workflow_name   VARCHAR(100),
  workflow_id     VARCHAR(50),
  execution_id    VARCHAR(50),
  error_message   TEXT,
  error_stack     TEXT,
  node_name       VARCHAR(100),
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errors_session ON workflow_errors(session_id);
CREATE INDEX IF NOT EXISTS idx_errors_created ON workflow_errors(created_at DESC);

-- ─────────────────────────────────────────
-- 10. Расходы AI
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_costs (
  id                SERIAL PRIMARY KEY,
  session_id        INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  step_name         VARCHAR(50),
  provider          VARCHAR(50),
  model             VARCHAR(100),
  tokens_prompt     INTEGER DEFAULT 0,
  tokens_completion INTEGER DEFAULT 0,
  tokens_total      INTEGER DEFAULT 0,
  cost_usd          DECIMAL(10,6) DEFAULT 0,
  duration_ms       INTEGER DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_costs_session ON ai_costs(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_costs_created ON ai_costs(created_at DESC);

-- ─────────────────────────────────────────
-- 11. Медиа-файлы (индекс MinIO)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_files (
  id            SERIAL PRIMARY KEY,
  session_id    INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  file_key      VARCHAR(500) NOT NULL,
  file_name     VARCHAR(255),
  file_type     VARCHAR(50)
                CHECK (file_type IN ('video', 'image', 'audio', 'document')),
  mime_type     VARCHAR(100),
  file_size     BIGINT,
  source        VARCHAR(50),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_session ON media_files(session_id);
CREATE INDEX IF NOT EXISTS idx_media_type    ON media_files(file_type);

-- ─────────────────────────────────────────
-- 12. Публикации
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publications (
  id             SERIAL PRIMARY KEY,
  session_id     INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  platform       VARCHAR(30) NOT NULL
                 CHECK (platform IN ('telegram', 'vk', 'youtube_shorts')),
  post_id        VARCHAR(100),
  post_url       TEXT,
  caption        TEXT,
  media_keys     TEXT[],
  status         VARCHAR(20) DEFAULT 'pending'
                 CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  published_at   TIMESTAMP,
  error_message  TEXT,
  metrics        JSONB DEFAULT '{}',
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publications_session  ON publications(session_id);
CREATE INDEX IF NOT EXISTS idx_publications_platform ON publications(platform);
CREATE INDEX IF NOT EXISTS idx_publications_status   ON publications(status);

-- ─────────────────────────────────────────
-- Авто-обновление updated_at
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated') THEN
    CREATE TRIGGER trg_users_updated
      BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sessions_updated') THEN
    CREATE TRIGGER trg_sessions_updated
      BEFORE UPDATE ON pipeline_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_settings_updated') THEN
    CREATE TRIGGER trg_settings_updated
      BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────
-- Миграция: добавить video_type если отсутствует
-- ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_sessions' AND column_name = 'video_type'
  ) THEN
    ALTER TABLE pipeline_sessions ADD COLUMN video_type VARCHAR(30) DEFAULT 'regular';
  END IF;
END $$;

-- ─────────────────────────────────────────
-- Комментарии
-- ─────────────────────────────────────────
COMMENT ON TABLE users             IS 'Пользователи системы';
COMMENT ON TABLE login_tokens      IS 'Одноразовые токены для входа через Telegram';
COMMENT ON TABLE app_settings      IS 'Настройки системы (key-value)';
COMMENT ON TABLE content_ideas     IS 'Банк идей для видео контента';
COMMENT ON TABLE voice_scripts     IS 'Сценарии озвучки к идеям';
COMMENT ON TABLE video_prompts     IS 'Промпты для AI видеогенерации';
COMMENT ON TABLE pipeline_sessions IS 'Сессии видео-производства';
COMMENT ON TABLE pipeline_steps    IS 'Шаги каждой сессии пайплайна';
COMMENT ON TABLE workflow_errors   IS 'Лог ошибок workflow';
COMMENT ON TABLE ai_costs          IS 'Трекинг расходов AI';
COMMENT ON TABLE media_files       IS 'Индекс медиа-файлов в MinIO';
COMMENT ON TABLE publications      IS 'Публикации в соцсетях';
