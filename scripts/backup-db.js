/**
 * Business Bricks B2B Approval System
 * Database Backup Utility
 * Exports all data from the active PostgreSQL database into a timestamped JSON backup file.
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function backupDatabase(connectionUrl, outputDir) {
  const dbUrl = connectionUrl || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required for backup.');
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = outputDir || path.join(__dirname, '../backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`\n📦 Starting database backup from: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);

  try {
    const [applications, statusHistory, auditLogs, appSettings] = await Promise.all([
      prisma.application.findMany({ include: { history: true } }),
      prisma.statusHistory.findMany(),
      prisma.auditLog.findMany(),
      prisma.appSetting.findMany()
    ]);

    const backupData = {
      metadata: {
        exportedAt: new Date().toISOString(),
        sourceUrl: dbUrl.replace(/:[^:@]+@/, ':****@'),
        counts: {
          applications: applications.length,
          statusHistory: statusHistory.length,
          auditLogs: auditLogs.length,
          appSettings: appSettings.length
        }
      },
      data: {
        applications,
        statusHistory,
        auditLogs,
        appSettings
      }
    };

    const filePath = path.join(backupDir, `backup_${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf-8');

    // Also write a latest symlink/copy for convenient reference
    const latestPath = path.join(backupDir, 'backup_latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(backupData, null, 2), 'utf-8');

    console.log(`✔ Backup successfully completed!`);
    console.log(`  File: ${filePath}`);
    console.log(`  Applications: ${applications.length}`);
    console.log(`  Status Histories: ${statusHistory.length}`);
    console.log(`  Audit Logs: ${auditLogs.length}`);
    console.log(`  App Settings: ${appSettings.length}\n`);

    return { filePath, backupData };
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  backupDatabase().catch(err => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
}

module.exports = { backupDatabase };
