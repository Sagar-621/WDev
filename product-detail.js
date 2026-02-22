/* ========================================
   DeVASTHRA — Product Detail Page
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ── Product Data (self-contained) ──
    const PRODUCTS = [
        {
            id: 'btshirt',
            name: "DeVASTHRA Branded T-Shirt",
            image: "Btshirt.JPG.jpeg",
            price: 1499,
            originalPrice: 2499,
            badge: "Trending",
            badgeClass: "trending",
            sizes: ["S", "M", "L", "XL", "XXL"],
            description: "A premium navy blue t-shirt featuring the iconic DeVASTHRA mandala artwork with 'Loka Seema Ativartin' typography. Crafted from 100% cotton with a regular fit for everyday comfort and cultural expression.",
            catalogFolder: "Btshirt-catalog",
            catalogImages: ["YESH0468.JPG.jpeg", "YESH0471.JPG.jpeg", "YESH0474.JPG.jpeg", "YESH0477.JPG.jpeg"],
            highlights: [
                "100% Premium Cotton",
                "Regular Fit",
                "Round Neck",
                "Short Sleeves",
                "DeVASTHRA signature mandala print",
                "Machine washable"
            ]
        },
        {
            id: 'plbtshirt',
            name: "DeVASTHRA Plain T-Shirt",
            image: "PLBTshirt.JPG.jpeg",
            price: 999,
            originalPrice: 1799,
            badge: "New",
            badgeClass: "new",
            sizes: ["S", "M", "L", "XL", "XXL"],
            description: "A sleek plain navy blue oversized t-shirt with the subtle DeVASTHRA branding. Made from premium cotton with a relaxed, oversized silhouette perfect for effortless street style.",
            catalogFolder: "PLBTshirt-catalog",
            catalogImages: ["YESH0480.JPG.jpeg", "YESH0482.JPG.jpeg", "YESH0485.JPG.jpeg"],
            highlights: [
                "100% Premium Cotton",
                "Oversized Fit",
                "Round Neck",
                "Short Sleeves",
                "Minimal DeVASTHRA branding",
                "Soft hand feel"
            ]
        }
    ];

    // ── Parse product ID from URL ──
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    const product = PRODUCTS.find(p => p.id === productId);

    if (!product) {
        document.querySelector('.pdp-page').innerHTML = `
            <div style="text-align: center; padding: 120px 24px; min-height: 60vh;">
                <h2 style="font-family: var(--font-heading); font-size: 2rem; margin-bottom: 16px; color: var(--color-black);">Product Not Found</h2>
                <p style="color: var(--color-dark-gray); margin-bottom: 32px;">The product you're looking for doesn't exist.</p>
                <a href="index.html#products" class="btn btn-primary">Back to Products</a>
            </div>
        `;
        return;
    }

    // ── Element References ──
    const heroImg = document.getElementById('pdpHeroImg');
    const thumbnailsContainer = document.getElementById('pdpThumbnails');
    const breadcrumbName = document.getElementById('breadcrumbName');
    const badge = document.getElementById('pdpBadge');
    const name = document.getElementById('pdpName');
    const priceEl = document.getElementById('pdpPrice');
    const desc = document.getElementById('pdpDesc');
    const highlightsList = document.getElementById('pdpHighlightsList');
    const sizesEl = document.getElementById('pdpSizes');
    const qtyValue = document.getElementById('qtyValue');
    const qtyMinus = document.getElementById('qtyMinus');
    const qtyPlus = document.getElementById('qtyPlus');
    const addToCart = document.getElementById('pdpAddToCart');
    const buyNow = document.getElementById('pdpBuyNow');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    let selectedSize = null;
    let quantity = 1;

    // ── Populate Page ──
    document.title = `${product.name} — DeVASTHRA`;
    breadcrumbName.textContent = product.name;
    name.textContent = product.name;
    desc.textContent = product.description;

    // Badge
    if (product.badge) {
        badge.textContent = product.badge;
        badge.className = `pdp-badge ${product.badgeClass}`;
    } else {
        badge.style.display = 'none';
    }

    // Price
    const discount = product.originalPrice
        ? Math.round((1 - product.price / product.originalPrice) * 100)
        : 0;
    const formatPrice = (p) => '₹' + p.toLocaleString('en-IN');

    let priceHTML = `<span class="current">${formatPrice(product.price)}</span>`;
    if (product.originalPrice) {
        priceHTML += ` <span class="original">${formatPrice(product.originalPrice)}</span>`;
        priceHTML += ` <span class="discount">${discount}% OFF</span>`;
    }
    priceEl.innerHTML = priceHTML;

    // Highlights
    highlightsList.innerHTML = product.highlights
        .map(h => `<li>${h}</li>`)
        .join('');

    // ── Build Image Gallery ──
    // All images: main image first, then catalog folder images
    const allImages = [
        product.image,
        ...product.catalogImages.map(img => `${product.catalogFolder}/${img}`)
    ];

    let currentImageIndex = 0;

    // Set initial hero image
    heroImg.src = allImages[0];
    heroImg.alt = product.name;

    // Render thumbnails
    thumbnailsContainer.innerHTML = allImages.map((src, i) => `
        <div class="pdp-thumb ${i === 0 ? 'active' : ''}" data-index="${i}">
            <img src="${src}" alt="${product.name} - Image ${i + 1}" loading="lazy">
        </div>
    `).join('');

    // Thumbnail interaction
    thumbnailsContainer.querySelectorAll('.pdp-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            const idx = parseInt(thumb.dataset.index);
            setActiveImage(idx);
        });

        thumb.addEventListener('mouseenter', () => {
            const idx = parseInt(thumb.dataset.index);
            setActiveImage(idx);
        });
    });

    function setActiveImage(index) {
        currentImageIndex = index;
        heroImg.src = allImages[index];
        thumbnailsContainer.querySelectorAll('.pdp-thumb').forEach((t, i) => {
            t.classList.toggle('active', i === index);
        });
    }

    // ── Sizes ──
    sizesEl.innerHTML = product.sizes.map(s =>
        `<span class="pdp-size-pill">${s}</span>`
    ).join('');

    sizesEl.querySelectorAll('.pdp-size-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            sizesEl.querySelectorAll('.pdp-size-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            selectedSize = pill.textContent;
        });
    });

    // ── Quantity ──
    qtyMinus.addEventListener('click', () => {
        if (quantity > 1) {
            quantity--;
            qtyValue.textContent = quantity;
        }
    });

    qtyPlus.addEventListener('click', () => {
        if (quantity < 10) {
            quantity++;
            qtyValue.textContent = quantity;
        }
    });

    // ── Toast ──
    let toastTimeout;
    function showToast(message) {
        clearTimeout(toastTimeout);
        toastMessage.textContent = message;
        toast.classList.add('show');
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ── Add to Cart ──
    addToCart.addEventListener('click', () => {
        if (!selectedSize) {
            showToast('Please select a size first');
            sizesEl.classList.add('shake');
            setTimeout(() => sizesEl.classList.remove('shake'), 600);
            return;
        }

        showToast(`${product.name} (${selectedSize} × ${quantity}) added to cart`);
        addToCart.textContent = '✓ Added to Cart';
        addToCart.style.background = '#DAA520';
        setTimeout(() => {
            addToCart.textContent = 'Add to Cart';
            addToCart.style.background = '';
        }, 2000);
    });

    // ── Buy Now ──
    buyNow.addEventListener('click', () => {
        if (!selectedSize) {
            showToast('Please select a size first');
            sizesEl.classList.add('shake');
            setTimeout(() => sizesEl.classList.remove('shake'), 600);
            return;
        }

        showToast(`Proceeding to checkout — ${product.name} (${selectedSize} × ${quantity})`);
    });

    // ── Mobile Hamburger (for product page) ──
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    const mobileOverlay = document.getElementById('mobileOverlay');

    hamburger.addEventListener('click', () => {
        const isOpen = navLinks.classList.contains('open');
        hamburger.classList.toggle('active', !isOpen);
        navLinks.classList.toggle('open', !isOpen);
        mobileOverlay.classList.toggle('visible', !isOpen);
        document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    mobileOverlay.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
        mobileOverlay.classList.remove('visible');
        document.body.style.overflow = '';
    });

    // ── Sticky Header ──
    const header = document.getElementById('header');
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.pageYOffset > 60);
    }, { passive: true });
});
