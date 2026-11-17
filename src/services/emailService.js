const nodemailer = require('nodemailer');
const settingsService = require('./settingsService');
const prisma = require('../db');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }
  return transporter;
}

/**
 * Render template variables {{varName}}
 */
function renderTemplate(templateString, variables = {}) {
  if (!templateString) return '';
  return templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : '';
  });
}

/**
 * Deliver or log email
 */
async function sendEmail({ to, subject, body, templateType, targetId }) {
  const t = getTransporter();
  const from = process.env.SMTP_FROM || 'Business Bricks <orders@businessbricks.com>';

  const emailRecord = {
    to,
    from,
    subject,
    body,
    templateType,
    sentAt: new Date().toISOString()
  };

  if (t) {
    try {
      await t.sendMail({
        from,
        to,
        subject,
        text: body
      });
      emailRecord.delivered = true;
    } catch (err) {
      console.error(`Failed to send email to ${to}:`, err.message);
      emailRecord.delivered = false;
      emailRecord.error = err.message;
    }
  } else {
    // Development / Local Mode: Log cleanly to console
    console.log(`\n📧 [EMAIL DISPATCH - ${templateType}]`);
    console.log(`To: ${to}`);
    console.log(`From: ${from}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${body}\n`);
    emailRecord.delivered = true;
    emailRecord.mode = 'LOGGED_LOCAL';
  }

  // Record in AuditLog for 100% transparency
  try {
    await prisma.auditLog.create({
      data: {
        actor: 'SYSTEM_EMAIL',
        action: `EMAIL_SENT_${templateType}`,
        targetId: targetId || null,
        details: JSON.stringify(emailRecord)
      }
    });
  } catch (logErr) {
    console.warn('Failed to record email in audit log:', logErr.message);
  }

  return emailRecord;
}

/**
 * 1. Send Application Confirmation to Applicant
 */
async function sendConfirmationEmail(application) {
  const settings = await settingsService.getAllSettings();
  const vars = {
    firstName: application.firstName,
    lastName: application.lastName,
    company: application.company,
    referenceNumber: application.referenceNumber,
    email: application.email
  };

  const subject = renderTemplate(settings.email_confirmation_subject, vars);
  const body = renderTemplate(settings.email_confirmation_body, vars);

  return sendEmail({
    to: application.email,
    subject,
    body,
    templateType: 'CONFIRMATION',
    targetId: application.id
  });
}

/**
 * 2. Send Approval Welcome Email to Customer
 */
async function sendApprovalEmail(application) {
  const settings = await settingsService.getAllSettings();
  const vars = {
    firstName: application.firstName,
    lastName: application.lastName,
    company: application.company,
    referenceNumber: application.referenceNumber,
    email: application.email
  };

  const subject = renderTemplate(settings.email_approval_subject, vars);
  const body = renderTemplate(settings.email_approval_body, vars);

  return sendEmail({
    to: application.email,
    subject,
    body,
    templateType: 'APPROVAL',
    targetId: application.id
  });
}

/**
 * 3. Send Rejection Email to Customer
 */
async function sendRejectionEmail(application, reason = '') {
  const settings = await settingsService.getAllSettings();
  const vars = {
    firstName: application.firstName,
    lastName: application.lastName,
    company: application.company,
    referenceNumber: application.referenceNumber,
    email: application.email,
    reason: reason || 'Requirements not met at this time'
  };

  const subject = renderTemplate(settings.email_rejection_subject, vars);
  const body = renderTemplate(settings.email_rejection_body, vars);

  return sendEmail({
    to: application.email,
    subject,
    body,
    templateType: 'REJECTION',
    targetId: application.id
  });
}

/**
 * 4. Send Revocation Email to Customer
 */
async function sendRevocationEmail(application, reason = '') {
  const settings = await settingsService.getAllSettings();
  const vars = {
    firstName: application.firstName,
    lastName: application.lastName,
    company: application.company,
    referenceNumber: application.referenceNumber,
    email: application.email,
    reason: reason || 'Account eligibility change'
  };

  const subject = renderTemplate(settings.email_revocation_subject, vars);
  const body = renderTemplate(settings.email_revocation_body, vars);

  return sendEmail({
    to: application.email,
    subject,
    body,
    templateType: 'REVOCATION',
    targetId: application.id
  });
}

/**
 * 5. Send Internal Admin Alert for New Wholesale Application
 */
async function sendAdminNewApplicationAlert(application) {
  const settings = await settingsService.getAllSettings();
  const recipients = settings.admin_notification_recipients || 'b2b@businessbricks.com, logan@businessbricks.com';
  const portalUrl = (process.env.APP_URL || 'https://business-bricks-customer-approval.onrender.com').replace(/\/$/, '');

  const subject = `[New Wholesale Application] ${application.company} (${application.referenceNumber})`;
  const body = `A new wholesale customer application has been submitted and is awaiting your review:

Reference: ${application.referenceNumber}
Applicant: ${application.firstName} ${application.lastName}
Company: ${application.company}
Email: ${application.email}
Phone: ${application.phone}
Business Type: ${application.businessType}
Location: ${application.city}, ${application.province || ''} ${application.country}
Website: ${application.website || 'N/A'}
Tax ID: ${application.taxId || 'N/A'}

Review and approve this application in the B2B Customer Approval Portal:
${portalUrl}/#applications`;

  return sendEmail({
    to: recipients,
    subject,
    body,
    templateType: 'ADMIN_ALERT',
    targetId: application.id
  });
}

module.exports = {
  sendConfirmationEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendRevocationEmail,
  sendAdminNewApplicationAlert,
  renderTemplate
};
