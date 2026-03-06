// ─── References Routes ───
// GET    /api/references              — Список вирусных рефов
// GET    /api/references/:id          — Детали одного рефа с full analysis
// POST   /api/references/analyze      — Запустить анализ URL (yt-dlp + LLM)
// DELETE /api/references/:id          — Удалить реф

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── Список рефов ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], total: 0 });

    const {
      platform,
      status,
      search,
      limit = '50',
      offset = '0',
      sort = 'created_at',
      order = 'DESC'
    } = req.query;

    const allowedSort = ['id', 'created_at', 'viral_score', 'view_count', 'like_count', 'platform'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort  = allowedSort.includes(sort) ? sort : 'created_at';
    const safeOrder = allowedOrder.includes((order || '').toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit  = Math.min(Math.max(parseInt(limit)  || 50,  1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (platform) {
      conditions.push(`platform = $${idx++}`);
      params.push(platform);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(title ILIKE $${idx} OR channel_name ILIKE $${idx} OR hook_type ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countResult, rows] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM viral_references ${where}`, params),
      query(
        `SELECT id, url, platform, title, channel_name, view_count, like_count,
                duration_sec, viral_score, hook_type, editing_style, status,
                thumbnail_url, analyzed_at, created_at
         FROM viral_references ${where}
         ORDER BY ${safeSort} ${safeOrder}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, safeLimit, safeOffset]
      )
    ]);

    res.json({
      ok: true,
      data: rows.rows,
      total: parseInt(countResult.rows[0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset
    });
  } catch (err) {
    next(err);
  }
});

// ─── Один реф ───
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const result = await query('SELECT * FROM viral_references WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Запустить анализ ───
router.post('/analyze', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string' || url.length > 2000) {
      return res.status(400).json({ ok: false, error: 'url is required (max 2000 chars)' });
    }

    // Basic URL validation — must start with http(s)://
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: 'url must start with http:// or https://' });
    }

    const n8nResponse = await axios.post(
      `${N8N_URL}/webhook/content-analyzer`,
      { url },
      { timeout: 120000 }
    );

    const data = n8nResponse.data;
    res.json({ ok: true, data });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({ ok: false, error: 'Analysis workflow error', details: err.response.data });
    }
    next(err);
  }
});

// ─── Удалить реф ───
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });

    const result = await query('DELETE FROM viral_references WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });

    res.json({ ok: true, deleted_id: id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
