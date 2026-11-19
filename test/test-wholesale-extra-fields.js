const assert = require('assert');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');

async function run() {
  console.log('\n===============================================================');
  console.log('   WHOLESALE NEW FIELDS (ASI, SAGE, PPAI, HOW HEARD) TEST     ');
  console.log('===============================================================\n');

  const testEmail = `wholesale-fields-test-${Date.now()}@example.com`;
  let appId = null;

  try {
    console.log('1. Submitting wholesale application with ASI, SAGE, PPAI, and referral data...');
    const result = await applicationService.submitApplication({
      firstName: 'Promotional',
      lastName: 'Distributor',
      email: testEmail,
      company: 'Promo Bricks Distributing LLC',
      phone: '+1 (555) 777-8899',
      businessType: 'Distributor / Wholesaler',
      address1: '789 Industry Parkway',
      city: 'Chicago',
      province: 'IL',
      zip: '60601',
      country: 'United States',
      asiNumber: 'ASI-123456',
      sageNumber: 'SAGE-98765',
      ppaiNumber: 'PPAI-654321',
      howHeard: 'Trade Show / Event',
      estimatedVolume: '$50,000 – $100,000',
      reasonForApplying: 'Expanding our corporate gift lineup with custom building bricks.',
      shopifyCustomerId: null,
      isEmailPreVerified: false
    });

    assert.ok(result.application.id, 'Application created with valid ID');
    appId = result.application.id;
    console.log('  [PASS] Application created successfully with ID:', appId);

    console.log('\n2. Verifying persisted fields in Neon database...');
    const saved = await prisma.application.findUnique({
      where: { id: appId }
    });

    assert.strictEqual(saved.asiNumber, 'ASI-123456', 'ASI number matches');
    assert.strictEqual(saved.sageNumber, 'SAGE-98765', 'SAGE number matches');
    assert.strictEqual(saved.ppaiNumber, 'PPAI-654321', 'PPAI number matches');
    assert.strictEqual(saved.howHeard, 'Trade Show / Event', 'How heard matches');
    assert.strictEqual(saved.estimatedVolume, '$50,000 – $100,000', 'Estimated volume matches');
    assert.strictEqual(saved.reasonForApplying, 'Expanding our corporate gift lineup with custom building bricks.', 'Reason for applying matches');
    console.log('  [PASS] ASI Number persisted: ASI-123456');
    console.log('  [PASS] SAGE Number persisted: SAGE-98765');
    console.log('  [PASS] PPAI Number persisted: PPAI-654321');
    console.log('  [PASS] How Heard persisted: Trade Show / Event');
    console.log('  [PASS] Estimated Volume persisted: $50,000 – $100,000');
    console.log('  [PASS] Reason for applying persisted successfully');

    console.log('\n3. Testing re-application update with updated values...');
    const updatedResult = await applicationService.submitApplication({
      firstName: 'Promotional',
      lastName: 'Distributor Updated',
      email: testEmail,
      company: 'Promo Bricks Distributing LLC',
      phone: '+1 (555) 777-8899',
      businessType: 'Distributor / Wholesaler',
      address1: '789 Industry Parkway',
      city: 'Chicago',
      province: 'IL',
      zip: '60601',
      country: 'United States',
      asiNumber: 'ASI-999999',
      sageNumber: 'SAGE-11111',
      ppaiNumber: 'PPAI-222222',
      howHeard: 'Referral from a Partner',
      estimatedVolume: '$100,000 – $500,000',
      reasonForApplying: 'Updated reason for applying.',
      shopifyCustomerId: null,
      isEmailPreVerified: false
    }).catch(err => {
      // If status is PENDING, duplicate check returns 409
      assert.strictEqual(err.status, 409);
      console.log('  [PASS] Duplicate check prevents overwriting while PENDING (HTTP 409)');
      return null;
    });

    console.log('\n===============================================================');
    console.log('   ALL WHOLESALE EXTRA FIELDS TESTS PASSED!                   ');
    console.log('===============================================================\n');
  } finally {
    if (appId) {
      await prisma.application.delete({ where: { id: appId } }).catch(() => {});
      console.log('✔ Cleaned up temporary test application');
    }
    await prisma.$disconnect();
  }
}

run();
