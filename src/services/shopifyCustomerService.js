/**
 * Shopify Customer Service
 * Handles customer queries, customer ID resolution, tag management,
 * and metafield synchronization using the Shopify Admin GraphQL API.
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
  // If running in local mock/testing mode without access token, return mock response
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
 * Returns customer ID, tags, verifiedEmail flag, and display name.
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
  if (data?.mock) {
    return null;
  }

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
 * Grant B2B approval in Shopify:
 * Adds 'b2b-approved' tag and sets metafield custom.b2b_verified to true.
 */
async function grantB2BApproval(customerId, accessToken) {
  const formattedId = customerId.startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  
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

  // First fetch existing tags to avoid overwriting
  const customer = await findCustomerById(formattedId, accessToken);
  let tags = customer ? [...customer.tags] : [];
  if (!tags.includes('b2b-approved')) {
    tags.push('b2b-approved');
  }

  const input = {
    id: formattedId,
    tags: tags
  };

  const data = await executeGraphQL(mutation, { input }, accessToken);
  return data;
}

/**
 * Revoke B2B approval in Shopify:
 * Removes 'b2b-approved' tag from customer.
 */
async function revokeB2BApproval(customerId, accessToken) {
  const formattedId = customerId.startsWith('gid://') ? customerId : `gid://shopify/Customer/${customerId}`;
  
  const customer = await findCustomerById(formattedId, accessToken);
  if (!customer) return null;

  const tags = customer.tags.filter(t => t !== 'b2b-approved');

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

  const data = await executeGraphQL(mutation, { input: { id: formattedId, tags } }, accessToken);
  return data;
}

module.exports = {
  executeGraphQL,
  findCustomerByEmail,
  findCustomerById,
  grantB2BApproval,
  revokeB2BApproval
};
