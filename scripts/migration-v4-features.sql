-- ═══════════════════════════════════════════════════════════
-- Миграция v4 — Платформы, субтитры, музыка, автоматизация
-- ═══════════════════════════════════════════════════════════
-- Идемпотентно: безопасно запускать повторно.

-- ─────────────────────────────────────────
-- 1. content_ideas.content_type — тип контента (regular/a2e)
-- ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_ideas' AND column_name = 'content_type'
  ) THEN
    ALTER TABLE content_ideas ADD COLUMN content_type VARCHAR(30) DEFAULT 'regular';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ideas_content_type ON content_ideas(content_type);

-- ─────────────────────────────────────────
-- 2. pipeline_sessions — субтитры и музыка
-- ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_sessions' AND column_name = 'subtitles_enabled'
  ) THEN
    ALTER TABLE pipeline_sessions ADD COLUMN subtitles_enabled BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_sessions' AND column_name = 'music_track_id'
  ) THEN
    ALTER TABLE pipeline_sessions ADD COLUMN music_track_id INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_sessions' AND column_name = 'music_volume'
  ) THEN
    ALTER TABLE pipeline_sessions ADD COLUMN music_volume DECIMAL(3,2) DEFAULT 0.15;
  END IF;
END $$;

-- ─────────────────────────────────────────
-- 3. Таблица музыкальных треков
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS music_tracks (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  file_key      VARCHAR(500) NOT NULL,
  file_name     VARCHAR(255),
  duration_sec  INTEGER DEFAULT 0,
  file_size     BIGINT DEFAULT 0,
  category      VARCHAR(100) DEFAULT 'общий',
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_active ON music_tracks(is_active);
CREATE INDEX IF NOT EXISTS idx_music_tracks_category ON music_tracks(category);

-- ─────────────────────────────────────────
-- 4. Новые настройки расписания (автоматизация)
-- ─────────────────────────────────────────
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  -- Автоматизация: тип контента для генерации
  ('auto_content_type',       'regular', 'string',  'schedule', 'Тип контента',        'Тип контента для автогенерации: regular / a2e', FALSE),
  -- Автоматизация: авто-создание видео
  ('auto_video_enabled',      'false',   'boolean', 'schedule', 'Авто-видео',          'Автоматически создавать видео из новых идей', FALSE),
  ('auto_video_type',         'regular', 'string',  'schedule', 'Тип авто-видео',      'Тип видео: regular / a2e / heygen', FALSE),
  ('auto_video_cron',         '0 10 * * 1-5', 'string', 'schedule', 'Cron видео',      'Расписание авто-создания видео', FALSE),
  ('auto_video_batch',        '2',       'number',  'schedule', 'Видео за раз',        'Сколько видео создавать за запуск', FALSE),
  ('auto_subtitles',          'true',    'boolean', 'schedule', 'Субтитры (авто)',     'Включить субтитры при автосоздании', FALSE),
  ('auto_music_track_id',     '',        'string',  'schedule', 'Музыка (авто)',       'ID трека для автосоздания (пусто = без музыки)', FALSE),
  -- Автоматизация: авто-публикация
  ('auto_publish_enabled',    'false',   'boolean', 'schedule', 'Авто-публикация',    'Автоматически публиковать готовые видео', FALSE),
  ('auto_publish_cron',       '0 12 * * 1-5', 'string', 'schedule', 'Cron публикации', 'Расписание авто-публикации', FALSE),
  ('auto_publish_batch',      '1',       'number',  'schedule', 'Публ. за раз',       'Сколько видео публиковать за запуск', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────
-- 5. Настройки музыки
-- ─────────────────────────────────────────
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  ('music_default_volume', '0.15', 'string', 'branding', 'Громкость музыки', 'Громкость фоновой музыки (0.0-1.0, рекомендуется 0.1-0.2)', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────
-- Комментарии
-- ─────────────────────────────────────────
COMMENT ON TABLE music_tracks IS 'Библиотека фоновых музыкальных треков';
COMMENT ON COLUMN content_ideas.content_type IS 'Тип контента: regular (обычное видео) или a2e (аватар)';
COMMENT ON COLUMN pipeline_sessions.subtitles_enabled IS 'Включить субтитры для этого видео';
COMMENT ON COLUMN pipeline_sessions.music_track_id IS 'ID музыкального трека из music_tracks';
COMMENT ON COLUMN pipeline_sessions.music_volume IS 'Громкость музыки 0.0-1.0';
