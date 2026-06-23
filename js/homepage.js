/* ========================================
   DEVASTHRA — Culture in Motion
   Homepage Logic
   ======================================== */

const API_BASE = window.__API_BASE || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' ? 'http://localhost:5000' : window.location.origin);

document.addEventListener('DOMContentLoaded', () => {
    // ── Element References ──
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const contactForm = document.getElementById('contactForm');
    const newsletterForm = document.getElementById('newsletterForm');
    const cartCount = document.getElementById('cartCount');
    const mobileCartCount = document.querySelector('.mobile-cart-count');
    const marketingPopup = document.getElementById('marketingPopup');
    const marketingPopupOverlay = document.getElementById('marketingPopupOverlay');
    const marketingPopupForm = document.getElementById('marketingPopupForm');
    const marketingPopupClose = document.getElementById('marketingPopupClose');
    let marketingPopupTimer = null;
    const cornerPopupIds = ['Left', 'Right'];
    
    // ── Auth Helpers ──
    const getToken = () => localStorage.getItem('DEVASTHRA_token');
    const getUser = () => { try { return JSON.parse(localStorage.getItem('DEVASTHRA_user')); } catch { return null; } };
    const isLoggedIn = () => !!getToken();

    // ── 3. Smooth Scroll ──
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', e => {
            const dest = anchor.getAttribute('href');
            if (dest && dest.startsWith('#')) {
                const t = document.querySelector(dest);
                if (t) {
                    e.preventDefault();
                    window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' });
                }
            }
        });
    });

    // ── 4. Fade-In Observer ──
    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); fadeObserver.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

    // ── 5. Toast ──
    let toastTimeout;
    function showToast(msg, type = 'info') {
        if(!toast || !toastMessage) return;
        clearTimeout(toastTimeout);
        toastMessage.textContent = msg;
        toast.className = `toast show ${type}`;
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // ── 6. Price Formatter ──
    const fmt = p => '₹' + p.toLocaleString('en-IN');
    const NO_IMAGE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
            <rect width="300" height="300" fill="#f5efe9"/>
            <rect x="36" y="36" width="228" height="228" rx="20" fill="#fffaf6" stroke="#d8c8bd" stroke-width="2"/>
            <path d="M98 178l34-34 24 24 26-26 20 20v24H98z" fill="#c9a96e" opacity=".55"/>
            <circle cx="122" cy="118" r="14" fill="#700823" opacity=".35"/>
            <text x="150" y="214" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#7a6a61">No Image</text>
        </svg>
    `);
    const getImageUrl = (url) => {
        if (!url) return NO_IMAGE_PLACEHOLDER;

        const raw = typeof url === 'object' && url?.url ? String(url.url).trim() : String(url).trim();
        if (!raw) return NO_IMAGE_PLACEHOLDER;
        if (/^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^image\/svg\+xml/i.test(raw)) return `data:${raw}`;
        if (/^svg\+xml/i.test(raw)) return `data:image/${raw}`;
        return raw.startsWith('/') ? `${API_BASE}${raw}` : `${API_BASE}/${raw}`;
    };

    const getBannerImageUrl = (url) => getImageUrl(url);

    function renderStarsHTML(avgRating) {
        const rating = Number(avgRating) || 0;
        let html = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= Math.floor(rating)) {
                html += '<span class="star filled">★</span>';
            } else if (i - rating < 1 && i - rating > 0) {
                html += '<span class="star half">★</span>';
            } else {
                html += '<span class="star empty">☆</span>';
            }
        }
        return html;
    }

    function setLinkContent(link, text, href) {
        if (!link) return;
        if (text) link.textContent = text;
        if (href) link.setAttribute('href', href);
    }

    const EMPTY_HERO_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

    function installHeroImageFallbacks() {
        document.querySelectorAll('.hero-bg img').forEach((img) => {
            if (img.dataset.fallbackBound === 'true') return;
            img.dataset.fallbackBound = 'true';
            img.addEventListener('error', () => {
                const mobileSource = img.parentElement?.querySelector('source');
                if (mobileSource) mobileSource.srcset = '';
                img.src = EMPTY_HERO_IMAGE;
                img.style.display = 'none';
                const heroBg = img.closest('.hero-bg');
                if (heroBg) {
                    heroBg.style.background = 'linear-gradient(135deg, rgba(74, 10, 30, 0.9) 0%, rgba(107, 15, 43, 0.82) 100%)';
                }
            });
        });
    }

    function setHeroSlideMedia(index, slideData = null) {
        const img = document.getElementById(`heroSlide${index}Img`);
        const mobileSrc = document.getElementById(`heroSlide${index}MobileSrc`);
        const heroBg = document.querySelector(`#heroSlide${index} .hero-bg`);
        const imageUrl = getBannerImageUrl(slideData?.image_url || '');
        const mobileImageUrl = getBannerImageUrl(slideData?.mobile_image_url || imageUrl);

        if (mobileSrc) mobileSrc.srcset = imageUrl ? mobileImageUrl : '';
        if (img) {
            img.src = imageUrl || EMPTY_HERO_IMAGE;
            img.style.display = imageUrl ? '' : 'none';
        }
        if (heroBg) {
            heroBg.style.background = imageUrl
                ? ''
                : 'linear-gradient(135deg, rgba(74, 10, 30, 0.9) 0%, rgba(107, 15, 43, 0.82) 100%)';
        }
    }

    function parseCountdownTarget(value) {
        if (!value) return null;
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    function closeCornerPopup(position) {
        const shell = document.getElementById(`cornerPopup${position}`);
        if (!shell) return;
        if (shell.contains(document.activeElement)) {
            document.activeElement?.blur?.();
        }
        shell.hidden = true;
        shell.style.display = 'none';
        shell.setAttribute('aria-hidden', 'true');
    }

    function bindCornerPopupImageFallback(position) {
        const image = document.getElementById(`cornerPopup${position}Image`);
        const media = document.getElementById(`cornerPopup${position}Media`);
        const shell = document.getElementById(`cornerPopup${position}`);

        if (!image || image.dataset.fallbackBound === 'true') return;

        image.dataset.fallbackBound = 'true';
        image.addEventListener('error', () => {
            if (media) media.hidden = true;
            if (shell) shell.classList.remove('has-image');
            image.removeAttribute('src');
        });
    }

    function renderCornerPopup(position, banner) {
        const shell = document.getElementById(`cornerPopup${position}`);
        const media = document.getElementById(`cornerPopup${position}Media`);
        const image = document.getElementById(`cornerPopup${position}Image`);
        const kicker = document.getElementById(`cornerPopup${position}Kicker`);
        const title = document.getElementById(`cornerPopup${position}Title`);
        const description = document.getElementById(`cornerPopup${position}Description`);
        const cta = document.getElementById(`cornerPopup${position}Cta`);

        if (!shell) return;

        if (!banner) {
            shell.hidden = true;
            shell.style.display = 'none';
            return;
        }

        shell.dataset.slotKey = banner.slot_key;
        shell.hidden = false;
        shell.style.display = '';
        shell.removeAttribute('aria-hidden');
        bindCornerPopupImageFallback(position);

        const imageUrl = banner.image_url ? getBannerImageUrl(banner.image_url) : '';
        const hasImage = Boolean(imageUrl);
        shell.classList.toggle('has-image', hasImage);

        if (media) media.hidden = !hasImage;
        if (image) {
            image.src = hasImage ? imageUrl : '';
            image.alt = banner.title || `DEVASTHRA ${position} corner popup`;
        }
        if (kicker) {
            kicker.textContent = banner.kicker || '';
            kicker.hidden = !banner.kicker;
        }
        if (title) title.textContent = banner.title || '';
        if (description) {
            description.textContent = banner.description || '';
            description.hidden = !banner.description;
        }
        if (cta) {
            if (banner.button_text) {
                cta.textContent = banner.button_text;
                cta.hidden = false;
                cta.href = banner.button_link || '#';
            } else {
                cta.hidden = true;
                cta.textContent = '';
                cta.removeAttribute('href');
            }
        }
    }

    function loadHomepageBanners(banners = []) {
        const bySlot = Object.fromEntries((banners || []).map((banner) => [banner.slot_key, banner]));

        // ── Hero Slides (dynamic from API) ──
        ['hero_slide_1', 'hero_slide_2', 'hero_slide_3'].forEach((slotKey, i) => {
            const slideData = bySlot[slotKey];
            if (!slideData) return;
            const kicker = document.getElementById(`heroSlide${i}Kicker`);
            const title = document.getElementById(`heroSlide${i}Title`);
            const tagline = document.getElementById(`heroSlide${i}Tagline`);
            const btn1 = document.getElementById(`heroSlide${i}Btn1`);
            const btn2 = document.getElementById(`heroSlide${i}Btn2`);
            if (kicker) kicker.textContent = slideData.kicker || kicker.textContent;
            if (title) title.textContent = slideData.title || title.textContent;
            if (tagline) tagline.textContent = slideData.description || tagline.textContent;
            setHeroSlideMedia(i, slideData);
            setLinkContent(btn1, slideData.button_text, slideData.button_link);
            setLinkContent(btn2, slideData.secondary_button_text, slideData.secondary_button_link);
        });

        // ── Offer Strip (pipe-separated title) ──
        const offerStripData = bySlot.offer_strip;
        if (offerStripData) {
            const track = document.getElementById('offerStripTrack');
            const messageSource = offerStripData.description || offerStripData.title || '';
            if (track && messageSource) {
                const messages = messageSource.split('|').map(m => m.trim()).filter(Boolean);
                if (messages.length) {
                    // Duplicate for seamless marquee loop
                    const items = [...messages, ...messages].map(msg => `<span class="offer-strip-item">${msg}</span>`).join('');
                    track.innerHTML = items;
                }
            }
        }

        // ── Festive Drop Banner ──
        const festiveData = bySlot.festive_drop;
        if (festiveData) {
            const festiveKicker = document.getElementById('festiveDropKicker');
            const festiveTitle = document.getElementById('festiveDropTitle');
            const festiveTagline = document.getElementById('festiveDropTagline');
            const festiveCta = document.getElementById('festiveDropCta');
            const festiveCountdown = document.getElementById('festiveCountdown');
            const festiveBg = document.querySelector('.festive-drop-bg');
            const festiveSection = document.getElementById('festive-drop');
            if (festiveKicker) festiveKicker.textContent = festiveData.kicker || festiveKicker.textContent;
            if (festiveTitle) festiveTitle.textContent = festiveData.title || festiveTitle.textContent;
            if (festiveTagline) festiveTagline.textContent = festiveData.description || festiveTagline.textContent;
            setLinkContent(festiveCta, festiveData.button_text, festiveData.button_link);
            // const hasFestiveImage = Boolean(festiveData.image_url);
            const festiveImageUrl = getBannerImageUrl(festiveData.image_url || '');
            if (festiveBg && festiveImageUrl) {
                festiveBg.style.backgroundImage = `linear-gradient(135deg, rgba(94,16,37,0.78), rgba(52,8,22,0.82)), url('${festiveImageUrl}')`;
            }
            if (festiveSection) {
                festiveSection.dataset.countdownTarget = festiveData.countdown_target || festiveData.subtitle || '';
                festiveSection.classList.toggle('without-countdown', !festiveData.show_countdown);
                // festiveSection.classList.toggle('festive-drop--image-present', hasFestiveImage);
            }
            if (festiveCountdown) {
                festiveCountdown.style.display = festiveData.show_countdown ? '' : 'none';
            }
        }

        // ── Corner Popup ──
        renderCornerPopup('Left', bySlot.corner_popup_left);
        renderCornerPopup('Right', bySlot.corner_popup_right);
    }

    async function fetchBanners() {
        try {
            const res = await fetch(`${API_BASE}/api/banners`);
            const data = await res.json();
            if (data.success) loadHomepageBanners(data.banners || []);
        } catch (error) {
            console.warn('Could not load homepage banners:', error.message);
        }
    }

    function fixHomepageCopyGlitches() {
        const aboutDescriptions = document.querySelectorAll('.about-content .section-desc');
        if (aboutDescriptions[0]) {
            aboutDescriptions[0].textContent = 'DEVASTHRA was born from a deep reverence for cultural heritage and a passion for modern design. Our name draws from "Vastra" - the Sanskrit word for clothing - reimagined for a new generation that values both roots and style.';
        }
        if (aboutDescriptions[1]) {
            aboutDescriptions[1].textContent = 'Every piece in our collection tells a story - blending age-old textile traditions with contemporary silhouettes. We work with artisan communities to create fashion that honors craftsmanship while embracing the energy of modern living.';
        }

        const phoneLines = document.querySelectorAll('.contact-item h4');
        phoneLines.forEach((heading) => {
            if (heading.textContent.trim() === 'Phone') {
                const info = heading.parentElement;
                const paragraphs = info ? info.querySelectorAll('p') : [];
                if (paragraphs[1]) paragraphs[1].textContent = 'Mon - Sat, 10AM - 7PM IST';
            }
        });

        document.title = 'DEVASTHRA';
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.setAttribute('content', 'DEVASTHRA - Culture in Motion');
    }

    function openMarketingPopup() {
        if (!marketingPopup || !marketingPopupOverlay) return;
        marketingPopup.classList.add('show');
        marketingPopupOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeMarketingPopup() {
        if (!marketingPopup || !marketingPopupOverlay) return;
        marketingPopup.classList.remove('show');
        marketingPopupOverlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    async function submitNewsletterSignup(email, source) {
        const res = await fetch(`${API_BASE}/newsletter-signups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, source })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Could not save your email');
        return data;
    }

    // ── 7. Fetch & Render Products from API ──
    async function loadProducts() {
        const grid = document.getElementById('productsGrid');
        if (!grid) return;

        grid.innerHTML = `<div class="products-loading"><div class="spinner"></div><p>Loading featured products...</p></div>`;

        try {
            const res = await fetch(`${API_BASE}/products`);

            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await res.text();
                throw new Error('Server returned non-JSON response.');
            }

            const data = await res.json();

            const featuredProducts = (data.products || [])
                .filter(product => product.is_main_product)
                .filter(product => !!product.badge)
                .slice(0, 8);

            if (!data.success || !featuredProducts.length) {
                grid.innerHTML = `<p style="text-align:center;color:#888;padding:40px">No featured products available right now.</p>`;
                return;
            }

            grid.innerHTML = featuredProducts.map(product => {
                const discount = product.original_price
                    ? Math.round((1 - product.price / product.original_price) * 100) : 0;
                return `
                <div class="product-card fade-in" data-product-id="${product.id}" style="cursor:pointer">
                    <div class="product-image">
                        <img src="${getImageUrl(product.image_url)}" alt="${product.name}" loading="lazy">
                        ${product.badge ? `<span class="product-badge ${product.badge_class}">${product.badge}</span>` : ''}
                    </div>
                    <div class="product-info">
                        <h3 class="product-name">${product.name}</h3>
                        <div class="product-price">
                            <span class="current">${fmt(product.price)}</span>
                            ${product.original_price ? `<span class="original">${fmt(product.original_price)}</span>` : ''}
                            ${discount ? `<span class="discount">${discount}% OFF</span>` : ''}
                        </div>
                        ${product.avg_rating ? `<div class="product-rating"><span class="product-rating-stars">${renderStarsHTML(product.avg_rating)}</span><span class="product-rating-count">(${product.review_count})</span></div>` : ''}
                    </div>
                    <button class="btn btn-primary product-atc-btn" data-id="${product.id}" data-name="${product.name}" data-price="${product.price}" style="margin:12px;width:calc(100% - 24px)">
                        Add to Cart
                    </button>
                </div>`;
            }).join('');

            grid.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

            grid.querySelectorAll('.product-card').forEach(card => {
                card.addEventListener('click', e => {
                    if (e.target.classList.contains('product-atc-btn')) return;
                    window.location.href = `related-products.html?id=${card.getAttribute('data-product-id')}`;
                });
            });

            grid.querySelectorAll('.product-atc-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const productId = btn.getAttribute('data-id');
                    handleAddToCart(productId, null, 1, btn);
                });
            });

        } catch (err) {
            console.error('Failed to load products:', err);
            grid.innerHTML = `<p style="text-align:center;color:#c0392b;padding:40px">⚠️ Could not load products. Make sure the backend server is running on port 5000.</p>`;
        }
    }

    // ── 8. Add To Cart Handler ──
    async function loadCollections() {
        const grid = document.getElementById('collectionsGrid');
        if (!grid) return;

        grid.innerHTML = `<div class="products-loading"><div class="spinner"></div><p>Loading categories...</p></div>`;

        try {
            const res = await fetch(`${API_BASE}/products?main_only=true`);
            const data = await res.json();

            if (!data.success || !(data.products || []).length) {
                grid.innerHTML = `<p style="text-align:center;color:#888;padding:40px">No collections available right now.</p>`;
                return;
            }

            grid.innerHTML = data.products.map((product, index) => `
                <div class="collection-card fade-in" data-id="${product.id}" style="cursor:pointer">
                    <img src="${getImageUrl(product.image_url)}" alt="${product.name}" loading="lazy">
                    <div class="collection-overlay">
                        <span class="collection-label">${product.badge || `Collection ${index + 1}`}</span>
                        <h3 class="collection-name">${product.name}</h3>
                        <a href="related-products.html?id=${product.id}" class="collection-link">
                            Explore
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </a>
                    </div>
                </div>
            `).join('');

            grid.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));
            grid.querySelectorAll('.collection-card').forEach(card => {
                card.addEventListener('click', () => {
                    window.location.href = `related-products.html?id=${card.getAttribute('data-id')}`;
                });
            });
        } catch (err) {
            console.error('Failed to load collections:', err);
            grid.innerHTML = `<p style="text-align:center;color:#c0392b;padding:40px">Could not load collections.</p>`;
        }
    }

    async function handleAddToCart(productId, size, quantity = 1, btn = null) {
        if (!isLoggedIn()) {
            window.DevasthraGuestCart?.add({
                productId,
                size: size || '',
                quantity,
                productDetails: {
                    id: productId,
                    name: btn?.getAttribute('data-name') || 'Product',
                    price: Number(btn?.getAttribute('data-price') || 0)
                }
            });
            updateCartBadge(window.DevasthraGuestCart?.count() || 0);
            showToast('Added to cart', 'success');
            if (btn) { btn.textContent = 'Added'; setTimeout(() => { btn.textContent = 'Add to Cart'; btn.disabled = false; }, 1200); }
            return;
        }
        await doAddToCart(productId, size, quantity, btn);
    }

    async function doAddToCart(productId, size, quantity = 1, btn = null) {
        try {
            if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }

            const res = await fetch(`${API_BASE}/add-to-cart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify({ product_id: productId, size, quantity })
            });
            const data = await res.json();

            if (data.success) {
                if (window.firePixelAddToCart) {
                    window.firePixelAddToCart({
                        product_id: productId,
                        sku: `SKU-${productId}`,
                        name: btn?.getAttribute('data-name') || 'Product',
                        price: Number(btn?.getAttribute('data-price') || data.item?.price || 0),
                        quantity,
                        size
                    });
                }
                showToast('✓ Added to cart!', 'success');
                updateCartBadge(data.cartCount);
                if (btn) { btn.textContent = '✓ Added'; setTimeout(() => { btn.textContent = 'Add to Cart'; btn.disabled = false; }, 2000); }
            } else {
                showToast(data.message || 'Failed to add to cart');
                if (btn) { btn.textContent = 'Add to Cart'; btn.disabled = false; }
            }
        } catch (err) {
            console.error(err);
            showToast('Error connecting to server');
            if (btn) { btn.textContent = 'Add to Cart'; btn.disabled = false; }
        }
    }

    // ── 9. Cart Badge ──
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
        if (!isLoggedIn()) {
            updateCartBadge(window.DevasthraGuestCart?.count() || 0);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/cart/count`, {
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (data.success) updateCartBadge(data.count);
        } catch { }
    }

    // ── 13. Contact Form ──
    document.addEventListener('click', (e) => {
        if (e.target.closest('#logoutBtn') || e.target.closest('#mobileLogoutBtn')) {
            e.preventDefault();
            localStorage.removeItem('DEVASTHRA_token');
            localStorage.removeItem('DEVASTHRA_user');
            if (window.renderSiteHeader) window.renderSiteHeader();
            showToast('Logged out successfully', 'success');
            setTimeout(() => window.location.reload(), 500);
        }
    });

    if (contactForm) {
        contactForm.addEventListener('submit', async e => {
            e.preventDefault();
            const name = document.getElementById('contactName').value.trim();
            const email = document.getElementById('contactEmail').value.trim();
            const message = document.getElementById('contactMessage').value.trim();
            if (!name || !email || !message) { showToast('Please fill in all fields'); return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email'); return; }
            try {
                const res = await fetch(`${API_BASE}/contact-messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, message })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.message || 'Failed to submit message');
                if (window.firePixelContact) {
                    window.firePixelContact({
                        content_name: 'Contact Form Submission',
                        content_category: 'Customer Support',
                        method: 'form',
                        email
                    });
                }
                showToast('Message sent successfully! Our team will review it shortly.', 'success');
                contactForm.reset();
            } catch (err) {
                showToast(err.message || 'Could not submit your message');
            }
        });
    }

    // ── 14. Newsletter ──
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', async e => {
            e.preventDefault();
            const input = newsletterForm.querySelector('input');
            const email = input?.value.trim() || '';
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('Please enter a valid email'); return;
            }
            try {
                const data = await submitNewsletterSignup(email, 'footer-newsletter');
                if (window.firePixelLead) {
                    window.firePixelLead({
                        content_name: 'Newsletter Signup',
                        content_category: 'Newsletter',
                        source: 'footer-newsletter',
                        email
                    });
                }
                showToast(
                    data.alreadySubscribed
                        ? 'You are already subscribed. Watch your inbox for DEVASTHRA updates.'
                        : 'Welcome to the DEVASTHRA family. Check your inbox for the offer.',
                    'success'
                );
                input.value = '';
            } catch (err) {
                showToast(err.message || 'Could not save your email');
            }
        });
    }

    // ── INIT ──
    if (marketingPopupClose) {
        marketingPopupClose.addEventListener('click', () => closeMarketingPopup());
    }

    if (marketingPopupOverlay) {
        marketingPopupOverlay.addEventListener('click', () => closeMarketingPopup());
    }

    cornerPopupIds.forEach((position) => {
        document.getElementById(`cornerPopup${position}Close`)?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const shell = document.getElementById(`cornerPopup${position}`);
            closeCornerPopup(position);
        });
    });

    if (marketingPopupForm) {
        marketingPopupForm.addEventListener('submit', async event => {
            event.preventDefault();
            const emailInput = document.getElementById('marketingPopupEmail');
            const submitButton = marketingPopupForm.querySelector('button[type="submit"]');
            const email = emailInput?.value.trim() || '';

            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('Please enter a valid email address');
                return;
            }

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Saving...';
            }

            try {
                const data = await submitNewsletterSignup(email, 'homepage-popup');
                if (window.firePixelLead) {
                    window.firePixelLead({
                        content_name: 'Homepage Offer Signup',
                        content_category: 'Newsletter',
                        source: 'homepage-popup',
                        email
                    });
                }
                showToast(
                    data.alreadySubscribed
                        ? 'This email is already subscribed. Watch your inbox for DEVASTHRA offers.'
                        : '10% OFF saved. Check your inbox for the offer.',
                    'success'
                );
                marketingPopupForm.reset();
                closeMarketingPopup();
            } catch (err) {
                showToast(err.message || 'Could not save your email');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = document.getElementById('marketingPopupSubmit')?.textContent || 'Unlock 10% Off';
                }
            }
        });
    }

    const shouldShowMarketingPopup = !isLoggedIn();
    if (shouldShowMarketingPopup && marketingPopup && marketingPopupOverlay) {
        marketingPopupTimer = window.setTimeout(() => openMarketingPopup(), 900);
    }

    installHeroImageFallbacks();
    [0, 1, 2].forEach((index) => setHeroSlideMedia(index));
    fetchBanners();
    fixHomepageCopyGlitches();

    // ── Hero Slider (3-slide auto-rotate with arrows) ──
    function initHeroSlider() {
        const slides = document.querySelectorAll('.hero-slide');
        const dots = document.querySelectorAll('.hero-dot');
        const prevBtn = document.getElementById('heroPrev');
        const nextBtn = document.getElementById('heroNext');
        if (!slides.length || slides.length < 2) return;

        let current = 0;
        let interval = null;
        const INTERVAL_MS = 4000;

        function goToSlide(index) {
            slides[current].classList.remove('active');
            dots[current]?.classList.remove('active');
            current = index;
            slides[current].classList.add('active');
            dots[current]?.classList.add('active');
        }

        function nextSlide() { goToSlide((current + 1) % slides.length); }
        function prevSlide() { goToSlide((current - 1 + slides.length) % slides.length); }

        function startAutoplay() {
            if (interval) clearInterval(interval);
            interval = setInterval(nextSlide, INTERVAL_MS);
        }
        function stopAutoplay() {
            if (interval) { clearInterval(interval); interval = null; }
        }

        // Arrow click navigation
        if (prevBtn) prevBtn.addEventListener('click', () => { prevSlide(); stopAutoplay(); startAutoplay(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { nextSlide(); stopAutoplay(); startAutoplay(); });

        // Dot click navigation
        dots.forEach(dot => {
            dot.addEventListener('click', () => {
                const idx = parseInt(dot.getAttribute('data-slide'), 10);
                if (idx !== current) { goToSlide(idx); stopAutoplay(); startAutoplay(); }
            });
        });

        // Pause on hover
        const heroSection = document.getElementById('home');
        if (heroSection) {
            heroSection.addEventListener('mouseenter', stopAutoplay);
            heroSection.addEventListener('mouseleave', startAutoplay);
        }

        startAutoplay();
    }

    // ── Festive Drop Countdown ──
    function initFestiveCountdown() {
        const daysEl = document.getElementById('countdownDays');
        const hoursEl = document.getElementById('countdownHours');
        const minutesEl = document.getElementById('countdownMinutes');
        const secondsEl = document.getElementById('countdownSeconds');
        if (!daysEl || !hoursEl || !minutesEl || !secondsEl) return;

        // Target: Diwali 2026 — October 12, 2026
        const festiveSection = document.getElementById('festive-drop');
        const countdownWrap = document.getElementById('festiveCountdown');
        const target = parseCountdownTarget(festiveSection?.dataset.countdownTarget);
        if (!countdownWrap || !target || countdownWrap.style.display === 'none') {
            if (countdownWrap) countdownWrap.style.display = 'none';
            if (festiveSection) festiveSection.classList.add('without-countdown');
            return;
        }

        function update() {
            const now = Date.now();
            let diff = target - now;
            if (diff < 0) diff = 0;

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            daysEl.textContent = String(days).padStart(2, '0');
            hoursEl.textContent = String(hours).padStart(2, '0');
            minutesEl.textContent = String(minutes).padStart(2, '0');
            secondsEl.textContent = String(seconds).padStart(2, '0');
        }

        update();
        setInterval(update, 1000);
    }

    initHeroSlider();
    initFestiveCountdown();

    const isManagedByHomepageCatalog = !!document.getElementById('categoryAudienceSwitch');
    if (!isManagedByHomepageCatalog) {
        loadProducts();
        loadCollections();
    }
});
