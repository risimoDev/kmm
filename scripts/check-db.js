#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 * Контент Завод — Проверка БД + автомиграция
 * ═══════════════════════════════════════════════════════════
 * Запуск:
 *   docker exec -it content-factory-dashboard node /app/scripts/check-db.js
 *   или на сервере (если postgres доступен):
 *   DB_HOST=localhost DB_PASSWORD=xxx node scripts/check-db.js
 *
 * Флаги:
 *   --check    только проверка, без миграции (по умолчанию)
 *   --migrate  применить все недостающие миграции
 *   --fix      то же что --migrate
 */

const { Client } = require('pg');

// ── Конфигурация ──
const DB = {
  host:     process.env.DB_HOST     || process.env.DB_POSTGRESDB_HOST     || 'postgres',
  port:     parseInt(process.env.DB_PORT || process.env.DB_POSTGRESDB_PORT || '5432'),
  user:     process.env.DB_USER     || process.env.DB_POSTGRESDB_USER     || 'n8n_user',
  password: process.env.DB_PASSWORD || process.env.DB_POSTGRESDB_PASSWORD || 'adminrisimofloor',
  database: process.env.DB_NAME     || process.env.DB_POSTGRESDB_DATABASE || 'n8n',
};

const doMigrate = process.argv.includes('--migrate') || process.argv.includes('--fix');

