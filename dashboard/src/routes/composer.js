// ─── Composer Routes ───
// GET    /api/composer/style-packs        — Список стиль-паков
// POST   /api/composer/style-packs        — Создать стиль-пак
// PUT    /api/composer/style-packs/:id    — Обновить стиль-пак
// DELETE /api/composer/style-packs/:id    — Деактивировать стиль-пак
// POST   /api/composer/compose            — Запустить монтаж сессии

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Список стиль-паков ───
router.get('/style-packs', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [] });

    const { active_only = 'true' } = req.query;
    const onlyActive = active_only !== 'false';

    const result = await query(
      `SELECT id, name, description,
              subtitle_font, subtitle_font_size, subtitle_primary_color,
              subtitle_outline_color, subtitle_back_color, subtitle_bold,
              subtitle_outline, subtitle_shadow, subtitle_position,
              subtitle_margin_v, subtitle_words_per_line, subtitle_animation,
              color_filter, vignette, output_quality,
              is_active, is_default, created_at
       FROM style_packs
       ${onlyActive ? 'WHERE is_active = TRUE' : ''}
       ORDER BY is_default DESC, id ASC`
    );

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Создать стиль-пак ───
router.post('/style-packs', async (req, res, next) => {
  try {
    const {
      name, description,
      subtitle_font = 'Arial',
      subtitle_font_size = 52,
      subtitle_primary_color = '&H00FFFFFF',
      subtitle_outline_color = '&H00000000',
      subtitle_back_color = '&H80000000',
      subtitle_bold = false,
      subtitle_outline = 2.5,
      subtitle_shadow = 1.0,
      subtitle_position = 'bottom',
      subtitle_margin_v = 80,
      subtitle_words_per_line = 4,
      subtitle_animation = 'fade',
      color_filter = '',
      vignette = false,
      output_quality = 23,
      is_default = false
    } = req.body;

    if (!name || typeof name !== 'string' || name.length > 100) {
      return res.status(400).json({ ok: false, error: 'name is required (max 100 chars)' });
    }

    // Validate subtitle_position
    const validPositions = ['bottom', 'top', 'center'];
    if (!validPositions.includes(subtitle_position)) {
      return res.status(400).json({ ok: false, error: 'subtitle_position must be bottom, top, or center' });
    }

    const result = await query(
      `INSERT INTO style_packs (
        name, description,
        subtitle_font, subtitle_font_size, subtitle_primary_color,
        subtitle_outline_color, subtitle_back_color, subtitle_bold,
        subtitle_outline, subtitle_shadow, subtitle_position,
        subtitle_margin_v, subtitle_words_per_line, subtitle_animation,
        color_filter, vignette, output_quality, is_default
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        name, description || null,
        subtitle_font, parseInt(subtitle_font_size),
        subtitle_primary_color, subtitle_outline_color, subtitle_back_color,
        Boolean(subtitle_bold), parseFloat(subtitle_outline), parseFloat(subtitle_shadow),
        subtitle_position, parseInt(subtitle_margin_v),
        parseInt(subtitle_words_per_line), subtitle_animation,
        color_filter || null, Boolean(vignette),
        parseInt(output_quality), Boolean(is_default)
      ]
    );

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить стиль-пак ───
router.put('/style-packs/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const allowed = [
      'name', 'description',
      'subtitle_font', 'subtitle_font_size', 'subtitle_primary_color',
      'subtitle_outline_color', 'subtitle_back_color', 'subtitle_bold',
      'subtitle_outline', 'subtitle_shadow', 'subtitle_position',
      'subtitle_margin_v', 'subtitle_words_per_line', 'subtitle_animation',
      'color_filter', 'vignette', 'output_quality', 'is_default', 'is_active'
    ];

    const sets = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (key in req.body) {
        sets.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid fields to update' });
    }

    values.push(id);
    const result = await query(
      `UPDATE style_packs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Style pack not found' });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Деактивировать стиль-пак (soft delete) ───
router.delete('/style-packs/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const result = await query(
      'UPDATE style_packs SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Style pack not found' });

    res.json({ ok: true, deactivated: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Запустить монтаж ───
router.post('/compose', async (req, res, next) => {
  try {
    const { session_id, style_pack_id, words_per_line } = req.body;

    const sessionId = parseInt(session_id);
    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ ok: false, error: 'session_id is required' });
    }

    const payload = { session_id: sessionId };
    if (style_pack_id) payload.style_pack_id = parseInt(style_pack_id);
    if (words_per_line) payload.words_per_line = parseInt(words_per_line);

    // Fire and forget — n8n responds immediately, composition runs async
    const n8nResponse = await axios.post(
      `${N8N_URL}/webhook/video-composer`,
      payload,
      { timeout: 15000 }
    );

    res.json({ ok: true, data: n8nResponse.data });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({ ok: false, error: 'Composer workflow error', details: err.response.data });
    }
    next(err);
  }
});

module.exports = router;
