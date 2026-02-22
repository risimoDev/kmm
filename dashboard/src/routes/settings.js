// ─── Settings Routes ───
// GET  /api/settings              — Все настройки (по категориям)
// PUT  /api/settings              — Обновить настройки (только tech_admin)
// POST /api/settings/test-ai      — Тест AI подключения (только tech_admin)
// POST /api/settings/test-telegram — Тест Telegram бота (только tech_admin)
// POST /api/settings/test-heygen  — Тест HeyGen API (только tech_admin)
// POST /api/settings/test-a2e     — Тест A2E API (только tech_admin)
// GET  /api/settings/a2e-avatars  — Список аватаров A2E
// GET  /api/settings/a2e-voices   — Список TTS голосов A2E
// GET  /api/settings/a2e-credits  — Баланс кредитов A2E

const { Router } = require('express');
const axios = require('axios');
const { query, isConnected } = require('../db');
const { techAdminOnly } = require('../middleware/auth');

const router = Router();

// Категории, доступные бизнес-владельцу (только чтение)
const BUSINESS_OWNER_CATEGORIES = ['telegram', 'vk'];

// ─── Получить все настройки ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const result = await query(
      'SELECT key, value, type, category, label, description, is_secret, updated_at FROM app_settings ORDER BY category, key'
    );

    // Маскируем секретные значения
    const settings = result.rows.map(s => ({
      ...s,
      value: s.is_secret && s.value ? maskSecret(s.value) : s.value
    }));

    // Для business_owner — только разрешённые категории
    const isTechAdmin = req.user && req.user.role === 'tech_admin';
    const filtered = isTechAdmin
      ? settings
      : settings.filter(s => BUSINESS_OWNER_CATEGORIES.includes(s.category));

    // Группируем по категориям
    const grouped = {};
    for (const s of filtered) {
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push(s);
    }

    res.json({ ok: true, data: grouped, readonly: !isTechAdmin });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить настройки (только tech_admin) ───
router.put('/', techAdminOnly, async (req, res, next) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ ok: false, error: 'БД недоступна' });
    }

    const { settings: updates } = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ ok: false, error: 'Укажите settings объект' });
    }

    const updatedKeys = [];

    for (const [key, value] of Object.entries(updates)) {
      // Пропускаем пустые секретные значения (значит не менялось, отображалось как ****)
      if (typeof value === 'string' && value.includes('****')) continue;

      await query(
        `UPDATE app_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = $3`,
        [String(value), req.user.login, key]
      );
      updatedKeys.push(key);
    }

    res.json({ ok: true, updated: updatedKeys });
  } catch (err) {
    next(err);
  }
});

// ─── Тест AI подключения ───
router.post('/test-ai', techAdminOnly, async (req, res, next) => {
  try {
    const { apiKey, baseUrl, model, authPrefix } = req.body;

    if (!apiKey || !baseUrl) {
      return res.status(400).json({ ok: false, error: 'apiKey и baseUrl обязательны' });
    }

    const headers = { 'Content-Type': 'application/json' };
    const prefix = authPrefix || '';
    headers['Authorization'] = `${prefix}${apiKey}`;

    const startTime = Date.now();
    const response = await axios.post(`${baseUrl}/chat/completions`, {
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: 'Ответь одним словом: работает' }],
      max_tokens: 10
    }, { headers, timeout: 15_000 });

    const duration = Date.now() - startTime;
    const content = response.data?.choices?.[0]?.message?.content || '';
    const usage = response.data?.usage || {};

    res.json({
      ok: true,
      data: {
        response: content.trim(),
        model: response.data?.model || model,
        tokens: usage.total_tokens || 0,
        durationMs: duration
      }
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.json({ ok: false, error: `AI API ошибка: ${msg}` });
  }
});

