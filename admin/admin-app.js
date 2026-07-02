/* ========================================
   DEVASTHRA Admin Dashboard — App Logic
   ======================================== */
const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
const API = window.__API_BASE || (isLocalEnv ? 'http://localhost:5000' : window.location.origin);
const STATIC_BASE = window.__STATIC_BASE || (isLocalEnv ? API : 'https://devasthra.com');
const MAX_IMAGE_UPLOAD_MB = 10;
const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024;
const tkn = () => localStorage.getItem('DEVASTHRA_admin_token');
const adm = () => localStorage.getItem('DEVASTHRA_admin_user') || 'Admin';
if (!tkn()) window.location.href = 'login.html';

// ── Globals ──
let toastTimer;
let supportConversations = [];
let activeSupportConversationId = null;
let catalogTaxonomy = {};
let structuredCatalogTaxonomy = {};
let allBanners = [];
let currentMainImageState = null;
let currentCatalogImagesState = [];
let taxonomyColorSelection = [];

const BANNER_SLOT_LABELS = {
    hero_slide_1: 'Hero Slide 1',
    hero_slide_2: 'Hero Slide 2',
    hero_slide_3: 'Hero Slide 3',
    offer_strip: 'Offer Strip Marquee',
    festive_drop: 'Festive Drop Banner',
    corner_popup_left: 'Corner Popup Left',
    corner_popup_right: 'Corner Popup Right'
};

const BANNER_SLOT_RULES = {
    hero_slide_1: { help: 'Main hero slide. Use image, title, description, and CTA buttons.' },
    hero_slide_2: { help: 'Second hero slide for arrivals or seasonal campaigns.' },
    hero_slide_3: { help: 'Third hero slide for offers or campaign messaging.' },
    offer_strip: { help: 'Use title or description with messages separated by |. This slot does not use images, buttons, or kicker.', hideImages: true, hideCta: true, hideKicker: true, titleLabel: 'Messages *', descriptionLabel: 'Optional extra messages' },
    festive_drop: { help: 'Festive campaign block. Add title, copy, CTA, and choose whether the countdown should appear. Images are optional.', showCountdown: true, requireImage: false, titleLabel: 'Festive title *', descriptionLabel: 'Tagline / supporting text' },
    corner_popup_left: { help: 'Floating corner card shown on the bottom-left of the homepage. Use optional image, short copy, and one CTA.', hideSecondaryCta: true, requireImage: false, titleLabel: 'Corner popup title *', descriptionLabel: 'Short supporting text' },
    corner_popup_right: { help: 'Floating corner card shown above the chat button on the bottom-right of the homepage. Use optional image, short copy, and one CTA.', hideSecondaryCta: true, requireImage: false, titleLabel: 'Corner popup title *', descriptionLabel: 'Short supporting text' }
};

const TAXONOMY_COLOR_PRESETS = [
    'Black', 'White', 'Off White', 'Grey', 'Charcoal', 'Silver',
    'Navy Blue', 'Sky Blue', 'Royal Blue', 'Teal', 'Olive', 'Green',
    'Yellow', 'Mustard', 'Orange', 'Peach', 'Red', 'Maroon',
    'Wine Red', 'Pink', 'Lavender', 'Purple', 'Beige', 'Khaki',
    'Brown', 'Tan', 'Cream', 'Gold'
];

const COLOR_SWATCH_MAP = {
    black: '#111111',
    white: '#f8fafc',
    'off white': '#f3efe4',
    grey: '#9ca3af',
    gray: '#9ca3af',
    charcoal: '#374151',
    silver: '#cbd5e1',
    navy: '#1e3a8a',
    'navy blue': '#1e3a8a',
    blue: '#2563eb',
    'sky blue': '#38bdf8',
    'royal blue': '#1d4ed8',
    teal: '#0f766e',
    olive: '#708238',
    green: '#16a34a',
    yellow: '#facc15',
    mustard: '#d4a017',
    orange: '#f97316',
    peach: '#fdba74',
    red: '#dc2626',
    maroon: '#7f1d1d',
    'wine red': '#7a1f3d',
    pink: '#ec4899',
    lavender: '#c4b5fd',
    purple: '#7c3aed',
    beige: '#d6c2a1',
    khaki: '#b59b6a',
    brown: '#8b5e3c',
    tan: '#d2b48c',
    cream: '#fff7d6',
    gold: '#d4af37'
};

function formatOrderReference(orderId, invoiceNumber) {
    return String(invoiceNumber || '').trim() || `NATDEV${String(orderId || 0).padStart(3, '0')}`;
}

// ── Toast ──
function showToast(msg, type = '') {
    clearTimeout(toastTimer);
    const t = document.getElementById('toast'), m = document.getElementById('toastMsg');
    if (!t || !m) return;
    m.textContent = msg; t.className = `toast show ${type}`;
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

const fmt = p => '₹' + Number(p).toLocaleString('en-IN');
const fmtDate = d => new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
});

function normalizePolicyText(value) {
    const text = String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim();

    if (!text) return '';

    if (!/[<>]/.test(text)) {
        return text.replace(/\n{3,}/g, '\n\n');
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${text}</div>`, 'text/html');
    const extracted = (doc.body?.innerText || doc.body?.textContent || '')
        .replace(/\u00a0/g, ' ')
        .trim();

    return extracted.replace(/\n{3,}/g, '\n\n');
}

// ── Admin name ──
if (document.getElementById('adminName')) {
    document.getElementById('adminName').textContent = adm();
}

// ── Greeting & Clock ──
function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour >= 5 && hour < 12) greeting = 'Good morning';
    else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    const greetEl = document.getElementById('greetingText');
    if (greetEl) greetEl.textContent = greeting;
    const nameEl = document.getElementById('greetingName');
    if (nameEl) nameEl.textContent = adm();
}

function updateClock() {
    const now = new Date();
    const opts = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    const el = document.getElementById('liveClock');
    if (el) el.textContent = now.toLocaleString('en-IN', opts);
}

updateGreeting();
updateClock();
setInterval(() => {
    updateClock();
    updateGreeting();
}, 30000); // update every 30s

// ── Animated Counter ──
function animateValue(el, end, duration = 800, prefix = '', suffix = '') {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();
    const isNum = typeof end === 'number';
    if (!isNum) { el.textContent = prefix + end + suffix; return; }

    function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (end - start) * eased);
        el.textContent = prefix + current.toLocaleString('en-IN') + suffix;
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// ── Sidebar Navigation ──
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');

function switchPage(pageName) {
    pages.forEach(p => p.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));
    const pg = document.getElementById('page-' + pageName);
    const ni = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (pg) pg.classList.add('active');
    if (ni) ni.classList.add('active');
    // close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
    // load data
    if (pageName === 'dashboard') { loadStats(); loadRecentOrders(); }
    if (pageName === 'orders') loadOrders();
    if (pageName === 'shipment') loadShipments();
    if (pageName === 'products') loadProducts();
    if (pageName === 'customers') loadCustomers();
    if (pageName === 'support') { loadSupportConversations(); loadContactMessages(); }
    if (pageName === 'banners') loadBanners();
    if (pageName === 'coupons') loadCoupons();
    if (pageName === 'returns') loadReturnRequests();
    if (pageName === 'exchanges') loadExchangeRequests();
    if (pageName === 'refunds') loadRefundRequests();
    if (pageName === 'payment-history') loadPaymentHistory();
    if (pageName === 'settings') loadSettingsPage();
    if (pageName === 'audit') loadAuditLogs();
}

navItems.forEach(n => n.addEventListener('click', e => { e.preventDefault(); switchPage(n.dataset.page); }));

// ── Quick Actions ──
document.querySelectorAll('.quick-action-btn, .widget-action').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'add-product') { switchPage('products'); setTimeout(() => document.getElementById('addProductBtn').click(), 200); }
        else if (action) switchPage(action);
    });
});

// ── Mobile sidebar ──
document.getElementById('hamburgerBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('show');
});
document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
});

// ── Logout ──
function doLogout() {
    localStorage.removeItem('DEVASTHRA_admin_token');
    localStorage.removeItem('DEVASTHRA_admin_user');
    window.location.href = 'login.html';
}
document.getElementById('logoutBtn').addEventListener('click', doLogout);
document.getElementById('logoutBtnMobile').addEventListener('click', doLogout);

// =========================================
// DASHBOARD
// =========================================
async function loadStats() {
    try {
        const r = await fetch(`${API}/admin/orders/stats`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (d.success) {
            animateValue(document.getElementById('statTotal'), d.stats.total);
            animateValue(document.getElementById('statRevenue'), d.stats.revenue, 1000, '₹');
            animateValue(document.getElementById('statPending'), d.stats.cancelled || 0);
            animateValue(document.getElementById('statPaid'), d.stats.paid);
            animateValue(document.getElementById('statUsers'), d.stats.users);
            animateValue(document.getElementById('statProducts'), d.stats.products || 0);
            animateValue(document.getElementById('statReturns'), d.stats.pendingReturns || 0);
        }
    } catch { }
}

// ── Recent Orders (Dashboard Widget) ──
async function loadRecentOrders() {
    const tbody = document.getElementById('recentOrdersBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    try {
        const r = await fetch(`${API}/admin/orders`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (d.success && d.orders.length) {
            const recent = d.orders.slice(0, 5);
            tbody.innerHTML = recent.map(o => `<tr>
                <td><strong>${formatOrderReference(o.order_id, o.invoice_number)}</strong></td>
                <td>${o.customer_name}</td>
                <td><strong>${fmt(o.total_amount)}</strong></td>
                <td><span class="status-badge status-${o.status}">${o.status}</span></td>
                <td style="color:var(--text-muted);white-space:nowrap;font-size:.82rem">${fmtDate(o.created_at)}</td>
            </tr>`).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No recent orders</td></tr>';
        }
    } catch {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Could not load orders</td></tr>';
    }
}

// =========================================
// ORDERS
// =========================================
let allOrders = [], currFilter = 'all';

async function loadOrders() {
    const tbody = document.getElementById('ordersBody');
    tbody.innerHTML = '<tr><td colspan="15" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    try {
        const r = await fetch(`${API}/admin/orders`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) { if (r.status === 401 || r.status === 403) { doLogout(); return; } throw new Error(d.message); }
        allOrders = d.orders;
        renderOrdersEnhanced();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="15" class="empty-row">⚠️ ${e.message || 'Failed'}</td></tr>`;
    }
}

function renderOrders() {
    const tbody = document.getElementById('ordersBody');
    const list = currFilter === 'all' ? allOrders : allOrders.filter(o => o.status === currFilter);
    if (!list.length) { tbody.innerHTML = `<tr><td colspan="15" class="empty-row">No orders (${currFilter})</td></tr>`; return; }
    tbody.innerHTML = list.map(o => {
        const prods = (o.items || []).map(i => `<span>• ${i.product_name} (${i.size || '—'}) ×${i.quantity}</span>`).join('');
        const paymentLabel = o.payment_method === 'COD'
            ? `COD${o.payment_status === 'Success' ? ' • Collected' : ' • Pending'}`
            : (o.payment_status || 'Pending');
        const shipmentLabel = mapShipmentPresentation(
            o.status,
            o.shiprocket_system_status || o.shiprocket_display_status || o.shiprocket_tracking_status || o.shiprocket_status || ''
        ).shipmentLabel;
        const shipmentMessage = o.shiprocket_user_message || o.shiprocket_latest_activity || '';
        const cancelRequestPending = String(o.cancellation_request_status || '') === 'Requested' && String(o.status || '') !== 'Cancelled';
        const cancelReason = [o.cancellation_reason, o.cancellation_reason_detail].filter(Boolean).join(': ');
        return `<tr>
            <td><strong>${formatOrderReference(o.order_id, o.invoice_number)}</strong></td>
            <td><div style="font-weight:600">${o.customer_name}</div><div style="color:var(--text-muted);font-size:.78rem">${o.customer_mobile || '—'}</div></td>
            <td><div class="order-products">${prods || '—'}</div></td>
            <td><strong>${fmt(o.total_amount)}</strong></td>
            <td><div class="${o.payment_status === 'Success' ? 'pay-success' : 'pay-pending'}">${paymentLabel}</div></td>
            <td><div class="order-address">${o.address_line},<br>${o.city}, ${o.state}<br><strong>${o.pincode}</strong></div></td>
            <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(o.created_at)}</td>
            <td>
                <span class="status-badge status-${getEffectiveOrderStatus(o)}">${getEffectiveOrderStatus(o)}</span>
                ${shipmentLabel ? `<div class="shipment-mini-meta" style="margin-top:6px">Shipment: ${escapeHtml(shipmentLabel)}</div>` : ''}
                ${shipmentMessage ? `<div class="shipment-mini-meta" style="margin-top:4px">${escapeHtml(shipmentMessage)}</div>` : ''}
            </td>
            <td>
                ${o.cancellation_request_status && o.cancellation_request_status !== 'None' ? `<div class="shipment-mini-meta" style="margin-top:6px;color:${cancelRequestPending ? '#b45309' : '#6b7280'};"><strong>Cancel Request:</strong> ${escapeHtml(cancelRequestPending ? 'Requested' : o.cancellation_request_status)}</div>` : ''}
                ${cancelReason ? `<div class="shipment-mini-meta" style="margin-top:4px;max-width:260px;"><strong>Reason:</strong> ${escapeHtml(cancelReason)}</div>` : ''}
                ${o.cancellation_requested_at ? `<div class="shipment-mini-meta" style="margin-top:4px;">Requested: ${fmtDate(o.cancellation_requested_at)}</div>` : ''}
            </td>
            <td>
                <div class="order-actions">
                    ${renderOrderStatusControl(o)}
                    ${cancelRequestPending ? `<button class="update-btn btn-approve" onclick="approveCancelRequest(${o.order_id})">✔ Approve Cancel</button>` : ''}
                    ${cancelRequestPending ? `<button class="update-btn btn-reject" onclick="rejectCancelRequest(${o.order_id})">✕ Reject</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function getAllowedOrderStatuses(order) {
    const shipmentPresentation = mapShipmentPresentation(
        order?.status,
        order?.shiprocket_system_status || order?.shiprocket_display_status || order?.shiprocket_tracking_status || order?.shiprocket_status || ''
    );
    const currentStatus = getEffectiveOrderStatus(order);
    const cancellationRequested = String(order?.cancellation_request_status || '').trim() === 'Requested';
    const isShiprocketManaged = isShiprocketManagedOrder(order);
    const shiprocketAllowsPacked = ['Packed', 'Shipped', 'Out for delivery', 'Delivered'].includes(shipmentPresentation.orderLabel);
    const shiprocketAllowsShipped = ['Shipped', 'Out for delivery', 'Delivered'].includes(shipmentPresentation.orderLabel);
    const shiprocketAllowsDelivered = shipmentPresentation.orderLabel === 'Delivered';

    if (isShiprocketManaged) {
        switch (currentStatus) {
            case 'Pending':
                return ['Pending', 'Paid', 'Cancelled'];
            case 'Paid':
                return ['Paid', 'Cancelled'];
            case 'Packed':
                return cancellationRequested ? ['Packed', 'Cancelled'] : ['Packed'];
            case 'Shipped':
                return ['Shipped'];
            case 'Delivered':
                return ['Delivered'];
            case 'Cancelled':
                return ['Cancelled'];
            default:
                return [currentStatus || 'Pending'];
        }
    }

    switch (currentStatus) {
        case 'Pending':
            return ['Pending', 'Paid', ...(shiprocketAllowsPacked ? ['Packed'] : []), 'Cancelled'];
        case 'Paid':
            return ['Paid', ...(shiprocketAllowsPacked ? ['Packed'] : []), 'Cancelled'];
        case 'Packed':
            return cancellationRequested
                ? ['Packed', ...(shiprocketAllowsShipped ? ['Shipped'] : []), 'Cancelled']
                : ['Packed', ...(shiprocketAllowsShipped ? ['Shipped'] : [])];
        case 'Shipped':
            return ['Shipped', ...(shiprocketAllowsDelivered ? ['Delivered'] : [])];
        case 'Delivered':
            return ['Delivered'];
        case 'Cancelled':
            return ['Cancelled'];
        default:
            return [currentStatus || 'Pending'];
    }
}

function isFinalOrderStatus(status) {
    return status === 'Delivered' || status === 'Cancelled';
}

function getEffectiveOrderStatus(order) {
    const shipmentPresentation = mapShipmentPresentation(
        order?.status,
        order?.shiprocket_system_status || order?.shiprocket_display_status || order?.shiprocket_tracking_status || order?.shiprocket_status || ''
    );
    const currentStatus = String(order?.status || '').trim();
    const paymentStatus = String(order?.payment_status || '').trim();

    if (currentStatus === 'Cancelled' || shipmentPresentation.orderLabel === 'Cancelled') return 'Cancelled';
    if (currentStatus === 'Delivered' || shipmentPresentation.orderLabel === 'Delivered') return 'Delivered';
    if (shipmentPresentation.orderLabel === 'Shipped' || shipmentPresentation.orderLabel === 'Out for delivery') return 'Shipped';
    if (shipmentPresentation.orderLabel === 'Packed') return 'Packed';
    if (shipmentPresentation.orderLabel === 'Ordered') return paymentStatus === 'Success' || currentStatus === 'Paid' ? 'Paid' : 'Pending';
    return currentStatus || 'Pending';
}

function isShiprocketManagedOrder(order) {
    return Boolean(order?.shiprocket_order_id || order?.shiprocket_shipment_id || order?.shiprocket_awb_code);
}

function renderOrderStatusControl(order) {
    const allowedStatuses = getAllowedOrderStatuses(order);
    const currentStatus = getEffectiveOrderStatus(order) || allowedStatuses[0] || 'Pending';
    const isShiprocketManaged = isShiprocketManagedOrder(order);

    if (isFinalOrderStatus(currentStatus)) {
        return `
            <div class="shipment-mini-meta"><strong>Final Status:</strong> ${escapeHtml(currentStatus)}</div>
            <button class="update-btn btn-invoice" onclick="openAdminInvoice(${order.order_id})">Invoice</button>
        `;
    }

    if (isShiprocketManaged && allowedStatuses.length === 1) {
        return `
            <div class="shipment-mini-meta"><strong>Shiprocket Status:</strong> ${escapeHtml(currentStatus)}</div>
            <div class="shipment-mini-meta" style="margin-top:4px;">Use shipment actions and Sync to update this order.</div>
            <button class="update-btn btn-invoice" onclick="openAdminInvoice(${order.order_id})">Invoice</button>
        `;
    }

    return `
        ${isShiprocketManaged ? `<div class="shipment-mini-meta" style="margin-bottom:6px;">Shipping stages sync from Shiprocket.</div>` : ''}
        <select class="status-select" id="sel-${order.order_id}">
            ${allowedStatuses.map(s => `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="update-btn" onclick="updateOrderStatus(${order.order_id})">Update</button>
        <button class="update-btn btn-invoice" onclick="openAdminInvoice(${order.order_id})">Invoice</button>
    `;
}

function renderOrdersEnhanced() {
    const tbody = document.getElementById('ordersBody');
    const list = currFilter === 'all' ? allOrders : allOrders.filter(o => o.status === currFilter);
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="15" class="empty-row">No orders (${currFilter})</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(o => {
        const prods = (o.items || []).map(i => `<span>• ${i.product_name} (${i.size || '—'}) ×${i.quantity}</span>`).join('');
        const paymentLabel = o.payment_method === 'COD'
            ? `COD${o.payment_status === 'Success' ? ' • Collected' : ' • Pending'}`
            : (o.payment_status || 'Pending');
        const shipmentLabel = mapShipmentPresentation(
            o.status,
            o.shiprocket_system_status || o.shiprocket_display_status || o.shiprocket_tracking_status || o.shiprocket_status || ''
        ).shipmentLabel;
        const latestTracking = cleanTrackingText(o.shiprocket_user_message || o.shiprocket_latest_activity, 'Awaiting shipment updates');
        const cancelRequestPending = String(o.cancellation_request_status || '') === 'Requested' && String(o.status || '') !== 'Cancelled';
        const cancelReason = [o.cancellation_reason, o.cancellation_reason_detail].filter(Boolean).join(': ');
        const returnReason = [o.return_reason, o.return_reason_detail].filter(Boolean).join(': ');
        const exchangePending = String(o.exchange_request_status || '') === 'Requested';
        const exchangeReason = [o.exchange_reason, o.exchange_reason_detail].filter(Boolean).join(': ');
        const refundStatus = o.refund_status || (['Refund Initiated', 'Refund Completed'].includes(String(o.return_request_status || '')) ? o.return_request_status : '');

        return `<tr>
            <td><strong>${formatOrderReference(o.order_id, o.invoice_number)}</strong></td>
            <td><div style="font-weight:600">${o.customer_name}</div><div style="color:var(--text-muted);font-size:.78rem">${o.customer_mobile || '—'}</div></td>
            <td><div class="order-products">${prods || '—'}</div></td>
            <td><strong>${fmt(o.total_amount)}</strong></td>
            <td><div class="${o.payment_status === 'Success' ? 'pay-success' : 'pay-pending'}">${paymentLabel}</div></td>
            <td><div class="order-address">${o.address_line},<br>${o.city}, ${o.state}<br><strong>${o.pincode}</strong></div></td>
            <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(o.created_at)}</td>
            <td><span class="status-badge status-${getEffectiveOrderStatus(o)}">${getEffectiveOrderStatus(o)}</span></td>
            <td>${shipmentLabel ? `<span class="status-badge ${shipmentStatusClass(shipmentLabel)}">${escapeHtml(shipmentLabel)}</span>` : '<div class="shipment-mini-meta">—</div>'}</td>
            <td>
                <div class="shipment-mini-meta" style="max-width:260px;"><strong>${escapeHtml(latestTracking)}</strong></div>
                ${o.shiprocket_latest_activity_at ? `<div class="shipment-mini-meta" style="margin-top:4px;">${fmtDate(o.shiprocket_latest_activity_at)}</div>` : ''}
            </td>
            <td>
                ${o.cancellation_request_status && o.cancellation_request_status !== 'None' ? `<div class="shipment-mini-meta" style="color:${cancelRequestPending ? '#b45309' : '#6b7280'};"><strong>${escapeHtml(cancelRequestPending ? 'Requested' : o.cancellation_request_status)}</strong></div>` : '<div class="shipment-mini-meta">—</div>'}
                ${cancelReason ? `<div class="shipment-mini-meta" style="margin-top:4px;max-width:260px;"><strong>Reason:</strong> ${escapeHtml(cancelReason)}</div>` : ''}
                ${o.cancellation_requested_at ? `<div class="shipment-mini-meta" style="margin-top:4px;">Requested: ${fmtDate(o.cancellation_requested_at)}</div>` : ''}
            </td>
            <td>
                ${o.return_request_status ? `<div class="shipment-mini-meta"><strong>${escapeHtml(o.return_request_status)}</strong></div>` : '<div class="shipment-mini-meta">—</div>'}
                ${returnReason ? `<div class="shipment-mini-meta" style="margin-top:4px;max-width:260px;"><strong>Reason:</strong> ${escapeHtml(returnReason)}</div>` : ''}
                ${o.return_requested_at ? `<div class="shipment-mini-meta" style="margin-top:4px;">Requested: ${fmtDate(o.return_requested_at)}</div>` : ''}
            </td>
            <td>
                ${o.exchange_request_status ? `<div class="shipment-mini-meta"><strong>${escapeHtml(o.exchange_request_status)}</strong></div>` : '<div class="shipment-mini-meta">—</div>'}
                ${exchangeReason ? `<div class="shipment-mini-meta" style="margin-top:4px;max-width:260px;"><strong>Reason:</strong> ${escapeHtml(exchangeReason)}</div>` : ''}
                ${o.exchange_requested_size ? `<div class="shipment-mini-meta" style="margin-top:4px;"><strong>Size:</strong> ${escapeHtml(o.exchange_requested_size)}</div>` : ''}
                ${o.exchange_requested_at ? `<div class="shipment-mini-meta" style="margin-top:4px;">Requested: ${fmtDate(o.exchange_requested_at)}</div>` : ''}
            </td>
            <td>
                ${refundStatus ? `<div class="shipment-mini-meta"><strong>${escapeHtml(refundStatus)}</strong></div>` : '<div class="shipment-mini-meta">—</div>'}
                ${o.refund_request_id ? `<div class="shipment-mini-meta" style="margin-top:4px;"><strong>Ref:</strong> ${escapeHtml(o.refund_request_id)}</div>` : ''}
                ${o.refund_amount ? `<div class="shipment-mini-meta" style="margin-top:4px;"><strong>Amount:</strong> ${fmt(o.refund_amount)}</div>` : ''}
                ${o.refund_mode ? `<div class="shipment-mini-meta" style="margin-top:4px;"><strong>Mode:</strong> ${escapeHtml(o.refund_mode)}</div>` : ''}
            </td>
            <td>
                <div class="order-actions">
                    ${renderOrderStatusControl(o)}
                    ${cancelRequestPending ? `<button class="update-btn btn-approve" onclick="approveCancelRequest(${o.order_id})">✔ Approve Cancel</button>` : ''}
                    ${cancelRequestPending ? `<button class="update-btn btn-reject" onclick="rejectCancelRequest(${o.order_id})">✕ Reject</button>` : ''}
                    ${exchangePending && o.exchange_request_id ? `<button class="update-btn btn-approve" onclick="approveExchangeRequest(${o.exchange_request_id})">✔ Approve Exchange</button>` : ''}
                    ${exchangePending && o.exchange_request_id ? `<button class="update-btn btn-reject" onclick="rejectExchangeRequest(${o.exchange_request_id})">✕ Reject Exchange</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.openAdminInvoice = async function (id) {
    try {
        const res = await fetch(`${API}/admin/orders/${id}/invoice`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const html = await res.text();
        if (!res.ok) throw new Error('Failed to open invoice');
        const invoiceWindow = window.open('', '_blank');
        if (!invoiceWindow) throw new Error('Please allow popups to view the invoice');
        invoiceWindow.document.open();
        invoiceWindow.document.write(html);
        invoiceWindow.document.close();
    } catch (err) {
        showToast(err.message || 'Failed to open invoice', 'error');
    }
};

window.updateOrderStatus = async function (id) {
    const statusSelect = document.getElementById(`sel-${id}`);
    if (!statusSelect) {
        showToast('This order is in a final state and cannot be changed', 'error');
        return;
    }
    const status = statusSelect.value;
    try {
        const order = allOrders.find(x => x.order_id === id);
        const orderRef = formatOrderReference(id, order?.invoice_number);
        const r = await fetch(`${API}/admin/order-status`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tkn()}` },
            body: JSON.stringify({ order_id: id, status })
        });
        const d = await r.json();
        if (d.success) {
            showToast(`Order ${orderRef} → ${status}`, 'success');
            await loadOrders();
            loadStats();
        } else {
            showToast(d.message, 'error');
            await loadOrders();
        }
    } catch { showToast('Update failed', 'error'); }
};

