const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CsrInventory = sequelize.define('CsrInventory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    csrId: { type: DataTypes.INTEGER, allowNull: false },
    productId: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastUpdated: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'csr_inventory',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['csrId', 'productId'] }
    ]
  });

  CsrInventory.associate = (models) => {
    CsrInventory.belongsTo(models.User, { foreignKey: 'csrId', as: 'csr' });
    CsrInventory.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
  };

  return CsrInventory;
};