// ─── Тест Telegram бота ───
router.post('/test-telegram', techAdminOnly, async (req, res, next) => {
  try {
    const { botToken, chatId } = req.body;

    if (!botToken) {
      return res.status(400).json({ ok: false, error: 'botToken обязателен' });
    }

    // Проверяем бота
    const meResponse = await axios.get(
      `https://api.telegram.org/bot${botToken}/getMe`,
      { timeout: 10_000 }
    );

    if (!meResponse.data.ok) {
      return res.json({ ok: false, error: 'Невалидный токен бота' });
    }

    const botInfo = meResponse.data.result;
    let messageSent = false;

    // Отправляем тестовое сообщение если указан chatId
    if (chatId && chatId !== '0') {
      try {
        await axios.post(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          { chat_id: chatId, text: '✅ Тестовое сообщение от Контент Завод' },
          { timeout: 10_000 }
        );
        messageSent = true;
      } catch (e) {
        // Не критично — бот может не иметь доступа к чату
      }
    }

    res.json({
      ok: true,
      data: {
        botName: botInfo.first_name,
        botUsername: botInfo.username,
        messageSent
      }
    });
  } catch (err) {
    const msg = err.response?.data?.description || err.message;
    res.json({ ok: false, error: `Telegram ошибка: ${msg}` });
  }
});

// ─── Тест HeyGen API ───
router.post('/test-heygen', techAdminOnly, async (req, res, next) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'apiKey обязателен' });
    }

    const response = await axios.get('https://api.heygen.com/v2/avatars', {
      headers: { 'X-Api-Key': apiKey },
      timeout: 10_000
    });

    const avatars = response.data?.data?.avatars || [];

    res.json({
      ok: true,
      data: {
        avatarsCount: avatars.length,
        avatarsSample: avatars.slice(0, 5).map(a => ({
          id: a.avatar_id,
          name: a.avatar_name
        }))
      }
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.json({ ok: false, error: `HeyGen ошибка: ${msg}` });
  }
});

// ─── Тест GPTunnel TTS ───
router.post('/test-gptunnel-tts', techAdminOnly, async (req, res, next) => {
  try {
    // Берём API ключ из БД
    const result = await query("SELECT key, value FROM app_settings WHERE key IN ('ai_api_key', 'tts_gptunnel_voice_id')");
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });

    const apiKey = settings.ai_api_key;
    if (!apiKey) return res.json({ ok: false, error: 'AI API ключ не настроен. Сохраните настройки AI.' });

    const startTime = Date.now();
    const response = await axios.post('https://gptunnel.ru/v1/tts/create', {
      text: 'Тест синтеза речи',
      voice_id: settings.tts_gptunnel_voice_id || '65f4092eddc5862248a18111'
    }, {
      headers: { Authorization: apiKey },
      timeout: 30000
    });
    const duration = Date.now() - startTime;

    res.json({
      ok: true,
      data: {
        hasAudio: !!(response.data?.data),
        cost: response.data?.cost || 0,
        durationMs: duration
      }
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.json({ ok: false, error: `GPTunnel TTS: ${msg}` });
  }
});

// ─── Тест GPTunnel Media (видео / изображения) ───
router.post('/test-gptunnel-media', techAdminOnly, async (req, res, next) => {
  try {
    const { model } = req.body;

    const result = await query("SELECT value FROM app_settings WHERE key = 'ai_api_key'");
    const apiKey = result.rows[0]?.value;
    if (!apiKey) return res.json({ ok: false, error: 'AI API ключ не настроен. Сохраните настройки AI.' });

    const startTime = Date.now();
    const response = await axios.post('https://gptunnel.ru/v1/media/create', {
      model: model || 'google-imagen-3',
      prompt: 'A simple red circle on white background'
    }, {
      headers: { Authorization: apiKey },
      timeout: 30000
    });
    const duration = Date.now() - startTime;

    if (response.data?.code === 0 && response.data?.id) {
      res.json({
        ok: true,
        data: {
          taskId: response.data.id,
          model: response.data.model,
          status: response.data.status,
          durationMs: duration
        }
      });
    } else {
      res.json({ ok: false, error: `Неожиданный ответ: ${JSON.stringify(response.data).slice(0, 200)}` });
    }
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.json({ ok: false, error: `GPTunnel Media: ${msg}` });
  }
});

// ─── Получить список голосов GPTunnel ───
router.get('/gptunnel-voices', techAdminOnly, async (req, res, next) => {
  try {
    const result = await query("SELECT value FROM app_settings WHERE key = 'ai_api_key'");
    const apiKey = result.rows[0]?.value;
    if (!apiKey) return res.json({ ok: false, error: 'AI API ключ не настроен' });

    const response = await axios.get('https://gptunnel.ru/v1/tts/voices', {
      headers: { Authorization: apiKey },
      timeout: 10000
    });

    res.json({ ok: true, data: response.data || [] });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    res.json({ ok: false, error: `GPTunnel: ${msg}` });
  }
});

