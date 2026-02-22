// ─── Users Management Routes (tech_admin only) ───
// GET    /api/users           — Список пользователей
// POST   /api/users           — Создать пользователя
// PUT    /api/users/:id       — Обновить пользователя (роль, активность)
// PUT    /api/users/:id/password — Сменить пароль
// DELETE /api/users/:id       — Удалить пользователя

const { Router } = require('express');
const crypto = require('crypto');
const { query, isConnected } = require('../db');
const { techAdminOnly } = require('../middleware/auth');

const router = Router();

// Все эндпоинты — только для tech_admin
router.use(techAdminOnly);

// ─── Хеширование пароля (SHA-256 + salt, без bcrypt) ───
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = hashPassword(password, storedSalt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}

// ─── Список пользователей ───
router.get('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.json({ ok: true, data: [], envUsers: [] });

    // DB users
    const result = await query(
      `SELECT id, login, first_name, last_name, role, is_active, last_login, created_at
       FROM users WHERE password_hash IS NOT NULL
       ORDER BY created_at DESC`
    );

    // Env users (read-only, для справки)
    const envUsers = parseEnvUsers().map(u => ({
      login: u.login,
      role: u.role,
      source: 'env'
    }));

    res.json({
      ok: true,
      data: result.rows.map(u => ({ ...u, source: 'db' })),
      envUsers
    });
  } catch (err) {
    next(err);
  }
});

// ─── Создать пользователя ───
router.post('/', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { login, password, first_name, last_name, role = 'business_owner' } = req.body;

    if (!login || !password) {
      return res.status(400).json({ ok: false, error: 'login и password обязательны' });
    }

    if (login.length < 3) {
      return res.status(400).json({ ok: false, error: 'Логин минимум 3 символа' });
    }

    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Пароль минимум 6 символов' });
    }

    const validRoles = ['tech_admin', 'business_owner'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: `Роль должна быть: ${validRoles.join(', ')}` });
    }

    // Проверить уникальность
    const existing = await query('SELECT id FROM users WHERE login = $1', [login]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Пользователь с таким логином уже существует' });
    }

    // Проверить конфликт с env users
    const envUsers = parseEnvUsers();
    if (envUsers.some(u => u.login === login)) {
      return res.status(409).json({ ok: false, error: 'Этот логин зарезервирован (задан в .env)' });
    }

    const { hash, salt } = hashPassword(password);

    const result = await query(
      `INSERT INTO users (login, password_hash, password_salt, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, login, first_name, last_name, role, is_active, created_at`,
      [login, hash, salt, first_name || '', last_name || '', role]
    );

    console.log(`[USERS] Created: ${login} (${role}) by ${req.user.login}`);

    res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Обновить пользователя (роль, активность, имя) ───
router.put('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { role, is_active, first_name, last_name } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (role !== undefined) {
      const validRoles = ['tech_admin', 'business_owner'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ ok: false, error: `Роль должна быть: ${validRoles.join(', ')}` });
      }
      fields.push(`role = $${idx++}`);
      values.push(role);
    }

    if (is_active !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(Boolean(is_active));
    }

    if (first_name !== undefined) {
      fields.push(`first_name = $${idx++}`);
      values.push(first_name);
    }

    if (last_name !== undefined) {
      fields.push(`last_name = $${idx++}`);
      values.push(last_name);
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Нет полей для обновления' });
    }

    values.push(id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx} AND password_hash IS NOT NULL
       RETURNING id, login, first_name, last_name, role, is_active, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
    }

    console.log(`[USERS] Updated #${id} by ${req.user.login}`);

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Сменить пароль ───
router.put('/:id/password', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Пароль минимум 6 символов' });
    }

    const { hash, salt } = hashPassword(password);

    const result = await query(
      `UPDATE users SET password_hash = $1, password_salt = $2, updated_at = NOW()
       WHERE id = $3 AND password_hash IS NOT NULL
       RETURNING id, login`,
      [hash, salt, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
    }

    console.log(`[USERS] Password changed for #${id} by ${req.user.login}`);

    res.json({ ok: true, message: 'Пароль изменён' });
  } catch (err) {
    next(err);
  }
});

// ─── Удалить пользователя ───
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isConnected()) return res.status(503).json({ ok: false, error: 'БД недоступна' });

    const { id } = req.params;
    const result = await query(
      `DELETE FROM users WHERE id = $1 AND password_hash IS NOT NULL RETURNING id, login`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Пользователь не найден' });
    }

    console.log(`[USERS] Deleted ${result.rows[0].login} by ${req.user.login}`);

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── Helper: parse env users ───
function parseEnvUsers() {
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

// Export hashPassword/verifyPassword for auth route
module.exports = router;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
