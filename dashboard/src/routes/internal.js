// ─── Internal Routes ───
// Эндпоинты для N8N (без авторизации, доступны только из Docker-сети)
//
// POST /api/internal/step-update      — Обновление шага пайплайна
// POST /api/internal/session-update   — Обновление статуса сессии
// POST /api/internal/error            — Логирование ошибки
// POST /api/internal/log-error        — Алиас для ошибки (из workflow)
// POST /api/internal/cost             — Запись расходов на AI
// POST /api/internal/media            — Регистрация медиа-файла (из N8N)
// POST /api/internal/content-ready    — Callback: контент сгенерирован
// POST /api/internal/video-ready      — Callback: видео готово к ревью

const { Router } = require('express');
const { query, isConnected } = require('../db');
const { emitToSession } = require('../socket');

const router = Router();

// ─── Обновление шага пайплайна ───
router.post('/step-update', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { sessionId, stepName, stepOrder, status, inputData, outputData, aiModel, tokensUsed, durationMs } = req.body;

    if (!sessionId || !stepName) {
      return res.status(400).json({ ok: false, error: 'sessionId и stepName обязательны' });
    }

    // Проверяем, существует ли шаг
    const existing = await query(
      'SELECT id FROM pipeline_steps WHERE session_id = $1 AND step_name = $2',
      [sessionId, stepName]
    );

    if (existing.rows.length > 0) {
      // Обновляем существующий шаг
      const fields = ['status = $1'];
      const params = [status || 'running'];
      let idx = 2;

      if (outputData) { fields.push(`output_data = $${idx++}`); params.push(JSON.stringify(outputData)); }
      if (aiModel) { fields.push(`ai_model = $${idx++}`); params.push(aiModel); }
      if (tokensUsed) { fields.push(`tokens_used = $${idx++}`); params.push(tokensUsed); }
      if (durationMs) { fields.push(`duration_ms = $${idx++}`); params.push(durationMs); }
      if (['completed', 'failed', 'skipped'].includes(status)) { fields.push('completed_at = NOW()'); }
      if (status === 'running') { fields.push('started_at = NOW()'); }

      params.push(existing.rows[0].id);
      await query(`UPDATE pipeline_steps SET ${fields.join(', ')} WHERE id = $${idx}`, params);
    } else {
      // Создаём новый шаг
      await query(
        `INSERT INTO pipeline_steps (session_id, step_name, step_order, status, input_data, output_data, ai_model, tokens_used, duration_ms, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          sessionId, stepName, stepOrder || 0, status || 'running',
          inputData ? JSON.stringify(inputData) : '{}',
          outputData ? JSON.stringify(outputData) : '{}',
          aiModel || null, tokensUsed || 0, durationMs || 0,
          status === 'running' ? new Date() : null
        ]
      );
    }

    // Обновляем current_step в сессии
    if (status === 'running' || status === 'pending') {
      await query(
        'UPDATE pipeline_sessions SET current_step = $1 WHERE id = $2',
        [stepName, sessionId]
      );
    }

    // WebSocket нотификация
    emitToSession(sessionId, 'step-update', {
      sessionId, stepName, status
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Обновление статуса сессии ───
router.post('/session-update', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { sessionId, status, currentStep } = req.body;

    if (!sessionId || !status) {
      return res.status(400).json({ ok: false, error: 'sessionId и status обязательны' });
    }

    const validStatuses = ['created', 'processing', 'ready_for_review', 'approved', 'publishing', 'published', 'rejected', 'error', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: `Невалидный статус. Допустимые: ${validStatuses.join(', ')}` });
    }

    const fields = ['status = $1'];
    const params = [status];
    let paramIdx = 2;

    if (currentStep) {
      fields.push(`current_step = $${paramIdx++}`);
      params.push(currentStep);
    }

    if (req.body.errorMessage) {
      fields.push(`error_message = $${paramIdx++}`);
      params.push(req.body.errorMessage);
    }

    if (req.body.errorStep) {
      fields.push(`error_step = $${paramIdx++}`);
      params.push(req.body.errorStep);
    }

    // sessionId — последний параметр
    params.push(sessionId);

    await query(
      `UPDATE pipeline_sessions SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      params
    );

    // WebSocket нотификация
    emitToSession(sessionId, 'session-update', { sessionId, status, currentStep });
    // Глобальная нотификация для Dashboard
    emitToSession(null, 'session-update', { sessionId, status, currentStep });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Логирование ошибки ───
router.post('/error', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { sessionId, workflowName, nodeName, errorMessage, errorStack } = req.body;

    if (!workflowName || !errorMessage) {
      return res.status(400).json({ ok: false, error: 'workflowName и errorMessage обязательны' });
    }

    await query(
      `INSERT INTO workflow_errors (session_id, workflow_name, node_name, error_message, error_stack)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId || null, workflowName, nodeName || null, errorMessage, errorStack || null]
    );

    // WebSocket: уведомляем Dashboard
    emitToSession(null, 'workflow-error', {
      sessionId, workflowName, nodeName, errorMessage,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Запись расходов на AI ───
router.post('/cost', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { sessionId, stepName, provider, model, promptTokens, completionTokens, totalTokens, costUsd, durationMs } = req.body;

    if (!provider || !model) {
      return res.status(400).json({ ok: false, error: 'provider и model обязательны' });
    }

    const tokensTotal = totalTokens || ((promptTokens || 0) + (completionTokens || 0));

    await query(
      `INSERT INTO ai_costs (session_id, step_name, provider, model, tokens_prompt, tokens_completion, tokens_total, cost_usd, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sessionId || null,
        stepName || null,
        provider,
        model,
        promptTokens || 0,
        completionTokens || 0,
        tokensTotal,
        costUsd || 0,
        durationMs || 0
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Регистрация медиа-файла (из N8N) ───
router.post('/media', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { sessionId, fileKey, fileName, fileType, mimeType, fileSize, source, metadata } = req.body;

    if (!fileKey || !fileName) {
      return res.status(400).json({ ok: false, error: 'fileKey и fileName обязательны' });
    }

    const result = await query(
      `INSERT INTO media_files (session_id, file_key, file_name, file_type, mime_type, file_size, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        sessionId || null,
        fileKey,
        fileName,
        fileType || 'document',
        mimeType || 'application/octet-stream',
        fileSize || 0,
        source || 'n8n',
        metadata ? JSON.stringify(metadata) : null
      ]
    );

    res.status(201).json({ ok: true, data: { id: result.rows[0].id } });
  } catch (err) {
    next(err);
  }
});

// ─── Callback: контент сгенерирован (из content-brain workflow) ───
router.post('/content-ready', async (req, res, next) => {
  try {
    const { idea_id, voice_script_id, video_prompt_id, status } = req.body;

    // WebSocket: уведомить Dashboard о новом контенте
    emitToSession(null, 'content-ready', {
      idea_id, voice_script_id, video_prompt_id, status,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Callback: видео готово к ревью (из video-factory workflow) ───
router.post('/video-ready', async (req, res, next) => {
  try {
    const { session_id, final_video_url, status } = req.body;

    // WebSocket: уведомить Dashboard 
    emitToSession(session_id, 'video-ready', {
      session_id, final_video_url, status,
      timestamp: new Date().toISOString()
    });
    emitToSession(null, 'video-ready', {
      session_id, final_video_url, status,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Callback: карточка товара готова (из product-card workflow) ───
router.post('/card-ready', async (req, res, next) => {
  try {
    const { card_id, product_name, status, image_url } = req.body;

    // WebSocket: уведомить Dashboard о готовой карточке
    emitToSession(null, 'card-ready', {
      card_id, product_name, status, image_url,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Алиас: лог ошибки (из workflow JSON) ───
router.post('/log-error', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { workflow_name, session_id, error_message, node_name } = req.body;

    await query(
      `INSERT INTO workflow_errors (session_id, workflow_name, node_name, error_message)
       VALUES ($1, $2, $3, $4)`,
      [session_id || null, workflow_name || 'unknown', node_name || null, error_message || 'Unknown error']
    );

    emitToSession(null, 'workflow-error', {
      sessionId: session_id, workflowName: workflow_name, nodeName: node_name, errorMessage: error_message,
      timestamp: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
