const API_BASE = window.__API_BASE || (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
        ? 'http://localhost:5000'
        : window.location.origin
);

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const collectionId = params.get('id');
    const grid = document.getElementById('relatedProductsGrid');
    const cartCount = document.getElementById('cartCount');
    const mobileCartCount = document.querySelector('.mobile-cart-count');
    const collectionSwitcher = document.getElementById('collectionSwitcher');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const newsletterForm = document.getElementById('newsletterForm');
    const selectedSizes = new Map();

    const otpModal = document.getElementById('otpModal');
    const otpOverlay = document.getElementById('otpOverlay');
    const otpCloseBtn = document.getElementById('otpCloseBtn');
    const otpStep1 = document.getElementById('otpStep1');
    const otpStep2 = document.getElementById('otpStep2');
    const mobileInput = document.getElementById('otpMobile');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpInput = document.getElementById('otpInput');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const otpMessage = document.getElementById('otpMessage');
    const otpMessage2 = document.getElementById('otpMessage2');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpRegName = document.getElementById('otpRegName');
    const otpRegEmail = document.getElementById('otpRegEmail');
    const otpRegDob = document.getElementById('otpRegDob');
    const otpRegMobile = document.getElementById('otpRegMobile');
    const otpRegGender = document.getElementById('otpRegGender');

    const getToken = () => localStorage.getItem('DEVASTHRA_token');
    const getUser = () => {
        try {
            return JSON.parse(localStorage.getItem('DEVASTHRA_user'));
        } catch {
            return null;
        }
    };
    const isLoggedIn = () => !!getToken();

    const getImageUrl = (url) => {
        if (!url) return 'https://via.placeholder.com/800x900?text=No+Image';
        if (typeof url === 'object' && url.url) return url.url;
        if (String(url).startsWith('http')) return url;
        return String(url).startsWith('/') ? `${API_BASE}${url}` : `${API_BASE}/${url}`;
    };

    const fmt = (price) => `₹${Number(price || 0).toLocaleString('en-IN')}`;
    const getAvailableSizes = (product) => (
        product.has_size_inventory
            ? (product.available_sizes || [])
            : (product.sizes || [])
    ).filter(Boolean);

    let toastTimeout;
    let resendTimer;
    let currentIsNewUser = true;

    function showToast(message, type = 'info') {
        if (!toast || !toastMessage) return;
        clearTimeout(toastTimeout);
        toastMessage.textContent = message;
        toast.className = `toast show ${type}`;
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
    }

    function revealFadeItems(scope = document) {
        scope.querySelectorAll('.fade-in').forEach((element, index) => {
            requestAnimationFrame(() => {
                setTimeout(() => element.classList.add('visible'), index * 60);
            });
        });
    }

    function updateCartBadge(count) {
        if (cartCount) {
            cartCount.textContent = count > 0 ? count : '';
            cartCount.style.display = count > 0 ? 'flex' : 'none';
        }
        if (mobileCartCount) {
            mobileCartCount.textContent = count > 0 ? `(${count})` : '';
            mobileCartCount.style.display = count > 0 ? 'inline' : 'none';
        }
    }

    async function refreshCartCount() {
        if (!isLoggedIn()) return;
        try {
            const response = await fetch(`${API_BASE}/cart/count`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await response.json();
            if (data.success) updateCartBadge(data.count);
        } catch { }
    }

    function showOTPStep(step) {
        if (otpStep1) otpStep1.style.display = step === 1 ? 'block' : 'none';
        if (otpStep2) otpStep2.style.display = step === 2 ? 'block' : 'none';
    }

    function setOTPMsg(element, message, type = 'error') {
        if (!element) return;
        element.textContent = message;
        element.className = `otp-msg ${type}`;
    }

    function closeOTPModal() {
        otpModal?.classList.remove('show');
        otpOverlay?.classList.remove('show');
        document.body.style.overflow = '';
        clearInterval(resendTimer);
    }

    function startResendTimer() {
        let seconds = 30;
        if (resendOtpBtn) {
            resendOtpBtn.disabled = true;
            resendOtpBtn.textContent = `Resend in ${seconds}s`;
        }
        resendTimer = setInterval(() => {
            seconds -= 1;
            if (resendOtpBtn) resendOtpBtn.textContent = `Resend in ${seconds}s`;
            if (seconds <= 0) {
                clearInterval(resendTimer);
                if (resendOtpBtn) {
                    resendOtpBtn.disabled = false;
                    resendOtpBtn.textContent = 'Resend OTP';
                }
            }
        }, 1000);
    }

    async function loadCollectionsNav(activeCollectionId) {
        if (!collectionSwitcher) return;

        collectionSwitcher.innerHTML = '<div class="products-loading" style="padding:24px 12px;"><div class="spinner"></div><p>Loading collections...</p></div>';

        try {
            const response = await fetch(`${API_BASE}/products?main_only=true`);
            const data = await response.json();
            const collections = data.success ? (data.products || []) : [];

            if (!collections.length) {
                collectionSwitcher.innerHTML = '<p style="color:var(--color-medium-gray);padding:8px 0;">No collections available right now.</p>';
                return;
            }

            collectionSwitcher.innerHTML = collections.map((collection) => `
                <a
                    href="related-products.html?id=${collection.id}"
                    class="collection-switch-chip ${Number(collection.id) === Number(activeCollectionId) ? 'active' : ''}"
                >
                    <span class="collection-switch-thumb">
                        <img src="${getImageUrl(collection.image_url)}" alt="${collection.name}" loading="lazy">
                    </span>
                    <span class="collection-switch-copy">
                        <strong>${collection.name}</strong>
                        <small>${collection.available_sizes?.length || collection.sizes?.length || 0 ? 'Available now' : 'Explore collection'}</small>
                    </span>
                </a>
            `).join('');
        } catch {
            collectionSwitcher.innerHTML = '<p style="color:#c0392b;padding:8px 0;">Could not load collection shortcuts.</p>';
        }
    }

    async function addCollectionItemToCart(product, button) {
        const availableSizes = getAvailableSizes(product);
        const selectedSize = selectedSizes.get(String(product.id)) || availableSizes[0] || null;

        button.disabled = true;
        button.textContent = 'ADDING...';

        if (!isLoggedIn()) {
            sessionStorage.setItem('pendingCart', JSON.stringify({
                productId: product.id,
                size: selectedSize,
                quantity: 1,
                redirectTo: 'cart.html'
            }));
            window.location.href = 'cart.html';
            button.disabled = false;
            button.textContent = 'ADD TO CART';
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/add-to-cart`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}`
                },
                body: JSON.stringify({
                    product_id: product.id,
                    size: selectedSize,
                    quantity: 1
                })
            });
            const data = await response.json();

            if (data.success) {
                updateCartBadge(data.cartCount);
                window.location.href = 'cart.html';
                return;
            }

            showToast(data.message || 'Failed to add item to cart');
        } catch {
            showToast('Error connecting to server');
        }

        button.disabled = false;
        button.textContent = 'ADD TO CART';
    }

    otpCloseBtn?.addEventListener('click', closeOTPModal);
    otpOverlay?.addEventListener('click', closeOTPModal);

    sendOtpBtn?.addEventListener('click', async () => {
        const mobile = mobileInput?.value.trim();
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
            setOTPMsg(otpMessage, 'Enter a valid 10-digit mobile number');
            return;
        }

        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = 'Sending...';
        setOTPMsg(otpMessage, '');

        try {
            const response = await fetch(`${API_BASE}/api/send-mobile-login-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile, email: '' })
            });
            const data = await response.json();

            if (!data.success) {
                setOTPMsg(otpMessage, data.message || 'Failed to send OTP');
                return;
            }

            currentIsNewUser = data.isNewUser;

            showOTPStep(2);
            startResendTimer();
            setOTPMsg(otpMessage2, data.dev ? 'Dev mode: Check backend console for OTP' : 'OTP sent successfully', 'success');

            const modalHeader = otpModal?.querySelector('.otp-modal-header');
            if (modalHeader) {
                modalHeader.querySelector('h2').textContent = 'Enter Verification Code';
                modalHeader.querySelector('p').textContent = 'Enter the OTP sent to your mobile';
            }
        } catch {
            setOTPMsg(otpMessage, 'Cannot connect to server');
        } finally {
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = 'Send OTP';
        }
    });

    resendOtpBtn?.addEventListener('click', () => sendOtpBtn?.click());

    verifyOtpBtn?.addEventListener('click', async () => {
        const mobile = mobileInput?.value.trim();
        const otp = otpInput?.value.trim();

        if (!otp || otp.length !== 6) {
            setOTPMsg(otpMessage2, 'Enter the 6-digit OTP');
            return;
        }

        verifyOtpBtn.disabled = true;
        verifyOtpBtn.textContent = 'Verifying...';

        try {
            const response = await fetch(`${API_BASE}/api/verify-mobile-login-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mobile,
                    code: otp
                })
            });
            const data = await response.json();

            if (!data.success) {
                setOTPMsg(otpMessage2, data.message || 'Invalid OTP');
                return;
            }

            localStorage.setItem('DEVASTHRA_token', data.token);
            localStorage.setItem('DEVASTHRA_user', JSON.stringify({
                userId: data.userId,
                mobile: data.mobile,
                name: data.name || '',
                email: data.email || '',
                dob: data.dob || '',
                gender: data.gender || ''
            }));

            closeOTPModal();
            window.syncHeaderAuthUI?.();
            showToast('Logged in successfully', 'success');

            const pending = sessionStorage.getItem('pendingCart');
            if (pending) {
                window.location.href = 'cart.html';
                return;
            }

            await refreshCartCount();
        } catch {
            setOTPMsg(otpMessage2, 'Cannot connect to server');
        } finally {
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.textContent = 'Sign In';
        }
    });

    newsletterForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = newsletterForm.querySelector('input');
        const value = input?.value.trim() || '';
        if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            showToast('Please enter a valid email');
            return;
        }
        showToast('Welcome to the DEVASTHRA family!', 'success');
        input.value = '';
    });

    if (!collectionId) {
        window.location.href = 'index.html#categories';
        return;
    }

    window.syncHeaderAuthUI?.();
    revealFadeItems();
    await refreshCartCount();
    await loadCollectionsNav(collectionId);

    try {
        const response = await fetch(`${API_BASE}/products/${collectionId}`);
        const data = await response.json();
        if (!data.success || !data.product) throw new Error('Collection not found');

        const collection = data.collectionRoot || data.parentProduct || data.product;
        const groupedProducts = (data.collectionProducts || [
            data.product,
            ...(data.relatedProducts || [])
        ]).filter((item, index, list) => item && list.findIndex((candidate) => Number(candidate.id) === Number(item.id)) === index);

        document.title = `${collection.name} Collection - DEVASTHRA`;
        document.getElementById('collectionBreadcrumb').textContent = collection.name;
        document.getElementById('collectionTitle').textContent = collection.name;
        document.getElementById('collectionDescription').textContent = collection.description || 'Browse all products available in this collection before choosing the one you want to buy.';
        document.getElementById('collectionImage').src = getImageUrl(collection.image_url);
        document.getElementById('collectionImage').alt = collection.name;
        document.getElementById('collectionProductCount').textContent = String(groupedProducts.length);
        document.getElementById('collectionAudience').textContent = collection.ideal_for || collection.category || 'Collection';
        document.getElementById('relatedHeading').textContent = `Products In ${collection.name}`;
        document.getElementById('relatedSummary').textContent = groupedProducts.length
            ? `We found ${groupedProducts.length} product${groupedProducts.length > 1 ? 's' : ''} in this collection.`
            : 'No related products are currently available in this collection.';

        if (!groupedProducts.length) {
            grid.innerHTML = `
                <div class="cart-empty" style="grid-column:1/-1;">
                    <div class="cart-empty-icon">🧵</div>
                    <h2>No Related Products Yet</h2>
                    <p>This collection does not have visible related products right now.</p>
                    <a href="index.html#categories" class="btn btn-primary">Back to Categories</a>
                </div>
            `;
            return;
        }

        groupedProducts.forEach((product) => {
            const availableSizes = getAvailableSizes(product);
            if (availableSizes.length) {
                selectedSizes.set(String(product.id), availableSizes[0]);
            }
        });

        grid.innerHTML = groupedProducts.map((item, index) => {
            const discount = item.original_price ? Math.round((1 - item.price / item.original_price) * 100) : 0;
            const availableSizes = getAvailableSizes(item);
            const hasSizeOptions = item.has_size_inventory || (item.sizes || []).length > 0;
            const stockCount = item.has_size_inventory
                ? (item.size_inventory || []).reduce((sum, size) => sum + Number(size.quantity || 0), 0)
                : Number(item.stock || 0);
            const isOutOfStock = stockCount <= 0 || (hasSizeOptions && availableSizes.length === 0);

            return `
                <article class="collection-shop-card fade-in" data-product-id="${item.id}">
                    <div class="collection-shop-media" data-open-product="${item.id}">
                        <img src="${getImageUrl(item.image_url)}" alt="${item.name}" loading="lazy">
                        ${item.badge ? `<span class="product-badge ${item.badge_class}">${item.badge}</span>` : ''}
                        ${index === 0 ? '<span class="product-badge collection-main-badge">Main Product</span>' : ''}
                    </div>
                    <div class="collection-shop-info">
                        <h3 class="collection-shop-title" data-open-product="${item.id}">${item.name}</h3>
                        <div class="collection-shop-price">
                            <span class="current">${fmt(item.price)}</span>
                            ${item.original_price ? `<span class="original">${fmt(item.original_price)}</span>` : ''}
                            ${discount ? `<span class="discount">${discount}% OFF</span>` : ''}
                        </div>
                        <div class="collection-shop-sizes">
                            ${availableSizes.length
                                ? availableSizes.map((size, sizeIndex) => `
                                    <button type="button" class="collection-size-chip ${sizeIndex === 0 ? 'active' : ''}" data-product-id="${item.id}" data-size="${size}">
                                        ${size}
                                    </button>
                                `).join('')
                                : `<span class="collection-size-note">${hasSizeOptions ? 'Currently unavailable' : 'Free size'}</span>`
                            }
                        </div>
                        <button type="button" class="collection-add-btn" data-add-product="${item.id}" ${isOutOfStock ? 'disabled' : ''}>
                            ${isOutOfStock ? 'OUT OF STOCK' : 'ADD TO CART'}
                        </button>
                        <a href="product.html?id=${item.id}" class="collection-view-link">View product details</a>
                    </div>
                </article>
            `;
        }).join('');

        grid.querySelectorAll('[data-open-product]').forEach((element) => {
            element.addEventListener('click', () => {
                window.location.href = `product.html?id=${element.getAttribute('data-open-product')}`;
            });
        });

        grid.querySelectorAll('.collection-size-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const productId = chip.getAttribute('data-product-id');
                const size = chip.getAttribute('data-size');
                selectedSizes.set(productId, size);
                grid.querySelectorAll(`.collection-size-chip[data-product-id="${productId}"]`).forEach((item) => {
                    item.classList.toggle('active', item === chip);
                });
            });
        });

        groupedProducts.forEach((product) => {
            const button = grid.querySelector(`[data-add-product="${product.id}"]`);
            button?.addEventListener('click', () => addCollectionItemToCart(product, button));
        });

        revealFadeItems(document);
    } catch {
        grid.innerHTML = `
            <div class="cart-empty" style="grid-column:1/-1;">
                <div class="cart-empty-icon">⚠️</div>
                <h2>Collection Not Found</h2>
                <p>We could not load this collection right now.</p>
                <a href="index.html#categories" class="btn btn-primary">Back to Categories</a>
            </div>
        `;
    }
});
