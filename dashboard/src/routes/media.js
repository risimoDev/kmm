// ─── Media Routes ───
// GET    /api/media              — Список файлов из MinIO
// POST   /api/media/upload       — Загрузить файл
// DELETE /api/media/:id          — Удалить файл

const { Router } = require('express');
const multer = require('multer');
const { Client: MinioClient } = require('minio');
const crypto = require('crypto');
const path = require('path');
const { query, isConnected } = require('../db');

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

    // Генерируем presigned URL + internal URL для N8N
    const presignedUrl = await minio.presignedGetObject(BUCKET, fileKey, 24 * 3600);
    // Internal URL для Docker-сети (N8N использует это)
    const internalUrl = `http://minio:9000/${BUCKET}/${fileKey}`;

    res.status(201).json({
      ok: true,
      data: {
        id: result.rows[0].id,
        fileKey,
        fileName: file.originalname,
        fileType,
        fileSize: file.size,
        url: presignedUrl,
        internalUrl
      }
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

module.exports = router;
