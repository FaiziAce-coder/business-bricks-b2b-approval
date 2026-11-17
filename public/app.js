/**
 * Business Bricks B2B Customer Approval App
 * Admin Dashboard SPA Controller
 */

(function () {
  'use strict';

  // State
  const state = {
    currentView: 'dashboard',
    applications: [],
    recentApplications: [],
    approvedCustomers: [],
    stats: {},
    settings: {},
    filters: {
      status: 'ALL',
      search: '',
      page: 1,
      limit: 10
    },
    pagination: {
      page: 1,
      totalPages: 1,
      totalCount: 0
    },
    activeApplicationId: null,
    pendingAction: null // { type: 'APPROVE'|'REJECT'|'REVOKE', id: string, name: string }
  };

  // DOM Elements
  const el = {
    pageTitle: document.getElementById('pageTitle'),
    refreshBtn: document.getElementById('refreshBtn'),
    toastMessage: document.getElementById('toastMessage'),
    pendingNavCount: document.getElementById('pendingNavCount'),

    // KPI
    kpiTotal: document.getElementById('kpiTotal'),
    kpiPending: document.getElementById('kpiPending'),
    kpiApproved: document.getElementById('kpiApproved'),
    kpiRejected: document.getElementById('kpiRejected'),
    dashboardPendingBanner: document.getElementById('dashboardPendingBanner'),
    recentAppsTbody: document.getElementById('recentAppsTbody'),

    // Applications View
    statusFilterPills: document.getElementById('statusFilterPills'),
    appSearchInput: document.getElementById('appSearchInput'),
    applicationsTbody: document.getElementById('applicationsTbody'),
    paginationText: document.getElementById('paginationText'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),

    // Customers View
    customersTbody: document.getElementById('customersTbody'),

    // Settings View
    settingsForm: document.getElementById('settingsForm'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),

    // Modals
    appModal: document.getElementById('appModal'),
    modalRefPill: document.getElementById('modalRefPill'),
    modalApplicantName: document.getElementById('modalApplicantName'),
    modalBody: document.getElementById('modalBody'),
    modalFooter: document.getElementById('modalFooter'),

    confirmModal: document.getElementById('confirmModal'),
    confirmModalTitle: document.getElementById('confirmModalTitle'),
    confirmModalMessage: document.getElementById('confirmModalMessage'),
    confirmNotesGroup: document.getElementById('confirmNotesGroup'),
    confirmNotesLabel: document.getElementById('confirmNotesLabel'),
    confirmNotesInput: document.getElementById('confirmNotesInput'),
    confirmExecuteBtn: document.getElementById('confirmExecuteBtn'),

    discountModal: document.getElementById('discountModal'),
    discountTypeSelect: document.getElementById('discountTypeSelect'),
    discountValueGroup: document.getElementById('discountValueGroup'),
    discountValueInput: document.getElementById('discountValueInput'),
    saveDiscountBtn: document.getElementById('saveDiscountBtn')
  };

  // -------------------------------------------------------------
  // API Helpers
  // -------------------------------------------------------------
  async function api(path, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    try {
      const res = await fetch(path, {
        ...options,
        headers: { credentials: 'omit', credentials: 'same-origin', ...defaultHeaders, ...(options.headers || {}) }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error on ${path}:`, err);
      showToast(err.message, 'error');
      throw err;
    }
  }

  function showToast(message, type = 'info') {
    if (!el.toastMessage) return;
    el.toastMessage.innerText = message;
    el.toastMessage.className = `toast ${type}`;
    el.toastMessage.style.display = 'flex';
    clearTimeout(el.toastTimer);
    el.toastTimer = setTimeout(() => {
      el.toastMessage.style.display = 'none';
    }, 4500);
  }

  // -------------------------------------------------------------
  // Navigation & View Routing
  // -------------------------------------------------------------
  function switchView(viewName, filterStatus = null) {
    state.currentView = viewName;

    // Update URL hash
    window.location.hash = viewName;

    // Update sidebar active link
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update view panels
    document.querySelectorAll('.portal-view').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${viewName}`);
    });

    // Update Topbar Title
    const titles = {
      dashboard: 'Dashboard',
      applications: 'Wholesale Applications',
      customers: 'Approved B2B Customers',
      settings: 'App & Email Settings'
    };
    if (el.pageTitle) {
      el.pageTitle.innerText = titles[viewName] || 'Dashboard';
    }

    if (viewName === 'applications') {
      if (filterStatus) {
        setFilterStatus(filterStatus);
      } else {
        loadApplications();
      }
    } else if (viewName === 'customers') {
      loadApprovedCustomers();
    } else if (viewName === 'settings') {
      loadSettings();
    } else {
      loadDashboard();
    }
  }

  window.switchView = switchView;

  // -------------------------------------------------------------
  // View 1: Dashboard
  // -------------------------------------------------------------
  async function loadDashboard() {
    try {
      const data = await api('/api/admin/dashboard');
      if (data && data.stats) {
        state.stats = data.stats;
        renderDashboardStats(data.stats);
      }

      // Load recent 5 applications
      const recent = await api('/api/admin/applications?limit=5&page=1');
      if (recent && recent.applications) {
        state.recentApplications = recent.applications;
        renderRecentApplications(recent.applications);
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    }
  }

  function renderDashboardStats(stats) {
    if (el.kpiTotal) el.kpiTotal.innerText = stats.total || 0;
    if (el.kpiPending) el.kpiPending.innerText = stats.pending || 0;
    if (el.kpiApproved) el.kpiApproved.innerText = stats.approved || 0;
    if (el.kpiRejected) el.kpiRejected.innerText = (stats.rejected || 0) + (stats.revoked || 0);

    // Pending nav counter
    if (el.pendingNavCount) {
      if (stats.pending > 0) {
        el.pendingNavCount.innerText = stats.pending;
        el.pendingNavCount.style.display = 'inline-block';
      } else {
        el.pendingNavCount.style.display = 'none';
      }
    }

    // Pending banner
    if (el.dashboardPendingBanner) {
      el.dashboardPendingBanner.style.display = stats.pending > 0 ? 'block' : 'none';
    }
  }

  function renderRecentApplications(apps) {
    if (!el.recentAppsTbody) return;
    if (!apps || apps.length === 0) {
      el.recentAppsTbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No wholesale applications yet.</td></tr>';
      return;
    }

    el.recentAppsTbody.innerHTML = apps.map(app => `
      <tr>
        <td><span class="ref-badge">${escapeHtml(app.referenceNumber || 'BB-APP')}</span></td>
        <td><strong>${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}</strong></td>
        <td>${escapeHtml(app.company)}</td>
        <td>${formatDate(app.createdAt)}</td>
        <td>${renderStatusBadge(app.status)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openAppModal('${app.id}')">View Details</button>
        </td>
      </tr>
    `).join('');
  }

  // -------------------------------------------------------------
  // View 2: Applications
  // -------------------------------------------------------------
  async function loadApplications() {
    if (!el.applicationsTbody) return;
    el.applicationsTbody.innerHTML = '<tr><td colspan="8" class="text-center py-4">Loading applications…</td></tr>';

    try {
      const q = new URLSearchParams();
      if (state.filters.status !== 'ALL') q.set('status', state.filters.status);
      if (state.filters.search.trim()) q.set('search', state.filters.search.trim());
      q.set('page', state.filters.page);
      q.set('limit', state.filters.limit);

      const res = await api(`/api/admin/applications?${q.toString()}`);
      state.applications = res.applications || [];
      state.pagination = res.pagination || { page: 1, totalPages: 1, totalCount: 0 };

      renderApplicationsTable(state.applications);
      updatePaginationControls();
    } catch (err) {
      el.applicationsTbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red">Failed to load applications: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderApplicationsTable(apps) {
    if (!apps || apps.length === 0) {
      el.applicationsTbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No applications found matching your criteria.</td></tr>';
      return;
    }

    el.applicationsTbody.innerHTML = apps.map(app => `
      <tr>
        <td><span class="ref-badge">${escapeHtml(app.referenceNumber || 'BB-APP')}</span></td>
        <td><strong>${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}</strong></td>
        <td>${escapeHtml(app.company)}</td>
        <td><a href="mailto:${escapeHtml(app.email)}" class="btn-text">${escapeHtml(app.email)}</a></td>
        <td>${escapeHtml(app.businessType)}</td>
        <td>${formatDate(app.createdAt)}</td>
        <td>${renderStatusBadge(app.status)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openAppModal('${app.id}')">Review</button>
        </td>
      </tr>
    `).join('');
  }

  function updatePaginationControls() {
    const { page, totalPages, totalCount } = state.pagination;
    if (el.paginationText) {
      const start = totalCount === 0 ? 0 : (page - 1) * state.filters.limit + 1;
      const end = Math.min(page * state.filters.limit, totalCount);
      el.paginationText.innerText = `Showing ${start}–${end} of ${totalCount} applications`;
    }
    if (el.prevPageBtn) el.prevPageBtn.disabled = page <= 1;
    if (el.nextPageBtn) el.nextPageBtn.disabled = page >= totalPages;
  }

  function setFilterStatus(status) {
    state.filters.status = status;
    state.filters.page = 1;
    document.querySelectorAll('#statusFilterPills .pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.status === status);
    });
    loadApplications();
  }

  // -------------------------------------------------------------
  // View 3: Customers (Approved Accounts)
  // -------------------------------------------------------------
  async function loadApprovedCustomers() {
    if (!el.customersTbody) return;
    el.customersTbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">Loading approved customers…</td></tr>';

    try {
      const res = await api('/api/admin/applications?status=APPROVED&limit=100');
      state.approvedCustomers = res.applications || [];
      renderCustomersTable(state.approvedCustomers);
    } catch (err) {
      el.customersTbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red">Failed to load customers: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderCustomersTable(customers) {
    if (!customers || customers.length === 0) {
      el.customersTbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No approved B2B customers yet.</td></tr>';
      return;
    }

    el.customersTbody.innerHTML = customers.map(c => {
      let discountDisplay = 'None (0%)';
      if (c.discountType === 'PERCENTAGE' && c.discountValue > 0) {
        discountDisplay = `${c.discountValue}% (Inactive)`;
      } else if (c.discountType === 'FIXED' && c.discountValue > 0) {
        discountDisplay = `$${c.discountValue} (Inactive)`;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</strong></td>
          <td><a href="mailto:${escapeHtml(c.email)}" class="btn-text">${escapeHtml(c.email)}</a></td>
          <td>${escapeHtml(c.company)}</td>
          <td><code>${escapeHtml(c.shopifyCustomerId || 'Auto-linked')}</code></td>
          <td>${formatDate(c.reviewedAt || c.updatedAt)}</td>
          <td><span class="badge ${c.discountType !== 'NONE' ? 'badge-pending' : ''}">${escapeHtml(discountDisplay)}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" onclick="openDiscountModal('${c.id}', '${c.discountType}', ${c.discountValue || 0})">Future Discount</button>
              <button class="btn btn-danger btn-sm" onclick="promptRevoke('${c.id}', '${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}')">Revoke</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // View 4: Settings
  // -------------------------------------------------------------
  async function loadSettings() {
    try {
      const res = await api('/api/admin/settings');
      if (res && res.settings) {
        state.settings = res.settings;
        for (const [key, value] of Object.entries(res.settings)) {
          const input = document.getElementById(key);
          if (input) {
            if (input.type === 'checkbox') {
              input.checked = value === 'true' || value === true;
            } else {
              input.value = value;
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    if (el.saveSettingsBtn) el.saveSettingsBtn.disabled = true;

    try {
      const payload = {
        b2b_tag_name: document.getElementById('b2b_tag_name')?.value?.trim() || 'b2b-approved',
        auto_tag_customer: document.getElementById('auto_tag_customer')?.checked ? 'true' : 'false',
        require_verified_email: document.getElementById('require_verified_email')?.checked ? 'true' : 'false',
        order_hold_enabled: document.getElementById('order_hold_enabled')?.checked ? 'true' : 'false'
      };

      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      showToast('Settings saved successfully', 'success');
    } catch (err) {
      showToast('Failed to save settings: ' + err.message, 'error');
    } finally {
      if (el.saveSettingsBtn) el.saveSettingsBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------
  // Application Detail Modal
  // -------------------------------------------------------------
  async function openAppModal(id) {
    state.activeApplicationId = id;
    if (el.appModal) el.appModal.style.display = 'flex';
    if (el.modalBody) el.modalBody.innerHTML = '<div class="text-center py-4">Loading application details…</div>';
    if (el.modalFooter) el.modalFooter.innerHTML = '';

    try {
      const res = await api(`/api/admin/applications/${id}`);
      const app = res.application;
      if (!app) return;

      if (el.modalRefPill) el.modalRefPill.innerText = app.referenceNumber || 'BB-APP';
      if (el.modalApplicantName) el.modalApplicantName.innerText = `${app.firstName} ${app.lastName}`;

      // Build Details HTML
      const detailsHtml = `
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="detail-val">${renderStatusBadge(app.status)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Date Submitted</span>
            <span class="detail-val">${formatDate(app.createdAt, true)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Business Name</span>
            <span class="detail-val">${escapeHtml(app.company)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Business Type</span>
            <span class="detail-val">${escapeHtml(app.businessType)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Email</span>
            <span class="detail-val"><a href="mailto:${escapeHtml(app.email)}" class="btn-text">${escapeHtml(app.email)}</a> ${app.emailVerified ? '✅ Verified' : '⚠️ Unverified'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Phone</span>
            <span class="detail-val"><a href="tel:${escapeHtml(app.phone)}" class="btn-text">${escapeHtml(app.phone)}</a></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Address</span>
            <span class="detail-val">${escapeHtml(app.address1)}${app.address2 ? ', ' + escapeHtml(app.address2) : ''}, ${escapeHtml(app.city)}, ${escapeHtml(app.province || '')} ${escapeHtml(app.zip)}, ${escapeHtml(app.country)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Website</span>
            <span class="detail-val">${app.website ? `<a href="${escapeHtml(app.website)}" target="_blank" class="btn-text">${escapeHtml(app.website)} ↗</a>` : '—'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Tax / Resale ID</span>
            <span class="detail-val"><code>${escapeHtml(app.taxId || 'Not provided')}</code></span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Shopify Customer ID</span>
            <span class="detail-val"><code>${escapeHtml(app.shopifyCustomerId || 'Linked on approval')}</code></span>
          </div>
        </div>

        <!-- Status History Timeline -->
        <div class="timeline">
          <h4>Status History & Audit Trail</h4>
          ${(app.history && app.history.length > 0) ? app.history.map(h => `
            <div class="timeline-item">
              <span class="timeline-date">${formatDate(h.createdAt, true)}</span>
              <span class="timeline-desc">
                Status changed from <strong>${h.fromStatus}</strong> to <strong>${h.toStatus}</strong>
                ${h.changedBy ? `by <em>${escapeHtml(h.changedBy)}</em>` : ''}
                ${h.notes ? `— <span>"${escapeHtml(h.notes)}"</span>` : ''}
              </span>
            </div>
          `).join('') : '<p class="text-sm text-muted">No status transitions recorded.</p>'}
        </div>
      `;

      if (el.modalBody) el.modalBody.innerHTML = detailsHtml;

      // Footer Action Buttons
      let actionsHtml = `<button class="btn btn-secondary" onclick="closeModal('appModal')">Close</button>`;

      if (app.status === 'PENDING') {
        actionsHtml += `
          <button class="btn btn-danger" onclick="promptReject('${app.id}', '${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}')">Reject</button>
          <button class="btn btn-success" onclick="promptApprove('${app.id}', '${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}')">Approve Wholesale Access</button>
        `;
      } else if (app.status === 'APPROVED') {
        actionsHtml += `
          <button class="btn btn-danger" onclick="promptRevoke('${app.id}', '${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}')">Revoke Access</button>
        `;
      } else if (app.status === 'REJECTED' || app.status === 'REVOKED') {
        actionsHtml += `
          <button class="btn btn-success" onclick="promptApprove('${app.id}', '${escapeHtml(app.firstName)} ${escapeHtml(app.lastName)}')">Re-Approve Access</button>
        `;
      }

      if (el.modalFooter) el.modalFooter.innerHTML = actionsHtml;
    } catch (err) {
      if (el.modalBody) el.modalBody.innerHTML = `<div class="text-center py-4 text-red">${escapeHtml(err.message)}</div>`;
    }
  }

  window.openAppModal = openAppModal;

  // -------------------------------------------------------------
  // Confirmation Modal Actions
  // -------------------------------------------------------------
  function promptApprove(id, applicantName) {
    state.pendingAction = { type: 'APPROVE', id, name: applicantName };
    el.confirmModalTitle.innerText = 'Approve Wholesale Access';
    el.confirmModalMessage.innerText = `Are you sure you want to approve ${applicantName}? This will grant purchasing access and tag the Shopify customer as 'b2b-approved'.`;
    el.confirmNotesGroup.style.display = 'block';
    el.confirmNotesLabel.innerText = 'Approval Notes (Internal)';
    el.confirmNotesInput.value = '';
    el.confirmExecuteBtn.className = 'btn btn-success';
    el.confirmExecuteBtn.innerText = 'Approve Customer';
    el.confirmModal.style.display = 'flex';
  }

  function promptReject(id, applicantName) {
    state.pendingAction = { type: 'REJECT', id, name: applicantName };
    el.confirmModalTitle.innerText = 'Reject Application';
    el.confirmModalMessage.innerText = `Are you sure you want to reject ${applicantName}'s application?`;
    el.confirmNotesGroup.style.display = 'block';
    el.confirmNotesLabel.innerText = 'Reason for Rejection';
    el.confirmNotesInput.value = '';
    el.confirmExecuteBtn.className = 'btn btn-danger';
    el.confirmExecuteBtn.innerText = 'Reject Application';
    el.confirmModal.style.display = 'flex';
  }

  function promptRevoke(id, applicantName) {
    state.pendingAction = { type: 'REVOKE', id, name: applicantName };
    el.confirmModalTitle.innerText = 'Revoke Wholesale Access';
    el.confirmModalMessage.innerText = `Are you sure you want to revoke wholesale purchasing access for ${applicantName}? The 'b2b-approved' tag will be removed from Shopify.`;
    el.confirmNotesGroup.style.display = 'block';
    el.confirmNotesLabel.innerText = 'Reason for Revocation';
    el.confirmNotesInput.value = '';
    el.confirmExecuteBtn.className = 'btn btn-danger';
    el.confirmExecuteBtn.innerText = 'Revoke Access';
    el.confirmModal.style.display = 'flex';
  }

  window.promptApprove = promptApprove;
  window.promptReject = promptReject;
  window.promptRevoke = promptRevoke;

  async function executeConfirmAction() {
    if (!state.pendingAction) return;
    const { type, id } = state.pendingAction;
    const notes = el.confirmNotesInput.value.trim();

    el.confirmExecuteBtn.disabled = true;

    try {
      let res;
      if (type === 'APPROVE') {
        res = await api(`/api/admin/applications/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ adminUser: 'Logan Christensen', notes })
        });
        showToast('Application approved successfully!', 'success');
      } else if (type === 'REJECT') {
        res = await api(`/api/admin/applications/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ adminUser: 'Logan Christensen', reason: notes })
        });
        showToast('Application rejected', 'info');
      } else if (type === 'REVOKE') {
        res = await api(`/api/admin/applications/${id}/revoke`, {
          method: 'POST',
          body: JSON.stringify({ adminUser: 'Logan Christensen', reason: notes })
        });
        showToast('Wholesale access revoked', 'info');
      }

      closeModal('confirmModal');
      closeModal('appModal');

      // Refresh data
      loadDashboard();
      if (state.currentView === 'applications') loadApplications();
      if (state.currentView === 'customers') loadApprovedCustomers();
    } catch (err) {
      showToast('Action failed: ' + err.message, 'error');
    } finally {
      el.confirmExecuteBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------
  // Future Discount Modal
  // -------------------------------------------------------------
  function openDiscountModal(id, currentType = 'NONE', currentValue = 0) {
    state.activeDiscountAppId = id;
    if (el.discountTypeSelect) el.discountTypeSelect.value = currentType || 'NONE';
    if (el.discountValueInput) el.discountValueInput.value = currentValue || 0;
    updateDiscountVisibility();
    if (el.discountModal) el.discountModal.style.display = 'flex';
  }

  function updateDiscountVisibility() {
    if (!el.discountTypeSelect || !el.discountValueGroup) return;
    const val = el.discountTypeSelect.value;
    el.discountValueGroup.style.display = val === 'NONE' ? 'none' : 'block';
  }

  async function handleSaveDiscount() {
    if (!state.activeDiscountAppId) return;
    const discountType = el.discountTypeSelect.value;
    const discountValue = parseFloat(el.discountValueInput.value) || 0.0;

    if (el.saveDiscountBtn) el.saveDiscountBtn.disabled = true;

    try {
      await api(`/api/admin/applications/${state.activeDiscountAppId}/discount`, {
        method: 'PUT',
        body: JSON.stringify({ discountType, discountValue })
      });

      showToast('Future discount configuration saved (inactive)', 'success');
      closeModal('discountModal');
      loadApprovedCustomers();
    } catch (err) {
      showToast('Failed to save discount: ' + err.message, 'error');
    } finally {
      if (el.saveDiscountBtn) el.saveDiscountBtn.disabled = false;
    }
  }

  window.openDiscountModal = openDiscountModal;

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  }

  window.closeModal = closeModal;

  function renderStatusBadge(status) {
    const badges = {
      PENDING: '<span class="badge badge-pending">Pending Review</span>',
      APPROVED: '<span class="badge badge-approved">Approved</span>',
      REJECTED: '<span class="badge badge-rejected">Rejected</span>',
      REVOKED: '<span class="badge badge-revoked">Revoked</span>'
    };
    return badges[status] || `<span class="badge">${escapeHtml(status)}</span>`;
  }

  function formatDate(isoStr, includeTime = false) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return d.toLocaleDateString('en-US', options);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -------------------------------------------------------------
  // Event Listeners
  // -------------------------------------------------------------
  function initListeners() {
    // Navigation items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const view = item.dataset.view;
        switchView(view);
      });
    });

    // Refresh button
    if (el.refreshBtn) {
      el.refreshBtn.addEventListener('click', () => {
        switchView(state.currentView);
        showToast('Refreshed data', 'info');
      });
    }

    // Status filter pills
    if (el.statusFilterPills) {
      el.statusFilterPills.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
          setFilterStatus(pill.dataset.status);
        });
      });
    }

    // Search input (debounced)
    let searchDebounceTimer;
    if (el.appSearchInput) {
      el.appSearchInput.addEventListener('input', e => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.filters.search = e.target.value;
          state.filters.page = 1;
          loadApplications();
        }, 300);
      });
    }

    // Pagination
    if (el.prevPageBtn) {
      el.prevPageBtn.addEventListener('click', () => {
        if (state.pagination.page > 1) {
          state.filters.page = state.pagination.page - 1;
          loadApplications();
        }
      });
    }

    if (el.nextPageBtn) {
      el.nextPageBtn.addEventListener('click', () => {
        if (state.pagination.page < state.pagination.totalPages) {
          state.filters.page = state.pagination.page + 1;
          loadApplications();
        }
      });
    }

    // Settings form submit
    if (el.settingsForm) {
      el.settingsForm.addEventListener('submit', handleSaveSettings);
    }

    // Confirm modal execute
    if (el.confirmExecuteBtn) {
      el.confirmExecuteBtn.addEventListener('click', executeConfirmAction);
    }

    // Discount modal events
    if (el.discountTypeSelect) {
      el.discountTypeSelect.addEventListener('change', updateDiscountVisibility);
    }
    if (el.saveDiscountBtn) {
      el.saveDiscountBtn.addEventListener('click', handleSaveDiscount);
    }

    // Close modals on escape key or clicking backdrop
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal('appModal');
        closeModal('confirmModal');
        closeModal('discountModal');
      }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeModal(overlay.id);
        }
      });
    });
  }

  // -------------------------------------------------------------
  // Initial Boot
  // -------------------------------------------------------------
  function boot() {
    initListeners();
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    switchView(hash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
