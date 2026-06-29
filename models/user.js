const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    email: { type: DataTypes.STRING(255), unique: true, allowNull: false },
    password: { type: DataTypes.STRING(255), allowNull: false },
    fullName: { type: DataTypes.STRING(255), allowNull: false },
    phoneNumber: DataTypes.STRING(50),
    address: DataTypes.TEXT,
    role: { type: DataTypes.STRING(50), defaultValue: 'csr' },
    zone: DataTypes.STRING(100),
    state: DataTypes.STRING(100),
    lga: DataTypes.STRING(100),
    isActive: { type: DataTypes.TINYINT, defaultValue: 1 },
    theme: { type: DataTypes.STRING(20), defaultValue: 'light' },
    removedBy: DataTypes.INTEGER,
    removedAt: DataTypes.DATE,
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'users',
    timestamps: false,
    indexes: [
      { fields: ['role'] },
      { fields: ['isActive'] }
    ]
  });

  User.associate = (models) => {
    User.hasMany(models.SalesEntry, { foreignKey: 'csrId', as: 'salesEntries' });
    User.hasOne(models.CsrTier, { foreignKey: 'csrId', as: 'csrTier' });
    User.hasMany(models.CsrInventory, { foreignKey: 'csrId', as: 'inventory' });
    User.hasMany(models.PaymentHistory, { foreignKey: 'csrId', as: 'payments' });
    User.belongsTo(models.User, { foreignKey: 'removedBy', as: 'remover' });
  };

  return User;
};
