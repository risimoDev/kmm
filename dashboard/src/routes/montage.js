// в”Ђв”Ђв”Ђ Montage Routes v2.0 в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// GET    /api/montage/scripts              вЂ” СЃРїРёСЃРѕРє СЃРєСЂРёРїС‚РѕРІ
// POST   /api/montage/scripts              вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ / РѕР±РЅРѕРІРёС‚СЊ + Р°РІС‚РѕРІРµСЂСЃРёСЏ
// GET    /api/montage/scripts/:id          вЂ” Р·Р°РіСЂСѓР·РёС‚СЊ СЃРєСЂРёРїС‚
// DELETE /api/montage/scripts/:id          вЂ” СѓРґР°Р»РёС‚СЊ СЃРєСЂРёРїС‚
// GET    /api/montage/scripts/:id/versions вЂ” РёСЃС‚РѕСЂРёСЏ РІРµСЂСЃРёР№ (РґРѕ 5)
// POST   /api/montage/scripts/:id/restore/:ver вЂ” РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РІРµСЂСЃРёСЋ
// POST   /api/montage/render               вЂ” Р·Р°РїСѓСЃРє СЂРµРЅРґРµСЂР° + WS-РїРѕРґРїРёСЃРєР°
// POST   /api/montage/render/multi         вЂ” РјСѓР»СЊС‚РёС„РѕСЂРјР°С‚РЅС‹Р№ СЂРµРЅРґРµСЂ
// GET    /api/montage/status/:jobId        вЂ” СЃС‚Р°С‚СѓСЃ Р·Р°РґР°С‡Рё
// GET    /api/montage/jobs                 вЂ” СЃРїРёСЃРѕРє Р·Р°РґР°С‡
// DELETE /api/montage/job/:jobId           вЂ” СѓРґР°Р»РёС‚СЊ Р·Р°РґР°С‡Сѓ
// GET    /api/montage/preview/:jobId       вЂ” РїСЂРµРІСЊСЋ РєР°РґСЂ (PNG)
// GET    /api/montage/frame/:jobId?t=5.0   вЂ” РєР°РґСЂ РїРѕ РІСЂРµРјРµРЅРЅРѕР№ РјРµС‚РєРµ
// GET    /api/montage/luts                 вЂ” СЃРїРёСЃРѕРє LUT-РїСЂРµСЃРµС‚РѕРІ
// POST   /api/montage/analyze/bpm          вЂ” BPM + РІСЂРµРјРµРЅРЅС‹МЂРµ РјРµС‚РєРё РґРѕР»РµР№
// POST   /api/montage/analyze/scenes       вЂ” Р°РІС‚РѕРґРµС‚РµРєС†РёСЏ РјРѕРЅС‚Р°Р¶РЅС‹С… СЃРєР»РµРµРє
// POST   /api/montage/ai-generate          вЂ” AI-РіРµРЅРµСЂР°С†РёСЏ СЃРєСЂРёРїС‚Р° (GPT-4o)

const { Router } = require('express');
const { WebSocket: WS } = require('ws');
const { query, isConnected } = require('../db');
const axios = require('axios');

const router   = Router();
const MONTAGE  = process.env.MONTAGE_SERVICE_URL || 'http://montage-service:8001';
const MAX_VERSIONS = 5;


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// РҐРµР»РїРµСЂ: РїСЂРѕРєСЃРёСЂРѕРІР°РЅРёРµ JSON-Р·Р°РїСЂРѕСЃРѕРІ Рє Python-СЃРµСЂРІРёСЃСѓ
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

