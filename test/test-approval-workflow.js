/**
 * End-to-End Approval Workflow & Lifecycle Integration Test
 */

const assert = require('assert');
const prisma = require('../src/db');
const applicationService = require('../src/services/applicationService');

async function runApprovalLifecycleTests() {
  console.log('===============================================================');
  console.log('   BUSINESS BRICKS B2B APPROVAL WORKFLOW INTEGRATION TEST     ');
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

  const testEmail = `b2b-tester-${Date.now()}@example.com`;

  try {
    // ---------------------------------------------------------
    // STEP 1: Application Submission
    // ---------------------------------------------------------
    console.log('1. Submitting New Wholesale Application...');
    const submissionResult = await applicationService.submitApplication({
      firstName: 'Samantha',
      lastName: 'Miller',
      email: testEmail,
      company: 'Miller Brick Retailers Inc',
      phone: '+1 (555) 789-0123',
      businessType: 'Retailer / Store',
      address1: '456 Commercial Blvd',
      city: 'Dallas',
      province: 'TX',
      zip: '75201',
      country: 'United States',
      website: 'https://millerbricks.example.com',
      taxId: 'TAX-TX-883921'
    });

    const app = submissionResult.application;
    test(app && app.id, 'Application created with valid UUID');
    test(app.referenceNumber && app.referenceNumber.startsWith('BB-APP-'), `Generated reference number: ${app.referenceNumber}`);
    test(app.status === 'PENDING', 'Initial application status is PENDING');
    test(app.company === 'Miller Brick Retailers Inc', 'Business name persisted');

    // Verify AuditLog & StatusHistory for submission
    const history = await prisma.statusHistory.findMany({ where: { applicationId: app.id } });
    test(history.length === 1 && history[0].newStatus === 'PENDING', 'StatusHistory recorded initial PENDING event');

    const audit = await prisma.auditLog.findMany({ where: { targetId: app.id } });
    test(audit.some(a => a.action === 'APPLICATION_SUBMITTED'), 'AuditLog recorded APPLICATION_SUBMITTED action');

    // ---------------------------------------------------------
    // STEP 2: Email Ownership Verification
    // ---------------------------------------------------------
    console.log('\n2. Verifying Applicant Email Ownership...');
    test(submissionResult.verificationToken !== null, 'Signed email verification token generated for guest applicant');

    const verifiedApp = await applicationService.verifyApplicantEmail(testEmail, submissionResult.verificationToken);
    test(verifiedApp.emailVerified === true, 'Application emailVerified marked true');
    test(verifiedApp.emailVerifiedAt !== null, 'Email verification timestamp recorded');

    // ---------------------------------------------------------
    // STEP 3: Administrative Approval
    // ---------------------------------------------------------
    console.log('\n3. Admin Approves Application (Granting B2B Access)...');
    const approvedApp = await applicationService.approveApplication(app.id, {
      adminUser: 'Administrator',
      notes: 'Verified EIN with state business registry. Approved.'
    });

    test(approvedApp.status === 'APPROVED', 'Application status transitioned to APPROVED');
    test(approvedApp.adminNotes.includes('Verified EIN'), 'Admin notes recorded');

    const historyAfterApproval = await prisma.statusHistory.findMany({
      where: { applicationId: app.id },
      orderBy: { timestamp: 'desc' }
    });
    test(historyAfterApproval[0].previousStatus === 'PENDING' && historyAfterApproval[0].newStatus === 'APPROVED', 'Status transition PENDING -> APPROVED recorded in history');
    test(historyAfterApproval[0].changedBy === 'Administrator', 'Status changedBy actor recorded as Administrator (person name sanitized)');

    // ---------------------------------------------------------
    // STEP 4: Storefront Access Status Check
    // ---------------------------------------------------------
    console.log('\n4. Verifying Storefront Status Endpoint Logic...');
    const appLookup = await prisma.application.findUnique({ where: { email: testEmail } });
    test(appLookup.status === 'APPROVED', 'Storefront lookup returns APPROVED status for customer');

    // ---------------------------------------------------------
    // STEP 5: Administrative Revocation
    // ---------------------------------------------------------
    console.log('\n5. Admin Revokes B2B Wholesale Access...');
    const revokedApp = await applicationService.revokeAccess(app.id, {
      adminUser: 'Administrator',
      reason: 'Account audit - resale certificate expired'
    });

    test(revokedApp.status === 'REVOKED', 'Application status transitioned to REVOKED');

    const historyAfterRevocation = await prisma.statusHistory.findMany({
      where: { applicationId: app.id },
      orderBy: { timestamp: 'desc' }
    });
    test(historyAfterRevocation[0].newStatus === 'REVOKED', 'Revocation recorded in StatusHistory');

    // ---------------------------------------------------------
    // STEP 6: Re-Approval
    // ---------------------------------------------------------
    console.log('\n6. Admin Re-Approves Revoked Customer...');
    const reApprovedApp = await applicationService.approveApplication(app.id, {
      adminUser: 'Administrator',
      notes: 'Updated certificate received and verified.'
    });

    test(reApprovedApp.status === 'APPROVED', 'Application restored to APPROVED');

    // ---------------------------------------------------------
    // STEP 7: Rejection Workflow Test
    // ---------------------------------------------------------
    console.log('\n7. Testing Application Rejection Workflow...');
    const rejEmail = `reject-test-${Date.now()}@example.com`;
    const rejSubmission = await applicationService.submitApplication({
      firstName: 'Bob',
      lastName: 'Applicant',
      email: rejEmail,
      company: 'Invalid Hobbyist Co',
      phone: '+1 (555) 111-2222',
      businessType: 'Other',
      address1: '999 Nowhere Ln',
      city: 'Nowhere',
      zip: '00000',
      country: 'United States'
    });

    const rejectedApp = await applicationService.rejectApplication(rejSubmission.application.id, {
      adminUser: 'Administrator',
      reason: 'Personal hobbyist, not a registered commercial entity'
    });

    test(rejectedApp.status === 'REJECTED', 'Application marked REJECTED');
    test(rejectedApp.adminNotes.includes('Personal hobbyist'), 'Rejection reason stored in adminNotes');

    // Clean up test records
    await prisma.statusHistory.deleteMany({ where: { applicationId: { in: [app.id, rejSubmission.application.id] } } });
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [app.id, rejSubmission.application.id] } } });
    await prisma.application.deleteMany({ where: { id: { in: [app.id, rejSubmission.application.id] } } });
    console.log('\n✔ Test cleanup completed');

    console.log('\n===============================================================');
    console.log(`   END-TO-END WORKFLOW RESULTS: ${passed} PASSED, ${failed} FAILED  `);
    console.log('===============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error during workflow test:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runApprovalLifecycleTests();
