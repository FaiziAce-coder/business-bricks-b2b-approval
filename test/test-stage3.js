const assert = require('assert');
const app = require('../src/server');
const prisma = require('../src/db');

async function runStage3Tests() {
  console.log('--- Starting Stage 3 (Admin Dashboard & Settings) Integration Tests ---');
  let passed = 0;
  let failed = 0;

  function check(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // Start server on a test port
  const server = app.listen(3099);
  const baseUrl = 'http://localhost:3099';

  try {
    // 1. Static Asset Serving
    console.log('\n1. Testing Static Frontend & Assets Serving...');
    const indexRes = await fetch(`${baseUrl}/`);
    const indexHtml = await indexRes.text();
    check(indexRes.status === 200, `GET / returned 200 (got ${indexRes.status})`);
    check(indexHtml.includes('BUSINESS BRICKS'), 'GET / returned index.html containing "BUSINESS BRICKS"');
    check(indexHtml.includes('id="view-dashboard"'), 'index.html contains dashboard view');
    check(indexHtml.includes('id="view-applications"'), 'index.html contains applications view');
    check(indexHtml.includes('id="view-customers"'), 'index.html contains customers view');
    check(indexHtml.includes('id="view-settings"'), 'index.html contains settings view');

    const cssRes = await fetch(`${baseUrl}/app.css`);
    const cssText = await cssRes.text();
    check(cssRes.status === 200 && cssRes.headers.get('content-type').includes('css'), 'GET /app.css returned 200 with CSS content-type');
    check(cssText.includes('--p-color-primary'), 'app.css contains Polaris design tokens');

    const jsRes = await fetch(`${baseUrl}/app.js`);
    const jsText = await jsRes.text();
    check(jsRes.status === 200 && jsRes.headers.get('content-type').includes('javascript'), 'GET /app.js returned 200 with JS content-type');
    check(jsText.includes('loadDashboard'), 'app.js contains dashboard controller logic');

    // 2. Admin Dashboard Stats
    console.log('\n2. Testing Admin Dashboard Stats API...');
    const dashRes = await fetch(`${baseUrl}/api/admin/dashboard`);
    const dashData = await dashRes.json();
    check(dashRes.status === 200, `GET /api/admin/dashboard returned 200`);
    check(dashData.success === true, 'Response marked success: true');
    check(typeof dashData.stats.total === 'number', 'Stats contains numeric total');
    check(typeof dashData.stats.pending === 'number', 'Stats contains numeric pending');
    check(typeof dashData.stats.approved === 'number', 'Stats contains numeric approved');

    // 3. Admin Settings
    console.log('\n3. Testing Admin Settings API...');
    const settingsGetRes = await fetch(`${baseUrl}/api/admin/settings`);
    const settingsGetData = await settingsGetRes.json();
    check(settingsGetRes.status === 200, 'GET /api/admin/settings returned 200');
    check(settingsGetData.settings.admin_notification_recipients.includes('logan@businessbricks.com'), 'Settings contain default logan recipient');
    check(settingsGetData.settings.email_approval_subject.includes('approved'), 'Settings contain approval email subject');

    const updatedRecipient = 'logan@businessbricks.com, orders@businessbricks.com';
    const settingsPutRes = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notification_recipients: updatedRecipient })
    });
    const settingsPutData = await settingsPutRes.json();
    check(settingsPutRes.status === 200, 'PUT /api/admin/settings returned 200');
    check(settingsPutData.settings.admin_notification_recipients === updatedRecipient, 'Settings recipient updated successfully');

    // Restore default
    await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_notification_recipients: 'logan@businessbricks.com' })
    });

    // 4. Inactive Future Discount Configuration
    console.log('\n4. Testing Inactive Future Discount Configuration...');
    const tempApp = await prisma.application.create({
      data: {
        referenceNumber: 'BB-APP-TEST-DISC-2',
        firstName: 'Discount',
        lastName: 'Tester',
        email: 'discount-tester-2@test.com',
        company: 'Discount Co',
        phone: '+1 555 999 8888',
        businessType: 'Retailer / Store',
        address1: '123 Test St',
        city: 'Chicago',
        zip: '60601',
        country: 'United States',
        status: 'APPROVED',
        discountType: 'NONE',
        discountValue: 0.0
      }
    });

    const discRes = await fetch(`${baseUrl}/api/admin/applications/${tempApp.id}/discount`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discountType: 'PERCENTAGE', discountValue: 15.0 })
    });
    const discData = await discRes.json();

    check(discRes.status === 200, 'PUT /api/admin/applications/:id/discount returned 200');
    check(discData.discountType === 'PERCENTAGE', 'Discount type stored as PERCENTAGE');
    check(discData.discountValue === 15.0, 'Discount value stored as 15.0');

    // Clean up
    await prisma.application.delete({ where: { id: tempApp.id } });

    console.log(`\n========================================`);
    console.log(`Stage 3 Tests Completed: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unexpected error in Stage 3 tests:', err);
    process.exit(1);
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

runStage3Tests();
