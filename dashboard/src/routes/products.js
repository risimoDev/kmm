// ─── Products Routes ───
// GET    /api/products                   — Список продуктов
// GET    /api/products/factory-runs      — История factory-запусков
// GET    /api/products/:id               — Детали продукта
// POST   /api/products                   — Создать продукт
// PUT    /api/products/:id               — Обновить продукт
// DELETE /api/products/:id               — Удалить продукт
// POST   /api/products/:id/generate-idea — Сгенерировать идею/сценарий
// POST   /api/products/:id/generate-images — Сгенерировать фотореалистичные фото
// POST   /api/products/:id/run-pipeline  — Запустить полный пайплайн
// POST   /api/products/:id/factory-run   — 🏭 Запуск завода (автоматический конвейер)
// GET    /api/products/:id/runs          — Список запусков
// GET    /api/products/runs/:runId       — Детали запуска
// PUT    /api/products/runs/:runId/approve  — Одобрить
// PUT    /api/products/runs/:runId/reject   — Отклонить

const { Router } = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { Client: MinioClient } = require('minio');
const { query, isConnected } = require('../db');
const { emitToSession } = require('../socket');

const router = Router();
const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';

// ─── MinIO клиент (для сохранения сгенерированных фото) ───
const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin'
});
const BUCKET = process.env.MINIO_BUCKET || 'content-factory';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://k-m-m.ru';

