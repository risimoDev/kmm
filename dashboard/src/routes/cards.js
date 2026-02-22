// ─── Product Cards Routes ───
// GET    /api/cards              — Список карточек
// GET    /api/cards/:id          — Детали карточки
// POST   /api/cards/generate     — Генерация карточки (через N8N)
// PUT    /api/cards/:id          — Обновить карточку
// PUT    /api/cards/:id/approve  — Одобрить
// PUT    /api/cards/:id/reject   — Отклонить
// DELETE /api/cards/:id          — Удалить

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');
const { emitToSession } = require('../socket');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Список карточек ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], total: 0 });

    const {
      status,
      search,
      marketplace,
      limit = '50',
      offset = '0',
      sort = 'created_at',
      order = 'DESC'
    } = req.query;

    const allowedSort = ['id', 'created_at', 'product_name', 'status', 'marketplace'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort = allowedSort.includes(sort) ? sort : 'created_at';
    const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (marketplace) {
      conditions.push(`marketplace = $${idx++}`);
      params.push(marketplace);
    }
    if (search) {
      conditions.push(`(product_name ILIKE $${idx} OR main_title ILIKE $${idx} OR seo_title ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM product_cards ${where}`,
      params
    );

    const dataResult = await query(
      `SELECT id, product_name, image_url, marketplace, artikuls,
              main_title, subtitle, status, style, created_at, updated_at
       FROM product_cards ${where}
       ORDER BY ${safeSort} ${safeOrder}
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

// ─── Детали карточки ───
router.get('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const result = await query('SELECT * FROM product_cards WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Карточка не найдена' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Генерация карточки через N8N ───
router.post('/generate', async (req, res, next) => {
  try {
    const {
      product_name,
      image_url,
      marketplace = 'WB',
      artikuls = [],
      product_description = '',
      target_audience = '',
      key_features = '',
      style = 'modern',
      color_scheme = 'auto',
      include_price = false,
      price = '',
      include_badge = false,
      badge_text = '',
      extra_instructions = ''
    } = req.body;

    if (!product_name) {
      return res.status(400).json({ ok: false, error: 'product_name обязателен' });
    }
    if (!image_url) {
      return res.status(400).json({ ok: false, error: 'image_url обязателен (URL фото товара)' });
    }

    // Call N8N product-card webhook
    const n8nResponse = await axios.post(`${N8N_URL}/webhook/product-card`, {
      product_name,
      image_url,
      marketplace,
      artikuls,
      product_description,
      target_audience,
      key_features,
      style,
      color_scheme,
      include_price,
      price,
      include_badge,
      badge_text,
      extra_instructions
    }, { timeout: 120000 });

    res.json({
      ok: true,
      data: n8nResponse.data,
      message: 'Генерация карточки запущена'
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

// ─── Обновить карточку ───
router.put('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const {
      main_title, subtitle, bullet_points, cta_text,
      seo_title, seo_description, search_keywords,
      category_suggestion, visual_style_notes,
      rich_content_blocks, infographic_prompts, a_plus_content,
      style, color_scheme, status
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (main_title !== undefined)        { fields.push(`main_title = $${idx++}`); values.push(main_title); }
    if (subtitle !== undefined)          { fields.push(`subtitle = $${idx++}`); values.push(subtitle); }
    if (bullet_points !== undefined)     { fields.push(`bullet_points = $${idx++}`); values.push(JSON.stringify(bullet_points)); }
    if (cta_text !== undefined)          { fields.push(`cta_text = $${idx++}`); values.push(cta_text); }
    if (seo_title !== undefined)         { fields.push(`seo_title = $${idx++}`); values.push(seo_title); }
    if (seo_description !== undefined)   { fields.push(`seo_description = $${idx++}`); values.push(seo_description); }
    if (search_keywords !== undefined)   { fields.push(`search_keywords = $${idx++}`); values.push(JSON.stringify(search_keywords)); }
    if (category_suggestion !== undefined) { fields.push(`category_suggestion = $${idx++}`); values.push(category_suggestion); }
    if (visual_style_notes !== undefined) { fields.push(`visual_style_notes = $${idx++}`); values.push(visual_style_notes); }
    if (rich_content_blocks !== undefined){ fields.push(`rich_content_blocks = $${idx++}`); values.push(JSON.stringify(rich_content_blocks)); }
    if (infographic_prompts !== undefined){ fields.push(`infographic_prompts = $${idx++}`); values.push(JSON.stringify(infographic_prompts)); }
    if (a_plus_content !== undefined)    { fields.push(`a_plus_content = $${idx++}`); values.push(JSON.stringify(a_plus_content)); }
    if (style !== undefined)             { fields.push(`style = $${idx++}`); values.push(style); }
    if (color_scheme !== undefined)      { fields.push(`color_scheme = $${idx++}`); values.push(color_scheme); }
    if (status !== undefined)            { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await query(
      `UPDATE product_cards SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Карточка не найдена' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Одобрить ───
router.put('/:id/approve', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });
    const result = await query(
      `UPDATE product_cards SET status = 'approved' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Не найдена' });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── Отклонить ───
router.put('/:id/reject', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });
    const result = await query(
      `UPDATE product_cards SET status = 'rejected' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Не найдена' });
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── Удалить ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });
    const result = await query('DELETE FROM product_cards WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Не найдена' });
    res.json({ ok: true, deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
