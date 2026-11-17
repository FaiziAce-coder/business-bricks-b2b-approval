/**
 * Shopify Customer Service
 * Handles customer queries, customer ID resolution, tag management,
 * and customer creation using the Shopify Admin GraphQL API.
 */

const https = require('https');

const getStoreHostname = () => {
  const domain = process.env.SHOPIFY_STORE_DOMAIN || 'business-bricks.myshopify.com';
  if (domain.includes('promo.businessbricks.com') || !domain.includes('.myshopify.com')) {
    return 'business-bricks.myshopify.com';
  }
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

const API_VERSION = '2026-10';

/**
 * Retrieve active Shopify Admin API access token.
 * Reads from process.env, falls back to AppSetting in database, or token exchange.
 */
async function getAdminAccessToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  }

  try {
    const prisma = require('../db');
    const setting = await prisma.appSetting.findUnique({
      where: { key: 'shopify_access_token' }
    });
    if (setting?.value) {
      process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = setting.value;
      return setting.value;
    }
  } catch (err) {
    console.warn('Warning: Could not fetch shopify_access_token from DB:', err.message);
  }

  return null;
}

/**
 * Execute a GraphQL query or mutation against Shopify Admin API.
 */
async function executeGraphQL(query, variables = {}, accessToken) {
  const token = accessToken || await getAdminAccessToken();
  if (!token) {
    return { mock: true, message: 'Running without active Shopify token' };
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: getStoreHostname(),
      path: `/admin/api/${API_VERSION}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.errors) {
            reject(new Error(JSON.stringify(parsed.errors)));
          } else {
            resolve(parsed.data);
          }
        } catch (e) {
          reject(new Error('Invalid JSON response from Shopify GraphQL: ' + body));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Find customer by email in Shopify.
 * Returns exact customer node with id, email, tags, verifiedEmail, and account state.
 */
async function findCustomerByEmail(email, accessToken) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();

  const query = `
    query findCustomer($query: String!) {
      customers(first: 5, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            tags
            verifiedEmail
            state
          }
        }
      }
    }
  `;

  const data = await executeGraphQL(query, { query: `email:${cleanEmail}` }, accessToken);
  if (data?.mock) return null;

  const edges = data?.customers?.edges || [];
  if (edges.length === 0) return null;

  // Prioritize exact email match
  const match = edges.find(e => e.node?.email?.toLowerCase() === cleanEmail);
  return match ? match.node : edges[0].node;
}

/**
 * Find customer by Shopify ID.
 */
async function findCustomerById(customerId, accessToken) {
  if (!customerId) return null;

  const query = `
    query getCustomer($id: ID!) {
      customer(id: $id) {
        id
        firstName
        lastName
        email
        tags
        verifiedEmail
        state
      }
    }
  `;

  const formattedId = customerId.toString().startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  const data = await executeGraphQL(query, { id: formattedId }, accessToken);
  if (data?.mock) return null;
  return data?.customer || null;
}

/**
 * Create a new customer profile in Shopify if one does not exist.
 * Avoids duplicate customer records by querying by email first.
 */
async function createCustomer({ firstName, lastName, email, company, phone, tags = ['b2b-approved'] }, accessToken) {
  if (!email) throw new Error('Email is required to create a customer');
  const cleanEmail = email.trim().toLowerCase();

  // Guard against duplicate creation
  const existing = await findCustomerByEmail(cleanEmail, accessToken);
  if (existing) {
    return existing;
  }

  const mutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          firstName
          lastName
          email
          tags
          verifiedEmail
          state
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Format phone to E.164 if possible
  let formattedPhone = undefined;
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      formattedPhone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      formattedPhone = `+${digits}`;
    } else if (phone.startsWith('+')) {
      formattedPhone = phone.replace(/[^\d+]/g, '');
    }
  }

  const notes = [];
  if (company) notes.push(`Wholesale Company: ${company}`);
  if (phone && !formattedPhone) notes.push(`Contact Phone: ${phone}`);

  const input = {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    email: cleanEmail,
    phone: formattedPhone,
    note: notes.length > 0 ? notes.join(' | ') : undefined,
    tags
  };

  const data = await executeGraphQL(mutation, { input }, accessToken);
  if (data?.mock) return { id: 'gid://shopify/Customer/mock-id', ...input, verifiedEmail: false, state: 'DISABLED' };

  if (data?.customerCreate?.userErrors && data.customerCreate.userErrors.length > 0) {
    const errors = data.customerCreate.userErrors;
    // If phone specifically failed, retry without phone field and place in notes
    if (errors.some(e => e.field && e.field.includes('phone'))) {
      const retryInput = {
        ...input,
        phone: undefined,
        note: (input.note ? input.note + ' | ' : '') + `Phone: ${phone}`
      };
      const retryData = await executeGraphQL(mutation, { input: retryInput }, accessToken);
      if (retryData?.customerCreate?.customer) {
        return retryData.customerCreate.customer;
      }
    }
    throw new Error(errors.map(e => e.message).join(', '));
  }

  return data?.customerCreate?.customer || null;
}

/**
 * Synchronize B2B status tags on a customer:
 * Handles b2b-pending, b2b-approved, and b2b-rejected consistently
 * while preserving any non-B2B custom tags.
 */
async function syncCustomerStatusTag(customerId, newStatus, accessToken) {
  if (!customerId) return null;
  const formattedId = customerId.toString().startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  const customer = await findCustomerById(formattedId, accessToken);
  if (!customer) return null;

  // Filter out existing B2B status tags to prevent conflicting states
  const preservedTags = (customer.tags || []).filter(t => !['b2b-approved', 'b2b-pending', 'b2b-rejected'].includes(t.toLowerCase()));

  if (newStatus === 'APPROVED') {
    preservedTags.push('b2b-approved');
  } else if (newStatus === 'PENDING') {
    preservedTags.push('b2b-pending');
  } else if (newStatus === 'REJECTED' || newStatus === 'REVOKED') {
    preservedTags.push('b2b-rejected');
  }

  const mutation = `
    mutation customerUpdate($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer {
          id
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  return await executeGraphQL(mutation, { input: { id: formattedId, tags: preservedTags } }, accessToken);
}

async function grantB2BApproval(customerId, accessToken) {
  return syncCustomerStatusTag(customerId, 'APPROVED', accessToken);
}

async function rejectB2BApplication(customerId, accessToken) {
  return syncCustomerStatusTag(customerId, 'REJECTED', accessToken);
}

async function revokeB2BApproval(customerId, accessToken) {
  return syncCustomerStatusTag(customerId, 'REVOKED', accessToken);
}

async function markB2BPending(customerId, accessToken) {
  return syncCustomerStatusTag(customerId, 'PENDING', accessToken);
}

module.exports = {
  getAdminAccessToken,
  executeGraphQL,
  findCustomerByEmail,
  findCustomerById,
  createCustomer,
  syncCustomerStatusTag,
  grantB2BApproval,
  rejectB2BApplication,
  revokeB2BApproval,
  markB2BPending
};
