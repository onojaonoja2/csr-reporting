const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SalesEntry = sequelize.define('SalesEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    csrId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    isPresent: { type: DataTypes.TINYINT, defaultValue: 1 },
    loggedBy: DataTypes.INTEGER,
    dayClosed: { type: DataTypes.TINYINT, defaultValue: 0 },
    closedAt: DataTypes.DATE
  }, {
    tableName: 'sales_entries',
    timestamps: false,
    indexes: [
      { fields: ['csrId', 'date'] }
    ]
  });

  SalesEntry.associate = (models) => {
    SalesEntry.belongsTo(models.User, { foreignKey: 'csrId', as: 'csr' });
    SalesEntry.belongsTo(models.User, { foreignKey: 'loggedBy', as: 'logger' });
    SalesEntry.hasMany(models.SalesEntryItem, { foreignKey: 'entryId', as: 'items' });
  };

  return SalesEntry;
};
