const prisma = require('../db');

const DEFAULT_SETTINGS = {
  email_confirmation_subject: 'We received your wholesale application — Business Bricks',
  email_confirmation_body: 'Hi {{firstName}},\n\nThank you for applying for wholesale access to Business Bricks. Your application (Ref: {{referenceNumber}}) has been received and is currently under administrative review.\n\nOur team will review your business details and notify you once your account has been approved.\n\nBest regards,\nThe Business Bricks Team',
  
  email_approval_subject: 'Your Business Bricks wholesale account is approved!',
  email_approval_body: 'Hi {{firstName}},\n\nCongratulations! Your application for wholesale purchasing access with Business Bricks (Ref: {{referenceNumber}}) has been approved.\n\nYou can now browse and purchase our semi-custom collections directly at:\nhttps://promo.businessbricks.com/pages/semi-custom-sets\n\nTo access approved purchasing, simply sign in using your application email ({{email}}). Shopify will deliver a 6-digit one-time access code to your inbox.\n\nBest regards,\nLogan Christensen\nBusiness Bricks',
  
  email_rejection_subject: 'Update regarding your Business Bricks wholesale application',
  email_rejection_body: 'Hi {{firstName}},\n\nThank you for your interest in Business Bricks. After reviewing your application (Ref: {{referenceNumber}}), we are unable to approve wholesale purchasing access at this time.\n\n{{#if reason}}Reason: {{reason}}\n{{/if}}\nIf you have any questions or wish to provide additional documentation, please contact our team.\n\nBest regards,\nThe Business Bricks Team',
  
  admin_notification_recipients: 'logan@businessbricks.com',
  admin_notification_enabled: 'true'
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
