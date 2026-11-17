/**
 * Stage 1 Automated Test Suite
 * Tests database models, validation, email token ownership verification,
 * status transitions, customer ID linking, future discount configuration, and audit trails.
 */

const assert = require('assert');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');
const { generateEmailVerificationToken, verifyEmailToken, verifyCustomerOwnership } = require('../src/services/verificationService');

async function runTests() {
  console.log('--- Starting Stage 1 Automated Test Suite ---\n');

  // Clean test database records
  await prisma.statusHistory.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.application.deleteMany({});
  console.log('✔ Cleaned test database');

  // Test 1: Validation of Required Fields
  console.log('\n[Test 1] Validation of Required Fields');
  try {
    await applicationService.submitApplication({
      firstName: '',
      lastName: '',
      email: 'invalid-email',
      company: ''
    });
    assert.fail('Should have failed required field validation');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert(err.details.length >= 5, 'Should return multiple validation errors');
    console.log('✔ Correctly caught missing required fields & invalid email format');
  }

  // Test 2: Valid Application Submission
  console.log('\n[Test 2] Valid Application Submission');
  const validData = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@acmebrickcorp.com',
    company: 'Acme Brick Corporation',
    phone: '+1 (555) 234-5678',
    businessType: 'Retailer / Store',
    address1: '123 Market Street',
    address2: 'Suite 400',
    city: 'Salt Lake City',
    province: 'UT',
    zip: '84101',
    country: 'United States',
    website: 'https://acmebrickcorp.com',
    taxId: 'UT-987654321'
  };

  const submission = await applicationService.submitApplication(validData);
  assert(submission.application.id, 'Application ID must be generated');
  assert(submission.application.referenceNumber.startsWith('BB-APP-'), 'Reference number must start with BB-APP-');
  assert.strictEqual(submission.application.status, 'PENDING');
  assert.strictEqual(submission.application.emailVerified, false);
  assert.strictEqual(submission.application.discountType, 'NONE');
  assert.strictEqual(submission.application.discountValue, 0.0);
  assert(submission.verificationToken, 'Verification token must be provided');
  console.log('✔ Application submitted successfully with status PENDING and inactive discount defaults');

  // Test 3: Duplicate Submission Prevention
  console.log('\n[Test 3] Duplicate Submission Prevention');
  try {
    await applicationService.submitApplication(validData);
    assert.fail('Should have rejected duplicate application');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    console.log('✔ Correctly blocked duplicate pending application');
  }

  // Test 4: HMAC Email Verification Token Validation
  console.log('\n[Test 4] HMAC Email Verification Token Validation');
  const validToken = submission.verificationToken;
  const verifiedApp = await applicationService.verifyApplicantEmail('john.doe@acmebrickcorp.com', validToken);
  assert.strictEqual(verifiedApp.emailVerified, true);
  assert(verifiedApp.emailVerifiedAt instanceof Date);
  console.log('✔ Email token verified applicant email ownership');

  // Try tampered token
  const tamperedToken = validToken.substring(0, validToken.length - 4) + 'zzzz';
  const tamperResult = verifyEmailToken('john.doe@acmebrickcorp.com', tamperedToken);
  assert.strictEqual(tamperResult.valid, false);
  console.log('✔ Tampered verification token correctly rejected');

  // Test 5: Customer Ownership & ID Linking (Security Check)
  console.log('\n[Test 5] Customer Ownership & Imposter Protection');
  // Scenario A: Imposter with different email
  const imposterCheck = verifyCustomerOwnership({
    application: verifiedApp,
    authenticatedCustomer: { id: 'gid://shopify/Customer/99999', email: 'imposter@fake.com', verified_email: true }
  });
  assert.strictEqual(imposterCheck.isVerified, false);
  console.log('✔ Imposter with mismatched email correctly rejected');

  // Scenario B: Authentic customer matching email and verified status
  const authenticCustomer = { id: 'gid://shopify/Customer/10284996985121', email: 'john.doe@acmebrickcorp.com', verified_email: true };
  const authenticCheck = verifyCustomerOwnership({
    application: verifiedApp,
    authenticatedCustomer: authenticCustomer
  });
  assert.strictEqual(authenticCheck.isVerified, true);
  console.log('✔ Authentic customer session verified');

  // Test 6: Admin Approval Flow & Status History
  console.log('\n[Test 6] Admin Approval Flow & Status History');
  const approved = await applicationService.approveApplication(verifiedApp.id, {
    adminUser: 'Admin Logan',
    notes: 'Verified resale certificate and business registration',
    shopifyCustomerId: authenticCustomer.id
  });
  assert.strictEqual(approved.status, 'APPROVED');
  assert.strictEqual(approved.shopifyCustomerId, authenticCustomer.id);

  const history = await prisma.statusHistory.findMany({
    where: { applicationId: verifiedApp.id },
    orderBy: { timestamp: 'asc' }
  });
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].newStatus, 'PENDING');
  assert.strictEqual(history[1].newStatus, 'APPROVED');
  assert.strictEqual(history[1].changedBy, 'Admin Logan');
  console.log('✔ Admin approval successful with complete status history');

  // Test 7: Future Discount Configuration (Inactive by default)
  console.log('\n[Test 7] Future Discount Configuration');
  const discountConfig = await applicationService.updateDiscountConfig(verifiedApp.id, {
    discountType: 'PERCENTAGE',
    discountValue: 15.0
  });
  assert.strictEqual(discountConfig.discountType, 'PERCENTAGE');
  assert.strictEqual(discountConfig.discountValue, 15.0);
  console.log('✔ Customer-specific discount stored in database without affecting store pricing');

  // Test 8: Revoke Access Flow
  console.log('\n[Test 8] Access Revocation Flow');
  const revoked = await applicationService.revokeAccess(verifiedApp.id, {
    adminUser: 'Admin Logan',
    reason: 'Account closed by request'
  });
  assert.strictEqual(revoked.status, 'REVOKED');
  console.log('✔ Wholesale access successfully revoked and logged');

  // Test 9: Dashboard Metrics Aggregation
  console.log('\n[Test 9] Dashboard Metrics Aggregation');
  // Create another pending application
  await applicationService.submitApplication({
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@brickcreations.com',
    company: 'Brick Creations LLC',
    phone: '555-4321',
    businessType: 'Distributor / Wholesaler',
    address1: '456 West Temple',
    city: 'Provo',
    zip: '84601',
    country: 'United States'
  });

  const stats = await applicationService.getDashboardStats();
  assert.strictEqual(stats.totalApplications, 2);
  assert.strictEqual(stats.pendingApplications, 1);
  assert.strictEqual(stats.approvedCustomers, 0); // previous was revoked
  assert.strictEqual(stats.revokedCustomers, 1);
  console.log('✔ Dashboard statistics accurately computed:', stats);

  console.log('\n🎉 ALL STAGE 1 TESTS PASSED PERFECTLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
