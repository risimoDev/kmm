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

module.exports = { createRateLimiter, authLimiter };
