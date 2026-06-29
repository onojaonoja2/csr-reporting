'use strict';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  fullName VARCHAR(255) NOT NULL,
  phoneNumber VARCHAR(50),
  address TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'csr',
  zone VARCHAR(100),
  state VARCHAR(100),
  lga VARCHAR(100),
  isActive TINYINT NOT NULL DEFAULT 1,
  theme VARCHAR(20) DEFAULT 'light',
  removedBy INT,
  removedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  grammage VARCHAR(100) NOT NULL,
  createdBy INT,
  isActive TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS target_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  monthlyTarget INT NOT NULL DEFAULT 0,
  monthlySalary INT NOT NULL DEFAULT 0,
  createdBy INT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS csr_tier (
  id INT AUTO_INCREMENT PRIMARY KEY,
  csrId INT UNIQUE NOT NULL,
  tierId INT NOT NULL,
  assignedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS csr_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  csrId INT NOT NULL,
  productId INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  lastUpdated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_csr_product (csrId, productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  csrId INT NOT NULL,
  date DATE NOT NULL,
  isPresent TINYINT NOT NULL DEFAULT 1,
  loggedBy INT,
  dayClosed TINYINT NOT NULL DEFAULT 0,
  closedAt DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_entry_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entryId INT NOT NULL,
  productId INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  unitPrice INT NOT NULL DEFAULT 0,
  salesValue INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  csrId INT NOT NULL,
  month VARCHAR(7) NOT NULL,
  totalSales INT NOT NULL DEFAULT 0,
  target INT NOT NULL DEFAULT 0,
  baseSalary INT NOT NULL DEFAULT 0,
  earnedPay INT NOT NULL DEFAULT 0,
  percentTarget INT NOT NULL DEFAULT 0,
  confirmedBy INT,
  confirmedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_csr_month (csrId, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const fks = [
  'ALTER TABLE users ADD FOREIGN KEY (removedBy) REFERENCES users(id)',
  'ALTER TABLE products ADD FOREIGN KEY (createdBy) REFERENCES users(id)',
  'ALTER TABLE target_tiers ADD FOREIGN KEY (createdBy) REFERENCES users(id)',
  'ALTER TABLE csr_tier ADD FOREIGN KEY (csrId) REFERENCES users(id)',
  'ALTER TABLE csr_tier ADD FOREIGN KEY (tierId) REFERENCES target_tiers(id)',
  'ALTER TABLE csr_inventory ADD FOREIGN KEY (csrId) REFERENCES users(id)',
  'ALTER TABLE csr_inventory ADD FOREIGN KEY (productId) REFERENCES products(id)',
  'ALTER TABLE sales_entries ADD FOREIGN KEY (csrId) REFERENCES users(id)',
  'ALTER TABLE sales_entries ADD FOREIGN KEY (loggedBy) REFERENCES users(id)',
  'ALTER TABLE sales_entry_items ADD FOREIGN KEY (entryId) REFERENCES sales_entries(id)',
  'ALTER TABLE sales_entry_items ADD FOREIGN KEY (productId) REFERENCES products(id)',
  'ALTER TABLE payment_history ADD FOREIGN KEY (csrId) REFERENCES users(id)',
  'ALTER TABLE payment_history ADD FOREIGN KEY (confirmedBy) REFERENCES users(id)',
];

module.exports = {
  up: async ({ context: queryInterface }) => {
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      await queryInterface.sequelize.query(stmt);
    }
    for (const fk of fks) {
      try {
        await queryInterface.sequelize.query(fk);
      } catch (e) {
        // constraint may already exist — safe to ignore
      }
    }
  },

  down: async ({ context: queryInterface }) => {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS payment_history');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS sales_entry_items');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS sales_entries');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS csr_inventory');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS csr_tier');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS target_tiers');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS products');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS users');
  }
};
