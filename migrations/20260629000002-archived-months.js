'use strict';

const schema = `
CREATE TABLE IF NOT EXISTS archived_months (
  id INT AUTO_INCREMENT PRIMARY KEY,
  month VARCHAR(7) NOT NULL UNIQUE,
  archivedBy INT,
  archivedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

module.exports = {
  up: async ({ context }) => {
    await context.sequelize.query(schema);
  },
  down: async ({ context }) => {
    await context.sequelize.query('DROP TABLE IF EXISTS archived_months');
  }
};