async function proxyToMontage(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${MONTAGE}${path}`, opts);
  const data = await resp.json();
  return { status: resp.status, data };
}


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// WS-РїРѕРґРїРёСЃРєР°: СЂРµС‚СЂР°РЅСЃР»РёСЂСѓРµС‚ РїСЂРѕРіСЂРµСЃСЃ Python в†’ Socket.IO
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

function subscribeRenderProgress(jobId, io, userId = null) {
  const ws = new WS(`ws://montage-service:8001/ws/${jobId}`);
  ws.on('open', () => ws.send('ping'));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      io.emit('montage:progress', { job_id: jobId, ...msg });
      // Auto-save completed render to media_files
      if (msg.status === 'done' && msg.output_url && isConnected()) {
        const match = msg.output_url.match(/^minio:\/\/[^\/]+\/(.+)$/);
        const fileKey = match ? match[1] : `renders/${jobId}/output.mp4`;
        const fileName = `montage-${jobId.slice(0, 8)}.mp4`;
        query(
          `INSERT INTO media_files (user_id, file_key, file_name, file_type, mime_type, source)
           VALUES ($1, $2, $3, 'video', 'video/mp4', 'montage_render')`,
          [userId || null, fileKey, fileName]
        ).catch(e => console.error('[Montage] save render to DB failed:', e.message));
      }
    } catch {}
  });
  ws.on('error', (err) =>
    console.error(`[Montage WS ${jobId.slice(0, 8)}] ${err.message}`)
  );
  ws.on('close', () =>
    console.log(`[Montage WS ${jobId.slice(0, 8)}] closed`)
  );
}


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// РЎРљР РРџРўР«  (Р‘Р”)
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

router.get('/scripts', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], total: 0 });
    const { rows } = await query(
      `SELECT id, name, description, template_type, created_at, updated_at, render_count, last_rendered_at
       FROM montage_scripts
       ORDER BY updated_at DESC
       LIMIT 100`
    );
    res.json({ ok: true, data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});


router.get('/scripts/:id', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID' });
    const { rows } = await query('SELECT * FROM montage_scripts WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'РЎРєСЂРёРїС‚ РЅРµ РЅР°Р№РґРµРЅ' });
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});


// POST /scripts вЂ” СЃРѕР·РґР°РЅРёРµ РёР»Рё РѕР±РЅРѕРІР»РµРЅРёРµ, СЃ Р°РІС‚РѕСЃРѕС…СЂР°РЅРµРЅРёРµРј РІРµСЂСЃРёР№
router.post('/scripts', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const { name, description, script_json, template_type, id } = req.body;
    if (!name || !script_json)
      return res.status(400).json({ ok: false, error: 'РўСЂРµР±СѓСЋС‚СЃСЏ РїРѕР»СЏ name Рё script_json' });

    if (id) {
      // РџРµСЂРµРґ РѕР±РЅРѕРІР»РµРЅРёРµРј вЂ” СЃРѕС…СЂР°РЅСЏРµРј С‚РµРєСѓС‰СѓСЋ РІРµСЂСЃРёСЋ РІ РёСЃС‚РѕСЂРёСЋ
      const { rows: cur } = await query(
        'SELECT script_json FROM montage_scripts WHERE id = $1',
        [id]
      );
      if (cur.length) {
        const { rows: vv } = await query(
          'SELECT COALESCE(MAX(version_num), 0) AS last FROM montage_script_versions WHERE script_id = $1',
          [id]
        );
        const nextVer = (vv[0]?.last ?? 0) + 1;
        await query(
          `INSERT INTO montage_script_versions (script_id, version_num, script_json)
           VALUES ($1, $2, $3)`,
          [id, nextVer, JSON.stringify(cur[0].script_json)]
        );
        // РЈРґР°Р»СЏРµРј Р»РёС€РЅРёРµ РІРµСЂСЃРёРё (РѕСЃС‚Р°РІР»СЏРµРј РїРѕСЃР»РµРґРЅРёРµ MAX_VERSIONS)
        await query(
          `DELETE FROM montage_script_versions
           WHERE script_id = $1 AND version_num NOT IN (
             SELECT version_num FROM montage_script_versions
             WHERE script_id = $1 ORDER BY version_num DESC LIMIT $2
           )`,
          [id, MAX_VERSIONS]
        );
      }

      const { rows } = await query(
        `UPDATE montage_scripts
         SET name = $1, description = $2, script_json = $3, template_type = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING id, name, updated_at`,
        [name, description ?? null, JSON.stringify(script_json), template_type ?? null, id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'РЎРєСЂРёРїС‚ РЅРµ РЅР°Р№РґРµРЅ' });
      return res.json({ ok: true, data: rows[0] });
    }

    const { rows } = await query(
      `INSERT INTO montage_scripts (name, description, script_json, template_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, created_at`,
      [name, description ?? null, JSON.stringify(script_json), template_type ?? null]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
});


