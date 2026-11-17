const prisma = require('../db');
const { generateEmailVerificationToken, verifyEmailToken } = require('./verificationService');
const shopifyService = require('./shopifyCustomerService');

/**
 * Submit a new wholesale application
 */
async function submitApplication(data) {
  const {
    firstName,
    lastName,
    email,
    company,
    phone,
    businessType,
    address1,
    address2,
    city,
    province,
    zip,
    country,
    website,
    taxId,
    shopifyCustomerId,
    isEmailPreVerified = false
  } = data;

  // 1. Validation
  const errors = [];
  if (!firstName || !firstName.trim()) errors.push('First name is required');
  if (!lastName || !lastName.trim()) errors.push('Last name is required');
  if (!email || !email.trim()) errors.push('Email is required');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('Invalid email address format');
  if (!company || !company.trim()) errors.push('Business name is required');
  if (!phone || !phone.trim()) errors.push('Business phone is required');
  if (!businessType || !businessType.trim()) errors.push('Business type is required');
  if (!address1 || !address1.trim()) errors.push('Address line 1 is required');
  if (!city || !city.trim()) errors.push('City is required');
  if (!zip || !zip.trim()) errors.push('ZIP or postal code is required');
  if (!country || !country.trim()) errors.push('Country is required');

  if (errors.length > 0) {
    const error = new Error(errors.join(', '));
    error.status = 400;
    error.details = errors;
    throw error;
  }

  const cleanEmail = email.trim().toLowerCase();

  // 2. Duplicate Application Check
  const existing = await prisma.application.findUnique({
    where: { email: cleanEmail }
  });

  if (existing) {
    if (existing.status === 'PENDING') {
      const error = new Error('An application for this email is currently pending administrative review.');
      error.status = 409;
      throw error;
    }
    if (existing.status === 'APPROVED') {
      const error = new Error('An approved wholesale account already exists for this email. Please log in.');
      error.status = 409;
      throw error;
    }
  }

  // 3. Generate verification token & reference number
  const verificationToken = generateEmailVerificationToken(cleanEmail);
  const totalAppsCount = await prisma.application.count();
  const nextRefNumber = `BB-APP-${1001 + totalAppsCount}`;

  // 4. Create or update application record
  let application;
  if (existing) {
    // Re-applying after previous rejection/revocation
    application = await prisma.application.update({
      where: { id: existing.id },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        company: company.trim(),
        phone: phone.trim(),
        businessType: businessType.trim(),
        address1: address1.trim(),
        address2: address2 ? address2.trim() : null,
        city: city.trim(),
        province: province ? province.trim() : null,
        zip: zip.trim(),
        country: country.trim(),
        website: website ? website.trim() : null,
        taxId: taxId ? taxId.trim() : null,
        status: 'PENDING',
        shopifyCustomerId: shopifyCustomerId || existing.shopifyCustomerId || null,
        emailVerified: isEmailPreVerified,
        emailVerificationToken: isEmailPreVerified ? null : verificationToken,
        emailVerifiedAt: isEmailPreVerified ? new Date() : null,
        adminNotes: null
      }
    });
  } else {
    application = await prisma.application.create({
      data: {
        referenceNumber: nextRefNumber,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: cleanEmail,
        company: company.trim(),
        phone: phone.trim(),
        businessType: businessType.trim(),
        address1: address1.trim(),
        address2: address2 ? address2.trim() : null,
        city: city.trim(),
        province: province ? province.trim() : null,
        zip: zip.trim(),
        country: country.trim(),
        website: website ? website.trim() : null,
        taxId: taxId ? taxId.trim() : null,
        status: 'PENDING',
        shopifyCustomerId: shopifyCustomerId || null,
        emailVerified: isEmailPreVerified,
        emailVerificationToken: isEmailPreVerified ? null : verificationToken,
        emailVerifiedAt: isEmailPreVerified ? new Date() : null,
        discountType: 'NONE',
        discountValue: 0.0
      }
    });
  }

  // 5. Status history and audit log
  await prisma.statusHistory.create({
    data: {
      applicationId: application.id,
      previousStatus: existing ? existing.status : 'PENDING',
      newStatus: 'PENDING',
      changedBy: 'Applicant',
      reason: existing ? 'Re-submitted application' : 'Initial application submission'
    }
  });

  await prisma.auditLog.create({
    data: {
      actor: cleanEmail,
      action: 'APPLICATION_SUBMITTED',
      targetId: application.id,
      details: JSON.stringify({ company: company.trim(), country: country.trim() })
    }
  });



  return {
    application,
    verificationToken: isEmailPreVerified ? null : verificationToken
  };
}

