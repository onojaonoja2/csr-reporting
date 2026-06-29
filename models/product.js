const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    grammage: { type: DataTypes.STRING(100), allowNull: false },
    createdBy: DataTypes.INTEGER,
    isActive: { type: DataTypes.TINYINT, defaultValue: 1 },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'products',
    timestamps: false
  });

  Product.associate = (models) => {
    Product.hasMany(models.SalesEntryItem, { foreignKey: 'productId', as: 'saleItems' });
    Product.hasMany(models.CsrInventory, { foreignKey: 'productId', as: 'inventoryEntries' });
    Product.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
  };

  return Product;
};