router.delete('/scripts/:id', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID' });
    const { rowCount } = await query('DELETE FROM montage_scripts WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ ok: false, error: 'РЎРєСЂРёРїС‚ РЅРµ РЅР°Р№РґРµРЅ' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// РРЎРўРћР РРЇ Р’Р•Р РЎРР™
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

router.get('/scripts/:id/versions', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID' });
    const { rows } = await query(
      `SELECT id, version_num, name, created_at
       FROM montage_script_versions
       WHERE script_id = $1
       ORDER BY version_num DESC
       LIMIT $2`,
      [id, MAX_VERSIONS]
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});


router.post('/scripts/:id/restore/:ver', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });
    const scriptId = parseInt(req.params.id, 10);
    const ver      = parseInt(req.params.ver, 10);
    if (isNaN(scriptId) || isNaN(ver))
      return res.status(400).json({ ok: false, error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹' });

    const { rows: vRows } = await query(
      'SELECT script_json FROM montage_script_versions WHERE script_id = $1 AND version_num = $2',
      [scriptId, ver]
    );
    if (!vRows.length)
      return res.status(404).json({ ok: false, error: 'Р’РµСЂСЃРёСЏ РЅРµ РЅР°Р№РґРµРЅР°' });

    await query(
      'UPDATE montage_scripts SET script_json = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(vRows[0].script_json), scriptId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// Р Р•РќР”Р•Р 
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

router.post('/render', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('POST', '/render', req.body);
    if (data.ok && data.job_id) {
      const io = req.app.get('io');
      if (io) subscribeRenderProgress(data.job_id, io, req.user?.id || null);
      if (req.body.script_id && isConnected()) {
        await query(
          'UPDATE montage_scripts SET render_count = render_count + 1, last_rendered_at = NOW() WHERE id = $1',
          [req.body.script_id]
        ).catch(() => {});
      }
    }
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.post('/render/multi', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('POST', '/render/multi', req.body);
    if (data.ok && Array.isArray(data.jobs)) {
      const io = req.app.get('io');
      if (io) data.jobs.forEach(j => subscribeRenderProgress(j.job_id, io, req.user?.id || null));
    }
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.get('/status/:jobId', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('GET', `/status/${req.params.jobId}`);
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.get('/jobs', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('GET', '/jobs');
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.delete('/job/:jobId', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('DELETE', `/job/${req.params.jobId}`);
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.get('/preview/:jobId', async (req, res, next) => {
  try {
    const resp = await fetch(`${MONTAGE}/preview/${req.params.jobId}`);
    if (!resp.ok) return res.status(resp.status).json({ ok: false, error: 'РџСЂРµРІСЊСЋ РЅРµ РЅР°Р№РґРµРЅРѕ' });
    const buf = await resp.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});


router.get('/frame/:jobId', async (req, res, next) => {
  try {
    const t    = parseFloat(req.query.t) || 0;
    const resp = await fetch(`${MONTAGE}/frame/${req.params.jobId}?t=${t}`);
    if (!resp.ok) return res.status(resp.status).json({ ok: false, error: 'РљР°РґСЂ РЅРµ РЅР°Р№РґРµРЅ' });
    const buf  = await resp.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// РРќРЎРўР РЈРњР•РќРўР« РђРќРђР›РР—Рђ Р РџР Р•РЎР•РўР«
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

router.get('/luts', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('GET', '/luts');
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.post('/analyze/bpm', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('POST', '/analyze/bpm', req.body);
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


router.post('/analyze/scenes', async (req, res, next) => {
  try {
    const { status, data } = await proxyToMontage('POST', '/analyze/scenes', req.body);
    res.status(status).json(data);
  } catch (err) {
    next(err);
  }
});


// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ
// AI-Р“Р•РќР•Р РђР¦РРЇ РЎРљР РРџРўРђ
// в”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓв”Ѓ

router.post('/ai-generate', async (req, res, next) => {
  try {
    if (!isConnected())
      return res.status(503).json({ ok: false, error: 'Р‘Р” РЅРµРґРѕСЃС‚СѓРїРЅР°' });

    const { prompt, duration = 30, aspect = '9:16', style = 'dynamic' } = req.body;
    if (!prompt || !prompt.trim())
      return res.status(400).json({ ok: false, error: 'РџРѕР»Рµ prompt РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ' });

    // РќР°СЃС‚СЂРѕР№РєРё AI РёР· Р‘Р”
    const { rows } = await query(
      `SELECT key, value FROM app_settings WHERE key IN ('ai_api_key','ai_base_url','ai_model')`
    );
    const settings  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const apiKey    = settings.ai_api_key;
    const baseUrl   = settings.ai_base_url || 'https://gptunnel.ru/v1';
    const model     = settings.ai_model    || 'gpt-4o-mini';

    if (!apiKey)
      return res.status(400).json({ ok: false, error: 'AI API РєР»СЋС‡ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ' });

    const resolution = aspect === '9:16' ? '1080x1920' : aspect === '1:1' ? '1080x1080' : '1920x1080';
    const sceneCount = Math.max(3, Math.floor(duration / 5));

    const systemPrompt =
      `РўС‹ РїСЂРѕС„РµСЃСЃРёРѕРЅР°Р»СЊРЅС‹Р№ РІРёРґРµРѕСЂРµРґР°РєС‚РѕСЂ. РЎРѕР·РґР°Р№ JSON-СЃРєСЂРёРїС‚ РјРѕРЅС‚Р°Р¶Р° РїРѕ РѕРїРёСЃР°РЅРёСЋ.
Р’РµСЂРЅРё РўРћР›Р¬РљРћ JSON РѕР±СЉРµРєС‚ Р±РµР· markdown-Р±Р»РѕРєРѕРІ:
{
  "output": { "resolution": "${resolution}", "fps": 30, "format": "mp4", "duration": ${duration} },
  "tracks": [
    {
      "id": "text",
      "type": "text",
      "clips": [
        {
          "id": "c1",
          "text": "РўРµРєСЃС‚ РєР»РёРїР°",
          "start": 0,
          "duration": 3,
          "trim_start": 0,
          "keyframes": [],
          "style": {
            "font": "DejaVu Sans", "size": 64, "color": "#FFFFFF",
            "bg_color": "#000000", "bg_opacity": 0.7,
            "position": "center", "animation": "fade"
          }
        }
      ]
    }
  ]
}
РЎРѕР·РґР°Р№ РјРёРЅРёРјСѓРј ${sceneCount} С‚РµРєСЃС‚РѕРІС‹С… РєР»РёРїРѕРІ СЃ С†РµРїР»СЏСЋС‰РёРј РєРѕРїРёСЂР°Р№С‚РёРЅРіРѕРј.
Р Р°СЃРїСЂРµРґРµР»Рё РєР»РёРїС‹ СЂР°РІРЅРѕРјРµСЂРЅРѕ РЅР° ${duration} СЃРµРєСѓРЅРґ. РЎС‚РёР»СЊ: ${style}. Р¤РѕСЂРјР°С‚: ${aspect}.`;

    const resp = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 45000,
      }
    );

    let scriptJson;
    try {
      scriptJson = JSON.parse(resp.data.choices[0].message.content);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI РІРµСЂРЅСѓР» РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON' });
    }

    res.json({ ok: true, data: scriptJson });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════
// GET /api/montage/renders — list of completed render videos
// ═══════════════════════════════════════════════════════
router.get('/renders', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [] });
    const { rows } = await query(
      `SELECT id, file_key, file_name, created_at
       FROM media_files
       WHERE source = 'montage_render'
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || 'https://k-m-m.ru';
    const data = rows.map(r => ({
      ...r,
      url: `${PUBLIC_BASE}/api/media/public/${r.file_key}`
    }));
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});


module.exports = router;
