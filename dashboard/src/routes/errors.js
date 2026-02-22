// ─── Errors Routes ───
// GET /api/errors — Список ошибок workflow

const { Router } = require('express');
const { query, isConnected } = require('../db');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: [], total: 0 });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const workflow = req.query.workflow;

    let where = '';
    const params = [];
    let paramIdx = 1;

    if (workflow) {
      where = `WHERE workflow_name = $${paramIdx++}`;
      params.push(workflow);
    }

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT * FROM workflow_errors ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM workflow_errors ${where}`,
        params
      )
    ]);

    res.json({
      ok: true,
      data: dataResult.rows,
      total: countResult.rows[0].total
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
