/**
 * DEVASTHRA — Universal Site Header Component
 * Renders a consistent header across all pages.
 * Call renderSiteHeader() or include this script; it auto-renders on DOMContentLoaded.
 */
(function () {
    'use strict';

    const GUEST_CART_KEY = 'guest_cart';

    function readGuestCart() {
        try {
            const cart = JSON.parse(window.localStorage.getItem(GUEST_CART_KEY) || '[]');
            return Array.isArray(cart) ? cart.filter(item => Number(item.productId) > 0) : [];
        } catch {
            return [];
        }
    }

    function writeGuestCart(items) {
        const normalized = (Array.isArray(items) ? items : [])
            .map(item => ({
                productId: Number(item.productId || item.product_id),
                quantity: Math.max(1, Math.min(10, Number(item.quantity) || 1)),
                size: item.size ? String(item.size).trim() : '',
                productDetails: item.productDetails || item.product || {}
            }))
            .filter(item => item.productId > 0);

        window.localStorage.setItem(GUEST_CART_KEY, JSON.stringify(normalized));
        updateGuestCartBadges();
        return normalized;
    }

    function addGuestCartItem(item) {
        const productId = Number(item.productId || item.product_id);
        if (!productId) return readGuestCart();

        const size = item.size ? String(item.size).trim() : '';
        const quantity = Math.max(1, Math.min(10, Number(item.quantity) || 1));
        const productDetails = item.productDetails || item.product || {};
        const cart = readGuestCart();
        const existingIndex = cart.findIndex(cartItem =>
            Number(cartItem.productId) === productId &&
            String(cartItem.size || '') === size
        );

        if (existingIndex > -1) {
            cart[existingIndex].quantity = Math.max(1, Math.min(10, Number(cart[existingIndex].quantity || 0) + quantity));
            cart[existingIndex].productDetails = {
                ...(cart[existingIndex].productDetails || {}),
                ...productDetails
            };
        } else {
            cart.push({ productId, quantity, size, productDetails });
        }

        return writeGuestCart(cart);
    }

    function getGuestCartCount() {
        return readGuestCart().reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    }

    function updateGuestCartBadges(count = getGuestCartCount()) {
        const badge = document.getElementById('cartCount');
        if (badge) {
            badge.textContent = count > 0 ? String(count) : '';
            badge.style.display = count > 0 ? 'flex' : 'none';
        }

        const mobileBadge = document.querySelector('.mobile-cart-count');
        if (mobileBadge) {
            mobileBadge.textContent = count > 0 ? `(${count})` : '';
            mobileBadge.style.display = count > 0 ? 'inline' : 'none';
        }
    }

    async function updateServerCartBadges(token) {
        if (!token) {
            updateGuestCartBadges();
            return;
        }

        try {
            const response = await fetch(`${getApiBase()}/cart/count`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success) {
                updateGuestCartBadges(Number(data.count) || 0);
            }
        } catch {
            // Keep the existing badge state if the count request fails.
        }
    }

    async function mergeGuestCartToServer(token) {
        const cart = readGuestCart();
        if (!cart.length || !token) return { success: true, skipped: true, cartCount: 0 };

        const response = await fetch(`${getApiBase()}/api/cart/merge`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                items: cart.map(item => ({
                    productId: Number(item.productId),
                    quantity: Math.max(1, Number(item.quantity) || 1),
                    size: item.size || null
                }))
            })
        });
        const data = await response.json();

        if (data.success) {
            window.localStorage.removeItem(GUEST_CART_KEY);
            updateGuestCartBadges(Number(data.cartCount) || 0);
        }

        return data;
    }

    function getApiBase() {
        return window.__API_BASE || (
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.protocol === 'file:'
                ? 'http://localhost:5000'
                : window.location.origin
        );
    }

    window.DevasthraGuestCart = window.DevasthraGuestCart || {
        key: GUEST_CART_KEY,
        read: readGuestCart,
        write: writeGuestCart,
        add: addGuestCartItem,
        count: getGuestCartCount,
        updateBadges: updateGuestCartBadges,
        mergeToServer: mergeGuestCartToServer,
        clear: () => {
            window.localStorage.removeItem(GUEST_CART_KEY);
            updateGuestCartBadges(0);
        }
    };

    const GA_MEASUREMENT_ID = 'G-W318K4KVR1';
    // Paste your 16-digit Meta Pixel ID here to override the backend value.
    const META_PIXEL_ID = '1707515313578180';

    function injectGoogleAnalytics() {
        if (!GA_MEASUREMENT_ID || document.getElementById('devasthra-ga4-tag')) return;

        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () {
            window.dataLayer.push(arguments);
        };

        const script = document.createElement('script');
        script.id = 'devasthra-ga4-tag';
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
        document.head.appendChild(script);

        window.gtag('js', new Date());
        window.gtag('config', GA_MEASUREMENT_ID, {
            send_page_view: true
        });
    }

    function injectMetaPixel() {
        if (document.getElementById('devasthra-meta-pixel')) return;

        if (META_PIXEL_ID) {
            window.__META_PIXEL_ID__ = META_PIXEL_ID;
            try {
                window.localStorage.setItem('META_PIXEL_ID', META_PIXEL_ID);
            } catch (error) {
                // Ignore storage failures in restricted environments.
            }
        }

        const script = document.createElement('script');
        script.id = 'devasthra-meta-pixel';
        script.async = true;
        script.src = 'meta-pixel.js';
        document.head.appendChild(script);
    }

    injectMetaPixel();
    const MAINTENANCE_PAGE = 'maintenance.html';

    function ensureSharedAuthModal() {
        if (document.getElementById('otpModal')) {
            return false;
        }

        if (!document.body) {
            return false;
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="otp-overlay" id="otpOverlay"></div>
            <div class="otp-modal" id="otpModal" role="dialog" aria-modal="true" aria-label="Login with OTP">
                <button class="otp-close" id="otpCloseBtn" aria-label="Close">&times;</button>
                <div class="otp-modal-header">
                    <h2>Login or Sign Up</h2>
                    <p>Enter your mobile number or email address to continue</p>
                </div>

                <div id="otpStep1">
                    <div class="otp-field-group">
                        <label for="otpMobile">Mobile Number <span class="required-star">*</span></label>
                        <div class="otp-phone-input">
                            <span class="otp-flag">IN +91</span>
                            <input type="tel" id="otpMobile" placeholder="Enter 10-digit number" maxlength="10" autocomplete="tel">
                        </div>
                    </div>
                    <div class="otp-divider"><span>OR</span></div>
                    <div class="otp-field-group">
                        <label for="otpEmailOptional">Email Address <span class="required-star">*</span></label>
                        <input type="email" id="otpEmailOptional" placeholder="you@example.com" autocomplete="email">
                    </div>
                    <p class="otp-msg" id="otpMessage"></p>
                    <button class="btn btn-primary otp-action-btn" id="sendOtpBtn">Send OTP</button>
                </div>

                <div id="otpStep2" style="display:none">
                    <p class="otp-msg" id="otpMessage2"></p>
                    <div class="otp-field-group">
                        <label for="otpInput">OTP <span class="required-star">*</span></label>
                        <input type="text" id="otpInput" placeholder="Enter 6-digit OTP" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
                    </div>
                    <div id="otpRegFields">
                        <div class="otp-field-group">
                            <label for="otpRegName">Full Name <span class="required-star">*</span></label>
                            <input type="text" id="otpRegName" placeholder="Enter your full name" autocomplete="name">
                        </div>
                        <div class="otp-field-group">
                            <label for="otpRegEmail">Email Address <span class="required-star">*</span></label>
                            <input type="email" id="otpRegEmail" placeholder="you@example.com" autocomplete="email">
                        </div>
                        <div class="otp-field-group">
                            <label for="otpRegMobile">Mobile Number <span class="required-star">*</span></label>
                            <input type="tel" id="otpRegMobile" placeholder="Enter 10-digit number" maxlength="10" inputmode="numeric" autocomplete="tel-national">
                        </div>
                        <div class="otp-field-group">
                            <label for="otpRegDob">Date of Birth <span class="required-star">*</span></label>
                            <input type="date" id="otpRegDob" autocomplete="bday">
                        </div>
                        <div class="otp-field-group">
                            <label for="otpRegGender">Gender <span class="required-star">*</span></label>
                            <select id="otpRegGender">
                                <option value="">Select Gender</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Others">Others</option>
                            </select>
                        </div>
                    </div>
                    <button class="btn btn-primary otp-action-btn" id="verifyOtpBtn">Verify &amp; Continue</button>
                    <button class="otp-resend-btn" id="resendOtpBtn" disabled>Resend OTP</button>
                </div>

                <p class="otp-terms">By continuing, you agree to our <a href="privacy-policy.html">Privacy Policy</a> &amp; Terms</p>
            </div>
        `;

        document.body.appendChild(wrapper.firstElementChild);
        document.body.appendChild(wrapper.lastElementChild);
        return true;
    }

    function bindSharedAuthModalHandlers() {
        if (window.__devasthraSharedAuthModalBound) return;

        const otpModal = document.getElementById('otpModal');
        const otpOverlay = document.getElementById('otpOverlay');
        const step1 = document.getElementById('otpStep1');
        const step2 = document.getElementById('otpStep2');
        const closeBtn = document.getElementById('otpCloseBtn');
        const mobileInput = document.getElementById('otpMobile');
        const emailInput = document.getElementById('otpEmailOptional');
        const otpInput = document.getElementById('otpInput');
        const otpRegName = document.getElementById('otpRegName');
        const otpRegEmail = document.getElementById('otpRegEmail');
        const otpRegMobile = document.getElementById('otpRegMobile');
        const otpRegDob = document.getElementById('otpRegDob');
        const otpRegGender = document.getElementById('otpRegGender');
        const otpRegFields = document.getElementById('otpRegFields');
        const otpMessage = document.getElementById('otpMessage');
        const otpMessage2 = document.getElementById('otpMessage2');
        const sendOtpBtn = document.getElementById('sendOtpBtn');
        const verifyOtpBtn = document.getElementById('verifyOtpBtn');
        const resendOtpBtn = document.getElementById('resendOtpBtn');

        if (!otpModal || !otpOverlay || !sendOtpBtn || !verifyOtpBtn || !resendOtpBtn) {
            return;
        }

        const apiBase = window.__API_BASE || (
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.protocol === 'file:'
                ? 'http://localhost:5000'
                : window.location.origin
        );
        const state = {
            resendTimer: null,
            authMode: 'mobile',
            authIdentifier: '',
            isNewUser: false
        };

        const setMsg = (element, message, type = 'error') => {
            if (!element) return;
            element.textContent = message || '';
            element.className = `otp-msg ${type}`;
        };

        const setSignupFieldsVisible = (isVisible, prefill = {}) => {
            if (otpRegFields) {
                otpRegFields.hidden = !isVisible;
                otpRegFields.style.display = isVisible ? 'grid' : 'none';
            }

            if (otpRegName) otpRegName.value = prefill.name || '';
            if (otpRegEmail) {
                otpRegEmail.value = prefill.email || '';
                otpRegEmail.readOnly = Boolean(prefill.lockEmail && isVisible);
            }
            if (otpRegMobile) {
                otpRegMobile.value = prefill.mobile || '';
                otpRegMobile.readOnly = Boolean(prefill.lockMobile && isVisible);
            }
            if (otpRegDob) otpRegDob.value = prefill.dob || '';
            if (otpRegGender) otpRegGender.value = prefill.gender || '';
        };

        const clearResendTimer = () => {
            if (state.resendTimer) {
                clearInterval(state.resendTimer);
                state.resendTimer = null;
            }
        };

        const startResendTimer = () => {
            let seconds = 30;
            resendOtpBtn.disabled = true;
            resendOtpBtn.textContent = `Resend in ${seconds}s`;
            clearResendTimer();
            state.resendTimer = setInterval(() => {
                seconds -= 1;
                resendOtpBtn.textContent = seconds > 0 ? `Resend in ${seconds}s` : 'Resend OTP';
                if (seconds <= 0) {
                    clearResendTimer();
                    resendOtpBtn.disabled = false;
                }
            }, 1000);
        };

        const closeModal = () => {
            otpOverlay.classList.remove('show');
            otpModal.classList.remove('show');
            document.body.classList.remove('site-modal-open');
            document.body.style.overflow = '';
            clearResendTimer();
        };

        const resetModal = () => {
            if (step1) step1.style.display = 'block';
            if (step2) step2.style.display = 'none';
            if (mobileInput) mobileInput.value = '';
            if (emailInput) emailInput.value = '';
            if (otpInput) otpInput.value = '';
            if (otpRegName) otpRegName.value = '';
            if (otpRegEmail) otpRegEmail.value = '';
            if (otpRegMobile) otpRegMobile.value = '';
            if (otpRegDob) otpRegDob.value = '';
            if (otpRegGender) otpRegGender.value = '';
            setSignupFieldsVisible(false);
            setMsg(otpMessage, '');
            setMsg(otpMessage2, '');
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = 'Send OTP';
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.textContent = 'Verify & Continue';
            resendOtpBtn.disabled = true;
            resendOtpBtn.textContent = 'Resend OTP';
            state.authMode = 'mobile';
            state.authIdentifier = '';
            state.isNewUser = false;
        };

        const openModal = () => {
            otpModal.classList.add('show');
            otpOverlay.classList.add('show');
            document.body.classList.add('site-modal-open');
            document.body.style.overflow = 'hidden';
            resetModal();
        };

        window.openEmailAuthModal = openModal;
        window.openOTPModal = openModal;
        window.closeEmailAuthModal = closeModal;
        window.__devasthraSharedAuthModalBound = true;

        closeBtn?.addEventListener('click', closeModal);
        otpOverlay.addEventListener('click', closeModal);
        window.addEventListener('pageshow', () => {
            document.body.style.overflow = '';
        });

        sendOtpBtn.addEventListener('click', async (event) => {
            event.preventDefault();

            const mobile = (mobileInput?.value || '').trim();
            const email = (emailInput?.value || '').trim().toLowerCase();
            const hasValidMobile = /^[6-9]\d{9}$/.test(mobile);
            const hasValidEmail = email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : false;

            if (!hasValidMobile && !hasValidEmail) {
                setMsg(otpMessage, 'Enter a valid mobile number or email address', 'error');
                return;
            }

            sendOtpBtn.disabled = true;
            sendOtpBtn.textContent = 'Sending...';
            setMsg(otpMessage, '');
            setMsg(otpMessage2, '');

            try {
                const endpoint = hasValidMobile ? '/api/send-mobile-login-otp' : '/api/send-login-code';
                const payload = hasValidMobile ? { mobile, email } : { email };
                const response = await fetch(`${apiBase}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (!data.success) {
                    setMsg(otpMessage, data.message || 'Failed to send OTP', 'error');
                    return;
                }

                state.authMode = hasValidMobile ? 'mobile' : 'email';
                state.authIdentifier = hasValidMobile ? mobile : email;
                state.isNewUser = Boolean(data.isNewUser);

                if (step1) step1.style.display = 'none';
                if (step2) step2.style.display = 'block';
                startResendTimer();

                setSignupFieldsVisible(state.isNewUser, {
                    name: data.user?.name || '',
                    email: data.user?.email || email || '',
                    mobile: data.user?.mobile_number || mobile || '',
                    dob: data.user?.dob || '',
                    gender: data.user?.gender || '',
                    lockMobile: hasValidMobile,
                    lockEmail: hasValidEmail
                });
                setMsg(
                    otpMessage2,
                    data.dev ? 'Dev mode: Check backend console for OTP' : `OTP sent successfully to your ${hasValidMobile ? 'mobile number' : 'email'}`,
                    'success'
                );
                otpInput?.focus();
            } catch {
                setMsg(otpMessage, 'Cannot connect to server', 'error');
            } finally {
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = 'Send OTP';
            }
        });

        resendOtpBtn.addEventListener('click', (event) => {
            event.preventDefault();
            sendOtpBtn.click();
        });

        verifyOtpBtn.addEventListener('click', async (event) => {
            event.preventDefault();

            const code = (otpInput?.value || '').trim();
            const signupName = (otpRegName?.value || '').trim();
            const signupEmail = (otpRegEmail?.value || emailInput?.value || '').trim().toLowerCase();
            const signupMobile = ((otpRegMobile?.value || mobileInput?.value || state.authIdentifier || '') + '').replace(/\D/g, '').slice(-10);
            const signupDob = (otpRegDob?.value || '').trim();
            const signupGender = (otpRegGender?.value || '').trim();
            const isMobileMode = state.authMode === 'mobile';
            const endpoint = isMobileMode ? '/api/verify-mobile-login-otp' : '/api/verify-login-code';

            if (!/^\d{6}$/.test(code)) {
                setMsg(otpMessage2, 'Enter a valid 6-digit OTP', 'error');
                return;
            }

            if (state.isNewUser) {
                if (!signupName) { setMsg(otpMessage2, 'Enter your full name', 'error'); return; }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail)) { setMsg(otpMessage2, 'Enter a valid email address', 'error'); return; }
                if (!/^[6-9]\d{9}$/.test(signupMobile)) { setMsg(otpMessage2, 'Enter a valid mobile number', 'error'); return; }
                if (!signupDob) { setMsg(otpMessage2, 'Enter your date of birth', 'error'); return; }
                if (!signupGender) { setMsg(otpMessage2, 'Select your gender', 'error'); return; }
            }

            verifyOtpBtn.disabled = true;
            verifyOtpBtn.textContent = 'Verifying...';
            setMsg(otpMessage2, '');

            try {
                const response = await fetch(`${apiBase}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mobile: signupMobile || state.authIdentifier,
                        email: signupEmail || (!isMobileMode ? state.authIdentifier : ''),
                        code,
                        name: signupName,
                        dob: signupDob,
                        gender: signupGender
                    })
                });
                const data = await response.json();

                if (!data.success) {
                    setMsg(otpMessage2, data.message || 'Invalid OTP', 'error');
                    return;
                }

                localStorage.setItem('DEVASTHRA_token', data.token);
                localStorage.setItem('DEVASTHRA_user', JSON.stringify({
                    userId: data.userId,
                    mobile: data.mobile,
                    name: data.name || '',
                    email: data.email || signupEmail || '',
                    dob: data.dob || signupDob || '',
                    gender: data.gender || signupGender || ''
                }));

                closeModal();
                try {
                    await window.DevasthraGuestCart?.mergeToServer(data.token);
                } catch {
                    // Keep guest_cart in localStorage so the cart can retry the merge.
                }
                window.syncHeaderAuthUI?.();
            } catch {
                setMsg(otpMessage2, 'Verification failed', 'error');
            } finally {
                verifyOtpBtn.disabled = false;
                verifyOtpBtn.textContent = 'Verify & Continue';
            }
        });
    }

    function ensureSharedAuthModalReady() {
        const path = String(window.location.pathname || '').toLowerCase();
        const isCartPage = path.endsWith('/cart.html') || path.endsWith('\\cart.html');
        const created = ensureSharedAuthModal();
        const isHomePage =
            path === '/' ||
            path === '' ||
            path.endsWith('/index.html') ||
            path.endsWith('\\index.html');

        if (isCartPage) {
            return;
        }

        if (created || (isHomePage && document.getElementById('otpModal') && !window.__devasthraSharedAuthModalBound)) {
            bindSharedAuthModalHandlers();
        } else if (document.getElementById('otpModal') && !window.openEmailAuthModal) {
            window.openEmailAuthModal = function () {
                const otpModal = document.getElementById('otpModal');
                const otpOverlay = document.getElementById('otpOverlay');
                if (!otpModal || !otpOverlay) return;
                otpModal.classList.add('show');
                otpOverlay.classList.add('show');
                document.body.classList.add('site-modal-open');
                document.body.style.overflow = 'hidden';
            };
            window.openOTPModal = window.openEmailAuthModal;
        }

        if (new URLSearchParams(window.location.search).get('action') === 'login' && typeof window.openEmailAuthModal === 'function') {
            setTimeout(() => { window.openEmailAuthModal(); }, 400);
            if (window.history.replaceState) {
                const clean = window.location.pathname + window.location.hash;
                window.history.replaceState(null, '', clean);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureSharedAuthModalReady, { once: true });
    } else {
        ensureSharedAuthModalReady();
    }

    function cacheSiteStatus(status) {
        try {
            window.localStorage.setItem('DEVASTHRA_site_status', JSON.stringify(status || {}));
        } catch (error) {
            // Ignore storage failures in restricted environments.
        }
    }

    function readCachedSiteStatus() {
        try {
            return JSON.parse(window.localStorage.getItem('DEVASTHRA_site_status') || '{}');
        } catch (error) {
            return {};
        }
    }

    async function fetchSiteStatus() {
        if (window.__fetchJsonWithApiFallback) {
            const { data } = await window.__fetchJsonWithApiFallback('/api/site-status');
            return data?.site_status || data?.siteStatus || data?.status || data || {};
        }

        if (window.location.protocol === 'file:') {
            return readCachedSiteStatus();
        }

        const response = await fetch('/api/site-status', { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return data?.site_status || data?.siteStatus || data?.status || data || {};
    }

    async function guardMaintenanceMode() {
        const currentPath = String(window.location.pathname || '').toLowerCase();
        if (currentPath.endsWith('/maintenance.html') || currentPath === '/maintenance.html') {
            return false;
        }

        try {
            const siteStatus = await fetchSiteStatus();
            cacheSiteStatus(siteStatus);

            if (siteStatus && (siteStatus.maintenance_enabled === true || siteStatus.maintenance_enabled === '1' || siteStatus.maintenance_enabled === 'true')) {
                window.location.replace(MAINTENANCE_PAGE);
                return true;
            }
        } catch (error) {
            console.warn('Maintenance status check failed:', error.message || error);
        }

        return false;
    }

    /* ─── Inject CSS once ─────────────────────────────────────────── */
    function injectHeaderStyles() {
        if (document.getElementById('devasthra-header-styles')) return;

        const style = document.createElement('style');
        style.id = 'devasthra-header-styles';
        style.textContent = `
            /* ── Google Fonts ── */
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            /* ── Tokens ── */
            :root {
                --dv-ink:        #0d0a07;
                --dv-ivory:      #f5f0e8;
                --dv-crimson:    #c0392b;
                --dv-crimson-d:  #96211a;
                --dv-gold:       #c8a96e;
                --dv-mist:       rgba(13,10,7,0.055);
                --dv-glass:      rgba(245,240,232,0.78);
                --dv-header-h:   72px;
                --dv-ease:       cubic-bezier(.4,0,.2,1);
            }

            /* ── Reset / base ── */
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

            body.has-category-drawer { padding-top: var(--dv-header-h); }

            /* ══════════════════════════════════════════════════════
               HEADER SHELL
            ══════════════════════════════════════════════════════ */
            .header {
                position: fixed;
                top: 0; left: 0; right: 0;
                height: var(--dv-header-h);
                z-index: 900;
                font-family: 'Inter', sans-serif;
                background: var(--dv-ivory);
                border-bottom: 1px solid transparent;
                transition:
                    background .35s var(--dv-ease),
                    border-color .35s var(--dv-ease),
                    box-shadow .35s var(--dv-ease);
            }

            .header.scrolled {
                background: var(--dv-glass);
                backdrop-filter: blur(18px) saturate(1.3);
                -webkit-backdrop-filter: blur(18px) saturate(1.3);
                border-bottom-color: rgba(200,169,110,.22);
                box-shadow: 0 2px 32px rgba(13,10,7,.07);
            }

            .header .container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 0 28px;
                height: 100%;
                display: grid;
                grid-template-columns: auto 1fr auto auto auto;
                align-items: center;
                gap: 0 18px;
                white-space: nowrap;
            }

            /* ── Accent rule ── */
            .header::after {
                content: '';
                position: absolute;
                bottom: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent 0%, var(--dv-gold) 35%, rgba(200,169,110,.9) 65%, transparent 100%);
                opacity: 0;
                transition: opacity .45s var(--dv-ease);
            }
            .header.scrolled::after { opacity: 1; }

            /* ══════════════════════════════════════════════════════
               HAMBURGER / CATEGORY MENU BTN
            ══════════════════════════════════════════════════════ */
            .header-menu-btn,
            .hamburger {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 38px; height: 38px;
                border: none;
                background: none;
                cursor: pointer;
                padding: 0;
                border-radius: 0;
                transition: opacity .2s;
            }
            .header-menu-btn:hover,
            .hamburger:hover { opacity: .7; }
            .header-menu-btn svg,
            .hamburger svg {
                width: 24px;
                height: 24px;
                display: block;
                color: var(--dv-ink);
                transition: transform .2s var(--dv-ease), opacity .2s;
            }
            .header-menu-btn:hover svg,
            .hamburger:hover svg { transform: scale(1.04); }

            /* ══════════════════════════════════════════════════════
               LOGO
            ══════════════════════════════════════════════════════ */
            .logo {
                display: flex;
                align-items: center;
                gap: 10px;
                text-decoration: none;
                flex-shrink: 0;
                transition: opacity .2s;
            }
            .logo:hover { opacity: .82; }
            .logo-img {
                height: 44px;
                width: 44px;
                object-fit: cover;
                border-radius: 0;
                border: none;
            }
            .logo-text-img {
                height: 100px;
                object-fit: contain;
            }

            /* ══════════════════════════════════════════════════════
               NAV LINKS — DESKTOP
            ══════════════════════════════════════════════════════ */
            .nav-links {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
                list-style: none;
            }

            .nav-links > a {
                font-family: 'Inter', sans-serif;
                font-size: 13px;
                font-weight: 500;
                letter-spacing: .06em;
                text-transform: uppercase;
                color: var(--dv-ink);
                text-decoration: none;
                padding: 6px 14px;
                border-radius: 6px;
                position: relative;
                transition: color .2s, background .2s;
            }
            .nav-links > a::after {
                content: '';
                position: absolute;
                left: 14px; right: 14px;
                bottom: 2px;
                height: 1.5px;
                background: var(--dv-crimson);
                transform: scaleX(0);
                transform-origin: left;
                transition: transform .3s var(--dv-ease);
            }
            .nav-links > a:hover { color: var(--dv-ink); background: rgba(200,169,110,.10); }
            .nav-links > a:hover::after { transform: scaleX(1); }

            /* Mobile nav extras — hidden on desktop */
            .nav-links .mobile-nav-actions { display: none; }

            /* ══════════════════════════════════════════════════════
               HEADER ACTIONS (right side)
            ══════════════════════════════════════════════════════ */
            .header-actions {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            /* Cart button */
            .cart-btn {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 40px; height: 40px;
                border-radius: 10px;
                color: var(--dv-ink);
                text-decoration: none;
                transition: background .2s, color .2s, transform .15s;
            }
            .cart-btn:hover { background: var(--dv-mist); color: var(--dv-ink); transform: translateY(-1px); }

            .cart-count {
                position: absolute;
                top: 4px; right: 4px;
                min-width: 17px; height: 17px;
                background: var(--dv-crimson);
                color: #fff;
                font-size: 10px;
                font-weight: 600;
                border-radius: 99px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
                line-height: 1;
                border: 2px solid var(--dv-ivory);
                animation: dvBadgePop .25s var(--dv-ease);
            }
            @keyframes dvBadgePop {
                0%   { transform: scale(0); }
                70%  { transform: scale(1.2); }
                100% { transform: scale(1); }
            }

            /* User menu */
            .user-menu-wrap { position: relative; }

            .user-icon-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 40px; height: 40px;
                border-radius: 10px;
                border: none;
                background: none;
                color: var(--dv-ink);
                cursor: pointer;
                transition: background .2s, color .2s, transform .15s;
            }
            .user-icon-btn:hover { background: var(--dv-mist); color: var(--dv-ink); transform: translateY(-1px); }

            .user-dropdown {
                position: absolute;
                top: calc(100% + 12px);
                right: 0;
                min-width: 200px;
                background: #fff;
                border: 1px solid rgba(200,169,110,.2);
                border-radius: 14px;
                box-shadow:
                    0 4px 6px -1px rgba(13,10,7,.06),
                    0 16px 40px -4px rgba(13,10,7,.12);
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                transform: translateY(8px) scale(.97);
                transform-origin: top right;
                transition:
                    opacity .22s var(--dv-ease),
                    transform .22s var(--dv-ease);
            }
            .user-dropdown.open {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0) scale(1);
            }

            .dropdown-user-info {
                padding: 14px 18px 10px;
                font-size: 13px;
                font-weight: 600;
                color: var(--dv-ink);
                border-bottom: 1px solid var(--dv-mist);
                letter-spacing: .02em;
            }

            .dropdown-item {
                display: flex;
                align-items: center;
                width: 100%;
                padding: 11px 18px;
                font-family: 'Inter', sans-serif;
                font-size: 13.5px;
                font-weight: 400;
                color: var(--dv-ink);
                background: none;
                border: none;
                text-decoration: none;
                cursor: pointer;
                transition: background .15s, color .15s, padding-left .15s;
                letter-spacing: .01em;
            }
            .dropdown-item:hover {
                background: rgba(192,57,43,.06);
                color: var(--dv-crimson);
                padding-left: 22px;
            }
            .dropdown-logout { color: #b04040; }
            .dropdown-logout:hover { background: rgba(176,64,64,.08); }

            /* ── Company badge ── */
            .header-company-logo {
                display: flex;
                align-items: center;
                justify-content: flex-end;
            }
            .header-company-badge {
                height: 92px;
                object-fit: contain;
            }

            /* ══════════════════════════════════════════════════════
               HAMBURGER (mobile toggle)
            ══════════════════════════════════════════════════════ */
            .hamburger {
                display: none;
            }

            /* ══════════════════════════════════════════════════════
               MOBILE OVERLAY
            ══════════════════════════════════════════════════════ */
            .mobile-overlay {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(13,10,7,.45);
                backdrop-filter: blur(4px);
                z-index: 850;
                opacity: 0;
                transition: opacity .3s var(--dv-ease);
            }
            .mobile-overlay.visible { opacity: 1; }

            /* ══════════════════════════════════════════════════════
               CATEGORY DRAWER
            ══════════════════════════════════════════════════════ */
            .category-drawer-overlay {
                position: fixed;
                inset: 0;
                background: rgba(13,10,7,.5);
                z-index: 950;
                opacity: 0;
                pointer-events: none;
                transition: opacity .3s var(--dv-ease);
            }
            .category-drawer-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .category-drawer {
                position: fixed;
                top: 0; left: 0;
                height: 100dvh;
                width: 320px;
                max-width: 88vw;
                background: var(--dv-ivory);
                z-index: 960;
                display: flex;
                flex-direction: column;
                transform: translateX(-100%);
                transition: transform .38s var(--dv-ease);
                box-shadow: 6px 0 40px rgba(13,10,7,.12);
            }
            .category-drawer.open { transform: translateX(0); }

            .category-drawer-header {
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 22px 24px 18px;
                border-bottom: 1px solid rgba(200,169,110,.2);
                flex-shrink: 0;
            }
            .category-drawer-close {
                width: 36px; height: 36px;
                display: flex; align-items: center; justify-content: center;
                border: 1px solid rgba(13,10,7,.12);
                border-radius: 8px;
                background: none;
                cursor: pointer;
                font-size: 18px;
                color: var(--dv-ink);
                flex-shrink: 0;
                transition: background .2s, border-color .2s, color .2s;
            }
            .category-drawer-close:hover {
                background: var(--dv-crimson);
                border-color: var(--dv-crimson);
                color: #fff;
            }

            .drawer-eyebrow {
                font-size: 10px;
                font-weight: 600;
                letter-spacing: .12em;
                text-transform: uppercase;
                color: var(--dv-gold);
                margin-bottom: 2px;
            }
            .category-drawer-header h2 {
                font-family: 'Inter', sans-serif;
                font-size: 22px;
                font-weight: 600;
                color: var(--dv-ink);
                letter-spacing: .01em;
                line-height: 1.2;
            }

            .category-drawer-body {
                flex: 1;
                overflow-y: auto;
                padding: 20px 0;
            }
            .category-drawer-footer {
                margin-top: auto;
                padding: 18px 24px 24px;
                border-top: 1px solid rgba(200,169,110,.2);
                background: linear-gradient(180deg, rgba(245,240,232,0) 0%, rgba(245,240,232,.96) 32%);
                flex-shrink: 0;
            }
            .category-drawer-cta {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                padding: 14px 16px;
                border: 1px solid rgba(192,57,43,.18);
                border-radius: 14px;
                background: rgba(192,57,43,.05);
                color: var(--dv-crimson-d);
                text-decoration: none;
                transition: background .2s, border-color .2s, transform .2s;
            }
            .category-drawer-cta:hover {
                background: rgba(192,57,43,.09);
                border-color: rgba(192,57,43,.3);
                transform: translateY(-1px);
            }
            .category-drawer-cta-copy strong {
                display: block;
                font-size: 14px;
                font-weight: 700;
                letter-spacing: .02em;
            }
            .category-drawer-cta-copy span {
                display: block;
                margin-top: 4px;
                font-size: 12px;
                color: rgba(13,10,7,.7);
            }
            .category-drawer-cta-arrow {
                font-size: 18px;
                line-height: 1;
                flex-shrink: 0;
            }
            .category-drawer-body::-webkit-scrollbar { width: 4px; }
            .category-drawer-body::-webkit-scrollbar-track { background: transparent; }
            .category-drawer-body::-webkit-scrollbar-thumb {
                background: rgba(200,169,110,.35);
                border-radius: 2px;
            }

            /* ══════════════════════════════════════════════════════
               MOBILE STYLES
            ══════════════════════════════════════════════════════ */
            @media (max-width: 900px) {
                :root {
                    --dv-header-h: 64px;
                }
                .header .container {
                    grid-template-columns: auto 1fr auto auto;
                }

                .nav-links {
                    position: fixed;
                    top: 0; right: 0;
                    height: 100dvh;
                    width: 280px;
                    max-width: 85vw;
                    flex-direction: column;
                    justify-content: flex-start;
                    align-items: stretch;
                    background: var(--dv-ivory);
                    padding: 80px 0 32px;
                    transform: translateX(110%);
                    transition: transform .38s var(--dv-ease);
                    z-index: 870;
                    box-shadow: -6px 0 40px rgba(13,10,7,.12);
                    gap: 0;
                    overflow-y: auto;
                }
                .nav-links.open { transform: translateX(0); }
                .nav-links > a {
                    padding: 14px 28px;
                    border-radius: 0;
                    font-size: 14px;
                    border-bottom: 1px solid var(--dv-mist);
                }
                .nav-links > a::after { display: none; }

                .mobile-overlay { display: block; }
                .hamburger { display: flex; }
                .header-company-logo {
                    display: flex;
                    order: 3;
                    margin-right: 4px;
                }
                .header-company-badge {
                    height: 52px;
                    max-width: 100px;
                }
                .logo {
                    gap: 8px;
                }
                .logo-img {
                    width: 36px;
                    height: 36px;
                }
                .logo-text-img {
                    height: 56px;
                    max-width: 160px;
                }
                .header-menu-btn span:nth-child(2) { display: none; }

                /* Mobile nav actions inside the drawer */
                .nav-links .mobile-nav-actions {
                    display: flex;
                    flex-direction: column;
                    margin-top: 12px;
                    padding: 0 16px;
                    gap: 4px;
                }
                .mobile-cart-btn,
                .mobile-login-btn,
                #mobileLoggedMenu a,
                #mobileLoggedMenu button {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 14px;
                    border-radius: 10px;
                    border: none;
                    background: none;
                    font-family: 'Inter', sans-serif;
                    font-size: 14px;
                    font-weight: 400;
                    color: var(--dv-ink);
                    text-decoration: none;
                    cursor: pointer;
                    width: 100%;
                    transition: background .2s, color .2s;
                }
                .mobile-cart-btn:hover,
                .mobile-login-btn:hover,
                #mobileLoggedMenu a:hover,
                #mobileLoggedMenu button:hover {
                    background: rgba(192,57,43,.07);
                    color: var(--dv-crimson);
                }
                .mobile-cart-btn svg,
                .mobile-login-btn svg,
                #mobileLoggedMenu svg { width: 18px; height: 18px; flex-shrink: 0; }

                #mobileLoggedMenu { display: flex; flex-direction: column; gap: 2px; }
                #mobileLogoutBtn { width: 100%; text-align: left; color: #b04040; }
                #mobileLogoutBtn:hover { background: rgba(176,64,64,.08) !important; }
            }

            @media (max-width: 600px) {
                :root {
                    --dv-header-h: 60px;
                }
                .header .container {
                    padding: 0 12px;
                    gap: 0 8px;
                    grid-template-columns: auto minmax(0, 1fr) auto auto;
                }
                .header-actions {
                    gap: 2px;
                }
                .cart-btn,
                .user-icon-btn {
                    width: 36px;
                    height: 36px;
                }
                .logo {
                    min-width: 0;
                }
                .logo-img {
                    width: 32px;
                    height: 32px;
                }
                .logo-text-img {
                    height: 48px;
                    max-width: 140px;
                }
                .header-company-badge {
                    height: 62px;
                    max-width: 98px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    async function renderSiteHeader() {
        const target = document.getElementById('site-header');
        if (!target) return;

        if (await guardMaintenanceMode()) return;

        injectGoogleAnalytics();
        injectMetaPixel();
        injectHeaderStyles();

        const homePrefix = 'index.html#home';
        const homeLink = 'index.html#home';
        const aboutLink = 'index.html#about';
        const contactLink = 'index.html#contact';

        /* Category drawer shell; content loads dynamically from the backend taxonomy API */
        const categoryDrawerHtml = `
            <div class="category-drawer-overlay" id="categoryDrawerOverlay"></div>
            <aside class="category-drawer" id="categoryDrawer" aria-label="Category menu">
                <div class="category-drawer-header">
                    <button class="category-drawer-close" id="categoryDrawerClose" aria-label="Close category menu">&times;</button>
                    <div>
                        <p class="drawer-eyebrow">Browse</p>
                        <h2>Shop Categories</h2>
                    </div>
                </div>
                <div class="category-drawer-body">
                    <div class="drawer-audience-switch" id="drawerAudienceSwitch"></div>
                    <div class="drawer-category-list" id="drawerCategoryList"></div>
                </div>
                <div class="category-drawer-footer">
                    <a href="index.html#contactForm" class="category-drawer-cta" id="drawerBulkOrdersLink">
                        <span class="category-drawer-cta-copy">
                            <strong>Looking for bulk orders?</strong>
                            <span>Contact us for bulk pricing and support</span>
                        </span>
                        <span class="category-drawer-cta-arrow">&rarr;</span>
                    </a>
                </div>
            </aside>`;

        const headerHtml = `
        <header class="header" id="header">
            <div class="container">

                <button class="header-menu-btn" id="headerMenuBtn" aria-label="Open categories">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                        <path d="M7 12h13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                        <path d="M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                    </svg>
                </button>

                <a href="${homePrefix}" class="logo">
                    <img src="backend/images/red_logo.png" alt="DEVASTHRA Logo" class="logo-img">
                    <img src="backend/images/red_text_logo.png" alt="DEVASTHRA" class="logo-text-img">
                </a>

                <nav class="nav-links" id="navLinks">
                    <a href="${homeLink}">Home</a>
                    <a href="${aboutLink}">About</a>
                    <a href="${contactLink}">Contact</a>
                    <div class="mobile-nav-actions">
                    <a href="cart.html" class="mobile-cart-btn">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                            </svg>
                            <span>My Cart <span class="mobile-cart-count" style="display:none">(0)</span></span>
                        </a>
                        <div id="mobileLoggedMenu" style="display:none">
                            <a href="dashboard.html">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                                </svg>
                                <span>My Dashboard</span>
                            </a>
                            <a href="cart.html">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                                </svg>
                                <span>My Cart</span>
                            </a>
                            <button id="mobileLogoutBtn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                                    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                                </svg>
                                <span>Logout</span>
                            </button>
                        </div>
                        <div id="mobileGuestMenu">
                            <button class="mobile-login-btn" id="mobileLoginBtn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                                <span>Login / Sign In</span>
                            </button>
                        </div>
                    </div>
                </nav>

                <div class="header-actions">
                    <a href="cart.html" class="cart-btn" aria-label="View Cart">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                        </svg>
                        <span class="cart-count" id="cartCount" style="display:none">0</span>
                    </a>
                    <div class="user-menu-wrap">
                        <button class="user-icon-btn" id="userIconBtn" aria-label="Account">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                        </button>
                        <div class="user-dropdown" id="userDropdown">
                            <div id="guestMenu">
                                <button class="dropdown-item" id="loginBtn">Login / Sign In</button>
                            </div>
                            <div id="loggedMenu" style="display:none">
                                <div class="dropdown-user-info" id="dropdownUserInfo">User</div>
                                <a href="dashboard.html" class="dropdown-item">My Dashboard</a>
                                <a href="cart.html" class="dropdown-item">My Cart</a>
                                <button class="dropdown-item dropdown-logout" id="logoutBtn">Logout</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="header-company-logo">
                    <img src="backend/images/Company logo-1.png" alt="NatooKart" class="header-company-badge">
                </div>

                <button class="hamburger" id="hamburger" aria-label="Toggle navigation">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                        <path d="M7 12h13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                        <path d="M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
                    </svg>
                </button>

            </div>
            <div class="mobile-overlay" id="mobileOverlay"></div>
        </header>
        ${categoryDrawerHtml}`;

        target.innerHTML = headerHtml;

        /* Add has-category-drawer class to body */
        document.body.classList.add('has-category-drawer');

        /* Delay init so page-specific scripts have already attached their
           (duplicate) listeners. The cloneNode inside strips them all. */
        setTimeout(function () { initHeaderBehaviors(); }, 0);
    }

    /**
     * Basic header behaviors: scroll shadow, hamburger toggle, user dropdown.
     * Page-specific scripts may re-initialize these — that's fine (idempotent).
     */
    function initHeaderBehaviors() {
        const header        = document.getElementById('header');
        const hamburger     = document.getElementById('hamburger');
        const navLinks      = document.getElementById('navLinks');
        const mobileOverlay = document.getElementById('mobileOverlay');
        const userBtn       = document.getElementById('userIconBtn');
        const userDrop      = document.getElementById('userDropdown');
        const loginBtn      = document.getElementById('loginBtn');
        const mobileLoginBtn = document.getElementById('mobileLoginBtn');
        const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

        function closeMenu() {
            if (hamburger) hamburger.classList.remove('active');
            if (navLinks) navLinks.classList.remove('open');
            if (mobileOverlay) mobileOverlay.classList.remove('visible');
            document.body.style.overflow = '';
        }

        function requestLogin() {
            if (userDrop) userDrop.classList.remove('open');
            closeMenu();
            if (typeof window.openEmailAuthModal === 'function') {
                window.openEmailAuthModal();
                return;
            }
            window.location.href = 'index.html?action=login';
        }

        function performHeaderLogout() {
            localStorage.removeItem('DEVASTHRA_token');
            localStorage.removeItem('DEVASTHRA_user');
            if (userDrop) userDrop.classList.remove('open');
            closeMenu();
            syncAuthUI();
        }

        /* Sticky header shadow on scroll */
        window.addEventListener('scroll', function () {
            if (header) header.classList.toggle('scrolled', window.pageYOffset > 10);
        }, { passive: true });

        /* Hamburger toggle */
        if (hamburger && navLinks) {
            hamburger.addEventListener('click', function () {
                const isOpen = navLinks.classList.contains('open');
                if (isOpen) {
                    closeMenu();
                } else {
                    hamburger.classList.add('active');
                    navLinks.classList.add('open');
                    if (mobileOverlay) mobileOverlay.classList.add('visible');
                    document.body.style.overflow = 'hidden';
                }
            });
        }

        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', function () {
                closeMenu();
            });
        }

        /* User dropdown — clone elements to strip any duplicate listeners from page scripts */
        if (userBtn && userDrop && !userBtn._siteHeaderDropdownBound) {
            /* Clone userBtn to remove ALL previous event listeners */
            const freshBtn = userBtn.cloneNode(true);
            userBtn.parentNode.replaceChild(freshBtn, userBtn);

            freshBtn._siteHeaderDropdownBound = true;
            freshBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                userDrop.classList.toggle('open');
            });
            userDrop.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            document.addEventListener('click', function () {
                userDrop.classList.remove('open');
            });
        }

        loginBtn?.addEventListener('click', function (e) {
            e.preventDefault();
            requestLogin();
        });

        mobileLoginBtn?.addEventListener('click', function (e) {
            e.preventDefault();
            requestLogin();
        });

        mobileLogoutBtn?.addEventListener('click', function (e) {
            e.preventDefault();
            performHeaderLogout();
            window.location.href = 'index.html';
        });

        /* Sync auth state */
        syncAuthUI();
    }

    /** Update header UI based on login state */
    function syncAuthUI() {
        var token, user;
        try {
            token = localStorage.getItem('DEVASTHRA_token');
            user  = JSON.parse(localStorage.getItem('DEVASTHRA_user'));
        } catch (e) { user = null; }

        var guestMenu        = document.getElementById('guestMenu');
        var loggedMenu       = document.getElementById('loggedMenu');
        var mobileGuestMenu  = document.getElementById('mobileGuestMenu');
        var mobileLoggedMenu = document.getElementById('mobileLoggedMenu');
        var dropdownUserInfo = document.getElementById('dropdownUserInfo');

        if (token && user) {
            if (guestMenu)        guestMenu.style.display = 'none';
            if (loggedMenu) {
                loggedMenu.style.display = 'block';
                loggedMenu.innerHTML = `
                    <div class="dropdown-user-info" id="dropdownUserInfo">${user.name || user.mobile || 'My Account'}</div>
                    <a href="dashboard.html" class="dropdown-item">My Dashboard</a>
                    <a href="cart.html" class="dropdown-item">My Cart</a>
                    <button class="dropdown-item dropdown-logout" id="logoutBtn">Logout</button>
                `;
                const nextLogoutBtn = loggedMenu.querySelector('#logoutBtn');
                nextLogoutBtn?.addEventListener('click', function (e) {
                    e.preventDefault();
                    localStorage.removeItem('DEVASTHRA_token');
                    localStorage.removeItem('DEVASTHRA_user');
                    const userDrop = document.getElementById('userDropdown');
                    userDrop?.classList.remove('open');
                    window.location.href = 'index.html';
                });
            }
            if (mobileGuestMenu)  mobileGuestMenu.style.display  = 'none';
            if (mobileLoggedMenu) mobileLoggedMenu.style.display = 'block';
            updateServerCartBadges(token);
        } else {
            if (guestMenu)        guestMenu.style.display = 'block';
            if (loggedMenu)       loggedMenu.style.display = 'none';
            if (mobileGuestMenu)  mobileGuestMenu.style.display  = 'block';
            if (mobileLoggedMenu) mobileLoggedMenu.style.display = 'none';
            window.DevasthraGuestCart?.updateBadges();
        }
    }

    /* Auto-render on DOM ready */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            renderSiteHeader();
        });
    } else {
        renderSiteHeader();
    }

    /* Expose globally */
    window.renderSiteHeader = renderSiteHeader;
    window.syncHeaderAuthUI = syncAuthUI;
})();
