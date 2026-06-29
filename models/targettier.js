const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TargetTier = sequelize.define('TargetTier', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    monthlyTarget: { type: DataTypes.INTEGER, defaultValue: 0 },
    monthlySalary: { type: DataTypes.INTEGER, defaultValue: 0 },
    createdBy: DataTypes.INTEGER,
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'target_tiers',
    timestamps: false
  });

  TargetTier.associate = (models) => {
    TargetTier.hasMany(models.CsrTier, { foreignKey: 'tierId', as: 'assignments' });
    TargetTier.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
  };

  return TargetTier;
};
