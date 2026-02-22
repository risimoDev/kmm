// ─── Sessions Routes ───
// GET    /api/sessions          — Список сессий (фильтры)
// GET    /api/sessions/:id      — Детали сессии
// POST   /api/sessions          — Создать проект
// POST   /api/sessions/:id/approve — Одобрить/отклонить этап
// DELETE /api/sessions/:id      — Отменить проект
// POST   /api/sessions/:id/restart — Перезапустить с этапа

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');
const { emitToSession } = require('../socket');

const router = Router();
const N8N_URL = process.env.N8N_WEBHOOK_URL || 'http://n8n:5678';

// ─── Список сессий ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: [], total: 0 });
    }

    const {
      status,
      marketplace,
      source,
      search,
      limit = '50',
      offset = '0',
      sort = 'updated_at',
      order = 'DESC'
    } = req.query;

    // Whitelist для сортировки
    const allowedSort = ['id', 'created_at', 'updated_at', 'product_name', 'status'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort = allowedSort.includes(sort) ? sort : 'updated_at';
    const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (marketplace) {
      conditions.push(`marketplace = $${paramIdx++}`);
      params.push(marketplace);
    }
    if (source) {
      conditions.push(`source = $${paramIdx++}`);
      params.push(source);
    }
    if (search) {
      conditions.push(`product_name ILIKE $${paramIdx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, user_id, chat_id, source, status, current_step,
                product_name, product_articles, marketplace,
                created_at, updated_at
         FROM pipeline_sessions ${where}
         ORDER BY ${safeSort} ${safeOrder}
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...params, safeLimit, safeOffset]
      ),
      query(
        `SELECT COUNT(*) as total FROM pipeline_sessions ${where}`,
        params
      )
    ]);

    res.json({
      ok: true,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      limit: safeLimit,
      offset: safeOffset
    });
  } catch (err) {
    next(err);
  }
});

// ─── Детали сессии ───
router.get('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'Невалидный ID' });
    }

    const [sessionResult, stepsResult, costsResult] = await Promise.all([
      query('SELECT * FROM pipeline_sessions WHERE id = $1', [id]),
      query('SELECT * FROM pipeline_steps WHERE session_id = $1 ORDER BY step_order', [id]),
      query('SELECT * FROM ai_costs WHERE session_id = $1 ORDER BY created_at', [id])
    ]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена' });
    }

    res.json({
      ok: true,
      data: {
        ...sessionResult.rows[0],
        steps: stepsResult.rows,
        costs: costsResult.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Создать проект ───
router.post('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { productName, productArticles, marketplace, productDescription } = req.body;

    // Валидация
    if (!productName || !productName.trim()) {
      return res.status(400).json({ ok: false, error: 'Название товара обязательно' });
    }
    if (!marketplace) {
      return res.status(400).json({ ok: false, error: 'Маркетплейс обязателен' });
    }

    const userLogin = req.user.login || 'unknown';

    const result = await query(
      `INSERT INTO pipeline_sessions
         (user_id, chat_id, source, status, current_step,
          product_name, product_articles, marketplace, product_description)
       VALUES (0, 0, 'web', 'pipeline_running', 'generating_ideas', $1, $2::jsonb, $3, $4)
       RETURNING id`,
      [
        productName.trim(),
        JSON.stringify(productArticles || []),
        marketplace,
        productDescription || ''
      ]
    );

    const sessionId = result.rows[0].id;

    // Вызываем N8N master pipeline
    try {
      await axios.post(`${N8N_URL}/webhook/master-pipeline`, {
        sessionId,
        chatId: 0,
        userLogin,
        productName: productName.trim(),
        productArticles: productArticles || [],
        marketplace,
        productDescription: productDescription || ''
      }, { timeout: 10_000 });
    } catch (webhookErr) {
      console.error('[N8N] Pipeline webhook error:', webhookErr.message);
      // Не возвращаем ошибку — сессия создана, пайплайн может быть неактивен
    }

    const io = req.app.get('io');
    emitToSession(io, sessionId, 'session-created', { sessionId });

    res.status(201).json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});

// ─── Одобрить/отклонить этап ───
router.post('/:id/approve', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'Невалидный ID' });
    }

    const sessionResult = await query(
      'SELECT id, resume_url, status, current_step FROM pipeline_sessions WHERE id = $1',
      [id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена' });
    }

    const session = sessionResult.rows[0];

    if (!session.resume_url) {
      return res.status(400).json({ ok: false, error: 'Нет активного ожидания для этой сессии' });
    }

    const { action, ideaIndex } = req.body;

    if (!action || !['approve', 'reject', 'select_idea'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'Невалидное действие. Допустимо: approve, reject, select_idea' });
    }

    // Отправляем в N8N resume URL
    await axios.post(session.resume_url, {
      action,
      ideaIndex: ideaIndex !== undefined ? parseInt(ideaIndex) : undefined
    }, { timeout: 10_000 });

    const io = req.app.get('io');
    emitToSession(io, id, 'session-action', { action, ideaIndex });

    res.json({ ok: true, action });
  } catch (err) {
    next(err);
  }
});

// ─── Отменить проект ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'Невалидный ID' });
    }

    const result = await query(
      `UPDATE pipeline_sessions
       SET status = 'cancelled', resume_url = NULL
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled')
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Сессия не найдена или уже завершена' });
    }

    const io = req.app.get('io');
    emitToSession(io, id, 'session-cancelled', { sessionId: id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
