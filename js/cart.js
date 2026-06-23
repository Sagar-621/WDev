/* ========================================
   DEVASTHRA - Cart Page with OTP Login + PayU
   ======================================== */
const API_BASE = window.__API_BASE || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' ? 'http://localhost:5000' : window.location.origin);
const getToken = () => localStorage.getItem('DEVASTHRA_token');
const getUser = () => {
    try { return JSON.parse(localStorage.getItem('DEVASTHRA_user')); }
    catch { return null; }
};

function normalizeDateOnly(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

document.addEventListener('DOMContentLoaded', async () => {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMessage');
    const layout = document.getElementById('cartLayout');

    // Always start with scrolling enabled; modal handlers toggle this when needed.
    document.body.style.overflow = '';

    let toastTimer;
    function showToast(msg, type = 'info') {
        clearTimeout(toastTimer);
        toastMsg.textContent = msg;
        toast.className = `toast show ${type}`;
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
    }

    /* Header behavior is handled by site-header.js — no duplicate code here */
    window.syncHeaderAuthUI?.();

    // OTP modal
    const overlay = document.getElementById('otpOverlay');
    const modal = document.getElementById('otpModal');
    const closeBtn = document.getElementById('otpCloseBtn');
    const step1 = document.getElementById('otpStep1');
    const step2 = document.getElementById('otpStep2');
    const mobileInp = document.getElementById('otpMobile');
    const emailInp = document.getElementById('otpEmailOptional');
    const otpInp = document.getElementById('otpInput');
    const otpRegFields = document.getElementById('otpRegFields');
    const otpRegName = document.getElementById('otpRegName');
    const otpRegEmail = document.getElementById('otpRegEmail');
    const otpRegMobile = document.getElementById('otpRegMobile');
    const otpRegDob = document.getElementById('otpRegDob');
    const otpRegGender = document.getElementById('otpRegGender');
    const sendBtn = document.getElementById('sendOtpBtn');
    const verifyBtn = document.getElementById('verifyOtpBtn');
    const resendBtn = document.getElementById('resendOtpBtn');
    const msgEl = document.getElementById('otpMessage');

    let resendTimer;
    let currentMobile = '';
    let currentAuthMode = 'mobile';
    let currentAuthIdentifier = '';
    let currentIsNewUser = false;

    function setOtpHeader(title, description) {
        const modalHeader = modal?.querySelector('.otp-modal-header');
        if (!modalHeader) return;
        const titleEl = modalHeader.querySelector('h2');
        const descEl = modalHeader.querySelector('p');
        if (titleEl) titleEl.textContent = title;
        if (descEl) descEl.textContent = description;
    }

    function setSignupFieldsVisible(isVisible, prefill = {}) {
        if (otpRegFields) {
            otpRegFields.hidden = !isVisible;
            otpRegFields.style.display = isVisible ? 'grid' : 'none';
        }
        if (otpRegEmail) otpRegEmail.readOnly = false;
        if (otpRegMobile) otpRegMobile.readOnly = false;
        if (!isVisible) return;

        if (otpRegName) otpRegName.value = prefill.name || '';
        if (otpRegEmail) otpRegEmail.value = prefill.email || '';
        if (otpRegMobile) otpRegMobile.value = prefill.mobile || '';
        if (otpRegDob) otpRegDob.value = normalizeDateOnly(prefill.dob);
        if (otpRegGender) otpRegGender.value = prefill.gender || '';
        if (otpRegMobile && prefill.lockMobile) otpRegMobile.readOnly = true;
        if (otpRegEmail && prefill.lockEmail) otpRegEmail.readOnly = true;
    }

    function openOtpModal() {
        if (!overlay || !modal) return;
        overlay.classList.add('show');
        modal.classList.add('show');
        document.body.classList.add('site-modal-open');
        document.body.style.overflow = 'hidden';
        step1.style.display = 'block';
        step2.style.display = 'none';
        mobileInp.value = '';
        if (emailInp) emailInp.value = '';
        otpInp.value = '';
        currentIsNewUser = false;
        currentAuthMode = 'mobile';
        currentAuthIdentifier = '';
        setSignupFieldsVisible(false);
        setOtpHeader('Login or Sign Up', 'Enter your mobile number or email address to continue');
        setMsg('', 'info');
    }

    function closeOtpModal() {
        overlay.classList.remove('show');
        modal.classList.remove('show');
        document.body.classList.remove('site-modal-open');
        document.body.style.overflow = '';
        clearInterval(resendTimer);
    }

    window.openEmailAuthModal = openOtpModal;
    window.openOTPModal = openOtpModal;
    window.closeEmailAuthModal = closeOtpModal;

    function setMsg(text, type) {
        msgEl.textContent = text;
        msgEl.className = `otp-msg ${type}`;
    }

    function refreshAuthenticatedUI() {
        if (window.renderSiteHeader) window.renderSiteHeader();
        window.syncHeaderAuthUI?.();
    }

    function startResendTimer() {
        let sec = 30;
        resendBtn.disabled = true;
        clearInterval(resendTimer);
        resendTimer = setInterval(() => {
            sec--;
            resendBtn.textContent = sec > 0 ? `Resend OTP in ${sec}s` : 'Resend OTP';
            if (sec <= 0) {
                clearInterval(resendTimer);
                resendBtn.disabled = false;
            }
        }, 1000);
    }

    closeBtn?.addEventListener('click', closeOtpModal);
    overlay?.addEventListener('click', closeOtpModal);
    window.addEventListener('pageshow', () => {
        document.body.style.overflow = '';
    });

    sendBtn?.addEventListener('click', async () => {
        const mobile = mobileInp.value.trim();
        const email = emailInp?.value.trim().toLowerCase() || '';
        const hasValidMobile = /^[6-9]\d{9}$/.test(mobile);
        const hasValidEmail = email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : false;

        if (!hasValidMobile && !hasValidEmail) {
            setMsg('Enter a valid mobile number or email address', 'error');
            return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
        setMsg('', 'info');

        try {
            const endpoint = hasValidMobile ? '/api/send-mobile-login-otp' : '/api/send-login-code';
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hasValidMobile ? { mobile, email } : { email })
            });
            const data = await res.json();
            if (!data.success) {
                setMsg(data.message || 'Failed to send OTP', 'error');
                return;
            }

            currentAuthMode = hasValidMobile ? 'mobile' : 'email';
            currentAuthIdentifier = hasValidMobile ? mobile : email;
            currentMobile = hasValidMobile ? mobile : '';
            currentIsNewUser = Boolean(data.isNewUser);
            console.log('[USER AUTH] Cart OTP response:', {
                isNewUser: currentIsNewUser,
                mobile: currentMobile,
                email: email || '',
                user: data.user || null
            });
            step1.style.display = 'none';
            step2.style.display = 'block';
            startResendTimer();
            setSignupFieldsVisible(currentIsNewUser, {
                name: data.user?.name || '',
                email: data.user?.email || email || '',
                mobile: data.user?.mobile_number || mobile || '',
                dob: normalizeDateOnly(data.user?.dob),
                gender: data.user?.gender || '',
                lockMobile: hasValidMobile,
                lockEmail: hasValidEmail
            });
            setOtpHeader(
                currentIsNewUser ? 'Complete Sign Up' : 'Enter Verification Code',
                currentIsNewUser
                    ? 'Fill in your details and enter the verification code to continue'
                    : `Enter the OTP sent to your ${hasValidMobile ? 'mobile number' : 'email'}`
            );
            setMsg(data.dev ? 'Dev mode: Check backend console for OTP' : `OTP sent successfully to your ${hasValidMobile ? 'mobile number' : 'email'}`, 'success');
            otpInp.focus();
        } catch {
            setMsg('Cannot connect to server', 'error');
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'SEND OTP';
        }
    });

    verifyBtn?.addEventListener('click', async () => {
        const otp = otpInp.value.trim();
        const signupName = otpRegName?.value.trim() || '';
        const signupEmail = otpRegEmail?.value.trim().toLowerCase() || '';
        const signupMobile = (otpRegMobile?.value || currentMobile || currentAuthIdentifier || '').replace(/\D/g, '').slice(-10);
        const signupDob = otpRegDob?.value || '';
        const signupGender = otpRegGender?.value || '';
        if (!/^\d{6}$/.test(otp)) {
            setMsg('Enter valid 6-digit OTP', 'error');
            return;
        }
        if (currentIsNewUser) {
            if (!signupName) { setMsg('Enter your full name', 'error'); return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail)) { setMsg('Enter a valid email address', 'error'); return; }
            if (!/^[6-9]\d{9}$/.test(signupMobile)) { setMsg('Enter a valid mobile number', 'error'); return; }
            if (!signupDob) { setMsg('Enter your date of birth', 'error'); return; }
            if (!signupGender) { setMsg('Select your gender', 'error'); return; }
        }

        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        try {
            const isMobileMode = currentAuthMode === 'mobile';
            const res = await fetch(`${API_BASE}${isMobileMode ? '/api/verify-mobile-login-otp' : '/api/verify-login-code'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mobile: isMobileMode ? (signupMobile || currentMobile) : signupMobile,
                    email: signupEmail || (isMobileMode ? '' : currentAuthIdentifier),
                    code: otp,
                    name: signupName,
                    dob: signupDob,
                    gender: signupGender
                })
            });
            const data = await res.json();
            if (!data.success) {
                setMsg(data.message || 'Invalid OTP', 'error');
                return;
            }

            localStorage.setItem('DEVASTHRA_token', data.token);
            localStorage.setItem('DEVASTHRA_user', JSON.stringify({
                userId: data.userId,
                mobile: data.mobile,
                name: data.name || '',
                email: data.email || signupEmail || '',
                dob: normalizeDateOnly(data.dob || signupDob),
                gender: data.gender || signupGender || ''
            }));

            closeOtpModal();
            refreshAuthenticatedUI();
            showToast('Logged in successfully', 'success');
            await processGuestCartMerge(data.token);
            await loadCart();
            if (currentIsNewUser && window.firePixelCompleteRegistration) {
                window.firePixelCompleteRegistration({
                    content_name: 'Cart Page Sign Up',
                    content_category: 'Registration',
                    method: 'otp'
                });
            }
        } catch {
            setMsg('Verification failed', 'error');
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'VERIFY & CONTINUE';
        }
    });

    resendBtn?.addEventListener('click', async () => {
        if (resendBtn.disabled) return;
        if (!currentAuthIdentifier && !currentMobile) return;
        sendBtn?.click();
    });

    // Pre-payment details modal
    const checkoutOverlay = document.getElementById('checkoutOverlay');
    const checkoutModal = document.getElementById('checkoutModal');
    const checkoutCloseBtn = document.getElementById('checkoutCloseBtn');
    const checkoutCancelBtn = document.getElementById('checkoutCancelBtn');
    const checkoutConfirmBtn = document.getElementById('checkoutConfirmBtn');
    const checkoutMessage = document.getElementById('checkoutMessage');
    const checkoutAddressSummary = document.getElementById('checkoutAddressSummary');
    const checkoutOrderSummary = document.getElementById('checkoutOrderSummary');
    const checkoutPaymentSummary = document.getElementById('checkoutPaymentSummary');
    const checkoutGatewaySummary = document.getElementById('checkoutGatewaySummary');
    let checkoutResolve = null;
    let activeCheckoutAddress = null;

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function formatMoney(value) {
        return '₹' + Number(value || 0).toLocaleString('en-IN');
    }

    function setCheckoutMessage(text = '', type = 'error') {
        if (!checkoutMessage) return;
        checkoutMessage.textContent = text;
        checkoutMessage.style.color = type === 'success' ? '#166534' : '#b42318';
    }

    function getCheckoutCustomerDetails(selectedAddr) {
        const user = getUser() || {};
        return {
            name: user.name || selectedAddr?.name || '',
            email: user.email || '',
            mobile: user.mobile || selectedAddr?.mobile || '',
            dob: normalizeDateOnly(user.dob),
            gender: user.gender || '',
            paymentGateway: selectedPaymentMethod === 'Prepaid' ? selectedPaymentGateway : 'COD'
        };
    }

    function renderGatewayOptions() {
        if (!checkoutGatewaySummary) return;
        if (selectedPaymentMethod === 'COD') {
            checkoutGatewaySummary.innerHTML = '';
            if (checkoutConfirmBtn) checkoutConfirmBtn.disabled = false;
            return;
        }

        ensureSelectedPaymentGateway();
        const gateways = getAvailablePrepaidGateways();
        if (!gateways.length) {
            checkoutGatewaySummary.innerHTML = `
                <strong class="checkout-gateway-title">Online payment unavailable</strong>
                <span class="checkout-gateway-error">PayU and PhonePe are not configured on this server.</span>
            `;
            if (checkoutConfirmBtn) checkoutConfirmBtn.disabled = true;
            return;
        }

        if (checkoutConfirmBtn) checkoutConfirmBtn.disabled = false;
        checkoutGatewaySummary.innerHTML = `
            <strong class="checkout-gateway-title">Choose Payment Gateway</strong>
            ${gateways.map((gateway, index) => `
                <label class="checkout-gateway-option ${index < gateways.length - 1 ? 'has-gap' : ''}">
                    <input type="radio" name="checkoutGateway" value="${gateway}" ${selectedPaymentGateway === gateway ? 'checked' : ''}>
                    <span><strong>${gateway}</strong><small>${getGatewayDescription(gateway)}</small></span>
                </label>
            `).join('')}
        `;
    }

    function renderCheckoutSummary(selectedAddr) {
        if (!selectedAddr) return;
        const currentTotal = calculateSelectedTotal();
        const discountedSubtotal = Math.max(0, currentTotal - (appliedCoupon?.discount_amount || 0));
        const baseShippingCharge = Number(storeConfig.shipping_charge) || 0;
        const freeShippingThreshold = Number(storeConfig.min_order_value) || 0;
        const shippingWaived = freeShippingThreshold > 0 && discountedSubtotal >= freeShippingThreshold;
        const appliedShippingCharge = shippingWaived ? 0 : baseShippingCharge;
        const payableTotal = discountedSubtotal + appliedShippingCharge;
        const addressLabel = normalizeAddressDisplay(selectedAddr);
        const addressText = [
            addressLabel.displayName ? escapeHtml(addressLabel.displayName) : '',
            addressLabel.displayPhone ? `Phone: ${escapeHtml(addressLabel.displayPhone)}` : '',
            [selectedAddr.address_line, selectedAddr.city, selectedAddr.state].filter(Boolean).map(escapeHtml).join(', '),
            selectedAddr.pincode ? `PIN: ${escapeHtml(selectedAddr.pincode)}` : ''
        ].filter(Boolean).join('<br>');

        if (checkoutAddressSummary) {
            checkoutAddressSummary.innerHTML = addressText || 'No address selected';
        }

        if (checkoutOrderSummary) {
            checkoutOrderSummary.innerHTML = `
                <div>Items: <strong>${selectedCartItemIds.length}</strong></div>
                <div>Subtotal: <strong>${escapeHtml(formatMoney(currentTotal))}</strong></div>
                ${appliedCoupon ? `<div>Discount: <strong style="color:#166534;">-${escapeHtml(formatMoney(appliedCoupon.discount_amount))}</strong></div>` : ''}
                <div>Shipping: <strong>${appliedShippingCharge === 0 ? 'FREE' : escapeHtml(formatMoney(appliedShippingCharge))}</strong></div>
                <div>Total: <strong>${escapeHtml(formatMoney(payableTotal))}</strong></div>
            `;
        }

        if (checkoutPaymentSummary) {
            checkoutPaymentSummary.innerHTML = selectedPaymentMethod === 'COD'
                ? '<strong>Cash on Delivery</strong><br><span style="color:#6b7280;">Pay when your order arrives.</span>'
                : '<strong>Pay Online</strong><br><span style="color:#6b7280;">Confirm the gateway below before payment.</span>';
        }

        renderGatewayOptions();
    }

    function openCheckoutModal(selectedAddr) {
        return new Promise((resolve) => {
            checkoutResolve = resolve;
            activeCheckoutAddress = selectedAddr || null;
            renderCheckoutSummary(selectedAddr);
            setCheckoutMessage('');
            checkoutOverlay?.classList.add('show');
            checkoutModal?.classList.add('show');
            document.body.classList.add('site-modal-open');
            document.body.style.overflow = 'hidden';
        });
    }

    function closeCheckoutModal(result = null) {
        checkoutOverlay?.classList.remove('show');
        checkoutModal?.classList.remove('show');
        document.body.classList.remove('site-modal-open');
        document.body.style.overflow = '';
        setCheckoutMessage('');
        const resolver = checkoutResolve;
        checkoutResolve = null;
        activeCheckoutAddress = null;
        resolver?.(result);
    }

    function confirmCheckoutDetails() {
        const customerDetails = getCheckoutCustomerDetails(activeCheckoutAddress);
        closeCheckoutModal(customerDetails);
    }

    checkoutCloseBtn?.addEventListener('click', () => closeCheckoutModal(null));
    checkoutCancelBtn?.addEventListener('click', () => closeCheckoutModal(null));
    checkoutOverlay?.addEventListener('click', () => closeCheckoutModal(null));
    checkoutConfirmBtn?.addEventListener('click', confirmCheckoutDetails);
    checkoutModal?.addEventListener('change', (event) => {
        const target = event.target;
        if (!target || target.name !== 'checkoutGateway') return;
        const gateways = getAvailablePrepaidGateways();
        selectedPaymentGateway = gateways.includes(target.value) ? target.value : (gateways[0] || 'PayU');
        sessionStorage.setItem('selectedPaymentGateway', selectedPaymentGateway);
        renderGatewayOptions();
    });

    // Cart + address state
    const queryParams = new URLSearchParams(window.location.search);
    const selectedFromQuery = Number(queryParams.get('selectedAddress') || 0);
    if (selectedFromQuery > 0) {
        sessionStorage.setItem('selectedAddressId', String(selectedFromQuery));
        if (window.history?.replaceState) window.history.replaceState({}, '', 'cart.html');
    }

    let cartItems = [];
    let selectedCartItemIds = [];
    let cartTotal = 0;
    let addresses = [];
    let selectedAddressId = Number(sessionStorage.getItem('selectedAddressId') || 0) || null;
    let selectedPaymentMethod = sessionStorage.getItem('selectedPaymentMethod') || 'Prepaid';
    let selectedPaymentGateway = sessionStorage.getItem('selectedPaymentGateway') || 'PayU';
    if (!['PayU', 'PhonePe'].includes(selectedPaymentGateway)) {
        selectedPaymentGateway = 'PayU';
    }
    let appliedCoupon = JSON.parse(sessionStorage.getItem('appliedCoupon') || 'null');
    let storeConfig = { cod_enabled: true, min_order_value: 0, cod_min_order_value: 0, shipping_charge: 0 };
    let paymentGatewayConfig = { success: true, available: ['PayU', 'PhonePe', 'COD'], configured: {} };

    function getAvailablePrepaidGateways() {
        return (paymentGatewayConfig.available || []).filter((gateway) => gateway === 'PayU' || gateway === 'PhonePe');
    }

    function getGatewayDescription(gateway) {
        if (gateway === 'PhonePe') return paymentGatewayConfig.configured?.phonepe?.description || 'UPI, Card, Wallet';
        if (gateway === 'PayU') return paymentGatewayConfig.configured?.payu?.description || 'Credit/Debit Card, Wallet, UPI';
        return 'Online payment';
    }

    function ensureSelectedPaymentGateway() {
        const gateways = getAvailablePrepaidGateways();
        if (selectedPaymentMethod === 'COD') {
            selectedPaymentGateway = 'COD';
        } else if (gateways.length && !gateways.includes(selectedPaymentGateway)) {
            selectedPaymentGateway = gateways[0];
        }
        sessionStorage.setItem('selectedPaymentGateway', selectedPaymentGateway);
    }

    function getSelectedCartSnapshot() {
        const selectedItems = cartItems.filter(item => selectedCartItemIds.includes(Number(item.id)));
        return {
            selectionKey: selectedCartItemIds.slice().map(Number).sort((a, b) => a - b).join(','),
            total: selectedItems.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0),
            productIds: selectedItems.map(item => Number(item.product_id)).filter(Boolean),
            categoryIds: [...new Set(selectedItems.map(item => Number(item.category_id)).filter(Boolean))]
        };
    }

    function persistAppliedCoupon() {
        if (appliedCoupon) {
            sessionStorage.setItem('appliedCoupon', JSON.stringify(appliedCoupon));
        } else {
            sessionStorage.removeItem('appliedCoupon');
        }
    }

    function clearAppliedCoupon(options = {}) {
        const { silent = false, message = 'Coupon removed' } = options;
        appliedCoupon = null;
        persistAppliedCoupon();
        if (!silent) showToast(message, 'info');
    }

    function syncAppliedCouponSelection() {
        if (!appliedCoupon) return;
        const snapshot = getSelectedCartSnapshot();
        if (
            (appliedCoupon.selectionKey && appliedCoupon.selectionKey !== snapshot.selectionKey) ||
            Number(appliedCoupon.cart_total || 0) !== Number(snapshot.total || 0)
        ) {
            clearAppliedCoupon({ silent: true });
        }
    }

    async function applyCouponCode(code, options = {}) {
        const { resultEl = null, triggerBtn = null } = options;
        const normalizedCode = String(code || '').trim().toUpperCase();
        if (!normalizedCode) {
            if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444;">Enter a coupon code</span>';
            return false;
        }

        const snapshot = getSelectedCartSnapshot();
        if (!snapshot.productIds.length || snapshot.total <= 0) {
            const message = 'Select at least one cart item before applying a coupon';
            if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444;">${message}</span>`;
            return false;
        }

        if (triggerBtn) {
            triggerBtn.disabled = true;
            triggerBtn.textContent = 'Applying...';
        }

        try {
            const r = await fetch(`${API_BASE}/api/coupons/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({
                    code: normalizedCode,
                    cart_total: snapshot.total,
                    product_ids: snapshot.productIds,
                    category_ids: snapshot.categoryIds
                })
            });
            const d = await r.json();
            if (d.success && d.valid) {
                appliedCoupon = {
                    code: d.coupon.code,
                    id: d.coupon.id,
                    discount_amount: Number(d.discount_amount) || 0,
                    cart_total: Number(snapshot.total) || 0,
                    selectionKey: snapshot.selectionKey
                };
                persistAppliedCoupon();
                if (resultEl) resultEl.innerHTML = `<span style="color:#16a34a;">${d.message}</span>`;
                showToast(d.message, 'success');
                renderCart();
                return true;
            }

            const message = d.message || 'Invalid coupon';
            if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444;">${message}</span>`;
            return false;
        } catch {
            const message = 'Failed to validate coupon';
            if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444;">${message}</span>`;
            return false;
        } finally {
            if (triggerBtn) {
                triggerBtn.disabled = false;
                triggerBtn.textContent = 'Apply';
            }
        }
    }

    function getPendingCart() {
        try {
            return JSON.parse(sessionStorage.getItem('pendingCart') || 'null');
        } catch {
            return null;
        }
    }

    function getPublicImageUrl(url) {
        if (!url) return 'https://via.placeholder.com/300?text=No+Image';
        const raw = typeof url === 'object' && url?.url ? String(url.url).trim() : String(url).trim();
        if (!raw) return 'https://via.placeholder.com/300?text=No+Image';
        if (/^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^image\/svg\+xml/i.test(raw)) return `data:${raw}`;
        if (/^svg\+xml/i.test(raw)) return `data:image/${raw}`;
        return raw.startsWith('/') ? `${API_BASE}${raw}` : `${API_BASE}/${raw}`;
    }

    function updatePendingCart(nextValues = {}) {
        const current = getPendingCart();
        if (!current) return null;
        const updated = { ...current, ...nextValues };
        updated.quantity = Math.max(1, Math.min(10, Number(updated.quantity) || 1));
        sessionStorage.setItem('pendingCart', JSON.stringify(updated));
        return updated;
    }

    function removePendingCart() {
        sessionStorage.removeItem('pendingCart');
        sessionStorage.removeItem('guestCouponCode');
        sessionStorage.removeItem('guestCouponNote');
    }

    async function processPendingCart(token = getToken()) {
        const pending = getPendingCart();
        if (!pending || !token) return false;

        try {
            const res = await fetch(`${API_BASE}/add-to-cart`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    product_id: pending.productId,
                    size: pending.size || null,
                    quantity: Number(pending.quantity) || 1
                })
            });
            const data = await res.json();

            if (!data.success) {
                showToast(data.message || 'Could not add the selected product to cart');
                return false;
            }

            let pendingProduct = {
                name: pending.name || 'Product',
                price: pending.price || 0
            };
            if (!pendingProduct.name || !pendingProduct.price) {
                try {
                    const productRes = await fetch(`${API_BASE}/products/${pending.productId}`);
                    const productData = await productRes.json();
                    if (productData.success && productData.product) {
                        pendingProduct = {
                            name: productData.product.name || pendingProduct.name,
                            price: Number(productData.product.price) || pendingProduct.price
                        };
                    }
                } catch {
                    // Fall back to the pending cart snapshot if product lookup fails.
                }
            }

            sessionStorage.removeItem('pendingCart');
            if (window.firePixelAddToCart) {
                window.firePixelAddToCart({
                    product_id: pending.productId,
                    sku: `SKU-${pending.productId}`,
                    name: pendingProduct.name,
                    price: pendingProduct.price,
                    quantity: Number(pending.quantity) || 1,
                    size: pending.size || ''
                });
            }
            updateCartBadge(data.cartCount);
            showToast('Selected product added to cart', 'success');
            return true;
        } catch {
            showToast('Could not sync the selected product to cart');
            return false;
        }
    }

    async function renderGuestPendingCart() {
        const pending = getPendingCart();
        if (!pending) {
            layout.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">🔐</div>
                    <h2>Your cart is empty</h2>
                    <p>Add a product to see it here.</p>
                    <a href="index.html#categories" class="btn btn-primary">Browse Categories</a>
                </div>`;
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/products/${pending.productId}`);
            const data = await res.json();
            if (!data.success || !data.product) throw new Error('Missing product');
            const product = data.product;
            const qty = Math.max(1, Number(pending.quantity) || 1);
            const sizeLabel = pending.size ? String(pending.size) : 'One Size';
            const price = Number(product.price) || 0;
            const total = price * qty;
            const savedCouponCode = String(sessionStorage.getItem('guestCouponCode') || '').trim().toUpperCase();
            const savedCouponNote = String(sessionStorage.getItem('guestCouponNote') || '').trim();

            layout.innerHTML = `
                <div class="cart-items-col">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;">
                        <h2 class="cart-col-title" style="margin:0;">Your Selected Item</h2>
                        <button type="button" class="btn btn-outline" id="guestRemoveItemBtn">Remove</button>
                    </div>
                    <div class="cart-item" style="border:1px solid rgba(112,8,35,0.08);">
                        <img src="${getPublicImageUrl(product.image_url)}" alt="${product.name}" class="cart-item-img">
                        <div class="cart-item-info">
                            <h3>${product.name}</h3>
                            <p class="cart-item-size">Size: <strong>${sizeLabel}</strong></p>
                            <div class="cart-item-qty-row">
                                <span class="cart-item-qty-label">Qty</span>
                                <div class="cart-item-qty-controls">
                                    <button type="button" class="cart-qty-btn" id="guestQtyMinusBtn">-</button>
                                    <span class="cart-qty-value" id="guestQtyValue">${qty}</span>
                                    <button type="button" class="cart-qty-btn" id="guestQtyPlusBtn">+</button>
                                </div>
                            </div>
                            <p class="cart-item-price">${'₹' + total.toLocaleString('en-IN')}</p>
                        </div>
                    </div>
                </div>

                <div class="cart-summary-col">
                    <div class="cart-summary-card">
                        <h2 class="cart-col-title">Order Summary</h2>
                        <div class="cart-summary-row"><span>Subtotal (1 item)</span><span id="guestSubtotal">${'₹' + total.toLocaleString('en-IN')}</span></div>
                        <div class="cart-summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>
                        <div class="cart-summary-row total"><span>Total</span><span id="guestTotal">${'₹' + total.toLocaleString('en-IN')}</span></div>
                        <div class="cart-coupon-section" style="margin-top:14px;">
                            <div class="cart-coupon-input-wrap">
                                <input type="text" id="guestCouponInput" placeholder="Enter coupon code" maxlength="30" value="${savedCouponCode}">
                                <button type="button" class="btn btn-primary cart-coupon-apply-btn" id="guestCouponBtn">Apply</button>
                            </div>
                            <div id="guestCouponResult" class="cart-coupon-summary">
                                ${savedCouponCode ? `<span class="cart-coupon-chip">Saved: ${savedCouponCode}</span>` : '<span class="cart-coupon-muted">Coupon can be entered here before checkout.</span>'}
                                ${savedCouponNote ? `<div style="margin-top:8px;color:#166534;">${savedCouponNote}</div>` : ''}
                            </div>
                        </div>
                        <p style="color:#6b7280;line-height:1.6;margin:14px 0 14px;">
                            Address and payment details will be asked at the final checkout step.
                        </p>
                        <button class="btn btn-primary cart-proceed-btn" id="guestProceedBtn">Proceed to Checkout</button>
                    </div>
                </div>`;

            document.getElementById('guestQtyMinusBtn')?.addEventListener('click', () => {
                updatePendingCart({ quantity: qty - 1 });
                renderGuestPendingCart();
            });
            document.getElementById('guestQtyPlusBtn')?.addEventListener('click', () => {
                updatePendingCart({ quantity: qty + 1 });
                renderGuestPendingCart();
            });
            document.getElementById('guestRemoveItemBtn')?.addEventListener('click', () => {
                removePendingCart();
                renderGuestPendingCart();
            });
            document.getElementById('guestCouponBtn')?.addEventListener('click', () => {
                const code = String(document.getElementById('guestCouponInput')?.value || '').trim().toUpperCase();
                if (!code) {
                    sessionStorage.removeItem('guestCouponCode');
                    sessionStorage.removeItem('guestCouponNote');
                    renderGuestPendingCart();
                    return;
                }
                sessionStorage.setItem('guestCouponCode', code);
                sessionStorage.setItem('guestCouponNote', 'Coupon saved and will be verified at checkout.');
                renderGuestPendingCart();
            });
            document.getElementById('guestProceedBtn')?.addEventListener('click', openOtpModal);
        } catch {
            layout.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">🛒</div>
                    <h2>Could not load your item</h2>
                    <p>Please try again.</p>
                    <a href="index.html#categories" class="btn btn-primary">Browse Categories</a>
            </div>`;
        }
    }

    function getGuestCartItems() {
        return window.DevasthraGuestCart?.read?.() || [];
    }

    function setGuestCartItems(items) {
        const updated = window.DevasthraGuestCart?.write?.(items) || [];
        updateCartBadge(updated.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
        return updated;
    }

    function updateGuestCartItem(productId, size, quantity) {
        const targetSize = String(size || '');
        const updated = getGuestCartItems().map(item => {
            if (Number(item.productId) !== Number(productId) || String(item.size || '') !== targetSize) return item;
            return {
                ...item,
                quantity: Math.max(1, Math.min(10, Number(quantity) || 1))
            };
        });
        setGuestCartItems(updated);
    }

    function removeGuestCartItem(productId, size) {
        const targetSize = String(size || '');
        setGuestCartItems(getGuestCartItems().filter(item =>
            Number(item.productId) !== Number(productId) || String(item.size || '') !== targetSize
        ));
        sessionStorage.removeItem('guestCouponCode');
        sessionStorage.removeItem('guestCouponNote');
    }

    function clearGuestCart() {
        window.DevasthraGuestCart?.clear?.();
        sessionStorage.removeItem('guestCouponCode');
        sessionStorage.removeItem('guestCouponNote');
    }

    async function processGuestCartMerge(token = getToken()) {
        if (!getGuestCartItems().length || !token) return false;
        try {
            const data = await window.DevasthraGuestCart?.mergeToServer?.(token);
            if (!data?.success) {
                showToast(data?.message || 'Could not sync your guest cart');
                return false;
            }
            updateCartBadge(data.cartCount || 0);
            return true;
        } catch {
            showToast('Could not sync your guest cart');
            return false;
        }
    }

    async function renderGuestCart() {
        const guestCart = getGuestCartItems();
        const guestCount = guestCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        updateCartBadge(guestCount);

        if (!guestCart.length) {
            layout.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">Cart</div>
                    <h2>Your cart is empty</h2>
                    <p>Add a product to see it here.</p>
                    <a href="index.html#categories" class="btn btn-primary">Browse Categories</a>
                </div>`;
            return;
        }

        const items = await Promise.all(guestCart.map(async item => {
            let product = item.productDetails || {};
            if (!product.name || !product.price || !product.image_url) {
                try {
                    const res = await fetch(`${API_BASE}/products/${item.productId}`);
                    const data = await res.json();
                    if (data.success && data.product) product = data.product;
                } catch {
                    // Use the local snapshot if product refresh fails.
                }
            }
            return {
                ...item,
                productDetails: product,
                quantity: Math.max(1, Number(item.quantity) || 1),
                size: item.size || ''
            };
        }));

        const fmtGuest = value => 'Rs. ' + Number(value || 0).toLocaleString('en-IN');
        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
        const total = items.reduce((sum, item) => sum + (Number(item.productDetails?.price) || 0) * item.quantity, 0);
        const savedCouponCode = String(sessionStorage.getItem('guestCouponCode') || '').trim().toUpperCase();
        const savedCouponNote = String(sessionStorage.getItem('guestCouponNote') || '').trim();

        layout.innerHTML = `
            <div class="cart-items-col">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;">
                    <h2 class="cart-col-title" style="margin:0;">Your Cart (${items.length})</h2>
                    <button type="button" class="btn btn-outline" id="guestClearCartBtn">Clear Cart</button>
                </div>
                ${items.map(item => {
            const product = item.productDetails || {};
            const sizeLabel = item.size ? String(item.size) : 'One Size';
            const lineTotal = (Number(product.price) || 0) * item.quantity;
            return `
                <div class="cart-item" style="border:1px solid rgba(112,8,35,0.08);">
                    <img src="${getPublicImageUrl(product.image_url)}" alt="${escapeHtml(product.name || 'Product')}" class="cart-item-img">
                    <div class="cart-item-info">
                        <h3>${escapeHtml(product.name || 'Product')}</h3>
                        <p class="cart-item-size">Size: <strong>${escapeHtml(sizeLabel)}</strong></p>
                        <div class="cart-item-qty-row">
                            <span class="cart-item-qty-label">Qty</span>
                            <div class="cart-item-qty-controls">
                                <button type="button" class="cart-qty-btn guest-qty-btn" data-product-id="${item.productId}" data-size="${escapeHtml(item.size || '')}" data-next-qty="${Math.max(1, item.quantity - 1)}" ${item.quantity <= 1 ? 'disabled' : ''}>-</button>
                                <span class="cart-qty-value">${item.quantity}</span>
                                <button type="button" class="cart-qty-btn guest-qty-btn" data-product-id="${item.productId}" data-size="${escapeHtml(item.size || '')}" data-next-qty="${Math.min(10, item.quantity + 1)}">+</button>
                            </div>
                        </div>
                        <p class="cart-item-price">${fmtGuest(lineTotal)}</p>
                    </div>
                    <button class="cart-remove-btn guest-remove-btn" data-product-id="${item.productId}" data-size="${escapeHtml(item.size || '')}" aria-label="Remove item">Remove</button>
                </div>`;
        }).join('')}
            </div>

            <div class="cart-summary-col">
                <div class="cart-summary-card">
                    <h2 class="cart-col-title">Order Summary</h2>
                    <div class="cart-summary-row"><span>Subtotal (${totalQuantity} items)</span><span>${fmtGuest(total)}</span></div>
                    <div class="cart-summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>
                    <div class="cart-summary-row total"><span>Total</span><span>${fmtGuest(total)}</span></div>
                    <div class="cart-coupon-section" style="margin-top:14px;">
                        <div class="cart-coupon-input-wrap">
                            <input type="text" id="guestCouponInput" placeholder="Enter coupon code" maxlength="30" value="${savedCouponCode}">
                            <button type="button" class="btn btn-primary cart-coupon-apply-btn" id="guestCouponBtn">Apply</button>
                        </div>
                        <div id="guestCouponResult" class="cart-coupon-summary">
                            ${savedCouponCode ? `<span class="cart-coupon-chip">Saved: ${savedCouponCode}</span>` : '<span class="cart-coupon-muted">Coupon can be entered here before checkout.</span>'}
                            ${savedCouponNote ? `<div style="margin-top:8px;color:#166534;">${savedCouponNote}</div>` : ''}
                        </div>
                    </div>
                    <p style="color:#6b7280;line-height:1.6;margin:14px 0 14px;">
                        Address and payment details will be asked after login.
                    </p>
                    <button class="btn btn-primary cart-proceed-btn" id="guestProceedBtn">Proceed to Checkout</button>
                </div>
            </div>`;

        document.querySelectorAll('.guest-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                updateGuestCartItem(btn.dataset.productId, btn.dataset.size, Number(btn.dataset.nextQty));
                renderGuestCart();
            });
        });
        document.querySelectorAll('.guest-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                removeGuestCartItem(btn.dataset.productId, btn.dataset.size);
                renderGuestCart();
            });
        });
        document.getElementById('guestClearCartBtn')?.addEventListener('click', () => {
            clearGuestCart();
            renderGuestCart();
        });
        document.getElementById('guestCouponBtn')?.addEventListener('click', () => {
            const code = String(document.getElementById('guestCouponInput')?.value || '').trim().toUpperCase();
            if (!code) {
                sessionStorage.removeItem('guestCouponCode');
                sessionStorage.removeItem('guestCouponNote');
                renderGuestCart();
                return;
            }
            sessionStorage.setItem('guestCouponCode', code);
            sessionStorage.setItem('guestCouponNote', 'Coupon saved and will be verified at checkout.');
            renderGuestCart();
        });
        document.getElementById('guestProceedBtn')?.addEventListener('click', openOtpModal);
    }

    function isAddressComplete(address) {
        if (!address) return false;
        return !!(
            (address.recipient_name || address.name) &&
            (address.recipient_phone || address.mobile) &&
            address.address_line &&
            address.city &&
            address.state &&
            address.pincode
        );
    }

    function normalizeAddressDisplay(address) {
        const recipientName = String(address?.recipient_name || '').trim();
        const recipientPhone = String(address?.recipient_phone || '').trim();
        const fallbackName = String(address?.name || '').trim();
        const fallbackPhone = String(address?.mobile || '').trim();

        return {
            ...address,
            displayName: recipientName || fallbackName,
            displayPhone: recipientPhone || fallbackPhone
        };
    }

    function normalizeAddressSelection() {
        if (!addresses.length) {
            selectedAddressId = null;
            sessionStorage.removeItem('selectedAddressId');
            return;
        }

        const preferred = Number(sessionStorage.getItem('selectedAddressId') || 0);
        if (preferred > 0 && addresses.some(a => Number(a.id) === preferred)) {
            selectedAddressId = preferred;
        } else if (!selectedAddressId || !addresses.some(a => Number(a.id) === Number(selectedAddressId))) {
            const defaultAddress = addresses.find(a => !!a.is_default) || addresses[0];
            selectedAddressId = Number(defaultAddress.id);
        }

        if (selectedAddressId) {
            sessionStorage.setItem('selectedAddressId', String(selectedAddressId));
        }
    }

    async function loadCart() {
        layout.innerHTML = '<div class="cart-loading"><div class="spinner"></div><p>Loading your cart...</p></div>';
        try {
            const [cartRes, addrRes, configRes, gatewayConfigRes] = await Promise.all([
                fetch(`${API_BASE}/cart`, { headers: { Authorization: `Bearer ${getToken()}` } }),
                fetch(`${API_BASE}/addresses`, { headers: { Authorization: `Bearer ${getToken()}` } }),
                fetch(`${API_BASE}/api/store-config`).catch(() => ({ json: () => ({ success: true, cod_enabled: true, min_order_value: 0, cod_min_order_value: 0, shipping_charge: 0 }) })),
                fetch(`${API_BASE}/api/config/payment-gateways`).catch(() => ({ json: () => ({ success: false }) }))
            ]);
            const cartData = await cartRes.json();
            const addrData = await addrRes.json();
            const configData = await configRes.json();
            const gatewayConfigData = await gatewayConfigRes.json();
            if (configData.success) storeConfig = configData;
            if (gatewayConfigData.success) paymentGatewayConfig = gatewayConfigData;

            cartItems = cartData.success ? (cartData.items || []) : [];
            // Select all by default on first load if nothing selected
            if (selectedCartItemIds.length === 0 && cartItems.length > 0) {
                selectedCartItemIds = cartItems.map(item => Number(item.id));
            }
            // Filter selection to ensure only existing items are selected
            selectedCartItemIds = selectedCartItemIds.filter(id => cartItems.some(item => Number(item.id) === id));

            addresses = addrData.success ? (addrData.addresses || []) : [];

            normalizeAddressSelection();
            renderCart();
            updateCartBadge(cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
        } catch {
            layout.innerHTML = '<p style="color:#c0392b;text-align:center;padding:60px">Cannot connect to server. Make sure backend is running on port 5000.</p>';
        }
    }

    function calculateSelectedTotal() {
        return cartItems
            .filter(item => selectedCartItemIds.includes(Number(item.id)))
            .reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
    }

    function getDeliveryEstimateText(address) {
        const city = String(address?.city || '').trim().toLowerCase();
        if (!city) {
            return 'Estimated delivery: Hyderabad orders usually arrive in 2-3 business days, and other cities in 3-5 business days.';
        }
        return city.includes('hyderabad')
            ? 'Estimated delivery to this address: 2-3 business days within Hyderabad.'
            : 'Estimated delivery to this address: 3-5 business days outside Hyderabad.';
    }

    function renderCart() {
        if (!cartItems.length) {
            clearAppliedCoupon({ silent: true });
            layout.innerHTML = `
                <div class="cart-empty">
                    <div class="cart-empty-icon">🛒</div>
                    <h2>Your cart is empty</h2>
                    <p>Add some products first.</p>
                    <a href="index.html#categories" class="btn btn-primary">Browse Categories</a>
                </div>`;
            return;
        }

        const fmt = p => '₹' + Number(p).toLocaleString('en-IN');
        const getImageUrl = (url) => {
            if (!url) return 'https://via.placeholder.com/300?text=No+Image';
            if (url.startsWith('http')) return url;
            return url.startsWith('/') ? `${API_BASE}${url}` : `${API_BASE}/${url}`;
        };
        const selectedAddr = addresses.find(a => Number(a.id) === Number(selectedAddressId));
        syncAppliedCouponSelection();
        const currentTotal = calculateSelectedTotal();
        const discountedSubtotal = Math.max(0, currentTotal - (appliedCoupon?.discount_amount || 0));
        const freeShippingThreshold = Number(storeConfig.min_order_value) || 0;
        const baseShippingCharge = Number(storeConfig.shipping_charge) || 0;
        const shippingWaived = freeShippingThreshold > 0 && discountedSubtotal >= freeShippingThreshold;
        const appliedShippingCharge = shippingWaived ? 0 : baseShippingCharge;
        const payableTotal = discountedSubtotal + appliedShippingCharge;
        const minOrderRemaining = freeShippingThreshold > 0 && !shippingWaived
            ? Math.max(0, freeShippingThreshold - discountedSubtotal)
            : 0;
        const codAllowed = storeConfig.cod_enabled && (!(storeConfig.cod_min_order_value > 0) || discountedSubtotal >= storeConfig.cod_min_order_value);
        const codRemaining = codAllowed || !(storeConfig.cod_min_order_value > 0)
            ? 0
            : Math.max(0, storeConfig.cod_min_order_value - discountedSubtotal);
        if (selectedPaymentMethod === 'COD' && !codAllowed) {
            selectedPaymentMethod = 'Prepaid';
            sessionStorage.setItem('selectedPaymentMethod', selectedPaymentMethod);
        }
        ensureSelectedPaymentGateway();
        const canProceed = !!selectedAddr && isAddressComplete(selectedAddr) && selectedCartItemIds.length > 0;

        const addrOptions = addresses.length
            ? addresses.map(address => {
                const id = Number(address.id);
                const selected = Number(selectedAddressId) === id;
                const displayAddress = normalizeAddressDisplay(address);
                const complete = isAddressComplete(displayAddress);
                return `
                <div class="addr-option-wrapper">
                    <label class="addr-option ${selected ? 'selected' : ''} ${!complete ? 'incomplete' : ''}">
                        <input type="radio" class="addr-radio" name="selectedAddress" value="${id}" ${selected ? 'checked' : ''}>
                        <div class="addr-option-content">
                            <strong>${displayAddress.displayName || ''}</strong>${displayAddress.displayPhone ? ` · ${displayAddress.displayPhone}` : ''}<br>
                            ${[address.address_line, address.city, address.state].filter(Boolean).join(', ')}${address.pincode ? ` - ${address.pincode}` : ''}
                            ${!complete ? '<div class="addr-incomplete-msg">Incomplete Address</div>' : ''}
                        </div>
                    </label>
                </div>`;
            }).join('')
            : `
                <div class="no-addr">
                    <p>No saved address yet.</p>
                    <a href="address.html" class="btn btn-outline">+ Add Address</a>
                </div>`;

        layout.innerHTML = `
            <div class="cart-items-col">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 class="cart-col-title" style="margin: 0;">Cart Items (${cartItems.length})</h2>
                    <div style="font-size: 0.85rem; color: #6b7280;">
                        <input type="checkbox" id="selectAllItems" ${selectedCartItemIds.length === cartItems.length ? 'checked' : ''}>
                        <label for="selectAllItems" style="cursor: pointer; margin-left: 4px;">Select All</label>
                    </div>
                </div>
                ${cartItems.map(item => {
            const isSelected = selectedCartItemIds.includes(Number(item.id));
            return `
                    <div class="cart-item ${isSelected ? '' : 'deselected'}" data-cart-id="${item.id}" style="${isSelected ? '' : 'opacity: 0.7;'}">
                        <div style="padding-right: 15px; display: flex; align-items: center;">
                            <input type="checkbox" class="cart-item-checkbox" data-cart-id="${item.id}" ${isSelected ? 'checked' : ''}>
                        </div>
                        <img src="${getImageUrl(item.image_url)}" alt="${item.name}" class="cart-item-img">
                        <div class="cart-item-info">
                            <h3 style="${isSelected ? '' : 'text-decoration: none; color: #6b7280;'}">${item.name}</h3>
                            ${item.size ? `<p class="cart-item-size">Size: <strong>${item.size}</strong></p>` : ''}
                            <div class="cart-item-qty-row">
                                <span class="cart-item-qty-label">Qty</span>
                                <div class="cart-item-qty-controls">
                                    <button type="button" class="cart-qty-btn" data-cart-id="${item.id}" data-next-qty="${Math.max(1, Number(item.quantity) - 1)}" ${Number(item.quantity) <= 1 ? 'disabled' : ''}>-</button>
                                    <span class="cart-qty-value">${item.quantity}</span>
                                    <button type="button" class="cart-qty-btn" data-cart-id="${item.id}" data-next-qty="${Number(item.quantity) + 1}">+</button>
                                </div>
                            </div>
                            <p class="cart-item-price">${fmt(Number(item.price) * Number(item.quantity))}</p>
                        </div>
                        <button class="cart-remove-btn" data-cart-id="${item.id}" aria-label="Remove item">Remove</button>
                    </div>`;
        }).join('')}
            </div>

            <div class="cart-summary-col">
                <div class="cart-summary-card">
                    <h2 class="cart-col-title">Order Summary</h2>
                    <div class="cart-summary-row"><span>Subtotal (${selectedCartItemIds.length} items)</span><span>${fmt(currentTotal)}</span></div>
                    <div class="cart-summary-row">
                        <span>Shipping</span>
                        <span class="${appliedShippingCharge === 0 ? 'free-tag' : ''}">
                            ${appliedShippingCharge === 0 ? 'FREE' : fmt(appliedShippingCharge)}
                        </span>
                    </div>
                    ${freeShippingThreshold > 0 ? `
                    <div class="cart-summary-row" style="font-size:0.92rem;">
                        <span>Free Shipping Above</span>
                        <span>${fmt(freeShippingThreshold)}</span>
                    </div>
                    ` : ''}
                    <div class="cart-coupon-section">
                        <div class="cart-coupon-input-wrap">
                            <input
                                type="text"
                                id="couponInlineInput"
                                placeholder="Enter coupon code"
                                maxlength="30"
                                value="${appliedCoupon ? appliedCoupon.code : ''}"
                                ${appliedCoupon ? 'readonly' : ''}
                                style="text-transform:uppercase;">
                            ${appliedCoupon
                                ? '<button type="button" class="btn btn-outline cart-coupon-remove-btn" id="removeCouponBtn">Remove</button>'
                                : '<button type="button" class="btn btn-primary cart-coupon-apply-btn" id="applyCouponBtn">Apply</button>'}
                        </div>
                        <div id="couponResult" class="cart-coupon-summary">
                            ${appliedCoupon
                ? `<span class="cart-coupon-chip">Applied: ${appliedCoupon.code}</span>`
                : '<span class="cart-coupon-muted">Apply a valid coupon.</span>'}
                        </div>
                    </div>
                    ${appliedCoupon ? `
                    <div class="cart-summary-row discount-row"><span>Discount (${appliedCoupon.code})</span><span style="color:#16a34a;">-${fmt(appliedCoupon.discount_amount)}</span></div>
                    ` : ''}
                    ${appliedShippingCharge > 0 ? `
                    <div class="cart-summary-row"><span>Delivery Charges</span><span>${fmt(appliedShippingCharge)}</span></div>
                    ` : ''}
                    <div class="cart-summary-row total"><span>Total</span><span>${fmt(payableTotal)}</span></div>
                    ${freeShippingThreshold > 0 && appliedShippingCharge > 0 ? `
                    <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:0.86rem;line-height:1.5;">
                        Add <strong>${fmt(minOrderRemaining)}</strong> more to unlock free delivery.
                    </div>
                    ` : (freeShippingThreshold > 0 ? `
                    <div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#ecfdf5;color:#166534;font-size:0.86rem;line-height:1.5;">
                        You have unlocked <strong>FREE delivery</strong> 🎉
                    </div>
                    ` : '')}
                </div>

                <div class="cart-address-card">
                    <div class="cart-address-header">
                        <h2 class="cart-col-title">Delivery Address</h2>
                        <a href="address.html" class="addr-add-link">+ Add New</a>
                    </div>
                    <div class="addr-options-list">${addrOptions}</div>
                </div>

                <div class="cart-summary-card" style="margin-top:16px;">
                    <h2 class="cart-col-title">Payment Method</h2>
                    <label style="display:flex; gap:10px; align-items:flex-start; margin-bottom:12px; cursor:pointer;">
                        <input type="radio" name="paymentMethod" value="Prepaid" ${selectedPaymentMethod === 'Prepaid' ? 'checked' : ''}>
                        <span><strong>Pay Online</strong><br><small style="color:#6b7280;">Pay securely online</small></span>
                    </label>
                    ${codAllowed ? `
                    <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer;">
                        <input type="radio" name="paymentMethod" value="COD" ${selectedPaymentMethod === 'COD' ? 'checked' : ''}>
                        <span><strong>Cash on Delivery</strong><br><small style="color:#6b7280;">Pay when your order is delivered</small></span>
                    </label>
                    ` : ''}
                </div>

                ${freeShippingThreshold > 0 && appliedShippingCharge > 0 ? `
                <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:12px 16px;margin-top:12px;color:#9a3412;font-size:14px;">
                    Delivery charges of ${fmt(appliedShippingCharge)} apply below ${fmt(freeShippingThreshold)}. Add ${fmt(minOrderRemaining)} more to waive them off.
                </div>` : (freeShippingThreshold > 0 ? `
                <div style="background:#ecfdf5;border:1px solid #86efac;border-radius:12px;padding:12px 16px;margin-top:12px;color:#166534;font-size:14px;">
                    You have unlocked FREE delivery 🎉
                </div>` : '')}

                ${storeConfig.cod_enabled && storeConfig.cod_min_order_value > 0 && discountedSubtotal < storeConfig.cod_min_order_value ? `
                <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:12px 16px;margin-top:12px;color:#991b1b;font-size:14px;">
                    COD is available from ${fmt(storeConfig.cod_min_order_value)}. Add ${fmt(codRemaining)} more to enable COD.
                </div>` : ''}

                <div style="background:#fff8ef;border:1px solid #ead8c8;border-radius:12px;padding:12px 16px;margin-top:12px;color:#6b4b3e;font-size:14px;line-height:1.5;">
                    ${getDeliveryEstimateText(selectedAddr)}
                </div>

                <button class="btn btn-primary cart-proceed-btn" id="proceedBtn"
                    ${(!canProceed || selectedCartItemIds.length === 0) ? 'disabled' : ''}
                    title="${!canProceed ? (selectedCartItemIds.length === 0 ? 'Select at least one item' : (!selectedAddr ? 'Add and select an address first' : (!isAddressComplete(selectedAddr) ? 'Please complete selected address details first' : ''))) : ''}">
                    ${appliedShippingCharge > 0 ? `Proceed to Checkout (${selectedCartItemIds.length}) - ${fmt(appliedShippingCharge)} Shipping` : `Proceed to Checkout (${selectedCartItemIds.length})`}
                </button>
            </div>`;

        // Event listeners for checkboxes
        document.querySelectorAll('.cart-item-checkbox').forEach(chk => {
            chk.addEventListener('change', () => {
                const id = Number(chk.dataset.cartId);
                if (chk.checked) {
                    if (!selectedCartItemIds.includes(id)) selectedCartItemIds.push(id);
                } else {
                    selectedCartItemIds = selectedCartItemIds.filter(sid => sid !== id);
                }
                renderCart();
            });
        });

        document.getElementById('selectAllItems')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedCartItemIds = cartItems.map(item => Number(item.id));
            } else {
                selectedCartItemIds = [];
            }
            renderCart();
        });

        document.querySelectorAll('input[name="selectedAddress"]').forEach(input => {
            input.addEventListener('change', () => {
                selectedAddressId = Number(input.value);
                sessionStorage.setItem('selectedAddressId', String(selectedAddressId));
                renderCart();
            });
        });

        document.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
            input.addEventListener('change', () => {
                selectedPaymentMethod = input.value;
                sessionStorage.setItem('selectedPaymentMethod', selectedPaymentMethod);
                if (selectedPaymentMethod !== 'Prepaid') {
                    selectedPaymentGateway = 'COD';
                } else if (selectedPaymentGateway === 'COD') {
                    selectedPaymentGateway = 'PayU';
                }
                sessionStorage.setItem('selectedPaymentGateway', selectedPaymentGateway);
                renderCart();
            });
        });

        document.querySelectorAll('.cart-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => removeItem(btn.dataset.cartId));
        });

        document.querySelectorAll('.cart-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cartId = Number(btn.dataset.cartId);
                const nextQty = Number(btn.dataset.nextQty);
                if (!cartId || !nextQty) return;
                updateItemQuantity(cartId, nextQty);
            });
        });

        document.getElementById('removeCouponBtn')?.addEventListener('click', () => {
            clearAppliedCoupon();
            renderCart();
        });
        document.getElementById('applyCouponBtn')?.addEventListener('click', async () => {
            const inputEl = document.getElementById('couponInlineInput');
            const resultEl = document.getElementById('couponResult');
            await applyCouponCode(inputEl?.value, {
                resultEl,
                triggerBtn: document.getElementById('applyCouponBtn')
            });
        });

        document.getElementById('couponInlineInput')?.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const inputEl = document.getElementById('couponInlineInput');
            const resultEl = document.getElementById('couponResult');
            await applyCouponCode(inputEl?.value, {
                resultEl,
                triggerBtn: document.getElementById('applyCouponBtn')
            });
        });

        document.getElementById('proceedBtn')?.addEventListener('click', proceedToPayment);
    }

    async function removeItem(cartId) {
        try {
            const res = await fetch(`${API_BASE}/cart/${cartId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Failed to remove item');
                return;
            }
            showToast('Item removed', 'success');
            // Remove from selection too if it was there
            selectedCartItemIds = selectedCartItemIds.filter(id => id !== Number(cartId));
            await loadCart();
        } catch {
            showToast('Failed to remove item');
        }
    }

    async function updateItemQuantity(cartId, quantity) {
        try {
            const res = await fetch(`${API_BASE}/cart/${cartId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}`
                },
                body: JSON.stringify({ quantity })
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Failed to update quantity');
                return;
            }
            showToast('Quantity updated', 'success');
            updateCartBadge(data.cartCount || 0);
            await loadCart();
        } catch {
            showToast('Failed to update quantity');
        }
    }

    function getCartDataForPixel() {
        /**
         * Build cart data object for Meta Pixel tracking
         */
        const selectedItems = cartItems.filter(item => selectedCartItemIds.includes(Number(item.id)));
        const currentTotal = calculateSelectedTotal();
        const discountedSubtotal = Math.max(0, currentTotal - (appliedCoupon?.discount_amount || 0));
        const baseShippingCharge = Number(storeConfig.shipping_charge) || 0;
        const freeShippingThreshold = Number(storeConfig.min_order_value) || 0;
        const shippingWaived = freeShippingThreshold > 0 && discountedSubtotal >= freeShippingThreshold;
        const appliedShippingCharge = shippingWaived ? 0 : baseShippingCharge;
        const payableTotal = discountedSubtotal + appliedShippingCharge;

        return {
            items: selectedItems.map(item => ({
                product_id: item.product_id || `PROD-${item.id}`,
                sku: `SKU-${item.product_id || item.id}`,
                name: item.name,
                category: item.category || 'Product',
                price: parseFloat(item.price) || 0,
                quantity: Number(item.quantity) || 1
            })),
            subtotal: discountedSubtotal,
            discount: appliedCoupon?.discount_amount || 0,
            shipping: appliedShippingCharge,
            total: payableTotal,
            coupon_code: appliedCoupon?.code || null
        };
    }

    async function proceedToPayment() {
        const selectedAddr = addresses.find(a => Number(a.id) === Number(selectedAddressId));
        if (!selectedAddr) {
            showToast('Please select a delivery address first');
            return;
        }
        if (!isAddressComplete(selectedAddr)) {
            showToast('Please complete the selected address details first');
            return;
        }
        if (selectedCartItemIds.length === 0) {
            showToast('Please select at least one item to checkout');
            return;
        }

        const customerDetails = await openCheckoutModal(selectedAddr);
        if (!customerDetails) {
            return;
        }

        // Fire Meta Pixel InitiateCheckout event
        if (window.firePixelInitiateCheckout) {
            window.firePixelInitiateCheckout(getCartDataForPixel());
        }

        const btn = document.getElementById('proceedBtn');
        if (!btn) return;
        const defaultButtonText = btn.textContent;

        btn.textContent = 'Creating order...';
        btn.disabled = true;

        try {
            const orderRes = await fetch(`${API_BASE}/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}`
                },
                body: JSON.stringify({
                    address_id: selectedAddressId,
                    cart_item_ids: selectedCartItemIds,
                    payment_method: selectedPaymentMethod,
                    payment_gateway: selectedPaymentMethod === 'Prepaid' ? selectedPaymentGateway : 'COD',
                    coupon_code: appliedCoupon?.code || null,
                    coupon_id: appliedCoupon?.id || null,
                    customer_details: customerDetails
                })
            });
            const orderData = await orderRes.json();
            if (!orderData.success) {
                showToast(orderData.message || 'Failed to create order');
                btn.textContent = defaultButtonText;
                btn.disabled = false;
                return;
            }

            if (orderData.cod) {
                // Fire AddPaymentInfo event for COD
                if (window.firePixelAddPaymentInfo) {
                    window.firePixelAddPaymentInfo({
                        ...getCartDataForPixel(),
                        payment_method: 'COD'
                    });
                }

                clearAppliedCoupon({ silent: true });
                selectedCartItemIds = [];
                const successUrl = new URL('order-success.html', window.location.href);
                successUrl.searchParams.set('payment', 'success');
                successUrl.searchParams.set('source', 'cod');
                successUrl.searchParams.set('orderId', String(orderData.orderId));
                if (orderData.orderReference) successUrl.searchParams.set('orderRef', String(orderData.orderReference));
                if (orderData.shipmentId) successUrl.searchParams.set('shipmentId', String(orderData.shipmentId));
                if (orderData.shiprocketOrderId) successUrl.searchParams.set('shiprocketOrderId', String(orderData.shiprocketOrderId));
                if (orderData.awbCode) successUrl.searchParams.set('awb', String(orderData.awbCode));
                window.location.href = successUrl.toString();
                return;
            }

            if (orderData.paymentGateway === 'PayU' && orderData.payu?.action && orderData.payu?.fields) {
                // Fire AddPaymentInfo event for PayU
                if (window.firePixelAddPaymentInfo) {
                    window.firePixelAddPaymentInfo({
                        ...getCartDataForPixel(),
                        payment_method: 'PayU'
                    });
                }
                submitPayuCheckout(orderData.payu.action, orderData.payu.fields);
                return;
            }

            if (orderData.paymentGateway === 'PhonePe' && orderData.phonepe?.redirectUrl) {
                if (window.firePixelAddPaymentInfo) {
                    window.firePixelAddPaymentInfo({
                        ...getCartDataForPixel(),
                        payment_method: 'PhonePe'
                    });
                }

                clearAppliedCoupon({ silent: true });
                selectedCartItemIds = [];
                window.location.href = orderData.phonepe.redirectUrl;
                return;
            }

            showToast('Unable to start online payment right now');
            btn.textContent = defaultButtonText;
            btn.disabled = false;
        } catch (err) {
            console.error(err);
            showToast('Error while initiating payment');
            btn.textContent = defaultButtonText;
            btn.disabled = false;
        }
    }

    function submitPayuCheckout(action, fields) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = action;
        form.style.display = 'none';

        Object.entries(fields || {}).forEach(([key, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = value == null ? '' : String(value);
            form.appendChild(input);
        });

        document.body.appendChild(form);
        form.submit();
    }

    function updateCartBadge(count) {
        const badge = document.getElementById('cartCount');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }
        const mobileBadge = document.querySelector('.mobile-cart-count');
        if (mobileBadge) {
            mobileBadge.textContent = count > 0 ? `(${count})` : '';
            mobileBadge.style.display = count > 0 ? 'inline' : 'none';
        }
    }

    async function initPage() {
        if (!getToken()) {
            await renderGuestCart();
            return;
        }

        await processGuestCartMerge();
        await loadCart();
    }

    await initPage();
});
