/**
 * Shopify Webhook Service
 * Server-side backstop handler for orders/create.
 * Intercepts orders containing semi-custom products placed by unapproved accounts.
 */

const crypto = require('crypto');
const prisma = require('../db');
const shopifyService = require('./shopifyCustomerService');

/**
 * Verify Shopify Webhook HMAC signature
 */
function verifyWebhookHmac(rawBody, hmacHeader, secret = process.env.SHOPIFY_WEBHOOK_SECRET) {
  if (!secret || !hmacHeader) return true; // Permissive if secret not yet configured
  try {
    const generatedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(generatedHmac), Buffer.from(hmacHeader));
  } catch (e) {
    return false;
  }
}

/**
 * Process order.created webhook
 */
async function processOrderCreated(order) {
  const orderId = order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`;
  const orderName = order.name || `#${order.order_number}`;
  const customer = order.customer;
  const lineItems = order.line_items || [];

  console.log(`\n📦 [WEBHOOK] Processing Order Created: ${orderName} (${orderId})`);

  // 1. Check if order contains any semi-custom products
  const semiCustomItems = lineItems.filter(item => {
    // Check line item properties or product tags if present
    const isSemiCustomByTitle = item.title && (
      item.title.toLowerCase().includes('semi-custom') ||
      item.title.toLowerCase().includes('airplane tail fin') ||
      item.title.toLowerCase().includes('brick')
    );
    const hasTierProperty = item.properties && item.properties.some(p => 
      p.name && (p.name.includes('Tier') || p.name.includes('customix'))
    );
    return isSemiCustomByTitle || hasTierProperty;
  });

  if (semiCustomItems.length === 0) {
    console.log(`✔ Order ${orderName} contains no semi-custom items. Normal fulfillment allowed.`);
    return { status: 'IGNORED_STANDARD_ORDER' };
  }

  console.log(`⚠️ Order ${orderName} contains ${semiCustomItems.length} semi-custom line item(s). Verifying B2B approval...`);

  // 2. Check Customer B2B Approval Tag
  let isApproved = false;
  let customerEmail = customer ? customer.email : order.email;

  if (customer && customer.tags) {
    const tags = Array.isArray(customer.tags) ? customer.tags : customer.tags.split(',').map(t => t.trim());
    if (tags.includes('b2b-approved')) {
      isApproved = true;
    }
  }

  // Also cross-reference our local database
  if (!isApproved && customerEmail) {
    const appRecord = await prisma.application.findUnique({
      where: { email: customerEmail.trim().toLowerCase() }
    });
    if (appRecord && appRecord.status === 'APPROVED') {
      isApproved = true;
    }
  }

  // 3. If customer is approved, proceed normally
  if (isApproved) {
    console.log(`✔ Customer ${customerEmail} is verified B2B-approved. Order ${orderName} released for production.`);
    return { status: 'APPROVED_B2B_ORDER' };
  }

  // 4. UNAUTHORIZED ORDER DETECTED: Execute Server-Side Containment
  console.warn(`🚨 UNAUTHORIZED B2B ORDER DETECTED: Order ${orderName} placed by unapproved customer: ${customerEmail}`);

  // A. Add tag 'flagged-unauthorized-b2b' to Order via Shopify GraphQL
  try {
    const tagMutation = `
      mutation tagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node { id }
          userErrors { field message }
        }
      }
    `;
    await shopifyService.executeGraphQL(tagMutation, {
      id: orderId,
      tags: ['flagged-unauthorized-b2b', 'hold-fulfillment']
    });
    console.log(`✔ Tagged order ${orderName} with 'flagged-unauthorized-b2b'`);
  } catch (tagErr) {
    console.warn(`Could not add order tag via GraphQL: ${tagErr.message}`);
  }

  // B. Hold Fulfillment Order via Shopify GraphQL
  try {
    const queryFulfillmentOrders = `
      query getFulfillmentOrders($orderId: ID!) {
        order(id: $orderId) {
          fulfillmentOrders(first: 5) {
            edges {
              node {
                id
                status
              }
            }
          }
        }
      }
    `;
    const foData = await shopifyService.executeGraphQL(queryFulfillmentOrders, { orderId });
    const fulfillmentOrders = foData?.order?.fulfillmentOrders?.edges || [];

    for (const edge of fulfillmentOrders) {
      const foId = edge.node.id;
      const holdMutation = `
        mutation fulfillmentOrderHold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
          fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
            fulfillmentOrder { id status }
            userErrors { field message }
          }
        }
      `;
      await shopifyService.executeGraphQL(holdMutation, {
        id: foId,
        fulfillmentHold: {
          reason: 'OTHER',
          reasonNotes: 'Unauthorized B2B Order: Customer does not have approved wholesale account.'
        }
      });
      console.log(`🔒 Successfully placed fulfillment order ${foId} on HOLD.`);
    }
  } catch (holdErr) {
    console.warn(`Could not hold fulfillment order via GraphQL: ${holdErr.message}`);
  }



  // D. Record in Audit Log
  await prisma.auditLog.create({
    data: {
      actor: 'SERVER_BACKSTOP',
      action: 'UNAUTHORIZED_ORDER_CONTAINED',
      targetId: orderId,
      details: JSON.stringify({
        orderName,
        customerEmail,
        semiCustomItemsCount: semiCustomItems.length,
        total: order.total_price
      })
    }
  });

  return { status: 'CONTAINED_UNAUTHORIZED_ORDER', orderName, customerEmail };
}

module.exports = {
  verifyWebhookHmac,
  processOrderCreated
};