// ─── Helper: получить настройки AI ───
async function getAISettings() {
  const result = await query(
    "SELECT key, value FROM app_settings WHERE category IN ('ai', 'tts', 'heygen', 'a2e', 'cards')"
  );
  const s = {};
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

// ═══════════════════════════════════════════════════
// PRODUCTS CRUD
// ═══════════════════════════════════════════════════

// ─── Список продуктов ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], total: 0 });

    const {
      status,
      search,
      limit = '50',
      offset = '0',
      sort = 'created_at',
      order = 'DESC'
    } = req.query;

    const allowedSort = ['id', 'created_at', 'name', 'status'];
    const allowedOrder = ['ASC', 'DESC'];
    const safeSort = allowedSort.includes(sort) ? sort : 'created_at';
    const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
    const safeLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*) as total FROM products p ${where}`, params
    );

    const dataResult = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM product_runs pr WHERE pr.product_id = p.id) as runs_count,
              (SELECT COUNT(*) FROM product_runs pr WHERE pr.product_id = p.id AND pr.status = 'ready_for_review') as pending_count
       FROM products p ${where}
       ORDER BY p.${safeSort} ${safeOrder}
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

// ─── История factory-запусков (BEFORE /:id to avoid route conflict) ───
router.get('/factory-runs', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [] });
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await query(
      `SELECT pr.*, p.name AS product_name,
              ps.final_video_url AS pipeline_video_url
       FROM product_runs pr
       LEFT JOIN products p ON p.id = pr.product_id
       LEFT JOIN pipeline_sessions ps ON ps.id = pr.session_id
       WHERE pr.current_step != 'created' OR pr.status != 'created'
       ORDER BY pr.created_at DESC LIMIT $1`, [limit]
    );
    res.json({ ok: true, data: result.rows });
  } catch (err) { next(err); }
});

// ─── Детали продукта ───
router.get('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Продукт не найден' });
    }

    // Последние запуски
    const runsResult = await query(
      `SELECT * FROM product_runs WHERE product_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );

    res.json({
      ok: true,
      data: {
        ...result.rows[0],
        runs: runsResult.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── Создать продукт ───
router.post('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const {
      name, description, characteristics = [],
      photos = [],
      heygen_avatar_id, heygen_voice_id,
      a2e_avatar_id, a2e_voice_id,
      tts_voice_id, video_provider = 'heygen'
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Название продукта обязательно' });
    }

    const result = await query(
      `INSERT INTO products
        (name, description, characteristics, photos,
         heygen_avatar_id, heygen_voice_id,
         a2e_avatar_id, a2e_voice_id,
         tts_voice_id, video_provider, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        name.trim(),
        description || '',
        JSON.stringify(characteristics),
        JSON.stringify(photos),
        heygen_avatar_id || null,
        heygen_voice_id || null,
        a2e_avatar_id || null,
        a2e_voice_id || null,
        tts_voice_id || null,
        video_provider,
        req.user?.id || null
      ]
    );

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить продукт ───
router.put('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const {
      name, description, characteristics, photos,
      heygen_avatar_id, heygen_voice_id,
      a2e_avatar_id, a2e_voice_id,
      tts_voice_id, video_provider, status
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined)             { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (description !== undefined)      { fields.push(`description = $${idx++}`); values.push(description); }
    if (characteristics !== undefined)  { fields.push(`characteristics = $${idx++}`); values.push(JSON.stringify(characteristics)); }
    if (photos !== undefined)           { fields.push(`photos = $${idx++}`); values.push(JSON.stringify(photos)); }
    if (heygen_avatar_id !== undefined) { fields.push(`heygen_avatar_id = $${idx++}`); values.push(heygen_avatar_id); }
    if (heygen_voice_id !== undefined)  { fields.push(`heygen_voice_id = $${idx++}`); values.push(heygen_voice_id); }
    if (a2e_avatar_id !== undefined)    { fields.push(`a2e_avatar_id = $${idx++}`); values.push(a2e_avatar_id); }
    if (a2e_voice_id !== undefined)     { fields.push(`a2e_voice_id = $${idx++}`); values.push(a2e_voice_id); }
    if (tts_voice_id !== undefined)     { fields.push(`tts_voice_id = $${idx++}`); values.push(tts_voice_id); }
    if (video_provider !== undefined)   { fields.push(`video_provider = $${idx++}`); values.push(video_provider); }
    if (status !== undefined)           { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Продукт не найден' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Удалить продукт ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });
    const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Продукт не найден' });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
// AI PIPELINE
// ═══════════════════════════════════════════════════

// ─── Сгенерировать SRT субтитры по сценарию ───
router.post('/:id/generate-srt', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const product = (await query('SELECT id, name FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Продукт не найден' });

    const { script_text } = req.body;
    if (!script_text || !script_text.trim()) {
      return res.status(400).json({ ok: false, error: 'script_text обязателен' });
    }

    const settings = await getAISettings();
    const apiKey = settings.ai_api_key;
    const baseUrl = settings.ai_base_url || 'https://gptunnel.ru/v1';
    const model = settings.ai_model || 'gpt-4o';
    const authPrefix = settings.ai_auth_prefix || '';

    if (!apiKey) {
      // Если нет AI — генерируем SRT простым алгоритмом (равномерное распределение)
      const srt = generateSRTSimple(script_text);
      return res.json({ ok: true, data: { srt, method: 'simple' } });
    }

    const authHeader = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;

    const prompt = `Ты — профессиональный создатель субтитров для видео.
Тебе дан сценарий озвучки видео. Создай SRT субтитры.

Правила:
- Видео длится примерно ${Math.ceil(script_text.split(/\s+/).length / 2.5)} секунд (считай ~2.5 слова в секунду)
- Каждый субтитр 2-6 слов, читается 1.5-3.5 секунды
- Субтитр должен заканчиваться на границе слова или предложения
- Формат: строго SRT (номер, временной код, текст, пустая строка)

Сценарий:
"""
${script_text}
"""

Верни ТОЛЬКО SRT файл, без комментариев, без markdown-блоков.`;

    try {
      const aiResp = await axios.post(`${baseUrl}/chat/completions`, {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }, {
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        timeout: 45000
      });

      const srt = aiResp.data.choices?.[0]?.message?.content?.trim() || '';
      // Очищаем markdown-блоки если AI вдруг обернул
      const cleanSrt = srt.replace(/^```[^\n]*\n?/m, '').replace(/```\s*$/m, '').trim();
      return res.json({ ok: true, data: { srt: cleanSrt, method: 'ai' } });
    } catch (aiErr) {
      console.warn('[generate-srt] AI failed, using simple algo:', aiErr.message);
      const srt = generateSRTSimple(script_text);
      return res.json({ ok: true, data: { srt, method: 'simple' } });
    }
  } catch (err) {
    next(err);
  }
});

// Простой алгоритм SRT без AI (~2.5 слова/сек, блоки по 5 слов)
function generateSRTSimple(text) {
  const words = text.trim().split(/\s+/);
  const WORDS_PER_BLOCK = 5;
  const SEC_PER_WORD = 0.4; // ~2.5 слов/сек
  let idx = 1;
  let lines = [];
  for (let i = 0; i < words.length; i += WORDS_PER_BLOCK) {
    const chunk = words.slice(i, i + WORDS_PER_BLOCK).join(' ');
    const startSec = i * SEC_PER_WORD;
    const endSec = Math.min((i + WORDS_PER_BLOCK) * SEC_PER_WORD, words.length * SEC_PER_WORD + 0.5);
    lines.push(`${idx}`);
    lines.push(`${fmtSRTTime(startSec)} --> ${fmtSRTTime(endSec)}`);
    lines.push(chunk);
    lines.push('');
    idx++;
  }
  return lines.join('\n');
}

function fmtSRTTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// ─── Сгенерировать идею и сценарий ───
router.post('/:id/generate-idea', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const product = (await query('SELECT * FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Продукт не найден' });

    const settings = await getAISettings();
    const apiKey = settings.ai_api_key;
    const baseUrl = settings.ai_base_url || 'https://gptunnel.ru/v1';
    const model = settings.ai_model || 'gpt-4o';
    const authPrefix = settings.ai_auth_prefix || '';

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'API ключ AI не настроен (Настройки → AI)' });
    }

    const chars = Array.isArray(product.characteristics) ? product.characteristics : [];
    const charsText = chars.map(c => `- ${c.name || c}: ${c.value || ''}`).join('\n');

    const prompt = `Ты — креативный маркетолог и сценарист рекламных видео.

Продукт: ${product.name}
Описание: ${product.description || 'нет'}
Характеристики:
${charsText || 'не указаны'}

Создай:
1. **Идею** для короткого рекламного видео (30-60 секунд, формат Reels/Shorts/TikTok)
2. **Сценарий озвучки** — текст, который будет озвучен голосом аватара. 50-100 слов.
3. **Визуальное описание** — какие сцены и фотографии продукта показать.

Ответ строго в JSON:
{
  "idea": "краткое описание идеи видео",
  "script": "текст сценария для озвучки",
  "visual_description": "описание визуального ряда",
  "hook": "цепляющая фраза для начала"
}`;

    const authHeader = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;

    const aiResponse = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      messages: [
        { role: 'system', content: settings.ai_system_prompt || 'Ты — креативный маркетолог.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' }
    }, {
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      timeout: 60000
    });

    const content = aiResponse.data.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { idea: content, script: '', visual_description: '', hook: '' };
    }

    res.json({ ok: true, data: parsed });
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({
        ok: false,
        error: `AI API error: ${err.response.data?.error?.message || err.message}`
      });
    }
    next(err);
  }
});

// ─── Сгенерировать фотореалистичные фото (img2img с референс-фото продукта) ───
router.post('/:id/generate-images', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const product = (await query('SELECT * FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Продукт не найден' });

    const settings = await getAISettings();
    const apiKey = settings.ai_api_key;
    const baseUrl = settings.ai_base_url || 'https://gptunnel.ru/v1';
    const authPrefix = settings.ai_auth_prefix || '';
    // Для img2img используем flux-kontext-pro если не задан другой img2img-capable model
    const configuredModel = settings.card_image_model || 'flux-kontext-pro';
    const IMG2IMG_MODELS = ['flux-kontext-pro', 'gpt-image-1', 'gpt-image-1-low', 'gpt-image-1-medium', 'gpt-image-1-high'];
    const imageModel = IMG2IMG_MODELS.includes(configuredModel) ? configuredModel : 'flux-kontext-pro';

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'API ключ AI не настроен' });
    }

    const {
      prompt_extra = '',
      style = 'photorealistic',
      concept = 'studio',
      count = 2,
      reference_photo = null   // URL референс-фото (необязательно — берётся первое фото продукта)
    } = req.body;
    const safeCount = Math.min(Math.max(parseInt(count) || 1, 1), 4);

    const photos = Array.isArray(product.photos) ? product.photos : [];
    const refPhoto = reference_photo || photos[0] || null;

    const chars = Array.isArray(product.characteristics) ? product.characteristics : [];
    const charsText = chars.map(c => `${c.name || c}: ${c.value || ''}`).join(', ');

    // Концептуальные инструкции для разных стилей
    const conceptInstructions = {
      studio:    'Clean white/neutral studio background, professional product photography lighting, soft shadows, minimalist composition. Add subtle feature callout badges around the product.',
      lifestyle: 'Natural lifestyle setting relevant to the product category. Warm realistic lighting, authentic everyday environment. The product is the hero of the scene.',
      flatlay:   'Overhead flat-lay composition on a stylish surface. Complementary props arranged artistically around the product. Editorial product photography.',
      minimal:   'Ultra-minimalist background with a single accent color. Extreme clean aesthetic, generous white space, simple elegant composition.',
      luxury:    'Premium luxury setting with dark moody tones or rich materials (marble, velvet, gold). High-end commercial photography with dramatic lighting.'
    };
    const conceptStyle = conceptInstructions[concept] || conceptInstructions.studio;

    // Промпт: если есть референс-фото — описываем окружение/стиль (модель видит товар сама)
    // Если нет — text-to-image с описанием товара
    let imagePrompt;
    if (refPhoto) {
      imagePrompt = `Photorealistic commercial product photo. ${conceptStyle} The product must remain EXACTLY as shown in the reference — do not alter its shape, color, or details. 9:16 vertical format, high quality. ${prompt_extra}`.trim();
    } else {
      imagePrompt = `Photorealistic advertising photo of product "${product.name}". ${product.description || ''}. ${charsText ? 'Characteristics: ' + charsText + '.' : ''} Style: ${style}. ${conceptStyle} 9:16 vertical, high quality, commercial photography. ${prompt_extra}`.trim();
    }

    const authHeader = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;

    // Запускаем все задачи одновременно, потом поллингуем результаты
    const taskIds = [];
    for (let i = 0; i < safeCount; i++) {
      try {
        const body = {
          model: imageModel,
          prompt: imagePrompt,
          ar: '9:16'
        };
        // Передаём референс-фото как image (string) для img2img
        if (refPhoto) body.image = refPhoto;

        const createResp = await axios.post(`${baseUrl}/media/create`, body, {
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          timeout: 30000
        });

        const taskId = createResp.data?.id || createResp.data?.task_id;
        // Некоторые модели возвращают URL сразу (синхронно)
        const directUrl = createResp.data?.url || createResp.data?.image_url
                       || createResp.data?.data?.[0]?.url;

        if (directUrl) {
          taskIds.push({ taskId: null, url: directUrl });
        } else if (taskId) {
          taskIds.push({ taskId, url: null });
        }
      } catch (createErr) {
        console.error(`Image create ${i + 1} failed:`, createErr.message);
      }
    }

    if (!taskIds.length) {
      return res.json({ ok: false, error: 'Не удалось запустить генерацию изображений. Проверьте API ключ и баланс.' });
    }

    // Поллинг задач (до 90 сек, интервал 4 сек)
    const results = [];
    const pendingTasks = taskIds.filter(t => t.taskId && !t.url);
    // Уже готовые (синхронные) результаты
    taskIds.filter(t => t.url).forEach(t => results.push(t.url));

    const MAX_POLLS = 22;
    const POLL_INTERVAL = 4000;

    for (let poll = 0; poll < MAX_POLLS && pendingTasks.length > 0; poll++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      const stillPending = [];
      for (const task of pendingTasks) {
        try {
          const resultResp = await axios.post(`${baseUrl}/media/result`, {
            task_id: task.taskId
          }, {
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            timeout: 15000
          });

          const d = resultResp.data;
          const status = (d.status || '').toLowerCase();
          const url = d.url || d.image_url || d.data?.[0]?.url;

          if ((status === 'done' || status === 'completed' || status === 'success') && url) {
            results.push(url);
          } else if (status === 'failed' || status === 'error') {
            console.error(`Task ${task.taskId} failed:`, d.error || d.message || 'unknown');
          } else {
            stillPending.push(task);
          }
        } catch (pollErr) {
          console.error(`Poll task ${task.taskId}:`, pollErr.message);
          stillPending.push(task);
        }
      }
      pendingTasks.length = 0;
      pendingTasks.push(...stillPending);
    }

    // Скачать сгенерированные фото в MinIO для постоянного хранения
    const savedImages = [];
    for (const url of results) {
      try {
        const imgResp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        const buf = Buffer.from(imgResp.data);
        const hash = crypto.randomBytes(8).toString('hex');
        const fileKey = `images/${Date.now()}-${hash}.jpg`;
        await minio.putObject(BUCKET, fileKey, buf, buf.length, { 'Content-Type': 'image/jpeg' });
        if (isConnected()) {
          await query(
            `INSERT INTO media_files (user_id, file_key, file_name, file_type, mime_type, file_size, source)
             VALUES ($1, $2, $3, 'image', 'image/jpeg', $4, 'product-gen')`,
            [req.user?.id || null, fileKey, `product-${concept}-${hash}.jpg`, buf.length]
          );
        }
        savedImages.push(`${PUBLIC_BASE_URL}/api/media/public/${fileKey}`);
      } catch (saveErr) {
        console.warn('[generate-images] save to MinIO failed, using original URL:', saveErr.message);
        savedImages.push(url);
      }
    }

    res.json({
      ok: true,
      data: {
        images: savedImages,
        count: savedImages.length,
        model: imageModel,
        has_reference: !!refPhoto,
        concept
      }
    });
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({
        ok: false,
        error: `Image API error: ${err.response.data?.error?.message || err.message}`
      });
    }
    next(err);
  }
});

// ─── Запустить полный пайплайн ───
router.post('/:id/run-pipeline', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const product = (await query('SELECT * FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Продукт не найден' });

    const {
      idea_text,
      script_text,
      subtitles_enabled = true,
      music_track_id,
      video_provider
    } = req.body;

    if (!script_text) {
      return res.status(400).json({ ok: false, error: 'script_text обязателен' });
    }

    const provider = video_provider || product.video_provider || 'heygen';

    // Создать запись запуска
    const runResult = await query(
      `INSERT INTO product_runs
        (product_id, status, current_step, idea_text, script_text,
         heygen_avatar_id, heygen_voice_id,
         a2e_avatar_id, a2e_voice_id,
         video_provider, subtitles_enabled, music_track_id, created_by)
       VALUES ($1, 'created', 'created', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        product.id,
        idea_text || '',
        script_text,
        product.heygen_avatar_id || null,
        product.heygen_voice_id || null,
        product.a2e_avatar_id || null,
        product.a2e_voice_id || null,
        provider,
        subtitles_enabled !== false,
        music_track_id || null,
        req.user?.id || null
      ]
    );

    const run = runResult.rows[0];

    // Подготовить фото продукта
    const photos = Array.isArray(product.photos) ? product.photos : [];
    const mainPhoto = photos[0] || '';

    // Создать pipeline_session для совместимости с существующей инфраструктурой
    const sessionResult = await query(
      `INSERT INTO pipeline_sessions
        (user_id, source, status, current_step, product_name, product_image_url,
         video_type, subtitles_enabled, music_track_id)
       VALUES ($1, 'product', 'created', 'created', $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        req.user?.id || null,
        product.name,
        mainPhoto,
        provider === 'heygen' ? 'heygen' : 'a2e',
        subtitles_enabled !== false,
        music_track_id || null
      ]
    );

    const sessionId = sessionResult.rows[0].id;
    await query('UPDATE product_runs SET session_id = $1 WHERE id = $2', [sessionId, run.id]);

    // Сохранить сценарий в voice_scripts и привязать к сессии
    // (N8N воркфлоу HeyGen загружает script_text через JOIN voice_scripts)
    const wordCount = script_text.trim().split(/\s+/).length;
    const durationHint = Math.ceil(wordCount / 2.5);
    const vsResult = await query(
      `INSERT INTO voice_scripts (idea_id, script_text, word_count, duration_hint, timing_marks, montage_script, status)
       VALUES (NULL, $1, $2, $3, '[]'::jsonb, '[]'::jsonb, 'approved')
       RETURNING id`,
      [script_text, wordCount, durationHint]
    );
    await query('UPDATE pipeline_sessions SET voice_script_id = $1 WHERE id = $2', [vsResult.rows[0].id, sessionId]);

    // Определить webhook URL
    const webhookUrl = provider === 'heygen'
      ? `${N8N_URL}/webhook/video-factory-heygen`
      : `${N8N_URL}/webhook/video-factory-a2e-product`;

    // Музыкальный трек
    let musicFileKey = '';
    if (music_track_id) {
      const musicResult = await query('SELECT file_key FROM music_tracks WHERE id = $1 AND is_active = true', [music_track_id]);
      if (musicResult.rows.length > 0) musicFileKey = musicResult.rows[0].file_key;
    }

    const webhookPayload = {
      session_id: sessionId,
      product_run_id: run.id,
      product_id: product.id,
      product_name: product.name,
      product_description: product.description || '',
      product_image_url: mainPhoto,
      product_photos: photos,
      script_text,
      idea_text: idea_text || '',
      video_type: provider === 'heygen' ? 'heygen' : 'a2e_product',
      subtitles_enabled: subtitles_enabled !== false,
      music_file_key: musicFileKey,
      music_volume: 0.15
    };

    if (provider === 'heygen') {
      webhookPayload.heygen_avatar_id = product.heygen_avatar_id || '';
      webhookPayload.heygen_voice_id = product.heygen_voice_id || '';
      webhookPayload.heygen_background = '#00FF00';
      webhookPayload.heygen_ratio = '9:16';
    } else {
      webhookPayload.a2e_avatar_id = product.a2e_avatar_id || '';
      webhookPayload.a2e_voice_id = product.a2e_voice_id || '';
    }

    try {
      await axios.post(webhookUrl, webhookPayload, { timeout: 15000 });
      await query("UPDATE product_runs SET status = 'generating_video', current_step = 'video' WHERE id = $1", [run.id]);
    } catch (n8nErr) {
      console.error('N8N trigger error (non-fatal):', n8nErr.message);
    }

    // WebSocket
    emitToSession(sessionId, 'product-run:created', { run: { ...run, session_id: sessionId } });
    emitToSession(null, 'product-run:created', { productId: product.id, runId: run.id });

    res.status(201).json({ ok: true, data: { ...run, session_id: sessionId } });
  } catch (err) {
    next(err);
  }
});

// ─── Список запусков продукта ───
router.get('/:id/runs', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [] });

    const result = await query(
      `SELECT pr.*, ps.final_video_url as pipeline_video_url, ps.status as pipeline_status
       FROM product_runs pr
       LEFT JOIN pipeline_sessions ps ON ps.id = pr.session_id
       WHERE pr.product_id = $1
       ORDER BY pr.created_at DESC`,
      [req.params.id]
    );

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Детали запуска ───
router.get('/runs/:runId', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const result = await query(
      `SELECT pr.*, p.name as product_name, p.photos as product_photos,
              ps.final_video_url as pipeline_video_url, ps.status as pipeline_status,
              ps.raw_video_url, ps.voice_file_url, ps.thumbnail_url
       FROM product_runs pr
       LEFT JOIN products p ON p.id = pr.product_id
       LEFT JOIN pipeline_sessions ps ON ps.id = pr.session_id
       WHERE pr.id = $1`,
      [req.params.runId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Запуск не найден' });
    }

    // Шаги пайплайна
    const run = result.rows[0];
    let steps = [];
    if (run.session_id) {
      const stepsResult = await query(
        'SELECT * FROM pipeline_steps WHERE session_id = $1 ORDER BY step_order ASC',
        [run.session_id]
      );
      steps = stepsResult.rows;
    }

    res.json({ ok: true, data: { ...run, steps } });
  } catch (err) {
    next(err);
  }
});

// ─── Одобрить запуск ───
router.put('/runs/:runId/approve', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const result = await query(
      `UPDATE product_runs SET status = 'approved' WHERE id = $1 RETURNING *`,
      [req.params.runId]
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Запуск не найден' });

    const run = result.rows[0];
    if (run.session_id) {
      await query("UPDATE pipeline_sessions SET status = 'approved' WHERE id = $1", [run.session_id]);
    }

    res.json({ ok: true, data: run });
  } catch (err) {
    next(err);
  }
});

// ─── Отклонить запуск ───
router.put('/runs/:runId/reject', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const result = await query(
      `UPDATE product_runs SET status = 'cancelled', error_message = $2 WHERE id = $1 RETURNING *`,
      [req.params.runId, req.body.reason || 'Отклонено']
    );
    if (result.rows.length === 0) return res.status(404).json({ ok: false, error: 'Запуск не найден' });

    const run = result.rows[0];
    if (run.session_id) {
      await query("UPDATE pipeline_sessions SET status = 'rejected' WHERE id = $1", [run.session_id]);
    }

    res.json({ ok: true, data: run });
  } catch (err) {
    next(err);
  }
});

// ─── Пакетный запуск пайплайна ───
router.post('/batch-run', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { product_ids = [], script_text, subtitles_enabled = true, music_track_id } = req.body;

    if (!product_ids.length) {
      return res.status(400).json({ ok: false, error: 'Нужно выбрать хотя бы один продукт' });
    }
    if (!script_text) {
      return res.status(400).json({ ok: false, error: 'script_text обязателен' });
    }

    const results = [];
    for (const productId of product_ids.slice(0, 20)) {
      try {
        const product = (await query('SELECT * FROM products WHERE id = $1', [productId])).rows[0];
        if (!product) continue;

        const provider = product.video_provider || 'heygen';
        const photos = Array.isArray(product.photos) ? product.photos : [];

        const runResult = await query(
          `INSERT INTO product_runs
            (product_id, status, current_step, script_text,
             heygen_avatar_id, heygen_voice_id,
             a2e_avatar_id, a2e_voice_id,
             video_provider, subtitles_enabled, music_track_id, created_by)
           VALUES ($1, 'created', 'created', $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            product.id, script_text,
            product.heygen_avatar_id, product.heygen_voice_id,
            product.a2e_avatar_id, product.a2e_voice_id,
            provider, subtitles_enabled, music_track_id || null,
            req.user?.id || null
          ]
        );

        const run = runResult.rows[0];

        // Создать pipeline_session
        const sessionResult = await query(
          `INSERT INTO pipeline_sessions
            (user_id, source, status, current_step, product_name,
             product_image_url, video_type, subtitles_enabled, music_track_id)
           VALUES ($1, 'product', 'created', 'created', $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            req.user?.id || null, product.name, photos[0] || '',
            provider === 'heygen' ? 'heygen' : 'a2e',
            subtitles_enabled, music_track_id || null
          ]
        );
        await query('UPDATE product_runs SET session_id = $1 WHERE id = $2', [sessionResult.rows[0].id, run.id]);

        // Trigger N8N
        const webhookUrl = provider === 'heygen'
          ? `${N8N_URL}/webhook/video-factory-heygen`
          : `${N8N_URL}/webhook/video-factory-a2e-product`;

        let musicFileKey = '';
        if (music_track_id) {
          const mr = await query('SELECT file_key FROM music_tracks WHERE id = $1 AND is_active = true', [music_track_id]);
          if (mr.rows.length > 0) musicFileKey = mr.rows[0].file_key;
        }

        const payload = {
          session_id: sessionResult.rows[0].id,
          product_run_id: run.id,
          product_id: product.id,
          product_name: product.name,
          product_description: product.description || '',
          product_image_url: photos[0] || '',
          product_photos: photos,
          script_text,
          video_type: provider === 'heygen' ? 'heygen' : 'a2e_product',
          subtitles_enabled,
          music_file_key: musicFileKey,
          music_volume: 0.15
        };

        if (provider === 'heygen') {
          payload.heygen_avatar_id = product.heygen_avatar_id || '';
          payload.heygen_voice_id = product.heygen_voice_id || '';
          payload.heygen_background = '#00FF00';
          payload.heygen_ratio = '9:16';
        } else {
          payload.a2e_avatar_id = product.a2e_avatar_id || '';
          payload.a2e_voice_id = product.a2e_voice_id || '';
        }

        try {
          await axios.post(webhookUrl, payload, { timeout: 15000 });
        } catch (n8nErr) {
          console.error(`Batch N8N error for product ${product.id}:`, n8nErr.message);
        }

        results.push({ product_id: product.id, run_id: run.id, session_id: sessionResult.rows[0].id });
      } catch (prodErr) {
        console.error(`Batch error for product ${productId}:`, prodErr.message);
        results.push({ product_id: productId, error: prodErr.message });
      }
    }

    emitToSession(null, 'product-batch:started', { count: results.length });

    res.json({ ok: true, data: results, total: results.length });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
// 🏭 FACTORY — полный автоматический конвейер
// ═══════════════════════════════════════════════════

// ─── Запуск завода (полный автоматический пайплайн) ───
router.post('/:id/factory-run', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const product = (await query('SELECT * FROM products WHERE id = $1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ ok: false, error: 'Продукт не найден' });

    const {
      concept = 'studio',
      image_count = 2,
      subtitles_enabled = true,
      auto_publish = false,
      publish_channels = []
    } = req.body;

    const provider = product.video_provider || 'heygen';
    const photos = Array.isArray(product.photos) ? product.photos : [];
    const mainPhoto = photos[0] || '';

    // 1. Создать запись запуска
    const runResult = await query(
      `INSERT INTO product_runs
        (product_id, status, current_step,
         heygen_avatar_id, heygen_voice_id,
         a2e_avatar_id, a2e_voice_id,
         video_provider, subtitles_enabled, created_by)
       VALUES ($1, 'generating_idea', 'idea', $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        product.id,
        product.heygen_avatar_id || null,
        product.heygen_voice_id || null,
        product.a2e_avatar_id || null,
        product.a2e_voice_id || null,
        provider,
        subtitles_enabled !== false,
        req.user?.id || null
      ]
    );
    const run = runResult.rows[0];
    const runId = run.id;

    // Emit initial step
    emitToSession(null, 'factory:step', { run_id: runId, step: 'idea' });

    // Respond immediately — rest is async
    res.status(201).json({ ok: true, data: { run_id: runId, status: 'generating_idea' } });

    // ===== ASYNC PIPELINE (fire-and-forget) =====
    (async () => {
      let currentFactoryStep = 'idea';
      try {
        const settings = await getAISettings();
        const apiKey = settings.ai_api_key;
        const baseUrl = settings.ai_base_url || 'https://gptunnel.ru/v1';
        const model = settings.ai_model || 'gpt-4o';
        const authPrefix = settings.ai_auth_prefix || '';
        const authHeader = authPrefix ? `${authPrefix} ${apiKey}` : apiKey;

        if (!apiKey) throw new Error('API ключ AI не настроен (Настройки → AI)');

        // ── STEP 1: Генерация идеи и сценария ──
        const chars = Array.isArray(product.characteristics) ? product.characteristics : [];
        const charsText = chars.map(c => `${c.name || c}: ${c.value || ''}`).join('\n');

        const ideaPrompt = `Ты — креативный маркетолог и сценарист рекламных видео.

Продукт: ${product.name}
Описание: ${product.description || 'нет'}
Характеристики:
${charsText || 'не указаны'}

Создай:
1. **Идею** для короткого рекламного видео (30-60 секунд, формат Reels/Shorts/TikTok)
2. **Сценарий озвучки** — текст, который будет озвучен голосом аватара. 50-100 слов.
3. **Визуальное описание** — какие сцены и фотографии продукта показать.

Ответ строго в JSON:
{
  "idea": "краткое описание идеи видео",
  "script": "текст сценария для озвучки",
  "visual_description": "описание визуального ряда",
  "hook": "цепляющая фраза для начала"
}`;

        const aiResp = await axios.post(`${baseUrl}/chat/completions`, {
          model,
          messages: [
            { role: 'system', content: settings.ai_system_prompt || 'Ты — креативный маркетолог.' },
            { role: 'user', content: ideaPrompt }
          ],
          temperature: 0.8,
          response_format: { type: 'json_object' }
        }, {
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
          timeout: 60000
        });

        const content = aiResp.data.choices?.[0]?.message?.content;
        let idea;
        try { idea = JSON.parse(content); } catch { idea = { idea: content, script: '', visual_description: '', hook: '' }; }

        const scriptText = idea.script || idea.idea || '';
        const ideaText = idea.idea || '';

        if (!scriptText) throw new Error('AI не сгенерировал сценарий');

        await query(
          "UPDATE product_runs SET status = 'generating_images', current_step = 'images', idea_text = $1, script_text = $2 WHERE id = $3",
          [ideaText, scriptText, runId]
        );
        emitToSession(null, 'factory:step', { run_id: runId, step: 'images' });
        currentFactoryStep = 'images';

        // ── STEP 2: Генерация фотографий ──
        let generatedImages = [];
        if (mainPhoto) {
          const configuredModel = settings.card_image_model || 'flux-kontext-pro';
          const IMG2IMG_MODELS = ['flux-kontext-pro', 'gpt-image-1', 'gpt-image-1-low', 'gpt-image-1-medium', 'gpt-image-1-high'];
          const imageModel = IMG2IMG_MODELS.includes(configuredModel) ? configuredModel : 'flux-kontext-pro';

          const conceptInstructions = {
            studio:    'Clean white/neutral studio background, professional product photography lighting, soft shadows, minimalist composition.',
            lifestyle: 'Natural lifestyle setting relevant to the product category. Warm realistic lighting, authentic everyday environment.',
            flatlay:   'Overhead flat-lay composition on a stylish surface. Complementary props arranged artistically around the product.',
            minimal:   'Ultra-minimalist background with a single accent color. Extreme clean aesthetic, generous white space.',
            luxury:    'Premium luxury setting with dark moody tones or rich materials. High-end commercial photography with dramatic lighting.'
          };
          const conceptStyle = conceptInstructions[concept] || conceptInstructions.studio;
          const imagePrompt = `Photorealistic commercial product photo. ${conceptStyle} The product must remain EXACTLY as shown in the reference — do not alter its shape, color, or details. 9:16 vertical format, high quality.`;

          const safeCount = Math.min(Math.max(parseInt(image_count) || 2, 1), 4);
          const taskIds = [];

          for (let i = 0; i < safeCount; i++) {
            try {
              const body = { model: imageModel, prompt: imagePrompt, ar: '9:16', image: mainPhoto };
              const createResp = await axios.post(`${baseUrl}/media/create`, body, {
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                timeout: 30000
              });
              const taskId = createResp.data?.id || createResp.data?.task_id;
              const directUrl = createResp.data?.url || createResp.data?.image_url || createResp.data?.data?.[0]?.url;
              if (directUrl) taskIds.push({ taskId: null, url: directUrl });
              else if (taskId) taskIds.push({ taskId, url: null });
            } catch (err) { console.error(`Factory img ${i + 1}:`, err.message); }
          }

          // Collect sync results
          taskIds.filter(t => t.url).forEach(t => generatedImages.push(t.url));
          const pending = taskIds.filter(t => t.taskId && !t.url);

          // Poll async tasks
          for (let poll = 0; poll < 22 && pending.length > 0; poll++) {
            await new Promise(r => setTimeout(r, 4000));
            const still = [];
            for (const task of pending) {
              try {
                const resp = await axios.post(`${baseUrl}/media/result`, { task_id: task.taskId }, {
                  headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                  timeout: 15000
                });
                const d = resp.data;
                const st = (d.status || '').toLowerCase();
                const url = d.url || d.image_url || d.data?.[0]?.url;
                if ((st === 'done' || st === 'completed' || st === 'success') && url) generatedImages.push(url);
                else if (st !== 'failed' && st !== 'error') still.push(task);
              } catch { still.push(task); }
            }
            pending.length = 0;
            pending.push(...still);
          }
        }

        await query(
          "UPDATE product_runs SET generated_images = $1 WHERE id = $2",
          [JSON.stringify(generatedImages), runId]
        );

        // ── STEP 3: Генерация видео (через n8n) ──
        currentFactoryStep = 'video';
        await query(
          "UPDATE product_runs SET status = 'generating_video', current_step = 'video' WHERE id = $1",
          [runId]
        );
        emitToSession(null, 'factory:step', { run_id: runId, step: 'video' });

        // Create pipeline_session
        const sessionResult = await query(
          `INSERT INTO pipeline_sessions
            (user_id, source, status, current_step, product_name, product_image_url,
             video_type, subtitles_enabled, auto_publish)
           VALUES ($1, 'product', 'created', 'created', $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            req.user?.id || null,
            product.name,
            mainPhoto,
            provider === 'heygen' ? 'heygen' : 'a2e',
            subtitles_enabled !== false,
            auto_publish
          ]
        );
        const sessionId = sessionResult.rows[0].id;
        await query('UPDATE product_runs SET session_id = $1 WHERE id = $2', [sessionId, runId]);

        // Create voice_scripts
        const wordCount = scriptText.trim().split(/\s+/).length;
        const durationHint = Math.ceil(wordCount / 2.5);
        const vsResult = await query(
          `INSERT INTO voice_scripts (idea_id, script_text, word_count, duration_hint, timing_marks, montage_script, status)
           VALUES (NULL, $1, $2, $3, '[]'::jsonb, '[]'::jsonb, 'approved')
           RETURNING id`,
          [scriptText, wordCount, durationHint]
        );
        await query('UPDATE pipeline_sessions SET voice_script_id = $1 WHERE id = $2', [vsResult.rows[0].id, sessionId]);

        // Determine webhook
        const webhookUrl = provider === 'heygen'
          ? `${N8N_URL}/webhook/video-factory-heygen`
          : `${N8N_URL}/webhook/video-factory-a2e-product`;

        const webhookPayload = {
          session_id: sessionId,
          product_run_id: runId,
          product_id: product.id,
          product_name: product.name,
          product_description: product.description || '',
          product_image_url: mainPhoto,
          product_photos: photos,
          generated_images: generatedImages,
          script_text: scriptText,
          idea_text: ideaText,
          video_type: provider === 'heygen' ? 'heygen' : 'a2e_product',
          subtitles_enabled: subtitles_enabled !== false,
          auto_publish: auto_publish,
          publish_channels: publish_channels,
          factory_mode: true
        };

        if (provider === 'heygen') {
          webhookPayload.heygen_avatar_id = product.heygen_avatar_id || '';
          webhookPayload.heygen_voice_id = product.heygen_voice_id || '';
          webhookPayload.heygen_background = '#00FF00';
          webhookPayload.heygen_ratio = '9:16';
        } else {
          webhookPayload.a2e_avatar_id = product.a2e_avatar_id || '';
          webhookPayload.a2e_voice_id = product.a2e_voice_id || '';
        }

        try {
          await axios.post(webhookUrl, webhookPayload, { timeout: 15000 });
        } catch (n8nErr) {
          console.error('Factory N8N trigger error:', n8nErr.message);
        }

        // The rest of the pipeline (video gen → montage → publish) is handled by N8N
        // N8N will update pipeline_sessions status, and we'll listen for session-update events
        // For auto_publish, N8N checks the flag in pipeline_sessions

      } catch (err) {
        console.error('Factory pipeline error:', err.message);
        await query(
          "UPDATE product_runs SET status = 'error', error_message = $1 WHERE id = $2",
          [err.message, runId]
        ).catch(() => {});
        emitToSession(null, 'factory:error', { run_id: runId, step: currentFactoryStep, error: err.message });
      }
    })();

  } catch (err) {
    next(err);
  }
});

module.exports = router;
