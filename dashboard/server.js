// ═══════════════════════════════════════════════════════════
// Контент Завод — Dashboard Backend v2.0
// ═══════════════════════════════════════════════════════════
// Модульный Express.js сервер с JWT авторизацией,
// WebSocket, MinIO, и полным REST API.

const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const { Server: SocketServer } = require('socket.io');

const { createProxyMiddleware } = require('http-proxy-middleware');
const { pool, checkConnection } = require('./src/db');
const { authMiddleware } = require('./src/middleware/auth');
const { createRateLimiter } = require('./src/middleware/rateLimit');
const { initSocketIO } = require('./src/socket');

// Routes
const authRoutes = require('./src/routes/auth');
const contentRoutes = require('./src/routes/content');
const videosRoutes = require('./src/routes/videos');
const scheduleRoutes = require('./src/routes/schedule');
const analyticsRoutes = require('./src/routes/analytics');
const settingsRoutes = require('./src/routes/settings');
const errorsRoutes = require('./src/routes/errors');
const mediaRoutes = require('./src/routes/media');
const cardsRoutes = require('./src/routes/cards');
const usersRoutes = require('./src/routes/users');
const internalRoutes = require('./src/routes/internal');
const healthRoutes = require('./src/routes/health');

// ─── Config ───
const PORT = process.env.DASHBOARD_PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// ─── Express App ───
const app = express();
const server = http.createServer(app);

// ─── Socket.IO ───
const io = new SocketServer(server, {
  cors: { origin: CORS_ORIGIN, credentials: true },
  path: '/ws'
});
initSocketIO(io);

// Делаем io доступным в routes через req.app
app.set('io', io);

// ─── N8N Reverse Proxy (BEFORE body-parser!) ───
// n8n HTML грузит assets по абсолютным путям от корня (/assets/, /static/, /rest/, /push)
// Поэтому нужен один прокси, который ловит и /n8n/* и корневые n8n-пути
const N8N_PROXY_TARGET = process.env.N8N_URL || 'http://n8n:5678';
const N8N_ROOT_PATHS = ['/assets/', '/static/', '/rest/', '/rest?', '/push', '/types/', '/healthz', '/webhook/', '/webhook-waiting/', '/form/'];

app.use(createProxyMiddleware({
  target: N8N_PROXY_TARGET,
  // Не меняем Host → браузер шлёт Origin: localhost:3001, n8n видит Host: localhost:3001
  // При changeOrigin: true n8n получает Host: n8n:5678, а Origin: localhost:3001 → CSRF mismatch
  changeOrigin: false,
  xfwd: true,           // X-Forwarded-For, X-Forwarded-Port, X-Forwarded-Proto
  ws: true,             // WebSocket для /push (n8n live updates)
  pathFilter: (pathname) => {
    if (pathname.startsWith('/n8n')) return true;
    return N8N_ROOT_PATHS.some(p => pathname.startsWith(p));
  },
  pathRewrite: (path) => {
    // /n8n/rest/login → /rest/login (strip prefix)
    // /rest/login → /rest/login (keep as-is)
    if (path.startsWith('/n8n/')) return path.replace(/^\/n8n/, '') || '/';
    if (path === '/n8n') return '/';
    return path;
  },
  on: {
    error: (err, req, res) => {
      console.error('[N8N Proxy]', err.message);
      if (res && res.writeHead) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'N8N недоступен' }));
      }
    }
  }
}));

// ─── Global Middleware ───
app.use(helmet({
  contentSecurityPolicy: false,  // SPA грузит внешние скрипты
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting (общий)
app.use('/api/', createRateLimiter({ windowMs: 60_000, max: 120 }));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───
app.use('/api/auth',      authRoutes);
app.use('/api/content',   authMiddleware, contentRoutes);
app.use('/api/videos',    authMiddleware, videosRoutes);
app.use('/api/schedule',  authMiddleware, scheduleRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/settings',  authMiddleware, settingsRoutes);
app.use('/api/errors',    authMiddleware, errorsRoutes);
app.use('/api/media',     authMiddleware, mediaRoutes);
app.use('/api/cards',     authMiddleware, cardsRoutes);
app.use('/api/users',     authMiddleware, usersRoutes);
app.use('/api/internal',  internalRoutes);  // Для N8N callbacks — без auth, по Docker сети
app.use('/api/health',    healthRoutes);

// ─── SPA Fallback ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ───
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ─── Start ───
async function start() {
  const dbOk = await checkConnection();
  console.log(dbOk ? '✅ PostgreSQL connected' : '⚠️  PostgreSQL unavailable — some features disabled');

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏭 Content Factory Dashboard v2.0 on port ${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api/health`);
    console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  io.close();
  await pool.end();
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  io.close();
  await pool.end();
  server.close();
  process.exit(0);
});

start();
