-- ═══════════════════════════════════════════════════════════
-- Migration 005: Products — продуктовый видео-пайплайн
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. Продукты
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(500) NOT NULL,
  description           TEXT,
  characteristics       JSONB DEFAULT '[]',
  photos                JSONB DEFAULT '[]',

  -- Выбранные AI-настройки
  heygen_avatar_id      VARCHAR(200),
  heygen_voice_id       VARCHAR(200),
  a2e_avatar_id         VARCHAR(200),
  a2e_voice_id          VARCHAR(200),
  tts_voice_id          VARCHAR(200),
  video_provider        VARCHAR(30) DEFAULT 'heygen',

  -- Системные
  status                VARCHAR(20) DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'archived')),
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_status  ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_user    ON products(created_by);

-- Trigger for updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_updated') THEN
    CREATE TRIGGER trg_products_updated
      BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────
-- 2. Запуски продуктового пайплайна
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_runs (
  id                    SERIAL PRIMARY KEY,
  product_id            INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- Статус и прогресс
  status                VARCHAR(30) DEFAULT 'created'
                        CHECK (status IN (
                          'created', 'generating_idea', 'generating_images',
                          'generating_video', 'montage', 'ready_for_review',
                          'approved', 'published', 'error', 'cancelled'
                        )),
  current_step          VARCHAR(50) DEFAULT 'created',
  error_message         TEXT,

  -- Сгенерированные данные
  idea_text             TEXT,
  script_text           TEXT,
  generated_images      JSONB DEFAULT '[]',
  avatar_video_url      TEXT,
  voice_audio_url       TEXT,
  montage_video_url     TEXT,
  final_video_url       TEXT,

  -- Параметры запуска
  heygen_avatar_id      VARCHAR(200),
  heygen_voice_id       VARCHAR(200),
  a2e_avatar_id         VARCHAR(200),
  a2e_voice_id          VARCHAR(200),
  video_provider        VARCHAR(30) DEFAULT 'heygen',
  subtitles_enabled     BOOLEAN DEFAULT TRUE,
  music_track_id        INTEGER,

  -- Привязки
  session_id            INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  execution_id          VARCHAR(100),

  -- Системные
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_runs_product ON product_runs(product_id);
CREATE INDEX IF NOT EXISTS idx_product_runs_status  ON product_runs(status);
CREATE INDEX IF NOT EXISTS idx_product_runs_created ON product_runs(created_at DESC);

-- Trigger for updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_product_runs_updated') THEN
    CREATE TRIGGER trg_product_runs_updated
      BEFORE UPDATE ON product_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

COMMENT ON TABLE products IS 'Продукты для AI видео-пайплайна';
COMMENT ON TABLE product_runs IS 'Запуски продуктового видео-пайплайна';
