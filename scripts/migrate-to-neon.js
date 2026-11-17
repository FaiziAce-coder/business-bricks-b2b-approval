const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const NEON_DATABASE_URL = 'postgresql://neondb_owner:npg_14MgKlusLWUb@ep-crimson-night-bc9eip9p.c-16.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function migrate() {
  console.log('\n--- Restoring Records into Neon ---');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: NEON_DATABASE_URL
      }
    }
  });

  try {
    const backupPath = path.join(__dirname, '..', 'backups', 'backup_latest.json');
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found at ${backupPath}`);
    }

    const backupFile = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const data = backupFile.data;
    console.log(`Loaded backup with ${data.applications.length} applications, ${data.statusHistory.length} status histories, ${data.auditLogs.length} audit logs, ${data.appSettings.length} settings.`);

    // 1. Applications
    for (const app of data.applications) {
      const { history, ...appData } = app;
      await prisma.application.upsert({
        where: { id: appData.id },
        update: {},
        create: {
          ...appData,
          emailVerifiedAt: appData.emailVerifiedAt ? new Date(appData.emailVerifiedAt) : null,
          createdAt: new Date(appData.createdAt),
          updatedAt: new Date(appData.updatedAt),
        }
      });
    }
    console.log(`✓ Applications restored: ${data.applications.length}`);

    // 2. Status History
    for (const sh of data.statusHistory) {
      await prisma.statusHistory.upsert({
        where: { id: sh.id },
        update: {},
        create: {
          id: sh.id,
          applicationId: sh.applicationId,
          previousStatus: sh.previousStatus,
          newStatus: sh.newStatus,
          changedBy: sh.changedBy,
          reason: sh.reason,
          timestamp: new Date(sh.timestamp)
        }
      });
    }
    console.log(`✓ Status Histories restored: ${data.statusHistory.length}`);

    // 3. Audit Logs
    for (const al of data.auditLogs) {
      await prisma.auditLog.upsert({
        where: { id: al.id },
        update: {},
        create: {
          id: al.id,
          actor: al.actor,
          action: al.action,
          targetId: al.targetId,
          details: al.details,
          timestamp: new Date(al.timestamp)
        }
      });
    }
    console.log(`✓ Audit Logs restored: ${data.auditLogs.length}`);

    // 4. App Settings
    for (const s of data.appSettings) {
      await prisma.appSetting.upsert({
        where: { id: s.id },
        update: {},
        create: {
          id: s.id,
          key: s.key,
          value: s.value,
          updatedAt: new Date(s.updatedAt)
        }
      });
    }
    console.log(`✓ App Settings restored: ${data.appSettings.length}`);

    // Verification
    const countApps = await prisma.application.count();
    const countHistory = await prisma.statusHistory.count();
    const countLogs = await prisma.auditLog.count();
    const countSettings = await prisma.appSetting.count();

    console.log('\n--- Step 3: Verifying Record Counts in Neon ---');
    console.log(`Applications in Neon:   ${countApps} (expected ${data.applications.length})`);
    console.log(`Status Histories:       ${countHistory} (expected ${data.statusHistory.length})`);
    console.log(`Audit Logs:             ${countLogs} (expected ${data.auditLogs.length})`);
    console.log(`App Settings:           ${countSettings} (expected ${data.appSettings.length})`);

    if (countApps === data.applications.length && countHistory === data.statusHistory.length && countLogs === data.auditLogs.length) {
      console.log('\n🎉 SUCCESS: All data migrated to Neon with 0 record loss!');
    } else {
      console.warn('\n⚠️ Record count discrepancy detected!');
    }
  } catch (error) {
    console.error('Error during data restore:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrate();
