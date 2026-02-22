// ─── JWT Authentication Middleware ───
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'content-factory-jwt-secret-change-me';
const JWT_EXPIRES_IN = '7d';

/**
 * Создать JWT токен
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Верифицировать JWT
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware: требует авторизации.
 * Проверяет JWT из header, cookie или query — без обращения к БД.
 */
function authMiddleware(req, res, next) {
  try {
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    }

    const payload = verifyToken(token);

    req.user = {
      login: payload.login,
      role: payload.role
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, error: 'Токен истёк, войдите заново' });
    }
    return res.status(401).json({ ok: false, error: 'Невалидный токен' });
  }
}

/**
 * Middleware: только tech_admin
 */
function techAdminOnly(req, res, next) {
  if (req.user.role !== 'tech_admin') {
    return res.status(403).json({ ok: false, error: 'Требуются права технического администратора' });
  }
  next();
}

module.exports = { authMiddleware, techAdminOnly, signToken, verifyToken, JWT_SECRET };
