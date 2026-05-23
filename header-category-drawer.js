document.addEventListener('DOMContentLoaded', () => {
    let initAttempts = 0;

    function initCategoryDrawer() {
        const menuButton = document.getElementById('headerMenuBtn');
        const drawer = document.getElementById('categoryDrawer');
        const overlay = document.getElementById('categoryDrawerOverlay');
        const closeButton = document.getElementById('categoryDrawerClose');
        const audienceSwitch = document.getElementById('drawerAudienceSwitch');
        const categoryList = document.getElementById('drawerCategoryList');
        const bulkOrdersLink = document.getElementById('drawerBulkOrdersLink');

        if (!menuButton || !drawer || !overlay || !closeButton || !audienceSwitch || !categoryList) {
            if (initAttempts < 20) {
                initAttempts += 1;
                window.setTimeout(initCategoryDrawer, 50);
            }
            return;
        }

        const API_BASE = window.__API_BASE || (
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.protocol === 'file:'
                ? 'http://localhost:5000'
                : window.location.origin
        );
        const fetchTaxonomy = window.__fetchJsonWithApiFallback
            ? () => window.__fetchJsonWithApiFallback('/api/products/taxonomy')
            : async () => {
                const response = await fetch(`${API_BASE}/api/products/taxonomy`);
                return {
                    base: API_BASE,
                    url: `${API_BASE}/api/products/taxonomy`,
                    response,
                    data: await response.json()
                };
            };
        const params = new URLSearchParams(window.location.search);
        let taxonomy = {};
        let audienceState = {};
        let audiences = [];
        let activeAudience = '';
        let expandedCategory = params.get('category') || '';
        const activeSubcategory = params.get('subcategory') || '';

        function openDrawer() {
            drawer.classList.add('open');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeDrawer() {
            drawer.classList.remove('open');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        function renderAudienceSwitch() {
            if (!audiences.length) {
                audienceSwitch.innerHTML = '';
                return;
            }

            audienceSwitch.innerHTML = audiences.map((audience) => `
                <button type="button" class="drawer-audience-chip ${audience === activeAudience ? 'active' : ''} ${audienceState[audience] === false ? 'is-disabled' : ''}" data-audience="${audience}" ${audienceState[audience] === false ? 'disabled' : ''}>
                    ${audience}
                </button>
            `).join('');

            audienceSwitch.querySelectorAll('[data-audience]').forEach((button) => {
                button.addEventListener('click', () => {
                    activeAudience = button.getAttribute('data-audience');
                    expandedCategory = (taxonomy[activeAudience] || []).find((entry) => entry.isActive !== false)?.category || '';
                    renderAudienceSwitch();
                    renderCategoryList();
                });
            });
        }

        function renderCategoryList() {
            const audienceTaxonomy = (Array.isArray(taxonomy[activeAudience]) ? taxonomy[activeAudience] : [])
                .filter((entry) => entry.lockedByParent !== true);
            const firstActiveCategory = audienceTaxonomy.find((entry) => entry.isActive !== false)?.category || '';
            if (audienceState[activeAudience] === false) {
                categoryList.innerHTML = `<p style="color:#666;padding:8px 0;">This audience is disabled right now.</p>`;
                return;
            }
            if (expandedCategory && !audienceTaxonomy.some((entry) => entry.category === expandedCategory && entry.isActive !== false)) {
                expandedCategory = firstActiveCategory;
            }
            if (!audienceTaxonomy.length) {
                categoryList.innerHTML = `<p style="color:#666;padding:8px 0;">No categories available right now.</p>`;
                return;
            }

            categoryList.innerHTML = audienceTaxonomy.map((entry) => `
                <div class="drawer-category-group ${expandedCategory === entry.category ? 'active' : ''} ${entry.isActive === false ? 'is-disabled' : ''}">
                    <div class="drawer-category-row">
                        <a class="drawer-category-link ${entry.isActive === false ? 'is-disabled' : ''}" ${entry.isActive === false ? 'aria-disabled="true"' : `href="catalog.html?gender=${encodeURIComponent(activeAudience)}&category=${encodeURIComponent(entry.category)}"`}>
                            ${entry.category}
                        </a>
                        <button type="button" class="drawer-category-toggle" data-category="${entry.category}" aria-label="Toggle ${entry.category}" ${entry.isActive === false ? 'disabled' : ''}>
                            <span>${expandedCategory === entry.category ? '-' : '+'}</span>
                        </button>
                    </div>
                    <div class="drawer-subcategory-list">
                        ${entry.subcategories.filter((subcategoryEntry) => subcategoryEntry.lockedByParent !== true).map((subcategoryEntry) => `
                            <a class="drawer-subcategory-link ${expandedCategory === entry.category && activeSubcategory === subcategoryEntry.subcategory ? 'active' : ''} ${subcategoryEntry.isActive === false || entry.isActive === false ? 'is-disabled' : ''}" ${subcategoryEntry.isActive === false || entry.isActive === false ? 'aria-disabled="true"' : `href="catalog.html?gender=${encodeURIComponent(activeAudience)}&category=${encodeURIComponent(entry.category)}&subcategory=${encodeURIComponent(subcategoryEntry.subcategory)}"`}>
                                ${subcategoryEntry.subcategory}
                            </a>
                        `).join('')}
                    </div>
                </div>
            `).join('');

            categoryList.querySelectorAll('.drawer-category-toggle').forEach((button) => {
                button.addEventListener('click', () => {
                    const category = button.getAttribute('data-category');
                    expandedCategory = expandedCategory === category ? '' : category;
                    renderCategoryList();
                });
            });

            categoryList.querySelectorAll('a').forEach((link) => {
                if (link.classList.contains('is-disabled')) {
                    link.addEventListener('click', (event) => event.preventDefault());
                    return;
                }
                link.addEventListener('click', closeDrawer);
            });
        }

        menuButton.addEventListener('click', openDrawer);
        closeButton.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
        bulkOrdersLink?.addEventListener('click', closeDrawer);

        (async () => {
            try {
                const { data } = await fetchTaxonomy();
                taxonomy = data.success ? (data.taxonomy || {}) : {};
                audienceState = Object.fromEntries(Object.entries(data.structuredTaxonomy || {}).map(([audience, entry]) => [audience, entry?.isActive !== false]));
                audiences = Object.keys(taxonomy);
                const requestedAudience = params.get('gender');
                const firstEnabledAudience = audiences.find((audience) => audienceState[audience] !== false) || audiences[0];
                activeAudience = requestedAudience && audienceState[requestedAudience] !== false && audiences.includes(requestedAudience)
                    ? requestedAudience
                    : (audiences.includes('Men') && audienceState.Men !== false ? 'Men' : firstEnabledAudience);

                if (!expandedCategory) {
                    expandedCategory = (taxonomy[activeAudience] || []).find((entry) => entry.isActive !== false)?.category || '';
                }

                renderAudienceSwitch();
                renderCategoryList();
            } catch (error) {
                // Suppress 404 errors from cluttering the console, just show empty state
                if (!String(error).includes('404')) {
                    console.warn('Category drawer failed to load:', error.message);
                }
                categoryList.innerHTML = `<p style="color:#999;padding:8px 0;font-size:0.9rem">Categories unavailable</p>`;
            }
        })();
    }

    initCategoryDrawer();
});
