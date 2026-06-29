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

    const users = [
      ['admin', 'admin@elkris.com', 'admin123', 'System Administrator', '08012345678', '', 'admin', 'North Central', 'FCT', 'Abuja Municipal', 1, 'light', '2026-01-01 00:00:00'],
      ['supervisor1', 'grace.okonkwo@elkris.com', 'super123', 'Grace Okonkwo', '08023456789', '', 'supervisor', 'South East', 'Enugu', 'Enugu North', 1, 'light', '2026-01-15 08:30:00'],
      ['manager1', 'emeka.nwosu@elkris.com', 'manager123', 'Emeka Nwosu', '08034567890', '', 'manager', 'South South', 'Rivers', 'Port Harcourt', 1, 'light', '2026-02-01 10:00:00'],
      ['csr1', 'amina.bello@elkris.com', 'csr123', 'Amina Bello', '08045678901', '12 Kano Road, Kano Municipal', 'csr', 'North West', 'Kano', 'Kano Municipal', 1, 'light', '2026-03-10 09:00:00'],
      ['csr2', 'tunde.adeyemi@elkris.com', 'csr123', 'Tunde Adeyemi', '08056789012', '5 Lagos Avenue, Ikeja', 'csr', 'South West', 'Lagos', 'Ikeja', 1, 'dark', '2026-03-12 09:00:00'],
    ];

    for (const u of users) {
      await conn.query(
        `INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        u
      );
    }

    const products = [
      ['Elkris Premium Oats', '500g'],
      ['Elkris Premium Oats', '1kg'],
      ['Elkris Corn Flakes', '300g'],
      ['Elkris Corn Flakes', '750g'],
      ['Elkris Honey Wheat', '500g'],
    ];
    for (const p of products) {
      await conn.query(
        `INSERT INTO products (name, grammage, createdBy, isActive, createdAt) VALUES (?, ?, 1, 1, '2026-01-01 00:00:00')`,
        p
      );
    }

    await conn.query(`INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES ('Tier 1 - Starter', 500000, 80000, 2, '2026-01-01 00:00:00')`);
    await conn.query(`INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES ('Tier 2 - Growth', 1000000, 120000, 2, '2026-01-01 00:00:00')`);
    await conn.query(`INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES ('Tier 3 - Premium', 2000000, 180000, 2, '2026-01-01 00:00:00')`);

    await conn.query(`INSERT INTO csr_tier (csrId, tierId) VALUES (4, 1)`);
    await conn.query(`INSERT INTO csr_tier (csrId, tierId) VALUES (5, 2)`);

    await conn.query(`INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (4, 1, 200, '2026-06-01 08:00:00')`);
    await conn.query(`INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (4, 3, 150, '2026-06-01 08:00:00')`);
    await conn.query(`INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (5, 2, 180, '2026-06-01 08:00:00')`);
    await conn.query(`INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (5, 4, 120, '2026-06-01 08:00:00')`);

    const [r1] = await conn.query(`INSERT INTO sales_entries (csrId, date, isPresent, loggedBy, dayClosed) VALUES (4, '2026-06-26', 1, 2, 1)`);
    const [r2] = await conn.query(`INSERT INTO sales_entries (csrId, date, isPresent, loggedBy, dayClosed) VALUES (5, '2026-06-26', 1, 2, 1)`);

    await conn.query(`INSERT INTO sales_entry_items (entryId, productId, quantity, unitPrice, salesValue) VALUES (?, 1, 40, 2500, 100000)`, [r1.insertId]);
    await conn.query(`INSERT INTO sales_entry_items (entryId, productId, quantity, unitPrice, salesValue) VALUES (?, 2, 50, 4500, 225000)`, [r2.insertId]);
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
