const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'elkris_csr';

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: '+00:00'
});

async function ensureDatabase() {
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    timezone: '+00:00'
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
}

async function seed() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count > 0) return;

    await conn.query(
      `INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['admin', 'elkristech@gmail.com', 'Repo34j8723', 'System Administrator', '', '', 'admin', '', '', '', 1, 'light', '2026-01-01 00:00:00']
    );
  } finally {
    conn.release();
  }
}

function makeExecutor(execFn) {
  return {
    prepare: (sql) => ({
      all: async (...params) => {
        const [rows] = await execFn(sql, params);
        return rows;
      },
      get: async (...params) => {
        const [rows] = await execFn(sql, params);
        return rows[0];
      },
      run: async (...params) => {
        const [result] = await execFn(sql, params);
        return {
          lastInsertRowid: result.insertId,
          changes: result.affectedRows
        };
      }
    })
  };
}

const poolExecutor = (sql, params) => pool.execute(sql, params);

const db = {
  ...makeExecutor(poolExecutor),
  async transaction(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const connExecutor = (sql, params) => conn.execute(sql, params);
      const txDb = makeExecutor(connExecutor);
      const result = await fn(txDb);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },
  exec: async (sql) => {
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      await pool.execute(stmt);
    }
  },
  pragma: async () => {},
  close: async () => {
    await pool.end();
  }
};

async function runMigrations() {
  const { sequelize } = require('./models');
  const { Umzug, SequelizeStorage } = require('umzug');

  const umzug = new Umzug({
    migrations: { glob: 'migrations/*.js' },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });

  await umzug.up();
}

async function init() {
  await ensureDatabase();
  await runMigrations();
  await seed();
}

init().catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

module.exports = db;
