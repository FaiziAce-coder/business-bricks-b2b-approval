const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'business-bricks-customer-approval-secret-key-2026';

/**
 * Generate a cryptographically secure email verification token
 * with embedded timestamp and HMAC signature.
 */
function generateEmailVerificationToken(email) {
  const timestamp = Date.now();
  const payload = `${email}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${hmac}`).toString('base64url');
  return token;
}

/**
 * Validate an email verification token.
 * Ensures the signature matches and token is within 7 days validity.
 */
function verifyEmailToken(email, token, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return { valid: false, error: 'Malformed token structure' };

    const [tokenEmail, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    if (tokenEmail.toLowerCase() !== email.toLowerCase()) {
      return { valid: false, error: 'Email does not match token' };
    }

    if (isNaN(timestamp) || Date.now() - timestamp > maxAgeMs) {
      return { valid: false, error: 'Verification token has expired' };
    }

    const expectedPayload = `${tokenEmail}:${timestampStr}`;
    const expectedHmac = crypto.createHmac('sha256', SECRET).update(expectedPayload).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
      return { valid: false, error: 'Invalid token signature' };
    }

    return { valid: true, verifiedEmail: tokenEmail, verifiedAt: new Date() };
  } catch (err) {
    return { valid: false, error: 'Token validation exception: ' + err.message };
  }
}

/**
 * Verify customer ownership:
 * Checks whether an application is linked to an authentic Shopify customer ID
 * with verified email status.
 */
function verifyCustomerOwnership({ application, authenticatedCustomer }) {
  if (!application || !authenticatedCustomer) {
    return {
      isVerified: false,
      reason: 'Missing application or authenticated customer session'
    };
  }

  // 1. Both must match on email
  const appEmail = application.email.trim().toLowerCase();
  const custEmail = authenticatedCustomer.email ? authenticatedCustomer.email.trim().toLowerCase() : '';

  if (appEmail !== custEmail) {
    return {
      isVerified: false,
      reason: `Authenticated customer email (${custEmail}) does not match application email (${appEmail})`
    };
  }

  // 2. Application must be linked to customer ID or match on customer ID
  if (application.shopifyCustomerId && authenticatedCustomer.id) {
    const appIdNormalized = application.shopifyCustomerId.replace(/^gid:\/\/shopify\/Customer\//, '');
    const custIdNormalized = authenticatedCustomer.id.toString().replace(/^gid:\/\/shopify\/Customer\//, '');

    if (appIdNormalized !== custIdNormalized) {
      return {
        isVerified: false,
        reason: `Linked customer ID (${appIdNormalized}) does not match active session (${custIdNormalized})`
      };
    }
  }

  // 3. Application must have verified email ownership (via token confirmation or verified customer record)
  const isEmailVerified = application.emailVerified === true || authenticatedCustomer.verified_email === true;

  if (!isEmailVerified) {
    return {
      isVerified: false,
      reason: 'Email ownership has not yet been verified'
    };
  }

  return {
    isVerified: true,
    shopifyCustomerId: authenticatedCustomer.id,
    email: appEmail
  };
}

module.exports = {
  generateEmailVerificationToken,
  verifyEmailToken,
  verifyCustomerOwnership
};
