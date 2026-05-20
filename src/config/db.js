const { Pool } = require('pg');

const requiredDbEnv = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingDbEnv = requiredDbEnv.filter((key) => !process.env[key]);

if (missingDbEnv.length > 0) {
  console.error(`❌  Missing required database environment variables: ${missingDbEnv.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Railway PostgreSQL requires SSL in production
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint,
    });
    process.exit(1);
  }
  release();
  console.log('✅  Database connected successfully');
});

module.exports = pool;