window.approveCancelRequest = function (id) {
    const statusSelect = document.getElementById(`sel-${id}`);
    if (statusSelect) statusSelect.value = 'Cancelled';
    return window.updateOrderStatus(id);
};

window.rejectCancelRequest = async function (id) {
    try {
        const r = await fetch(`${API}/admin/orders/${id}/cancel-request/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (d.success) {
            const order = allOrders.find(x => x.order_id === id);
            if (order) order.cancellation_request_status = 'Rejected';
            renderOrdersEnhanced();
            showToast(d.message || `Rejected cancellation request for #${id}`, 'success');
        } else {
            showToast(d.message || 'Failed to reject request', 'error');
        }
    } catch {
        showToast('Failed to reject request', 'error');
    }
};

window.approveExchangeRequest = async function (id) {
    try {
        const r = await fetch(`${API}/admin/exchange-requests/${id}/approve`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (d.success) {
            await loadOrders();
            showToast(d.message || `Approved exchange request #${id}`, 'success');
        } else {
            showToast(d.message || 'Failed to approve exchange request', 'error');
        }
    } catch {
        showToast('Failed to approve exchange request', 'error');
    }
};

window.rejectExchangeRequest = async function (id) {
    try {
        const r = await fetch(`${API}/admin/exchange-requests/${id}/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (d.success) {
            await loadOrders();
            showToast(d.message || `Rejected exchange request #${id}`, 'success');
        } else {
            showToast(d.message || 'Failed to reject exchange request', 'error');
        }
    } catch {
        showToast('Failed to reject exchange request', 'error');
    }
};

document.getElementById('filtersBar').addEventListener('click', e => {
    if (e.target.classList.contains('filter-btn')) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currFilter = e.target.dataset.status;
        renderOrdersEnhanced();
    }
});
document.getElementById('refreshOrdersBtn').addEventListener('click', async () => { await loadOrders(); showToast('Refreshed', 'success'); });

// =========================================
// SHIPMENTS
// =========================================
let allShipments = [];

function mapShipmentPresentation(orderStatus, shipmentStatus) {
    const rawShipment = String(shipmentStatus || '').trim();
    const rawOrder = String(orderStatus || '').trim();
    const normalizedShipment = /^\d+$/.test(rawShipment) ? '' : rawShipment.toUpperCase();
    const normalizedOrder = /^\d+$/.test(rawOrder) ? '' : rawOrder.toUpperCase();

    if (normalizedOrder === 'CANCELLED' || normalizedShipment.includes('CANCEL')) return { orderLabel: 'Cancelled', shipmentLabel: 'Cancelled' };
    if (normalizedShipment.includes('RTO') || normalizedShipment.includes('RETURNING')) return { orderLabel: 'Returning to seller', shipmentLabel: 'Returning to seller' };
    if (normalizedShipment === 'DELIVERED' || normalizedOrder === 'DELIVERED') return { orderLabel: 'Delivered', shipmentLabel: 'Delivered' };
    if (normalizedShipment === 'OUT FOR DELIVERY') return { orderLabel: 'Out for delivery', shipmentLabel: 'Out for delivery' };
    if (
        normalizedShipment === 'PICKED UP' ||
        normalizedShipment === 'IN TRANSIT' ||
        normalizedShipment === 'REACHED DESTINATION CITY' ||
        normalizedShipment === 'REACHED DESTINATION HUB' ||
        normalizedShipment.includes('TRANSIT') ||
        normalizedShipment.includes('REACHED DESTINATION')
    ) return { orderLabel: 'Shipped', shipmentLabel: 'Shipped' };
    if (
        normalizedShipment === 'READY TO SHIP' ||
        normalizedShipment === 'CONFIRMED' ||
        normalizedShipment === 'PACKED' ||
        normalizedShipment === 'AWB ASSIGNED' ||
        normalizedShipment === 'MANIFEST GENERATED' ||
        normalizedShipment === 'PICKUP SCHEDULED' ||
        normalizedShipment.includes('READY TO SHIP') ||
        normalizedShipment.includes('AWB') ||
        normalizedShipment.includes('MANIFEST') ||
        normalizedShipment.includes('PICKUP')
    ) return { orderLabel: 'Packed', shipmentLabel: 'Packed' };
    if (normalizedShipment === 'NEW' || normalizedShipment.includes('NEW')) return { orderLabel: 'Ordered', shipmentLabel: 'Ordered' };
    if (normalizedOrder === 'SHIPPED') return { orderLabel: 'Shipped', shipmentLabel: normalizedShipment || 'Shipped' };
    if (normalizedOrder === 'PACKED') return { orderLabel: 'Packed', shipmentLabel: normalizedShipment || 'Packed' };
    if (normalizedOrder === 'PAID' || normalizedOrder === 'PENDING') return { orderLabel: 'Ordered', shipmentLabel: normalizedShipment || 'Ordered' };
    return { orderLabel: rawOrder || 'Ordered', shipmentLabel: normalizedShipment || 'Awaiting sync' };
}

function cleanTrackingText(value, fallback = '') {
    const text = String(value || '').trim();
    if (!text || /^\d+$/.test(text)) return fallback;
    return text;
}

function isShipmentActionBlocked(presentation) {
    return presentation.orderLabel === 'Cancelled' || presentation.orderLabel === 'Returning to seller' || presentation.orderLabel === 'Delivered';
}

function shipmentStatusClass(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return 'status-neutral';
    if (normalized.includes('delivered')) return 'status-Delivered';
    if (normalized.includes('out for delivery') || normalized.includes('ship') || normalized.includes('transit')) return 'status-Shipped';
    if (normalized.includes('pickup')) return 'status-Packed';
    if (normalized.includes('packed') || normalized.includes('ordered') || normalized.includes('assign') || normalized.includes('awb') || normalized.includes('created')) return 'status-Pending';
    if (normalized.includes('cancel') || normalized.includes('fail') || normalized.includes('rto') || normalized.includes('exception')) return 'status-Cancelled';
    return 'status-neutral';
}

function isPickupAlreadyScheduled(shipment) {
    if (Number(shipment?.shiprocket_pickup_scheduled) === 1 || shipment?.shiprocket_pickup_scheduled === true) {
        return true;
    }

    const label = String([
        shipment?.shiprocket_status,
        shipment?.shiprocket_tracking_status,
        shipment?.shiprocket_latest_activity
    ].filter(Boolean).join(' ')).toLowerCase();

    return (
        label.includes('pickup already scheduled') ||
        label.includes('already in pickup queue') ||
        label.includes('pickup queue') ||
        label.includes('pickup generated')
    );
}

function renderShipmentStats(shipments) {
    const total = shipments.length;
    const awbAssigned = shipments.filter((shipment) => shipment.shiprocket_awb_code).length;
    const pickupScheduled = shipments.filter((shipment) => Number(shipment.shiprocket_pickup_scheduled) === 1 || shipment.shiprocket_pickup_scheduled === true).length;
    const inTransit = shipments.filter((shipment) => {
        const presentation = mapShipmentPresentation(shipment.status, shipment.shiprocket_system_status || shipment.shiprocket_display_status || shipment.shiprocket_tracking_status || shipment.shiprocket_status || '');
        return presentation.orderLabel === 'Shipped' || presentation.orderLabel === 'Out for delivery';
    }).length;

    animateValue(document.getElementById('shipmentStatTotal'), total);
    animateValue(document.getElementById('shipmentStatAwb'), awbAssigned);
    animateValue(document.getElementById('shipmentStatPickup'), pickupScheduled);
    animateValue(document.getElementById('shipmentStatTransit'), inTransit);
}

async function loadShipments() {
    const tbody = document.getElementById('shipmentsBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading shipments...</td></tr>';
    try {
        const response = await fetch(`${API}/admin/shipments`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) {
            if (response.status === 401 || response.status === 403) {
                doLogout();
                return;
            }
            throw new Error(data.message || 'Failed to load shipments');
        }

        allShipments = Array.isArray(data.shipments) ? data.shipments : [];
        renderShipmentStats(allShipments);
        renderShipments();
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">⚠️ ${escapeHtml(error.message || 'Failed to load shipments')}</td></tr>`;
    }
}

function renderShipments() {
    const tbody = document.getElementById('shipmentsBody');
    if (!tbody) return;

    if (!allShipments.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No Shiprocket shipments found yet</td></tr>';
        return;
    }

    tbody.innerHTML = allShipments.map((shipment) => {
        const trackingLabel = shipment.shiprocket_system_status || shipment.shiprocket_display_status || shipment.shiprocket_tracking_status || shipment.shiprocket_status || 'Awaiting sync';
        const presentation = mapShipmentPresentation(shipment.status, trackingLabel);
        const latestActivity = cleanTrackingText(shipment.shiprocket_user_message || shipment.shiprocket_latest_activity, 'No tracking events yet');
        const latestActivityAt = shipment.shiprocket_latest_activity_at ? fmtDate(shipment.shiprocket_latest_activity_at) : '';
        const actionsBlocked = isShipmentActionBlocked(presentation);
        const canAssignAwb = !actionsBlocked && Boolean(shipment.shiprocket_shipment_id) && !shipment.shiprocket_awb_code;
        const pickupAlreadyScheduled = isPickupAlreadyScheduled(shipment);
        const canSchedulePickup = !actionsBlocked && Boolean(shipment.shiprocket_shipment_id) && Boolean(shipment.shiprocket_awb_code) && !pickupAlreadyScheduled;

        return `<tr>
            <td>
                <div style="font-weight:700">${formatOrderReference(shipment.order_id, shipment.invoice_number)}</div>
                <div class="shipment-mini-meta">${fmt(shipment.total_amount)} • ${escapeHtml(shipment.payment_method || 'Prepaid')}</div>
            </td>
            <td>
                <div style="font-weight:600">${escapeHtml(shipment.customer_name || 'Customer')}</div>
                <div class="shipment-mini-meta">${escapeHtml(shipment.customer_mobile || '—')}</div>
                <div class="shipment-mini-meta">${escapeHtml([shipment.city, shipment.state, shipment.pincode].filter(Boolean).join(', ') || '—')}</div>
            </td>
            <td>
                <div class="shipment-id-block">
                    <span>SR Order: <strong>${escapeHtml(shipment.shiprocket_order_id || '—')}</strong></span>
                    <span>Shipment: <strong>${escapeHtml(shipment.shiprocket_shipment_id || '—')}</strong></span>
                </div>
            </td>
            <td>
                <div style="font-weight:600">${escapeHtml(shipment.shiprocket_courier_name || 'Not assigned')}</div>
                <div class="shipment-mini-meta">AWB: ${escapeHtml(shipment.shiprocket_awb_code || 'Pending')}</div>
                <div class="shipment-mini-meta">${pickupAlreadyScheduled ? 'Pickup scheduled' : 'Pickup not generated'}</div>
            </td>
            <td>
                <span class="status-badge ${shipmentStatusClass(presentation.shipmentLabel)}">${escapeHtml(presentation.shipmentLabel)}</span>
                <div class="shipment-tracking-note">${escapeHtml(latestActivity)}</div>
                <div class="shipment-mini-meta">${escapeHtml(latestActivityAt || '')}</div>
            </td>
            <td style="white-space:nowrap">${fmtDate(shipment.created_at)}</td>
            <td>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${canAssignAwb ? `<button class="btn-outline btn-sm" onclick="assignAwbForOrder(${shipment.order_id})">Assign AWB</button>` : ''}
                    ${canSchedulePickup ? `<button class="btn-outline btn-sm" onclick="schedulePickupForOrder(${shipment.order_id})">Schedule Pickup</button>` : ''}
                    <button class="btn-outline btn-sm" onclick="syncShipmentForOrder(${shipment.order_id})">Sync</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function upsertShipmentInState(orderId, shipment) {
    const index = allShipments.findIndex((item) => item.order_id === orderId);
    if (index >= 0 && shipment) allShipments[index] = shipment;
    renderShipmentStats(allShipments);
    renderShipments();
}

window.syncShipmentForOrder = async function (orderId) {
    try {
        const shipment = allShipments.find((item) => item.order_id === orderId);
        const orderRef = formatOrderReference(orderId, shipment?.invoice_number);
        const response = await fetch(`${API}/admin/shipments/${orderId}/sync`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to sync shipment');

        upsertShipmentInState(orderId, data.shipment);
        showToast(data.message || `Shipment synced for ${orderRef}`, 'success');
    } catch (error) {
        showToast(error.message || 'Shipment sync failed', 'error');
    }
};

window.assignAwbForOrder = async function (orderId) {
    try {
        const shipment = allShipments.find((item) => item.order_id === orderId);
        const orderRef = formatOrderReference(orderId, shipment?.invoice_number);
        const response = await fetch(`${API}/admin/shipments/${orderId}/assign-awb`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) {
            const reason = data.shiprocket_error || data.message || 'Failed to assign AWB';
            throw new Error(`Shiprocket: ${reason}`);
        }

        upsertShipmentInState(orderId, data.shipment);
        showToast(data.message || `AWB assigned for ${orderRef}`, 'success');
    } catch (error) {
        showToast(error.message || 'AWB assignment failed', 'error');
    }
};

window.schedulePickupForOrder = async function (orderId) {
    try {
        const shipment = allShipments.find((item) => item.order_id === orderId);
        const orderRef = formatOrderReference(orderId, shipment?.invoice_number);
        const response = await fetch(`${API}/admin/shipments/${orderId}/schedule-pickup`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) {
            const reason = data.shiprocket_error || data.message || 'Failed to schedule pickup';
            throw new Error(`Shiprocket: ${reason}`);
        }

        upsertShipmentInState(orderId, data.shipment);
        showToast(data.message || `Pickup scheduled for ${orderRef}`, 'success');
    } catch (error) {
        showToast(error.message || 'Pickup scheduling failed', 'error');
    }
};

document.getElementById('refreshShipmentsBtn').addEventListener('click', async () => {
    await loadShipments();
    showToast('Shipments refreshed', 'success');
});

// =========================================
// PRODUCTS
// =========================================
let allProducts = [];
let couponProductOptionsLoaded = false;
let mainProductOptions = [];

function getSelectedSizes() {
    return Array.from(document.querySelectorAll('#sizesCheckboxes input:checked')).map(cb => cb.value);
}

function updateSizeInventoryUI(sizeQuantities = {}) {
    const panel = document.getElementById('sizeInventoryPanel');
    const inputs = document.getElementById('sizeInventoryInputs');
    const summary = document.getElementById('sizeInventorySummary');
    const stockEl = document.getElementById('pf_stock');
    if (!panel || !inputs || !stockEl || !summary) return;

    const sizes = getSelectedSizes();
    if (!sizes.length) {
        panel.style.display = 'none';
        inputs.innerHTML = '';
        summary.innerHTML = '';
        summary.style.display = 'none';
        stockEl.readOnly = false;
        stockEl.removeAttribute('data-size-managed');
        return;
    }

    panel.style.display = 'block';
    summary.innerHTML = sizes.map(size => `
        <span class="size-inventory-chip">${escapeHtml(size)}: ${Number(sizeQuantities[size] || 0)}</span>
    `).join('');
    summary.style.display = 'flex';
    inputs.innerHTML = sizes.map(size => `
        <label style="display:flex;flex-direction:column;gap:6px;font-size:.82rem;font-weight:600;">
            <span>${size}</span>
            <input type="number" min="0" value="${Number(sizeQuantities[size] || 0)}" data-size-qty="${size}" style="padding:10px;border-radius:8px;border:1px solid var(--border-color, #d1d5db);font:inherit;">
        </label>
    `).join('');

    const syncTotal = () => {
        summary.innerHTML = Array.from(inputs.querySelectorAll('[data-size-qty]')).map(input => `
            <span class="size-inventory-chip">${escapeHtml(input.dataset.sizeQty)}: ${Math.max(0, parseInt(input.value, 10) || 0)}</span>
        `).join('');
        const total = Array.from(inputs.querySelectorAll('[data-size-qty]')).reduce((sum, input) => sum + (parseInt(input.value, 10) || 0), 0);
        stockEl.value = total;
        stockEl.readOnly = true;
        stockEl.setAttribute('data-size-managed', 'true');
    };

    inputs.querySelectorAll('[data-size-qty]').forEach(input => input.addEventListener('input', syncTotal));
    syncTotal();
}

function getSizeQuantitiesFromForm() {
    return Object.fromEntries(
        Array.from(document.querySelectorAll('#sizeInventoryInputs [data-size-qty]')).map(input => [
            input.dataset.sizeQty,
            Math.max(0, parseInt(input.value, 10) || 0)
        ])
    );
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAudienceTaxonomy(audience) {
    return Array.isArray(catalogTaxonomy[audience]) ? catalogTaxonomy[audience] : [];
}

function getAudienceOptions() {
    const configuredAudiences = Object.keys(structuredCatalogTaxonomy || {});
    return configuredAudiences.length ? configuredAudiences : ['Men', 'Women', 'Kids', 'Unisex'];
}

function getAudienceFashions(audience) {
    return Array.isArray(structuredCatalogTaxonomy[audience]?.fashions)
        ? structuredCatalogTaxonomy[audience].fashions
        : [];
}

function getFashionOptions(audience) {
    return getAudienceFashions(audience).map(entry => entry.fashion);
}

function getCategoriesForFashion(audience, fashion) {
    const fashionEntry = getAudienceFashions(audience).find(entry => entry.fashion === fashion);
    return Array.isArray(fashionEntry?.categories) ? fashionEntry.categories : [];
}

function parseColorValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return trimmed.split(',').map(item => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function normalizeColorName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function dedupeColors(values) {
    const seen = new Set();
    return parseColorValue(values).reduce((list, color) => {
        const normalized = normalizeColorName(color);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) return list;
        seen.add(key);
        list.push(normalized);
        return list;
    }, []);
}

function getColorSwatchValue(color) {
    const normalized = normalizeColorName(color).toLowerCase();
    if (COLOR_SWATCH_MAP[normalized]) return COLOR_SWATCH_MAP[normalized];
    return `linear-gradient(135deg, ${COLOR_SWATCH_MAP[normalized.split(' ')[0]] || '#94a3b8'}, #e2e8f0)`;
}

function getColorSwatchMarkup(color) {
    return `<span class="color-swatch-dot" style="background:${escapeHtml(getColorSwatchValue(color))};"></span>`;
}

function syncTaxonomyColorTextarea() {
    const input = document.getElementById('taxonomy_available_colors');
    const count = document.getElementById('taxonomyColorSelectionCount');
    if (input) input.value = taxonomyColorSelection.join(', ');
    if (count) count.textContent = `${taxonomyColorSelection.length} selected`;
}

function renderTaxonomySelectedColors() {
    const container = document.getElementById('taxonomy_selected_colors');
    if (!container) return;

    if (!taxonomyColorSelection.length) {
        container.innerHTML = '<div class="taxonomy-selected-empty">No colors selected yet. Pick from the palette or add a custom shade.</div>';
        syncTaxonomyColorTextarea();
        return;
    }

    container.innerHTML = taxonomyColorSelection.map((color) => `
        <span class="taxonomy-selected-color-chip">
            ${getColorSwatchMarkup(color)}
            <span>${escapeHtml(color)}</span>
            <button type="button" data-remove-taxonomy-color="${escapeHtml(color)}" aria-label="Remove ${escapeHtml(color)}">&times;</button>
        </span>
    `).join('');

    container.querySelectorAll('[data-remove-taxonomy-color]').forEach((button) => {
        button.addEventListener('click', () => {
            const color = button.getAttribute('data-remove-taxonomy-color') || '';
            taxonomyColorSelection = taxonomyColorSelection.filter((entry) => entry.toLowerCase() !== color.toLowerCase());
            renderTaxonomyColorPalette();
            renderTaxonomySelectedColors();
        });
    });

    syncTaxonomyColorTextarea();
}

function renderTaxonomyColorPalette() {
    const container = document.getElementById('taxonomy_color_palette');
    if (!container) return;

    const colors = dedupeColors([...TAXONOMY_COLOR_PRESETS, ...taxonomyColorSelection]);
    container.innerHTML = colors.map((color) => `
        <label class="taxonomy-color-option">
            <input type="checkbox" value="${escapeHtml(color)}" ${taxonomyColorSelection.some((entry) => entry.toLowerCase() === color.toLowerCase()) ? 'checked' : ''}>
            <span class="taxonomy-color-option-label">
                ${getColorSwatchMarkup(color)}
                <span class="taxonomy-color-option-name">${escapeHtml(color)}</span>
            </span>
        </label>
    `).join('');

    container.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', () => {
            const color = normalizeColorName(input.value);
            const exists = taxonomyColorSelection.some((entry) => entry.toLowerCase() === color.toLowerCase());
            if (input.checked && !exists) taxonomyColorSelection = [...taxonomyColorSelection, color];
            if (!input.checked && exists) taxonomyColorSelection = taxonomyColorSelection.filter((entry) => entry.toLowerCase() !== color.toLowerCase());
            taxonomyColorSelection = dedupeColors(taxonomyColorSelection);
            renderTaxonomySelectedColors();
        });
    });

    syncTaxonomyColorTextarea();
}

function setTaxonomyColorSelection(values) {
    taxonomyColorSelection = dedupeColors(values);
    renderTaxonomyColorPalette();
    renderTaxonomySelectedColors();
}

function addCustomTaxonomyColor() {
    const input = document.getElementById('taxonomy_custom_color');
    if (!input) return;
    const value = normalizeColorName(input.value);
    if (!value) return;
    taxonomyColorSelection = dedupeColors([...taxonomyColorSelection, value]);
    input.value = '';
    renderTaxonomyColorPalette();
    renderTaxonomySelectedColors();
}

function getColorOptionsForSelection(audience, fashion, category, subcategory) {
    const categoryEntry = getCategoriesForFashion(audience, fashion).find(entry => entry.category === category);
    if (!categoryEntry) return [];

    const subcategoryEntry = (categoryEntry.subcategories || []).find((entry) => {
        if (typeof entry === 'string') return entry === subcategory;
        return entry.subcategory === subcategory;
    });

    const subcategoryColors = subcategoryEntry && typeof subcategoryEntry !== 'string'
        ? parseColorValue(subcategoryEntry.availableColors)
        : [];
    const categoryColors = parseColorValue(categoryEntry.availableColors);

    return (subcategoryColors.length ? subcategoryColors : categoryColors).filter(Boolean);
}

function getSelectedProductColors() {
    return Array.from(document.querySelectorAll('#pf_color_options input:checked')).map(input => input.value);
}

