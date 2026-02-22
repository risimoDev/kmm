// ─── Database connection pool ───
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST || 'postgres',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'n8n',
  user:     process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

let dbConnected = false;

async function checkConnection() {
  try {
    await pool.query('SELECT 1');
    dbConnected = true;
    return true;
  } catch (err) {
    console.warn('PostgreSQL not available:', err.message);
    dbConnected = false;
    return false;
  }
}

function isConnected() {
  return dbConnected;
}

// Безопасный запрос с fallback
async function query(sql, params = []) {
  return pool.query(sql, params);
}

module.exports = { pool, query, checkConnection, isConnected };
