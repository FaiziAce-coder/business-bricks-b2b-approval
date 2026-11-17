require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  console.log('--- Cleaning Up Email Records from Neon Database ---');
  
  // 1. Delete email-related Audit Logs
  const deletedLogs = await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actor: 'SYSTEM_EMAIL' },
        { action: { startsWith: 'EMAIL_SENT_' } }
      ]
    }
  });
  console.log(`✓ Deleted ${deletedLogs.count} email audit log records.`);

  // 2. Delete email-related App Settings
  const deletedSettings = await prisma.appSetting.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'email_' } },
        { key: { startsWith: 'admin_notification_' } }
      ]
    }
  });
  console.log(`✓ Deleted ${deletedSettings.count} email settings keys.`);

  // 3. Ensure clean core settings exist
  const coreSettings = [
    { key: 'b2b_tag_name', value: 'b2b-approved' },
    { key: 'require_verified_email', value: 'true' },
    { key: 'order_hold_enabled', value: 'true' },
    { key: 'auto_tag_customer', value: 'true' }
  ];

  for (const s of coreSettings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      update: {},
      create: s
    });
  }
  console.log('✓ Initialized clean core settings.');

  // 4. Verify counts
  const remainingLogs = await prisma.auditLog.count();
  const remainingSettings = await prisma.appSetting.count();
  const remainingApps = await prisma.application.count();
  console.log(`\nRemaining Audit Logs: ${remainingLogs}`);
  console.log(`Remaining App Settings: ${remainingSettings}`);
  console.log(`Applications Intact: ${remainingApps}`);

  await prisma.$disconnect();
}

cleanup().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
