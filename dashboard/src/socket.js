// ─── Socket.IO для real-time обновлений ───
const { verifyToken } = require('./middleware/auth');

let _io = null;

function initSocketIO(io) {
  _io = io;
  // Авторизация WebSocket через JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Требуется авторизация'));
    }
    try {
      const payload = verifyToken(token);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error('Невалидный токен'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[WS] ${socket.user.username || socket.user.userId} connected`);

    // Подписка на обновления сессии
    socket.on('watch-session', (sessionId) => {
      const room = `session-${sessionId}`;
      socket.join(room);
      console.log(`[WS] ${socket.user.username} watching ${room}`);
    });

    // Подписка на все обновления (для Dashboard)
    socket.on('watch-all', () => {
      socket.join('dashboard');
      console.log(`[WS] ${socket.user.username} watching dashboard`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] ${socket.user.username || socket.user.userId} disconnected`);
    });
  });
}

// Утилита для отправки события из route handlers
function emitToSession(sessionId, event, data) {
  if (!_io) return;
  if (sessionId) {
    _io.to(`session-${sessionId}`).emit(event, data);
  }
  _io.to('dashboard').emit(event, { sessionId, ...data });
}

module.exports = { initSocketIO, emitToSession };
