const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(process.env.DB_PATH || './data/elkris.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    fullName TEXT NOT NULL,
    phoneNumber TEXT,
    address TEXT,
    role TEXT NOT NULL DEFAULT 'csr',
    zone TEXT,
    state TEXT,
    lga TEXT,
    isActive INTEGER NOT NULL DEFAULT 1,
    theme TEXT DEFAULT 'light',
    removedBy INTEGER,
    removedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (removedBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grammage TEXT NOT NULL,
    createdBy INTEGER,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (createdBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS target_tiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    monthlyTarget INTEGER NOT NULL DEFAULT 0,
    monthlySalary INTEGER NOT NULL DEFAULT 0,
    createdBy INTEGER,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (createdBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS csr_tier (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    csrId INTEGER UNIQUE NOT NULL,
    tierId INTEGER NOT NULL,
    assignedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (csrId) REFERENCES users(id),
    FOREIGN KEY (tierId) REFERENCES target_tiers(id)
  );

  CREATE TABLE IF NOT EXISTS csr_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    csrId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    lastUpdated TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (csrId) REFERENCES users(id),
    FOREIGN KEY (productId) REFERENCES products(id),
    UNIQUE(csrId, productId)
  );

  CREATE TABLE IF NOT EXISTS sales_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    csrId INTEGER NOT NULL,
    date TEXT NOT NULL,
    isPresent INTEGER NOT NULL DEFAULT 1,
    loggedBy INTEGER,
    dayClosed INTEGER NOT NULL DEFAULT 0,
    closedAt TEXT,
    FOREIGN KEY (csrId) REFERENCES users(id),
    FOREIGN KEY (loggedBy) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sales_entry_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entryId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    unitPrice INTEGER NOT NULL DEFAULT 0,
    salesValue INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (entryId) REFERENCES sales_entries(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS payment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    csrId INTEGER NOT NULL,
    month TEXT NOT NULL,
    totalSales INTEGER NOT NULL DEFAULT 0,
    target INTEGER NOT NULL DEFAULT 0,
    baseSalary INTEGER NOT NULL DEFAULT 0,
    earnedPay INTEGER NOT NULL DEFAULT 0,
    percentTarget INTEGER NOT NULL DEFAULT 0,
    confirmedBy INTEGER,
    confirmedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (csrId) REFERENCES users(id),
    FOREIGN KEY (confirmedBy) REFERENCES users(id),
    UNIQUE(csrId, month)
  );
`);

const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('removedBy')) {
  db.exec("ALTER TABLE users ADD COLUMN removedBy INTEGER REFERENCES users(id)");
}
if (!userCols.includes('removedAt')) {
  db.exec("ALTER TABLE users ADD COLUMN removedAt TEXT");
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (username, email, password, fullName, phoneNumber, address, role, zone, state, lga, isActive, theme, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const users = [
    ['admin', 'admin@elkris.com', 'admin123', 'System Administrator', '08012345678', '', 'admin', 'North Central', 'FCT', 'Abuja Municipal', 1, 'light', '2026-01-01T00:00:00.000Z'],
    ['supervisor1', 'grace.okonkwo@elkris.com', 'super123', 'Grace Okonkwo', '08023456789', '', 'supervisor', 'South East', 'Enugu', 'Enugu North', 1, 'light', '2026-01-15T08:30:00.000Z'],
    ['manager1', 'emeka.nwosu@elkris.com', 'manager123', 'Emeka Nwosu', '08034567890', '', 'manager', 'South South', 'Rivers', 'Port Harcourt', 1, 'light', '2026-02-01T10:00:00.000Z'],
    ['csr1', 'amina.bello@elkris.com', 'csr123', 'Amina Bello', '08045678901', '12 Kano Road, Kano Municipal', 'csr', 'North West', 'Kano', 'Kano Municipal', 1, 'light', '2026-03-10T09:00:00.000Z'],
    ['csr2', 'tunde.adeyemi@elkris.com', 'csr123', 'Tunde Adeyemi', '08056789012', '5 Lagos Avenue, Ikeja', 'csr', 'South West', 'Lagos', 'Ikeja', 1, 'dark', '2026-03-12T09:00:00.000Z'],
  ];

  const insertMany = db.transaction(() => {
    for (const u of users) insertUser.run(...u);
  });
  insertMany();

  const insertProduct = db.prepare("INSERT INTO products (name, grammage, createdBy, isActive, createdAt) VALUES (?, ?, 1, 1, '2026-01-01T00:00:00.000Z')");
  const products = [['Elkris Premium Oats', '500g'], ['Elkris Premium Oats', '1kg'], ['Elkris Corn Flakes', '300g'], ['Elkris Corn Flakes', '750g'], ['Elkris Honey Wheat', '500g']];
  db.transaction(() => { for (const p of products) insertProduct.run(...p); })();

  const insertTier = db.prepare("INSERT INTO target_tiers (name, monthlyTarget, monthlySalary, createdBy, createdAt) VALUES (?, ?, ?, 2, '2026-01-01T00:00:00.000Z')");
  insertTier.run('Tier 1 - Starter', 500000, 80000);
  insertTier.run('Tier 2 - Growth', 1000000, 120000);
  insertTier.run('Tier 3 - Premium', 2000000, 180000);

  db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(4, 1);
  db.prepare('INSERT INTO csr_tier (csrId, tierId) VALUES (?, ?)').run(5, 2);

  const insertInv = db.prepare("INSERT INTO csr_inventory (csrId, productId, quantity, lastUpdated) VALUES (?, ?, ?, '2026-06-01T08:00:00.000Z')");
  insertInv.run(4, 1, 200); insertInv.run(4, 3, 150); insertInv.run(5, 2, 180); insertInv.run(5, 4, 120);

  const insEntry = db.prepare("INSERT INTO sales_entries (csrId, date, isPresent, loggedBy, dayClosed) VALUES (?, ?, 1, 2, 1)");
  insEntry.run(4, '2026-06-26'); insEntry.run(5, '2026-06-26');
  const insItem = db.prepare("INSERT INTO sales_entry_items (entryId, productId, quantity, unitPrice, salesValue) VALUES (?, ?, ?, ?, ?)");
  insItem.run(1, 1, 40, 2500, 100000); insItem.run(2, 2, 50, 4500, 225000);
}

seed();

module.exports = db;