// ─── Тест A2E API ───
router.post('/test-a2e', techAdminOnly, async (req, res, next) => {
  try {
    const { apiToken, baseUrl } = req.body;

    if (!apiToken) {
      return res.status(400).json({ ok: false, error: 'apiToken обязателен' });
    }

    const base = (baseUrl || 'https://video.a2e.ai').replace(/\/+$/, '');
    const headers = { Authorization: `Bearer ${apiToken}` };
    const startTime = Date.now();

    // Check credits
    const creditsRes = await axios.get(`${base}/api/v1/user/remainingCoins`, {
      headers, timeout: 10_000
    });
    const coins = creditsRes.data?.data?.coins ?? 'N/A';

    // Check avatars
    const avatarsRes = await axios.get(`${base}/api/v1/anchor/character_list?type=default`, {
      headers, timeout: 10_000
    });
    const avatars = avatarsRes.data?.data || [];

    const duration = Date.now() - startTime;

    res.json({
      ok: true,
      data: {
        credits: coins,
        avatarsCount: avatars.length,
        avatarsSample: avatars.slice(0, 5).map(a => ({
          id: a._id,
          cover: a.video_cover || a.people_img || ''
        })),
        durationMs: duration
      }
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.msg || err.message;
    res.json({ ok: false, error: `A2E ошибка: ${msg}` });
  }
});

// ─── Список аватаров A2E ───
router.get('/a2e-avatars', techAdminOnly, async (req, res, next) => {
  try {
    const { type = 'default' } = req.query;
    const settings = await getA2ESettings();
    if (!settings.token) return res.json({ ok: false, error: 'A2E API Token не настроен' });

    const response = await axios.get(`${settings.baseUrl}/api/v1/anchor/character_list?type=${type}`, {
      headers: { Authorization: `Bearer ${settings.token}` },
      timeout: 15_000
    });

    const avatars = (response.data?.data || []).map(a => ({
      _id: a._id,
      type: a.type,
      video_cover: a.video_cover || '',
      people_img: a.people_img || '',
      background_img: a.background_img || '',
      background_color: a.background_color || '',
      base_video: a.base_video || '',
      lang: a.lang || []
    }));

    res.json({ ok: true, data: avatars });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.msg || err.message;
    res.json({ ok: false, error: `A2E: ${msg}` });
  }
});

// ─── Список TTS голосов A2E ───
router.get('/a2e-voices', techAdminOnly, async (req, res, next) => {
  try {
    const { country = 'ru', region = '' } = req.query;
    const settings = await getA2ESettings();
    if (!settings.token) return res.json({ ok: false, error: 'A2E API Token не настроен' });

    let url = `${settings.baseUrl}/api/v1/anchor/voice_list?country=${country}`;
    if (region) url += `&region=${region}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${settings.token}` },
      timeout: 15_000
    });

    res.json({ ok: true, data: response.data?.data || [] });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.msg || err.message;
    res.json({ ok: false, error: `A2E: ${msg}` });
  }
});

// ─── Баланс кредитов A2E ───
router.get('/a2e-credits', techAdminOnly, async (req, res, next) => {
  try {
    const settings = await getA2ESettings();
    if (!settings.token) return res.json({ ok: false, error: 'A2E API Token не настроен' });

    const response = await axios.get(`${settings.baseUrl}/api/v1/user/remainingCoins`, {
      headers: { Authorization: `Bearer ${settings.token}` },
      timeout: 10_000
    });

    res.json({ ok: true, data: { coins: response.data?.data?.coins ?? 0 } });
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.msg || err.message;
    res.json({ ok: false, error: `A2E: ${msg}` });
  }
});

// ─── Helpers ───
async function getA2ESettings() {
  const result = await query("SELECT key, value FROM app_settings WHERE key IN ('a2e_api_token', 'a2e_base_url')");
  const s = {};
  result.rows.forEach(r => { s[r.key] = r.value; });
  return {
    token: s.a2e_api_token || '',
    baseUrl: (s.a2e_base_url || 'https://video.a2e.ai').replace(/\/+$/, '')
  };
}

function maskSecret(value) {
  if (!value || value.length < 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

module.exports = router;
