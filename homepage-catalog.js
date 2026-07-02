const HOMEPAGE_API_BASE = window.__API_BASE || (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
        ? 'http://localhost:5000'
        : window.location.origin
);
const homepageFetchJson = window.__fetchJsonWithApiFallback
    ? (path, options) => window.__fetchJsonWithApiFallback(path, options)
    : async (path, options) => {
        const url = `${HOMEPAGE_API_BASE}${String(path).startsWith('/') ? path : `/${path}`}`;
        const response = await fetch(url, options);
        return {
            base: HOMEPAGE_API_BASE,
            url,
            response,
            data: await response.json()
        };
    };

document.addEventListener('DOMContentLoaded', async () => {
    const productsGrid = document.getElementById('productsGrid');
    const categoriesGrid = document.getElementById('collectionsGrid');
    const audienceSwitch = document.getElementById('categoryAudienceSwitch');
    if (!productsGrid || !categoriesGrid) return;

    const formatPrice = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;
    const getImageUrl = (url) => {
        if (!url) return 'https://via.placeholder.com/600x800?text=Category';

        const raw = typeof url === 'object' && url?.url ? String(url.url).trim() : String(url).trim();
        if (!raw) return 'https://via.placeholder.com/600x800?text=Category';
        if (/^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^image\/svg\+xml/i.test(raw)) return `data:${raw}`;
        if (/^svg\+xml/i.test(raw)) return `data:image/${raw}`;
        return raw.startsWith('/') ? `${HOMEPAGE_API_BASE}${raw}` : `${HOMEPAGE_API_BASE}/${raw}`;
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

    function normalizeAudience(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (['women', 'woman', 'female', 'ladies', 'lady'].includes(normalized)) return 'Women';
        if (['men', 'man', 'male', 'gents', 'gentlemen'].includes(normalized)) return 'Men';
        if (['kids', 'kid', 'children', 'child', 'boys', 'girls'].includes(normalized)) return 'Kids';
        if (['unisex', 'all', 'all genders', 'everyone'].includes(normalized)) return 'Unisex';
        if (!normalized) return 'Unspecified';
        return String(value).trim();
    }

    function getAudienceSummary(products, taxonomy, audience) {
        const audienceProducts = products.filter((product) => normalizeAudience(product.ideal_for) === audience);
        const audienceTaxonomy = Array.isArray(taxonomy[audience]) ? taxonomy[audience] : [];

        return audienceTaxonomy.map((entry) => {
            const categoryProducts = audienceProducts.filter((product) => product.category === entry.category);
            const activeSubcategories = entry.subcategories.filter((subcategoryEntry) =>
                subcategoryEntry.isActive !== false &&
                categoryProducts.some((product) => product.subcategory === subcategoryEntry.subcategory)
            );

            return {
                ...entry,
                audience,
                productCount: categoryProducts.length,
                subcategoryCount: activeSubcategories.length,
                imageUrl: getImageUrl(categoryProducts[0]?.image_url)
            };
        }).filter((entry) => entry.isActive !== false && entry.productCount > 0);
    }

    try {
        const [productsResult, taxonomyResult] = await Promise.allSettled([
            homepageFetchJson('/api/products'),
            homepageFetchJson('/api/products/taxonomy')
        ]);
        
        const data = productsResult.status === 'fulfilled' ? productsResult.value.data : { success: false };
        const taxonomyData = taxonomyResult.status === 'fulfilled' ? taxonomyResult.value.data : { success: false };
        
        const products = data && data.success ? (data.products || []) : [];
        const taxonomy = taxonomyData && taxonomyData.success ? (taxonomyData.taxonomy || {}) : {};
        const audienceState = Object.fromEntries(Object.entries(taxonomyData.structuredTaxonomy || {}).map(([audience, entry]) => [audience, entry?.isActive !== false]));
        const audiences = Object.keys(taxonomy).filter((audience) => audienceState[audience] !== false);
        let activeAudience = audiences.includes('Men') ? 'Men' : audiences[0];
        const bestSellers = [...products]
            .filter((product) => product.listing_status === 'Active')
            .filter((product) => !!product.badge)
            .sort((left, right) => {
                const leftRank = String(left.badge || '').toLowerCase() === 'bestseller' ? 3 : left.badge ? 1 : 0;
                const rightRank = String(right.badge || '').toLowerCase() === 'bestseller' ? 3 : right.badge ? 1 : 0;
                if (rightRank !== leftRank) return rightRank - leftRank;
                const leftDisplayOrder = Number(left.display_order || 0);
                const rightDisplayOrder = Number(right.display_order || 0);
                if (leftDisplayOrder !== rightDisplayOrder) return leftDisplayOrder - rightDisplayOrder;
                return Number(right.stock || 0) - Number(left.stock || 0);
            })
            .slice(0, 8);

        if (!bestSellers.length) {
            productsGrid.innerHTML = `<p style="text-align:center;color:#888;padding:40px">No best sellers available right now.</p>`;
        } else {
            productsGrid.innerHTML = bestSellers.map((product, index) => {
                const discount = product.original_price
                    ? Math.round((1 - product.price / product.original_price) * 100)
                    : 0;

                return `
                    <article class="product-card ${index === 0 ? 'best-seller-featured' : ''}" data-product-id="${product.id}" role="link" tabindex="0">
                        <div class="product-image">
                            <img src="${getImageUrl(product.image_url)}" alt="${product.name}" loading="lazy">
                            <span class="product-badge ${product.badge_class || 'trending'}">${product.badge || 'Best Seller'}</span>
                        </div>
                        <div class="product-info">
                            <h3 class="product-name">${product.name}</h3>
                            <div class="product-price">
                                <span class="current">${formatPrice(product.price)}</span>
                                ${product.original_price ? `<span class="original">${formatPrice(product.original_price)}</span>` : ''}
                                ${discount ? `<span class="discount">${discount}% OFF</span>` : ''}
                            </div>
                            ${product.avg_rating ? `<div class="product-rating"><span class="product-rating-stars">${renderStarsHTML(product.avg_rating)}</span><span class="product-rating-count">(${product.review_count})</span></div>` : ''}
                        </div>
                        <a href="product.html?id=${product.id}" class="btn btn-primary product-atc-btn" style="margin:12px;width:calc(100% - 24px);text-align:center;">View Product</a>
                    </article>
                `;
            }).join('');
        }

        function renderAudienceSwitch() {
            if (!audienceSwitch) return;

            if (!audiences.length) {
                audienceSwitch.innerHTML = '';
                audienceSwitch.style.display = 'none';
                return;
            }

            audienceSwitch.style.display = '';
            audienceSwitch.innerHTML = audiences.map((audience) => `
                <button type="button" class="collection-switch-chip ${audience === activeAudience ? 'active' : ''}" data-audience="${audience}">
                    <span class="collection-switch-copy">
                        <strong>${audience}</strong>
                        <small>${getAudienceSummary(products, taxonomy, audience).length} categories</small>
                    </span>
                </button>
            `).join('');

            audienceSwitch.querySelectorAll('[data-audience]').forEach((button) => {
                button.addEventListener('click', () => {
                    activeAudience = button.getAttribute('data-audience');
                    renderAudienceSwitch();
                    renderCategories();
                });
            });
        }

        function renderCategories() {
            const categories = getAudienceSummary(products, taxonomy, activeAudience);
            if (!categories.length) {
                categoriesGrid.innerHTML = `<p style="text-align:center;color:#888;padding:40px">No categories available right now.</p>`;
                return;
            }

            categoriesGrid.innerHTML = categories.map((entry) => `
                <article class="collection-card category-card" data-category="${entry.category}" data-audience="${entry.audience}">
                    <img src="${entry.imageUrl}" alt="${entry.category}" loading="lazy">
                    <div class="collection-overlay">
                        <span class="collection-label">${entry.audience}</span>
                        <h3 class="collection-name">${entry.category}</h3>
                        <p class="category-card-meta">${entry.subcategoryCount} subcategories - ${entry.productCount} products</p>
                        <a href="catalog.html?gender=${encodeURIComponent(entry.audience)}&category=${encodeURIComponent(entry.category)}" class="collection-link">
                            Explore
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </a>
                    </div>
                </article>
            `).join('');

            categoriesGrid.querySelectorAll('.category-card').forEach((card) => {
                card.addEventListener('click', () => {
                    const audience = card.getAttribute('data-audience');
                    const category = card.getAttribute('data-category');
                    window.location.href = `catalog.html?gender=${encodeURIComponent(audience)}&category=${encodeURIComponent(category)}`;
                });
            });
        }

        renderAudienceSwitch();
        renderCategories();

        const openProductDetails = (productId) => {
            if (!productId) return;
            window.location.href = `product.html?id=${encodeURIComponent(productId)}`;
        };

        productsGrid.querySelectorAll('.product-card').forEach((card) => {
            const productId = card.getAttribute('data-product-id');

            card.addEventListener('click', (event) => {
                if (event.target.closest('.product-atc-btn')) return;
                openProductDetails(productId);
            });

            card.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                if (event.target.closest('.product-atc-btn')) return;
                event.preventDefault();
                openProductDetails(productId);
            });
        });
    } catch (error) {
        console.error('Homepage category flow failed:', error);
        productsGrid.innerHTML = `<p style="text-align:center;color:#c0392b;padding:40px">Could not load best sellers.</p>`;
        categoriesGrid.innerHTML = `<p style="text-align:center;color:#c0392b;padding:40px">Could not load categories. Check API base configuration.</p>`;
    }
});