// ── Цвета ──
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', white: '\x1b[37m', magenta: '\x1b[35m',
};
const OK   = `${C.green}✅${C.reset}`;
const WARN = `${C.yellow}⚠️${C.reset}`;
const FAIL = `${C.red}❌${C.reset}`;
const ADD  = `${C.cyan}➕${C.reset}`;
const FIX  = `${C.magenta}🔧${C.reset}`;

// ══════════════════════════════════════════════════════════
// Эталонная схема — все таблицы, колонки, индексы, триггеры
// ══════════════════════════════════════════════════════════

const SCHEMA = {
  tables: {
    users: {
      columns: {
        id: 'integer', login: 'character varying', telegram_id: 'bigint',
        username: 'character varying', first_name: 'character varying',
        last_name: 'character varying', photo_url: 'text',
        password_hash: 'character varying', password_salt: 'character varying',
        role: 'character varying', is_active: 'boolean',
        last_login: 'timestamp without time zone',
        created_at: 'timestamp without time zone',
        updated_at: 'timestamp without time zone',
      },
      indexes: ['idx_users_telegram_unique', 'idx_users_role', 'idx_users_login'],
      triggers: ['trg_users_updated'],
    },

    login_tokens: {
      columns: {
        id: 'integer', telegram_id: 'bigint', token: 'character varying',
        used: 'boolean', expires_at: 'timestamp without time zone',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_login_tokens_token', 'idx_login_tokens_expires'],
    },

    app_settings: {
      columns: {
        id: 'integer', key: 'character varying', value: 'text',
        type: 'character varying', category: 'character varying',
        label: 'character varying', description: 'text',
        is_secret: 'boolean', updated_by: 'character varying',
        updated_at: 'timestamp without time zone',
      },
      indexes: ['idx_app_settings_category', 'idx_app_settings_key'],
      triggers: ['trg_settings_updated'],
    },

    content_ideas: {
      columns: {
        id: 'integer', category: 'character varying', title: 'character varying',
        concept: 'text', visual_description: 'text',
        target_audience: 'character varying', tone: 'character varying',
        content_type: 'character varying',
        status: 'character varying',
        created_by: 'integer', reviewed_by: 'integer',
        reviewed_at: 'timestamp without time zone',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_ideas_status', 'idx_ideas_created', 'idx_ideas_content_type'],
    },

    voice_scripts: {
      columns: {
        id: 'integer', idea_id: 'integer', script_text: 'text',
        word_count: 'integer', duration_hint: 'integer',
        timing_marks: 'jsonb', status: 'character varying',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_voice_scripts_idea', 'idx_voice_scripts_status'],
    },

    video_prompts: {
      columns: {
        id: 'integer', idea_id: 'integer', prompt_text: 'text',
        scene_descriptions: 'jsonb', style_reference: 'character varying',
        status: 'character varying',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_video_prompts_idea', 'idx_video_prompts_status'],
    },

    pipeline_sessions: {
      columns: {
        id: 'integer', user_id: 'integer', source: 'character varying',
        status: 'character varying', current_step: 'character varying',
        error_message: 'text', error_step: 'character varying',
        product_name: 'character varying', product_image_url: 'text',
        artikul: 'character varying', show_artikul: 'boolean',
        idea_id: 'integer', voice_script_id: 'integer', video_prompt_id: 'integer',
        product_image_clean_url: 'text', voice_file_url: 'text',
        voice_duration: 'numeric', raw_video_url: 'text',
        subtitle_file_url: 'text', final_video_url: 'text', thumbnail_url: 'text',
        auto_publish: 'boolean',
        video_type: 'character varying',
        subtitles_enabled: 'boolean',
        music_track_id: 'integer', music_volume: 'numeric',
        execution_id: 'character varying',
        created_at: 'timestamp without time zone',
        updated_at: 'timestamp without time zone',
      },
      indexes: ['idx_sessions_user', 'idx_sessions_status', 'idx_sessions_created'],
      triggers: ['trg_sessions_updated'],
    },

    pipeline_steps: {
      columns: {
        id: 'integer', session_id: 'integer', step_name: 'character varying',
        step_order: 'integer', status: 'character varying',
        input_data: 'jsonb', output_data: 'jsonb',
        ai_model: 'character varying', tokens_used: 'integer',
        duration_ms: 'integer',
        started_at: 'timestamp without time zone',
        completed_at: 'timestamp without time zone',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_steps_session', 'idx_steps_status'],
    },

    workflow_errors: {
      columns: {
        id: 'integer', session_id: 'integer',
        workflow_name: 'character varying', workflow_id: 'character varying',
        execution_id: 'character varying', error_message: 'text',
        error_stack: 'text', node_name: 'character varying',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_errors_session', 'idx_errors_created'],
    },

    ai_costs: {
      columns: {
        id: 'integer', session_id: 'integer', step_name: 'character varying',
        provider: 'character varying', model: 'character varying',
        tokens_prompt: 'integer', tokens_completion: 'integer',
        tokens_total: 'integer', cost_usd: 'numeric',
        duration_ms: 'integer',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_ai_costs_session', 'idx_ai_costs_created'],
    },

    media_files: {
      columns: {
        id: 'integer', session_id: 'integer', user_id: 'integer',
        file_key: 'character varying', file_name: 'character varying',
        file_type: 'character varying', mime_type: 'character varying',
        file_size: 'bigint', source: 'character varying',
        metadata: 'jsonb',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_media_session', 'idx_media_type'],
    },

    music_tracks: {
      columns: {
        id: 'integer', name: 'character varying', file_key: 'character varying',
        file_name: 'character varying', duration_sec: 'integer',
        file_size: 'bigint', category: 'character varying',
        uploaded_by: 'integer', is_active: 'boolean',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_music_tracks_active', 'idx_music_tracks_category'],
    },

    publications: {
      columns: {
        id: 'integer', session_id: 'integer', user_id: 'integer',
        platform: 'character varying', post_id: 'character varying',
        post_url: 'text', caption: 'text', media_keys: 'ARRAY',
        status: 'character varying',
        published_at: 'timestamp without time zone',
        error_message: 'text', metrics: 'jsonb',
        created_at: 'timestamp without time zone',
      },
      indexes: ['idx_publications_session', 'idx_publications_platform', 'idx_publications_status'],
    },

    product_cards: {
      columns: {
        id: 'integer', product_name: 'character varying', image_url: 'text',
        marketplace: 'character varying', artikuls: 'jsonb',
        main_title: 'character varying', subtitle: 'character varying',
        bullet_points: 'jsonb', cta_text: 'character varying',
        seo_title: 'character varying', seo_description: 'text',
        search_keywords: 'jsonb', category_suggestion: 'character varying',
        color_palette: 'jsonb', visual_style_notes: 'text',
        rich_content_blocks: 'jsonb', infographic_prompts: 'jsonb',
        a_plus_content: 'jsonb',
        infographic_url: 'text',
        infographic_variants: 'jsonb',
        concept: 'character varying',
        generation_model: 'character varying',
        style: 'character varying', color_scheme: 'character varying',
        include_price: 'boolean', price: 'character varying',
        include_badge: 'boolean', badge_text: 'character varying',
        status: 'character varying',
        created_by: 'integer', session_id: 'integer',
        created_at: 'timestamp without time zone',
        updated_at: 'timestamp without time zone',
      },
      indexes: ['idx_cards_status', 'idx_cards_created', 'idx_cards_product'],
      triggers: ['trg_cards_updated'],
    },
  },

  // Все настройки app_settings (key → default value)
  settings: {
    // AI
    ai_api_key:          '',
    ai_base_url:         'https://gptunnel.ru/v1',
    ai_model:            'gpt-4o',
    ai_auth_prefix:      '',
    ai_system_prompt:    'Ты — креативный маркетолог.',
    // TTS
    tts_provider:        'gptunnel',
    tts_voice:           'alloy',
    tts_speed:           '1.0',
    tts_gptunnel_voice_id:   '65f4092eddc5862248a18111',
    tts_gptunnel_voice_name: 'ALEX',
    // Video
    video_provider:          'minimax',
    max_video_duration:      '60',
    video_gptunnel_model:    'glabs-veo-3-1',
    // Cards
    card_image_provider:     'gptunnel',
    card_image_model:        'google-imagen-3',
    card_image_ar:           '1:1',
    // Subtitles
    subtitle_font:      'Arial',
    subtitle_size:      '42',
    subtitle_color:     'white',
    subtitle_outline:   '2',
    // Branding
    watermark_url:      '',
    watermark_position: 'top-right',
    watermark_opacity:  '0.7',
    music_default_volume: '0.15',
    // Telegram
    telegram_bot_token:      '',
    telegram_chat_id:        '0',
    telegram_channel_id:     '0',
    telegram_moderator_chat: '0',
    // HeyGen
    heygen_api_key:    '',
    heygen_avatar_id:  '',
    heygen_voice_id:   '',
    // A2E
    a2e_api_token:     '',
    a2e_base_url:      'https://video.a2e.ai',
    a2e_avatar_id:     '',
    a2e_voice_id:      '',
    a2e_voice_country: '',
    a2e_voice_region:  '',
    a2e_speech_rate:   '1.0',
    a2e_resolution:    '1080',
    a2e_background:    '',
    a2e_captions:      'false',
    // VK
    vk_access_token:   '',
    vk_group_id:       '',
    // Schedule
    auto_generate_enabled:  'false',
    auto_generate_cron:     '0 9 * * 1-5',
    auto_generate_count:    '3',
    auto_content_type:      'regular',
    auto_video_enabled:     'false',
    auto_video_type:        'regular',
    auto_video_cron:        '0 10 * * 1-5',
    auto_video_batch:       '2',
    auto_subtitles:         'true',
    auto_music_track_id:    '',
    auto_publish_enabled:   'false',
    auto_publish_cron:      '0 12 * * 1-5',
    auto_publish_batch:     '1',
    default_channels:       '["telegram"]',
  },

  // Функция update_updated_at
  functions: ['update_updated_at'],

  // Триггеры (имя → таблица)
  triggers: {
    trg_users_updated:    'users',
    trg_sessions_updated: 'pipeline_sessions',
    trg_settings_updated: 'app_settings',
    trg_cards_updated:    'product_cards',
  },
};

// ══════════════════════════════════════════════════════════
// SQL миграции для каждого элемента
// ══════════════════════════════════════════════════════════

const COLUMN_DEFAULTS = {
  // pipeline_sessions
  'pipeline_sessions.video_type':        `VARCHAR(30) DEFAULT 'regular'`,
  'pipeline_sessions.subtitles_enabled': `BOOLEAN DEFAULT TRUE`,
  'pipeline_sessions.music_track_id':    `INTEGER`,
  'pipeline_sessions.music_volume':      `DECIMAL(3,2) DEFAULT 0.15`,
  // content_ideas
  'content_ideas.content_type':          `VARCHAR(30) DEFAULT 'regular'`,
  // product_cards (все колонки — для случая если таблица есть, но колонки нет)
  'product_cards.infographic_url':       `TEXT`,
  'product_cards.infographic_variants':  `JSONB DEFAULT '[]'`,
  'product_cards.concept':               `VARCHAR(50) DEFAULT 'studio'`,
  'product_cards.generation_model':      `VARCHAR(50) DEFAULT 'flux-kontext-pro'`,
};

// Настройки — метаданные для INSERT
const SETTINGS_META = {
  ai_api_key:          { type: 'string',  cat: 'ai',       label: 'API ключ',               desc: 'Ключ AI API', secret: true },
  ai_base_url:         { type: 'string',  cat: 'ai',       label: 'Base URL',               desc: 'Базовый URL AI API' },
  ai_model:            { type: 'string',  cat: 'ai',       label: 'Модель',                 desc: 'Модель AI' },
  ai_auth_prefix:      { type: 'string',  cat: 'ai',       label: 'Auth prefix',            desc: 'Префикс авторизации' },
  ai_system_prompt:    { type: 'string',  cat: 'ai',       label: 'Системный промпт',       desc: 'Tone-of-voice' },
  tts_provider:        { type: 'string',  cat: 'tts',      label: 'TTS провайдер',          desc: 'openai / gptunnel / elevenlabs' },
  tts_voice:           { type: 'string',  cat: 'tts',      label: 'Голос по умолч.',        desc: 'ID голоса TTS' },
  tts_speed:           { type: 'string',  cat: 'tts',      label: 'Скорость речи',          desc: '0.5 — 2.0' },
  tts_gptunnel_voice_id:   { type: 'string', cat: 'tts',   label: 'GPTunnel Voice ID',     desc: 'ID голоса GPTunnel' },
  tts_gptunnel_voice_name: { type: 'string', cat: 'tts',   label: 'GPTunnel голос',        desc: 'Имя голоса GPTunnel' },
  video_provider:      { type: 'string',  cat: 'video',    label: 'Видео провайдер',        desc: 'minimax / gptunnel / runway' },
  max_video_duration:  { type: 'number',  cat: 'video',    label: 'Макс. длительность',     desc: 'Максимум секунд видео' },
  video_gptunnel_model:{ type: 'string',  cat: 'video',    label: 'GPTunnel модель видео',  desc: 'glabs-veo-3-1 и др.' },
  card_image_provider: { type: 'string',  cat: 'cards',    label: 'Провайдер изображений',  desc: 'gptunnel / openai' },
  card_image_model:    { type: 'string',  cat: 'cards',    label: 'Модель изображений',     desc: 'google-imagen-3 / flux-dev' },
  card_image_ar:       { type: 'string',  cat: 'cards',    label: 'Соотношение сторон',     desc: '1:1 / 9:16 / 16:9' },
  subtitle_font:       { type: 'string',  cat: 'subtitle', label: 'Шрифт субтитров',       desc: 'Название шрифта' },
  subtitle_size:       { type: 'number',  cat: 'subtitle', label: 'Размер субтитров',       desc: 'px' },
  subtitle_color:      { type: 'string',  cat: 'subtitle', label: 'Цвет субтитров',         desc: 'Цвет текста' },
  subtitle_outline:    { type: 'number',  cat: 'subtitle', label: 'Обводка субтитров',      desc: 'Толщина обводки px' },
  watermark_url:       { type: 'string',  cat: 'branding', label: 'URL водяного знака',     desc: 'URL логотипа' },
  watermark_position:  { type: 'string',  cat: 'branding', label: 'Позиция логотипа',      desc: 'top-left / top-right / bottom-left / bottom-right' },
  watermark_opacity:   { type: 'string',  cat: 'branding', label: 'Прозрачность лого',      desc: '0.0 — 1.0' },
  music_default_volume:{ type: 'string',  cat: 'branding', label: 'Громкость музыки',       desc: '0.0-1.0' },
  telegram_bot_token:  { type: 'string',  cat: 'telegram', label: 'Токен бота',             desc: 'Токен от @BotFather', secret: true },
  telegram_chat_id:    { type: 'string',  cat: 'telegram', label: 'Chat ID уведомл.',       desc: 'ID чата уведомлений' },
  telegram_channel_id: { type: 'string',  cat: 'telegram', label: 'Channel ID',             desc: 'ID канала' },
  telegram_moderator_chat: { type: 'string', cat: 'telegram', label: 'Moderator Chat ID',   desc: 'ID чата модератора' },
  heygen_api_key:      { type: 'string',  cat: 'heygen',   label: 'HeyGen API Key',         desc: 'Ключ HeyGen', secret: true },
  heygen_avatar_id:    { type: 'string',  cat: 'heygen',   label: 'Аватар по умолч.',       desc: 'ID аватара HeyGen' },
  heygen_voice_id:     { type: 'string',  cat: 'heygen',   label: 'Голос по умолч.',        desc: 'ID голоса HeyGen' },
  a2e_api_token:       { type: 'string',  cat: 'a2e',      label: 'A2E API Token',          desc: 'Bearer-токен A2E', secret: true },
  a2e_base_url:        { type: 'string',  cat: 'a2e',      label: 'Base URL',               desc: 'URL A2E API' },
  a2e_avatar_id:       { type: 'string',  cat: 'a2e',      label: 'Аватар по умолч.',       desc: 'ID аватара A2E' },
  a2e_voice_id:        { type: 'string',  cat: 'a2e',      label: 'TTS голос по умолч.',    desc: 'ID голоса A2E' },
  a2e_voice_country:   { type: 'string',  cat: 'a2e',      label: 'Страна голоса',          desc: 'Код страны' },
  a2e_voice_region:    { type: 'string',  cat: 'a2e',      label: 'Регион голоса',          desc: 'Регион TTS' },
  a2e_speech_rate:     { type: 'string',  cat: 'a2e',      label: 'Скорость речи',          desc: '0.5 — 2.0' },
  a2e_resolution:      { type: 'string',  cat: 'a2e',      label: 'Разрешение',             desc: '480 / 720 / 1080' },
  a2e_background:      { type: 'string',  cat: 'a2e',      label: 'Фон видео',              desc: '#RRGGBB или ID' },
  a2e_captions:        { type: 'boolean', cat: 'a2e',      label: 'Субтитры A2E',           desc: 'Встроенные субтитры' },
  vk_access_token:     { type: 'string',  cat: 'vk',       label: 'VK Access Token',        desc: 'Токен VK API', secret: true },
  vk_group_id:         { type: 'string',  cat: 'vk',       label: 'VK Group ID',            desc: 'ID сообщества VK' },
  auto_generate_enabled:  { type: 'boolean', cat: 'schedule', label: 'Автогенерация',       desc: 'Включить автогенерацию идей' },
  auto_generate_cron:     { type: 'string',  cat: 'schedule', label: 'Cron расписание',     desc: 'Cron автогенерации' },
  auto_generate_count:    { type: 'number',  cat: 'schedule', label: 'Кол-во идей',         desc: 'Идей за раз' },
  auto_content_type:      { type: 'string',  cat: 'schedule', label: 'Тип контента',        desc: 'regular / a2e' },
  auto_video_enabled:     { type: 'boolean', cat: 'schedule', label: 'Авто-видео',          desc: 'Авто-создание видео' },
  auto_video_type:        { type: 'string',  cat: 'schedule', label: 'Тип авто-видео',      desc: 'regular / a2e / heygen' },
  auto_video_cron:        { type: 'string',  cat: 'schedule', label: 'Cron видео',          desc: 'Расписание авто-видео' },
  auto_video_batch:       { type: 'number',  cat: 'schedule', label: 'Видео за раз',        desc: 'Видео за запуск' },
  auto_subtitles:         { type: 'boolean', cat: 'schedule', label: 'Субтитры (авто)',     desc: 'Субтитры при автосоздании' },
  auto_music_track_id:    { type: 'string',  cat: 'schedule', label: 'Музыка (авто)',       desc: 'ID трека' },
  auto_publish_enabled:   { type: 'boolean', cat: 'schedule', label: 'Авто-публикация',    desc: 'Авто-публикация видео' },
  auto_publish_cron:      { type: 'string',  cat: 'schedule', label: 'Cron публикации',    desc: 'Расписание публикации' },
  auto_publish_batch:     { type: 'number',  cat: 'schedule', label: 'Публ. за раз',       desc: 'Видео за публикацию' },
  default_channels:       { type: 'json',    cat: 'schedule', label: 'Каналы по умолч.',    desc: 'Каналы для публикации' },
};

// ══════════════════════════════════════════════════════════
// Полная SQL-схема для CREATE TABLE (если таблица отсутствует)
// ══════════════════════════════════════════════════════════

const CREATE_TABLES = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, login VARCHAR(100) UNIQUE, telegram_id BIGINT,
      username VARCHAR(100), first_name VARCHAR(100), last_name VARCHAR(100),
      photo_url TEXT, password_hash VARCHAR(128), password_salt VARCHAR(64),
      role VARCHAR(20) DEFAULT 'business_owner' CHECK (role IN ('tech_admin','business_owner')),
      is_active BOOLEAN DEFAULT TRUE, last_login TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`,
  login_tokens: `
    CREATE TABLE IF NOT EXISTS login_tokens (
      id SERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL,
      token VARCHAR(64) UNIQUE NOT NULL, used BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`,
  app_settings: `
    CREATE TABLE IF NOT EXISTS app_settings (
      id SERIAL PRIMARY KEY, key VARCHAR(100) UNIQUE NOT NULL, value TEXT,
      type VARCHAR(20) DEFAULT 'string' CHECK (type IN ('string','number','boolean','json')),
      category VARCHAR(50) NOT NULL, label VARCHAR(200), description TEXT,
      is_secret BOOLEAN DEFAULT FALSE, updated_by VARCHAR(100),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  content_ideas: `
    CREATE TABLE IF NOT EXISTS content_ideas (
      id SERIAL PRIMARY KEY, category VARCHAR(100), title VARCHAR(500) NOT NULL,
      concept TEXT, visual_description TEXT, target_audience VARCHAR(500),
      tone VARCHAR(100), content_type VARCHAR(30) DEFAULT 'regular',
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','used')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    )`,
  voice_scripts: `
    CREATE TABLE IF NOT EXISTS voice_scripts (
      id SERIAL PRIMARY KEY, idea_id INTEGER REFERENCES content_ideas(id) ON DELETE CASCADE,
      script_text TEXT NOT NULL, word_count INTEGER DEFAULT 0,
      duration_hint INTEGER DEFAULT 0, timing_marks JSONB DEFAULT '[]',
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','used')),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  video_prompts: `
    CREATE TABLE IF NOT EXISTS video_prompts (
      id SERIAL PRIMARY KEY, idea_id INTEGER REFERENCES content_ideas(id) ON DELETE CASCADE,
      prompt_text TEXT NOT NULL, scene_descriptions JSONB DEFAULT '[]',
      style_reference VARCHAR(200),
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','used')),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  pipeline_sessions: `
    CREATE TABLE IF NOT EXISTS pipeline_sessions (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source VARCHAR(20) DEFAULT 'web',
      status VARCHAR(50) DEFAULT 'created' CHECK (status IN ('created','processing','ready_for_review','approved','publishing','published','rejected','error','cancelled')),
      current_step VARCHAR(50) DEFAULT 'created', error_message TEXT, error_step VARCHAR(50),
      product_name VARCHAR(500), product_image_url TEXT, artikul VARCHAR(100), show_artikul BOOLEAN DEFAULT FALSE,
      idea_id INTEGER REFERENCES content_ideas(id) ON DELETE SET NULL,
      voice_script_id INTEGER REFERENCES voice_scripts(id) ON DELETE SET NULL,
      video_prompt_id INTEGER REFERENCES video_prompts(id) ON DELETE SET NULL,
      product_image_clean_url TEXT, voice_file_url TEXT, voice_duration DECIMAL(10,2),
      raw_video_url TEXT, subtitle_file_url TEXT, final_video_url TEXT, thumbnail_url TEXT,
      auto_publish BOOLEAN DEFAULT FALSE,
      video_type VARCHAR(30) DEFAULT 'regular' CHECK (video_type IN ('regular','gptunnel','heygen','a2e')),
      subtitles_enabled BOOLEAN DEFAULT TRUE, music_track_id INTEGER,
      music_volume DECIMAL(3,2) DEFAULT 0.15, execution_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`,
  pipeline_steps: `
    CREATE TABLE IF NOT EXISTS pipeline_steps (
      id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES pipeline_sessions(id) ON DELETE CASCADE,
      step_name VARCHAR(50) NOT NULL, step_order INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped')),
      input_data JSONB DEFAULT '{}', output_data JSONB DEFAULT '{}',
      ai_model VARCHAR(100), tokens_used INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      started_at TIMESTAMP, completed_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW()
    )`,
  workflow_errors: `
    CREATE TABLE IF NOT EXISTS workflow_errors (
      id SERIAL PRIMARY KEY, session_id INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
      workflow_name VARCHAR(100), workflow_id VARCHAR(50), execution_id VARCHAR(50),
      error_message TEXT, error_stack TEXT, node_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  ai_costs: `
    CREATE TABLE IF NOT EXISTS ai_costs (
      id SERIAL PRIMARY KEY, session_id INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
      step_name VARCHAR(50), provider VARCHAR(50), model VARCHAR(100),
      tokens_prompt INTEGER DEFAULT 0, tokens_completion INTEGER DEFAULT 0,
      tokens_total INTEGER DEFAULT 0, cost_usd DECIMAL(10,6) DEFAULT 0,
      duration_ms INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    )`,
  media_files: `
    CREATE TABLE IF NOT EXISTS media_files (
      id SERIAL PRIMARY KEY, session_id INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      file_key VARCHAR(500) NOT NULL, file_name VARCHAR(255),
      file_type VARCHAR(50) CHECK (file_type IN ('video','image','audio','document')),
      mime_type VARCHAR(100), file_size BIGINT, source VARCHAR(50),
      metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW()
    )`,
  music_tracks: `
    CREATE TABLE IF NOT EXISTS music_tracks (
      id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, file_key VARCHAR(500) NOT NULL,
      file_name VARCHAR(255), duration_sec INTEGER DEFAULT 0, file_size BIGINT DEFAULT 0,
      category VARCHAR(100) DEFAULT 'общий',
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW()
    )`,
  publications: `
    CREATE TABLE IF NOT EXISTS publications (
      id SERIAL PRIMARY KEY, session_id INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      platform VARCHAR(30) NOT NULL CHECK (platform IN ('telegram','vk','youtube_shorts')),
      post_id VARCHAR(100), post_url TEXT, caption TEXT, media_keys TEXT[],
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','failed')),
      published_at TIMESTAMP, error_message TEXT, metrics JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  product_cards: `
    CREATE TABLE IF NOT EXISTS product_cards (
      id SERIAL PRIMARY KEY, product_name VARCHAR(500) NOT NULL, image_url TEXT,
      marketplace VARCHAR(50) DEFAULT 'WB', artikuls JSONB DEFAULT '[]',
      main_title VARCHAR(500), subtitle VARCHAR(500), bullet_points JSONB DEFAULT '[]',
      cta_text VARCHAR(200), seo_title VARCHAR(500), seo_description TEXT,
      search_keywords JSONB DEFAULT '[]', category_suggestion VARCHAR(200),
      color_palette JSONB DEFAULT '[]', visual_style_notes TEXT,
      rich_content_blocks JSONB DEFAULT '[]', infographic_prompts JSONB DEFAULT '[]',
      a_plus_content JSONB DEFAULT '{}',
      infographic_url TEXT, infographic_variants JSONB DEFAULT '[]',
      concept VARCHAR(50) DEFAULT 'studio', generation_model VARCHAR(50) DEFAULT 'flux-kontext-pro',
      style VARCHAR(50) DEFAULT 'modern', color_scheme VARCHAR(50) DEFAULT 'auto',
      include_price BOOLEAN DEFAULT FALSE, price VARCHAR(50),
      include_badge BOOLEAN DEFAULT FALSE, badge_text VARCHAR(100),
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','generated','approved','rejected','exported')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      session_id INTEGER REFERENCES pipeline_sessions(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
    )`,
};

// Порядок создания (зависимости)
const TABLE_ORDER = [
  'users', 'login_tokens', 'app_settings', 'content_ideas',
  'voice_scripts', 'video_prompts', 'pipeline_sessions',
  'pipeline_steps', 'workflow_errors', 'ai_costs',
  'media_files', 'music_tracks', 'publications', 'product_cards',
];

// Индексы с SQL
const INDEX_SQL = {
  idx_users_telegram_unique: `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_unique ON users(telegram_id) WHERE telegram_id IS NOT NULL`,
  idx_users_role:            `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
  idx_users_login:           `CREATE INDEX IF NOT EXISTS idx_users_login ON users(login)`,
  idx_login_tokens_token:    `CREATE INDEX IF NOT EXISTS idx_login_tokens_token ON login_tokens(token)`,
  idx_login_tokens_expires:  `CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at)`,
  idx_app_settings_category: `CREATE INDEX IF NOT EXISTS idx_app_settings_category ON app_settings(category)`,
  idx_app_settings_key:      `CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(key)`,
  idx_ideas_status:          `CREATE INDEX IF NOT EXISTS idx_ideas_status ON content_ideas(status)`,
  idx_ideas_created:         `CREATE INDEX IF NOT EXISTS idx_ideas_created ON content_ideas(created_at DESC)`,
  idx_ideas_content_type:    `CREATE INDEX IF NOT EXISTS idx_ideas_content_type ON content_ideas(content_type)`,
  idx_voice_scripts_idea:    `CREATE INDEX IF NOT EXISTS idx_voice_scripts_idea ON voice_scripts(idea_id)`,
  idx_voice_scripts_status:  `CREATE INDEX IF NOT EXISTS idx_voice_scripts_status ON voice_scripts(status)`,
  idx_video_prompts_idea:    `CREATE INDEX IF NOT EXISTS idx_video_prompts_idea ON video_prompts(idea_id)`,
  idx_video_prompts_status:  `CREATE INDEX IF NOT EXISTS idx_video_prompts_status ON video_prompts(status)`,
  idx_sessions_user:         `CREATE INDEX IF NOT EXISTS idx_sessions_user ON pipeline_sessions(user_id)`,
  idx_sessions_status:       `CREATE INDEX IF NOT EXISTS idx_sessions_status ON pipeline_sessions(status)`,
  idx_sessions_created:      `CREATE INDEX IF NOT EXISTS idx_sessions_created ON pipeline_sessions(created_at DESC)`,
  idx_steps_session:         `CREATE INDEX IF NOT EXISTS idx_steps_session ON pipeline_steps(session_id)`,
  idx_steps_status:          `CREATE INDEX IF NOT EXISTS idx_steps_status ON pipeline_steps(status)`,
  idx_errors_session:        `CREATE INDEX IF NOT EXISTS idx_errors_session ON workflow_errors(session_id)`,
  idx_errors_created:        `CREATE INDEX IF NOT EXISTS idx_errors_created ON workflow_errors(created_at DESC)`,
  idx_ai_costs_session:      `CREATE INDEX IF NOT EXISTS idx_ai_costs_session ON ai_costs(session_id)`,
  idx_ai_costs_created:      `CREATE INDEX IF NOT EXISTS idx_ai_costs_created ON ai_costs(created_at DESC)`,
  idx_media_session:         `CREATE INDEX IF NOT EXISTS idx_media_session ON media_files(session_id)`,
  idx_media_type:            `CREATE INDEX IF NOT EXISTS idx_media_type ON media_files(file_type)`,
  idx_music_tracks_active:   `CREATE INDEX IF NOT EXISTS idx_music_tracks_active ON music_tracks(is_active)`,
  idx_music_tracks_category: `CREATE INDEX IF NOT EXISTS idx_music_tracks_category ON music_tracks(category)`,
  idx_publications_session:  `CREATE INDEX IF NOT EXISTS idx_publications_session ON publications(session_id)`,
  idx_publications_platform: `CREATE INDEX IF NOT EXISTS idx_publications_platform ON publications(platform)`,
  idx_publications_status:   `CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status)`,
  idx_cards_status:          `CREATE INDEX IF NOT EXISTS idx_cards_status ON product_cards(status)`,
  idx_cards_created:         `CREATE INDEX IF NOT EXISTS idx_cards_created ON product_cards(created_at DESC)`,
  idx_cards_product:         `CREATE INDEX IF NOT EXISTS idx_cards_product ON product_cards(product_name)`,
};

// ══════════════════════════════════════════════════════════
// Основная логика
// ══════════════════════════════════════════════════════════

(async () => {
  const client = new Client(DB);
  const issues = [];     // Проблемы
  const migrations = []; // SQL для миграций
  let migrated = 0;

  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.cyan}  🏭 Контент Завод — Проверка БД${doMigrate ? ' + Миграция' : ''}${C.reset}`);
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════${C.reset}\n`);

  // ── Подключение ──
  try {
    await client.connect();
    console.log(`${OK} Подключение к ${DB.host}:${DB.port}/${DB.database} (user: ${DB.user})\n`);
  } catch (err) {
    console.log(`${FAIL} Не удалось подключиться: ${err.message}`);
    console.log(`\n   Подсказка: DB_HOST=localhost DB_PASSWORD=xxx node scripts/check-db.js`);
    process.exit(1);
  }

  // ── Версия PostgreSQL ──
  const pgVer = await client.query('SHOW server_version');
  console.log(`${C.dim}   PostgreSQL: ${pgVer.rows[0].server_version}${C.reset}\n`);

  // ── 1. Существующие таблицы ──
  console.log(`${C.bold}── 1. Таблицы ──${C.reset}`);
  const tablesRes = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  const existingTables = new Set(tablesRes.rows.map(r => r.tablename));

  for (const tbl of TABLE_ORDER) {
    if (existingTables.has(tbl)) {
      const countRes = await client.query(`SELECT COUNT(*) as cnt FROM "${tbl}"`);
      console.log(`   ${OK} ${tbl} (${countRes.rows[0].cnt} строк)`);
    } else {
      console.log(`   ${FAIL} ${tbl} — ${C.red}НЕТ ТАБЛИЦЫ${C.reset}`);
      issues.push(`Таблица ${tbl} отсутствует`);
      migrations.push({ label: `CREATE TABLE ${tbl}`, sql: CREATE_TABLES[tbl] });
    }
  }

  // Другие таблицы (n8n и т.д.)
  const ourTables = new Set(TABLE_ORDER);
  const otherTables = [...existingTables].filter(t => !ourTables.has(t)).sort();
  if (otherTables.length) {
    console.log(`\n   ${C.dim}Другие таблицы (n8n и пр.): ${otherTables.join(', ')}${C.reset}`);
  }
  console.log();

  // ── 2. Колонки ──
  console.log(`${C.bold}── 2. Колонки ──${C.reset}`);
  const colsRes = await client.query(`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  // Сгруппировать по таблице
  const existingCols = {};
  for (const row of colsRes.rows) {
    if (!existingCols[row.table_name]) existingCols[row.table_name] = {};
    existingCols[row.table_name][row.column_name] = row.data_type === 'ARRAY' ? 'ARRAY' : row.data_type;
  }

  let colIssues = 0;
  for (const tbl of TABLE_ORDER) {
    if (!existingTables.has(tbl)) continue; // Будет создана целиком
    const expected = SCHEMA.tables[tbl].columns;
    const actual = existingCols[tbl] || {};
    const missing = [];
    for (const [col, expectedType] of Object.entries(expected)) {
      if (!actual[col]) {
        missing.push(col);
        const key = `${tbl}.${col}`;
        const def = COLUMN_DEFAULTS[key];
        if (def) {
          migrations.push({
            label: `ALTER TABLE ${tbl} ADD ${col}`,
            sql: `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col} ${def}`
          });
        } else {
          // Общие типы
          let typeSql;
          if (expectedType === 'integer') typeSql = 'INTEGER';
          else if (expectedType === 'bigint') typeSql = 'BIGINT';
          else if (expectedType === 'boolean') typeSql = 'BOOLEAN';
          else if (expectedType === 'text') typeSql = 'TEXT';
          else if (expectedType === 'jsonb') typeSql = "JSONB DEFAULT '{}'";
          else if (expectedType === 'numeric') typeSql = 'NUMERIC';
          else if (expectedType === 'character varying') typeSql = 'VARCHAR(500)';
          else if (expectedType === 'timestamp without time zone') typeSql = 'TIMESTAMP';
          else if (expectedType === 'ARRAY') typeSql = 'TEXT[]';
          else typeSql = 'TEXT';
          migrations.push({
            label: `ALTER TABLE ${tbl} ADD ${col}`,
            sql: `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col} ${typeSql}`
          });
        }
      }
    }
    if (missing.length) {
      console.log(`   ${FAIL} ${tbl}: не хватает ${C.red}${missing.join(', ')}${C.reset}`);
      colIssues += missing.length;
      issues.push(...missing.map(c => `Колонка ${tbl}.${c} отсутствует`));
    }
  }
  if (!colIssues) {
    console.log(`   ${OK} Все колонки на месте`);
  }
  console.log();

  // ── 3. Индексы ──
  console.log(`${C.bold}── 3. Индексы ──${C.reset}`);
  const idxRes = await client.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `);
  const existingIdx = new Set(idxRes.rows.map(r => r.indexname));

  let idxMissing = 0;
  for (const [name, sql] of Object.entries(INDEX_SQL)) {
    if (!existingIdx.has(name)) {
      // Проверить что таблица существует (или будет создана)
      console.log(`   ${FAIL} ${name} — ${C.red}отсутствует${C.reset}`);
      issues.push(`Индекс ${name} отсутствует`);
      migrations.push({ label: `CREATE INDEX ${name}`, sql });
      idxMissing++;
    }
  }
  if (!idxMissing) {
    console.log(`   ${OK} Все ${Object.keys(INDEX_SQL).length} индексов на месте`);
  }
  console.log();

  // ── 4. Функция update_updated_at ──
  console.log(`${C.bold}── 4. Функции ──${C.reset}`);
  const funcRes = await client.query(`
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
  `);
  const existingFuncs = new Set(funcRes.rows.map(r => r.routine_name));

  if (existingFuncs.has('update_updated_at')) {
    console.log(`   ${OK} update_updated_at()`);
  } else {
    console.log(`   ${FAIL} update_updated_at() — ${C.red}отсутствует${C.reset}`);
    issues.push('Функция update_updated_at отсутствует');
    migrations.push({
      label: 'CREATE FUNCTION update_updated_at',
      sql: `CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`
    });
  }
  console.log();

  // ── 5. Триггеры ──
  console.log(`${C.bold}── 5. Триггеры ──${C.reset}`);
  const trigRes = await client.query(`
    SELECT tgname, relname FROM pg_trigger
    JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
    WHERE NOT tgisinternal
  `);
  const existingTrigs = new Set(trigRes.rows.map(r => r.tgname));

  for (const [trigName, tableName] of Object.entries(SCHEMA.triggers)) {
    if (existingTrigs.has(trigName)) {
      console.log(`   ${OK} ${trigName} → ${tableName}`);
    } else {
      console.log(`   ${FAIL} ${trigName} → ${tableName} — ${C.red}отсутствует${C.reset}`);
      issues.push(`Триггер ${trigName} отсутствует`);
      migrations.push({
        label: `CREATE TRIGGER ${trigName}`,
        sql: `DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${trigName}') THEN
            CREATE TRIGGER ${trigName} BEFORE UPDATE ON ${tableName} FOR EACH ROW EXECUTE FUNCTION update_updated_at();
          END IF;
        END $$`
      });
    }
  }
  console.log();

  // ── 6. Настройки app_settings ──
  console.log(`${C.bold}── 6. Настройки (app_settings) ──${C.reset}`);
  if (existingTables.has('app_settings')) {
    const settingsRes = await client.query(`SELECT key FROM app_settings`);
    const existingSettings = new Set(settingsRes.rows.map(r => r.key));

    let settingsMissing = 0;
    const missingKeys = [];
    for (const key of Object.keys(SCHEMA.settings)) {
      if (!existingSettings.has(key)) {
        missingKeys.push(key);
        settingsMissing++;
        const meta = SETTINGS_META[key] || { type: 'string', cat: 'other', label: key, desc: '' };
        const defVal = SCHEMA.settings[key];
        migrations.push({
          label: `INSERT setting ${key}`,
          sql: `INSERT INTO app_settings (key, value, type, category, label, description, is_secret)
                VALUES ('${key}', '${defVal.replace(/'/g, "''")}', '${meta.type}', '${meta.cat}', '${(meta.label||'').replace(/'/g, "''")}', '${(meta.desc||'').replace(/'/g, "''")}', ${meta.secret ? 'TRUE' : 'FALSE'})
                ON CONFLICT (key) DO NOTHING`
        });
      }
    }

    if (settingsMissing) {
      console.log(`   ${FAIL} Не хватает ${C.red}${settingsMissing}${C.reset} настроек: ${missingKeys.join(', ')}`);
      issues.push(...missingKeys.map(k => `Настройка ${k} отсутствует`));
    } else {
      console.log(`   ${OK} Все ${Object.keys(SCHEMA.settings).length} настроек на месте`);
    }

    // Лишние настройки
    const extraSettings = [...existingSettings].filter(k => !SCHEMA.settings.hasOwnProperty(k));
    if (extraSettings.length) {
      console.log(`   ${C.dim}   Доп. настройки (вне схемы): ${extraSettings.join(', ')}${C.reset}`);
    }
  } else {
    console.log(`   ${WARN} Таблица app_settings отсутствует — будет создана`);
  }
  console.log();

  // ── 7. Специальные миграции ──
  console.log(`${C.bold}── 7. Спец. миграции ──${C.reset}`);

  // 7a. app_settings.updated_by тип (должен быть VARCHAR, не INTEGER)
  if (existingTables.has('app_settings') && existingCols['app_settings']) {
    const updByType = existingCols['app_settings']['updated_by'];
    if (updByType === 'integer') {
      console.log(`   ${FAIL} app_settings.updated_by = ${C.red}integer${C.reset} (нужен varchar)`);
      issues.push('app_settings.updated_by тип integer вместо varchar');
      migrations.push({
        label: 'ALTER app_settings.updated_by → VARCHAR',
        sql: `DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE constraint_name = 'app_settings_updated_by_fkey' AND table_name = 'app_settings')
          THEN ALTER TABLE app_settings DROP CONSTRAINT app_settings_updated_by_fkey; END IF;
          ALTER TABLE app_settings ALTER COLUMN updated_by TYPE VARCHAR(100) USING updated_by::TEXT;
        END $$`
      });
    } else {
      console.log(`   ${OK} app_settings.updated_by = varchar`);
    }
  }

  // 7b. pipeline_sessions.user_id nullable
  if (existingTables.has('pipeline_sessions')) {
    const nullableRes = await client.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'pipeline_sessions' AND column_name = 'user_id'
    `);
    if (nullableRes.rows.length && nullableRes.rows[0].is_nullable === 'NO') {
      console.log(`   ${FAIL} pipeline_sessions.user_id = ${C.red}NOT NULL${C.reset} (нужен NULL)`);
      issues.push('pipeline_sessions.user_id NOT NULL');
      migrations.push({
        label: 'ALTER pipeline_sessions.user_id DROP NOT NULL',
        sql: `ALTER TABLE pipeline_sessions ALTER COLUMN user_id DROP NOT NULL`
      });
    } else {
      console.log(`   ${OK} pipeline_sessions.user_id nullable`);
    }
  }

  // 7c. pipeline_sessions.status CHECK constraint
  if (existingTables.has('pipeline_sessions')) {
    const conRes = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'pipeline_sessions'::regclass AND contype = 'c' AND conname LIKE '%status%'
    `);
    if (conRes.rows.length) {
      const def = conRes.rows[0].def;
      if (def.includes('pipeline_running') || def.includes('collecting_input') || def.includes('completed')) {
        console.log(`   ${FAIL} pipeline_sessions.status CHECK = ${C.red}старые значения${C.reset}`);
        issues.push('pipeline_sessions.status CHECK устарел');
        migrations.push({
          label: 'UPDATE pipeline_sessions status CHECK',
          sql: `DO $$ BEGIN
            ALTER TABLE pipeline_sessions DROP CONSTRAINT IF EXISTS pipeline_sessions_status_check;
            UPDATE pipeline_sessions SET status = 'processing' WHERE status = 'pipeline_running';
            UPDATE pipeline_sessions SET status = 'created' WHERE status = 'collecting_input';
            UPDATE pipeline_sessions SET status = 'published' WHERE status = 'completed';
            ALTER TABLE pipeline_sessions ADD CONSTRAINT pipeline_sessions_status_check
              CHECK (status IN ('created','processing','ready_for_review','approved','publishing','published','rejected','error','cancelled'));
          END $$`
        });
      } else {
        console.log(`   ${OK} pipeline_sessions.status CHECK актуален`);
      }
    } else {
      console.log(`   ${WARN} pipeline_sessions.status CHECK не найден`);
    }
  }

  console.log();

  // ══════════════════════════════════════════════════════════
  // Итоги
  // ══════════════════════════════════════════════════════════
  console.log(`${C.bold}${C.cyan}═══════════════════════════════════════════════════${C.reset}`);

  if (!issues.length) {
    console.log(`\n${OK} ${C.bold}${C.green}База данных в актуальном состоянии. Миграция не требуется.${C.reset}\n`);
    await client.end();
    return;
  }

  console.log(`\n${WARN} ${C.bold}Найдено ${C.yellow}${issues.length}${C.reset}${C.bold} проблем, ${C.cyan}${migrations.length}${C.reset}${C.bold} миграций к применению:${C.reset}\n`);

  for (let i = 0; i < migrations.length; i++) {
    console.log(`   ${C.dim}${i + 1}.${C.reset} ${migrations[i].label}`);
  }
  console.log();

  // ── Применение миграций ──
  if (!doMigrate) {
    console.log(`${C.yellow}   Для применения миграций запустите с флагом --migrate${C.reset}`);
    console.log(`${C.dim}   node scripts/check-db.js --migrate${C.reset}\n`);
    await client.end();
    return;
  }

  console.log(`${C.bold}${C.magenta}── Применение миграций ──${C.reset}\n`);

  for (const mig of migrations) {
    try {
      await client.query(mig.sql);
      console.log(`   ${FIX} ${mig.label} — ${C.green}OK${C.reset}`);
      migrated++;
    } catch (err) {
      console.log(`   ${FAIL} ${mig.label} — ${C.red}${err.message}${C.reset}`);
    }
  }

  console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════════════════${C.reset}`);
  console.log(`\n${OK} ${C.bold}Применено ${C.green}${migrated}/${migrations.length}${C.reset}${C.bold} миграций.${C.reset}\n`);

  if (migrated === migrations.length) {
    console.log(`${C.green}   Рекомендуется перезапустить dashboard:${C.reset}`);
    console.log(`${C.dim}   docker compose restart dashboard${C.reset}\n`);
  }

  await client.end();
})().catch(err => {
  console.error(`\n${FAIL} Критическая ошибка: ${err.message}\n`);
  process.exit(1);
});
