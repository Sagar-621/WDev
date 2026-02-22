/* ========================================
   DeVASTHRA — Culture in Motion
   Main Page Interactivity
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ── Element References ──
    const header = document.getElementById('header');
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    const mobileOverlay = document.getElementById('mobileOverlay');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    const contactForm = document.getElementById('contactForm');
    const newsletterForm = document.getElementById('newsletterForm');

    // ── Brand Colors ──
    const BRAND_MAROON = '#6B0F2B';

    // ── Product Data ──
    const PRODUCTS = [
        {
            id: 'btshirt',
            name: "DeVASTHRA Branded T-Shirt",
            image: "Btshirt.JPG.jpeg",
            price: 1499,
            originalPrice: 2499,
            badge: "Trending",
            badgeClass: "trending",
            sizes: [],
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
            sizes: [],
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

    // Make PRODUCTS available globally for product-detail.js
    window.DEVASTHRA_PRODUCTS = PRODUCTS;

    // ── 1. Sticky Header Shadow ──
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 60) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }, { passive: true });

    // ── 2. Mobile Hamburger Menu ──
    function openMenu() {
        hamburger.classList.add('active');
        navLinks.classList.add('open');
        mobileOverlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
        hamburger.classList.remove('active');
        navLinks.classList.remove('open');
        mobileOverlay.classList.remove('visible');
        document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', () => {
        navLinks.classList.contains('open') ? closeMenu() : openMenu();
    });

    mobileOverlay.addEventListener('click', closeMenu);
    navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

    // ── 3. Smooth Scroll ──
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                const offset = target.getBoundingClientRect().top + window.pageYOffset - 80;
                window.scrollTo({ top: offset, behavior: 'smooth' });
            }
        });
    });

    // ── 4. Scroll-Triggered Fade-In ──
    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

    // ── 5. Toast Helper ──
    let toastTimeout;
    function showToast(message) {
        clearTimeout(toastTimeout);
        toastMessage.textContent = message;
        toast.classList.add('show');
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ── 6. Price Formatter ──
    function formatPrice(price) {
        return '₹' + price.toLocaleString('en-IN');
    }

    // ── 7. Render Product Grid ──
    function renderProducts() {
        const grid = document.getElementById('productsGrid');
        if (!grid) return;

        grid.innerHTML = PRODUCTS.map(product => {
            const discount = product.originalPrice
                ? Math.round((1 - product.price / product.originalPrice) * 100)
                : 0;

            return `
                <div class="product-card fade-in" data-product-id="${product.id}">
                    <div class="product-image">
                        <img src="${product.image}" alt="${product.name}" loading="lazy">
                        ${product.badge ? `<span class="product-badge ${product.badgeClass}">${product.badge}</span>` : ''}
                    </div>
                    <div class="product-info">
                        <h3 class="product-name">${product.name}</h3>
                        <div class="product-price">
                            <span class="current">${formatPrice(product.price)}</span>
                            ${product.originalPrice ? `<span class="original">${formatPrice(product.originalPrice)}</span>` : ''}
                            ${discount ? `<span class="discount">${discount}% OFF</span>` : ''}
                        </div>
                        <div class="product-sizes">
                            ${product.sizes.map(s => `<span>${s}</span>`).join('')}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Re-observe fade-in
        grid.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

        // Click navigates to product detail page
        grid.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-product-id');
                window.location.href = `product.html?id=${id}`;
            });
        });
    }

    renderProducts();

    // ── 8. Contact Form ──
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('contactName').value.trim();
            const email = document.getElementById('contactEmail').value.trim();
            const message = document.getElementById('contactMessage').value.trim();

            if (!name || !email || !message) {
                showToast('Please fill in all fields');
                return;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('Please enter a valid email address');
                return;
            }

            showToast('Message sent successfully!');
            contactForm.reset();
        });
    }

    // ── 9. Newsletter Form ──
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = newsletterForm.querySelector('input');
            const email = input.value.trim();

            if (!email) {
                showToast('Please enter your email');
                return;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('Please enter a valid email address');
                return;
            }

            showToast('Welcome to the DeVASTHRA family!');
            input.value = '';
        });
    }

    // ── 10. Active Nav Link ──
    const sections = document.querySelectorAll('section[id]');
    const navAnchors = document.querySelectorAll('.nav-links a');

    function setActiveNavLink() {
        const scrollY = window.pageYOffset + 120;
        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            if (scrollY >= top && scrollY < top + height) {
                navAnchors.forEach(a => {
                    a.style.color = '';
                    if (a.getAttribute('href') === `#${id}`) {
                        a.style.color = BRAND_MAROON;
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', setActiveNavLink, { passive: true });
    setActiveNavLink();
});