function renderProductColorOptions(selectedColors = []) {
    const container = document.getElementById('pf_color_options');
    const count = document.getElementById('pf_color_count');
    if (!container || !count) return;

    const audience = document.getElementById('pf_ideal_for')?.value || '';
    const fashion = document.getElementById('pf_fashion')?.value || '';
    const category = document.getElementById('pf_category')?.value || '';
    const subcategory = document.getElementById('pf_subcategory')?.value || '';
    const availableColors = Array.from(new Set([
        ...getColorOptionsForSelection(audience, fashion, category, subcategory),
        ...parseColorValue(selectedColors)
    ]));

    if (!availableColors.length) {
        container.innerHTML = '<div class="color-option-empty">No colors configured for this category path yet. Add them from Settings.</div>';
        count.textContent = '0 selected';
        return;
    }

    container.innerHTML = availableColors.map((color) => `
        <label class="color-option-chip">
            <input type="checkbox" value="${escapeHtml(color)}" ${parseColorValue(selectedColors).includes(color) ? 'checked' : ''}>
            <span class="color-option-chip-label">
                ${getColorSwatchMarkup(color)}
                <span class="color-option-chip-copy">
                    <strong>${escapeHtml(color)}</strong>
                    <small>Selectable on the storefront</small>
                </span>
            </span>
        </label>
    `).join('');

    const syncColorCount = () => {
        const selected = getSelectedProductColors();
        count.textContent = `${selected.length} selected`;
    };

    container.querySelectorAll('input').forEach(input => input.addEventListener('change', syncColorCount));
    syncColorCount();
}

function populateAudienceOptions(selectedAudience = '') {
    const audienceInput = document.getElementById('pf_ideal_for');
    if (!audienceInput) return;

    const audiences = getAudienceOptions();
    audienceInput.innerHTML = audiences.map(audience => `<option value="${escapeHtml(audience)}">${escapeHtml(audience)}</option>`).join('');
    if (selectedAudience) {
        audienceInput.value = selectedAudience;
    } else if (!audienceInput.value) {
        audienceInput.value = 'Men';
    } else if (!audienceInput.value || !audiences.includes(audienceInput.value)) {
        audienceInput.value = 'Men';
    }
}

function populateFashionOptions(selectedAudience = '', selectedFashion = '') {
    const fashionInput = document.getElementById('pf_fashion');
    if (!fashionInput) return;

    const fashions = getFashionOptions(selectedAudience);
    fashionInput.innerHTML = `
        <option value="">Select fashion group</option>
        ${fashions.map(fashion => `<option value="${escapeHtml(fashion)}">${escapeHtml(fashion)}</option>`).join('')}
    `;

    if (selectedFashion && fashions.includes(selectedFashion)) {
        fashionInput.value = selectedFashion;
    } else if (fashions.length) {
        fashionInput.value = fashions[0];
    } else {
        fashionInput.value = '';
    }
}

function populateCategoryOptions(selectedAudience = '', selectedFashion = '', selectedCategory = '') {
    const categoryInput = document.getElementById('pf_category');
    if (!categoryInput) return;

    const categories = getCategoriesForFashion(selectedAudience, selectedFashion);
    categoryInput.innerHTML = `
        <option value="">Select main category</option>
        ${categories.map(entry => `<option value="${escapeHtml(entry.category)}">${escapeHtml(entry.category)}</option>`).join('')}
    `;

    if (selectedCategory && categories.some(entry => entry.category === selectedCategory)) {
        categoryInput.value = selectedCategory;
    } else if (categories.length) {
        categoryInput.value = categories[0].category;
    } else {
        categoryInput.value = '';
    }
}

function populateSubcategoryOptions(selectedAudience = '', selectedFashion = '', selectedCategory = '', selectedSubcategory = '') {
    const subcategoryInput = document.getElementById('pf_subcategory');
    if (!subcategoryInput) return;

    const categoryEntry = getCategoriesForFashion(selectedAudience, selectedFashion).find(entry => entry.category === selectedCategory);
    const subcategories = categoryEntry
        ? categoryEntry.subcategories.map(subcategory => typeof subcategory === 'string' ? subcategory : subcategory.subcategory)
        : [];
    subcategoryInput.innerHTML = `
        <option value="">Select subcategory</option>
        ${subcategories.map(subcategory => `<option value="${escapeHtml(subcategory)}">${escapeHtml(subcategory)}</option>`).join('')}
    `;

    if (selectedSubcategory && subcategories.includes(selectedSubcategory)) {
        subcategoryInput.value = selectedSubcategory;
    } else if (subcategories.length) {
        subcategoryInput.value = subcategories[0];
    } else {
        subcategoryInput.value = '';
    }
}

function updateProductTaxonomySummary() {
    const audience = document.getElementById('pf_ideal_for')?.value || 'Men';
    const fashion = document.getElementById('pf_fashion')?.value || 'Not selected';
    const category = document.getElementById('pf_category')?.value || 'Not selected';
    const subcategory = document.getElementById('pf_subcategory')?.value || 'Not selected';

    const audienceEl = document.getElementById('taxonomySummaryAudience');
    const fashionEl = document.getElementById('taxonomySummaryFashion');
    const categoryEl = document.getElementById('taxonomySummaryCategory');
    const subcategoryEl = document.getElementById('taxonomySummarySubcategory');

    if (audienceEl) audienceEl.textContent = audience;
    if (fashionEl) fashionEl.textContent = fashion;
    if (categoryEl) categoryEl.textContent = category;
    if (subcategoryEl) subcategoryEl.textContent = subcategory;
}

function syncCategoryTaxonomy(selectedAudience = '', selectedFashion = '', selectedCategory = '', selectedSubcategory = '') {
    populateAudienceOptions(selectedAudience);
    const audience = document.getElementById('pf_ideal_for')?.value || selectedAudience || getAudienceOptions()[0] || '';
    populateFashionOptions(audience, selectedFashion);
    const fashion = document.getElementById('pf_fashion')?.value || selectedFashion;
    populateCategoryOptions(audience, fashion, selectedCategory);
    const category = document.getElementById('pf_category')?.value || selectedCategory;
    populateSubcategoryOptions(audience, fashion, category, selectedSubcategory);
    renderProductColorOptions();
    updateProductTaxonomySummary();
}

function populateTaxonomyManagerOptions(selectedAudience = '', selectedFashion = '', selectedCategory = '', selectedSubcategory = '') {
    const fashionOptions = document.getElementById('taxonomy_fashion_options');
    const categoryOptions = document.getElementById('taxonomy_category_options');
    const subcategoryOptions = document.getElementById('taxonomy_subcategory_options');
    const audienceInput = document.getElementById('taxonomy_audience');
    const fashionInput = document.getElementById('taxonomy_fashion_group');
    const categoryInput = document.getElementById('taxonomy_category');
    const subcategoryInput = document.getElementById('taxonomy_subcategory');

    if (!fashionOptions || !categoryOptions || !subcategoryOptions || !audienceInput || !fashionInput || !categoryInput || !subcategoryInput) return;

    const audiences = getAudienceOptions();
    audienceInput.innerHTML = audiences.map(audience => `<option value="${escapeHtml(audience)}">${escapeHtml(audience)}</option>`).join('');
    if (selectedAudience) audienceInput.value = selectedAudience;

    const activeAudience = audienceInput.value || selectedAudience || audiences[0] || '';
    const fashions = getFashionOptions(activeAudience);
    fashionOptions.innerHTML = fashions.map(fashion => `<option value="${escapeHtml(fashion)}"></option>`).join('');
    if (selectedFashion) fashionInput.value = selectedFashion;

    const activeFashion = fashionInput.value || selectedFashion || fashions[0] || '';
    const categories = getCategoriesForFashion(activeAudience, activeFashion);
    categoryOptions.innerHTML = categories.map(entry => `<option value="${escapeHtml(entry.category)}"></option>`).join('');
    if (selectedCategory) categoryInput.value = selectedCategory;

    const activeCategory = categoryInput.value || selectedCategory || '';
    const subcategories = (categories.find(entry => entry.category === activeCategory)?.subcategories || [])
        .map(subcategory => typeof subcategory === 'string' ? subcategory : subcategory.subcategory);
    subcategoryOptions.innerHTML = subcategories.map(subcategory => `<option value="${escapeHtml(subcategory)}"></option>`).join('');
    if (selectedSubcategory) subcategoryInput.value = selectedSubcategory;
}

function getTaxonomyColorInputValues() {
    return dedupeColors(document.getElementById('taxonomy_available_colors')?.value || '');
}

function getTaxonomySizeGuideInputValue() {
    const value = document.getElementById('taxonomy_size_guide_json')?.value || '';
    return String(value || '').trim();
}

function setTaxonomySizeGuideInputValue(value = '') {
    const input = document.getElementById('taxonomy_size_guide_json');
    if (input) input.value = value || '';
}

function updateCatalogTaxonomyStats() {
    const audiences = Object.values(structuredCatalogTaxonomy);
    const audienceCount = audiences.filter(Boolean).length;
    const categoryCount = audiences.reduce((total, audienceEntry) => total + (audienceEntry.fashions || []).reduce((inner, fashionEntry) => inner + (fashionEntry.categories || []).length, 0), 0);
    const colorSetCount = audiences.reduce((total, audienceEntry) => total + (audienceEntry.fashions || []).reduce((fashionTotal, fashionEntry) => fashionTotal + (fashionEntry.categories || []).reduce((categoryTotal, categoryEntry) => {
        const categoryColors = parseColorValue(categoryEntry.availableColors).length ? 1 : 0;
        const subcategoryColors = (categoryEntry.subcategories || []).reduce((subTotal, subEntry) => subTotal + (parseColorValue(subEntry.availableColors).length ? 1 : 0), 0);
        return categoryTotal + categoryColors + subcategoryColors;
    }, 0), 0), 0);

    const audienceEl = document.getElementById('taxonomyStatAudiences');
    const categoryEl = document.getElementById('taxonomyStatCategories');
    const colorSetEl = document.getElementById('taxonomyStatColorSets');
    if (audienceEl) audienceEl.textContent = String(audienceCount);
    if (categoryEl) categoryEl.textContent = String(categoryCount);
    if (colorSetEl) colorSetEl.textContent = String(colorSetCount);
}

function getTaxonomyStatusMarkup(isActive) {
    return `<span class="taxonomy-status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Active' : 'Inactive'}</span>`;
}

function getTaxonomyLockedMarkup(isLocked) {
    return isLocked ? `<span class="taxonomy-status-badge inherited">Locked by parent</span>` : '';
}

function getTaxonomyToggleMarkup(id, isActive, isLocked) {
    if (isLocked) {
        return `<label class="toggle-switch is-locked" title="Enable the parent category first"><input type="checkbox" disabled><span class="toggle-slider"></span></label>`;
    }
    return `<label class="toggle-switch" data-taxonomy-toggle="${id}" data-taxonomy-active="${isActive ? '1' : '0'}"><input type="checkbox" ${isActive ? 'checked' : ''}><span class="toggle-slider"></span></label>`;
}

// ── Category Edit State ──
let editingCategoryNodeId = null;

function findCategoryNodeById(id) {
    for (const [audience, audienceEntry] of Object.entries(structuredCatalogTaxonomy)) {
        if (audienceEntry.audienceId === id) return { type: 'audience', name: audience, data: audienceEntry };
        for (const fashionEntry of (audienceEntry.fashions || [])) {
            if (fashionEntry.id === id) return { type: 'fashion', name: fashionEntry.fashion, data: fashionEntry, audience };
            for (const categoryEntry of (fashionEntry.categories || [])) {
                if (categoryEntry.id === id) return { type: 'category', name: categoryEntry.category, data: categoryEntry, audience, fashion: fashionEntry.fashion };
                for (const sub of (categoryEntry.subcategories || [])) {
                    if (typeof sub !== 'string' && sub.id === id) return { type: 'subcategory', name: sub.subcategory, data: sub, audience, fashion: fashionEntry.fashion, category: categoryEntry.category };
                }
            }
        }
    }
    return null;
}

function openCategoryEditModal(id) {
    const node = findCategoryNodeById(id);
    if (!node) { showToast('Category node not found', 'error'); return; }
    editingCategoryNodeId = id;

    // Open modal in edit mode
    const modalTitle = document.querySelector('#taxonomyModal .modal-header h3');
    if (modalTitle) modalTitle.textContent = `Edit ${node.type === 'fashion' ? 'Fashion Group' : node.type === 'subcategory' ? 'Subcategory' : node.type === 'audience' ? 'Audience' : 'Category'}`;
    const saveBtn = document.getElementById('saveTaxonomyBtn');
    if (saveBtn) saveBtn.textContent = 'Update Category';

    taxonomyModal?.classList.add('show');
    taxonomyOverlay?.classList.add('show');
    document.body.style.overflow = 'hidden';

    // Pre-fill fields based on node type
    const audienceEl = document.getElementById('taxonomy_audience');
    const fashionEl = document.getElementById('taxonomy_fashion_group');
    const categoryEl = document.getElementById('taxonomy_category');
    const subcategoryEl = document.getElementById('taxonomy_subcategory');

    // Set and disable fields that shouldn't change during edit
    if (audienceEl) { audienceEl.value = node.audience || node.name; audienceEl.disabled = true; }
    if (fashionEl) {
        fashionEl.value = node.type === 'fashion' ? node.name : (node.fashion || '');
        fashionEl.disabled = node.type !== 'fashion';
    }
    if (categoryEl) {
        categoryEl.value = node.type === 'category' ? node.name : (node.category || '');
        categoryEl.disabled = node.type !== 'category';
    }
    if (subcategoryEl) {
        subcategoryEl.value = node.type === 'subcategory' ? node.name : '';
        subcategoryEl.disabled = node.type !== 'subcategory';
    }

    // Pre-fill colors
    const nodeColors = node.data.availableColors || [];
    setTaxonomyColorSelection(nodeColors);
    const sizeGuideValue = node.data.sizeGuideJson || (node.data.sizeGuide ? JSON.stringify(node.data.sizeGuide, null, 2) : '');
    setTaxonomySizeGuideInputValue(sizeGuideValue);
    populateTaxonomyManagerOptions(node.audience || node.name);
}

function renderCatalogTaxonomyPreview() {
    const preview = document.getElementById('catalogTaxonomyPreview');
    if (!preview) return;

    const audiences = Object.entries(structuredCatalogTaxonomy);
    if (!audiences.length) {
        preview.innerHTML = '<div class="taxonomy-preview-empty">No categories created yet.</div>';
        return;
    }

    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const deleteIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

    preview.innerHTML = audiences.map(([audience, audienceEntry]) => `
        <section class="taxonomy-preview-audience">
            <div class="taxonomy-preview-audience-head">
                <div class="taxonomy-preview-audience-title">
                    <span class="taxonomy-preview-audience-badge">${escapeHtml(audience.slice(0, 1))}</span>
                    <div>
                        <strong>${escapeHtml(audience)} ${getTaxonomyStatusMarkup(Boolean(audienceEntry.isActive))}</strong>
                        <span>${(audienceEntry.fashions || []).length} groups</span>
                    </div>
                </div>
                <span class="taxonomy-preview-fashion-actions">
                    ${getTaxonomyToggleMarkup(audienceEntry.audienceId, Boolean(audienceEntry.selfIsActive), false)}
                </span>
            </div>
            <div class="taxonomy-preview-fashion-list">
                ${(audienceEntry.fashions || []).map((fashionEntry) => `
                    <article class="taxonomy-preview-fashion-card ${fashionEntry.isActive ? '' : 'is-disabled'}">
                        <div class="taxonomy-preview-fashion-head">
                            <span class="taxonomy-preview-fashion-name">
                                ${escapeHtml(fashionEntry.fashion)}
                                ${getTaxonomyStatusMarkup(fashionEntry.isActive)}
                                ${getTaxonomyLockedMarkup(Boolean(fashionEntry.lockedByParent))}
                            </span>
                            <span class="taxonomy-preview-fashion-actions">
                                <button type="button" class="btn-icon btn-icon-edit" data-taxonomy-edit="${fashionEntry.id}" title="Edit">${editIcon}</button>
                                ${getTaxonomyToggleMarkup(fashionEntry.id, Boolean(fashionEntry.selfIsActive), Boolean(fashionEntry.lockedByParent))}
                                <button type="button" class="btn-icon btn-icon-delete" data-taxonomy-delete="${fashionEntry.id}" title="Delete">${deleteIcon}</button>
                            </span>
                        </div>
                        <div class="taxonomy-preview-category-list">
                            ${(fashionEntry.categories || []).map((categoryEntry) => `
                                <section class="taxonomy-preview-category-card ${categoryEntry.isActive ? '' : 'is-disabled'}">
                                    <div class="taxonomy-preview-category-head">
                                        <span class="taxonomy-preview-category-name">
                                            ${escapeHtml(categoryEntry.category)}
                                            ${getTaxonomyStatusMarkup(categoryEntry.isActive)}
                                            ${getTaxonomyLockedMarkup(Boolean(categoryEntry.lockedByParent))}
                                        </span>
                                        <span class="taxonomy-preview-category-actions">
                                            <button type="button" class="btn-icon btn-icon-edit" data-taxonomy-edit="${categoryEntry.id}" title="Edit">${editIcon}</button>
                                            ${getTaxonomyToggleMarkup(categoryEntry.id, Boolean(categoryEntry.selfIsActive), Boolean(categoryEntry.lockedByParent))}
                                            <button type="button" class="btn-icon btn-icon-delete" data-taxonomy-delete="${categoryEntry.id}" title="Delete">${deleteIcon}</button>
                                        </span>
                                    </div>
                                    ${(categoryEntry.availableColors || []).length ? `
                                        <div class="taxonomy-preview-colors">
                                            ${(categoryEntry.availableColors || []).map((color) => `<span class="taxonomy-preview-color">${getColorSwatchMarkup(color)}${escapeHtml(color)}</span>`).join('')}
                                        </div>
                                    ` : ''}
                                    ${(categoryEntry.subcategories || []).length ? `
                                        <div class="taxonomy-preview-subcategory-list">
                                            ${(categoryEntry.subcategories || []).map((sub) => `
                                                <span class="taxonomy-preview-subcategory-chip ${sub.isActive ? '' : 'is-disabled'}">
                                                    <span class="taxonomy-preview-subcategory-name">
                                                        ${escapeHtml(typeof sub === 'string' ? sub : sub.subcategory)}
                                                        ${getTaxonomyStatusMarkup(sub.isActive)}
                                                        ${getTaxonomyLockedMarkup(Boolean(sub.lockedByParent))}
                                                        ${(sub.sizeGuide || sub.sizeGuideJson) ? '<span class="taxonomy-status-badge active" style="margin-left:8px;">Size Guide</span>' : ''}
                                                    </span>
                                                    <span class="taxonomy-preview-subcategory-actions">
                                                        <button type="button" class="btn-icon btn-icon-edit" data-taxonomy-edit="${sub.id}" title="Edit">${editIcon}</button>
                                                        ${getTaxonomyToggleMarkup(sub.id, Boolean(sub.selfIsActive), Boolean(sub.lockedByParent))}
                                                        <button type="button" class="btn-icon btn-icon-delete" data-taxonomy-delete="${sub.id}" title="Delete">${deleteIcon}</button>
                                                    </span>
                                                </span>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </section>
                            `).join('')}
                        </div>
                    </article>
                `).join('')}
            </div>
        </section>
    `).join('');
}

async function loadCatalogTaxonomy() {
    try {
        const response = await fetch(`${API}/admin/products/taxonomy`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load categories');
        catalogTaxonomy = data.taxonomy || {};
        structuredCatalogTaxonomy = data.structuredTaxonomy || {};
        syncCategoryTaxonomy();
        populateTaxonomyManagerOptions();
        updateCatalogTaxonomyStats();
        renderCatalogTaxonomyPreview();
    } catch (error) {
        console.error('Failed to load admin categories:', error);
        catalogTaxonomy = {};
        structuredCatalogTaxonomy = {};
        syncCategoryTaxonomy();
        populateTaxonomyManagerOptions();
        updateCatalogTaxonomyStats();
        renderCatalogTaxonomyPreview();
    }
}

// ── Settings Tab Navigation ──
document.getElementById('settingsTabNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-tab]');
    if (!btn) return;
    const tab = btn.getAttribute('data-settings-tab');
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');
    const section = document.getElementById('settingsSection_' + tab);
    if (section) section.style.display = '';
});

// ── Privacy Policy File Upload ──
const policyUploadZone = document.getElementById('policyUploadZone');
const policyFileInput = document.getElementById('policyFileInput');

policyUploadZone?.addEventListener('click', () => policyFileInput?.click());
policyUploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); policyUploadZone.style.borderColor = 'var(--accent)'; });
policyUploadZone?.addEventListener('dragleave', () => { policyUploadZone.style.borderColor = ''; });
policyUploadZone?.addEventListener('drop', (e) => {
    e.preventDefault(); policyUploadZone.style.borderColor = '';
    if (e.dataTransfer.files.length) { policyFileInput.files = e.dataTransfer.files; policyFileInput.dispatchEvent(new Event('change')); }
});

policyFileInput?.addEventListener('change', async () => {
    const file = policyFileInput.files[0];
    if (!file) return;
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) { showToast('File too large. Max 10MB allowed.', 'error'); return; }

    const preview = document.getElementById('policyUploadPreview');
    preview.innerHTML = '<div class="spinner"></div><p>Uploading...</p>';

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'legal');
        const uploadRes = await fetch(`${API}/upload/image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` },
            body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success && !uploadData.url) throw new Error(uploadData.message || 'Upload failed');

        const fileUrl = uploadData.url;
        document.getElementById('privacyPolicyDocumentUrl').value = fileUrl;

        const extractedContent = normalizePolicyText(uploadData.extractedText || uploadData.content || '');
        if (extractedContent) {
            document.getElementById('privacyPolicyContent').value = extractedContent;
        }

        preview.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p><strong>${escapeHtml(file.name)}</strong> uploaded</p>
            <small style="color:var(--text-secondary);">${(file.size / 1024).toFixed(1)} KB</small>
        `;
        showToast(extractedContent ? 'Document uploaded and content auto-filled.' : 'Document uploaded! URL auto-filled.', 'success');
    } catch (err) {
        preview.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p><strong>Click to upload</strong> policy document</p>
            <small>PDF, DOC, DOCX (Max 10MB)</small>
        `;
        showToast('Upload failed: ' + err.message, 'error');
    }
});

// ── Terms of Service File Upload ──
const tosUploadZone = document.getElementById('tosUploadZone');
const tosFileInput = document.getElementById('tosFileInput');

tosUploadZone?.addEventListener('click', () => tosFileInput?.click());
tosUploadZone?.addEventListener('dragover', (e) => { e.preventDefault(); tosUploadZone.style.borderColor = 'var(--accent)'; });
tosUploadZone?.addEventListener('dragleave', () => { tosUploadZone.style.borderColor = ''; });
tosUploadZone?.addEventListener('drop', (e) => {
    e.preventDefault(); tosUploadZone.style.borderColor = '';
    if (e.dataTransfer.files.length) { tosFileInput.files = e.dataTransfer.files; tosFileInput.dispatchEvent(new Event('change')); }
});

tosFileInput?.addEventListener('change', async () => {
    const file = tosFileInput.files[0];
    if (!file) return;
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) { showToast('File too large. Max 10MB allowed.', 'error'); return; }

    const preview = document.getElementById('tosUploadPreview');
    preview.innerHTML = '<div class="spinner"></div><p>Uploading...</p>';

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'legal');
        const uploadRes = await fetch(`${API}/upload/image`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` },
            body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.success && !uploadData.url) throw new Error(uploadData.message || 'Upload failed');

        const fileUrl = uploadData.url;
        document.getElementById('termsOfServiceDocumentUrl').value = fileUrl;

        const extractedContent = normalizePolicyText(uploadData.extractedText || uploadData.content || '');
        if (extractedContent) {
            document.getElementById('termsOfServiceContent').value = extractedContent;
        }

        preview.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p><strong>${escapeHtml(file.name)}</strong> uploaded</p>
            <small style="color:var(--text-secondary);">${(file.size / 1024).toFixed(1)} KB</small>
        `;
        showToast(extractedContent ? 'Document uploaded and content auto-filled.' : 'Document uploaded! URL auto-filled.', 'success');
    } catch (err) {
        preview.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p><strong>Click to upload</strong> policy document</p>
            <small>PDF, DOC, DOCX (Max 10MB)</small>
        `;
        showToast('Upload failed: ' + err.message, 'error');
    }
});

async function loadPrivacyPolicySettings() {
    try {
        const response = await fetch(`${API}/admin/settings/legal-policies`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load privacy policy');

        document.getElementById('privacyPolicyTitle').value = data.privacyPolicy?.title || '';
        document.getElementById('privacyPolicyLastUpdated').value = data.privacyPolicy?.last_updated || '';
        document.getElementById('privacyPolicyDocumentUrl').value = data.privacyPolicy?.document_url || '';
        document.getElementById('privacyPolicyContent').value = normalizePolicyText(data.privacyPolicy?.content || '');
    } catch (error) {
        console.error('Failed to load privacy policy settings:', error);
        showToast(error.message || 'Failed to load privacy policy settings', 'error');
    }
}

async function loadAdminCredentials() {
    try {
        const response = await fetch(`${API}/admin/settings/admin-credentials`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load admin credentials');

        document.getElementById('adminSupportEmailInput').value = data.adminCredentials?.support_email || '';
        document.getElementById('adminSmtpPasswordInput').value = data.adminCredentials?.smtp_app_password || '';
    } catch (error) {
        console.error('Failed to load admin credentials:', error);
        showToast(error.message || 'Failed to load admin credentials', 'error');
    }
}

function renderPrivacyPolicyHistory(history = []) {
    const tbody = document.getElementById('privacyPolicyHistoryBody');
    if (!tbody) return;

    if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No privacy policy versions published yet.</td></tr>';
        return;
    }

    tbody.innerHTML = history.map((item) => `
        <tr>
            <td><strong>#${item.id}</strong></td>
            <td>${escapeHtml(item.title || 'Privacy Policy')}</td>
            <td>${item.last_updated_label ? escapeHtml(item.last_updated_label) : (item.published_at ? fmtDate(item.published_at) : '-')}</td>
            <td>${escapeHtml(item.admin_username || 'Admin')}</td>
            <td>${item.published_at ? fmtDate(item.published_at) : fmtDate(item.created_at)}</td>
            <td><span class="status-badge ${item.is_current ? 'status-Paid' : 'status-neutral'}">${item.is_current ? 'Live' : 'History'}</span></td>
            <td class="legal-history-actions">
                <button type="button" class="btn-edit" data-policy-load="${item.id}">Load</button>
                <button type="button" class="btn-primary btn-sm" data-policy-publish="${item.id}" ${item.is_current ? 'disabled' : ''}>Publish</button>
            </td>
        </tr>
    `).join('');
}

async function loadPrivacyPolicyHistory() {
    const tbody = document.getElementById('privacyPolicyHistoryBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    }

    try {
        const response = await fetch(`${API}/admin/settings/legal-policies/history`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load privacy policy history');
        renderPrivacyPolicyHistory(data.history || []);
    } catch (error) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">⚠️ ${escapeHtml(error.message || 'Failed to load privacy policy history')}</td></tr>`;
        }
    }
}

