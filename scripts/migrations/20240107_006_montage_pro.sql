-- ═══════════════════════════════════════════════════════════
-- Миграция 006: Версионирование монтажных скриптов
-- ═══════════════════════════════════════════════════════════

-- Версии монтажных скриптов (история изменений)
CREATE TABLE IF NOT EXISTS montage_script_versions (
  id           SERIAL       PRIMARY KEY,
  script_id    INTEGER      NOT NULL
                 REFERENCES montage_scripts(id) ON DELETE CASCADE,
  version_num  INTEGER      NOT NULL,
  script_json  JSONB        NOT NULL,
  name         VARCHAR(255),
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  created_by   INTEGER,
  UNIQUE (script_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_msv_script ON montage_script_versions(script_id, version_num DESC);

-- Метаданные рендер-задач (output_path для frame scrubber)
ALTER TABLE montage_jobs
  ADD COLUMN IF NOT EXISTS output_path TEXT,
  ADD COLUMN IF NOT EXISTS fps         INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS resolution  VARCHAR(20);
