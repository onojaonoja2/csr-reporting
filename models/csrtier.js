const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CsrTier = sequelize.define('CsrTier', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    csrId: { type: DataTypes.INTEGER, unique: true, allowNull: false },
    tierId: { type: DataTypes.INTEGER, allowNull: false },
    assignedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, {
    tableName: 'csr_tier',
    timestamps: false
  });

  CsrTier.associate = (models) => {
    CsrTier.belongsTo(models.User, { foreignKey: 'csrId', as: 'csr' });
    CsrTier.belongsTo(models.TargetTier, { foreignKey: 'tierId', as: 'tier' });
  };

  return CsrTier;
};
