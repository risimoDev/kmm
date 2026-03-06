// ─── Media Routes ───
// GET    /api/media              — Список файлов из MinIO
// GET    /api/media/public/*     — Публичный прокси файлов (без auth, для внешних API)
// POST   /api/media/upload       — Загрузить файл
// DELETE /api/media/:id          — Удалить файл

const { Router } = require('express');
const multer = require('multer');
const { Client: MinioClient } = require('minio');
const crypto = require('crypto');
const path = require('path');
const { query, isConnected } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();

// ─── MinIO клиент ───
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin'
});

const BUCKET = process.env.MINIO_BUCKET || 'content-factory';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://k-m-m.ru';

// Создаём bucket если нет
(async () => {
  try {
    const exists = await minio.bucketExists(BUCKET);
    if (!exists) {
      await minio.makeBucket(BUCKET);
      console.log(`✅ MinIO bucket "${BUCKET}" created`);
    }
  } catch (err) {
    console.warn('⚠️  MinIO not available:', err.message);
  }
})();

// Multer: загрузка в память (для передачи в MinIO)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },  // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ─── Публичный прокси файлов из MinIO (без auth — для GPTunnel и других внешних API) ───
router.get('/public/*', async (req, res, next) => {
  try {
    const fileKey = req.params[0];
    if (!fileKey) return res.status(400).json({ error: 'File key required' });

    // Безопасность: только разрешённые расширения
    const allowedExt = /\.(jpg|jpeg|png|webp|gif|mp4|mp3|wav|pdf)$/i;
    if (!allowedExt.test(fileKey)) {
      return res.status(403).json({ error: 'File type not allowed' });
    }

    const stat = await minio.statObject(BUCKET, fileKey);
    res.set('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    res.set('Content-Length', stat.size);
    res.set('Cache-Control', 'public, max-age=86400');

    const stream = await minio.getObject(BUCKET, fileKey);
    stream.pipe(res);
  } catch (err) {
    if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
      return res.status(404).json({ error: 'File not found' });
    }
    next(err);
  }
});

// ─── Все остальные маршруты требуют auth ───
router.use(authMiddleware);

// ─── Список файлов ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.json({ ok: true, data: [] });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const fileType = req.query.type;

    let where = '';
    const params = [];
    let paramIdx = 1;

    if (fileType) {
      where = `WHERE file_type = $${paramIdx++}`;
      params.push(fileType);
    }

    const result = await query(
      `SELECT id, session_id, file_key, file_name, file_type, mime_type,
              file_size, source, metadata, created_at
       FROM media_files ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    // Генерируем presigned URLs
    const data = await Promise.all(
      result.rows.map(async (file) => {
        try {
          const url = await minio.presignedGetObject(BUCKET, file.file_key, 3600);
          return { ...file, url };
        } catch {
          return { ...file, url: null };
        }
      })
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// ─── Загрузить файл ───
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Файл не загружен или недопустимый формат' });
    }

    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname) || '';
    const hash = crypto.randomBytes(8).toString('hex');
    const fileType = getFileType(file.mimetype);
    const fileKey = `${fileType}s/${Date.now()}-${hash}${ext}`;

    // Загружаем в MinIO
    await minio.putObject(BUCKET, fileKey, file.buffer, file.size, {
      'Content-Type': file.mimetype
    });

    // Сохраняем в БД
    const result = await query(
      `INSERT INTO media_files
         (user_id, session_id, file_key, file_name, file_type, mime_type, file_size, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'upload')
       RETURNING id`,
      [
        req.user?.id || null,
        req.body.sessionId || null,
        fileKey,
        file.originalname,
        fileType,
        file.mimetype,
        file.size
      ]
    );

    // Public URL для внешних API (GPTunnel и т.д.) — через наш прокси
    const publicUrl = `${PUBLIC_BASE_URL}/api/media/public/${fileKey}`;
    // Internal URL для Docker-сети (N8N может использовать напрямую)
    const internalUrl = `http://minio:9000/${BUCKET}/${fileKey}`;

    res.status(201).json({
      ok: true,
      fileKey,
      fileName: file.originalname,
      fileType,
      fileSize: file.size,
      publicUrl,
      internalUrl
    });
  } catch (err) {
    next(err);
  }
});

// ─── Удалить файл ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'Невалидный ID' });
    }

    const fileResult = await query(
      'SELECT file_key FROM media_files WHERE id = $1',
      [id]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Файл не найден' });
    }

    // Удаляем из MinIO
    try {
      await minio.removeObject(BUCKET, fileResult.rows[0].file_key);
    } catch {
      // Не критично если файл уже удалён из MinIO
    }

    // Удаляем из БД
    await query('DELETE FROM media_files WHERE id = $1', [id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ───
function getFileType(mimetype) {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

// ═══════════════════════════════════════════════════
// Music Library
// ═══════════════════════════════════════════════════

// Multer для музыки (только аудио)
const musicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/x-wav', 'audio/flac', 'audio/aac'];
    cb(null, allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|flac|aac)$/i));
  }
});

// ─── Список музыкальных треков ───
router.get('/music', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [] });

    const result = await query(
      `SELECT id, name, file_key, file_name, duration_sec, file_size, category, is_active, created_at
       FROM music_tracks WHERE is_active = true ORDER BY name ASC`
    );

    // Генерируем presigned URLs
    const data = await Promise.all(
      result.rows.map(async (track) => {
        try {
          const url = await minio.presignedGetObject(BUCKET, track.file_key, 3600);
          return { ...track, url };
        } catch {
          return { ...track, url: null };
        }
      })
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

// ─── Загрузить музыкальный трек ───
router.post('/music', authMiddleware, musicUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Файл не загружен или недопустимый формат (только mp3/wav/ogg/flac/aac)' });
    }
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const file = req.file;
    const ext = path.extname(file.originalname) || '.mp3';
    const hash = crypto.randomBytes(8).toString('hex');
    const fileKey = `music/${Date.now()}-${hash}${ext}`;
    const trackName = req.body.name || file.originalname.replace(/\.[^.]+$/, '');
    const category = req.body.category || 'общий';

    // Загружаем в MinIO
    await minio.putObject(BUCKET, fileKey, file.buffer, file.size, {
      'Content-Type': file.mimetype
    });

    // Сохраняем в БД
    const result = await query(
      `INSERT INTO music_tracks (name, file_key, file_name, file_size, category, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [trackName, fileKey, file.originalname, file.size, category, req.user?.id || null]
    );

    // Presigned URL
    const url = await minio.presignedGetObject(BUCKET, fileKey, 3600);

    res.status(201).json({
      ok: true,
      data: { ...result.rows[0], url }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Удалить музыкальный трек ───
router.delete('/music/:id', authMiddleware, async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ ok: false, error: 'Невалидный ID' });

    const fileResult = await query('SELECT file_key FROM music_tracks WHERE id = $1', [id]);
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Трек не найден' });
    }

    // Удаляем из MinIO
    try {
      await minio.removeObject(BUCKET, fileResult.rows[0].file_key);
    } catch { /* не критично */ }

    // Мягкое удаление
    await query('UPDATE music_tracks SET is_active = false WHERE id = $1', [id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
