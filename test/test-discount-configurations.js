/**
 * Business Bricks B2B Customer Approval App
 * Discount Configuration & Validation Integration Test
 */

const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');
const settingsService = require('../src/services/settingsService');
const assert = require('assert');

let testAppId = null;

async function runDiscountTests() {
  console.log('\n===============================================================');
  console.log('   BUSINESS BRICKS DISCOUNT CONFIGURATION & VALIDATION TEST    ');
  console.log('===============================================================\n');

  try {
    // 1. Create a temporary test application
    console.log('1. Setting up temporary test application...');
    const result = await applicationService.submitApplication({
      firstName: 'Discount',
      lastName: 'Tester',
      email: `discount.tester.${Date.now()}@example.com`,
      company: 'Discount QA Corp',
      businessType: 'Retailer',
      phone: '+1 555-0199',
      address1: '123 Test St',
      city: 'Salt Lake City',
      province: 'UT',
      zip: '84101',
      country: 'United States'
    });
    const app = result.application;
    testAppId = app.id;
    assert.strictEqual(app.discountType, 'NONE', 'Initial discountType must be NONE');
    assert.strictEqual(Number(app.discountValue), 0, 'Initial discountValue must be 0');
    console.log('  [PASS] Test application created with initial discountType=NONE, value=0');

    // 2. Test Configuration: NONE
    console.log('\n2. Testing Configuration: NONE...');
    const noneApp = await applicationService.updateDiscountConfig(testAppId, {
      discountType: 'NONE',
      discountValue: 0
    });
    assert.strictEqual(noneApp.discountType, 'NONE');
    assert.strictEqual(Number(noneApp.discountValue), 0);
    const retrievedNone = await applicationService.getApplicationById(testAppId);
    assert.strictEqual(retrievedNone.discountType, 'NONE');
    assert.strictEqual(Number(retrievedNone.discountValue), 0);
    console.log('  [PASS] Saved NONE: successfully retrieved as NONE with value 0.0');

    // Also test Settings: NONE
    await settingsService.updateSettings({
      default_discount_type: 'NONE',
      default_discount_value: '0'
    });
    const settingsNone = await settingsService.getAllSettings();
    assert.strictEqual(settingsNone.default_discount_type, 'NONE');
    assert.strictEqual(settingsNone.default_discount_value, '0');
    console.log('  [PASS] Settings default_discount_type saved and retrieved as NONE');

    // 3. Test Configuration: PERCENTAGE
    console.log('\n3. Testing Configuration: PERCENTAGE...');
    const pctApp = await applicationService.updateDiscountConfig(testAppId, {
      discountType: 'PERCENTAGE',
      discountValue: 15.5
    });
    assert.strictEqual(pctApp.discountType, 'PERCENTAGE');
    assert.strictEqual(Number(pctApp.discountValue), 15.5);
    const retrievedPct = await applicationService.getApplicationById(testAppId);
    assert.strictEqual(retrievedPct.discountType, 'PERCENTAGE');
    assert.strictEqual(Number(retrievedPct.discountValue), 15.5);
    console.log('  [PASS] Saved PERCENTAGE (15.5%): successfully retrieved with exact value 15.5%');

    // Also test Settings: PERCENTAGE
    await settingsService.updateSettings({
      default_discount_type: 'PERCENTAGE',
      default_discount_value: '10'
    });
    const settingsPct = await settingsService.getAllSettings();
    assert.strictEqual(settingsPct.default_discount_type, 'PERCENTAGE');
    assert.strictEqual(settingsPct.default_discount_value, '10');
    console.log('  [PASS] Settings default_discount_type saved and retrieved as PERCENTAGE (10%)');

    // 4. Test Configuration: FIXED
    console.log('\n4. Testing Configuration: FIXED...');
    const fixedApp = await applicationService.updateDiscountConfig(testAppId, {
      discountType: 'FIXED',
      discountValue: 25.0
    });
    assert.strictEqual(fixedApp.discountType, 'FIXED');
    assert.strictEqual(Number(fixedApp.discountValue), 25.0);
    const retrievedFixed = await applicationService.getApplicationById(testAppId);
    assert.strictEqual(retrievedFixed.discountType, 'FIXED');
    assert.strictEqual(Number(retrievedFixed.discountValue), 25.0);
    console.log('  [PASS] Saved FIXED ($25.00): successfully retrieved with exact value $25.00');

    // Also test Settings: FIXED
    await settingsService.updateSettings({
      default_discount_type: 'FIXED',
      default_discount_value: '50'
    });
    const settingsFixed = await settingsService.getAllSettings();
    assert.strictEqual(settingsFixed.default_discount_type, 'FIXED');
    assert.strictEqual(settingsFixed.default_discount_value, '50');
    console.log('  [PASS] Settings default_discount_type saved and retrieved as FIXED ($50)');

    // 5. Test Invalid Values and Validation
    console.log('\n5. Testing Invalid Values and Validation Boundaries...');

    // 5a. Negative value in updateDiscountConfig
    try {
      await applicationService.updateDiscountConfig(testAppId, {
        discountType: 'PERCENTAGE',
        discountValue: -10
      });
      assert.fail('Should have rejected negative discount value');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      console.log('  [PASS] Negative discount value rejected with HTTP 400');
    }

    // 5b. Percentage > 100 in updateDiscountConfig
    try {
      await applicationService.updateDiscountConfig(testAppId, {
        discountType: 'PERCENTAGE',
        discountValue: 125
      });
      assert.fail('Should have rejected percentage > 100%');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      console.log('  [PASS] Percentage discount > 100% rejected with HTTP 400');
    }

    // 5c. Invalid discount type
    try {
      await applicationService.updateDiscountConfig(testAppId, {
        discountType: 'INVALID_TYPE',
        discountValue: 10
      });
      assert.fail('Should have rejected invalid discount type');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      console.log('  [PASS] Invalid discount type rejected with HTTP 400');
    }

    // 5d. Settings validation: Negative value
    try {
      await settingsService.updateSettings({
        default_discount_type: 'FIXED',
        default_discount_value: '-20'
      });
      assert.fail('Should have rejected negative settings value');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      console.log('  [PASS] Settings negative discount value rejected with HTTP 400');
    }

    // 5e. Settings validation: Percentage > 100
    try {
      await settingsService.updateSettings({
        default_discount_type: 'PERCENTAGE',
        default_discount_value: '150'
      });
      assert.fail('Should have rejected settings percentage > 100%');
    } catch (err) {
      assert.strictEqual(err.status, 400);
      console.log('  [PASS] Settings percentage > 100% rejected with HTTP 400');
    }

    // 6. Verify Status Changes Do Not Alter Discount or Activate Discount
    console.log('\n6. Testing Status Transitions (Approval / Revocation / Re-approval)...');
    
    // Verify email first so application can be approved
    await applicationService.verifyApplicantEmail(app.email, result.verificationToken);

    // Set a known discount value first
    await applicationService.updateDiscountConfig(testAppId, {
      discountType: 'PERCENTAGE',
      discountValue: 20
    });

    // Approve application
    const approved = await applicationService.approveApplication(testAppId, {
      adminUser: 'Admin QA',
      notes: 'Testing discount preservation during approval'
    });
    assert.strictEqual(approved.status, 'APPROVED');
    assert.strictEqual(approved.discountType, 'PERCENTAGE');
    assert.strictEqual(Number(approved.discountValue), 20);
    console.log('  [PASS] Approval preserved discountType=PERCENTAGE and value=20 unchanged');

    // Revoke access
    const revoked = await applicationService.revokeAccess(testAppId, {
      adminUser: 'Admin QA',
      reason: 'Testing discount preservation during revocation'
    });
    assert.strictEqual(revoked.status, 'REVOKED');
    assert.strictEqual(revoked.discountType, 'PERCENTAGE');
    assert.strictEqual(Number(revoked.discountValue), 20);
    console.log('  [PASS] Revocation preserved discountType=PERCENTAGE and value=20 unchanged');

    // Keep Pending
    const pending = await applicationService.keepPendingApplication(testAppId, {
      adminUser: 'Admin QA',
      reason: 'Testing discount preservation during pending status'
    });
    assert.strictEqual(pending.status, 'PENDING');
    assert.strictEqual(pending.discountType, 'PERCENTAGE');
    assert.strictEqual(Number(pending.discountValue), 20);
    console.log('  [PASS] Keep Pending preserved discountType=PERCENTAGE and value=20 unchanged');

    // 7. Reset default settings to NONE
    await settingsService.updateSettings({
      default_discount_type: 'NONE',
      default_discount_value: '0'
    });
    console.log('\n7. Cleaned up and restored default settings to NONE / 0');

    console.log('\n===============================================================');
    console.log('   ALL DISCOUNT CONFIGURATION & VALIDATION TESTS PASSED!       ');
    console.log('===============================================================\n');
  } finally {
    // Clean up temporary test application
    if (testAppId) {
      try {
        await prisma.statusHistory.deleteMany({ where: { applicationId: testAppId } });
        await prisma.auditLog.deleteMany({ where: { targetId: testAppId } });
        await prisma.application.delete({ where: { id: testAppId } });
        console.log('✔ Cleaned up temporary test application: ' + testAppId);
      } catch (cleanupErr) {
        console.warn('Cleanup warning:', cleanupErr.message);
      }
    }
    await prisma.$disconnect();
  }
}

runDiscountTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
