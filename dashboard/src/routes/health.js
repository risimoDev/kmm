// ─── Health Check ───
// GET /api/health — Статус сервисов

const { Router } = require('express');
const { isConnected } = require('../db');

const router = Router();
const START_TIME = Date.now();

router.get('/', async (req, res) => {
  const uptime = Math.floor((Date.now() - START_TIME) / 1000);

  const health = {
    ok: true,
    version: process.env.npm_package_version || '2.0.0',
    uptime,
    services: {
      database: isConnected(),
      minio: await checkMinio(),
      n8n: await checkN8N()
    }
  };

  health.ok = Object.values(health.services).every(Boolean);

  res.status(health.ok ? 200 : 503).json(health);
});

async function checkMinio() {
  try {
    const { Client } = require('minio');
    const client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'minio',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
      secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin'
    });
    await client.listBuckets();
    return true;
  } catch {
    return false;
  }
}

async function checkN8N() {
  try {
    const resp = await fetch(`${process.env.N8N_URL || 'http://n8n:5678'}/healthz`, {
      signal: AbortSignal.timeout(3000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = router;
