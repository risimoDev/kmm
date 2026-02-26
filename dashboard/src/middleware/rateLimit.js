// ─── Rate Limiting Middleware ───
const rateLimit = require('express-rate-limit');

function createRateLimiter({ windowMs = 60_000, max = 100, message } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      error: message || 'Слишком много запросов, попробуйте позже'
    }
  });
}

// Строгий лимит для auth endpoints
const authLimiter = createRateLimiter({
  windowMs: 15 * 60_000,  // 15 минут
  max: 20,
  message: 'Слишком много попыток входа'
});

// Лимит на генерацию контента/видео (защита от исчерпания кредитов API)
const generationLimiter = createRateLimiter({
  windowMs: 60 * 60_000,  // 1 час
  max: 30,
  message: 'Лимит генераций исчерпан (30/час). Подождите.'
});

module.exports = { createRateLimiter, authLimiter, generationLimiter };
