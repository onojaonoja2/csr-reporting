const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PaymentHistory = sequelize.define('PaymentHistory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    csrId: { type: DataTypes.INTEGER, allowNull: false },
    month: { type: DataTypes.STRING(7), allowNull: false },
    totalSales: { type: DataTypes.INTEGER, defaultValue: 0 },
    target: { type: DataTypes.INTEGER, defaultValue: 0 },
    baseSalary: { type: DataTypes.INTEGER, defaultValue: 0 },
    earnedPay: { type: DataTypes.INTEGER, defaultValue: 0 },
    percentTarget: { type: DataTypes.INTEGER, defaultValue: 0 },
    confirmedBy: DataTypes.INTEGER,
    confirmedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'payment_history',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['csrId', 'month'] }
    ]
  });

  PaymentHistory.associate = (models) => {
    PaymentHistory.belongsTo(models.User, { foreignKey: 'csrId', as: 'csr' });
    PaymentHistory.belongsTo(models.User, { foreignKey: 'confirmedBy', as: 'confirmor' });
  };

  return PaymentHistory;
};
