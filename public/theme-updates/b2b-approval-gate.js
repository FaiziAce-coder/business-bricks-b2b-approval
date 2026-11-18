/**
 * Business Bricks B2B Storefront Purchasing Interceptor & Status Resolver
 * Guards semi-custom product catalog from unapproved add-to-cart & checkout attempts.
 * Authoritatively verifies wholesale application status via Shopify Customer ID.
 */

(function () {
  'use strict';

  // Read customer approval status and identity injected from Liquid
  let isApproved = Boolean(window.BB_CUSTOMER_APPROVED);
  const customerId = window.BB_CUSTOMER_ID || null;
  const customerEmail = window.BB_CUSTOMER_EMAIL || null;
  const apiBaseUrl = window.BB_API_BASE_URL || 'https://business-bricks-customer-approval.onrender.com';

  function getCardContainer() {
    return document.getElementById('b2bAccessCardContainer');
  }

  function getAddToCartBtn() {
    return document.getElementById('bbAddToCartBtn') || document.querySelector('button[name="add"].add-to-cart');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Update Storefront UI according to live status from backend
  function updateStorefrontState(statusData) {
    const cardContainer = getCardContainer();
    const addBtn = getAddToCartBtn();
    const isSemiCustom = window.BB_IS_SEMI_CUSTOM || (document.querySelector('[data-semi-custom="true"]') !== null);

    if (!isSemiCustom) return;

    if (statusData.approved === true || statusData.status === 'APPROVED') {
      isApproved = true;
      window.BB_CUSTOMER_APPROVED = true;

      // Hide restriction card
      if (cardContainer) {
        cardContainer.style.display = 'none';
      }

      // Show and enable Add to Cart button
      if (addBtn) {
        addBtn.style.setProperty('display', 'block', 'important');
        addBtn.classList.remove('b2b-disabled');
        addBtn.removeAttribute('disabled');
        addBtn.removeAttribute('aria-hidden');
      }
      return;
    }

    // Customer is NOT approved
    isApproved = false;
    window.BB_CUSTOMER_APPROVED = false;

    // Ensure Add to Cart button stays hidden / disabled
    if (addBtn) {
      addBtn.style.setProperty('display', 'none', 'important');
      addBtn.classList.add('b2b-disabled');
      addBtn.setAttribute('disabled', 'disabled');
      addBtn.setAttribute('aria-hidden', 'true');
    }

    if (!cardContainer) return;

    cardContainer.style.display = 'block';

    if (statusData.status === 'PENDING') {
      const refText = statusData.referenceNumber ? ` (${escapeHtml(statusData.referenceNumber)})` : '';
      cardContainer.innerHTML = `
        <div class="b2b-access-card b2b-pending-state" data-b2b-state="pending">
          <div class="b2b-access-badge">⏳ Under Review</div>
          <h3>Wholesale Application Under Review</h3>
          <p>Your wholesale application${refText} is currently under review by our team. Direct purchasing access will be unlocked once approved.</p>
          <a href="/pages/contact" class="b2b-access-sublink">Questions or custom requests? Contact us →</a>
        </div>
      `;
    } else if (statusData.status === 'REJECTED' || statusData.status === 'REVOKED') {
      cardContainer.innerHTML = `
        <div class="b2b-access-card b2b-rejected-state" data-b2b-state="rejected">
          <div class="b2b-access-badge" style="background:rgba(220,53,69,0.18);color:#FF8080;">🔒 Access Restricted</div>
          <h3>Wholesale Access Inactive</h3>
          <p>Your wholesale account is not currently active for direct ordering. You may submit an application for wholesale reconsideration below.</p>
          <a href="/pages/wholesale-signup" class="b2b-access-btn open-wholesale-modal-btn">Apply for Wholesale Access</a>
          <a href="/pages/contact" class="b2b-access-sublink">Questions regarding your account? Contact us →</a>
        </div>
      `;
    } else if (statusData.status === 'NOT_APPLIED') {
      // Signed in customer who has not applied
      cardContainer.innerHTML = `
        <div class="b2b-access-card b2b-not-applied-state" data-b2b-state="not-applied">
          <div class="b2b-access-badge">🔒 Wholesale Exclusive</div>
          <h3>Wholesale Purchasing Access Required</h3>
          <p>Our semi-custom sets are available exclusively to verified B2B partners. Apply today to unlock direct ordering.</p>
          <a href="/pages/wholesale-signup" class="b2b-access-btn open-wholesale-modal-btn">Apply for Wholesale Access</a>
          <a href="/pages/contact" class="b2b-access-sublink">Questions or custom requests? Contact us →</a>
        </div>
      `;
    } else if (statusData.status === 'GUEST') {
      // Guest visitor
      cardContainer.innerHTML = `
        <div class="b2b-access-card b2b-guest-state" data-b2b-state="guest">
          <div class="b2b-access-badge">🔒 Wholesale Exclusive</div>
          <h3>Wholesale Purchasing Access Required</h3>
          <p>Our semi-custom sets are available exclusively to verified B2B partners. Apply today to unlock direct ordering.</p>
          <a href="/pages/wholesale-signup" class="b2b-access-btn open-wholesale-modal-btn">Apply for Wholesale Access</a>
          <a href="/account/login?return_to=${encodeURIComponent(window.location.pathname)}" class="b2b-access-sublink">Already have an approved account? Sign In →</a>
        </div>
      `;
    }
  }

  // Asynchronously query authoritative status using Shopify Customer ID / email
  async function resolveCustomerStatus() {
    if (!customerId && !customerEmail) {
      return;
    }

    try {
      const url = `${apiBaseUrl}/api/storefront/status?customerId=${encodeURIComponent(customerId || '')}&email=${encodeURIComponent(customerEmail || '')}`;
      const response = await fetch(url);
      if (!response.ok) return;

      const data = await response.json();
      updateStorefrontState(data);
    } catch (err) {
      console.warn('B2B status check notice:', err.message);
    }
  }

  // Execute status resolution on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resolveCustomerStatus);
  } else {
    resolveCustomerStatus();
  }

  // Intercept Form Submissions on semi-custom products
  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (!form || !form.matches || !form.matches('form[action*="/cart/add"]')) {
      return;
    }

    const isSemiCustom = form.closest('[data-semi-custom="true"]') ||
                         document.querySelector('[data-semi-custom="true"]') ||
                         window.BB_IS_SEMI_CUSTOM;

    if (isSemiCustom && !isApproved && !window.BB_CUSTOMER_APPROVED) {
      event.preventDefault();
      event.stopPropagation();
      showAccessRestrictionModal();
    }
  }, true);

  // Intercept Fetch API requests to /cart/add and /cart/add.js
  const originalFetch = window.fetch;
  window.fetch = async function (resource, init) {
    const url = typeof resource === 'string' ? resource : (resource && resource.url) || '';

    if (url.includes('/cart/add')) {
      const isSemiCustom = document.querySelector('[data-semi-custom="true"]') || window.BB_IS_SEMI_CUSTOM;
      if (isSemiCustom && !isApproved && !window.BB_CUSTOMER_APPROVED) {
        showAccessRestrictionModal();
        return Promise.reject(new Error('Purchasing restricted: Wholesale approval required for semi-custom products.'));
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // User notification modal
  function showAccessRestrictionModal() {
    let modal = document.getElementById('bbB2BRestrictionModal');
    const isUserSignedIn = Boolean(customerId || customerEmail);

    let modalContent = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;">
        <div style="background:#111118;border:1px solid rgba(139,47,224,0.4);box-shadow:0 12px 36px rgba(0,0,0,0.4);border-radius:16px;max-width:480px;width:100%;padding:32px 28px;text-align:center;color:#ffffff;font-family:'Inter',sans-serif;">
          <div style="width:52px;height:52px;border-radius:50%;background:rgba(139,47,224,0.15);color:#C089F8;display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px;">🔒</div>
          <h3 style="font-size:20px;font-weight:700;margin-bottom:8px;color:#fff;">Wholesale Approval Required</h3>
          <p style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.6;margin-bottom:24px;">Semi-custom products are reserved for verified wholesale accounts. Please apply for wholesale approval or sign in with an approved account.</p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a href="/pages/wholesale-signup" style="background:linear-gradient(135deg, #9B3FEF, #7B28CC);color:#fff;font-weight:700;padding:12px 20px;border-radius:10px;text-decoration:none;font-size:14px;">Apply for Wholesale Access</a>
            ${!isUserSignedIn ? `<a href="/account/login" style="background:rgba(255,255,255,0.06);color:#fff;font-weight:600;padding:11px 20px;border-radius:10px;text-decoration:none;font-size:13px;border:1px solid rgba(255,255,255,0.1);">Sign In to Approved Account</a>` : ''}
            <button id="closeBbModalBtn" type="button" style="background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:12px;margin-top:6px;cursor:pointer;">Dismiss</button>
          </div>
        </div>
      </div>
    `;

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bbB2BRestrictionModal';
      document.body.appendChild(modal);
    }

    modal.innerHTML = modalContent;
    modal.style.display = 'block';

    const closeBtn = document.getElementById('closeBbModalBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        modal.style.display = 'none';
      });
    }
  }
})();
