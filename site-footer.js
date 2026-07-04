/**
 * DEVASTHRA — Universal Site Footer Component
 * Renders a consistent footer across all pages.
 */
(function () {
    'use strict';

    function renderSiteFooter() {
        var target = document.getElementById('site-footer');
        if (!target) return;

        var isHome = /index\.html/.test(window.location.pathname) ||
            window.location.pathname.endsWith('/') ||
            window.location.pathname === '';
        var hp = isHome ? '' : 'index.html';

        target.innerHTML = '<footer class="footer">' +
            '<div class="container">' +
            '<div class="footer-grid">' +

            /* ── Brand Column ── */
            '<div class="footer-brand">' +
            '<a href="' + (hp || 'index.html') + '" class="footer-brand-link">' +
            '<img src="/backend/images/ESTD_LOGO_1.png" alt="DEVASTHRA" class="footer-logo-estd">' +
            '</a>' +
            '<p>Culture in Motion. Fashion that celebrates heritage and modern elegance, crafted for those who wear their identity with pride.</p>' +
            
            '<div class="footer-social">' +
            /* Instagram */
            '<a href="https://www.instagram.com/DEVASTHRA_official?utm_source=qr&igsh=eXV4emFnOWdsMjBz" target="_blank" rel="noopener" aria-label="Instagram" class="footer-social-link footer-social-link-instagram">' +
            '<svg viewBox="0 0 24 24" class="footer-social-icon footer-social-icon-instagram" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5"></rect>' +
            '<circle cx="12" cy="12" r="4.1"></circle>' +
            '<circle cx="17.35" cy="6.65" r="1"></circle>' +
            '</svg>' +
            '</a>' +
            /* WhatsApp */
            '<a href="https://wa.me/919347111819" target="_blank" rel="noopener" aria-label="WhatsApp" class="footer-social-link footer-social-link-whatsapp">' +
            '<svg viewBox="0 0 24 24" class="footer-social-icon footer-social-icon-whatsapp">' +
            '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="currentColor"/>' +
            '</svg>' +
            '</a>' +
            /* Facebook */
            '<a href="https://www.facebook.com/share/14Z3nB88AqT/" target="_blank" rel="noopener" aria-label="Facebook" class="footer-social-link footer-social-link-facebook">' +
            '<svg viewBox="0 0 24 24" class="footer-social-icon footer-social-icon-facebook" fill="currentColor" aria-hidden="true">' +
            '<path d="M13.73 21v-7.3h2.45l.37-2.85h-2.82V9.02c0-.82.23-1.39 1.41-1.39h1.5V5.08c-.26-.03-1.14-.08-2.16-.08-2.14 0-3.6 1.31-3.6 3.72v2.13H8.44v2.85h2.44V21h2.85z"></path>' +
            '</svg>' +
            '</a>' +
            /* LinkedIn */
            '<a href="https://www.linkedin.com/company/natookart/" target="_blank" rel="noopener" aria-label="LinkedIn" class="footer-social-link footer-social-link-linkedin">' +
            '<svg viewBox="0 0 24 24" class="footer-social-icon footer-social-icon-linkedin" fill="currentColor" aria-hidden="true">' +
            '<path d="M6.94 8.5A1.56 1.56 0 1 1 6.94 5.38a1.56 1.56 0 0 1 0 3.12zM5.62 9.75h2.64V18H5.62V9.75zm4.15 0h2.53v1.13h.04c.35-.66 1.22-1.36 2.5-1.36 2.67 0 3.16 1.76 3.16 4.05V18h-2.64v-3.93c0-.94-.02-2.15-1.31-2.15-1.31 0-1.51 1.02-1.51 2.08V18H9.77V9.75z"></path>' +
            '</svg>' +
            '</a>' +
            '</div>' +
            '<div class="footer-powered">' +
            '</div>' +
            '</div>' +

            /* ── Quick Links ── */
            '<div class="footer-col">' +
            '<h4>Quick Links</h4>' +
            '<ul>' +
            '<li><a href="' + (hp ? hp + '#home' : '#home') + '">Home</a></li>' +
            '<li><a href="' + (hp ? hp + '#categories' : '#categories') + '">Categories</a></li>' +
            '<li><a href="' + (hp ? hp + '#best-sellers' : '#best-sellers') + '">Best Sellers</a></li>' +
            '<li><a href="' + (hp ? hp + '#about' : '#about') + '">About Us</a></li>' +
            '<li><a href="' + (hp ? hp + '#contact' : '#contact') + '">Contact</a></li>' +
            '</ul>' +
            '</div>' +

            /* ── Customer Care ── */
            '<div class="footer-col">' +
            '<h4>Customer Care</h4>' +
            '<ul>' +
            '<li><a href="size-guide.html">Size Guide</a></li>' +
            '<li><a href="shipping-returns.html">Shipping & Returns</a></li>' +
            '<li><a href="track-order.html">Order Tracking</a></li>' +
            '<li><a href="faq.html">FAQ</a></li>' +
            '<li><a href="javascript:void(0)" aria-disabled="true">Careers</a></li>' +
            '</ul>' +
            '</div>' +

            /* ── Newsletter ── */
            '<div class="footer-col footer-newsletter">' +
            '<h4>Stay Updated</h4>' +
            '<p>Subscribe to receive exclusive offers, early access to new collections, and style inspiration directly to your inbox.</p>' +
            '<form class="newsletter-form" id="newsletterForm">' +
            '<input type="email" placeholder="Enter your email" required>' +
            '<button type="submit">Join</button>' +
            '</form>' +
            '<div class="footer-app-links">' +
            '<a href="javascript:void(0)" class="footer-app-link" aria-label="App Store (coming soon)">' +
            '<svg viewBox="0 0 24 24" class="footer-app-icon" aria-hidden="true">' +
            '<path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 16.99 2.97 12.5 4.7 9.56C5.55 8.08 7.13 7.16 8.82 7.14C10.1 7.12 11.32 8.01 12.11 8.01C12.89 8.01 14.37 6.94 15.92 7.11C16.57 7.14 18.39 7.37 19.56 9.08C19.47 9.14 17.39 10.32 17.41 12.81C17.44 15.81 20.06 16.8 20.09 16.81C20.06 16.89 19.67 18.27 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>' +
            '</svg>' +
            '<span>App Store</span>' +
            '</a>' +
            '<a href="javascript:void(0)" class="footer-app-link" aria-label="Play Store (coming soon)">' +
            '<svg viewBox="0 0 24 24" class="footer-app-icon" aria-hidden="true">' +
            '<path d="M3.61 1.814L13.793 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .61-.92zm.68-.586l11.14 6.27L12.35 10.6 4.29 1.228zM19.83 10.93l2.09 1.18a1.08 1.08 0 0 1 0 1.88l-2.09 1.18-3.44-2.12 3.44-2.12zM4.29 22.772l8.06-9.372 3.08 3.102-11.14 6.27z"/>' +
            '</svg>' +
            '<span>Play Store</span>' +
            '</a>' +
            '</div>' +
            '</div>' +

            '</div>' +

            /* ── Footer Bottom ── */
            '<div class="footer-bottom">' +
            '<p>&copy; 2026 DEVASTHRA. All rights reserved. A NATOO KART TECHNOLOGIES PRIVATE LIMITED brand.</p>' +
            '<div class="footer-bottom-links">' +
            '<a href="terms-of-service.html">Terms of Service</a>' +
            '<a href="privacy-policy.html">Privacy Policy</a>' +
            '<a href="refund-replacement-policy.html">Refund & Replacement Policy</a>' +
            '<a href="exchange-policy.html">Exchange Policy</a>' +
            '<a href="shipping-policy.html">Shipping Policy</a>' +
            '<a href="cookie-policy.html">Cookie Policy</a>' +
            '</div>' +
            '</div>' +

            '</div>' +
            '</footer>';
    }

    /* Auto-render on DOM ready */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderSiteFooter);
    } else {
        renderSiteFooter();
    }

    window.renderSiteFooter = renderSiteFooter;
})();
