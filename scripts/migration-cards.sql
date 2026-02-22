-- ═══════════════════════════════════════════════════════════
-- Migration: Product Cards + HeyGen settings
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 13. Карточки товаров
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_cards (
  id                    SERIAL PRIMARY KEY,
  product_name          VARCHAR(500) NOT NULL,
  image_url             TEXT,
  marketplace           VARCHAR(50) DEFAULT 'WB',
  artikuls              JSONB DEFAULT '[]',
  
  -- AI-сгенерированные данные
  main_title            VARCHAR(500),
  subtitle              VARCHAR(500),
  bullet_points         JSONB DEFAULT '[]',
  cta_text              VARCHAR(200),
  seo_title             VARCHAR(500),
  seo_description       TEXT,
  search_keywords       JSONB DEFAULT '[]',
  category_suggestion   VARCHAR(200),
  color_palette         JSONB DEFAULT '[]',
  visual_style_notes    TEXT,
  rich_content_blocks   JSONB DEFAULT '[]',
  infographic_prompts   JSONB DEFAULT '[]',
  a_plus_content        JSONB DEFAULT '{}',
  
  -- Настройки
  style                 VARCHAR(50) DEFAULT 'modern',
  color_scheme          VARCHAR(50) DEFAULT 'auto',
  include_price         BOOLEAN DEFAULT FALSE,
  price                 VARCHAR(50),
  include_badge         BOOLEAN DEFAULT FALSE,
  badge_text            VARCHAR(100),
  
  -- Статус
  status                VARCHAR(20) DEFAULT 'draft'
                        CHECK (status IN ('draft', 'generated', 'approved', 'rejected', 'exported')),
  
  -- Meta
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_id            INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_status   ON product_cards(status);
CREATE INDEX IF NOT EXISTS idx_cards_created  ON product_cards(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_product  ON product_cards(product_name);

-- Trigger for updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cards_updated') THEN
    CREATE TRIGGER trg_cards_updated
      BEFORE UPDATE ON product_cards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────
-- New settings: HeyGen (if missing)
-- ─────────────────────────────────────────
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  ('heygen_api_key',    '', 'string', 'heygen', E'HeyGen API Key',               E'\u041a\u043b\u044e\u0447 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a HeyGen', TRUE),
  ('heygen_avatar_id',  '', 'string', 'heygen', E'\u0410\u0432\u0430\u0442\u0430\u0440 \u043f\u043e \u0443\u043c\u043e\u043b\u0447.', E'ID \u0430\u0432\u0430\u0442\u0430\u0440\u0430 HeyGen', FALSE),
  ('heygen_voice_id',   '', 'string', 'heygen', E'\u0413\u043e\u043b\u043e\u0441 \u043f\u043e \u0443\u043c\u043e\u043b\u0447.',  E'ID \u0433\u043e\u043b\u043e\u0441\u0430 HeyGen', FALSE),
  ('ai_api_key',        '', 'string', 'ai',     E'API \u043a\u043b\u044e\u0447',   E'\u041a\u043b\u044e\u0447 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a AI \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0443', TRUE),
  ('ai_base_url',       'https://gptunnel.ru/v1', 'string', 'ai', 'Base URL', E'URL API \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0430', FALSE),
  ('ai_auth_prefix',    '', 'string', 'ai', 'Auth prefix', E'\u041f\u0443\u0441\u0442\u043e\u0439 \u0434\u043b\u044f GPTunnel', FALSE),
  ('telegram_moderator_chat', '', 'string', 'telegram', 'Moderator Chat ID', E'ID \u0447\u0430\u0442\u0430 \u043c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440\u0430', FALSE)
ON CONFLICT (key) DO NOTHING;

-- Add video_type to pipeline_sessions if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pipeline_sessions' AND column_name = 'video_type') THEN
    ALTER TABLE pipeline_sessions ADD COLUMN video_type VARCHAR(20) DEFAULT 'regular';
  END IF;
END $$;

COMMENT ON TABLE product_cards IS E'\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0442\u043e\u0432\u0430\u0440\u043e\u0432 (AI-\u0433\u0435\u043d\u0435\u0440\u0430\u0446\u0438\u044f \u043f\u043e \u0444\u043e\u0442\u043e)';