async function loadTermsOfServiceSettings() {
    try {
        const response = await fetch(`${API}/admin/settings/legal-policies/terms`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load terms of service');

        document.getElementById('termsOfServiceTitle').value = data.termsOfService?.title || '';
        document.getElementById('termsOfServiceLastUpdated').value = data.termsOfService?.last_updated || '';
        document.getElementById('termsOfServiceDocumentUrl').value = data.termsOfService?.document_url || '';
        document.getElementById('termsOfServiceContent').value = normalizePolicyText(data.termsOfService?.content || '');
    } catch (error) {
        console.error('Failed to load terms of service:', error);
    }
}

function renderTermsOfServiceHistory(history = []) {
    const tbody = document.getElementById('termsOfServiceHistoryBody');
    if (!tbody) return;

    if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No terms of service versions published yet.</td></tr>';
        return;
    }
    tbody.innerHTML = history.map((item) => `
        <tr>
            <td><strong>#${item.id}</strong></td>
            <td>${escapeHtml(item.title || 'Terms of Service')}</td>
            <td>${item.last_updated_label ? escapeHtml(item.last_updated_label) : (item.published_at ? fmtDate(item.published_at) : '-')}</td>
            <td>${escapeHtml(item.admin_username || 'Admin')}</td>
            <td>${item.published_at ? fmtDate(item.published_at) : fmtDate(item.created_at)}</td>
            <td><span class="status-badge ${item.is_current ? 'status-Paid' : 'status-neutral'}">${item.is_current ? 'Live' : 'History'}</span></td>
            <td class="legal-history-actions">
                <button type="button" class="btn-edit" data-tos-load="${item.id}">Load</button>
                <button type="button" class="btn-primary btn-sm" data-tos-publish="${item.id}" ${item.is_current ? 'disabled' : ''}>Publish</button>
            </td>
        </tr>
    `).join('');
}

async function loadTermsOfServiceHistory() {
    const tbody = document.getElementById('termsOfServiceHistoryBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    }

    try {
        const response = await fetch(`${API}/admin/settings/legal-policies/terms/history`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to load terms of service history');
        renderTermsOfServiceHistory(data.history || []);
    } catch (error) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">⚠️ ${escapeHtml(error.message || 'Failed to load terms of service history')}</td></tr>`;
        }
    }
}

const LEGAL_POLICY_UPLOAD_MAX_SIZE = 10 * 1024 * 1024;

function bindPolicyUploadZone(config) {
    const zone = document.getElementById(config.zoneId);
    const input = document.getElementById(config.inputId);
    const previewId = config.previewId;
    const titleId = config.titleId;
    const contentId = config.contentId;
    const documentUrlId = config.documentUrlId;

    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.style.borderColor = 'var(--accent)';
    });
    zone.addEventListener('dragleave', () => {
        zone.style.borderColor = '';
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.style.borderColor = '';
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
        }
    });

    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > LEGAL_POLICY_UPLOAD_MAX_SIZE) {
            showToast('File too large. Max 10MB allowed.', 'error');
            input.value = '';
            return;
        }

        const preview = document.getElementById(previewId);
        if (preview) preview.innerHTML = '<div class="spinner"></div><p>Uploading...</p>';

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('folder', 'legal');
            const uploadRes = await fetch(`${API}/upload/image`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tkn()}` },
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (!uploadData.success && !uploadData.url) throw new Error(uploadData.message || 'Upload failed');

            const fileUrl = uploadData.url;
            const documentUrlInput = document.getElementById(documentUrlId);
            if (documentUrlInput) documentUrlInput.value = fileUrl;

            const extractedContent = normalizePolicyText(uploadData.extractedText || uploadData.content || '');
            if (extractedContent && contentId) {
                const contentInput = document.getElementById(contentId);
                if (contentInput) contentInput.value = extractedContent;
            }

            if (preview) {
                preview.innerHTML = `
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <p><strong>${escapeHtml(file.name)}</strong> uploaded</p>
                    <small style="color:var(--text-secondary);">${(file.size / 1024).toFixed(1)} KB</small>
                `;
            }
            showToast(extractedContent ? 'Document uploaded and content auto-filled.' : 'Document uploaded! URL auto-filled.', 'success');
        } catch (err) {
            if (preview) {
                preview.innerHTML = `
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <p><strong>Click to upload</strong> policy document</p>
                    <small>PDF, DOC, DOCX (Max 10MB)</small>
                `;
            }
            showToast('Upload failed: ' + err.message, 'error');
        }
    });
}

async function loadPolicySettings(config) {
    try {
        const response = await fetch(`${API}${config.settingsPath}`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || `Failed to load ${config.label}`);

        const policy = data[config.responseKey] || {};
        document.getElementById(config.titleId).value = policy.title || '';
        document.getElementById(config.lastUpdatedId).value = policy.last_updated || '';
        document.getElementById(config.documentUrlId).value = policy.document_url || '';
        document.getElementById(config.contentId).value = normalizePolicyText(policy.content || '');
    } catch (error) {
        console.error(`Failed to load ${config.label} settings:`, error);
        showToast(error.message || `Failed to load ${config.label} settings`, 'error');
    }
}

function renderPolicyHistory(config, history = []) {
    const tbody = document.getElementById(config.historyBodyId);
    if (!tbody) return;

    if (!history.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No ${config.label} versions published yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = history.map((item) => `
        <tr>
            <td><strong>#${item.id}</strong></td>
            <td>${escapeHtml(item.title || config.defaultTitle)}</td>
            <td>${item.last_updated_label ? escapeHtml(item.last_updated_label) : (item.published_at ? fmtDate(item.published_at) : '-')}</td>
            <td>${escapeHtml(item.admin_username || 'Admin')}</td>
            <td>${item.published_at ? fmtDate(item.published_at) : fmtDate(item.created_at)}</td>
            <td><span class="status-badge ${item.is_current ? 'status-Paid' : 'status-neutral'}">${item.is_current ? 'Live' : 'History'}</span></td>
            <td class="legal-history-actions">
                <button type="button" class="btn-edit" data-policy-load="${item.id}">Load</button>
                <button type="button" class="btn-primary btn-sm" data-policy-publish="${item.id}" ${item.is_current ? 'disabled' : ''}>Publish</button>
            </td>
        </tr>
    `).join('');
}

async function loadPolicyHistory(config) {
    const tbody = document.getElementById(config.historyBodyId);
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    }

    try {
        const response = await fetch(`${API}${config.historyPath}`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || `Failed to load ${config.label} history`);
        renderPolicyHistory(config, data.history || []);
    } catch (error) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-row">âš ï¸ ${escapeHtml(error.message || `Failed to load ${config.label} history`)}</td></tr>`;
        }
    }
}

function bindPolicyForm(config) {
    document.getElementById(config.formId)?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const saveBtn = document.getElementById(config.saveBtnId);
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }

        try {
            const response = await fetch(`${API}${config.settingsPath}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tkn()}`
                },
                body: JSON.stringify({
                    title: document.getElementById(config.titleId)?.value || '',
                    last_updated: document.getElementById(config.lastUpdatedId)?.value || '',
                    document_url: document.getElementById(config.documentUrlId)?.value || '',
                    content: normalizePolicyText(document.getElementById(config.contentId)?.value || '')
                })
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || `Failed to save ${config.label}`);
            showToast(data.message || `${config.defaultTitle} updated`, 'success');
            await loadPolicySettings(config);
            await loadPolicyHistory(config);
        } catch (error) {
            showToast(error.message || `Failed to save ${config.label}`, 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = config.saveBtnText;
            }
        }
    });
}

