-- ═══════════════════════════════════════════════════════════════════════
-- Миграция 002: video-composer — viral_references, style_packs, sessions
-- Идемпотентна: безопасно запускать повторно (IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════════════

-- ─── viral_references ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS viral_references (
  id                  SERIAL PRIMARY KEY,
  url                 TEXT NOT NULL,
  platform            VARCHAR(20) NOT NULL
                      CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'other')),
  title               TEXT,
  description         TEXT,
  view_count          BIGINT DEFAULT 0,
  like_count          BIGINT DEFAULT 0,
  duration_sec        INTEGER DEFAULT 0,
  tags                TEXT[],
  channel_name        VARCHAR(500),
  upload_date         VARCHAR(20),
  thumbnail_url       TEXT,
  analysis            JSONB DEFAULT '{}',
  viral_score         SMALLINT DEFAULT 0 CHECK (viral_score BETWEEN 0 AND 10),
  hook_type           VARCHAR(200),
  editing_style       VARCHAR(200),
  notes               TEXT,
  status              VARCHAR(20) DEFAULT 'pending'
                      CHECK (status IN ('pending', 'analyzed', 'error')),
  error_message       TEXT,
  analyzed_at         TIMESTAMP,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_viral_refs_platform ON viral_references(platform);
CREATE INDEX IF NOT EXISTS idx_viral_refs_status   ON viral_references(status);
CREATE INDEX IF NOT EXISTS idx_viral_refs_score    ON viral_references(viral_score DESC);
CREATE INDEX IF NOT EXISTS idx_viral_refs_created  ON viral_references(created_at DESC);

-- ─── style_packs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS style_packs (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(200) NOT NULL,
  description             TEXT,
  subtitle_font           VARCHAR(100) DEFAULT 'Arial',
  subtitle_font_size      INTEGER      DEFAULT 52,
  subtitle_primary_color  VARCHAR(20)  DEFAULT '&H00FFFFFF',
  subtitle_outline_color  VARCHAR(20)  DEFAULT '&H00000000',
  subtitle_back_color     VARCHAR(20)  DEFAULT '&H80000000',
  subtitle_bold           BOOLEAN      DEFAULT TRUE,
  subtitle_outline        DECIMAL(3,1) DEFAULT 2.5,
  subtitle_shadow         DECIMAL(3,1) DEFAULT 1.0,
  subtitle_position       VARCHAR(10)  DEFAULT 'bottom'
                          CHECK (subtitle_position IN ('bottom', 'top', 'center')),
  subtitle_margin_v       INTEGER      DEFAULT 80,
  subtitle_words_per_line INTEGER      DEFAULT 4,
  subtitle_animation      VARCHAR(20)  DEFAULT 'fade'
                          CHECK (subtitle_animation IN ('none', 'fade', 'scale', 'slide')),
  color_filter            TEXT         DEFAULT '',
  vignette                BOOLEAN      DEFAULT FALSE,
  output_quality          INTEGER      DEFAULT 23,
  is_active               BOOLEAN      DEFAULT TRUE,
  is_default              BOOLEAN      DEFAULT FALSE,
  created_at              TIMESTAMP    DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_style_packs_active ON style_packs(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_style_packs_default
  ON style_packs(is_default) WHERE is_default = TRUE;

-- ─── Default style packs (6 presets) ──────────────────────────────────
INSERT INTO style_packs (
  name, description,
  subtitle_font, subtitle_font_size,
  subtitle_primary_color, subtitle_outline_color, subtitle_back_color,
  subtitle_bold, subtitle_outline, subtitle_shadow,
  subtitle_position, subtitle_margin_v, subtitle_words_per_line, subtitle_animation,
  color_filter, vignette, is_default
) VALUES
  (
    'Energetic Pop',
    'Жёлтый текст, Impact, жирная чёрная обводка. Для энергичного контента',
    'Impact', 58,
    '&H0000FFFF', '&H00000000', '&H00000000',
    TRUE, 3.0, 0.0,
    'bottom', 55, 3, 'fade',
    'eq=contrast=1.15:saturation=1.3:brightness=0.03', FALSE, TRUE
  ),
  (
    'Clean Professional',
    'Белый Arial, тонкая полупрозрачная подложка. Для экспертного контента',
    'Arial', 46,
    '&H00FFFFFF', '&H00000000', '&H90000000',
    FALSE, 1.5, 2.0,
    'bottom', 85, 5, 'none',
    'eq=contrast=1.05:saturation=1.1', TRUE, FALSE
  ),
  (
    'Bold Social',
    'Белый жирный, тёмная плашка. TikTok / Reels стиль',
    'Arial', 54,
    '&H00FFFFFF', '&H00000000', '&HA0000000',
    TRUE, 2.5, 1.0,
    'bottom', 70, 3, 'fade',
    'eq=contrast=1.1:saturation=1.2', FALSE, FALSE
  ),
  (
    'Cinematic Dark',
    'Тонкий белый Noto Sans + виньетка. Кино-стиль',
    'Noto Sans', 44,
    '&H00FFFFFF', '&H00000000', '&H00000000',
    FALSE, 1.5, 1.5,
    'bottom', 90, 6, 'none',
    'colorlevels=rimin=0.04:gimin=0.04:bimin=0.04:rimax=0.92:gimax=0.92:bimax=0.92', TRUE, FALSE
  ),
  (
    'Neon Vibes',
    'Зелёный неон, Impact. Для молодёжной аудитории',
    'Impact', 52,
    '&H0000FF00', '&H00000000', '&H00000000',
    TRUE, 2.5, 2.0,
    'bottom', 60, 3, 'scale',
    'eq=contrast=1.2:saturation=1.4:brightness=-0.05', FALSE, FALSE
  ),
  (
    'Warm Lifestyle',
    'Кремовый Noto Sans + vintage кривые. Для лайфстайл контента',
    'Noto Sans', 50,
    '&H00FFFFD0', '&H00000000', '&H80000000',
    FALSE, 2.0, 1.0,
    'bottom', 75, 4, 'fade',
    'curves=vintage', FALSE, FALSE
  )
ON CONFLICT DO NOTHING;

-- ─── pipeline_sessions — style_pack_id ────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_sessions' AND column_name = 'style_pack_id'
  ) THEN
    ALTER TABLE pipeline_sessions ADD COLUMN style_pack_id INTEGER REFERENCES style_packs(id) ON DELETE SET NULL;
  END IF;
END $$;
