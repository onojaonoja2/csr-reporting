const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ArchivedMonth = sequelize.define('ArchivedMonth', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    month: { type: DataTypes.STRING(7), allowNull: false, unique: true },
    archivedBy: DataTypes.INTEGER,
    archivedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'archived_months',
    timestamps: false
  });

  ArchivedMonth.associate = (models) => {
    ArchivedMonth.belongsTo(models.User, { foreignKey: 'archivedBy', as: 'archiver' });
  };

  return ArchivedMonth;
};
