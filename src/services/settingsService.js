const prisma = require('../db');

const DEFAULT_SETTINGS = {
  b2b_tag_name: 'b2b-approved',
  require_verified_email: 'true',
  order_hold_enabled: 'true',
  auto_tag_customer: 'true',
  default_discount_type: 'NONE',
  default_discount_value: '0'
};

/**
 * Get all application settings with defaults
 */
async function getAllSettings() {
  const records = await prisma.appSetting.findMany();
  const settingsMap = { ...DEFAULT_SETTINGS };

  for (const record of records) {
    settingsMap[record.key] = record.value;
  }

  return settingsMap;
}

/**
 * Update multiple settings with validation
 */
async function updateSettings(newSettings) {
  // Validate discount settings if provided
  if (newSettings.default_discount_type !== undefined) {
    const validTypes = ['NONE', 'PERCENTAGE', 'FIXED'];
    if (!validTypes.includes(newSettings.default_discount_type)) {
      const err = new Error(`Invalid discount type. Must be one of: ${validTypes.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  if (newSettings.default_discount_value !== undefined) {
    const val = parseFloat(newSettings.default_discount_value);
    if (isNaN(val) || val < 0) {
      const err = new Error('Discount value must be a non-negative number');
      err.status = 400;
      throw err;
    }
    const type = newSettings.default_discount_type || 'NONE';
    if (type === 'PERCENTAGE' && val > 100) {
      const err = new Error('Percentage discount cannot exceed 100%');
      err.status = 400;
      throw err;
    }
  }

  const updates = [];

  for (const [key, value] of Object.entries(newSettings)) {
    if (value !== undefined && value !== null) {
      updates.push(
        prisma.appSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) }
        })
      );
    }
  }

  await prisma.$transaction(updates);
  return getAllSettings();
}

module.exports = {
  getAllSettings,
  updateSettings,
  DEFAULT_SETTINGS
};
