// ─── Videos Routes ───
// GET    /api/videos              — Список видео (pipeline_sessions)
// GET    /api/videos/:id          — Детали видео-сессии
// POST   /api/videos              — Создать видео (запустить пайплайн)
// PUT    /api/videos/:id/approve  — Одобрить видео
// PUT    /api/videos/:id/reject   — Отклонить видео
// POST   /api/videos/:id/publish  — Опубликовать видео
// DELETE /api/videos/:id          — Удалить/отменить сессию

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');
const { emitToSession } = require('../socket');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Список видео ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], total: 0 });

    const {
      status,
      search,
      limit = '50',
      offset = '0',
      sort = 'created_at',
      order = 'DESC'
    } = req.query;

    const allowedSort = ['id', 'created_at', 'updated_at', 'product_name', 'status'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort = allowedSort.includes(sort) ? sort : 'created_at';
    const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`ps.status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(ps.product_name ILIKE $${idx} OR ci.title ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM pipeline_sessions ps
       LEFT JOIN content_ideas ci ON ci.id = ps.idea_id
       ${where}`,
      params
    );

    const dataResult = await query(
      `SELECT ps.*,
              ci.title as idea_title, ci.category,
              vs.script_text,
              u.login as creator_login
       FROM pipeline_sessions ps
       LEFT JOIN content_ideas ci ON ci.id = ps.idea_id
       LEFT JOIN voice_scripts vs ON vs.id = ps.voice_script_id
       LEFT JOIN users u ON u.id = ps.user_id
       ${where}
       ORDER BY ps.${safeSort} ${safeOrder}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, safeLimit, safeOffset]
    );

    res.json({
      ok: true,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total)
    });
  } catch (err) {
    next(err);
  }
});

// ─── Детали видео ───
router.get('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;

    const sessionResult = await query(
      `SELECT ps.*,
              ci.title as idea_title, ci.concept, ci.visual_description, ci.category,
              vs.script_text, vs.timing_marks, vs.word_count,
              vp.prompt_text, vp.scene_descriptions, vp.style_reference,
              u.login as creator_login
       FROM pipeline_sessions ps
       LEFT JOIN content_ideas ci ON ci.id = ps.idea_id
       LEFT JOIN voice_scripts vs ON vs.id = ps.voice_script_id
       LEFT JOIN video_prompts vp ON vp.id = ps.video_prompt_id
       LEFT JOIN users u ON u.id = ps.user_id
       WHERE ps.id = $1`,
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена' });
    }

    // Шаги пайплайна
    const stepsResult = await query(
      'SELECT * FROM pipeline_steps WHERE session_id = $1 ORDER BY step_order ASC',
      [id]
    );

    // Публикации
    const pubResult = await query(
      'SELECT * FROM publications WHERE session_id = $1 ORDER BY created_at DESC',
      [id]
    );

    res.json({
      ok: true,
      data: {
        ...sessionResult.rows[0],
        steps: stepsResult.rows,
        publications: pubResult.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Создать видео (запустить пайплайн) ───
router.post('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const {
      idea_id,
      voice_script_id,
      video_prompt_id,
      product_name,
      product_image_url,
      artikul,
      show_artikul = false,
      auto_publish = false,
      video_type = 'regular',
      heygen_avatar_id,
      heygen_voice_id,
      heygen_background,
      heygen_ratio = '16:9'
    } = req.body;

    if (!idea_id) {
      return res.status(400).json({ ok: false, error: 'idea_id обязателен' });
    }

    // Загрузить настройки из БД
    const settingsResult = await query(
      "SELECT key, value FROM app_settings WHERE category IN ('tts', 'video', 'subtitle', 'branding')"
    );
    const settings = {};
    for (const row of settingsResult.rows) {
      settings[row.key] = row.value;
    }

    // Валидация video_type
    const validVideoTypes = ['regular', 'heygen'];
    const safeVideoType = validVideoTypes.includes(video_type) ? video_type : 'regular';

    // Создать сессию
    const sessionResult = await query(
      `INSERT INTO pipeline_sessions
        (user_id, source, status, current_step, product_name, product_image_url,
         artikul, show_artikul, idea_id, voice_script_id, video_prompt_id, auto_publish, video_type)
       VALUES ($1, 'web', 'created', 'created', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user?.id || null,
        product_name || '',
        product_image_url || '',
        artikul || '',
        show_artikul,
        idea_id,
        voice_script_id || null,
        video_prompt_id || null,
        auto_publish,
        safeVideoType
      ]
    );

    const session = sessionResult.rows[0];

    // Пометить контент как used
    await query("UPDATE content_ideas SET status = 'used' WHERE id = $1", [idea_id]);
    if (voice_script_id) await query("UPDATE voice_scripts SET status = 'used' WHERE id = $1", [voice_script_id]);
    if (video_prompt_id) await query("UPDATE video_prompts SET status = 'used' WHERE id = $1", [video_prompt_id]);

    // Вызвать N8N video-factory (regular или heygen)
    const webhookUrl = safeVideoType === 'heygen'
      ? `${N8N_URL}/webhook/video-factory-heygen`
      : `${N8N_URL}/webhook/video-factory`;

    const webhookPayload = {
      session_id: session.id,
      idea_id,
      voice_script_id,
      video_prompt_id,
      product_image_url: product_image_url || '',
      artikul: artikul || '',
      show_artikul,
      video_type: safeVideoType
    };

    if (safeVideoType === 'heygen') {
      // HeyGen-специфичные параметры
      webhookPayload.heygen_avatar_id = heygen_avatar_id || '';
      webhookPayload.heygen_voice_id = heygen_voice_id || '';
      webhookPayload.heygen_background = heygen_background || '';
      webhookPayload.heygen_ratio = heygen_ratio || '16:9';
    } else {
      // Regular video параметры
      webhookPayload.tts_provider = settings.tts_provider || 'openai';
      webhookPayload.tts_voice = settings.tts_voice || 'alloy';
      webhookPayload.tts_speed = parseFloat(settings.tts_speed) || 1.0;
      webhookPayload.video_provider = settings.video_provider || 'minimax';
      webhookPayload.subtitle_font = settings.subtitle_font || 'Arial';
      webhookPayload.subtitle_size = parseInt(settings.subtitle_size) || 42;
      webhookPayload.subtitle_color = settings.subtitle_color || 'white';
      webhookPayload.subtitle_outline = parseInt(settings.subtitle_outline) || 2;
      webhookPayload.watermark_url = settings.watermark_url || '';
      webhookPayload.watermark_position = settings.watermark_position || 'top-right';
      webhookPayload.watermark_opacity = parseFloat(settings.watermark_opacity) || 0.7;
    }

    try {
      await axios.post(webhookUrl, webhookPayload, { timeout: 15000 });
    } catch (n8nErr) {
      // N8N может не ответить сразу — это нормально
      console.error('N8N trigger error (non-fatal):', n8nErr.message);
    }

    // WebSocket уведомление
    emitToSession(session.id, 'session:created', { session });

    res.status(201).json({ ok: true, data: session });
  } catch (err) {
    next(err);
  }
});