function bindPolicyHistoryActions(config) {
    document.getElementById(config.historyBodyId)?.addEventListener('click', async (event) => {
        const loadButton = event.target.closest('[data-policy-load]');
        const publishButton = event.target.closest('[data-policy-publish]');

        if (loadButton) {
            try {
                const versionId = Number(loadButton.getAttribute('data-policy-load'));
                const response = await fetch(`${API}${config.historyPath}/${versionId}`, {
                    headers: { Authorization: `Bearer ${tkn()}` }
                });
                const data = await response.json();
                if (!data.success) throw new Error(data.message || `Failed to load ${config.label} version`);

                document.getElementById(config.titleId).value = data.version?.title || '';
                document.getElementById(config.lastUpdatedId).value = data.version?.last_updated_label || '';
                document.getElementById(config.documentUrlId).value = data.version?.document_url || '';
                document.getElementById(config.contentId).value = normalizePolicyText(data.version?.content || '');
                showToast(`Loaded ${config.defaultTitle.toLowerCase()} version #${versionId}`, 'success');
            } catch (error) {
                showToast(error.message || `Failed to load ${config.label} version`, 'error');
            }
            return;
        }

        if (publishButton) {
            try {
                const versionId = Number(publishButton.getAttribute('data-policy-publish'));
                const response = await fetch(`${API}${config.historyPath}/${versionId}/publish`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${tkn()}` }
                });
                const data = await response.json();
                if (!data.success) throw new Error(data.message || `Failed to publish ${config.label} version`);
                showToast(data.message || `${config.defaultTitle} version published`, 'success');
                await loadPolicySettings(config);
                await loadPolicyHistory(config);
            } catch (error) {
                showToast(error.message || `Failed to publish ${config.label} version`, 'error');
            }
        }
    });
}

const refundReplacementPolicyConfig = {
    label: 'refund and replacement policy',
    defaultTitle: 'Refund and Replacement Policy',
    settingsPath: '/admin/settings/legal-policies/refund-replacement',
    historyPath: '/admin/settings/legal-policies/refund-replacement/history',
    responseKey: 'refundReplacementPolicy',
    formId: 'refundReplacementPolicyForm',
    saveBtnId: 'saveRefundReplacementPolicyBtn',
    saveBtnText: 'Publish Latest Refund and Replacement Policy',
    titleId: 'refundReplacementPolicyTitle',
    lastUpdatedId: 'refundReplacementPolicyLastUpdated',
    documentUrlId: 'refundReplacementPolicyDocumentUrl',
    contentId: 'refundReplacementPolicyContent',
    historyBodyId: 'refundReplacementPolicyHistoryBody',
    zoneId: 'refundReplacementUploadZone',
    inputId: 'refundReplacementFileInput',
    previewId: 'refundReplacementUploadPreview'
};

const exchangePolicyConfig = {
    label: 'exchange policy',
    defaultTitle: 'Exchange Policy',
    settingsPath: '/admin/settings/legal-policies/exchange',
    historyPath: '/admin/settings/legal-policies/exchange/history',
    responseKey: 'exchangePolicy',
    formId: 'exchangePolicyForm',
    saveBtnId: 'saveExchangePolicyBtn',
    saveBtnText: 'Publish Latest Exchange Policy',
    titleId: 'exchangePolicyTitle',
    lastUpdatedId: 'exchangePolicyLastUpdated',
    documentUrlId: 'exchangePolicyDocumentUrl',
    contentId: 'exchangePolicyContent',
    historyBodyId: 'exchangePolicyHistoryBody',
    zoneId: 'exchangeUploadZone',
    inputId: 'exchangeFileInput',
    previewId: 'exchangeUploadPreview'
};

const shippingPolicyConfig = {
    label: 'shipping policy',
    defaultTitle: 'Shipping Policy',
    settingsPath: '/admin/settings/legal-policies/shipping',
    historyPath: '/admin/settings/legal-policies/shipping/history',
    responseKey: 'shippingPolicy',
    formId: 'shippingPolicyForm',
    saveBtnId: 'saveShippingPolicyBtn',
    saveBtnText: 'Publish Latest Shipping Policy',
    titleId: 'shippingPolicyTitle',
    lastUpdatedId: 'shippingPolicyLastUpdated',
    documentUrlId: 'shippingPolicyDocumentUrl',
    contentId: 'shippingPolicyContent',
    historyBodyId: 'shippingPolicyHistoryBody',
    zoneId: 'shippingUploadZone',
    inputId: 'shippingFileInput',
    previewId: 'shippingUploadPreview'
};

function loadRefundReplacementPolicySettings() { return loadPolicySettings(refundReplacementPolicyConfig); }
function loadRefundReplacementPolicyHistory() { return loadPolicyHistory(refundReplacementPolicyConfig); }
function loadExchangePolicySettings() { return loadPolicySettings(exchangePolicyConfig); }
function loadExchangePolicyHistory() { return loadPolicyHistory(exchangePolicyConfig); }
function loadShippingPolicySettings() { return loadPolicySettings(shippingPolicyConfig); }
function loadShippingPolicyHistory() { return loadPolicyHistory(shippingPolicyConfig); }

bindPolicyUploadZone(refundReplacementPolicyConfig);
bindPolicyUploadZone(exchangePolicyConfig);
bindPolicyUploadZone(shippingPolicyConfig);
bindPolicyForm(refundReplacementPolicyConfig);
bindPolicyForm(exchangePolicyConfig);
bindPolicyForm(shippingPolicyConfig);
bindPolicyHistoryActions(refundReplacementPolicyConfig);
bindPolicyHistoryActions(exchangePolicyConfig);
bindPolicyHistoryActions(shippingPolicyConfig);

async function loadSettingsPage() {
    await loadCatalogTaxonomy();
    await loadPrivacyPolicySettings();
    await loadPrivacyPolicyHistory();
    await loadTermsOfServiceSettings();
    await loadTermsOfServiceHistory();
    await loadRefundReplacementPolicySettings();
    await loadRefundReplacementPolicyHistory();
    await loadExchangePolicySettings();
    await loadExchangePolicyHistory();
    await loadShippingPolicySettings();
    await loadShippingPolicyHistory();
    await loadAdminCredentials();
    await loadStoreConfig();
}

async function loadStoreConfig() {
    try {
        const res = await fetch(`${API}/admin/store-config`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await res.json();
        if (data.success) {
            const codToggle = document.getElementById('codEnabledToggle');
            const maintenanceToggle = document.getElementById('maintenanceEnabledToggle');
            const minOrderInput = document.getElementById('minOrderValueInput');
            const minInput = document.getElementById('codMinOrderValueInput');
            const shippingChargeInput = document.getElementById('shippingChargeInput');
            const maintenanceMessageInput = document.getElementById('maintenanceMessageInput');
            const maintenanceExpectedBackAtInput = document.getElementById('maintenanceExpectedBackAtInput');
            if (codToggle) codToggle.checked = !!data.cod_enabled;
            if (maintenanceToggle) maintenanceToggle.checked = !!data.maintenance_enabled;
            if (minOrderInput) minOrderInput.value = data.min_order_value || '';
            if (minInput) minInput.value = data.cod_min_order_value || '';
            if (shippingChargeInput) shippingChargeInput.value = data.shipping_charge || '';
            if (maintenanceMessageInput) maintenanceMessageInput.value = data.maintenance_message || '';
            if (maintenanceExpectedBackAtInput) maintenanceExpectedBackAtInput.value = normalizeDatetimeLocalInput(data.maintenance_expected_back_at || '');
        }
    } catch (err) {
        console.error('Failed to load store config:', err);
    }
}

document.getElementById('saveStoreConfigBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('saveStoreConfigBtn');
    const codEnabled = document.getElementById('codEnabledToggle')?.checked ?? true;
    const maintenanceEnabled = document.getElementById('maintenanceEnabledToggle')?.checked ?? false;
    const minOrderValue = Number(document.getElementById('minOrderValueInput')?.value) || 0;
    const codMinOrderValue = Number(document.getElementById('codMinOrderValueInput')?.value) || 0;
    const shippingCharge = Number(document.getElementById('shippingChargeInput')?.value) || 0;
    const maintenanceMessage = document.getElementById('maintenanceMessageInput')?.value || '';
    const maintenanceExpectedBackAt = document.getElementById('maintenanceExpectedBackAtInput')?.value || '';

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res = await fetch(`${API}/admin/store-config`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({
                cod_enabled: codEnabled,
                min_order_value: minOrderValue,
                cod_min_order_value: codMinOrderValue,
                shipping_charge: shippingCharge,
                maintenance_enabled: maintenanceEnabled,
                maintenance_message: maintenanceMessage,
                maintenance_expected_back_at: maintenanceExpectedBackAt
            })
        });
        const data = await res.json();
        showToast(data.message || 'Store config saved', data.success ? 'success' : 'error');
    } catch {
        showToast('Failed to save store config', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Store Config';
    }
});

function normalizeDatetimeLocalInput(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text.slice(0, 16);

    const offsetMs = date.getTimezoneOffset() * 60000;
    const local = new Date(date.getTime() - offsetMs);
    return local.toISOString().slice(0, 16);
}

document.getElementById('adminCredentialsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const saveBtn = document.getElementById('saveAdminCredentialsBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const response = await fetch(`${API}/admin/settings/admin-credentials`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({
                support_email: document.getElementById('adminSupportEmailInput')?.value || '',
                smtp_app_password: document.getElementById('adminSmtpPasswordInput')?.value || ''
            })
        });
        const data = await response.json();
        showToast(data.message || 'Admin credentials saved', data.success ? 'success' : 'error');
    } catch (error) {
        showToast(error.message || 'Failed to save admin credentials', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Admin Credentials';
        }
    }
});

const adminSmtpPasswordInput = document.getElementById('adminSmtpPasswordInput');
const adminSmtpPasswordToggle = document.getElementById('adminSmtpPasswordToggle');
const adminSmtpPasswordToggleIcon = document.getElementById('adminSmtpPasswordToggleIcon');

function updateAdminSmtpPasswordToggle(isVisible) {
    if (!adminSmtpPasswordInput || !adminSmtpPasswordToggle || !adminSmtpPasswordToggleIcon) return;
    adminSmtpPasswordInput.type = isVisible ? 'text' : 'password';
    adminSmtpPasswordToggle.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    adminSmtpPasswordToggle.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
    adminSmtpPasswordToggleIcon.innerHTML = isVisible
        ? '<path d="M3 3l18 18"></path><path d="M10.58 10.58A3 3 0 0 0 12 15a3 3 0 0 0 2.42-1.22"></path><path d="M9.88 5.08A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a19.4 19.4 0 0 1-3.17 4.17"></path><path d="M6.11 6.11C2.68 8.23 1 12 1 12s4 7 11 7a10.8 10.8 0 0 0 4.22-.8"></path>'
        : '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle>';
}

adminSmtpPasswordToggle?.addEventListener('click', () => {
    updateAdminSmtpPasswordToggle(adminSmtpPasswordInput?.type === 'password');
});

document.getElementById('taxonomy_audience')?.addEventListener('change', () => {
    populateTaxonomyManagerOptions(document.getElementById('taxonomy_audience').value);
});

document.getElementById('taxonomy_fashion_group')?.addEventListener('input', () => {
    populateTaxonomyManagerOptions(
        document.getElementById('taxonomy_audience').value,
        document.getElementById('taxonomy_fashion_group').value
    );
});

document.getElementById('taxonomy_category')?.addEventListener('input', () => {
    populateTaxonomyManagerOptions(
        document.getElementById('taxonomy_audience').value,
        document.getElementById('taxonomy_fashion_group').value,
        document.getElementById('taxonomy_category').value
    );
});

document.getElementById('addTaxonomyCustomColorBtn')?.addEventListener('click', addCustomTaxonomyColor);
document.getElementById('taxonomy_custom_color')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addCustomTaxonomyColor();
    }
});

document.getElementById('catalogTaxonomyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('saveTaxonomyBtn');
    if (button) {
        button.disabled = true;
        button.textContent = 'Saving...';
    }

    try {
        let response;
        if (editingCategoryNodeId) {
            // ── EDIT MODE: Update existing node ──
            const node = findCategoryNodeById(editingCategoryNodeId);
            const nameField = node?.type === 'fashion' ? 'taxonomy_fashion_group'
                : node?.type === 'category' ? 'taxonomy_category'
                    : node?.type === 'subcategory' ? 'taxonomy_subcategory'
                        : null;
            const updatedName = nameField ? (document.getElementById(nameField)?.value || '').trim() : '';

            response = await fetch(`${API}/admin/catalog/taxonomy/${editingCategoryNodeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tkn()}`
                },
                body: JSON.stringify({
                    name: updatedName || undefined,
                    available_colors: getTaxonomyColorInputValues(),
                    size_guide_json: getTaxonomySizeGuideInputValue() || null
                })
            });
        } else {
            // ── CREATE MODE: New category path ──
            response = await fetch(`${API}/admin/catalog/taxonomy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tkn()}`
                },
                body: JSON.stringify({
                    audience: document.getElementById('taxonomy_audience')?.value || '',
                    fashion_group: document.getElementById('taxonomy_fashion_group')?.value || '',
                    category: document.getElementById('taxonomy_category')?.value || '',
                    subcategory: document.getElementById('taxonomy_subcategory')?.value || '',
                    available_colors: getTaxonomyColorInputValues(),
                    size_guide_json: getTaxonomySizeGuideInputValue() || null
                })
            });
        }
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to save category');

        showToast(data.message || (editingCategoryNodeId ? 'Category updated successfully' : 'Category saved successfully'), 'success');
        document.getElementById('catalogTaxonomyForm').reset();
        setTaxonomyColorSelection([]);
        await loadCatalogTaxonomy();
        closeTaxonomyModal();
    } catch (error) {
        showToast(error.message || 'Failed to save category', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = editingCategoryNodeId ? 'Update Category' : 'Save Category';
        }
    }
});

document.getElementById('privacyPolicyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const saveBtn = document.getElementById('savePrivacyPolicyBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const response = await fetch(`${API}/admin/settings/legal-policies`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({
                title: document.getElementById('privacyPolicyTitle')?.value || '',
                last_updated: document.getElementById('privacyPolicyLastUpdated')?.value || '',
                document_url: document.getElementById('privacyPolicyDocumentUrl')?.value || '',
                content: normalizePolicyText(document.getElementById('privacyPolicyContent')?.value || '')
            })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to save privacy policy');
        showToast(data.message || 'Privacy policy updated', 'success');
        await loadPrivacyPolicySettings();
        await loadPrivacyPolicyHistory();
    } catch (error) {
        showToast(error.message || 'Failed to save privacy policy', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Publish Latest Privacy Policy';
        }
    }
});

document.getElementById('privacyPolicyHistoryBody')?.addEventListener('click', async (event) => {
    const loadButton = event.target.closest('[data-policy-load]');
    const publishButton = event.target.closest('[data-policy-publish]');

    if (loadButton) {
        try {
            const versionId = Number(loadButton.getAttribute('data-policy-load'));
            const response = await fetch(`${API}/admin/settings/legal-policies/history/${versionId}`, {
                headers: { Authorization: `Bearer ${tkn()}` }
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to load policy version');

            document.getElementById('privacyPolicyTitle').value = data.version?.title || '';
            document.getElementById('privacyPolicyLastUpdated').value = data.version?.last_updated_label || '';
            document.getElementById('privacyPolicyDocumentUrl').value = data.version?.document_url || '';
            document.getElementById('privacyPolicyContent').value = normalizePolicyText(data.version?.content || '');
            showToast(`Loaded privacy policy version #${versionId}`, 'success');
        } catch (error) {
            showToast(error.message || 'Failed to load policy version', 'error');
        }
        return;
    }

    if (publishButton) {
        try {
            const versionId = Number(publishButton.getAttribute('data-policy-publish'));
            const response = await fetch(`${API}/admin/settings/legal-policies/history/${versionId}/publish`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tkn()}` }
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to publish policy version');
            showToast(data.message || 'Privacy policy version published', 'success');
            await loadPrivacyPolicySettings();
            await loadPrivacyPolicyHistory();
        } catch (error) {
            showToast(error.message || 'Failed to publish policy version', 'error');
        }
    }
});

document.getElementById('termsOfServiceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const saveBtn = document.getElementById('saveTermsOfServiceBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const response = await fetch(`${API}/admin/settings/legal-policies/terms`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({
                title: document.getElementById('termsOfServiceTitle')?.value || '',
                last_updated: document.getElementById('termsOfServiceLastUpdated')?.value || '',
                document_url: document.getElementById('termsOfServiceDocumentUrl')?.value || '',
                content: normalizePolicyText(document.getElementById('termsOfServiceContent')?.value || '')
            })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Failed to save terms of service');
        showToast(data.message || 'Terms of service updated', 'success');
        await loadTermsOfServiceSettings();
        await loadTermsOfServiceHistory();
    } catch (error) {
        showToast(error.message || 'Failed to save terms of service', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Publish Latest Terms of Service';
        }
    }
});

document.getElementById('termsOfServiceHistoryBody')?.addEventListener('click', async (event) => {
    const loadButton = event.target.closest('[data-tos-load]');
    const publishButton = event.target.closest('[data-tos-publish]');

    if (loadButton) {
        try {
            const versionId = Number(loadButton.getAttribute('data-tos-load'));
            const response = await fetch(`${API}/admin/settings/legal-policies/terms/history/${versionId}`, {
                headers: { Authorization: `Bearer ${tkn()}` }
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to load terms of service version');

            document.getElementById('termsOfServiceTitle').value = data.version?.title || '';
            document.getElementById('termsOfServiceLastUpdated').value = data.version?.last_updated_label || '';
            document.getElementById('termsOfServiceDocumentUrl').value = data.version?.document_url || '';
            document.getElementById('termsOfServiceContent').value = normalizePolicyText(data.version?.content || '');
            showToast(`Loaded terms of service version #${versionId}`, 'success');
        } catch (error) {
            showToast(error.message || 'Failed to load terms of service version', 'error');
        }
        return;
    }

    if (publishButton) {
        try {
            const versionId = Number(publishButton.getAttribute('data-tos-publish'));
            const response = await fetch(`${API}/admin/settings/legal-policies/terms/history/${versionId}/publish`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tkn()}` }
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to publish terms of service version');
            showToast(data.message || 'Terms of service version published', 'success');
            await loadTermsOfServiceSettings();
            await loadTermsOfServiceHistory();
        } catch (error) {
            showToast(error.message || 'Failed to publish terms of service version', 'error');
        }
    }
});

const taxonomyModal = document.getElementById('taxonomyModal');
const taxonomyOverlay = document.getElementById('taxonomyModalOverlay');

function openTaxonomyModal() {
    editingCategoryNodeId = null;
    const modalTitle = document.querySelector('#taxonomyModal .modal-header h3');
    if (modalTitle) modalTitle.textContent = 'Add Category Path';
    const saveBtn = document.getElementById('saveTaxonomyBtn');
    if (saveBtn) saveBtn.textContent = 'Save Category';
    taxonomyModal?.classList.add('show');
    taxonomyOverlay?.classList.add('show');
    document.body.style.overflow = 'hidden';
    // Enable all fields for new category creation
    ['taxonomy_audience', 'taxonomy_fashion_group', 'taxonomy_category', 'taxonomy_subcategory'].forEach(id => {
        const el = document.getElementById(id); if (el) el.disabled = false;
    });
    populateTaxonomyManagerOptions(document.getElementById('taxonomy_audience')?.value || 'Men');
    setTaxonomyColorSelection(getTaxonomyColorInputValues());
    setTaxonomySizeGuideInputValue('');
}

function closeTaxonomyModal() {
    editingCategoryNodeId = null;
    taxonomyModal?.classList.remove('show');
    taxonomyOverlay?.classList.remove('show');
    document.body.style.overflow = '';
    document.getElementById('catalogTaxonomyForm')?.reset();
    // Re-enable all fields
    ['taxonomy_audience', 'taxonomy_fashion_group', 'taxonomy_category', 'taxonomy_subcategory'].forEach(id => {
        const el = document.getElementById(id); if (el) el.disabled = false;
    });
    populateTaxonomyManagerOptions('Men');
    setTaxonomyColorSelection([]);
    setTaxonomySizeGuideInputValue('');
}

document.getElementById('openTaxonomyModalBtn')?.addEventListener('click', openTaxonomyModal);
document.getElementById('closeTaxonomyModal')?.addEventListener('click', closeTaxonomyModal);
document.getElementById('cancelTaxonomyBtn')?.addEventListener('click', closeTaxonomyModal);
taxonomyOverlay?.addEventListener('click', closeTaxonomyModal);

document.getElementById('catalogTaxonomyPreview')?.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-taxonomy-edit]');
    const deleteButton = event.target.closest('[data-taxonomy-delete]');
    const toggleButton = event.target.closest('[data-taxonomy-toggle]');

    if (editButton) {
        const id = Number(editButton.getAttribute('data-taxonomy-edit'));
        openCategoryEditModal(id);
        return;
    }

    if (toggleButton) {
        const id = Number(toggleButton.getAttribute('data-taxonomy-toggle'));
        const isCurrentlyActive = toggleButton.getAttribute('data-taxonomy-active') === '1';

        try {
            const response = await fetch(`${API}/admin/catalog/taxonomy/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tkn()}`
                },
                body: JSON.stringify({ is_active: !isCurrentlyActive })
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to update category status');
            showToast(`Category ${isCurrentlyActive ? 'disabled' : 'enabled'} successfully`, 'success');
            await loadCatalogTaxonomy();
        } catch (error) {
            showToast(error.message || 'Failed to update category status', 'error');
        }
        return;
    }

    if (deleteButton) {
        const id = Number(deleteButton.getAttribute('data-taxonomy-delete'));
        if (!window.confirm('Delete this category path? Child items will also be removed if unused.')) return;

        try {
            const response = await fetch(`${API}/admin/catalog/taxonomy/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${tkn()}` }
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || 'Failed to delete category');
            showToast(data.message, 'success');
            await loadCatalogTaxonomy();
        } catch (error) {
            showToast(error.message || 'Failed to delete category', 'error');
        }
    }
});

function syncProductRoleUI() {
    const roleEl = document.getElementById('pf_product_role');
    const parentRow = document.getElementById('pf_parent_row');
    if (!roleEl || !parentRow) return;
    parentRow.style.display = roleEl.value === 'related' ? '' : 'none';
    if (roleEl.value !== 'related') {
        document.getElementById('pf_parent_product_id').value = '';
    }
}

function populateParentProductOptions(selectedId = '') {
    const select = document.getElementById('pf_parent_product_id');
    if (!select) return;
    select.innerHTML = `<option value="">Select main product</option>` + mainProductOptions.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');
    select.value = selectedId ? String(selectedId) : '';
}

async function loadProducts() {
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = '<tr><td colspan="8" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    const search = document.getElementById('productSearch').value;
    const status = document.getElementById('productStatusFilter').value;
    const sort = document.getElementById('productSortFilter').value;
    let qs = `?sort=${sort}`;
    if (search) qs += `&search=${encodeURIComponent(search)}`;
    if (status) qs += `&status=${status}`;
    try {
        const r = await fetch(`${API}/admin/products${qs}`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        allProducts = d.products;
        couponProductOptionsLoaded = true;
        mainProductOptions = d.mainProducts || [];
        renderProducts();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-row">⚠️ ${e.message || 'Failed'}</td></tr>`;
    }
}

function getImageUrl(img) {
    if (!img) return '';
    if (typeof img === 'object' && img.url) return img.url; // catalog image { url, fileId }
    if (img.startsWith('http')) return img;
    const normalized = String(img).replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.startsWith('uploads/')) return `${STATIC_BASE}/${normalized}`;
    if (normalized.startsWith('backend/images/')) return `${STATIC_BASE}/${normalized}`;
    if (!normalized.includes('/')) return `${STATIC_BASE}/backend/images/${encodeURIComponent(normalized)}`;
    return `${STATIC_BASE}/${normalized}`;
}

function resetCurrentImageState() {
    currentMainImageState = null;
    currentCatalogImagesState = [];
    const mainActions = document.getElementById('mainImageActions');
    const currentCatalogImages = document.getElementById('currentCatalogImages');
    if (mainActions) mainActions.style.display = 'none';
    if (currentCatalogImages) {
        currentCatalogImages.innerHTML = '';
        currentCatalogImages.style.display = 'none';
    }
}

function renderCurrentCatalogImages() {
    const container = document.getElementById('currentCatalogImages');
    if (!container) return;

    if (!currentCatalogImagesState.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'grid';
    container.innerHTML = currentCatalogImagesState.map((image, index) => `
        <div class="current-image-card">
            <img src="${getImageUrl(image.url)}?tr=w:220,h:220,c:cover" alt="Current catalog image ${index + 1}">
            <div class="current-image-card-body">
                <div class="current-image-card-title">Current angle ${index + 1}</div>
                <button type="button" class="btn-danger btn-sm" data-remove-catalog-image="${escapeHtml(image.fileId || image.url)}">Remove This Image</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-remove-catalog-image]').forEach(button => {
        button.addEventListener('click', () => {
            const identifier = button.getAttribute('data-remove-catalog-image');
            currentCatalogImagesState = currentCatalogImagesState.filter(image => String(image.fileId || image.url) !== identifier);
            renderCurrentCatalogImages();
            showToast('Current catalog image marked for removal. Save product to apply.', 'success');
        });
    });
}

function validateImageSelection(files, label, maxFiles = Infinity) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return { valid: true };
    if (selectedFiles.length > maxFiles) {
        return { valid: false, message: `${label}: you can upload only ${maxFiles} file(s) at a time.` };
    }
    const invalidFile = selectedFiles.find(file => file.size > MAX_IMAGE_UPLOAD_BYTES);
    if (invalidFile) {
        return { valid: false, message: `${invalidFile.name} is larger than ${MAX_IMAGE_UPLOAD_MB}MB.` };
    }
    return { valid: true };
}

async function uploadProductImage(formData, label) {
    const uploadRes = await fetch(`${API}/upload/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tkn()}` },
        body: formData
    });

    if (uploadRes.status === 413) {
        throw new Error(`${label} is too large for the server upload limit. If your file is under ${MAX_IMAGE_UPLOAD_MB}MB, reload Nginx so the new 50MB limit is applied.`);
    }

    const contentType = uploadRes.headers.get('content-type') || '';
    const uploadData = contentType.includes('application/json')
        ? await uploadRes.json()
        : { success: false, message: await uploadRes.text() };

    if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.message || uploadData.error || `${label} upload failed`);
    }

    return uploadData;
}

function renderProducts() {
    const tbody = document.getElementById('productsBody');
    if (!allProducts.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No products found. Click "+ Add Product" to get started.</td></tr>'; return; }
    tbody.innerHTML = allProducts.map(p => `<tr>
        <td>${p.image_url ? `<img src="${getImageUrl(p.image_url)}" class="product-thumb" alt="${p.name}" onerror="this.style.display='none'">` : '<div class="product-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem">📷</div>'}</td>
        <td><strong>${p.name}</strong>${p.brand ? `<div style="color:var(--text-muted);font-size:.75rem">${p.brand}</div>` : ''}<div style="color:var(--text-muted);font-size:.75rem">${p.is_main_product ? 'Main Product' : `Related Product${p.parent_product_id ? ` • Parent #${p.parent_product_id}` : ''}`}</div></td>
        <td style="color:var(--text-muted);font-size:.82rem">${p.sku || '—'}</td>
        <td style="color:var(--text-muted);font-size:.82rem">${p.ideal_for || '—'}${p.fashion_group ? ` / ${p.fashion_group}` : ''}${p.category ? ` / ${p.category}` : ''}${p.subcategory ? ` / ${p.subcategory}` : ''}</td>
        <td><strong>${fmt(p.price)}</strong>${p.original_price ? `<div style="color:var(--text-muted);font-size:.75rem;text-decoration:line-through">${fmt(p.original_price)}</div>` : ''}</td>
        <td>
            <span style="color:${p.stock <= 5 ? 'var(--danger)' : 'var(--success)'};font-weight:600">${p.stock}</span>
            ${p.size_inventory && p.size_inventory.length ? `<div style="color:var(--text-muted);font-size:.72rem;margin-top:4px;">${p.size_inventory.map(item => `${item.size}:${item.quantity}`).join(' • ')}</div>` : ''}
        </td>
        <td><span class="status-badge status-${p.listing_status || 'Active'}">${p.listing_status || 'Active'}</span></td>
        <td style="white-space:nowrap">
            <button class="btn-edit" onclick="editProduct(${p.id})">Edit</button>
            <button class="btn-danger" onclick="deleteProduct(${p.id},'${p.name.replace(/'/g, "\\'")}')">Delete</button>
        </td>
    </tr>`).join('');
}

// ── Search / Filter events ──
let searchTimeout;
document.getElementById('productSearch').addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(loadProducts, 400); });
document.getElementById('productStatusFilter').addEventListener('change', loadProducts);
document.getElementById('productSortFilter').addEventListener('change', loadProducts);
document.querySelectorAll('#sizesCheckboxes input').forEach(cb => cb.addEventListener('change', () => updateSizeInventoryUI(getSizeQuantitiesFromForm())));

// ── Product Modal ──
const modal = document.getElementById('productModal');
const overlay = document.getElementById('productModalOverlay');

function openProductModal(title = 'Add New Product') {
    document.getElementById('productModalTitle').textContent = title;
    modal.classList.add('show');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}
function closeProductModal() {
    modal.classList.remove('show');
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    document.getElementById('productForm').reset();
    document.getElementById('editProductId').value = '';
    document.getElementById('mainImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">📷</span><p><strong>Click or drag</strong> to upload main image</p><small style="color: var(--text-secondary);">JPG, PNG (Max 10MB)</small>';
    document.getElementById('catalogImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">🖼️</span><p><strong>Click or drag</strong> to upload multiple angle photos</p><small style="color: var(--text-secondary);">Upload 2-5 images for best results</small>';
    document.getElementById('highlightsContainer').innerHTML = '';
    document.getElementById('imageUploadProgress').style.display = 'none';
    document.getElementById('uploadedImagesDisplay').style.display = 'none';
    document.getElementById('pf_product_role').value = 'main';
    document.getElementById('pf_display_order').value = '0';
    document.getElementById('pf_ideal_for').value = 'Men';
    document.getElementById('pf_fashion').value = '';
    document.getElementById('pf_category').value = '';
    document.getElementById('pf_subcategory').value = '';
    document.getElementById('pf_color_options').innerHTML = '';
    document.getElementById('pf_color_count').textContent = '0 selected';
    populateParentProductOptions();
    syncProductRoleUI();
    syncCategoryTaxonomy();
    document.getElementById('pf_stock').readOnly = false;
    document.getElementById('pf_stock').removeAttribute('data-size-managed');
    updateSizeInventoryUI({});
    resetCurrentImageState();
    mainInput.value = '';
    catalogInput.value = '';
}

document.getElementById('addProductBtn').addEventListener('click', () => { closeProductModal(); openProductModal('Add New Product'); });
document.getElementById('closeProductModal').addEventListener('click', closeProductModal);
document.getElementById('cancelProductBtn').addEventListener('click', closeProductModal);
overlay.addEventListener('click', closeProductModal);
document.getElementById('pf_product_role').addEventListener('change', syncProductRoleUI);
document.getElementById('pf_ideal_for').addEventListener('change', () => syncCategoryTaxonomy(document.getElementById('pf_ideal_for').value));
document.getElementById('pf_fashion').addEventListener('change', () => {
    populateCategoryOptions(
        document.getElementById('pf_ideal_for').value,
        document.getElementById('pf_fashion').value
    );
    populateSubcategoryOptions(
        document.getElementById('pf_ideal_for').value,
        document.getElementById('pf_fashion').value,
        document.getElementById('pf_category').value
    );
    renderProductColorOptions();
    updateProductTaxonomySummary();
});
document.getElementById('pf_category').addEventListener('change', () => {
    populateSubcategoryOptions(
        document.getElementById('pf_ideal_for').value,
        document.getElementById('pf_fashion').value,
        document.getElementById('pf_category').value
    );
    renderProductColorOptions();
    updateProductTaxonomySummary();
});
document.getElementById('pf_subcategory').addEventListener('change', () => {
    renderProductColorOptions();
    updateProductTaxonomySummary();
});
loadCatalogTaxonomy();

// ── Image Upload Zones ──
const mainZone = document.getElementById('mainImageZone');
const mainInput = document.getElementById('pf_main_image');
const catalogZone = document.getElementById('catalogImageZone');
const catalogInput = document.getElementById('pf_catalog_images');

mainZone.addEventListener('click', () => mainInput.click());
catalogZone.addEventListener('click', () => catalogInput.click());
document.getElementById('removeCurrentMainImageBtn').addEventListener('click', () => {
    currentMainImageState = null;
    document.getElementById('mainImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">📷</span><p><strong>Click or drag</strong> to upload main image</p><small style="color: var(--text-secondary);">Only JPG, PNG, WebP (Max 10MB)</small>';
    document.getElementById('mainImageActions').style.display = 'none';
    showToast('Current main image marked for removal. Save product to apply.', 'success');
});

mainInput.addEventListener('change', () => {
    const validation = validateImageSelection(mainInput.files, 'Main image', 1);
    if (!validation.valid) {
        showToast(validation.message, 'error');
        mainInput.value = '';
        document.getElementById('mainImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">📷</span><p><strong>Click or drag</strong> to upload main image</p><small style="color: var(--text-secondary);">JPG, PNG (Max 10MB)</small>';
        updateUploadedImagesDisplay();
        return;
    }
    if (mainInput.files[0]) {
        const reader = new FileReader();
        reader.onload = e => {
            document.getElementById('mainImagePreview').innerHTML = `<div class="upload-preview"><img src="${e.target.result}"></div>`;
            updateUploadedImagesDisplay();
        };
        reader.readAsDataURL(mainInput.files[0]);
    }
});
catalogInput.addEventListener('change', () => {
    const validation = validateImageSelection(catalogInput.files, 'Catalog images', 10);
    if (!validation.valid) {
        showToast(validation.message, 'error');
        catalogInput.value = '';
        document.getElementById('catalogImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">🖼️</span><p><strong>Click or drag</strong> to upload multiple angle photos</p><small style="color: var(--text-secondary);">Upload 2-5 images for best results</small>';
        updateUploadedImagesDisplay();
        return;
    }
    const prev = document.getElementById('catalogImagePreview');
    if (catalogInput.files.length) {
        let html = '<div class="catalog-previews">';
        Array.from(catalogInput.files).forEach(f => {
            const url = URL.createObjectURL(f);
            html += `<img src="${url}">`;
        });
        html += '</div>';
        prev.innerHTML = html;
    }
    updateUploadedImagesDisplay();
});

function updateUploadedImagesDisplay() {
    const mainCount = mainInput.files.length ? 1 : 0;
    const catalogCount = catalogInput.files.length;
    const totalImages = mainCount + catalogCount;

    const display = document.getElementById('uploadedImagesDisplay');
    const thumbsContainer = document.getElementById('uploadedImagesThumbs');

    if (totalImages === 0) {
        display.style.display = 'none';
        return;
    }

    // Show count
    document.getElementById('uploadedImageCount').textContent = totalImages;

    // Show thumbnails
    let thumbsHtml = '';

    // Main image
    if (mainInput.files[0]) {
        const url = URL.createObjectURL(mainInput.files[0]);
        thumbsHtml += `<div style="position: relative; border-radius: 4px; overflow: hidden; background: var(--bg-input);">
            <img src="${url}" style="width: 100%; aspect-ratio: 1; object-fit: cover;">
            <div style="position: absolute; top: 2px; left: 2px; background: var(--accent); color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.65rem; font-weight: 600;">MAIN</div>
        </div>`;
    }

    // Catalog images
    Array.from(catalogInput.files).forEach((f, i) => {
        const url = URL.createObjectURL(f);
        thumbsHtml += `<div style="position: relative; border-radius: 4px; overflow: hidden; background: var(--bg-input);">
            <img src="${url}" style="width: 100%; aspect-ratio: 1; object-fit: cover;">
            <div style="position: absolute; top: 2px; left: 2px; background: var(--text-secondary); color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.65rem; font-weight: 600;">+${i + 1}</div>
        </div>`;
    });

    thumbsContainer.innerHTML = thumbsHtml;
    display.style.display = 'block';
}

// Drag & drop
[mainZone, catalogZone].forEach(z => {
    z.addEventListener('dragover', e => { e.preventDefault(); z.style.borderColor = 'var(--accent)'; });
    z.addEventListener('dragleave', () => { z.style.borderColor = ''; });
    z.addEventListener('drop', e => {
        e.preventDefault(); z.style.borderColor = '';
        const input = z === mainZone ? mainInput : catalogInput;
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event('change'));
    });
});

// ── Highlights ──
document.getElementById('addHighlightBtn').addEventListener('click', () => addHighlightRow());
function addHighlightRow(value = '') {
    const container = document.getElementById('highlightsContainer');
    const row = document.createElement('div');
    row.className = 'highlight-row';
    const safeValue = escapeHtml(value);
    row.innerHTML = `<input type="text" class="highlight-input" placeholder="e.g. 100% Premium Cotton" value="${safeValue}"><button type="button" class="remove-highlight" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(row);
}

// ── Save Product with ImageKit Image Upload ──
document.getElementById('productForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('saveProductBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading images...';

    const editId = document.getElementById('editProductId').value;
    const progressDiv = document.getElementById('imageUploadProgress');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressPercent = document.getElementById('uploadProgressPercent');

    // Collect product data
    const productData = {
        name: document.getElementById('pf_name').value,
        description: document.getElementById('pf_description').value,
        sku: document.getElementById('pf_sku').value,
        is_main_product: document.getElementById('pf_product_role').value === 'main',
        parent_product_id: document.getElementById('pf_product_role').value === 'related'
            ? (document.getElementById('pf_parent_product_id').value || null)
            : null,
        display_order: parseInt(document.getElementById('pf_display_order').value) || 0,
        brand: document.getElementById('pf_brand').value,
        fashion_group: document.getElementById('pf_fashion').value,
        category: document.getElementById('pf_category').value,
        subcategory: document.getElementById('pf_subcategory').value,
        color: getSelectedProductColors(),
        ideal_for: document.getElementById('pf_ideal_for').value,
        price: parseFloat(document.getElementById('pf_price').value),
        original_price: document.getElementById('pf_original_price').value ? parseFloat(document.getElementById('pf_original_price').value) : null,
        stock: parseInt(document.getElementById('pf_stock').value),
        min_order_qty: parseInt(document.getElementById('pf_min_order_qty').value),
        listing_status: document.getElementById('pf_listing_status').value,
        badge: document.getElementById('pf_badge').value || null,
        badge_class: document.getElementById('pf_badge').value ? document.getElementById('pf_badge').value.toLowerCase() : '',
        sizes: getSelectedSizes(),
        size_quantities: getSizeQuantitiesFromForm(),
        highlights: Array.from(document.querySelectorAll('.highlight-input')).filter(inp => inp.value.trim()).map(inp => inp.value.trim()),
        existing_catalog_images: JSON.stringify(currentCatalogImagesState),
        remove_main_image: !currentMainImageState,
        initial_rating: document.getElementById('pf_initial_rating').value ? parseFloat(document.getElementById('pf_initial_rating').value) : null
    };

    try {
        if (!editId && !productData.sizes.length) {
            throw new Error('Please select at least one size for a new product');
        }
        if (!productData.is_main_product && !productData.parent_product_id) {
            throw new Error('Please select a parent main product for this related product');
        }

        const mainValidation = validateImageSelection(mainInput.files, 'Main image', 1);
        if (!mainValidation.valid) throw new Error(mainValidation.message);

        const catalogValidation = validateImageSelection(catalogInput.files, 'Catalog images', 10);
        if (!catalogValidation.valid) throw new Error(catalogValidation.message);

        let productId = editId;
        let generatedSku = '';

        // If new product, create it first
        if (!editId) {
            const createRes = await fetch(`${API}/admin/products`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tkn()}`
                },
                body: JSON.stringify(productData)
            });
            const createData = await createRes.json();
            if (!createData.success) throw new Error(createData.message || 'Failed to create product');

            // Fix: Backend returns productId, not id or product.id
            productId = createData.productId;
            generatedSku = createData.sku; // Capture auto-generated SKU
            if (!productId) throw new Error('No product ID returned from server');
        }

        // Handle image uploads
        const mainFiles = mainInput.files;
        const catalogFiles = catalogInput.files;
        const totalFiles = mainFiles.length + catalogFiles.length;

        if (totalFiles > 0) {
            progressDiv.style.display = 'block';
            let uploadedCount = 0;

            // Upload main image
            if (mainFiles[0]) {
                progressPercent.textContent = '0';
                showToast('📤 Uploading main image...', 'info');

                const mainFormData = new FormData();
                mainFormData.append('file', mainFiles[0]);
                mainFormData.append('productId', productId);
                mainFormData.append('folder', 'products');
                mainFormData.append('category', productData.category || '');
                mainFormData.append('color', (productData.color || []).join(', '));

                const uploadData = await uploadProductImage(mainFormData, 'Main image');

                // Save main image to database as featured
                const saveRes = await fetch(`${API}/upload/save-image`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${tkn()}`
                    },
                    body: JSON.stringify({
                        productId,
                        imagekitId: uploadData.fileId,
                        imagekitUrl: uploadData.url,
                        folder: 'products',
                        displayOrder: 0,
                        isFeatured: true
                    })
                });
                if (!saveRes.ok) throw new Error('Failed to save main image');
                currentMainImageState = { url: uploadData.url, fileId: uploadData.fileId };

                uploadedCount++;
                const progress = Math.round((uploadedCount / totalFiles) * 100);
                progressBar.style.width = progress + '%';
                progressPercent.textContent = progress;
            }

            // Upload catalog images (different angles)
            if (catalogFiles.length > 0) {
                for (let i = 0; i < catalogFiles.length; i++) {
                    const catalogFormData = new FormData();
                    catalogFormData.append('file', catalogFiles[i]);
                    catalogFormData.append('productId', productId);
                    catalogFormData.append('folder', 'products');
                    catalogFormData.append('category', productData.category || '');
                    catalogFormData.append('color', (productData.color || []).join(', '));

                    const uploadData = await uploadProductImage(catalogFormData, `Catalog image ${i + 1}`);

                    // Save catalog image to database
                    const saveRes = await fetch(`${API}/upload/save-image`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${tkn()}`
                        },
                        body: JSON.stringify({
                            productId,
                            imagekitId: uploadData.fileId,
                            imagekitUrl: uploadData.url,
                            folder: 'products',
                            displayOrder: i + 1,
                            isFeatured: false
                        })
                    });
                    if (!saveRes.ok) throw new Error(`Failed to save image ${i + 1}`);
                    currentCatalogImagesState.push({ url: uploadData.url, fileId: uploadData.fileId });

                    uploadedCount++;
                    const progress = Math.round((uploadedCount / totalFiles) * 100);
                    progressBar.style.width = progress + '%';
                    progressPercent.textContent = progress;
                }
            }

            progressDiv.style.display = 'none';
        }

        const persistedProductData = {
            ...productData,
            existing_catalog_images: JSON.stringify(currentCatalogImagesState),
            remove_main_image: !currentMainImageState
        };
        const updateRes = await fetch(`${API}/admin/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify(persistedProductData)
        });
        const updateData = await updateRes.json();
        if (!updateData.success) throw new Error(updateData.message);

        showToast(`✅ Product ${editId ? 'updated' : 'created'} successfully!${generatedSku ? ` SKU: ${generatedSku}` : ''} ${totalFiles} image(s) uploaded.`, 'success');
        closeProductModal();
        loadCatalogTaxonomy();
        loadProducts();
        loadStats();

    } catch (e) {
        showToast(`❌ Error: ${e.message}`, 'error');
        progressDiv.style.display = 'none';
    }
    finally {
        btn.disabled = false;
        btn.textContent = 'Save Product';
    }
});

