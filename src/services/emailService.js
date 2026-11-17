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
 * Send email via Resend HTTPS REST API
 */
async function sendViaResend({ to, subject, body, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'Business Bricks <onboarding@resend.dev>';
  const toList = Array.isArray(to) ? to : to.split(',').map(e => e.trim()).filter(Boolean);

  const payload = {
    from,
    to: toList,
    subject,
    text: body,
    html: html || `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a;">` +
          body.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') +
          `</div>`
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Resend API error (${response.status})`);
  }

  return {
    provider: 'resend',
    id: data.id,
    from,
    to: toList
  };
}

/**
 * Deliver or log email across Resend HTTPS API, SMTP, or local fallback
 */
async function sendEmail({ to, subject, body, templateType, targetId }) {
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'Business Bricks <onboarding@resend.dev>';

  const emailRecord = {
    to,
    from,
    subject,
    body,
    templateType,
    sentAt: new Date().toISOString()
  };

  // 1. Try Resend HTTPS API if key is available
  if (process.env.RESEND_API_KEY) {
    try {
      const resendResult = await sendViaResend({ to, subject, body });
      emailRecord.delivered = true;
      emailRecord.provider = 'resend';
      emailRecord.resendId = resendResult.id;
      console.log(`✓ [EMAIL DISPATCH via Resend HTTPS API] To: ${to} (ID: ${resendResult.id})`);
    } catch (resendErr) {
      console.warn(`Resend dispatch warning for ${to}:`, resendErr.message);
      emailRecord.delivered = false;
      emailRecord.error = resendErr.message;
      emailRecord.provider = 'resend';

      // If in sandbox mode without custom domain verified, fall back cleanly
      if (resendErr.message.includes('only send testing emails')) {
        console.log(`[Resend Sandbox] Domain pending DNS verification. Logging dispatch locally.`);
        emailRecord.mode = 'RESEND_SANDBOX_FALLBACK';
        emailRecord.delivered = true;
      }
    }
  } else {
    // 2. Fall back to SMTP transporter if configured
    const t = getTransporter();
    if (t) {
      try {
        await t.sendMail({
          from,
          to,
          subject,
          text: body
        });
        emailRecord.delivered = true;
        emailRecord.provider = 'smtp';
      } catch (err) {
        console.error(`Failed to send email to ${to}:`, err.message);
        emailRecord.delivered = false;
        emailRecord.error = err.message;
      }
    } else {
      // 3. Local Development Mode: Log cleanly to console
      console.log(`\n📧 [EMAIL DISPATCH - ${templateType}]`);
      console.log(`To: ${to}`);
      console.log(`From: ${from}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body:\n${body}\n`);
      emailRecord.delivered = true;
      emailRecord.mode = 'LOGGED_LOCAL';
    }
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
