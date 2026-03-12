// ─── Schedule Routes ───
// GET  /api/schedule           — Получить настройки расписания
// PUT  /api/schedule           — Обновить настройки расписания
// POST /api/schedule/run-now   — Запустить генерацию вручную

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Получить настройки расписания ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({
        ok: true,
        data: {
          auto_generate_enabled: false,
          auto_generate_cron: '0 9 * * 1-5',
          auto_generate_count: 3,
          default_channels: ['telegram']
        }
      });
    }

    const result = await query(
      "SELECT key, value, type FROM app_settings WHERE category = 'schedule'"
    );

    const settings = {};
    for (const row of result.rows) {
      if (row.type === 'boolean') {
        settings[row.key] = row.value === 'true';
      } else if (row.type === 'number') {
        settings[row.key] = parseInt(row.value) || 0;
      } else if (row.type === 'json') {
        try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
      } else {
        settings[row.key] = row.value;
      }
    }

    res.json({ ok: true, data: settings });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить настройки расписания ───
router.put('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const {
      auto_generate_enabled, auto_generate_cron, auto_generate_count, auto_content_type,
      auto_video_enabled, auto_video_cron, auto_video_type, auto_video_batch,
      auto_subtitles, auto_music_track_id,
      auto_publish_enabled, auto_publish_cron, auto_publish_batch,
      default_channels
    } = req.body;

    const userId = req.user?.id || null;

    // Все поля расписания — обновляем по ключу
    const fieldMap = {
      auto_generate_enabled, auto_generate_cron, auto_generate_count, auto_content_type,
      auto_video_enabled, auto_video_cron, auto_video_type, auto_video_batch,
      auto_subtitles, auto_music_track_id,
      auto_publish_enabled, auto_publish_cron, auto_publish_batch
    };

    const updates = [];
    for (const [key, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        updates.push(query(
          "UPDATE app_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3",
          [String(value), userId, key]
        ));
      }
    }

    if (default_channels !== undefined) {
      updates.push(query(
        "UPDATE app_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = 'default_channels'",
        [JSON.stringify(default_channels), userId]
      ));
    }

    await Promise.all(updates);

    // Вернуть обновлённые настройки
    const result = await query(
      "SELECT key, value, type FROM app_settings WHERE category = 'schedule'"
    );
    const settings = {};
    for (const row of result.rows) {
      if (row.type === 'boolean') settings[row.key] = row.value === 'true';
      else if (row.type === 'number') settings[row.key] = parseInt(row.value) || 0;
      else if (row.type === 'json') {
        try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
      } else settings[row.key] = row.value;
    }

    res.json({ ok: true, data: settings });
  } catch (err) {
    next(err);
  }
});

// ─── Запустить генерацию вручную ───
router.post('/run-now', async (req, res, next) => {
  try {
    const { count, product_name, niche, extra_instructions, content_type } = req.body;

    let generateCount = count;
    if (!generateCount && isConnected()) {
      const result = await query("SELECT value FROM app_settings WHERE key = 'auto_generate_count'");
      generateCount = result.rows.length > 0 ? parseInt(result.rows[0].value) : 3;
    }

    // Получаем content_type из запроса или из настроек
    let contentType = content_type;
    if (!contentType && isConnected()) {
      const ctResult = await query("SELECT value FROM app_settings WHERE key = 'auto_content_type'");
      contentType = ctResult.rows.length > 0 ? ctResult.rows[0].value : 'a2e_product';
    }

    const n8nResponse = await axios.post(`${N8N_URL}/webhook/content-brain`, {
      count: generateCount || 3,
      product_name: product_name || '',
      niche: niche || '',
      extra_instructions: extra_instructions || '',
      content_type: contentType || 'a2e_product'
    }, { timeout: 120000 });

    res.json({ ok: true, data: n8nResponse.data });
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({
        ok: false,
        error: `N8N error: ${err.response.data?.message || err.message}`
      });
    }
    next(err);
  }
});

module.exports = router;
