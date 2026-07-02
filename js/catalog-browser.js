const CATALOG_API_BASE = window.__API_BASE || (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
        ? 'http://localhost:5000'
        : window.location.origin
);
const catalogFetchJson = window.__fetchJsonWithApiFallback
    ? (path, options) => window.__fetchJsonWithApiFallback(path, options)
    : async (path, options) => {
        const url = `${CATALOG_API_BASE}${String(path).startsWith('/') ? path : `/${path}`}`;
        const response = await fetch(url, options);
        return {
            base: CATALOG_API_BASE,
            url,
            response,
            data: await response.json()
        };
    };

document.addEventListener('DOMContentLoaded', async () => {
    const header = document.getElementById('header');
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    const mobileOverlay = document.getElementById('mobileOverlay');
    const cartCount = document.getElementById('cartCount');
    const mobileCartCount = document.querySelector('.mobile-cart-count');
    const userBtn = document.getElementById('userIconBtn');
    const userDrop = document.getElementById('userDropdown');
    const guestMenu = document.getElementById('guestMenu');
    const loggedMenu = document.getElementById('loggedMenu');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const mobileGuestMenu = document.getElementById('mobileGuestMenu');
    const mobileLoggedMenu = document.getElementById('mobileLoggedMenu');
    const mobileLoginBtn = document.getElementById('mobileLoginBtn');
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
    const getToken = () => localStorage.getItem('DEVASTHRA_token');
    const getUser = () => {
        try {
            return JSON.parse(localStorage.getItem('DEVASTHRA_user'));
        } catch {
            return null;
        }
    };

    window.addEventListener('scroll', () => {
        header?.classList.toggle('scrolled', window.pageYOffset > 60);
    }, { passive: true });

    function openMenu() {
        hamburger?.classList.add('active');
        navLinks?.classList.add('open');
        mobileOverlay?.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
        hamburger?.classList.remove('active');
        navLinks?.classList.remove('open');
        mobileOverlay?.classList.remove('visible');
        document.body.style.overflow = '';
    }

    hamburger?.addEventListener('click', () => navLinks?.classList.contains('open') ? closeMenu() : openMenu());
    mobileOverlay?.addEventListener('click', closeMenu);
    navLinks?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

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
        if (!getToken()) return;
        try {
            const res = await fetch(`${CATALOG_API_BASE}/cart/count`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (data.success) updateCartBadge(data.count);
        } catch { }
    }

    function updateUserUI() {
        const user = getUser();
        if (user && getToken()) {
            if (guestMenu) guestMenu.style.display = 'none';
            if (loggedMenu) loggedMenu.style.display = 'block';
            if (mobileGuestMenu) mobileGuestMenu.style.display = 'none';
            if (mobileLoggedMenu) mobileLoggedMenu.style.display = 'block';
            refreshCartCount();
        } else {
            if (guestMenu) guestMenu.style.display = 'block';
            if (loggedMenu) loggedMenu.style.display = 'none';
            if (mobileGuestMenu) mobileGuestMenu.style.display = 'block';
            if (mobileLoggedMenu) mobileLoggedMenu.style.display = 'none';
            updateCartBadge(0);
        }
    }

    function performLogout() {
        localStorage.removeItem('DEVASTHRA_token');
        localStorage.removeItem('DEVASTHRA_user');
        closeMenu();
        userDrop?.classList.remove('open');
        updateUserUI();
    }

    userBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        userDrop?.classList.toggle('open');
    });
    document.addEventListener('click', () => userDrop?.classList.remove('open'));
    loginBtn?.addEventListener('click', () => { window.location.href = 'index.html'; });
    mobileLoginBtn?.addEventListener('click', () => { closeMenu(); window.location.href = 'index.html'; });
    logoutBtn?.addEventListener('click', performLogout);
    mobileLogoutBtn?.addEventListener('click', performLogout);
    updateUserUI();
    window.syncHeaderAuthUI?.();

    function normalizeAudience(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['women', 'woman', 'female', 'ladies', 'lady'].includes(normalized)) return 'Women';
        if (['men', 'man', 'male', 'gents', 'gentlemen'].includes(normalized)) return 'Men';
        if (['kids', 'kid', 'children', 'child', 'boys', 'girls'].includes(normalized)) return 'Kids';
        if (['unisex', 'all', 'all genders', 'everyone'].includes(normalized)) return 'Unisex';
        if (!normalized) return 'Unspecified';
        return String(value).trim();
    }

    const params = new URLSearchParams(window.location.search);
    let taxonomy = {};
    let audienceState = {};
    let activeAudience = '';
    let activeCategory = params.get('category') || '';
    let activeSubcategory = params.get('subcategory') || '';

    const getImageUrl = (url) => {
        if (!url) return 'https://via.placeholder.com/600x800?text=Product';
        const raw = typeof url === 'object' && url?.url ? String(url.url).trim() : String(url).trim();
        if (!raw) return 'https://via.placeholder.com/600x800?text=Product';
        if (/^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^image\/svg\+xml/i.test(raw)) return `data:${raw}`;
        if (/^svg\+xml/i.test(raw)) return `data:image/${raw}`;
        return raw.startsWith('/') ? `${CATALOG_API_BASE}${raw}` : `${CATALOG_API_BASE}/${raw}`;
    };

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

    function getAudienceTaxonomy(audience) {
        return (Array.isArray(taxonomy[audience]) ? taxonomy[audience] : [])
            .filter((entry) => entry.lockedByParent !== true);
    }

    function getCurrentCategoryEntry() {
        return getAudienceTaxonomy(activeAudience).find((entry) => entry.category === activeCategory) || null;
    }

    function getFirstActiveCategory(audience) {
        return getAudienceTaxonomy(audience).find((entry) => entry.isActive !== false)?.category || '';
    }

    function updateUrl() {
        const nextParams = new URLSearchParams();
        nextParams.set('gender', activeAudience);
        if (activeCategory) nextParams.set('category', activeCategory);
        if (activeSubcategory) nextParams.set('subcategory', activeSubcategory);
        window.history.replaceState({}, '', `${window.location.pathname}?${nextParams.toString()}`);
    }

    try {
        const [productsResult, taxonomyResult] = await Promise.all([
            catalogFetchJson('/api/products'),
            catalogFetchJson('/api/products/taxonomy')
        ]);
        const data = productsResult.data;
        const taxonomyData = taxonomyResult.data;
        const products = data.success ? (data.products || []) : [];
        taxonomy = taxonomyData.success ? (taxonomyData.taxonomy || {}) : {};
        audienceState = Object.fromEntries(Object.entries(taxonomyData.structuredTaxonomy || {}).map(([audience, entry]) => [audience, entry?.isActive !== false]));
        const audiences = Object.keys(taxonomy);
        const requestedAudience = params.get('gender');
        const firstEnabledAudience = audiences.find((audience) => audienceState[audience] !== false) || audiences[0];
        activeAudience = requestedAudience && audiences.includes(requestedAudience) && audienceState[requestedAudience] !== false
            ? requestedAudience
            : (audiences.includes('Men') && audienceState.Men !== false ? 'Men' : firstEnabledAudience);

        const audienceProducts = () => products.filter((product) => normalizeAudience(product.ideal_for) === activeAudience);
        const categoryProducts = () => audienceProducts().filter((product) => product.category === activeCategory);
        const filteredProducts = () => categoryProducts().filter((product) => !activeSubcategory || product.subcategory === activeSubcategory);

        if (!activeCategory) {
            activeCategory = getFirstActiveCategory(activeAudience);
        }

        if (activeCategory && getCurrentCategoryEntry()?.isActive === false) {
            activeCategory = getFirstActiveCategory(activeAudience);
            activeSubcategory = '';
        }

        if (activeSubcategory && !getCurrentCategoryEntry()?.subcategories.some((subcategory) => subcategory.subcategory === activeSubcategory && subcategory.isActive !== false)) {
            activeSubcategory = '';
        }

        function renderAudienceSwitch() {
            const switcher = document.getElementById('catalogAudienceSwitch');
            if (!switcher) return;

            switcher.innerHTML = audiences.map((audience) => `
                <button type="button" class="collection-switch-chip ${audience === activeAudience ? 'active' : ''} ${audienceState[audience] === false ? 'is-disabled' : ''}" data-audience="${audience}" ${audienceState[audience] === false ? 'disabled' : ''}>
                    <span class="collection-switch-copy">
                        <strong>${audience}</strong>
                        <small>${getAudienceTaxonomy(audience).length} main categories</small>
                    </span>
                </button>
            `).join('');

            switcher.querySelectorAll('[data-audience]').forEach((button) => {
                button.addEventListener('click', () => {
                    activeAudience = button.getAttribute('data-audience');
                    activeCategory = getFirstActiveCategory(activeAudience);
                    activeSubcategory = '';
                    renderPage();
                });
            });
        }

        function renderSidebar() {
            const sidebar = document.getElementById('catalogSidebarMenu');
            if (!sidebar) return;

            if (audienceState[activeAudience] === false) {
                sidebar.innerHTML = `<div class="catalog-sidebar-group is-disabled"><div class="catalog-sidebar-category is-disabled"><span>${activeAudience}</span><span>Disabled</span></div></div>`;
                return;
            }

            sidebar.innerHTML = getAudienceTaxonomy(activeAudience).map((entry) => `
                <div class="catalog-sidebar-group ${entry.category === activeCategory ? 'active' : ''} ${entry.isActive === false ? 'is-disabled' : ''}">
                    <button type="button" class="catalog-sidebar-category ${entry.isActive === false ? 'is-disabled' : ''}" data-category="${entry.category}" ${entry.isActive === false ? 'disabled' : ''}>
                        <span>${entry.category}</span>
                        <span>${entry.subcategories.filter((subcategoryEntry) => subcategoryEntry.lockedByParent !== true).length}</span>
                    </button>
                    <div class="catalog-sidebar-subcategories">
                        ${entry.subcategories.filter((subcategoryEntry) => subcategoryEntry.lockedByParent !== true).map((subcategoryEntry) => `
                            <button type="button" class="catalog-sidebar-subcategory ${entry.category === activeCategory && subcategoryEntry.subcategory === activeSubcategory ? 'active' : ''} ${subcategoryEntry.isActive === false || entry.isActive === false ? 'is-disabled' : ''}" data-category="${entry.category}" data-subcategory="${subcategoryEntry.subcategory}" ${subcategoryEntry.isActive === false || entry.isActive === false ? 'disabled' : ''}>
                                ${subcategoryEntry.subcategory}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `).join('');

            sidebar.querySelectorAll('[data-category]').forEach((button) => {
                if (button.hasAttribute('data-subcategory')) return;
                button.addEventListener('click', () => {
                    activeCategory = button.getAttribute('data-category');
                    activeSubcategory = '';
                    renderPage();
                });
            });

            sidebar.querySelectorAll('[data-subcategory]').forEach((button) => {
                button.addEventListener('click', () => {
                    activeCategory = button.getAttribute('data-category');
                    activeSubcategory = button.getAttribute('data-subcategory');
                    renderPage();
                });
            });
        }

        function renderSubcategories() {
            const entry = getCurrentCategoryEntry();
            const grid = document.getElementById('catalogSubcategoryGrid');
            const title = document.getElementById('subcategorySectionTitle');
            const viewAll = document.getElementById('viewAllProductsLink');
            if (!entry || !grid || !title || !viewAll) return;

            title.textContent = `${entry.category} subcategories`;
            viewAll.href = `catalog.html?gender=${encodeURIComponent(activeAudience)}&category=${encodeURIComponent(activeCategory)}`;

            grid.innerHTML = entry.subcategories.filter((subcategoryEntry) => subcategoryEntry.lockedByParent !== true).map((subcategoryEntry) => {
                const productCount = categoryProducts().filter((product) => product.subcategory === subcategoryEntry.subcategory).length;
                return `
                    <button type="button" class="catalog-subcategory-card ${subcategoryEntry.subcategory === activeSubcategory ? 'active' : ''} ${subcategoryEntry.isActive === false ? 'is-disabled' : ''}" data-subcategory="${subcategoryEntry.subcategory}" ${subcategoryEntry.isActive === false ? 'disabled' : ''}>
                        <span class="catalog-subcategory-name">${subcategoryEntry.subcategory}</span>
                        <span class="catalog-subcategory-count">${productCount} products</span>
                    </button>
                `;
            }).join('');

            grid.querySelectorAll('[data-subcategory]').forEach((button) => {
                button.addEventListener('click', () => {
                    activeSubcategory = button.getAttribute('data-subcategory');
                    renderPage();
                });
            });
        }

        function renderProducts() {
            const grid = document.getElementById('catalogProductsGrid');
            const sectionTitle = document.getElementById('productsSectionTitle');
            const resultCopy = document.getElementById('catalogResultCopy');
            if (!grid || !sectionTitle || !resultCopy) return;

            const currentProducts = filteredProducts();
            sectionTitle.textContent = activeSubcategory
                ? `${activeCategory} / ${activeSubcategory}`
                : `${activeCategory} Products`;
            resultCopy.textContent = `${currentProducts.length} product${currentProducts.length === 1 ? '' : 's'} found`;

            if (!currentProducts.length) {
                grid.innerHTML = `<p style="text-align:center;color:#888;padding:40px">No products found in this subcategory yet.</p>`;
                return;
            }

            grid.innerHTML = currentProducts.map((product) => {
                const discount = product.original_price
                    ? Math.round((1 - product.price / product.original_price) * 100)
                    : 0;

                return `
                    <article class="product-card">
                        <div class="product-image">
                            <img src="${getImageUrl(product.image_url)}" alt="${product.name}" loading="lazy">
                            ${product.badge ? `<span class="product-badge ${product.badge_class || 'trending'}">${product.badge}</span>` : ''}
                        </div>
                        <div class="product-info">
                            <h3 class="product-name">${product.name}</h3>
                            <div class="product-price">
                                <span class="current">Rs. ${Number(product.price || 0).toLocaleString('en-IN')}</span>
                                ${product.original_price ? `<span class="original">Rs. ${Number(product.original_price).toLocaleString('en-IN')}</span>` : ''}
                                ${discount ? `<span class="discount">${discount}% OFF</span>` : ''}
                            </div>
                            ${product.avg_rating ? `<div class="product-rating"><span class="product-rating-stars">${renderStarsHTML(product.avg_rating)}</span><span class="product-rating-count">(${product.review_count})</span></div>` : ''}
                        </div>
                        <a href="product.html?id=${product.id}" class="btn btn-primary product-atc-btn" style="margin:12px;width:calc(100% - 24px);text-align:center;">View Product</a>
                    </article>
                `;
            }).join('');
        }

        function renderHeaderCopy() {
            const title = document.getElementById('catalogTitle');
            const breadcrumb = document.getElementById('catalogBreadcrumbLabel');
            const description = document.getElementById('catalogDescription');
            const audienceLabel = document.getElementById('catalogAudienceLabel');
            if (!title || !breadcrumb || !description || !audienceLabel) return;

            audienceLabel.textContent = activeAudience;
            title.textContent = activeSubcategory
                ? `${activeCategory} / ${activeSubcategory}`
                : activeCategory;
            breadcrumb.textContent = activeSubcategory
                ? `${activeCategory} / ${activeSubcategory}`
                : activeCategory;
            description.textContent = activeSubcategory
                ? `Browsing ${activeSubcategory} products inside ${activeCategory} for ${activeAudience}.`
                : `Choose a subcategory from ${activeCategory} and continue into products with the left-side navigation.`;
        }

        function renderPage() {
            if (!activeCategory) {
                activeCategory = getFirstActiveCategory(activeAudience);
            }
            updateUrl();
            renderAudienceSwitch();
            renderSidebar();
            renderHeaderCopy();
            renderSubcategories();
            renderProducts();
        }

        renderPage();
    } catch (error) {
        console.error('Catalog browser failed:', error);
        const grid = document.getElementById('catalogProductsGrid');
        if (grid) {
            grid.innerHTML = `<p style="text-align:center;color:#c0392b;padding:40px">Could not load catalog products.</p>`;
        }
    }
});