/**
 * Confirm applicant email ownership with signed token
 */
async function verifyApplicantEmail(email, token) {
  const result = verifyEmailToken(email, token);
  if (!result.valid) {
    const error = new Error(result.error);
    error.status = 400;
    throw error;
  }

  const cleanEmail = email.trim().toLowerCase();
  const application = await prisma.application.findUnique({
    where: { email: cleanEmail }
  });

  if (!application) {
    const error = new Error('Application not found for this email');
    error.status = 404;
    throw error;
  }

  const updated = await prisma.application.update({
    where: { id: application.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerifiedAt: new Date()
    }
  });

  await prisma.auditLog.create({
    data: {
      actor: cleanEmail,
      action: 'EMAIL_VERIFIED',
      targetId: application.id,
      details: JSON.stringify({ verifiedAt: updated.emailVerifiedAt })
    }
  });

  return updated;
}

/**
 * List applications with search, status filtering, and pagination
 */
async function listApplications({ status, search, page = 1, limit = 25 }) {
  const where = {};
  if (status && status !== 'ALL') {
    where.status = status;
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { referenceNumber: { contains: q } },
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { email: { contains: q } },
      { company: { contains: q } },
      { taxId: { contains: q } }
    ];
  }

  const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const [total, items] = await Promise.all([
    prisma.application.count({ where }),
    prisma.application.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        history: {
          orderBy: { timestamp: 'desc' },
          take: 3
        }
      }
    })
  ]);

  return {
    applications: items,
    items,
    pagination: {
      total,
      totalCount: total,
      page: Math.floor(skip / take) + 1,
      limit: take,
      totalPages: Math.ceil(total / take)
    }
  };
}

/**
 * Get application details with full history
 */
async function getApplicationById(id) {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      history: {
        orderBy: { timestamp: 'desc' }
      }
    }
  });

  if (!application) {
    const error = new Error('Application not found');
    error.status = 404;
    throw error;
  }

  return application;
}

/**
 * Approve application
 * Enforces email ownership verification and connects customer ID
 */
async function approveApplication(id, { adminUser = 'Administrator', notes, shopifyCustomerId }) {
  const application = await getApplicationById(id);

  if (application.status === 'APPROVED') {
    return application;
  }

  // Security Check: Customer email ownership verification
  if (!application.emailVerified && !shopifyCustomerId) {
    // If neither email token was verified nor verified customer ID provided, check Shopify
    const shopifyCustomer = await shopifyService.findCustomerByEmail(application.email);
    if (!shopifyCustomer) {
      const error = new Error('Cannot approve: Email ownership has not been verified and no matching Shopify customer exists.');
      error.status = 422;
      throw error;
    }
  }

  let effectiveCustomerId = shopifyCustomerId || application.shopifyCustomerId;

  if (!effectiveCustomerId) {
    try {
      const existing = await shopifyService.findCustomerByEmail(application.email);
      if (existing) {
        effectiveCustomerId = existing.id;
      } else {
        const created = await shopifyService.createCustomer({
          firstName: application.firstName,
          lastName: application.lastName,
          email: application.email,
          company: application.company,
          phone: application.phone,
          tags: ['b2b-approved']
        });
        if (created) effectiveCustomerId = created.id;
      }
    } catch (err) {
      console.warn('Warning checking/creating customer in Shopify:', err.message);
    }
  }

  // 1. Update application in database
  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: 'APPROVED',
      shopifyCustomerId: effectiveCustomerId || null,
      adminNotes: notes !== undefined ? notes : application.adminNotes
    }
  });

  // 2. Write status history
  await prisma.statusHistory.create({
    data: {
      applicationId: id,
      previousStatus: application.status,
      newStatus: 'APPROVED',
      changedBy: adminUser,
      reason: notes || 'Application approved by administrator'
    }
  });

  // 3. Grant B2B approval tags in Shopify if customer ID is connected
  if (effectiveCustomerId) {
    try {
      await shopifyService.grantB2BApproval(effectiveCustomerId);
    } catch (err) {
      console.warn('Warning: Could not sync b2b-approved tag to Shopify customer:', err.message);
    }
  }

  // 4. Audit log
  await prisma.auditLog.create({
    data: {
      actor: adminUser,
      action: 'APPLICATION_APPROVED',
      targetId: id,
      details: JSON.stringify({ email: application.email, shopifyCustomerId: effectiveCustomerId })
    }
  });



  return updated;
}

/**
 * Reject application
 */
