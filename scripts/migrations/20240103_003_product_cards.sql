-- ═══════════════════════════════════════════════════════════════════════
-- Миграция 003: product_cards + HeyGen/A2E settings
-- Идемпотентна: безопасно запускать повторно (IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════════════

-- ─── update_updated_at() function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── product_cards table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_cards (
  id                    SERIAL PRIMARY KEY,
  product_name          VARCHAR(500) NOT NULL,
  image_url             TEXT,
  marketplace           VARCHAR(50) DEFAULT 'WB',
  artikuls              JSONB DEFAULT '[]',
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
  infographic_url       TEXT,
  infographic_variants  JSONB DEFAULT '[]',
  concept               VARCHAR(50) DEFAULT 'studio',
  generation_model      VARCHAR(50) DEFAULT 'flux-kontext-pro',
  style                 VARCHAR(50) DEFAULT 'modern',
  color_scheme          VARCHAR(50) DEFAULT 'auto',
  include_price         BOOLEAN DEFAULT FALSE,
  price                 VARCHAR(50),
  include_badge         BOOLEAN DEFAULT FALSE,
  badge_text            VARCHAR(100),
  status                VARCHAR(20) DEFAULT 'draft'
                        CHECK (status IN ('draft', 'generated', 'approved', 'rejected', 'exported')),
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

-- ─── Add infographic_url if missing (from older schema) ───────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'product_cards' AND column_name = 'infographic_url') THEN
    ALTER TABLE product_cards ADD COLUMN infographic_url TEXT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'product_cards' AND column_name = 'infographic_variants') THEN
    ALTER TABLE product_cards ADD COLUMN infographic_variants JSONB DEFAULT '[]';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'product_cards' AND column_name = 'concept') THEN
    ALTER TABLE product_cards ADD COLUMN concept VARCHAR(50) DEFAULT 'studio';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'product_cards' AND column_name = 'generation_model') THEN
    ALTER TABLE product_cards ADD COLUMN generation_model VARCHAR(50) DEFAULT 'flux-kontext-pro';
  END IF;
END $$;

-- ─── HeyGen + A2E + AI + Telegram settings ────────────────────────────
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  ('heygen_api_key',    '', 'string', 'heygen', 'HeyGen API Key',      'Ключ доступа к HeyGen', TRUE),
  ('heygen_avatar_id',  '', 'string', 'heygen', 'Аватар по умолч.',    'ID аватара HeyGen', FALSE),
  ('heygen_voice_id',   '', 'string', 'heygen', 'Голос по умолч.',     'ID голоса HeyGen', FALSE),
  ('ai_api_key',        '', 'string', 'ai',     'API ключ',            'Ключ доступа к AI провайдеру', TRUE),
  ('ai_base_url',       'https://gptunnel.ru/v1', 'string', 'ai', 'Base URL', 'URL API провайдера', FALSE),
  ('ai_auth_prefix',    '', 'string', 'ai', 'Auth prefix', 'Пусто для GPTunnel', FALSE),
  ('telegram_moderator_chat', '', 'string', 'telegram', 'Moderator Chat ID', 'ID чата модератора', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ─── Cards image generation settings ─────────────────────────────────
INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
VALUES
  ('card_image_provider', 'gptunnel',          'string', 'cards', 'Провайдер изображений', 'gptunnel / openai', FALSE),
  ('card_image_model',    'google-imagen-3',   'string', 'cards', 'Модель изображений',    'google-imagen-3 / flux-dev / seedream-3', FALSE),
  ('card_image_ar',       '1:1',               'string', 'cards', 'Соотношение сторон',    '1:1 / 9:16 / 16:9 / 4:3', FALSE)
ON CONFLICT (key) DO NOTHING;
