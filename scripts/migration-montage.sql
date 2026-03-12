-- ═══════════════════════════════════════════════════════════
-- Миграция: таблицы для монтажного редактора
-- ═══════════════════════════════════════════════════════════

-- Скрипты монтажа (JSON шаблоны для таймлайна)
CREATE TABLE IF NOT EXISTS montage_scripts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  script_json JSONB NOT NULL,
  template_type VARCHAR(50),  -- ugc_30s | review_60s | stories_15s
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  render_count INTEGER DEFAULT 0,
  last_rendered_at TIMESTAMP
);

-- Задачи рендера
CREATE TABLE IF NOT EXISTS montage_jobs (
  id VARCHAR(36) PRIMARY KEY,  -- UUID
  script_id INTEGER REFERENCES montage_scripts(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'queued',  -- queued | processing | done | error
  progress INTEGER DEFAULT 0,
  output_url TEXT,
  error_text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_montage_scripts_template ON montage_scripts(template_type);
CREATE INDEX IF NOT EXISTS idx_montage_jobs_status ON montage_jobs(status);
CREATE INDEX IF NOT EXISTS idx_montage_jobs_script ON montage_jobs(script_id);