async function rejectApplication(id, { adminUser = 'Administrator', reason }) {
  const application = await getApplicationById(id);

  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: 'REJECTED',
      adminNotes: reason || application.adminNotes
    }
  });

  await prisma.statusHistory.create({
    data: {
      applicationId: id,
      previousStatus: application.status,
      newStatus: 'REJECTED',
      changedBy: adminUser,
      reason: reason || 'Application rejected by administrator'
    }
  });

  // Remove B2B approval tag if customer was previously tagged
  if (application.shopifyCustomerId) {
    try {
      await shopifyService.rejectB2BApplication(application.shopifyCustomerId);
    } catch (err) {
      console.warn('Warning: Could not reject tag in Shopify:', err.message);
    }
  }

  await prisma.auditLog.create({
    data: {
      actor: adminUser,
      action: 'APPLICATION_REJECTED',
      targetId: id,
      details: JSON.stringify({ email: application.email, reason })
    }
  });



  return updated;
}

/**
 * Revoke approved customer access
 */
async function revokeAccess(id, { adminUser = 'Administrator', reason }) {
  const application = await getApplicationById(id);

  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: 'REVOKED',
      adminNotes: reason || application.adminNotes
    }
  });

  await prisma.statusHistory.create({
    data: {
      applicationId: id,
      previousStatus: application.status,
      newStatus: 'REVOKED',
      changedBy: adminUser,
      reason: reason || 'Access revoked by administrator'
    }
  });

  if (application.shopifyCustomerId) {
    try {
      await shopifyService.revokeB2BApproval(application.shopifyCustomerId);
    } catch (err) {
      console.warn('Warning: Could not revoke B2B tag in Shopify:', err.message);
    }
  }



  await prisma.auditLog.create({
    data: {
      actor: adminUser,
      action: 'ACCESS_REVOKED',
      targetId: id,
      details: JSON.stringify({ email: application.email, reason })
    }
  });

  return updated;
}

/**
 * Keep/Reset application to Pending status
 */
async function keepPendingApplication(id, { adminUser = 'Administrator', reason }) {
  const application = await getApplicationById(id);

  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: 'PENDING',
      adminNotes: reason || application.adminNotes
    }
  });

  await prisma.statusHistory.create({
    data: {
      applicationId: id,
      previousStatus: application.status,
      newStatus: 'PENDING',
      changedBy: adminUser,
      reason: reason || 'Application kept / reset to Pending'
    }
  });

  if (application.shopifyCustomerId) {
    try {
      await shopifyService.markB2BPending(application.shopifyCustomerId);
    } catch (err) {
      console.warn('Warning: Could not sync b2b-pending tag in Shopify:', err.message);
    }
  }

  await prisma.auditLog.create({
    data: {
      actor: adminUser,
      action: 'APPLICATION_PENDING',
      targetId: id,
      details: JSON.stringify({ email: application.email, reason })
    }
  });

  return updated;
}

/**
 * Configure customer-specific future discount (Prepared in DB, disabled in this release)
 */
async function updateDiscountConfig(id, { discountType = 'NONE', discountValue = 0.0 }) {
  const application = await getApplicationById(id);

  const validTypes = ['NONE', 'PERCENTAGE', 'FIXED'];
  if (!validTypes.includes(discountType)) {
    const error = new Error(`Invalid discount type. Must be one of: ${validTypes.join(', ')}`);
    error.status = 400;
    throw error;
  }

  const updated = await prisma.application.update({
    where: { id },
    data: {
      discountType,
      discountValue: parseFloat(discountValue) || 0.0
    }
  });

  await prisma.auditLog.create({
    data: {
      actor: 'Administrator',
      action: 'DISCOUNT_CONFIG_UPDATED',
      targetId: id,
      details: JSON.stringify({ discountType, discountValue })
    }
  });

  return updated;
}

/**
 * Aggregate counts for Admin Dashboard
 */
async function getDashboardStats() {
  const [total, pending, approved, rejected, revoked] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({ where: { status: 'PENDING' } }),
    prisma.application.count({ where: { status: 'APPROVED' } }),
    prisma.application.count({ where: { status: 'REJECTED' } }),
    prisma.application.count({ where: { status: 'REVOKED' } })
  ]);

  return {
    total,
    pending,
    approved,
    rejected,
    revoked,
    totalApplications: total,
    pendingApplications: pending,
    approvedCustomers: approved,
    rejectedApplications: rejected,
    revokedCustomers: revoked
  };
}

module.exports = {
  submitApplication,
  verifyApplicantEmail,
  listApplications,
  getApplicationById,
  approveApplication,
  rejectApplication,
  revokeAccess,
  keepPendingApplication,
  updateDiscountConfig,
  getDashboardStats
};
