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
