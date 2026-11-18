/**
 * Test: Approved Customer Deletion Protection
 * Verifies that applications with status APPROVED cannot be deleted
 * (individually or in bulk) and must be revoked first.
 */

const assert = require('assert');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');

async function runProtectionTest() {
  console.log('===============================================================');
  console.log('   APPROVED CUSTOMER DELETION PROTECTION TEST                  ');
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
  const testEmail = `protect-approved-${timestamp}@example.com`;
  let app;

  try {
    // 1. Submit an application
    console.log('1. Submitting test application...');
    const subRes = await applicationService.submitApplication({
      firstName: 'Protected',
      lastName: 'Customer',
      email: testEmail,
      company: 'Protected B2B Corp',
      phone: '+1 555-9988',
      businessType: 'Retailer / Store',
      address1: '777 Security Way',
      city: 'Salt Lake City',
      province: 'UT',
      zip: '84101',
      country: 'United States'
    });
    app = subRes.application;
    test(app && app.id, 'Created test application');

    // 2. Mark email verified and approve it
    console.log('2. Approving application...');
    await prisma.application.update({
      where: { id: app.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() }
    });

    const approvedRes = await applicationService.approveApplication(
      app.id,
      { adminUser: 'TestAdmin', reason: 'Wholesale access granted for testing' }
    );
    const approvedApp = approvedRes.application || approvedRes;
    test(approvedApp.status === 'APPROVED', 'Application status updated to APPROVED');

    // 3. Attempt single delete -> MUST FAIL
    console.log('\n3. Testing single delete on APPROVED customer (must be blocked)...');
    let singleDeleteBlocked = false;
    let singleErrorMessage = '';
    try {
      await applicationService.deleteApplication(app.id, { adminUser: 'TestAdmin' });
    } catch (err) {
      singleDeleteBlocked = true;
      singleErrorMessage = err.message;
    }
    test(singleDeleteBlocked, `Single delete was blocked as expected`);
    test(singleErrorMessage.includes('Approved customers cannot be deleted'), `Correct error message: "${singleErrorMessage}"`);

    // Verify still in database
    const checkApp1 = await prisma.application.findUnique({ where: { id: app.id } });
    test(checkApp1 !== null && checkApp1.status === 'APPROVED', 'Application still intact in DB as APPROVED');

    // 4. Attempt bulk delete on APPROVED customer -> MUST FAIL
    console.log('\n4. Testing bulk delete on APPROVED customer (must be blocked)...');
    let bulkDeleteBlocked = false;
    let bulkErrorMessage = '';
    try {
      await applicationService.bulkDeleteApplications([app.id], { adminUser: 'TestAdmin' });
    } catch (err) {
      bulkDeleteBlocked = true;
      bulkErrorMessage = err.message;
    }
    test(bulkDeleteBlocked, `Bulk delete was blocked as expected`);
    test(bulkErrorMessage.includes('Approved customers cannot be deleted'), `Correct error message: "${bulkErrorMessage}"`);

    // 5. Revoke the customer
    console.log('\n5. Revoking customer wholesale access...');
    const revokedRes = await applicationService.revokeAccess(
      app.id,
      { adminUser: 'TestAdmin', reason: 'Revoking access prior to deletion' }
    );
    const revokedApp = revokedRes.application || revokedRes;
    test(revokedApp.status === 'REVOKED', 'Application status successfully transitioned to REVOKED');

    // 6. Delete the revoked application -> MUST SUCCEED
    console.log('\n6. Deleting customer after REVOCATION (must succeed)...');
    const delResult = await applicationService.deleteApplication(app.id, { adminUser: 'TestAdmin' });
    test(delResult.success === true, 'deleteApplication succeeded for revoked customer');

    const checkApp2 = await prisma.application.findUnique({ where: { id: app.id } });
    test(checkApp2 === null, 'Revoked customer permanently deleted from database');

    console.log('\n===============================================================');
    console.log(`   TEST COMPLETED: ${passed} PASSED, ${failed} FAILED               `);
    console.log('===============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    // Cleanup if any remains
    if (app && app.id) {
      await prisma.application.deleteMany({ where: { id: app.id } });
    }
    await prisma.$disconnect();
  }
}

runProtectionTest();
