/* ========================================
   DEVASTHRA â€” Product Detail Page
   Dynamic API Version
   ======================================== */

const API_BASE = window.__API_BASE || (
    window.location.protocol === 'file:' 
        ? 'http://localhost:5000'  // file:// protocol â†’ use full localhost URL
        : window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:5000'  // localhost â†’ use full URL
            : window.location.origin    // production â†’ use origin
);

document.addEventListener('DOMContentLoaded', async () => {

    // â”€â”€ Auth Helpers â”€â”€
    const getToken = () => localStorage.getItem('DEVASTHRA_token');
    const getUser = () => { try { return JSON.parse(localStorage.getItem('DEVASTHRA_user')); } catch { return null; } };
    const isLoggedIn = () => !!getToken();
    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const cleanHighlightText = (value) => String(value || '')
        .replace(/^(?:\uFEFF|\u00A0|\s|•|·|â€¢|Ã¢â‚¬Â¢)+/u, '')
        .trim();

    // â”€â”€ Toast â”€â”€
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    let toastTimeout;
    function showToast(msg, type = 'info') {
        clearTimeout(toastTimeout);
        toastMessage.textContent = msg;
        toast.className = `toast show ${type}`;
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 3500);
    }
    const sizeGuideBtn = document.getElementById('pdpSizeGuideBtn');
    const sizeGuideOverlay = document.getElementById('sizeGuideOverlay');
    const sizeGuideClose = document.getElementById('sizeGuideClose');
    const sizeGuideTitleEl = document.getElementById('sizeGuideTitle');
    const sizeGuideModalBody = document.querySelector('.size-guide-modal-body');
    const subcategorySizeGuideSection = document.getElementById('pdpSubcategorySizeGuideSection');
    const subcategorySizeGuideTitle = document.getElementById('pdpSubcategorySizeGuideTitle');
    const subcategorySizeGuideNote = document.getElementById('pdpSubcategorySizeGuideNote');
    const subcategorySizeGuideTableWrap = document.getElementById('pdpSubcategorySizeGuideTableWrap');
    let currentSizeGuide = null;
    const GENERIC_SIZE_GUIDE = {
        title: 'Size Guide',
        note: 'Use this guide to compare standard measurements before choosing your size.',
        columns: ['Size', 'Chest (in)', 'Chest (cm)', 'Waist (in)', 'Waist (cm)'],
        rows: [
            ['S', '36-38', '91-97', '30-32', '76-81'],
            ['M', '38-40', '97-102', '32-34', '81-86'],
            ['L', '40-42', '102-107', '34-36', '86-91'],
            ['XL', '42-44', '107-112', '36-38', '91-97']
        ]
    };
    const SPECIAL_TSHIRT_GUIDE = {
        title: 'T-Shirt Size Guide',
        layout: 'comparison',
        note: 'Use this chart when comparing oversized and regular tee measurements.',
        groupHeaders: ['t shirt types', 'oversized tee', 'regular tee', 'oversized tee', 'regular tee', 'oversized tee', 'regular tee', 'oversized tee', 'regular tee'],
        columns: ['Size', 'Chest (in)', 'Chest (in)', 'Sleeve Length', 'Sleeve Length', 'Length (in)', 'Length (in)', 'Shoulder (in)', 'Shoulder (in)'],
        rows: [
            ['S', '41', '38', '8.5', '7.5', '27', '26', '23.5', '17'],
            ['M', '43', '40', '9.5', '8', '28', '27', '24.5', '18'],
            ['L', '45', '42', '10.5', '8', '29', '28', '25.5', '19'],
            ['XL', '47', '44', '11.5', '8.5', '30', '29', '26.5', '20'],
            ['XXL', '49', '46', '12.5', '9', '31', '30', '27.5', '21']
        ]
    };

    function normalizeSizeGuide(guide) {
        if (!guide || typeof guide !== 'object') return null;

        const columns = Array.isArray(guide.columns)
            ? guide.columns.map((column) => String(column || '').trim()).filter(Boolean)
            : [];
        const rows = Array.isArray(guide.rows)
            ? guide.rows.map((row) => {
                if (Array.isArray(row)) {
                    return row.map((cell) => String(cell ?? '').trim());
                }
                if (row && typeof row === 'object' && Array.isArray(row.values)) {
                    return [String(row.label || row.size || row.name || '').trim(), ...row.values.map((cell) => String(cell ?? '').trim())];
                }
                return [];
            }).filter((row) => row.length)
            : [];

        if (!columns.length || !rows.length) return null;

        return {
            title: String(guide.title || 'Size Guide').trim() || 'Size Guide',
            note: String(guide.note || guide.description || '').trim(),
            layout: String(guide.layout || guide.template || '').trim().toLowerCase(),
            groupHeaders: Array.isArray(guide.groupHeaders)
                ? guide.groupHeaders.map((header) => String(header || '').trim())
                : [],
            columns,
            rows
        };
    }

    function renderSizeGuideBodyMarkup(guide) {
        const normalized = normalizeSizeGuide(guide);
        if (!normalized) return '';

        if (normalized.layout === 'comparison') {
            const groupHeaders = normalized.groupHeaders.length === normalized.columns.length
                ? normalized.groupHeaders
                : normalized.columns.map(() => '');
            const bodyRows = normalized.rows.map((row) => `
                <tr>
                    ${normalized.columns.map((_, index) => `<td>${escapeHtml(row[index] || '')}</td>`).join('')}
                </tr>
            `).join('');

            return `
                <div class="size-guide-table-wrap">
                    <table class="size-guide-table">
                        <thead>
                            <tr>${groupHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
                            <tr>${normalized.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
                        </thead>
                        <tbody>${bodyRows}</tbody>
                    </table>
                </div>
                ${normalized.note ? `<div class="track-empty-note" style="margin-top:16px;">${escapeHtml(normalized.note)}</div>` : ''}
            `;
        }

        const bodyRows = normalized.rows.map((row) => `
            <tr>
                ${normalized.columns.map((_, index) => `<td>${escapeHtml(row[index] || '')}</td>`).join('')}
            </tr>
        `).join('');

        return `
            <div class="size-guide-table-wrap">
                <table class="size-guide-table">
                    <thead>
                        <tr>${normalized.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
            ${normalized.note ? `<div class="track-empty-note" style="margin-top:16px;">${escapeHtml(normalized.note)}</div>` : ''}
        `;
    }

    function matchesSpecialTshirtGuide(productData = {}) {
        const haystack = [
            productData.subcategory,
            productData.category,
            productData.fashion_group
        ]
            .map((value) => String(value || '').toLowerCase())
            .join(' ');

        return /polo|oversized|regular\s*tee|t[-\s]?shirt|tee/.test(haystack);
    }

    function applySizeGuideToPage(guide) {
        currentSizeGuide = normalizeSizeGuide(guide);

        if (subcategorySizeGuideSection && subcategorySizeGuideTitle && subcategorySizeGuideNote && subcategorySizeGuideTableWrap) {
            subcategorySizeGuideSection.style.display = 'none';
            subcategorySizeGuideTitle.textContent = 'Size Guide for This Subcategory';
            subcategorySizeGuideNote.textContent = '';
            subcategorySizeGuideTableWrap.innerHTML = '';
        }
    }

    function openSizeGuide() {
        const guideToRender = currentSizeGuide || GENERIC_SIZE_GUIDE;
        if (sizeGuideModalBody) {
            sizeGuideModalBody.innerHTML = renderSizeGuideBodyMarkup(guideToRender);
        }
        if (sizeGuideTitleEl) {
            sizeGuideTitleEl.textContent = guideToRender.title || 'Size Guide';
        }
        sizeGuideOverlay?.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeSizeGuide() {
        sizeGuideOverlay?.classList.remove('open');
        document.body.style.overflow = '';
    }
    sizeGuideBtn?.addEventListener('click', openSizeGuide);
    sizeGuideClose?.addEventListener('click', closeSizeGuide);
    sizeGuideOverlay?.addEventListener('click', (event) => {
        if (event.target === sizeGuideOverlay) closeSizeGuide();
    });

    // â”€â”€ Parse product ID from URL â”€â”€
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        document.querySelector('.pdp-page').innerHTML = notFoundHTML();
        return;
    }

    // â”€â”€ Fetch Product â”€â”€
    let product;
    let relatedProducts = [];
    let parentProduct = null;
    let collectionProducts = [];
    try {
        const res = await fetch(`${API_BASE}/products/${productId}`);
        const data = await res.json();
        if (!data.success) throw new Error('Not found');
        product = data.product;
        collectionProducts = data.collectionProducts || [];
        relatedProducts = (data.relatedProducts || collectionProducts || []).filter((item) => Number(item.id) !== Number(productId));
        parentProduct = data.parentProduct || null;
    } catch {
        document.querySelector('.pdp-page').innerHTML = notFoundHTML();
        return;
    }

    function notFoundHTML() {
        return `<div style="text-align:center;padding:120px 24px;min-height:60vh">
            <h2 style="font-family:var(--font-heading);font-size:2rem;margin-bottom:16px">Product Not Found</h2>
            <p style="color:var(--color-dark-gray);margin-bottom:32px">The product you're looking for doesn't exist.</p>
            <a href="index.html#categories" class="btn btn-primary">Back to Categories</a>
        </div>`;
    }

    // â”€â”€ Populate Page â”€â”€
    document.title = `${product.name} — DEVASTHRA`;
    document.getElementById('breadcrumbName').textContent = product.name;
    document.getElementById('pdpName').textContent = product.name;
    const pdpDesc = document.getElementById('pdpDesc');
    const pdpDescInline = document.getElementById('pdpDescInline');
    const pdpDescToggle = document.getElementById('pdpDescToggle');
    if (pdpDesc) {
        pdpDesc.textContent = product.description || '';
    }
    if (pdpDesc && pdpDescToggle && pdpDescInline) {
        const fullDescription = (pdpDesc.textContent || '').trim();
        let isExpanded = false;

        const buildCollapsedPreview = () => {
            const width = pdpDescInline.clientWidth || window.innerWidth || 0;
            let maxChars = 190;

            if (width <= 360) maxChars = 90;
            else if (width <= 420) maxChars = 105;
            else if (width <= 540) maxChars = 125;
            else if (width <= 680) maxChars = 150;

            if (fullDescription.length <= maxChars) {
                return { needsToggle: false, text: fullDescription };
            }

            const raw = fullDescription.slice(0, maxChars);
            const cutAt = raw.lastIndexOf(' ');
            const safeCut = cutAt > Math.floor(maxChars * 0.55) ? raw.slice(0, cutAt) : raw;

            return {
                needsToggle: true,
                text: `${safeCut.trim()}...`
            };
        };

        const syncDescriptionToggle = () => {
            if (!fullDescription) {
                pdpDesc.textContent = '';
                pdpDesc.classList.remove('is-collapsed');
                pdpDescInline.classList.remove('is-collapsed');
                pdpDescToggle.hidden = true;
                return;
            }

            const preview = buildCollapsedPreview();
            if (isExpanded || !preview.needsToggle) {
                pdpDesc.textContent = fullDescription;
                pdpDesc.classList.remove('is-collapsed');
                pdpDescInline.classList.remove('is-collapsed');
                pdpDescToggle.hidden = !preview.needsToggle;
                pdpDescToggle.textContent = preview.needsToggle ? 'See less' : 'See more';
                return;
            }

            pdpDesc.textContent = preview.text;
            pdpDescInline.classList.add('is-collapsed');
            pdpDesc.classList.add('is-collapsed');
            pdpDescToggle.hidden = false;
            pdpDescToggle.textContent = 'See more';
        };

        pdpDescToggle.addEventListener('click', () => {
            if (pdpDescToggle.hidden) return;
            isExpanded = !isExpanded;
            syncDescriptionToggle();
        });

        requestAnimationFrame(syncDescriptionToggle);
        window.addEventListener('resize', syncDescriptionToggle);
    }
    const colorsSection = document.getElementById('pdpColorsSection');
    const colorsEl = document.getElementById('pdpColors');
    const productColors = Array.isArray(product.color)
        ? product.color
        : (typeof product.color === 'string' && product.color.trim() ? [product.color] : []);

    if (colorsSection && colorsEl) {
        if (productColors.length) {
            colorsSection.style.display = 'block';
            colorsEl.innerHTML = productColors.map((color) => `<span class="pdp-color-chip">${color}</span>`).join('');
        } else {
            colorsSection.style.display = 'none';
            colorsEl.innerHTML = '';
        }
    }

    const specialTshirtGuide = matchesSpecialTshirtGuide(product) ? SPECIAL_TSHIRT_GUIDE : null;
    applySizeGuideToPage(specialTshirtGuide || product.size_guide || null);

    // â”€â”€ Dynamic Return Policy â”€â”€
    const deliveryItems = document.querySelectorAll('.pdp-delivery-item');
    if (deliveryItems.length >= 2) {
        const returnItem = deliveryItems[1];
        if (product.is_returnable) {
            returnItem.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0" />
                    <path d="m9 12 2 2 4-4" />
                </svg>
                <span><strong>${product.return_window_days || 7} Days</strong> Easy Return & Exchange</span>`;
        } else {
            returnItem.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <span style="color:var(--color-dark-gray)"><strong>Non-Returnable</strong> for this category</span>`;
        }
    }

    // Badge
    const badge = document.getElementById('pdpBadge');
    if (product.badge) {
        badge.textContent = product.badge;
        badge.className = `pdp-badge ${product.badge_class}`;
    } else { badge.style.display = 'none'; }

    // Price
    const discount = product.original_price
        ? Math.round((1 - product.price / product.original_price) * 100) : 0;
    const fmt = p => '₹' + p.toLocaleString('en-IN');
    const getImageUrl = (url) => {
        if (!url) return 'https://via.placeholder.com/300?text=No+Image';

        const raw = typeof url === 'object' && url?.url ? String(url.url).trim() : String(url).trim();
        if (!raw) return 'https://via.placeholder.com/300?text=No+Image';
        if (/^data:/i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
        if (/^image\/svg\+xml/i.test(raw)) return `data:${raw}`;
        if (/^svg\+xml/i.test(raw)) return `data:image/${raw}`;
        return raw.startsWith('/') ? `${API_BASE}${raw}` : `${API_BASE}/${raw}`;
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
    const pdpMetaRatingEl = document.getElementById('pdpMetaRating');
    const pdpReviewsSection = document.getElementById('pdpReviewsSection');
    const pdpReviewsTitle = document.getElementById('pdpReviewsTitle');
    const pdpReviewsSummary = document.getElementById('pdpReviewsSummary');
    const pdpReviewsSort = document.getElementById('pdpReviewsSort');
    const pdpReviewSortSelect = document.getElementById('pdpReviewSortSelect');
    const pdpReviewsList = document.getElementById('pdpReviewsList');
    const pdpReviewsLoadMore = document.getElementById('pdpReviewsLoadMore');
    const reviewDebugEnabled = /[?&]debugReviews=1\b/.test(window.location.search) || !!window.__DEVASTHRA_DEBUG_REVIEWS;
    const reviewState = {
        page: 1,
        limit: 5,
        totalPages: 1,
        sort: 'newest',
        total: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        reviews: []
    };

    function setReviewsSectionVisible() {
        if (pdpReviewsSection) {
            pdpReviewsSection.style.display = 'block';
        }
    }

    function renderReviewsShell({ title = 'Customer Reviews', message = '', tone = 'info' } = {}) {
        if (pdpReviewsTitle) pdpReviewsTitle.textContent = title;
        if (pdpReviewsSummary) {
            pdpReviewsSummary.innerHTML = message
                ? `<div class="pdp-reviews-state pdp-reviews-state-${tone}">${escapeHtml(message)}</div>`
                : '';
        }
        if (pdpReviewsSort) pdpReviewsSort.style.display = 'none';
        if (pdpReviewsList) {
            pdpReviewsList.innerHTML = '';
        }
        if (pdpReviewsLoadMore) pdpReviewsLoadMore.style.display = 'none';
        setReviewsSectionVisible();
    }

    function renderReviewsNotice(message, tone = 'error') {
        if (pdpReviewsList) {
            pdpReviewsList.innerHTML = `<div class="pdp-reviews-state pdp-reviews-state-${tone}">${escapeHtml(message)}</div>`;
        }
        if (pdpReviewsSort) pdpReviewsSort.style.display = 'none';
        if (pdpReviewsLoadMore) pdpReviewsLoadMore.style.display = 'none';
        setReviewsSectionVisible();
    }

    async function refreshReviewsFromSignal(signalProductId) {
        if (!product?.id) return;
        const normalizedSignal = Number(signalProductId);
        if (Number.isFinite(normalizedSignal) && normalizedSignal !== Number(product.id)) return;
        reviewState.reviews = [];
        reviewState.page = 1;
        await loadProductReviews({ page: 1, sort: reviewState.sort, append: false });
    }

    window.addEventListener('DEVASTHRA_REVIEWS_UPDATED', (event) => {
        refreshReviewsFromSignal(event?.detail?.productId).catch(() => {});
    });

    window.addEventListener('storage', (event) => {
        if (event.key !== 'DEVASTHRA_reviews_refresh' || !event.newValue) return;
        try {
            const payload = JSON.parse(event.newValue);
            refreshReviewsFromSignal(payload?.productId).catch(() => {});
        } catch {
            refreshReviewsFromSignal(null).catch(() => {});
        }
    });

    function renderRatingBadge(avgRating, reviewCount) {
        const count = Number(reviewCount) || 0;
        const avg = Number(avgRating) || 0;
        if (!avg && !count) return '';
        return `
            <div class="product-rating" style="margin-top:10px;">
                <span class="product-rating-stars">${renderStarsHTML(avg)}</span>
                <span class="product-rating-count">${avg ? avg.toFixed(1) : '0.0'} ${count ? `(${count})` : '(No reviews yet)'}</span>
            </div>
        `;
    }

    function renderRatingSummary(summary) {
        const total = Number(summary?.total_reviews) || 0;
        const avg = Number(summary?.avg_rating) || 0;
        const distribution = summary?.distribution || {};
        if (!pdpReviewsSummary) return;

        if (!total) {
            pdpReviewsSummary.innerHTML = `
                <div class="pdp-reviews-summary">
                    <div class="pdp-reviews-avg">
                        <div class="pdp-reviews-avg-number">${avg ? avg.toFixed(1) : '0.0'}</div>
                        <div class="pdp-reviews-avg-stars">${renderStarsHTML(avg)}</div>
                        <div class="pdp-reviews-total">${avg ? 'Product rating' : 'No reviews yet'}</div>
                    </div>
                    <div class="pdp-reviews-distribution">
                        <div class="pdp-dist-row"><span class="pdp-dist-label">5</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:0%;"></div></div><span class="pdp-dist-count">0</span></div>
                        <div class="pdp-dist-row"><span class="pdp-dist-label">4</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:0%;"></div></div><span class="pdp-dist-count">0</span></div>
                        <div class="pdp-dist-row"><span class="pdp-dist-label">3</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:0%;"></div></div><span class="pdp-dist-count">0</span></div>
                        <div class="pdp-dist-row"><span class="pdp-dist-label">2</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:0%;"></div></div><span class="pdp-dist-count">0</span></div>
                        <div class="pdp-dist-row"><span class="pdp-dist-label">1</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:0%;"></div></div><span class="pdp-dist-count">0</span></div>
                    </div>
                </div>
            `;
            return;
        }

        const rows = [5, 4, 3, 2, 1].map((rating) => {
            const count = Number(distribution[rating]) || 0;
            const percent = total ? Math.round((count / total) * 100) : 0;
            return `<div class="pdp-dist-row"><span class="pdp-dist-label">${rating}</span><div class="pdp-dist-bar"><div class="pdp-dist-bar-fill" style="width:${percent}%;"></div></div><span class="pdp-dist-count">${count}</span></div>`;
        }).join('');

        pdpReviewsSummary.innerHTML = `
            <div class="pdp-reviews-summary">
                <div class="pdp-reviews-avg">
                    <div class="pdp-reviews-avg-number">${avg.toFixed(1)}</div>
                    <div class="pdp-reviews-avg-stars">${renderStarsHTML(avg)}</div>
                    <div class="pdp-reviews-total">${total} verified review${total === 1 ? '' : 's'}</div>
                </div>
                <div class="pdp-reviews-distribution">${rows}</div>
            </div>
        `;
    }

    function renderReviewCards(reviews) {
        if (!pdpReviewsList) return;
        if (!reviews.length) {
            pdpReviewsList.innerHTML = `
                <div class="pdp-reviews-empty">
                    <div class="pdp-reviews-empty-icon">★</div>
                    <h3>No reviews yet</h3>
                    <p>Be the first to share your experience with this product.</p>
                </div>
            `;
            return;
        }

        pdpReviewsList.innerHTML = reviews.map((review) => `
            <article class="pdp-review-card">
                <div class="pdp-review-header">
                    <div class="pdp-review-author">
                        <div class="pdp-review-avatar">${escapeHtml((review.reviewer_name || 'U').trim().charAt(0).toUpperCase() || 'U')}</div>
                        <div>
                            <div class="pdp-review-name">${escapeHtml(review.reviewer_name || 'Verified Buyer')}</div>
                            <div class="pdp-review-date">${escapeHtml(new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
                        </div>
                    </div>
                    <div class="pdp-review-stars">${renderStarsHTML(review.rating)}</div>
                </div>
                ${review.title ? `<h4 class="pdp-review-title">${escapeHtml(review.title)}</h4>` : ''}
                ${review.review_text ? `<p class="pdp-review-text">${escapeHtml(review.review_text)}</p>` : ''}
                <div class="pdp-review-verified">Verified purchase</div>
            </article>
        `).join('');
    }

    async function loadProductReviews({ page = 1, sort = reviewState.sort, append = false } = {}) {
        if (!product?.id) return;
        const resolvedSort = sort === 'highest' ? 'rating_desc' : sort === 'lowest' ? 'rating_asc' : sort;
        reviewState.sort = resolvedSort;
        reviewState.page = page;

        if (!append) {
            renderReviewsShell({
                title: 'Customer Reviews',
                message: 'Loading customer reviews...',
                tone: 'loading'
            });
        } else {
            setReviewsSectionVisible();
        }

        try {
            const [summaryRes, reviewsRes] = await Promise.all([
                fetch(`${API_BASE}/api/reviews/products/${product.id}/rating-summary`),
                fetch(`${API_BASE}/api/reviews/products/${product.id}/reviews?page=${page}&limit=${reviewState.limit}&sort=${resolvedSort}`)
            ]);
            if (reviewDebugEnabled) {
                console.debug('[PDP reviews] response metadata', {
                    productId: product.id,
                    summary: {
                        url: summaryRes.url,
                        status: summaryRes.status,
                        ok: summaryRes.ok,
                        contentType: summaryRes.headers.get('content-type')
                    },
                    reviews: {
                        url: reviewsRes.url,
                        status: reviewsRes.status,
                        ok: reviewsRes.ok,
                        contentType: reviewsRes.headers.get('content-type')
                    }
                });
            }
            const [summaryData, reviewsData] = await Promise.all([summaryRes.json(), reviewsRes.json()]);

            if (summaryData.success) {
                reviewState.total = Number(summaryData.total_reviews) || 0;
                reviewState.distribution = summaryData.distribution || reviewState.distribution;
                renderRatingSummary(summaryData);
            } else {
                renderRatingSummary({
                    total_reviews: product.review_count || 0,
                    avg_rating: product.avg_rating || 0,
                    distribution: reviewState.distribution
                });
            }

            if (reviewsData.success) {
                const nextReviews = reviewsData.reviews || [];
                reviewState.totalPages = Number(reviewsData.pagination?.totalPages) || 1;
                reviewState.total = Number(summaryData.total_reviews || reviewsData.pagination?.totalItems || nextReviews.length) || 0;
                if (append) {
                    reviewState.reviews = reviewState.reviews.concat(nextReviews);
                } else {
                    reviewState.reviews = nextReviews;
                }
                renderReviewCards(reviewState.reviews);
                if (pdpReviewsLoadMore) {
                    pdpReviewsLoadMore.style.display = reviewState.page < reviewState.totalPages ? 'inline-flex' : 'none';
                }
                if (pdpReviewsSort) {
                    pdpReviewsSort.style.display = reviewState.total > 0 ? 'flex' : 'none';
                }
                if (reviewState.total === 0 && reviewState.reviews.length === 0) {
                    renderReviewsNotice('No reviews yet. This product has not received customer feedback.', 'empty');
                }
                setReviewsSectionVisible();
            } else if (!append && reviewState.reviews.length === 0) {
                renderReviewsNotice('Reviews are temporarily unavailable. Please check back in a moment.', 'error');
            }

            if (pdpMetaRatingEl) {
                const hasReviewRows = Number(summaryData.total_reviews || 0) > 0;
                const inlineAvg = Number(hasReviewRows ? summaryData.avg_rating : product.avg_rating || 0);
                const inlineCount = Number(hasReviewRows ? summaryData.total_reviews : product.review_count || 0);
                pdpMetaRatingEl.innerHTML = renderRatingBadge(inlineAvg, inlineCount);
                pdpMetaRatingEl.style.display = inlineAvg || inlineCount ? 'block' : 'none';
            }

            if (reviewDebugEnabled) {
                console.debug('[PDP reviews]', {
                    productId: product.id,
                    summary: summaryData,
                    reviews: reviewsData
                });
            }
        } catch {
            if (reviewDebugEnabled) {
                console.debug('[PDP reviews] request failed before render fallback', {
                    productId: product.id,
                    page,
                    sort: resolvedSort
                });
            }
            if (pdpReviewsSummary) {
                renderRatingSummary({
                    total_reviews: product.review_count || 0,
                    avg_rating: product.avg_rating || 0,
                    distribution: reviewState.distribution
                });
            }
            if (pdpMetaRatingEl) {
                const inlineAvg = Number(product.avg_rating || 0);
                const inlineCount = Number(product.review_count || 0);
                pdpMetaRatingEl.innerHTML = renderRatingBadge(inlineAvg, inlineCount);
                pdpMetaRatingEl.style.display = inlineAvg || inlineCount ? 'block' : 'none';
            }
            renderReviewsNotice('We could not load reviews right now. The product is still available above.', 'error');
            if (reviewDebugEnabled) {
                console.debug('[PDP reviews] load failed for product', product.id);
            }
        }
    }
    let priceHTML = `<span class="current">${fmt(product.price)}</span>`;
    if (product.original_price) {
        priceHTML += ` <span class="original">${fmt(product.original_price)}</span>`;
        priceHTML += ` <span class="discount">${discount}% OFF</span>`;
    }
    document.getElementById('pdpPrice').innerHTML = priceHTML;
    if (pdpMetaRatingEl) {
        const initialAvg = Number(product.avg_rating || 0);
        const initialCount = Number(product.review_count || 0);
        pdpMetaRatingEl.innerHTML = renderRatingBadge(initialAvg, initialCount);
        pdpMetaRatingEl.style.display = initialAvg || initialCount ? 'block' : 'none';
    }

    if (window.firePixelViewContent) {
        window.firePixelViewContent({
            product_id: product.id,
            sku: `SKU-${product.id}`,
            name: product.name,
            category: product.category,
            price: product.price
        });
    }

    const relatedNav = document.getElementById('relatedProductsNav');
    const relatedSection = document.getElementById('relatedProductsSection');
    const relatedGrid = document.getElementById('relatedProductsGrid');

    function renderCategoryNav() {
        const currentGroup = product.is_main_product ? product : parentProduct;
        if (!currentGroup || !relatedNav) return;
        relatedNav.style.display = 'block';
        relatedNav.innerHTML = `
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <a href="product.html?id=${currentGroup.id}" class="btn btn-outline" style="text-decoration:none;">${currentGroup.name}</a>
                ${relatedProducts.slice(0, 6).map(item => `<a href="product.html?id=${item.id}" class="btn btn-outline" style="text-decoration:none;">${item.name}</a>`).join('')}
            </div>
        `;
    }

    function renderRelatedProducts() {
        if (!relatedSection || !relatedGrid) return;
        if (!relatedProducts.length) {
            relatedSection.style.display = 'block';
            relatedGrid.innerHTML = `
                <div class="cart-empty" style="grid-column:1/-1;">
                    <div class="cart-empty-icon">🧵</div>
                    <h2>No More Products In This Collection</h2>
                    <p>This item is currently the only visible product linked to this collection.</p>
                    <a href="related-products.html?id=${product.is_main_product ? product.id : (parentProduct?.id || product.id)}" class="btn btn-primary">Open Collection Page</a>
                </div>
            `;
            return;
        }
        relatedSection.style.display = 'block';
        relatedGrid.innerHTML = relatedProducts.map(item => {
            const itemDiscount = item.original_price
                ? Math.round((1 - item.price / item.original_price) * 100) : 0;
            return `
                <div class="product-card fade-in" style="cursor:pointer" onclick="window.location.href='product.html?id=${item.id}'">
                    <div class="product-image">
                        <img src="${getImageUrl(item.image_url)}" alt="${item.name}" loading="lazy">
                        ${item.badge ? `<span class="product-badge ${item.badge_class}">${item.badge}</span>` : ''}
                    </div>
                    <div class="product-info">
                        <h3 class="product-name">${item.name}</h3>
                        <div class="product-price">
                            <span class="current">${fmt(item.price)}</span>
                            ${item.original_price ? `<span class="original">${fmt(item.original_price)}</span>` : ''}
                            ${itemDiscount ? `<span class="discount">${itemDiscount}% OFF</span>` : ''}
                        </div>
                        ${item.avg_rating ? `<div class="product-rating"><span class="product-rating-stars">${renderStarsHTML(item.avg_rating)}</span><span class="product-rating-count">(${item.review_count})</span></div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Highlights
    document.getElementById('pdpHighlightsList').innerHTML =
        (product.highlights || []).map(h => `<li>${cleanHighlightText(h)}</li>`).join('');

    renderCategoryNav();
    renderRelatedProducts();
    await loadProductReviews();

    pdpReviewSortSelect?.addEventListener('change', async () => {
        reviewState.reviews = [];
        await loadProductReviews({ page: 1, sort: pdpReviewSortSelect.value, append: false });
    });

    pdpReviewsLoadMore?.addEventListener('click', async () => {
        if (reviewState.page >= reviewState.totalPages) return;
        const nextPage = reviewState.page + 1;
        await loadProductReviews({ page: nextPage, sort: reviewState.sort, append: true });
    });

    // â”€â”€ Images â”€â”€
    const heroImg = document.getElementById('pdpHeroImg');
    const thumbsEl = document.getElementById('pdpThumbnails');

    // Build allImages from galleryImages (ImageKit) or fallback to catalog_images
    let allImages = [];
    
    // Use galleryImages from ImageKit if available
    if (product.galleryImages && product.galleryImages.length > 0) {
        allImages = product.galleryImages.map(img => img.url);
    } else {
        // Fallback to old catalog_images for backward compatibility
        const catalogImgs = (product.catalog_images || []).map(img => {
            if (typeof img === 'object' && img.url) return img.url;
            if (typeof img === 'string' && img.startsWith('http')) return img;
            const folder = product.catalog_folder ? `/${product.catalog_folder}` : '';
            return `images${folder}/${img}`;
        });
        allImages = [getImageUrl(product.image_url), ...catalogImgs.map(src => getImageUrl(src))];
    }
    
    let currentIdx = 0;

    heroImg.src = allImages[0];
    heroImg.alt = product.name;

    thumbsEl.innerHTML = allImages.map((src, i) => `
        <div class="pdp-thumb ${i === 0 ? 'active' : ''}" data-index="${i}">
            <img src="${src}" alt="${product.name} - Image ${i + 1}" loading="lazy">
        </div>`).join('');

    function setImg(idx) {
        currentIdx = idx;
        heroImg.src = allImages[idx];
        thumbsEl.querySelectorAll('.pdp-thumb').forEach((t, i) => t.classList.toggle('active', i === idx));
    }
    thumbsEl.querySelectorAll('.pdp-thumb').forEach(t => {
        t.addEventListener('click', () => setImg(parseInt(t.dataset.index)));
        t.addEventListener('mouseenter', () => setImg(parseInt(t.dataset.index)));
    });

    // â”€â”€ Sizes â”€â”€
    const sizesEl = document.getElementById('pdpSizes');
    const sizeAvailabilityEl = document.getElementById('pdpSizeAvailability');
    let selectedSize = null;
    let selectableSizes = product.has_size_inventory ? (product.available_sizes || []).slice() : (product.sizes || []).slice();

    function getSelectedSizeStock() {
        if (!product.has_size_inventory) return Number(product.stock) || 0;
        const selected = (product.size_inventory || []).find(item => item.size === selectedSize);
        return Number(selected?.quantity) || 0;
    }

    function updateAvailabilityMessage(message = '') {
        if (!sizeAvailabilityEl) return;
        if (message) {
            sizeAvailabilityEl.textContent = message;
            return;
        }
        if (product.has_size_inventory) {
            sizeAvailabilityEl.textContent = selectableSizes.length
                ? `Available sizes: ${selectableSizes.join(', ')}`
                : 'This product is currently out of stock.';
            return;
        }
        sizeAvailabilityEl.textContent = Number(product.stock) > 0
            ? `${product.stock} item(s) available`
            : 'This product is currently out of stock.';
    }

    function renderSizes(sizesToRender = selectableSizes) {
        selectableSizes = sizesToRender.slice();
        if (selectedSize && !selectableSizes.includes(selectedSize)) {
            selectedSize = null;
        }

        sizesEl.innerHTML = selectableSizes.length
            ? selectableSizes.map(s => `<span class="pdp-size-pill ${selectedSize === s ? 'active' : ''}">${s}</span>`).join('')
            : '<span style="color:var(--color-dark-gray);font-size:.92rem;">No sizes available right now.</span>';

        sizesEl.querySelectorAll('.pdp-size-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                sizesEl.querySelectorAll('.pdp-size-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                selectedSize = pill.textContent;
                quantity = 1;
                qtyValue.value = quantity;
                updateAvailabilityMessage(`Size ${selectedSize} has ${getSelectedSizeStock()} item(s) available.`);
            });
        });

        updateAvailabilityMessage();
    }

    renderSizes();

    // â”€â”€ Quantity â”€â”€
    let quantity = 1;
    const qtyValue = document.getElementById('qtyValue');
    const maxAllowedQuantity = () => {
        const stockLimit = product.has_size_inventory ? getSelectedSizeStock() : (Number(product.stock) || 0);
        return Math.max(1, Math.min(10, stockLimit || 1));
    };
    document.getElementById('qtyMinus').addEventListener('click', () => { if (quantity > 1) { quantity--; qtyValue.value = quantity; } });
    document.getElementById('qtyPlus').addEventListener('click', () => { if (quantity < maxAllowedQuantity()) { quantity++; qtyValue.value = quantity; } });

    // â”€â”€ Add To Cart â”€â”€
    const addToCartBtn = document.getElementById('pdpAddToCart');
    const buyNowBtn = document.getElementById('pdpBuyNow');

    async function doAddToCart(btn) {
        if (!selectedSize && (product.sizes || []).length > 0) {
            showToast('Please select a size first');
            sizesEl.classList.add('shake');
            setTimeout(() => sizesEl.classList.remove('shake'), 600);
            return false;
        }

        if (!isLoggedIn()) {
            window.DevasthraGuestCart?.add({
                productId: product.id,
                size: selectedSize || '',
                quantity,
                productDetails: {
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    original_price: product.original_price,
                    image_url: product.image_url,
                    category: product.category,
                    stock: product.stock
                }
            });
            if (window.firePixelAddToCart) {
                window.firePixelAddToCart({
                    product_id: product.id,
                    sku: `SKU-${product.id}`,
                    name: product.name,
                    category: product.category,
                    price: product.price,
                    quantity,
                    size: selectedSize || ''
                });
            }
            updateCartBadge(window.DevasthraGuestCart?.count() || 0);
            showToast(`${product.name} (${selectedSize || 'One Size'} x ${quantity}) added to cart`, 'success');
            return true;
        }

        btn.textContent = 'Adding...';
        btn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/add-to-cart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
                body: JSON.stringify({ product_id: product.id, size: selectedSize, quantity })
            });
            const data = await res.json();

            if (data.success) {
                if (window.firePixelAddToCart) {
                    window.firePixelAddToCart({
                        product_id: product.id,
                        sku: `SKU-${product.id}`,
                        name: product.name,
                        category: product.category,
                        price: product.price,
                        quantity,
                        size: selectedSize || ''
                    });
                }
                showToast(`${product.name} (${selectedSize || 'One Size'} × ${quantity}) added to cart`, 'success');
                updateCartBadge(data.cartCount);
                return true;
            } else {
                if (Array.isArray(data.availableSizes) && data.availableSizes.length) {
                    renderSizes(data.availableSizes);
                    updateAvailabilityMessage(`Selected size is unavailable. Available sizes: ${data.availableSizes.join(', ')}`);
                }
                showToast(data.message || 'Failed to add to cart');
                return false;
            }
        } catch {
            showToast('Error connecting to server');
            return false;
        } finally {
            btn.textContent = btn === addToCartBtn ? 'Add to Cart' : 'Buy Now';
            btn.disabled = false;
        }
    }

    addToCartBtn.addEventListener('click', () => doAddToCart(addToCartBtn));

    buyNowBtn.addEventListener('click', async () => {
        const added = await doAddToCart(buyNowBtn);
        if (added) window.location.href = 'cart.html';
    });

    function updateCartBadge(count) {
        const badge = document.getElementById('cartCount');
        if (badge) { badge.textContent = count > 0 ? count : ''; badge.style.display = count > 0 ? 'flex' : 'none'; }
        const mobileBadge = document.querySelector('.mobile-cart-count');
        if (mobileBadge) {
            mobileBadge.textContent = count > 0 ? `(${count})` : '';
            mobileBadge.style.display = count > 0 ? 'inline' : 'none';
        }
    }

    // â”€â”€ OTP Modal Full Logic (same as index) â”€â”€
    const otpModal = document.getElementById('otpModal');
    const otpOverlay = document.getElementById('otpOverlay');
    const mobileInput = document.getElementById('otpMobile');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpInput = document.getElementById('otpInput');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const otpStep1 = document.getElementById('otpStep1');
    const otpStep2 = document.getElementById('otpStep2');
    const otpCloseBtn = document.getElementById('otpCloseBtn');
    const otpMessage = document.getElementById('otpMessage');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpRegName = document.getElementById('otpRegName');
    const otpRegEmail = document.getElementById('otpRegEmail');
    const otpRegDob = document.getElementById('otpRegDob');
    const otpRegMobile = document.getElementById('otpRegMobile');

    let resendTimer;
    let currentIsNewUser = true;
    const setOTPMsg = (msg, type = 'error') => { if (otpMessage) { otpMessage.textContent = msg; otpMessage.className = `otp-msg ${type}`; } };

    if (otpCloseBtn) otpCloseBtn.addEventListener('click', () => { otpModal.classList.remove('show'); otpOverlay.classList.remove('show'); document.body.style.overflow = ''; });
    if (otpOverlay) otpOverlay.addEventListener('click', () => { otpModal.classList.remove('show'); otpOverlay.classList.remove('show'); document.body.style.overflow = ''; });

    function startResendTimer() {
        let secs = 30;
        if (resendOtpBtn) { resendOtpBtn.disabled = true; resendOtpBtn.textContent = `Resend in ${secs}s`; }
        resendTimer = setInterval(() => {
            secs--;
            if (resendOtpBtn) resendOtpBtn.textContent = `Resend in ${secs}s`;
            if (secs <= 0) { clearInterval(resendTimer); if (resendOtpBtn) { resendOtpBtn.disabled = false; resendOtpBtn.textContent = 'Resend OTP'; } }
        }, 1000);
    }

    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', async () => {
            const mob = mobileInput?.value.trim();
            if (!mob || !/^[6-9]\d{9}$/.test(mob)) { setOTPMsg('Enter valid 10-digit mobile number'); return; }
            sendOtpBtn.textContent = 'Sending...'; sendOtpBtn.disabled = true; setOTPMsg('');
            try {
                const res = await fetch(`${API_BASE}/api/send-mobile-login-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: mob, email: '' }) });
                const data = await res.json();
                if (data.success) {
                    currentIsNewUser = data.isNewUser;
                    otpStep1.style.display = 'none'; otpStep2.style.display = 'block';
                    startResendTimer();

                    // Update modal header
                    const modalHeader = otpModal?.querySelector('.otp-modal-header');
                    if (modalHeader) {
                        modalHeader.querySelector('h2').textContent = 'Enter Verification Code';
                        modalHeader.querySelector('p').textContent = 'Enter the OTP sent to your mobile';
                    }

                    setOTPMsg(data.dev ? 'Dev mode: Check server console for OTP' : 'OTP sent!', 'success');
                } else { setOTPMsg(data.message || 'Failed to send OTP'); }
            } catch { setOTPMsg('Cannot connect to server'); }
            finally { sendOtpBtn.textContent = 'Send OTP'; sendOtpBtn.disabled = false; }
        });
    }

    if (verifyOtpBtn) {
        verifyOtpBtn.addEventListener('click', async () => {
            const mob = mobileInput?.value.trim();
            const otp = otpInput?.value.trim();
            if (!otp || otp.length !== 6) { setOTPMsg('Enter the 6-digit OTP'); return; }
            verifyOtpBtn.textContent = 'Verifying...'; verifyOtpBtn.disabled = true;
            try {
                const res = await fetch(`${API_BASE}/api/verify-mobile-login-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mobile: mob, code: otp })
                });
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem('DEVASTHRA_token', data.token);
                    localStorage.setItem('DEVASTHRA_user', JSON.stringify({
                        userId: data.userId,
                        mobile: data.mobile,
                        name: data.name || '',
                        email: data.email || '',
                        dob: data.dob || '',
                        gender: data.gender || ''
                    }));
                    otpModal.classList.remove('show'); otpOverlay.classList.remove('show'); document.body.style.overflow = '';
                    sessionStorage.removeItem('pendingCart');
                    try {
                        const mergeData = await window.DevasthraGuestCart?.mergeToServer(data.token);
                        if (mergeData?.success) updateCartBadge(mergeData.cartCount || 0);
                    } catch {
                        // Keep guest_cart in localStorage so cart.html can retry the merge.
                    }
                    showToast('✓ Logged in!', 'success');
                    // Retry pending cart
                    const pending = sessionStorage.getItem('pendingCart');
                    if (pending) {
                        const { productId: pid, size: sz, quantity: qty } = JSON.parse(pending);
                        sessionStorage.removeItem('pendingCart');
                        const r = await fetch(`${API_BASE}/add-to-cart`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` }, body: JSON.stringify({ product_id: pid, size: sz, quantity: qty }) });
                        const rd = await r.json();
                        if (rd.success) {
                            if (window.firePixelAddToCart) {
                                window.firePixelAddToCart({
                                    product_id: pid,
                                    sku: `SKU-${pid}`,
                                    name: product.name,
                                    category: product.category,
                                    price: product.price,
                                    quantity: qty,
                                    size: sz || ''
                                });
                            }
                            updateCartBadge(rd.cartCount);
                            showToast('✓ Added to cart!', 'success');
                        }
                    }
                    if (data.isNewUser && window.firePixelCompleteRegistration) {
                        window.firePixelCompleteRegistration({
                            content_name: 'Product Page Sign Up',
                            content_category: 'Registration',
                            method: 'otp'
                        });
                    }
                } else { setOTPMsg(data.message || 'Invalid OTP'); }
            } catch { setOTPMsg('Cannot connect to server'); }
            finally { verifyOtpBtn.textContent = 'Sign In'; verifyOtpBtn.disabled = false; }
        });
    }

    if (resendOtpBtn) resendOtpBtn.addEventListener('click', () => sendOtpBtn?.click());

    // â”€â”€ Mobile Hamburger â”€â”€

    // â”€â”€ Sticky Header â”€â”€

    // â”€â”€ Init: Cart count + user UI â”€â”€
    window.syncHeaderAuthUI?.();
    if (isLoggedIn()) {
        try {
            const r = await fetch(`${API_BASE}/cart/count`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
            const d = await r.json();
            if (d.success) updateCartBadge(d.count);
        } catch { }
    } else {
        updateCartBadge(window.DevasthraGuestCart?.count() || 0);
    }

    if ((product.has_size_inventory && !(product.available_sizes || []).length) || (!product.has_size_inventory && (Number(product.stock) || 0) <= 0)) {
        addToCartBtn.disabled = true;
        buyNowBtn.disabled = true;
        updateAvailabilityMessage('This product is currently out of stock.');
    }
});

