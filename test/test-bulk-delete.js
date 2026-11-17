/**
 * Test Bulk Delete & Single Delete for Customer Approval App
 */

const assert = require('assert');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');

async function runBulkDeleteTests() {
  console.log('===============================================================');
  console.log('   BUSINESS BRICKS BULK DELETE & APPLICATION DELETION TEST     ');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function test(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  const timestamp = Date.now();
  const email1 = `bulk-del-1-${timestamp}@example.com`;
  const email2 = `bulk-del-2-${timestamp}@example.com`;
  const email3 = `bulk-del-3-${timestamp}@example.com`;

  let app1, app2, app3;

  try {
    // Step 1: Create 3 test applications
    console.log('1. Creating test applications...');
    const res1 = await applicationService.submitApplication({
      firstName: 'Alice',
      lastName: 'Tester',
      email: email1,
      company: 'Alice Bricks Co',
      phone: '+1 555-0101',
      businessType: 'Retailer / Store',
      address1: '100 Brick Way',
      city: 'Salt Lake City',
      province: 'UT',
      zip: '84101',
      country: 'United States'
    });
    app1 = res1.application;

    const res2 = await applicationService.submitApplication({
      firstName: 'Bob',
      lastName: 'Tester',
      email: email2,
      company: 'Bob Bricks LLC',
      phone: '+1 555-0102',
      businessType: 'Contractor',
      address1: '200 Brick Way',
      city: 'Provo',
      province: 'UT',
      zip: '84601',
      country: 'United States'
    });
    app2 = res2.application;

    const res3 = await applicationService.submitApplication({
      firstName: 'Charlie',
      lastName: 'Tester',
      email: email3,
      company: 'Charlie Sets Inc',
      phone: '+1 555-0103',
      businessType: 'Distributor',
      address1: '300 Brick Way',
      city: 'Orem',
      province: 'UT',
      zip: '84057',
      country: 'United States'
    });
    app3 = res3.application;

    test(app1 && app1.id, 'Created test application 1');
    test(app2 && app2.id, 'Created test application 2');
    test(app3 && app3.id, 'Created test application 3');

    // Verify initial StatusHistory
    const history1 = await prisma.statusHistory.findMany({ where: { applicationId: app1.id } });
    test(history1.length >= 1, 'Application 1 has StatusHistory recorded');

    // Step 2: Test Single Delete
    console.log('\n2. Testing Single Delete by ID...');
    const delResult = await applicationService.deleteApplication(app1.id, { adminUser: 'Logan Christensen' });
    test(delResult.success === true, 'deleteApplication returned success: true');
    test(delResult.deletedId === app1.id, 'deleteApplication returned correct deletedId');

    const checkApp1 = await prisma.application.findUnique({ where: { id: app1.id } });
    test(checkApp1 === null, 'Application 1 is deleted from database');

    const checkHistory1 = await prisma.statusHistory.findMany({ where: { applicationId: app1.id } });
    test(checkHistory1.length === 0, 'StatusHistory for Application 1 cascaded and deleted');

    const audit1 = await prisma.auditLog.findFirst({
      where: { action: 'APPLICATION_DELETED', targetId: app1.id }
    });
    test(audit1 !== null, 'AuditLog recorded APPLICATION_DELETED for Application 1');

    // Step 3: Test Bulk Delete
    console.log('\n3. Testing Bulk Delete of Application 2 and Application 3...');
    const bulkResult = await applicationService.bulkDeleteApplications([app2.id, app3.referenceNumber], { adminUser: 'Logan Christensen' });
    test(bulkResult.count === 2, `bulkDeleteApplications deleted count is 2 (got ${bulkResult.count})`);
    test(bulkResult.deleted.length === 2, 'bulkDeleteApplications returned 2 deleted records');

    const checkApp2 = await prisma.application.findUnique({ where: { id: app2.id } });
    const checkApp3 = await prisma.application.findUnique({ where: { id: app3.id } });
    test(checkApp2 === null, 'Application 2 deleted from database');
    test(checkApp3 === null, 'Application 3 deleted from database');

    const checkHistory2 = await prisma.statusHistory.findMany({ where: { applicationId: app2.id } });
    const checkHistory3 = await prisma.statusHistory.findMany({ where: { applicationId: app3.id } });
    test(checkHistory2.length === 0, 'StatusHistory for Application 2 cascaded and deleted');
    test(checkHistory3.length === 0, 'StatusHistory for Application 3 cascaded and deleted');

    const auditBulk = await prisma.auditLog.findFirst({
      where: { action: 'APPLICATIONS_BULK_DELETED' }
    });
    test(auditBulk !== null, 'AuditLog recorded APPLICATIONS_BULK_DELETED');

    // Step 4: Edge cases
    console.log('\n4. Testing Edge Cases...');
    const emptyBulk = await applicationService.bulkDeleteApplications([]);
    test(emptyBulk.count === 0, 'Empty bulk delete returns count: 0');

    let notFoundError = false;
    try {
      await applicationService.deleteApplication('non-existent-uuid-12345');
    } catch (e) {
      notFoundError = true;
    }
    test(notFoundError, 'Deleting non-existent application throws error');

    console.log('\n===============================================================');
    console.log(`   BULK DELETE TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED  `);
    console.log('===============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  } finally {
    // Cleanup audit logs created during test
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['APPLICATION_DELETED', 'APPLICATIONS_BULK_DELETED'] },
        details: { contains: timestamp.toString() }
      }
    });
    await prisma.$disconnect();
  }
}

runBulkDeleteTests();
