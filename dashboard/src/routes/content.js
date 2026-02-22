// ─── Content Routes ───
// GET    /api/content/ideas          — Список идей
// GET    /api/content/ideas/:id      — Одна идея + сценарий + промпт
// POST   /api/content/generate       — Запуск генерации через N8N
// PUT    /api/content/ideas/:id      — Обновить идею (статус, текст)
// PUT    /api/content/scripts/:id    — Обновить сценарий
// PUT    /api/content/prompts/:id    — Обновить видео-промпт
// DELETE /api/content/ideas/:id      — Удалить идею (каскадно)

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Список идей ───
router.get('/ideas', async (req, res, next) => {
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

    const allowedSort = ['id', 'created_at', 'title', 'status', 'category'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort = allowedSort.includes(sort) ? sort : 'created_at';
    const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`ci.status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(ci.title ILIKE $${idx} OR ci.concept ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM content_ideas ci ${where}`,
      params
    );

    const dataResult = await query(
      `SELECT ci.*,
              vs.id as script_id, vs.status as script_status,
              vp.id as prompt_id, vp.status as prompt_status
       FROM content_ideas ci
       LEFT JOIN voice_scripts vs ON vs.idea_id = ci.id
       LEFT JOIN video_prompts vp ON vp.idea_id = ci.id
       ${where}
       ORDER BY ci.${safeSort} ${safeOrder}
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

// ─── Детали идеи ───
router.get('/ideas/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;

    const ideaResult = await query('SELECT * FROM content_ideas WHERE id = $1', [id]);
    if (ideaResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Идея не найдена' });
    }

    const scriptResult = await query('SELECT * FROM voice_scripts WHERE idea_id = $1', [id]);
    const promptResult = await query('SELECT * FROM video_prompts WHERE idea_id = $1', [id]);

    res.json({
      ok: true,
      data: {
        idea: ideaResult.rows[0],
        voice_script: scriptResult.rows[0] || null,
        video_prompt: promptResult.rows[0] || null
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Генерация контента через N8N ───
router.post('/generate', async (req, res, next) => {
  try {
    const { count = 3, product_name, niche, extra_instructions } = req.body;

    // Получить системный промпт из настроек
    let systemPrompt = '';
    if (isConnected()) {
      const settingResult = await query(
        "SELECT value FROM app_settings WHERE key = 'ai_system_prompt'"
      );
      if (settingResult.rows.length > 0) {
        systemPrompt = settingResult.rows[0].value;
      }
    }

    // Вызвать N8N webhook
    const n8nResponse = await axios.post(`${N8N_URL}/webhook/content-brain`, {
      count,
      product_name: product_name || '',
      niche: niche || '',
      extra_instructions: extra_instructions || '',
      system_prompt: systemPrompt
    }, { timeout: 120000 });

    res.json({
      ok: true,
      data: n8nResponse.data
    });
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

// ─── Обновить идею ───
router.put('/ideas/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { title, category, concept, visual_description, target_audience, tone, status } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined)              { fields.push(`title = $${idx++}`); values.push(title); }
    if (category !== undefined)           { fields.push(`category = $${idx++}`); values.push(category); }
    if (concept !== undefined)            { fields.push(`concept = $${idx++}`); values.push(concept); }
    if (visual_description !== undefined) { fields.push(`visual_description = $${idx++}`); values.push(visual_description); }
    if (target_audience !== undefined)    { fields.push(`target_audience = $${idx++}`); values.push(target_audience); }
    if (tone !== undefined)               { fields.push(`tone = $${idx++}`); values.push(tone); }
    if (status !== undefined)             { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    // Если review — записать reviewed_by/at
    if (status === 'approved' || status === 'rejected') {
      fields.push(`reviewed_by = $${idx++}`);
      values.push(req.user?.id || null);
      fields.push(`reviewed_at = NOW()`);
    }

    values.push(id);
    const result = await query(
      `UPDATE content_ideas SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Идея не найдена' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить сценарий ───
router.put('/scripts/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { script_text, timing_marks, status } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (script_text !== undefined)  { fields.push(`script_text = $${idx++}`); values.push(script_text); }
    if (timing_marks !== undefined) { fields.push(`timing_marks = $${idx++}`); values.push(JSON.stringify(timing_marks)); }
    if (status !== undefined)       { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await query(
      `UPDATE voice_scripts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сценарий не найден' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить видео-промпт ───
router.put('/prompts/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { prompt_text, scene_descriptions, style_reference, status } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (prompt_text !== undefined)        { fields.push(`prompt_text = $${idx++}`); values.push(prompt_text); }
    if (scene_descriptions !== undefined) { fields.push(`scene_descriptions = $${idx++}`); values.push(JSON.stringify(scene_descriptions)); }
    if (style_reference !== undefined)    { fields.push(`style_reference = $${idx++}`); values.push(style_reference); }
    if (status !== undefined)             { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await query(
      `UPDATE video_prompts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Промпт не найден' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Удалить идею (каскадно) ───
router.delete('/ideas/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const result = await query('DELETE FROM content_ideas WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Идея не найдена' });
    }

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
