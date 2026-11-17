require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  console.log('Testing Neon connection with URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:]+@/, ':****@') : 'NONE');
  const appCount = await prisma.application.count();
  const historyCount = await prisma.statusHistory.count();
  const auditCount = await prisma.auditLog.count();
  console.log(`Applications: ${appCount}`);
  console.log(`Status History: ${historyCount}`);
  console.log(`Audit Logs: ${auditCount}`);
  await prisma.$disconnect();
}

check().catch(console.error);
