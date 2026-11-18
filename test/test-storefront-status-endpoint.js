/**
 * Integration Test for Storefront Status Logic (/api/storefront/status)
 * Tests all 5 states: GUEST, NOT_APPLIED, PENDING, APPROVED, REJECTED/REVOKED
 * and customer ID resolution (numeric and GID).
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');

// Create test app using server's route logic
async function runStorefrontStatusTests() {
  console.log('===============================================================');
  console.log('   STOREFRONT STATUS LOGIC & CUSTOMER ID INTEGRATION TEST      ');
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

  const app = require('../src/server');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const timestamp = Date.now();
  const testEmail = `status-test-${timestamp}@example.com`;
  const testCustomerId = `110999${timestamp.toString().slice(-6)}`;
  let createdAppId = null;

  try {
    // 1. Test GUEST State
    console.log('1. Testing GUEST status (no customer signed in)...');
    const guestRes = await fetch(`${baseUrl}/api/storefront/status`).then(r => r.json());
    test(guestRes.approved === false, 'Guest approved is false');
    test(guestRes.applied === false, 'Guest applied is false');
    test(guestRes.status === 'GUEST', 'Guest status is "GUEST"');

    // 2. Test NOT_APPLIED State (authenticated customer who has not applied)
    console.log('\n2. Testing NOT_APPLIED status (customer logged in, no application)...');
    const notAppliedRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=${testCustomerId}&email=${encodeURIComponent(testEmail)}`
    ).then(r => r.json());
    test(notAppliedRes.approved === false, 'Unapplied customer approved is false');
    test(notAppliedRes.applied === false, 'Unapplied customer applied is false');
    test(notAppliedRes.status === 'NOT_APPLIED', 'Unapplied customer status is "NOT_APPLIED"');

    // 3. Test PENDING State (after submitting application)
    console.log('\n3. Testing PENDING status (application submitted)...');
    const subResult = await applicationService.submitApplication({
      firstName: 'Status',
      lastName: 'Tester',
      email: testEmail,
      company: 'Status Test Corp',
      phone: '+1 555-0199',
      businessType: 'Retailer / Store',
      address1: '123 Status Way',
      city: 'Salt Lake City',
      province: 'UT',
      zip: '84101',
      country: 'United States',
      shopifyCustomerId: `gid://shopify/Customer/${testCustomerId}`,
      isEmailPreVerified: true
    });
    createdAppId = subResult.application.id;

    // Query by numeric customerId
    const pendingNumericRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=${testCustomerId}&email=${encodeURIComponent(testEmail)}`
    ).then(r => r.json());
    test(pendingNumericRes.approved === false, 'Pending customer approved is false');
    test(pendingNumericRes.applied === true, 'Pending customer applied is true');
    test(pendingNumericRes.status === 'PENDING', 'Pending status resolved via numeric customerId');
    test(pendingNumericRes.referenceNumber === subResult.application.referenceNumber, 'Returns correct referenceNumber');

    // Query by GID format customerId
    const pendingGidRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=gid://shopify/Customer/${testCustomerId}`
    ).then(r => r.json());
    test(pendingGidRes.status === 'PENDING', 'Pending status resolved via GID customerId');

    // 4. Test APPROVED State
    console.log('\n4. Testing APPROVED status (application approved)...');
    await prisma.application.update({
      where: { id: createdAppId },
      data: { status: 'APPROVED', emailVerified: true }
    });

    const approvedRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=${testCustomerId}`
    ).then(r => r.json());
    test(approvedRes.approved === true, 'Approved customer approved is true');
    test(approvedRes.applied === true, 'Approved customer applied is true');
    test(approvedRes.status === 'APPROVED', 'Approved customer status is "APPROVED"');

    // 5. Test REJECTED State
    console.log('\n5. Testing REJECTED status...');
    await prisma.application.update({
      where: { id: createdAppId },
      data: { status: 'REJECTED' }
    });

    const rejectedRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=${testCustomerId}`
    ).then(r => r.json());
    test(rejectedRes.approved === false, 'Rejected customer approved is false');
    test(rejectedRes.applied === true, 'Rejected customer applied is true');
    test(rejectedRes.status === 'REJECTED', 'Rejected customer status is "REJECTED"');

    // 6. Test REVOKED State
    console.log('\n6. Testing REVOKED status...');
    await prisma.application.update({
      where: { id: createdAppId },
      data: { status: 'REVOKED' }
    });

    const revokedRes = await fetch(
      `${baseUrl}/api/storefront/status?customerId=${testCustomerId}`
    ).then(r => r.json());
    test(revokedRes.approved === false, 'Revoked customer approved is false');
    test(revokedRes.applied === true, 'Revoked customer applied is true');
    test(revokedRes.status === 'REVOKED', 'Revoked customer status is "REVOKED"');

    // 7. Cleanup
    console.log('\n7. Cleaning up test application...');
    await prisma.statusHistory.deleteMany({ where: { applicationId: createdAppId } });
    await prisma.auditLog.deleteMany({ where: { targetId: createdAppId } });
    await prisma.application.delete({ where: { id: createdAppId } });
    createdAppId = null;
    test(true, 'Test application cleaned up from Neon DB');

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    if (createdAppId) {
      try {
        await prisma.statusHistory.deleteMany({ where: { applicationId: createdAppId } });
        await prisma.auditLog.deleteMany({ where: { targetId: createdAppId } });
        await prisma.application.delete({ where: { id: createdAppId } });
      } catch (e) {}
    }
    server.close();
  }

  console.log('\n===============================================================');
  console.log(`   TEST COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) process.exit(1);
}

runStorefrontStatusTests();
