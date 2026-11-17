const prisma = require('../db');

const DEFAULT_SETTINGS = {
  b2b_tag_name: 'b2b-approved',
  require_verified_email: 'true',
  order_hold_enabled: 'true',
  auto_tag_customer: 'true'
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
 * Update multiple settings
 */
async function updateSettings(newSettings) {
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
