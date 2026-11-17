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
 * Execute a GraphQL query or mutation against Shopify Admin API.
 */
async function executeGraphQL(query, variables = {}, accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
  if (!accessToken) {
    return { mock: true, message: 'Running in local dev mode without active token' };
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: getStoreHostname(),
      path: `/admin/api/${API_VERSION}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
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
 */
async function findCustomerByEmail(email, accessToken) {
  const query = `
    query findCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            tags
            verifiedEmail
          }
        }
      }
    }
  `;

  const data = await executeGraphQL(query, { query: `email:${email}` }, accessToken);
  if (data?.mock) return null;

  const edge = data?.customers?.edges?.[0];
  if (!edge) return null;

  return edge.node;
}

/**
 * Find customer by Shopify ID.
 */
async function findCustomerById(customerId, accessToken) {
  const query = `
    query getCustomer($id: ID!) {
      customer(id: $id) {
        id
        firstName
        lastName
        email
        tags
        verifiedEmail
      }
    }
  `;

  const formattedId = customerId.startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  const data = await executeGraphQL(query, { id: formattedId }, accessToken);
  if (data?.mock) return null;
  return data?.customer || null;
}

/**
 * Create a new customer profile in Shopify if one does not exist.
 */
async function createCustomer({ firstName, lastName, email, company, phone, tags = ['b2b-pending'] }, accessToken) {
  const mutation = `
    mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer {
          id
          firstName
          lastName
          email
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const input = {
    firstName,
    lastName,
    email,
    phone: phone ? phone.replace(/[^\d+]/g, '') : undefined,
    note: company ? `Wholesale Company: ${company}` : undefined,
    tags
  };

  const data = await executeGraphQL(mutation, { input }, accessToken);
  if (data?.mock) return { id: 'gid://shopify/Customer/mock-id', ...input };

  if (data?.customerCreate?.userErrors && data.customerCreate.userErrors.length > 0) {
    throw new Error(data.customerCreate.userErrors.map(e => e.message).join(', '));
  }

  return data?.customerCreate?.customer || null;
}

/**
 * Synchronize B2B status tags on a customer:
 * Handles b2b-pending, b2b-approved, and b2b-rejected consistently
 * while preserving any non-B2B custom tags.
 */
async function syncCustomerStatusTag(customerId, newStatus, accessToken) {
  const formattedId = customerId.startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  const customer = await findCustomerById(formattedId, accessToken);
  if (!customer) return null;

  // Filter out any existing B2B status tags to avoid contradictory states
  const preservedTags = customer.tags.filter(t => !['b2b-approved', 'b2b-pending', 'b2b-rejected'].includes(t.toLowerCase()));

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