// ── Edit Product ──
window.editProduct = async function (id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    openProductModal('Edit Product');
    populateParentProductOptions(p.parent_product_id || '');
    document.getElementById('editProductId').value = id;
    document.getElementById('pf_name').value = p.name || '';
    document.getElementById('pf_description').value = p.description || '';
    document.getElementById('pf_sku').value = p.sku || '';
    document.getElementById('pf_product_role').value = p.is_main_product ? 'main' : 'related';
    document.getElementById('pf_parent_product_id').value = p.parent_product_id || '';
    document.getElementById('pf_display_order').value = p.display_order || 0;
    document.getElementById('pf_brand').value = p.brand || '';
    syncCategoryTaxonomy(p.ideal_for || '', p.fashion_group || '', p.category || '', p.subcategory || '');
    renderProductColorOptions(p.color || []);
    document.getElementById('pf_badge').value = p.badge || '';
    // Normalize to match <option> values like "4.0", "4.5" etc.
    const ratingSelect = document.getElementById('pf_initial_rating');
    if (p.initial_rating != null && p.initial_rating !== '') {
        const ratingVal = parseFloat(p.initial_rating).toFixed(1);
        // Check if value exists in the options; set it if so
        const matchingOption = Array.from(ratingSelect.options).find(opt => opt.value === ratingVal);
        ratingSelect.value = matchingOption ? ratingVal : '';
    } else {
        ratingSelect.value = '';
    }
    document.getElementById('pf_price').value = p.price || '';
    document.getElementById('pf_original_price').value = p.original_price || '';
    document.getElementById('pf_stock').value = p.stock || 0;
    document.getElementById('pf_min_order_qty').value = p.min_order_qty || 1;
    document.getElementById('pf_listing_status').value = p.listing_status || 'Active';
    resetCurrentImageState();

    // Sizes — robust parsing for all backend formats
    let productSizes = (() => {
        const raw = p.sizes;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(s => typeof s === 'object' ? (s.size || s.name || '') : String(s)).filter(Boolean);
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.map(s => typeof s === 'object' ? (s.size || s.name || '') : String(s)).filter(Boolean);
            } catch {
                // Try comma-separated: "S, M, L, XL"
                return raw.split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        return [];
    })();

    // Fallback: extract sizes from size_inventory if p.sizes was empty
    if (!productSizes.length && Array.isArray(p.size_inventory) && p.size_inventory.length) {
        productSizes = p.size_inventory.map(item => item.size).filter(Boolean);
    }

    console.log('[editProduct] Product #' + id + ' raw sizes:', p.sizes, '| size_inventory:', p.size_inventory, '| resolved:', productSizes);
    document.querySelectorAll('#sizesCheckboxes input').forEach(cb => { cb.checked = productSizes.includes(cb.value); });

    // Size inventory
    const sizeInvMap = {};
    (p.size_inventory || []).forEach(item => { sizeInvMap[item.size] = item.quantity; });
    updateSizeInventoryUI(sizeInvMap);


    // Highlights
    const hc = document.getElementById('highlightsContainer');
    hc.innerHTML = '';
    (p.highlights || []).forEach(h => addHighlightRow(h));

    // Main image preview
    if (p.image_url) {
        currentMainImageState = { url: p.image_url, fileId: p.image_file_id || null };
        document.getElementById('mainImagePreview').innerHTML = `
            <div style="position: relative;">
                <img src="${getImageUrl(p.image_url)}?tr=w:300,h:300,c:cover" style="width: 100%; border-radius: 4px;">
                <div style="position: absolute; top: 8px; left: 8px; background: var(--accent); color: white; padding: 4px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 600;">📷 CURRENT</div>
            </div>
        `;
        document.getElementById('mainImageActions').style.display = 'flex';
    }

    // Catalog previews from actual uploaded image records
    try {
        const imgRes = await fetch(`${API}/upload/product/${id}`);
        const imgData = await imgRes.json();
        const uploadedImages = imgData.success ? (imgData.images || []) : [];
        const extraImages = uploadedImages.filter(img => Number(img.displayOrder) > 0);

        if (extraImages.length) {
            currentCatalogImagesState = extraImages.map(img => ({ url: img.url, fileId: img.fileId || null }));
            renderCurrentCatalogImages();
            document.getElementById('catalogImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">🖼️</span><p><strong>Add more images</strong> if you want fresh angles</p><small style="color: var(--text-secondary);">Current images are shown below and can be removed before saving</small>';
        } else if (p.catalog_images && p.catalog_images.length) {
            currentCatalogImagesState = p.catalog_images.map(img => typeof img === 'object' ? img : ({ url: img, fileId: null }));
            renderCurrentCatalogImages();
            document.getElementById('catalogImagePreview').innerHTML = '<span style="font-size: 2rem; display: block;">🖼️</span><p><strong>Add more images</strong> if you want fresh angles</p><small style="color: var(--text-secondary);">Current images are shown below and can be removed before saving</small>';
        }
    } catch { }

    // Reset file inputs for new uploads
    mainInput.value = '';
    catalogInput.value = '';
    document.getElementById('uploadedImagesDisplay').style.display = 'none';
    syncProductRoleUI();
};

// ── Delete Product ──
window.deleteProduct = async function (id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
        const r = await fetch(`${API}/admin/products/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (d.success) { showToast(d.message, 'success'); loadCatalogTaxonomy(); loadProducts(); loadStats(); }
        else showToast(d.message, 'error');
    } catch { showToast('Delete failed', 'error'); }
};

// =========================================
// AUDIT LOGS
// =========================================
async function loadAuditLogs() {
    const tbody = document.getElementById('auditBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';

    const entity = document.getElementById('auditEntityFilter').value;
    const action = document.getElementById('auditActionFilter').value;

    let qs = `?limit=50`;
    if (entity) qs += `&entity_type=${entity}`;
    if (action) qs += `&action=${action}`;

    try {
        const r = await fetch(`${API}/admin/audit-logs${qs}`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        renderAuditLogs(d.logs);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">⚠️ ${e.message || 'Failed to load logs'}</td></tr>`;
    }
}

function renderAuditLogs(logs) {
    const tbody = document.getElementById('auditBody');
    if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No audit records found.</td></tr>';
        return;
    }
    tbody.innerHTML = logs.map(l => `<tr>
        <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(l.created_at)}</td>
        <td><strong>${l.actor_name}</strong> <span style="font-size:.7rem;color:var(--text-muted)">(${l.actor_type})</span></td>
        <td><span class="status-badge" style="background:var(--bg-table-alt);color:var(--text-primary)">${l.action}</span></td>
        <td><span style="text-transform:capitalize">${l.entity_type}</span></td>
        <td style="color:var(--text-muted)">#${l.entity_id || '—'}</td>
        <td style="font-size:.82rem">${l.description || '—'}</td>
        <td style="color:var(--text-muted);font-size:.75rem">${l.ip_address || '—'}</td>
    </tr>`).join('');
}

document.getElementById('refreshAuditBtn').addEventListener('click', loadAuditLogs);
document.getElementById('auditEntityFilter').addEventListener('change', loadAuditLogs);
document.getElementById('auditActionFilter').addEventListener('change', loadAuditLogs);

// =========================================
// CUSTOMERS
// =========================================
let allCustomers = [];

async function loadCustomers() {
    const tbody = document.getElementById('customersBody');
    tbody.innerHTML = '<tr><td colspan="8" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    try {
        const r = await fetch(`${API}/admin/customers`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        allCustomers = Array.isArray(d.customers) ? d.customers : [];
        renderCustomers();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">⚠️ ${e.message || 'Failed to load customers'}</td></tr>`;
    }
}

function getFilteredCustomers() {
    const searchTerm = String(document.getElementById('customerSearch')?.value || '').trim().toLowerCase();
    const genderFilter = String(document.getElementById('customerGenderFilter')?.value || '').trim().toLowerCase();
    const orderFilter = String(document.getElementById('customerOrderFilter')?.value || 'all').trim();

    return allCustomers.filter((customer) => {
        const totalOrders = Number(customer.total_orders || 0);
        const searchable = [customer.name, customer.email, customer.mobile_number]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (searchTerm && !searchable.includes(searchTerm)) return false;
        if (genderFilter && String(customer.gender || '').trim().toLowerCase() !== genderFilter) return false;
        if (orderFilter === 'with_orders' && totalOrders < 1) return false;
        if (orderFilter === 'repeat' && totalOrders < 2) return false;
        if (orderFilter === 'without_orders' && totalOrders > 0) return false;
        return true;
    });
}

function renderCustomers(customers = getFilteredCustomers()) {
    const tbody = document.getElementById('customersBody');
    if (!customers.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No customers found.</td></tr>';
        return;
    }
    tbody.innerHTML = customers.map(c => `<tr>
        <td><div class="admin-avatar" style="width:40px;height:40px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
        </div></td>
        <td><strong>${c.name || 'Anonymous'}</strong></td>
        <td>${c.email || 'â€”'}</td>
        <td>${c.mobile_number || '-'}</td>
        <td>
            <div style="font-size:.82rem;line-height:1.5;">
                <div>${c.gender || 'â€”'}</div>
                <div style="color:var(--text-muted)">${c.dob ? fmtDate(c.dob) : 'DOB â€”'}</div>
                <div style="color:var(--text-muted)">${[c.city, c.state].filter(Boolean).join(', ') || (c.address_line ? 'Address saved' : 'Address â€”')}</div>
            </div>
        </td>
        <td>
            <div style="font-weight:600">${Number(c.total_orders || 0)}</div>
            <div style="color:var(--text-muted);font-size:.78rem">${fmt(c.total_paid_value || 0)} paid</div>
        </td>
        <td>${fmtDate(c.created_at)}</td>
        <td><span class="status-badge status-Active">Active</span></td>
    </tr>`).join('');
}

