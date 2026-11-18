require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const applicationService = require('./services/applicationService');
const settingsService = require('./services/settingsService');
const { verifyCustomerOwnership } = require('./services/verificationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Content-Security-Policy to allow embedded execution inside Shopify Admin iframe
app.use((req, res, next) => {
  const shop = req.query.shop || 'business-bricks.myshopify.com';
  res.setHeader(
    'Content-Security-Policy',
    `frame-ancestors https://${shop} https://admin.shopify.com https://*.myshopify.com https://*.spin.dev;`
  );
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Lightweight Health & Keepalive Check (Zero DB queries to allow Neon compute to sleep)
app.get(['/health', '/ping'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json({
    status: 'ok',
    service: 'Business Bricks Customer Approval App',
    databaseQueried: false,
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 0. SHOPIFY OAUTH & EMBEDDED APP ROUTES
// ==========================================

app.get('/auth', (req, res) => {
  const shop = req.query.shop || 'business-bricks.myshopify.com';
  const clientId = process.env.SHOPIFY_CLIENT_ID || 'b511593a1fd3ef26d3c5412bdd504458';
  const scopes = 'read_customers,write_customers,read_orders,write_orders';
  const redirectUri = `${process.env.APP_URL || 'https://business-bricks-customer-approval.onrender.com'}/auth/callback`;
  const state = Date.now().toString();
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, host } = req.query;
  if (!code || !shop) {
    return res.redirect(`/?shop=${shop || 'business-bricks.myshopify.com'}`);
  }

  try {
    const clientId = process.env.SHOPIFY_CLIENT_ID || 'b511593a1fd3ef26d3c5412bdd504458';
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!clientSecret) {
      console.warn('Warning: SHOPIFY_CLIENT_SECRET not configured for OAuth callback');
    }

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = tokenData.access_token;
      const prisma = require('./db');
      await prisma.appSetting.upsert({
        where: { key: 'shopify_access_token' },
        update: { value: tokenData.access_token },
        create: { key: 'shopify_access_token', value: tokenData.access_token }
      });
      console.log('Successfully saved shopify_access_token via OAuth callback');
    } else {
      console.warn('OAuth callback token exchange response:', tokenData);
    }
  } catch (err) {
    console.error('OAuth exchange error:', err);
  }

  const targetHost = host ? `&host=${host}` : '';
  res.redirect(`/?shop=${shop}${targetHost}`);
});

// ==========================================
// 1. PUBLIC STOREFRONT & APPLICATION ROUTES
// ==========================================

/**
 * Submit Customer Application Form
 * Reference form: https://www.brickloot.com/pages/wholesale-signup
 */
app.post('/api/applications', async (req, res) => {
  try {
    const result = await applicationService.submitApplication(req.body);
    res.status(201).json({
      success: true,
      message: 'Application received successfully. Your account is pending administrator review.',
      applicationId: result.application.id,
      referenceNumber: result.application.referenceNumber,
      status: result.application.status,
      emailVerificationRequired: !result.application.emailVerified
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

/**
 * Email ownership verification endpoint
 */
app.get('/api/applications/verify-email', async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token) {
    return res.status(400).json({ success: false, error: 'Email and verification token are required' });
  }

  try {
    const application = await applicationService.verifyApplicantEmail(email, token);
    res.json({
      success: true,
      message: 'Email ownership verified successfully. Your application remains under administrative review.',
      email: application.email,
      verifiedAt: application.emailVerifiedAt
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * Storefront status check endpoint
 * Checks if current customer is approved for semi-custom purchases
 */
app.get('/api/storefront/status', async (req, res) => {
  const { email, customerId } = req.query;
  if (!email) {
    return res.json({ approved: false, status: 'GUEST', message: 'No customer account signed in' });
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const prisma = require('./db');
    const application = await prisma.application.findUnique({
      where: { email: cleanEmail }
    });

    if (!application) {
      return res.json({ approved: false, status: 'NOT_FOUND', message: 'No wholesale application on file' });
    }

    // Verify customer ownership if customerId was provided
    if (customerId && application.shopifyCustomerId) {
      const ownership = verifyCustomerOwnership({
        application,
        authenticatedCustomer: { id: customerId, email: cleanEmail, verified_email: application.emailVerified }
      });

      if (!ownership.isVerified) {
        return res.json({
          approved: false,
          status: 'UNVERIFIED',
          message: 'Customer session does not match verified application records'
        });
      }
    }

    const isApproved = application.status === 'APPROVED';
    res.json({
      approved: isApproved,
      status: application.status,
      emailVerified: application.emailVerified,
      company: application.company
    });
  } catch (err) {
    res.status(500).json({ approved: false, error: err.message });
  }
});

// ==========================================
// 2. ADMIN DASHBOARD & MANAGEMENT ROUTES
// ==========================================

/**
 * Dashboard stats: Total, Pending, Approved, Rejected
 */
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const stats = await applicationService.getDashboardStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Applications list with filters, search, and pagination
 */
app.get('/api/admin/applications', async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const result = await applicationService.listApplications({ status, search, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Single application details with full status history
 */
app.get('/api/admin/applications/:id', async (req, res) => {
  try {
    const application = await applicationService.getApplicationById(req.params.id);
    res.json({ success: true, application });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Approve Application
 */
app.post('/api/admin/applications/:id/approve', async (req, res) => {
  try {
    const { adminUser, notes, shopifyCustomerId } = req.body;
    const application = await applicationService.approveApplication(req.params.id, {
      adminUser,
      notes,
      shopifyCustomerId
    });
    res.json({
      success: true,
      message: 'Application approved successfully',
      application
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Reject Application
 */
app.post('/api/admin/applications/:id/reject', async (req, res) => {
  try {
    const { adminUser, reason } = req.body;
    const application = await applicationService.rejectApplication(req.params.id, { adminUser, reason });
    res.json({
      success: true,
      message: 'Application rejected',
      application
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Revoke Approved Access
 */
app.post('/api/admin/applications/:id/revoke', async (req, res) => {
  try {
    const { adminUser, reason } = req.body;
    const application = await applicationService.revokeAccess(req.params.id, { adminUser, reason });
    res.json({
      success: true,
      message: 'Wholesale access revoked',
      application
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Keep Application Pending
 */
app.post('/api/admin/applications/:id/pending', async (req, res) => {
  try {
    const { adminUser, reason } = req.body;
    const application = await applicationService.keepPendingApplication(req.params.id, { adminUser, reason });
    res.json({
      success: true,
      message: 'Application status set to Pending',
      application
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Configure Customer-Specific Discount (Prepared for future, disabled in this release)
 */
app.put('/api/admin/applications/:id/discount', async (req, res) => {
  try {
    const { discountType, discountValue } = req.body;
    const application = await applicationService.updateDiscountConfig(req.params.id, {
      discountType,
      discountValue
    });
    res.json({
      success: true,
      message: 'Discount setting saved (currently inactive)',
      discountType: application.discountType,
      discountValue: application.discountValue
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * Bulk delete applications
 */
app.post('/api/admin/applications/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Array of application IDs is required' });
    }
    const result = await applicationService.bulkDeleteApplications(ids, { adminUser: 'Administrator' });
    res.json({ success: true, count: result.count, deleted: result.deleted });
  } catch (error) {
    logger.error('Bulk delete applications failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Delete single application
 */
app.delete('/api/admin/applications/:id', async (req, res) => {
  try {
    const result = await applicationService.deleteApplication(req.params.id, { adminUser: 'Administrator' });
    res.json(result);
  } catch (error) {
    logger.error('Delete application failed:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

/**
 * Admin Settings: Get all settings
 */
app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await settingsService.getAllSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Admin Settings: Update settings
 */
app.put('/api/admin/settings', async (req, res) => {
  try {
    const settings = await settingsService.updateSettings(req.body);
    res.json({ success: true, message: 'Settings saved successfully', settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Business Bricks Customer Approval App running on port ${PORT}`);
  });
}

module.exports = app;
