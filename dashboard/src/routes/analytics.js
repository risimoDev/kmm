// ─── Analytics Routes ───
// GET /api/analytics           — Общая сводка
// GET /api/analytics/summary   — Краткая сводка для Dashboard
// GET /api/analytics/daily     — По дням (30 дней)
// GET /api/analytics/costs     — Расходы AI

const { Router } = require('express');
const { query, isConnected } = require('../db');

const router = Router();

// ─── Краткая сводка для Dashboard ───
router.get('/summary', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: { total_ideas: 0, total_sessions: 0, review_count: 0, published_count: 0, error_count: 0 } });
    }

    const [ideas, sessions] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total_ideas FROM content_ideas`),
      query(`
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'ready_for_review')::int AS review_count,
          COUNT(*) FILTER (WHERE status = 'published')::int AS published_count,
          COUNT(*) FILTER (WHERE status = 'error')::int AS error_count
        FROM pipeline_sessions
      `)
    ]);

    res.json({
      ok: true,
      data: {
        total_ideas: ideas.rows[0].total_ideas,
        ...sessions.rows[0]
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Общая сводка ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: emptyAnalytics() });
    }

    const [stats, errStats, costStats] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int                                           AS total,
          COUNT(*) FILTER (WHERE status = 'published')::int      AS published,
          COUNT(*) FILTER (WHERE status = 'processing')::int     AS running,
          COUNT(*) FILTER (WHERE status = 'rejected')::int       AS rejected,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int      AS cancelled,
          COUNT(*) FILTER (WHERE status = 'error')::int          AS errors_count,
          COUNT(*) FILTER (WHERE status = 'ready_for_review')::int AS review,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int   AS last_7d,
          ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)))::numeric / 60, 1) AS avg_duration_min
        FROM pipeline_sessions
      `),
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h
        FROM workflow_errors
      `),
      query(`
        SELECT
          COALESCE(SUM(tokens_total), 0)::int AS total_tokens,
          COALESCE(SUM(cost_usd), 0)::numeric(10,4) AS total_cost_usd,
          COUNT(*)::int AS total_requests
        FROM ai_costs
        WHERE created_at > NOW() - INTERVAL '30 days'
      `)
    ]);

    res.json({
      ok: true,
      data: {
        sessions: stats.rows[0],
        errors: errStats.rows[0],
        costs: costStats.rows[0]
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── По дням (30 дней) ───
router.get('/daily', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: [] });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);

    const result = await query(`
      SELECT
        DATE(created_at) AS day,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS running
      FROM pipeline_sessions
      WHERE created_at > NOW() - INTERVAL '1 day' * $1
      GROUP BY DATE(created_at)
      ORDER BY day
    `, [days]);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Расходы AI ───
router.get('/costs', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: { daily: [], byModel: [], byStep: [] } });
    }

    const days = Math.min(parseInt(req.query.days) || 30, 365);

    const [daily, byModel, byStep] = await Promise.all([
      query(`
        SELECT
          DATE(created_at) AS day,
          SUM(tokens_total)::int AS tokens,
          SUM(cost_usd)::numeric(10,4) AS cost_usd,
          COUNT(*)::int AS requests
        FROM ai_costs
        WHERE created_at > NOW() - INTERVAL '1 day' * $1
        GROUP BY DATE(created_at)
        ORDER BY day
      `, [days]),
      query(`
        SELECT
          model,
          SUM(tokens_total)::int AS tokens,
          SUM(cost_usd)::numeric(10,4) AS cost_usd,
          COUNT(*)::int AS requests
        FROM ai_costs
        WHERE created_at > NOW() - INTERVAL '1 day' * $1
        GROUP BY model
        ORDER BY cost_usd DESC
      `, [days]),
      query(`
        SELECT
          step_name,
          SUM(tokens_total)::int AS tokens,
          SUM(cost_usd)::numeric(10,4) AS cost_usd,
          COUNT(*)::int AS requests,
          ROUND(AVG(duration_ms)::numeric) AS avg_duration_ms
        FROM ai_costs
        WHERE created_at > NOW() - INTERVAL '1 day' * $1
        GROUP BY step_name
        ORDER BY cost_usd DESC
      `, [days])
    ]);

    res.json({
      ok: true,
      data: {
        daily: daily.rows,
        byModel: byModel.rows,
        byStep: byStep.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Воронка конверсии (новая схема v3) ───
router.get('/funnel', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: [] });
    }

    const result = await query(`
      SELECT 'ideas_created'::text AS stage, COUNT(*)::int AS count FROM content_ideas
      UNION ALL
      SELECT 'ideas_approved', COUNT(*)::int FROM content_ideas WHERE status = 'approved'
      UNION ALL
      SELECT 'scripts_created', COUNT(*)::int FROM voice_scripts
      UNION ALL
      SELECT 'prompts_created', COUNT(*)::int FROM video_prompts
      UNION ALL
      SELECT 'sessions_started', COUNT(*)::int FROM pipeline_sessions
      UNION ALL
      SELECT 'video_ready', COUNT(*)::int FROM pipeline_sessions WHERE final_video_url IS NOT NULL
      UNION ALL
      SELECT 'reviewed', COUNT(*)::int FROM pipeline_sessions WHERE status IN ('approved', 'published', 'rejected')
      UNION ALL
      SELECT 'published', COUNT(*)::int FROM pipeline_sessions WHERE status = 'published'
    `);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

function emptyAnalytics() {
  return {
    sessions: { total: 0, published: 0, running: 0, rejected: 0, cancelled: 0, errors_count: 0, review: 0, last_24h: 0, last_7d: 0, avg_duration_min: 0 },
    errors: { total: 0, last_24h: 0 },
    costs: { total_tokens: 0, total_cost_usd: 0, total_requests: 0 }
  };
}

module.exports = router;
