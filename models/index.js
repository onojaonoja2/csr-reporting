const { Sequelize } = require('sequelize');
const config = require('../config/config');
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
  host: dbConfig.host,
  port: dbConfig.port,
  dialect: dbConfig.dialect,
  timezone: dbConfig.timezone,
  logging: false,
  pool: dbConfig.pool || { max: 10, min: 0, acquire: 30000, idle: 10000 },
  define: dbConfig.define
});

const models = {
  User: require('./user')(sequelize),
  Product: require('./product')(sequelize),
  TargetTier: require('./targettier')(sequelize),
  CsrTier: require('./csrtier')(sequelize),
  CsrInventory: require('./csrinventory')(sequelize),
  SalesEntry: require('./salesentry')(sequelize),
  SalesEntryItem: require('./salesentryitem')(sequelize),
  PaymentHistory: require('./paymenthistory')(sequelize),
};

Object.values(models).forEach(model => {
  if (model.associate) model.associate(models);
});

module.exports = { sequelize, Sequelize, ...models };
