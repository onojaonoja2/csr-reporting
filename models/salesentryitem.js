const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesEntryItem = sequelize.define('SalesEntryItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    entryId: { type: DataTypes.INTEGER, allowNull: false },
    productId: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, defaultValue: 0 },
    unitPrice: { type: DataTypes.INTEGER, defaultValue: 0 },
    salesValue: { type: DataTypes.INTEGER, defaultValue: 0 }
  }, {
    tableName: 'sales_entry_items',
    timestamps: false
  });

  SalesEntryItem.associate = (models) => {
    SalesEntryItem.belongsTo(models.SalesEntry, { foreignKey: 'entryId', as: 'entry' });
    SalesEntryItem.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
  };

  return SalesEntryItem;
};