// ─── Одобрить видео ───
router.put('/:id/approve', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const result = await query(
      `UPDATE pipeline_sessions
       SET status = 'approved', current_step = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'ready_for_review'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена или не на ревью' });
    }

    emitToSession(id, 'session:approved', { session: result.rows[0] });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Отклонить видео ───
router.put('/:id/reject', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { reason } = req.body;

    const result = await query(
      `UPDATE pipeline_sessions
       SET status = 'rejected', error_message = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'ready_for_review'
       RETURNING *`,
      [id, reason || 'Отклонено пользователем']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена или не на ревью' });
    }

    emitToSession(id, 'session:rejected', { session: result.rows[0] });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Опубликовать видео ───
router.post('/:id/publish', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { channels = ['telegram'], caption, generate_caption = true } = req.body;

    // Проверить статус
    const sessionResult = await query(
      'SELECT * FROM pipeline_sessions WHERE id = $1',
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена' });
    }

    const session = sessionResult.rows[0];
    if (!['approved', 'ready_for_review'].includes(session.status)) {
      return res.status(400).json({ ok: false, error: 'Видео не готово к публикации' });
    }

    // Вызвать N8N publisher
    try {
      const n8nResponse = await axios.post(`${N8N_URL}/webhook/publisher`, {
        session_id: parseInt(id),
        channels,
        caption: caption || '',
        generate_caption
      }, { timeout: 120000 });

      res.json({ ok: true, data: n8nResponse.data });
    } catch (n8nErr) {
      return res.status(502).json({
        ok: false,
        error: `Ошибка публикации: ${n8nErr.message}`
      });
    }
  } catch (err) {
    next(err);
  }
});

// ─── Удалить/отменить сессию ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const result = await query(
      `UPDATE pipeline_sessions SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('published')
       RETURNING id, status`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена или уже опубликована' });
    }

    res.json({ ok: true, cancelled: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