document.getElementById('refreshCustomersBtn').addEventListener('click', loadCustomers);
document.getElementById('exportCustomersCsvBtn')?.addEventListener('click', async () => {
    const res = await fetch(`${API}/admin/customers/export?format=csv`, {
        headers: { Authorization: `Bearer ${tkn()}` }
    });
    if (!res.ok) {
        showToast('Failed to export CSV', 'error');
        return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'devasthra-customers.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
});
document.getElementById('exportCustomersExcelBtn')?.addEventListener('click', async () => {
    const res = await fetch(`${API}/admin/customers/export?format=excel`, {
        headers: { Authorization: `Bearer ${tkn()}` }
    });
    if (!res.ok) {
        showToast('Failed to export Excel', 'error');
        return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'devasthra-customers.xls';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
});

document.getElementById('exportOrdersCsvBtn')?.addEventListener('click', async () => {
    const res = await fetch(`${API}/admin/orders/export?format=csv`, {
        headers: { Authorization: `Bearer ${tkn()}` }
    });
    if (!res.ok) {
        showToast('Failed to export orders CSV', 'error');
        return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'devasthra-orders.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
});

document.getElementById('exportOrdersExcelBtn')?.addEventListener('click', async () => {
    const res = await fetch(`${API}/admin/orders/export?format=excel`, {
        headers: { Authorization: `Bearer ${tkn()}` }
    });
    if (!res.ok) {
        showToast('Failed to export orders Excel', 'error');
        return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'devasthra-orders.xls';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
});

function getFilteredCustomers() {
    const searchTerm = String(document.getElementById('customerSearch')?.value || '').trim().toLowerCase();
    const genderFilter = String(document.getElementById('customerGenderFilter')?.value || '').trim().toLowerCase();
    const orderFilter = String(document.getElementById('customerOrderFilter')?.value || 'all').trim();

    return allCustomers.filter((customer) => {
        const totalOrders = Number(customer.total_orders || 0);
        const searchable = [customer.name, customer.email, customer.mobile_number]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        if (searchTerm && !searchable.includes(searchTerm)) return false;
        if (genderFilter && String(customer.gender || '').trim().toLowerCase() !== genderFilter) return false;
        if (orderFilter === 'with_orders' && totalOrders < 1) return false;
        if (orderFilter === 'repeat' && totalOrders < 2) return false;
        if (orderFilter === 'without_orders' && totalOrders > 0) return false;
        return true;
    });
}

function renderCustomers(customers = getFilteredCustomers()) {
    const tbody = document.getElementById('customersBody');
    if (!tbody) return;

    if (!customers.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No customers found.</td></tr>';
        return;
    }

    tbody.innerHTML = customers.map(c => `<tr>
        <td><div class="admin-avatar" style="width:40px;height:40px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
        </div></td>
        <td><strong>${c.name || 'Anonymous'}</strong></td>
        <td>${c.email || '-'}</td>
        <td>${c.mobile_number || '-'}</td>
        <td>
            <div style="font-size:.82rem;line-height:1.5;">
                <div><strong>${c.gender || '-'}</strong></div>
                <div style="color:var(--text-muted)">${c.dob ? fmtDate(c.dob) : 'DOB -'}</div>
            </div>
        </td>
        <td>
            <div style="font-weight:600">${Number(c.total_orders || 0)}</div>
            <div style="color:var(--text-muted);font-size:.78rem">${fmt(c.total_paid_value || 0)} paid</div>
        </td>
        <td>${fmtDate(c.created_at)}</td>
        <td><span class="status-badge status-Active">Active</span></td>
    </tr>`).join('');
}

document.getElementById('customerSearch')?.addEventListener('input', () => renderCustomers());
document.getElementById('customerGenderFilter')?.addEventListener('change', () => renderCustomers());
document.getElementById('customerOrderFilter')?.addEventListener('change', () => renderCustomers());

// =========================================
// SUPPORT CHAT
// =========================================
async function loadSupportConversations() {
    const listEl = document.getElementById('supportConversationList');
    const countEl = document.getElementById('supportConvCount');
    const unreadBadge = document.getElementById('supportUnreadBadge');
    if (!listEl) return;

    try {
        const res = await fetch(`${API}/admin/support/conversations`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to load conversations');
        supportConversations = data.conversations || [];

        if (countEl) countEl.textContent = supportConversations.length;

        const totalUnread = supportConversations.reduce((sum, c) => sum + (Number(c.unread_count) || 0), 0);
        if (unreadBadge) {
            unreadBadge.textContent = totalUnread;
            unreadBadge.style.display = totalUnread > 0 ? 'inline-flex' : 'none';
        }

        if (!supportConversations.length) {
            listEl.innerHTML = `
                <div class="support-empty-state">
                    <div class="support-empty-icon">💬</div>
                    <p>No customer chats yet.</p>
                </div>`;
            renderSupportMessages([], null);
            return;
        }

        if (!activeSupportConversationId) {
            activeSupportConversationId = supportConversations[0].id;
        }

        listEl.innerHTML = supportConversations.map(c => {
            const isActive = Number(c.id) === Number(activeSupportConversationId);
            const initials = (c.user_name || 'C').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            const timeStr = c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            return `
                <div class="support-conv-item ${isActive ? 'active' : ''}" data-support-id="${c.id}">
                    <div class="support-conv-avatar">${initials}</div>
                    <div class="support-conv-info">
                        <div class="support-conv-top">
                            <span class="support-conv-name">${escapeHtml(c.user_name || 'Customer')}</span>
                            <span class="support-conv-time">${timeStr}</span>
                        </div>
                        <div class="support-conv-bottom">
                            <span class="support-conv-last">${escapeHtml(c.last_message || 'No messages yet')}</span>
                            ${Number(c.unread_count) > 0 ? `<span class="support-conv-unread">${c.unread_count}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.support-conv-item').forEach(item => {
            item.addEventListener('click', () => {
                activeSupportConversationId = Number(item.dataset.supportId);
                loadSupportConversations();
            });
        });

        await loadSupportMessages(activeSupportConversationId);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-row" style="padding:20px;">${escapeHtml(err.message || 'Error loading chats')}</div>`;
    }
}

function renderSupportMessages(messages, conversation) {
    const placeholder = document.getElementById('supportThreadPlaceholder');
    const customerHeader = document.getElementById('supportThreadCustomer');
    const messagesEl = document.getElementById('supportMessages');
    const form = document.getElementById('supportReplyForm');

    const nameEl = document.getElementById('supportCustomerName');
    const metaEl = document.getElementById('supportCustomerMeta');
    const avatarEl = document.getElementById('supportCustomerAvatar');

    if (!conversation) {
        if (placeholder) placeholder.style.display = 'flex';
        if (customerHeader) customerHeader.style.display = 'none';
        if (form) form.style.display = 'none';
        if (messagesEl) messagesEl.innerHTML = '';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (customerHeader) customerHeader.style.display = 'flex';
    if (form) form.style.display = 'flex';

    if (nameEl) nameEl.textContent = conversation.user_name || 'Customer';
    if (metaEl) metaEl.textContent = conversation.mobile_number || 'No mobile info';
    if (avatarEl) {
        avatarEl.textContent = (conversation.user_name || 'C').charAt(0).toUpperCase();
    }

    if (!messages.length) {
        messagesEl.innerHTML = `
            <div class="support-empty-chat">
                <p>No messages in this thread yet.</p>
            </div>`;
    } else {
        messagesEl.innerHTML = messages.map(msg => `
            <div class="support-msg ${msg.sender_type === 'admin' ? 'admin' : 'user'}">
                <div class="support-msg-bubble">
                    <div class="support-msg-text">${escapeHtml(msg.message)}</div>
                    <div class="support-msg-time">${fmtDate(msg.created_at)}</div>
                </div>
            </div>
        `).join('');
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Add enter-to-send for the textarea
    const input = document.getElementById('supportReplyInput');
    if (input && !input.dataset.listener) {
        input.dataset.listener = 'true';
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('supportReplyForm').dispatchEvent(new Event('submit'));
            }
        });
    }
}

async function loadSupportMessages(conversationId) {
    if (!conversationId) {
        renderSupportMessages([], null);
        return;
    }

    try {
        const res = await fetch(`${API}/admin/support/conversations/${conversationId}/messages`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to load messages');

        const conversation = supportConversations.find(c => Number(c.id) === Number(conversationId));
        renderSupportMessages(data.messages || [], data.conversation || conversation);
    } catch (err) {
        console.error('loadSupportMessages error:', err);
    }
}

document.getElementById('supportReplyForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!activeSupportConversationId) return;

    const input = document.getElementById('supportReplyInput');
    const message = input.value.trim();
    if (!message) return;

    const btn = document.getElementById('supportSendBtn');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch(`${API}/admin/support/conversations/${activeSupportConversationId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to send reply');
        input.value = '';
        input.style.height = 'auto'; // Reset height
        await loadSupportMessages(activeSupportConversationId);
        // Also refresh list to show last message
        const listRes = await fetch(`${API}/admin/support/conversations`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const listData = await listRes.json();
        if (listData.success) {
            supportConversations = listData.conversations || [];
            // Update list without full reload if possible, but for now just refresh
            loadSupportConversations();
        }
    } catch (err) {
        showToast(err.message || 'Failed to send reply', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
});

document.getElementById('refreshSupportBtn')?.addEventListener('click', loadSupportConversations);
document.getElementById('refreshSupportBtn')?.addEventListener('click', loadContactMessages);
setInterval(() => {
    if (document.getElementById('page-support')?.classList.contains('active')) {
        loadSupportConversations();
        loadContactMessages();
    }
}, 5000);

async function loadContactMessages() {
    const tbody = document.getElementById('contactMessagesBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    try {
        const res = await fetch(`${API}/admin/contact-messages`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to load contact messages');

        if (!(data.messages || []).length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No contact submissions yet.</td></tr>';
            return;
        }

        tbody.innerHTML = data.messages.map((item) => `
            <tr>
                <td><strong>#${item.id}</strong></td>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.email)}</td>
                <td style="max-width:360px;white-space:normal;">${escapeHtml(item.message)}</td>
                <td><span class="status-badge status-${item.status}">${item.status}</span></td>
                <td>${fmtDate(item.created_at)}</td>
                <td>
                    ${item.status === 'New'
                ? `<button class="btn-edit" onclick="markContactReviewed(${item.id})">Mark Reviewed</button>`
                : '<span style="color:var(--text-muted);font-size:.82rem;">Reviewed</span>'}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(err.message || 'Failed to load contact submissions')}</td></tr>`;
    }
}

window.markContactReviewed = async function (id) {
    try {
        const res = await fetch(`${API}/admin/contact-messages/${id}/review`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to update contact message');
        showToast('Contact message marked as reviewed', 'success');
        loadContactMessages();
    } catch (err) {
        showToast(err.message || 'Failed to update contact message', 'error');
    }
};

// =========================================
// RETURNS MANAGEMENT
// =========================================
async function loadReturnRequests() {
    const tbody = document.getElementById('returnsBody');
    const status = document.getElementById('returnStatusFilter').value;
    tbody.innerHTML = '<tr><td colspan="9" class="loading-row"><div class="spinner"></div>Loading returns...</td></tr>';

    try {
        let url = `${API}/admin/returns`;
        if (status) url += `?status=${status}`;

        const r = await fetch(url, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        renderReturnRequests(d.returns);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">⚠️ ${e.message || 'Failed to load returns'}</td></tr>`;
    }
}

function renderReturnRequests(returns) {
    const tbody = document.getElementById('returnsBody');
    if (!returns.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No return requests found.</td></tr>';
        return;
    }

    tbody.innerHTML = returns.map(r => `
        <tr>
            <td><strong>#${r.id}</strong></td>
            <td><a href="#" onclick="switchPage('orders'); return false;">${formatOrderReference(r.order_id, r.invoice_number)}</a></td>
            <td>
                <div style="font-weight:600">${r.customer_name}</div>
                <div style="font-size:0.75rem;color:var(--text-muted)">${r.customer_mobile}</div>
            </td>
            <td>
                <div style="display:flex;gap:10px;align-items:center">
                    <img src="${r.image_url.startsWith('http') ? r.image_url : API + '/' + r.image_url}" style="width:36px;height:36px;object-fit:cover;border-radius:4px">
                    <div>
                        <div style="font-size:0.85rem;font-weight:600">${r.product_name}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">Size: ${r.size} · Qty: ${r.quantity}</div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-size:0.85rem"><strong>${r.reason}</strong></div>
                <div style="font-size:0.75rem;color:var(--text-muted)">${r.description || 'No description'}</div>
            </td>
            <td>
                <strong>${fmt(r.refund_amount)}</strong>
                ${r.refund_request_id ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Ref: ${r.refund_request_id}</div>` : ''}
            </td>
            <td>
                <span class="status-badge status-${r.status.replace(' ', '')}">${r.status}</span>
                ${r.refund_requested_at ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Requested: ${fmtDate(r.refund_requested_at)}</div>` : ''}
                ${r.refund_completed_at ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Completed: ${fmtDate(r.refund_completed_at)}</div>` : ''}
            </td>
            <td style="font-size:0.75rem;color:var(--text-muted)">${fmtDate(r.created_at)}</td>
            <td>
                <div style="display:flex;gap:5px">
                    ${r.status === 'Requested' ? `
                        <button class="btn-sm status-Paid" onclick="updateReturnStatus(${r.id}, 'Approved', 'Approved by admin')">Approve</button>
                        <button class="btn-sm status-Cancelled" onclick="updateReturnStatus(${r.id}, 'Rejected', 'Rejected by admin')">Reject</button>
                    ` : ''}
                    ${r.status === 'Approved' ? `<button class="btn-sm status-Shipped" onclick="updateReturnStatus(${r.id}, 'Pickup Scheduled', 'Pickup scheduled in Shiprocket')">Schedule Pickup</button>` : ''}
                    ${r.status === 'Pickup Scheduled' ? `<button class="btn-sm status-Shipped" onclick="updateReturnStatus(${r.id}, 'Picked Up', 'Sync Shiprocket pickup status')">Sync Pickup Status</button>` : ''}
                    ${r.status === 'Picked Up' ? `<button class="btn-sm status-Paid" onclick="updateReturnStatus(${r.id}, 'Refund Initiated', 'Refund initiated')">Initiate Refund</button>` : ''}
                    ${r.status === 'Refund Initiated' ? `<button class="btn-sm status-Paid" onclick="updateReturnStatus(${r.id}, 'Refund Completed', 'Refund completed after PayU sync')">Sync PayU Status</button>` : ''}
                    ${r.status === 'Refund Completed' ? `<button class="btn-sm status-Packed" onclick="updateReturnStatus(${r.id}, 'Closed', 'Return closed')">Close</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

async function updateReturnStatus(id, status, remarks = '') {
    if (!confirm(`Are you sure you want to change status to ${status}?`)) return;

    try {
        const r = await fetch(`${API}/admin/returns/${id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({ status, admin_remarks: remarks })
        });
        const d = await r.json();
        if (d.success) {
            showToast(`Return #${id} updated to ${status}`, 'success');
            loadReturnRequests();
            loadRefundRequests();
            loadStats(); // Update pending returns count
        } else {
            showToast(d.message || 'Update failed', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

document.getElementById('refreshReturnsBtn').addEventListener('click', loadReturnRequests);
document.getElementById('returnStatusFilter').addEventListener('change', loadReturnRequests);

// ========================================
// EXCHANGE REQUESTS MANAGEMENT
// ========================================

async function loadExchangeRequests() {
    const tbody = document.getElementById('exchangesBody');
    if (!tbody) return;
    
    const status = document.getElementById('exchangeStatusFilter')?.value || '';
    tbody.innerHTML = '<tr><td colspan="9" class="loading-row"><div class="spinner"></div>Loading exchanges...</td></tr>';

    try {
        let url = `${API}/admin/exchanges`;
        if (status) url += `?status=${status}`;

        const r = await fetch(url, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        renderExchangeRequests(d.exchanges || []);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-row">⚠️ ${e.message || 'Failed to load exchanges'}</td></tr>`;
    }
}

function renderExchangeRequests(exchanges) {
    const tbody = document.getElementById('exchangesBody');
    if (!exchanges.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No exchange requests found.</td></tr>';
        return;
    }

    tbody.innerHTML = exchanges.map(ex => `
        <tr>
            <td><strong>#${ex.id}</strong></td>
            <td><a href="#" onclick="switchPage('orders'); return false;">${formatOrderReference(ex.order_id, ex.invoice_number)}</a></td>
            <td>
                <div style="font-weight:600">${ex.customer_name}</div>
                <div style="font-size:0.75rem;color:var(--text-muted)">${ex.customer_mobile}</div>
            </td>
            <td>
                <div style="display:flex;gap:10px;align-items:center">
                    <img src="${ex.image_url.startsWith('http') ? ex.image_url : API + '/' + ex.image_url}" style="width:36px;height:36px;object-fit:cover;border-radius:4px">
                    <div>
                        <div style="font-size:0.85rem;font-weight:600">${ex.product_name}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">Size: ${ex.size} · Qty: ${ex.quantity}</div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-size:0.85rem"><strong>${ex.reason}</strong></div>
                <div style="font-size:0.75rem;color:var(--text-muted)">Requested size: ${ex.requested_size || 'Not specified'}</div>
                ${ex.reason_detail ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${ex.reason_detail}</div>` : ''}
            </td>
            <td>
                <span class="status-badge status-${ex.status.replace(/\s+/g, '')}">${ex.status}</span>
            </td>
            <td style="font-size:0.75rem;color:var(--text-muted)">${fmtDate(ex.created_at)}</td>
            <td>
                <div style="display:flex;gap:5px;flex-direction:column;font-size:0.85rem">
                    ${ex.status === 'Requested' ? `
                        <button class="btn-sm status-Paid" onclick="approveExchangeRequest(${ex.id})">Approve</button>
                        <button class="btn-sm status-Cancelled" onclick="rejectExchangeRequest(${ex.id})">Reject</button>
                    ` : `<span style="padding:6px;border-radius:4px;background:var(--bg-secondary);color:var(--text-muted);">${ex.status}</span>`}
                </div>
            </td>
        </tr>
    `).join('');
}

async function approveExchangeRequest(id) {
    if (!confirm('Approve this exchange request? This will create a return and replacement order in Shiprocket.')) return;

    try {
        const r = await fetch(`${API}/admin/exchange-requests/${id}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({})
        });
        const d = await r.json();
        if (d.success) {
            showToast(`Exchange request #${id} approved ✓`, 'success');
            loadExchangeRequests();
            loadStats();
        } else {
            showToast(d.message || 'Failed to approve', 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    }
}

async function rejectExchangeRequest(id) {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    try {
        const r = await fetch(`${API}/admin/exchange-requests/${id}/reject`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tkn()}`
            },
            body: JSON.stringify({ reason_for_rejection: reason })
        });
        const d = await r.json();
        if (d.success) {
            showToast(`Exchange request #${id} rejected ✓`, 'success');
            loadExchangeRequests();
            loadStats();
        } else {
            showToast(d.message || 'Failed to reject', 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    }
}

// Event listeners for exchange management
document.getElementById('refreshExchangesBtn')?.addEventListener('click', loadExchangeRequests);
document.getElementById('exchangeStatusFilter')?.addEventListener('change', loadExchangeRequests);

// ── Init ──
async function loadRefundRequests() {
    const tbody = document.getElementById('refundsBody');
    const status = document.getElementById('refundStatusFilter').value;
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="loading-row"><div class="spinner"></div>Loading refunds...</td></tr>';

    try {
        let url = `${API}/admin/returns`;
        if (status) url += `?status=${encodeURIComponent(status)}`;

        const r = await fetch(url, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);

        const refunds = (d.returns || []).filter(item => ['Refund Initiated', 'Refund Completed', 'Refund Failed'].includes(item.status));
        if (!refunds.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No refund requests found.</td></tr>';
            return;
        }

        tbody.innerHTML = refunds.map(rf => `
            <tr>
                <td><strong>#${rf.id}</strong></td>
                <td>${formatOrderReference(rf.order_id, rf.invoice_number)}</td>
                <td><div style="font-weight:600">${rf.customer_name}</div><div style="font-size:0.75rem;color:var(--text-muted)">${rf.customer_mobile}</div></td>
                <td>
                    <div style="font-weight:600">${rf.product_name}</div>
                    ${rf.refund_request_id ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Ref: ${rf.refund_request_id}</div>` : ''}
                </td>
                <td><strong>${fmt(rf.refund_amount)}</strong></td>
                <td>
                    <span class="status-badge status-${rf.status.replace(/\s+/g, '')}">${rf.status}</span>
                    ${rf.refund_requested_at ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">Requested: ${fmtDate(rf.refund_requested_at)}</div>` : ''}
                    ${rf.refund_completed_at ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Completed: ${fmtDate(rf.refund_completed_at)}</div>` : ''}
                </td>
                <td style="font-size:0.75rem;color:var(--text-muted)">${fmtDate(rf.created_at)}</td>
                <td>
                    ${rf.status === 'Refund Initiated'
                ? `<button class="btn-sm status-Paid" onclick="updateReturnStatus(${rf.id}, 'Refund Completed', 'Checked and synced with PayU refund status')">Sync PayU Status</button>`
                : rf.status === 'Refund Failed'
                ? `<button class="btn-sm status-Paid" onclick="updateReturnStatus(${rf.id}, 'Refund Initiated', 'Retrying refund after PayU failure')">Retry Refund</button>`
                : `<button class="btn-sm status-Packed" onclick="updateReturnStatus(${rf.id}, 'Closed', 'Refund case closed from refund dashboard')">Close</button>`}
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-row">⚠️ ${e.message || 'Failed to load refunds'}</td></tr>`;
    }
}

document.getElementById('refreshRefundsBtn')?.addEventListener('click', loadRefundRequests);
document.getElementById('refundStatusFilter')?.addEventListener('change', loadRefundRequests);

// =========================================
// PAYMENT HISTORY (NEW)
// =========================================

let currentPaymentPage = 1;
let currentPaymentFilters = {};

async function loadPaymentHistory(page = 1) {
    const tbody = document.getElementById('paymentHistoryBody');
    if (!tbody) return;

    currentPaymentPage = page;
    tbody.innerHTML = '<tr><td colspan="10" class="loading-row"><div class="spinner"></div>Loading payment history...</td></tr>';

    try {
        // Build query params
        const status = document.getElementById('paymentStatusFilter')?.value || '';
        const fromDate = document.getElementById('paymentFromDate')?.value || '';
        const toDate = document.getElementById('paymentToDate')?.value || '';
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);
        params.append('page', page);

        const url = `${API}/admin/payment-history?${params.toString()}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);

        const payments = d.payments || [];
        if (!payments.length) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No payment records found.</td></tr>';
            document.getElementById('paymentHistoryPagination').style.display = 'none';
            return;
        }

        tbody.innerHTML = payments.map(p => `
            <tr>
                <td><strong>#${p.id}</strong></td>
                <td>${formatOrderReference(p.order_id, p.invoice_number)}</td>
                <td><strong>${p.customer_name}</strong></td>
                <td style="font-size:0.85rem;color:var(--text-muted)">${p.customer_mobile || '—'}</td>
                <td><strong>${fmt(p.amount)}</strong></td>
                <td><span style="background:#f0f0f0;padding:4px 8px;border-radius:4px;font-size:0.85rem">${p.gateway || 'Unknown'}</span></td>
                <td>
                    <span class="status-badge status-${p.payment_status === 'Success' ? 'Paid' : p.payment_status === 'Failed' ? 'Cancelled' : 'Pending'}">
                        ${p.payment_status}
                    </span>
                </td>
                <td>
                    ${p.refund_status ? `<span class="status-badge status-${p.refund_status.replace(/\s+/g, '')}">${p.refund_status}</span>` : '<span style="color:var(--text-muted)">—</span>'}
                </td>
                <td style="font-size:0.85rem;color:var(--text-muted)">${fmtDate(p.transaction_date)}</td>
                <td>
                    <button class="btn-sm btn-secondary" onclick="viewPaymentDetails(${p.id})">View</button>
                    ${p.payment_status === 'Created' ? `<button class="btn-sm btn-primary" onclick="syncPaymentStatusModal(${p.id})">Sync</button>` : ''}
                    ${!p.refund_status || p.refund_status === 'Refund Failed' ? `<button class="btn-sm btn-success" onclick="openRefundModal(${p.id})">Refund</button>` : ''}
                </td>
            </tr>
        `).join('');

        // Update pagination
        const { page: currentPage, pageSize, total, totalPages } = d.pagination || {};
        if (totalPages > 1) {
            document.getElementById('paymentHistoryPagination').style.display = 'flex';
            document.getElementById('paymentPageInfo').textContent = `Page ${currentPage} of ${totalPages} (${total} total)`;
            document.getElementById('paymentPrevBtn').disabled = currentPage <= 1;
            document.getElementById('paymentNextBtn').disabled = currentPage >= totalPages;
            document.getElementById('paymentPrevBtn').onclick = () => loadPaymentHistory(currentPage - 1);
            document.getElementById('paymentNextBtn').onclick = () => loadPaymentHistory(currentPage + 1);
        } else {
            document.getElementById('paymentHistoryPagination').style.display = 'none';
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-row">⚠️ ${e.message || 'Failed to load payment history'}</td></tr>`;
    }
}

async function viewPaymentDetails(paymentId) {
    try {
        const r = await fetch(`${API}/admin/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);

        const p = d.payment;
        const content = document.getElementById('paymentDetailsContent');
        
        // Store current payment ID for modal actions
        window.currentPaymentId = paymentId;
        window.currentPaymentAmount = p.amount;

        const refundDetailsHtml = p.refund_status ? `
            <div class="refund-details-section" style="margin-top: 0; padding: 16px; border-left-color: #d32f2f;">
                <strong style="color:#d32f2f;">📋 Refund Information</strong>
                <div style="margin-top:12px;font-size:0.9rem;display:grid;grid-template-columns:1fr auto;gap:12px;">
                    <div>
                        <div style="margin-bottom:8px;"><strong>Status:</strong> <span class="status-badge status-${p.refund_status.replace(/\s+/g, '')}">${p.refund_status}</span></div>
                        <div style="margin-bottom:8px;"><strong>Amount:</strong> <span style="font-weight:700;color:#d32f2f;">${fmt(p.refund_amount)}</span></div>
                        <div><strong>Method:</strong> ${p.refund_mode || 'Original Payment'}</div>
                    </div>
                    ${p.refund_request_id ? `<div style="text-align:right;color:var(--text-muted);font-size:0.8rem;"><strong>Ref ID:</strong><br>${p.refund_request_id}</div>` : ''}
                </div>
            </div>
        ` : '';

        const phonePeDetailsHtml = p.gateway && String(p.gateway).toLowerCase() === 'phonepe' ? `
            <div class="refund-details-section" style="margin-top: 16px; padding: 16px; border-left-color: #673ab7;">
                <strong style="color:#673ab7;">📱 PhonePe Details</strong>
                <div style="margin-top:12px;font-size:0.9rem;display:grid;grid-template-columns:1fr auto;gap:12px;">
                    <div>
                        <div style="margin-bottom:8px;"><strong>Merchant Order ID:</strong> ${p.phonepe_merchant_order_id || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>PhonePe Order ID:</strong> ${p.phonepe_order_id || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>Status:</strong> ${p.phonepe_state || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>Payment Mode:</strong> ${p.phonepe_payment_mode || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>Transaction ID:</strong> ${p.phonepe_transaction_id || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>Transaction State:</strong> ${p.phonepe_transaction_state || '—'}</div>
                        <div style="margin-bottom:8px;"><strong>Error Code:</strong> ${p.phonepe_error_code || '—'}</div>
                        <div><strong>Verified:</strong> ${p.phonepe_webhook_verified ? 'Yes' : 'No'}</div>
                    </div>
                    <div style="text-align:right;color:var(--text-muted);font-size:0.8rem;">
                        ${p.phonepe_webhook_event ? `<strong>Event:</strong><br>${p.phonepe_webhook_event}` : ''}
                    </div>
                </div>
            </div>
        ` : '';

        content.innerHTML = `
            <div>
                <div>
                    <div>
                        <strong>📦 ORDER REFERENCE</strong>
                        <div style="font-size:1.1rem;font-weight:700;margin-top:8px;color:var(--text-primary);">${formatOrderReference(p.order_id, p.invoice_number)}</div>
                    </div>
                    <div style="margin-top:16px;">
                        <strong>👤 CUSTOMER</strong>
                        <div style="margin-top:8px;">
                            <div style="font-weight:600;color:var(--text-primary);">${p.customer_name}</div>
                            <div style="color:var(--text-muted);font-size:0.9rem;margin-top:4px;">📞 ${p.customer_mobile || '—'}</div>
                            <div style="color:var(--text-muted);font-size:0.9rem;">✉️ ${p.customer_email || '—'}</div>
                        </div>
                    </div>
                    <div style="margin-top:16px;">
                        <strong>📍 DELIVERY ADDRESS</strong>
                        <div style="margin-top:8px;font-size:0.9rem;color:var(--text-primary);">
                            ${p.address_line || '—'}<br>
                            <span style="color:var(--text-muted);">${p.city}, ${p.state} ${p.pincode}</span>
                        </div>
                    </div>
                </div>
                <div>
                    <div>
                        <strong>💳 PAYMENT DETAILS</strong>
                        <div style="margin-top:8px;">
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Payment ID:</span> <strong>#${p.id}</strong></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Amount:</span> <strong style="color:#2e7d32;font-size:1.05rem;">${fmt(p.amount)}</strong></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Gateway:</span> <strong>${p.gateway || 'Unknown'}</strong></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Txn ID:</span> <strong style="font-size:0.85rem;">${p.gateway_txn_id || '—'}</strong></div>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span>Status:</span> <span class="status-badge status-${p.payment_status === 'Success' ? 'Paid' : p.payment_status === 'Failed' ? 'Cancelled' : 'Pending'}">${p.payment_status}</span></div>
                            <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-light);"><span style="color:var(--text-muted);font-size:0.85rem;">📅 ${fmtDate(p.created_at)}</span></div>
                        </div>
                    </div>
                    <div style="margin-top:16px;">
                        <strong>📋 ORDER DETAILS</strong>
                        <div style="margin-top:8px;">
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Order Total:</span> <strong>${fmt(p.total_amount)}</strong></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span>Order Status:</span> <strong>${p.order_status}</strong></div>
                            <div style="display:flex;justify-content:space-between;"><span>Payment Method:</span> <strong>${p.payment_method || '—'}</strong></div>
                        </div>
                    </div>
                </div>
            </div>
            ${phonePeDetailsHtml}
            ${refundDetailsHtml}
        `;

        // Update button states
        document.getElementById('syncPaymentStatusBtn').disabled = p.payment_status === 'Success' || p.payment_status === 'Failed';
        document.getElementById('initiateRefundBtn').disabled = !p.payment_status || p.payment_status !== 'Success' || !!p.refund_status;

        const modal = document.getElementById('paymentDetailsModal');
        const overlay = document.getElementById('paymentDetailsModalOverlay');
        if (modal) modal.classList.add('show');
        if (overlay) overlay.classList.add('show');
        document.body.classList.add('modal-open');
    } catch (e) {
        showToast(`error: ${e.message}`, 'error');
    }
}

function closePaymentDetailsModal() {
    const modal = document.getElementById('paymentDetailsModal');
    const overlay = document.getElementById('paymentDetailsModalOverlay');
    if (modal) modal.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('modal-open');
    window.currentPaymentId = null;
    window.currentPaymentAmount = null;
}

async function syncPaymentStatusModal(paymentId) {
    try {
        const r = await fetch(`${API}/admin/payments/${paymentId}/sync-status`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        
        showToast(`✓ Payment synced: ${d.message}`, 'success');
        closePaymentDetailsModal();
        loadPaymentHistory(currentPaymentPage);
    } catch (e) {
        showToast(`✗ ${e.message}`, 'error');
    }
}

async function syncPaymentStatus() {
    if (!window.currentPaymentId) return;
    try {
        const r = await fetch(`${API}/admin/payments/${window.currentPaymentId}/sync-status`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        
        showToast(`✓ Payment synced: ${d.message}`, 'success');
        closePaymentDetailsModal();
        loadPaymentHistory(currentPaymentPage);
    } catch (e) {
        showToast(`✗ ${e.message}`, 'error');
    }
}

function openRefundModal(paymentId) {
    if (paymentId) window.currentPaymentId = paymentId;
    if (!window.currentPaymentId) return;
    
    document.getElementById('refundAmount').value = window.currentPaymentAmount || '';
    document.getElementById('maxRefundText').textContent = `Max refundable: ${fmt(window.currentPaymentAmount || 0)}`;
    document.getElementById('refundMethod').value = 'Original Payment';
    document.getElementById('refundRemarks').value = '';
    
    const modal = document.getElementById('refundModal');
    const overlay = document.getElementById('refundModalOverlay');
    if (modal) modal.classList.add('show');
    if (overlay) overlay.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeRefundModal() {
    const modal = document.getElementById('refundModal');
    const overlay = document.getElementById('refundModalOverlay');
    if (modal) modal.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('modal-open');
}

async function confirmRefund() {
    if (!window.currentPaymentId) return;

    const amount = parseFloat(document.getElementById('refundAmount').value);
    const method = document.getElementById('refundMethod').value;
    const remarks = document.getElementById('refundRemarks').value;

    if (!amount || amount <= 0) {
        showToast('✗ Please enter a valid refund amount', 'error');
        return;
    }

    try {
        const r = await fetch(`${API}/admin/payments/${window.currentPaymentId}/initiate-refund`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tkn()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                refund_amount: amount,
                refund_mode: method,
                remarks
            })
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        
        showToast(`✓ Refund initiated successfully: ${d.message}`, 'success');
        closeRefundModal();
        closePaymentDetailsModal();
        loadPaymentHistory(currentPaymentPage);
    } catch (e) {
        showToast(`✗ ${e.message}`, 'error');
    }
}

// Event listeners for payment history filters
document.getElementById('refreshPaymentHistoryBtn')?.addEventListener('click', () => loadPaymentHistory(1));
document.getElementById('paymentStatusFilter')?.addEventListener('change', () => loadPaymentHistory(1));
document.getElementById('paymentFromDate')?.addEventListener('change', () => loadPaymentHistory(1));
document.getElementById('paymentToDate')?.addEventListener('change', () => loadPaymentHistory(1));

// Export payment history
document.getElementById('exportPaymentHistoryBtn')?.addEventListener('click', async () => {
    try {
        const status = document.getElementById('paymentStatusFilter')?.value || '';
        const fromDate = document.getElementById('paymentFromDate')?.value || '';
        const toDate = document.getElementById('paymentToDate')?.value || '';
        
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);

        const url = `${API}/admin/payment-history?${params.toString()}&format=csv`;
        window.location.href = url;
    } catch (e) {
        showToast(`✗ Export failed: ${e.message}`, 'error');
    }
});

// =========================================
// BANNERS
// =========================================
let editingBannerId = null;

async function loadBanners() {
    const tbody = document.getElementById('bannersBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-row"><div class="spinner"></div>Loading banners...</td></tr>';
    try {
        const r = await fetch(`${API}/admin/banners`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) { if (r.status === 401 || r.status === 403) { doLogout(); return; } throw new Error(d.message); }
        allBanners = d.banners || [];
        renderBanners();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-row">⚠️ ${escapeHtml(e.message || 'Failed to load banners')}</td></tr>`;
    }
}

function renderBanners() {
    const tbody = document.getElementById('bannersBody');
    if (!tbody) return;
    if (!allBanners.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No banners configured yet. Click "+ Add Banner" to get started.</td></tr>';
        return;
    }
    tbody.innerHTML = allBanners.map(b => {
        const slotLabel = BANNER_SLOT_LABELS[b.slot_key] || b.slot_key;
        const preview = b.image_url
            ? `<img src="${escapeHtml(b.image_url)}" style="width:80px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
            : '<div style="width:80px;height:50px;background:var(--bg-input);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-muted)">No image</div>';
        const status = b.is_active
            ? '<span class="status-badge status-Paid">Active</span>'
            : '<span class="status-badge status-Cancelled">Inactive</span>';
        return `<tr>
            <td>${preview}</td>
            <td><strong>${escapeHtml(slotLabel)}</strong><div style="font-size:0.7rem;color:var(--text-muted)">${escapeHtml(b.slot_key)}</div></td>
            <td>
                <div style="font-weight:600">${escapeHtml(b.title || '—')}</div>
                ${b.kicker ? `<div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(b.kicker)}</div>` : ''}
                ${b.description ? `<div style="font-size:0.75rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(b.description)}</div>` : ''}
            </td>
            <td>${b.button_text ? `<span style="font-size:0.8rem">${escapeHtml(b.button_text)}</span>` : '—'}</td>
            <td>${status}</td>
            <td style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap">${b.updated_at ? fmtDate(b.updated_at) : '—'}</td>
            <td>
                <button class="btn-outline btn-sm" onclick="openBannerModal(${b.id})">Edit</button>
                <button class="btn-sm" style="background:var(--danger);color:#fff;border:none;margin-left:4px" onclick="deleteBanner(${b.id})">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function getBannerSlotRule(slotKey) {
    return BANNER_SLOT_RULES[slotKey] || {};
}

function setBannerFieldVisibility() {
    const slotKey = document.getElementById('bf_slot_key')?.value || '';
    const rule = getBannerSlotRule(slotKey);
    const helpEl = document.getElementById('bannerSlotHelp');
    const ctaSection = document.getElementById('bf_cta_section');
    const secondaryCtaRow = document.getElementById('bf_secondary_cta_row');
    const imageSection = document.getElementById('bf_images_section');
    const countdownGroup = document.getElementById('bf_countdown_group');
    const countdownToggleRow = document.getElementById('bf_countdown_toggle_row');
    const kickerGroup = document.getElementById('bf_kicker_group');
    const descriptionLabel = document.getElementById('bf_description_label');
    const titleLabel = document.getElementById('bf_title_label');
    const imageLabel = document.getElementById('bf_image_label');
    const mobileImageLabel = document.getElementById('bf_mobile_image_label');

    if (helpEl) helpEl.textContent = rule.help || 'Select a banner slot to load the right fields for that section.';
    if (ctaSection) ctaSection.style.display = rule.hideCta ? 'none' : '';
    if (secondaryCtaRow) secondaryCtaRow.style.display = rule.hideSecondaryCta || rule.hideCta ? 'none' : '';
    if (rule.hideSecondaryCta) {
        const secondaryText = document.getElementById('bf_secondary_button_text');
        const secondaryLink = document.getElementById('bf_secondary_button_link');
        if (secondaryText) secondaryText.value = '';
        if (secondaryLink) secondaryLink.value = '';
    }
    if (imageSection) imageSection.style.display = rule.hideImages ? 'none' : '';
    if (countdownGroup) countdownGroup.style.display = rule.showCountdown ? '' : 'none';
    if (countdownToggleRow) countdownToggleRow.style.display = rule.showCountdown ? '' : 'none';
    if (kickerGroup) kickerGroup.style.display = rule.hideKicker ? 'none' : '';
    if (rule.hideKicker) {
        const kickerInput = document.getElementById('bf_kicker');
        if (kickerInput) kickerInput.value = '';
    }
    if (descriptionLabel) descriptionLabel.textContent = rule.descriptionLabel || 'Description';
    if (titleLabel) titleLabel.textContent = rule.titleLabel || 'Title *';
    if (imageLabel) imageLabel.textContent = rule.requireImage ? 'Desktop Image *' : 'Desktop Image';
    if (mobileImageLabel) mobileImageLabel.textContent = 'Mobile Image (optional)';
}

function validateBannerPayload(slotKey, body) {
    const rule = getBannerSlotRule(slotKey);
    if (!slotKey) return 'Please select a banner slot';
    if (!String(body.title || '').trim()) return 'Title is required for this banner';
    if (rule.requireImage && !String(body.image_url || '').trim()) return 'Desktop image is required for this banner slot';
    if (rule.requirePrimaryText && !String(body.button_text || '').trim()) return 'Primary button text is required for this banner slot';
    if (rule.requirePrimaryLink && !String(body.button_link || '').trim()) return 'Primary target page is required for this banner slot';
    if (rule.showCountdown && body.show_countdown && !String(body.countdown_target || '').trim()) return 'Please choose the countdown end date and time';
    return '';
}

function openBannerModal(bannerId = null) {
    editingBannerId = bannerId;
    const modal = document.getElementById('bannerModal');
    const overlay = document.getElementById('bannerModalOverlay');
    if (!modal || !overlay) return;

    // Reset form
    document.getElementById('bannerForm').reset();
    document.getElementById('bannerImagePreviewBox').innerHTML = '';
    document.getElementById('bannerMobileImagePreviewBox').innerHTML = '';
    document.getElementById('bannerModalTitle').textContent = bannerId ? 'Edit Banner' : 'Add Banner';
    document.getElementById('bf_image_url').value = '';
    document.getElementById('bf_image_file_id').value = '';
    document.getElementById('bf_mobile_image_url').value = '';
    document.getElementById('bf_mobile_image_file_id').value = '';
    document.getElementById('bf_countdown_target').value = '';
    document.getElementById('bf_show_countdown').checked = false;
    document.getElementById('bannerImageActions').style.display = 'none';
    document.getElementById('bannerMobileImageActions').style.display = 'none';

    if (bannerId) {
        const b = allBanners.find(x => x.id === bannerId);
        if (b) {
            document.getElementById('bf_slot_key').value = b.slot_key || '';
            document.getElementById('bf_title').value = b.title || '';
            document.getElementById('bf_kicker').value = b.kicker || '';
            document.getElementById('bf_subtitle').value = b.subtitle || '';
            document.getElementById('bf_description').value = b.description || '';
            document.getElementById('bf_button_text').value = b.button_text || '';
            document.getElementById('bf_button_link').value = b.button_link || '';
            document.getElementById('bf_secondary_button_text').value = b.secondary_button_text || '';
            document.getElementById('bf_secondary_button_link').value = b.secondary_button_link || '';
            document.getElementById('bf_is_active').checked = b.is_active;
            document.getElementById('bf_display_order').value = b.display_order || 0;
            document.getElementById('bf_image_url').value = b.image_url || '';
            document.getElementById('bf_image_file_id').value = b.image_file_id || '';
            document.getElementById('bf_mobile_image_url').value = b.mobile_image_url || '';
            document.getElementById('bf_mobile_image_file_id').value = b.mobile_image_file_id || '';
            document.getElementById('bf_countdown_target').value = b.countdown_target ? String(b.countdown_target).replace(' ', 'T').slice(0, 16) : '';
            document.getElementById('bf_show_countdown').checked = Boolean(b.show_countdown);
            if (b.image_url) {
                document.getElementById('bannerImagePreviewBox').innerHTML = `<img src="${escapeHtml(b.image_url)}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:6px;">`;
                document.getElementById('bannerImageActions').style.display = '';
            }
            if (b.mobile_image_url) {
                document.getElementById('bannerMobileImagePreviewBox').innerHTML = `<img src="${escapeHtml(b.mobile_image_url)}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:6px;">`;
                document.getElementById('bannerMobileImageActions').style.display = '';
            }
        }
    }

    setBannerFieldVisibility();
    modal.classList.add('show');
    overlay.classList.add('show');
}

function closeBannerModal() {
    const modal = document.getElementById('bannerModal');
    const overlay = document.getElementById('bannerModalOverlay');
    if (modal) modal.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    editingBannerId = null;
}

async function uploadBannerImage(file) {
    const validation = validateImageSelection([file], 'Banner image', 1);
    if (!validation.valid) throw new Error(validation.message);

    const slotKey = document.getElementById('bf_slot_key')?.value || 'banner';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'banners');
    formData.append('productId', slotKey);
    const r = await fetch(`${API}/upload/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tkn()}` },
        body: formData
    });

    if (r.status === 413) {
        throw new Error(`Banner image is too large for the server upload limit. If your file is under ${MAX_IMAGE_UPLOAD_MB}MB, reload Nginx so the new 50MB limit is applied.`);
    }

    const contentType = r.headers.get('content-type') || '';
    const d = contentType.includes('application/json')
        ? await r.json()
        : { success: false, message: await r.text() };

    if (!r.ok || !d.success) {
        throw new Error(d.message || d.error || 'Banner image upload failed');
    }

    return { url: d.url, fileId: d.fileId };
}

async function saveBanner(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('saveBannerBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        // Upload images if selected
        const imageInput = document.getElementById('bf_image_file');
        const mobileImageInput = document.getElementById('bf_mobile_image_file');

        let image_url = document.getElementById('bf_image_url').value;
        let image_file_id = document.getElementById('bf_image_file_id').value;
        let mobile_image_url = document.getElementById('bf_mobile_image_url').value;
        let mobile_image_file_id = document.getElementById('bf_mobile_image_file_id').value;

        if (imageInput?.files?.length) {
            const uploaded = await uploadBannerImage(imageInput.files[0]);
            image_url = uploaded.url;
            image_file_id = uploaded.fileId;
        }
        if (mobileImageInput?.files?.length) {
            const uploaded = await uploadBannerImage(mobileImageInput.files[0]);
            mobile_image_url = uploaded.url;
            mobile_image_file_id = uploaded.fileId;
        }

        const body = {
            slot_key: document.getElementById('bf_slot_key').value,
            title: document.getElementById('bf_title').value.trim(),
            kicker: document.getElementById('bf_kicker').value.trim(),
            subtitle: document.getElementById('bf_subtitle').value.trim(),
            description: document.getElementById('bf_description').value.trim(),
            button_text: document.getElementById('bf_button_text').value,
            button_link: document.getElementById('bf_button_link').value,
            secondary_button_text: document.getElementById('bf_secondary_button_text').value,
            secondary_button_link: document.getElementById('bf_secondary_button_link').value,
            image_url,
            image_file_id,
            mobile_image_url,
            mobile_image_file_id,
            countdown_target: document.getElementById('bf_countdown_target').value || null,
            show_countdown: document.getElementById('bf_show_countdown').checked,
            is_active: document.getElementById('bf_is_active').checked,
            display_order: parseInt(document.getElementById('bf_display_order').value) || 0
        };

        const validationMessage = validateBannerPayload(body.slot_key, body);
        if (validationMessage) throw new Error(validationMessage);

        const method = editingBannerId ? 'PUT' : 'POST';
        const url = editingBannerId ? `${API}/admin/banners/${editingBannerId}` : `${API}/admin/banners`;

        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tkn()}` },
            body: JSON.stringify(body)
        });

        const contentType = r.headers.get('content-type') || '';
        const d = contentType.includes('application/json')
            ? await r.json()
            : { success: false, message: await r.text() };

        if (!r.ok || !d.success) throw new Error(d.message || d.error || 'Failed to save banner');

        showToast(d.message || 'Banner saved!', 'success');
        closeBannerModal();
        loadBanners();
    } catch (err) {
        showToast(err.message || 'Failed to save banner', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Banner';
    }
}

window.deleteBanner = async function (id) {
    if (!confirm('Delete this banner? This cannot be undone.')) return;
    try {
        const r = await fetch(`${API}/admin/banners/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        showToast('Banner deleted', 'success');
        loadBanners();
    } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
    }
};

window.openBannerModal = openBannerModal;
// Banner modal event listeners
document.getElementById('openBannerModalBtn')?.addEventListener('click', () => openBannerModal());
document.getElementById('closeBannerModal')?.addEventListener('click', closeBannerModal);
document.getElementById('bannerModalOverlay')?.addEventListener('click', closeBannerModal);
document.getElementById('cancelBannerBtn')?.addEventListener('click', closeBannerModal);
document.getElementById('bannerForm')?.addEventListener('submit', saveBanner);
document.getElementById('bf_slot_key')?.addEventListener('change', setBannerFieldVisibility);

// Image preview handlers
document.getElementById('bf_image_file')?.addEventListener('change', function () {
    const preview = document.getElementById('bannerImagePreviewBox');
    if (this.files?.length && preview) {
        const reader = new FileReader();
        reader.onload = e => preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:6px;">`;
        reader.readAsDataURL(this.files[0]);
        document.getElementById('bannerImageActions').style.display = 'none';
    }
});
document.getElementById('bf_mobile_image_file')?.addEventListener('change', function () {
    const preview = document.getElementById('bannerMobileImagePreviewBox');
    if (this.files?.length && preview) {
        const reader = new FileReader();
        reader.onload = e => preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:6px;">`;
        reader.readAsDataURL(this.files[0]);
        document.getElementById('bannerMobileImageActions').style.display = 'none';
    }
});

document.getElementById('removeBannerImageBtn')?.addEventListener('click', () => {
    document.getElementById('bf_image_url').value = '';
    document.getElementById('bf_image_file_id').value = '';
    document.getElementById('bf_image_file').value = '';
    document.getElementById('bannerImagePreviewBox').innerHTML = '';
    document.getElementById('bannerImageActions').style.display = 'none';
    showToast('Current desktop banner image will be removed when you save.', 'success');
});

document.getElementById('removeBannerMobileImageBtn')?.addEventListener('click', () => {
    document.getElementById('bf_mobile_image_url').value = '';
    document.getElementById('bf_mobile_image_file_id').value = '';
    document.getElementById('bf_mobile_image_file').value = '';
    document.getElementById('bannerMobileImagePreviewBox').innerHTML = '';
    document.getElementById('bannerMobileImageActions').style.display = 'none';
    showToast('Current mobile banner image will be removed when you save.', 'success');
});

loadStats();
loadRecentOrders();

// ═══════════════════════════════════════
// COUPON MANAGEMENT
// ═══════════════════════════════════════
let editingCouponId = null;

async function loadCoupons() {
    const body = document.getElementById('couponsBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="9" class="loading-row"><div class="spinner"></div>Loading...</td></tr>';
    try {
        const r = await fetch(`${API}/admin/coupons`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        if (!d.coupons.length) {
            body.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted);">No coupons created yet. Click "+ Add Coupon" to create one.</td></tr>';
            return;
        }
        body.innerHTML = d.coupons.map(c => {
            const now = new Date();
            const startDate = c.start_date ? new Date(c.start_date) : null;
            const endDate = c.end_date ? new Date(c.end_date) : null;
            if (startDate) startDate.setHours(0, 0, 0, 0);
            if (endDate) endDate.setHours(23, 59, 59, 999);
            const started = !startDate || startDate <= now;
            const expired = !!endDate && endDate < now;
            const statusLabel = !c.is_active ? 'Inactive' : expired ? 'Expired' : !started ? 'Scheduled' : 'Active';
            const statusClass = statusLabel === 'Active' ? 'success' : statusLabel === 'Inactive' ? '' : statusLabel === 'Expired' ? 'danger' : 'warning';
            const valStr = c.discount_type === 'flat' ? `₹${c.discount_value}` : `${c.discount_value}%${c.max_discount ? ' (max ₹' + c.max_discount + ')' : ''}`;
            const usageStr = c.usage_limit ? `${c.used_count}/${c.usage_limit}` : `${c.used_count}/∞`;
            const fmtD = dt => dt ? new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
            const validityStr = `${fmtD(c.start_date)} → ${fmtD(c.end_date)}`;
            return `<tr>
                <td><code style="background:var(--bg);padding:3px 8px;border-radius:4px;font-weight:600;letter-spacing:.04em;">${c.code}</code></td>
                <td>${c.discount_type === 'flat' ? 'Flat' : '%'}</td>
                <td>${valStr}</td>
                <td style="text-transform:capitalize;">${c.scope}${c.scope !== 'all' && c.scope_ids?.length ? ' (' + c.scope_ids.length + ')' : ''}</td>
                <td>₹${c.min_order_value || 0}</td>
                <td>${usageStr} · ${c.per_user_limit || 1}/user</td>
                <td style="font-size:0.82rem;">${validityStr}</td>
                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                <td>
                    <div class="action-btns">
                        <button class="btn-icon" onclick="openCouponModal(${c.id})" title="Edit">✎</button>
                        <button class="btn-icon danger" onclick="deleteCoupon(${c.id})" title="Delete">🗑</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    } catch (err) {
        body.innerHTML = `<tr><td colspan="9" style="color:#ef4444;text-align:center;padding:20px;">${err.message || 'Failed to load'}</td></tr>`;
    }
}

function getCouponCategoryScopeOptions() {
    return Object.entries(structuredCatalogTaxonomy || {}).flatMap(([audience, audienceEntry]) =>
        (audienceEntry?.fashions || []).flatMap((fashionEntry) =>
            (fashionEntry?.categories || []).map((categoryEntry) => ({
                id: Number(categoryEntry.id),
                label: [audience, fashionEntry.fashion, categoryEntry.category].filter(Boolean).join(' / ')
            }))
        )
    ).filter((entry) => Number.isFinite(entry.id));
}

function getCouponProductScopeOptions() {
    return (allProducts || [])
        .map((product) => ({
            id: Number(product.id),
            label: product.name ? `${product.name} (#${product.id})` : `Product #${product.id}`
        }))
        .filter((entry) => Number.isFinite(entry.id))
        .sort((a, b) => a.label.localeCompare(b.label));
}

async function ensureCouponScopeData(scope) {
    if (scope === 'category' && !Object.keys(structuredCatalogTaxonomy || {}).length) {
        await loadCatalogTaxonomy();
    }

    if (scope === 'product' && !couponProductOptionsLoaded) {
        const r = await fetch(`${API}/admin/products`, { headers: { Authorization: `Bearer ${tkn()}` } });
        const d = await r.json();
        if (!d.success) throw new Error(d.message || 'Failed to load products for coupon scope');
        allProducts = Array.isArray(d.products) ? d.products : [];
        couponProductOptionsLoaded = true;
    }
}

function getCouponScopeOptions(scope) {
    if (scope === 'product') return getCouponProductScopeOptions();
    if (scope === 'category') return getCouponCategoryScopeOptions();
    return [];
}

function updateCouponScopeSummary() {
    const summary = document.getElementById('cf_scope_summary');
    const select = document.getElementById('cf_scope_ids');
    if (!summary || !select) return;
    const selectedLabels = Array.from(select.selectedOptions || []).map((option) => option.textContent.trim()).filter(Boolean);
    summary.textContent = selectedLabels.length ? selectedLabels.join(', ') : 'No items selected yet.';
}

function setCouponScopeSelections(ids = []) {
    const select = document.getElementById('cf_scope_ids');
    if (!select) return;
    const selectedSet = new Set((ids || []).map((id) => Number(id)).filter(Number.isFinite));
    Array.from(select.options).forEach((option) => {
        option.selected = selectedSet.has(Number(option.value));
    });
    updateCouponScopeSummary();
}

async function refreshCouponScopeField(selectedIds = []) {
    const scope = document.getElementById('cf_scope')?.value || 'all';
    const group = document.getElementById('cf_scope_ids_group');
    const select = document.getElementById('cf_scope_ids');
    if (!group || !select) return;

    if (scope === 'all') {
        group.style.display = 'none';
        select.innerHTML = '';
        updateCouponScopeSummary();
        return;
    }

    group.style.display = '';
    await ensureCouponScopeData(scope);

    const options = getCouponScopeOptions(scope);
    const placeholder = scope === 'product' ? 'No products available.' : 'No categories available.';
    select.innerHTML = options.length
        ? options.map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`).join('')
        : `<option value="" disabled>${placeholder}</option>`;

    setCouponScopeSelections(selectedIds);
}

async function openCouponModal(couponId = null) {
    editingCouponId = couponId;
    const title = document.getElementById('couponModalTitle');
    if (title) title.textContent = couponId ? 'Edit Coupon' : 'Add Coupon';

    // Reset form
    document.getElementById('cf_code').value = '';
    document.getElementById('cf_discount_type').value = 'percentage';
    document.getElementById('cf_discount_value').value = '';
    document.getElementById('cf_max_discount').value = '';
    document.getElementById('cf_max_discount').disabled = false;
    document.getElementById('cf_min_order_value').value = '0';
    document.getElementById('cf_scope').value = 'all';
    document.getElementById('cf_scope_ids').innerHTML = '';
    document.getElementById('cf_scope_ids_group').style.display = 'none';
    document.getElementById('cf_usage_limit').value = '';
    document.getElementById('cf_per_user_limit').value = '1';
    document.getElementById('cf_start_date').value = '';
    document.getElementById('cf_end_date').value = '';
    document.getElementById('cf_is_active').checked = true;
    document.getElementById('cf_send_in_newsletter').checked = false;
    updateCouponScopeSummary();

    document.getElementById('couponModal').classList.add('show');
    document.getElementById('couponModalOverlay').classList.add('show');

    // If editing, populate from existing data
    if (couponId) {
        try {
            const r = await fetch(`${API}/admin/coupons`, { headers: { Authorization: `Bearer ${tkn()}` } });
            const d = await r.json();
            const c = d.coupons?.find(x => x.id === couponId);
            if (!c) return;
            document.getElementById('cf_code').value = c.code || '';
            document.getElementById('cf_discount_type').value = c.discount_type || 'percentage';
            document.getElementById('cf_discount_value').value = c.discount_value || '';
            document.getElementById('cf_max_discount').value = c.max_discount || '';
            document.getElementById('cf_max_discount').disabled = (c.discount_type || 'percentage') === 'flat';
            document.getElementById('cf_min_order_value').value = c.min_order_value || 0;
            document.getElementById('cf_scope').value = c.scope || 'all';
            await refreshCouponScopeField(c.scope_ids || []);
            document.getElementById('cf_usage_limit').value = c.usage_limit || '';
            document.getElementById('cf_per_user_limit').value = c.per_user_limit || 1;
            if (c.start_date) document.getElementById('cf_start_date').value = new Date(c.start_date).toISOString().slice(0, 16);
            if (c.end_date) document.getElementById('cf_end_date').value = new Date(c.end_date).toISOString().slice(0, 16);
            document.getElementById('cf_is_active').checked = !!c.is_active;
            document.getElementById('cf_send_in_newsletter').checked = !!c.send_in_newsletter;
        } catch (error) {
            showToast(error.message || 'Failed to load coupon details', 'error');
        }
    } else {
        await refreshCouponScopeField([]);
    }
}

function closeCouponModal() {
    document.getElementById('couponModal')?.classList.remove('show');
    document.getElementById('couponModalOverlay')?.classList.remove('show');
    editingCouponId = null;
}

async function saveCoupon(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('saveCouponBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const code = document.getElementById('cf_code').value.trim().toUpperCase();
        const discountType = document.getElementById('cf_discount_type').value;
        const discountValue = parseFloat(document.getElementById('cf_discount_value').value);
        const maxDiscount = parseFloat(document.getElementById('cf_max_discount').value) || null;
        const minOrderValue = parseFloat(document.getElementById('cf_min_order_value').value) || 0;
        const scope = document.getElementById('cf_scope').value;
        const usageLimit = parseInt(document.getElementById('cf_usage_limit').value) || null;
        const perUserLimit = parseInt(document.getElementById('cf_per_user_limit').value) || 1;
        const startDate = document.getElementById('cf_start_date').value || null;
        const endDate = document.getElementById('cf_end_date').value || null;
        const scopeIds = Array.from(document.getElementById('cf_scope_ids').selectedOptions || [])
            .map((option) => parseInt(option.value, 10))
            .filter((value) => !Number.isNaN(value));

        if (!code) throw new Error('Coupon code is required');
        if (!(discountValue > 0)) throw new Error('Discount value must be greater than 0');
        if (discountType === 'percentage' && discountValue > 100) throw new Error('Percentage discount cannot exceed 100');
        if (scope !== 'all' && !scopeIds.length) throw new Error(`Select at least one valid ${scope}`);
        if (usageLimit !== null && usageLimit < 1) throw new Error('Usage limit must be at least 1');
        if (perUserLimit < 1) throw new Error('Per user limit must be at least 1');
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) throw new Error('End date must be after start date');

        const body = {
            code,
            discount_type: discountType,
            discount_value: discountValue,
            max_discount: discountType === 'flat' ? null : maxDiscount,
            min_order_value: minOrderValue,
            scope,
            scope_ids: scopeIds,
            usage_limit: usageLimit,
            per_user_limit: perUserLimit,
            start_date: startDate,
            end_date: endDate,
            is_active: document.getElementById('cf_is_active').checked,
            send_in_newsletter: document.getElementById('cf_send_in_newsletter').checked
        };

        const method = editingCouponId ? 'PUT' : 'POST';
        const url = editingCouponId ? `${API}/admin/coupons/${editingCouponId}` : `${API}/admin/coupons`;

        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tkn()}` },
            body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);

        showToast(d.message || 'Coupon saved!', 'success');
        closeCouponModal();
        loadCoupons();
    } catch (err) {
        showToast(err.message || 'Failed to save coupon', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Coupon';
    }
}

window.deleteCoupon = async function (id) {
    if (!confirm('Delete this coupon? This cannot be undone.')) return;
    try {
        const r = await fetch(`${API}/admin/coupons/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${tkn()}` }
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        showToast('Coupon deleted', 'success');
        loadCoupons();
    } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
    }
};

window.openCouponModal = openCouponModal;

// Coupon modal event listeners
document.getElementById('openCouponModalBtn')?.addEventListener('click', () => openCouponModal());
document.getElementById('closeCouponModal')?.addEventListener('click', closeCouponModal);
document.getElementById('couponModalOverlay')?.addEventListener('click', closeCouponModal);
document.getElementById('cancelCouponBtn')?.addEventListener('click', closeCouponModal);
document.getElementById('couponForm')?.addEventListener('submit', saveCoupon);

// Toggle scope IDs field
document.getElementById('cf_scope')?.addEventListener('change', function () {
    refreshCouponScopeField([]);
});

document.getElementById('cf_scope_ids')?.addEventListener('change', updateCouponScopeSummary);

document.getElementById('cf_discount_type')?.addEventListener('change', function () {
    const maxDiscountInput = document.getElementById('cf_max_discount');
    if (!maxDiscountInput) return;
    const isFlat = this.value === 'flat';
    maxDiscountInput.disabled = isFlat;
    if (isFlat) maxDiscountInput.value = '';
});
