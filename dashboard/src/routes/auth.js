// ─── Auth Routes ───
// POST /api/auth/login   — Вход по логину и паролю
// GET  /api/auth/me      — Текущий пользователь
// POST /api/auth/logout  — Выход

const { Router } = require('express');
const crypto = require('crypto');
const { signToken, authMiddleware } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { query, isConnected } = require('../db');

const router = Router();

/**
 * Парсинг DASHBOARD_USERS env var.
 * Формат: login:password:role,login2:password2:role2
 * Роли: tech_admin, business_owner
 */
function parseDashboardUsers() {
  const raw = process.env.DASHBOARD_USERS || '';
  if (!raw) return [];

  return raw.split(',').map(entry => {
    const parts = entry.trim().split(':');
    if (parts.length < 2) return null;
    return {
      login: parts[0].trim(),
      password: parts[1].trim(),
      role: ['tech_admin', 'business_owner'].includes((parts[2] || '').trim())
        ? parts[2].trim()
        : 'tech_admin'
    };
  }).filter(Boolean);
}

// ─── Вход по логину и паролю ───
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { login, password } = req.body || {};

    if (!login || !password) {
      return res.status(400).json({ ok: false, error: 'Введите логин и пароль' });
    }

    const users = parseDashboardUsers();

    // 1) Проверяем ENV-пользователей
    const found = users.find(u => u.login === login);
    let authenticatedUser = null;

    if (found) {
      const pwdBuf = Buffer.from(password);
      const expectedBuf = Buffer.from(found.password);
      const isValid =
        pwdBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(pwdBuf, expectedBuf);
      if (isValid) {
        authenticatedUser = { login: found.login, role: found.role, source: 'env' };
      }
    }

    // 2) Если не найден в ENV — проверяем БД
    if (!authenticatedUser && isConnected()) {
      try {
        const dbResult = await query(
          'SELECT id, login, password_hash, password_salt, role, is_active FROM users WHERE login = $1 AND password_hash IS NOT NULL',
          [login]
        );
        if (dbResult.rows.length > 0) {
          const dbUser = dbResult.rows[0];
          if (!dbUser.is_active) {
            return res.status(403).json({ ok: false, error: 'Аккаунт деактивирован' });
          }
          const hash = crypto.createHmac('sha256', dbUser.password_salt).update(password).digest('hex');
          const hashMatch = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(dbUser.password_hash));
          if (hashMatch) {
            authenticatedUser = { id: dbUser.id, login: dbUser.login, role: dbUser.role, source: 'db' };
            // Обновить last_login
            query('UPDATE users SET last_login = NOW() WHERE id = $1', [dbUser.id]).catch(() => {});
          }
        }
      } catch (dbErr) {
        console.error('[AUTH] DB lookup error:', dbErr.message);
      }
    }

    if (!authenticatedUser) {
      return res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
    }

    // Генерируем JWT
    const token = signToken({ login: authenticatedUser.login, role: authenticatedUser.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000  // 7 дней
    });

    console.log(`[AUTH] Login: ${authenticatedUser.login} (${authenticatedUser.role}) [${authenticatedUser.source}]`);

    res.json({
      ok: true,
      token,
      user: {
        login: authenticatedUser.login,
        role: authenticatedUser.role
      }
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ─── Кто я ───
router.get('/me', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: {
      login: req.user.login,
      role: req.user.role
    }
  });
});

// ─── Выход ───
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

module.exports = router;
