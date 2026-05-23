/**
 * DEVASTHRA — Meta Pixel (Facebook Pixel) Tracking
 * 
 * Integrates Meta Pixel (Facebook Pixel) for conversion tracking
 * Handles: InitiateCheckout, AddPaymentInfo, Purchase events
 * 
 * This module tracks customer journey for Meta Ads optimization
 * Pixel ID is loaded from backend .env configuration
 */
(function () {
    'use strict';

    // Meta Pixel configuration
    let PIXEL_ID = ''; // Will be loaded from backend
    const DEBUG_MODE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';

    function getStoredPixelId() {
        try {
            return window.localStorage.getItem('META_PIXEL_ID')?.trim() || '';
        } catch (error) {
            return '';
        }
    }

    function readConfiguredPixelId() {
        const globalPixelId = String(window.__META_PIXEL_ID__ || '').trim();
        if (globalPixelId) return globalPixelId;

        const metaPixelId = document.querySelector('meta[name="meta-pixel-id"]')?.getAttribute('content')?.trim() || '';
        if (metaPixelId) return metaPixelId;

        return getStoredPixelId();
    }

    function persistPixelId(pixelId) {
        if (!pixelId) return;

        try {
            window.localStorage.setItem('META_PIXEL_ID', pixelId);
        } catch (error) {
            // Ignore storage failures in restricted environments.
        }
    }

    /**
     * Fetch Pixel ID from backend configuration
     */
    async function fetchPixelIdFromBackend() {
        try {
            const response = await fetch('/api/config/tracking');
            const data = await response.json();
            
            if (data.success && data.meta_pixel_id) {
                PIXEL_ID = data.meta_pixel_id;
                if (DEBUG_MODE) console.log(`[Meta Pixel] Loaded Pixel ID from backend: ${PIXEL_ID}`);
                return PIXEL_ID;
            } else {
                if (DEBUG_MODE) console.warn('[Meta Pixel] No pixel ID returned from backend');
                return null;
            }
        } catch (error) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] Failed to fetch pixel ID from backend:', error);
            return null;
        }
    }

    /**
     * Initialize Meta Pixel
     */
    async function initMetaPixel() {
        // Resolve pixel ID from the page/config first, then fall back to backend.
        if (!PIXEL_ID) {
            PIXEL_ID = readConfiguredPixelId();
        }

        if (!PIXEL_ID) {
            await fetchPixelIdFromBackend();
            persistPixelId(PIXEL_ID);
        }

        if (!PIXEL_ID) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] No pixel ID configured');
            return false;
        }
        
        if (window.fbq) {
            if (DEBUG_MODE) console.log('[Meta Pixel] Already initialized');
            return true;
        }

        try {
            // Pixel initialization code
            (function (f, b, e, v, n, t, s) {
                if (f.fbq) return;
                n = f.fbq = function () {
                    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
                };
                if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
                n.queue = []; t = b.createElement(e); t.async = !0;
                t.src = v; s = b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t, s);
            })(window, document, 'script',
                'https://connect.facebook.net/en_US/fbevents.js');

            window.fbq('init', PIXEL_ID);
            window.fbq('track', 'PageView');

            if (DEBUG_MODE) console.log(`[Meta Pixel] Initialized with Pixel ID: ${PIXEL_ID}`);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] Initialization failed:', error);
            return false;
        }
    }

    /**
     * Fire InitiateCheckout event
     * Triggered when user clicks "Buy Now" or similar checkout button
     */
    window.firePixelInitiateCheckout = function (cartData = {}) {
        if (!window.fbq) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] fbq not initialized for InitiateCheckout');
            initMetaPixel();
            if (!window.fbq) return false;
        }

        const eventData = {
            content_name: 'Checkout Initiated',
            content_category: 'Ecommerce',
            value: parseFloat(cartData.total || 0),
            currency: 'INR',
            contents: (cartData.items || []).map((item) => ({
                id: item.product_id || item.sku || '',
                quantity: item.quantity || 1,
                title: item.name || '',
                item_price: parseFloat(item.price || 0)
            })),
            num_items: (cartData.items || []).length
        };

        try {
            window.fbq('track', 'InitiateCheckout', eventData);
            if (DEBUG_MODE) console.log('[Meta Pixel] InitiateCheckout fired:', eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] InitiateCheckout failed:', error);
            return false;
        }
    };

    /**
     * Fire AddPaymentInfo event
     * Triggered when user initiates payment
     */
    window.firePixelAddPaymentInfo = function (orderData = {}) {
        if (!window.fbq) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] fbq not initialized for AddPaymentInfo');
            initMetaPixel();
            if (!window.fbq) return false;
        }

        const eventData = {
            content_name: 'Payment Info Added',
            content_category: 'Ecommerce',
            value: parseFloat(orderData.total || 0),
            currency: 'INR',
            payment_method: orderData.payment_method || 'Unknown',
            contents: (orderData.items || []).map((item) => ({
                id: item.product_id || item.sku || '',
                quantity: item.quantity || 1,
                title: item.name || '',
                item_price: parseFloat(item.price || 0)
            })),
            num_items: (orderData.items || []).length
        };

        try {
            window.fbq('track', 'AddPaymentInfo', eventData);
            if (DEBUG_MODE) console.log('[Meta Pixel] AddPaymentInfo fired:', eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] AddPaymentInfo failed:', error);
            return false;
        }
    };

    /**
     * Fire Purchase event
     * Triggered when order is successfully placed
     */
    window.firePixelPurchase = function (orderData = {}) {
        if (!window.fbq) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] fbq not initialized for Purchase');
            initMetaPixel();
            if (!window.fbq) return false;
        }

        const eventData = {
            content_name: 'Purchase',
            content_category: 'Ecommerce',
            content_type: 'product',
            value: parseFloat(orderData.total || 0),
            currency: 'INR',
            content_ids: (orderData.items || []).map((item) => item.product_id || item.sku || ''),
            contents: (orderData.items || []).map((item) => ({
                id: item.product_id || item.sku || '',
                quantity: item.quantity || 1,
                title: item.name || '',
                item_price: parseFloat(item.price || 0),
                category: item.category || 'Product'
            })),
            num_items: (orderData.items || []).length,
            delivery_category: 'home_delivery',
            // Shiprocket tracking data
            shiprocket_order_id: orderData.shiprocket_order_id || '',
            shiprocket_shipment_id: orderData.shiprocket_shipment_id || '',
            awb_code: orderData.awb_code || '',
            order_reference: orderData.order_reference || '',
            order_id: orderData.order_id || ''
        };

        try {
            window.fbq('track', 'Purchase', eventData);
            if (DEBUG_MODE) console.log('[Meta Pixel] Purchase fired:', eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] Purchase failed:', error);
            return false;
        }
    };

    /**
     * Fire AddToCart event (for tracking product additions)
     */
    window.firePixelAddToCart = function (product = {}) {
        if (!window.fbq) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] fbq not initialized for AddToCart');
            initMetaPixel();
            if (!window.fbq) return false;
        }

        const eventData = {
            content_name: 'Add to Cart',
            content_category: 'Ecommerce',
            value: parseFloat(product.price || 0),
            currency: 'INR',
            contents: [{
                id: product.product_id || product.sku || '',
                quantity: product.quantity || 1,
                title: product.name || '',
                item_price: parseFloat(product.price || 0)
            }]
        };

        try {
            window.fbq('track', 'AddToCart', eventData);
            if (DEBUG_MODE) console.log('[Meta Pixel] AddToCart fired:', eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] AddToCart failed:', error);
            return false;
        }
    };

    /**
     * Fire ViewContent event (for product page views)
     */
    window.firePixelViewContent = function (product = {}) {
        if (!window.fbq) {
            if (DEBUG_MODE) console.warn('[Meta Pixel] fbq not initialized for ViewContent');
            initMetaPixel();
            if (!window.fbq) return false;
        }

        const eventData = {
            content_name: product.name || 'Product View',
            content_category: product.category || 'Ecommerce',
            content_type: 'product',
            content_ids: [product.product_id || product.sku || ''],
            value: parseFloat(product.price || 0),
            currency: 'INR',
            contents: [{
                id: product.product_id || product.sku || '',
                quantity: 1,
                title: product.name || '',
                item_price: parseFloat(product.price || 0)
            }]
        };

        try {
            window.fbq('track', 'ViewContent', eventData);
            if (DEBUG_MODE) console.log('[Meta Pixel] ViewContent fired:', eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error('[Meta Pixel] ViewContent failed:', error);
            return false;
        }
    };

    /**
     * Get pixel initialization status
     */
    window.getPixelStatus = function () {
        return {
            initialized: !!window.fbq,
            pixelId: PIXEL_ID || 'Not configured',
            debug: DEBUG_MODE
        };
    };

    /**
     * Set pixel ID dynamically (overrides backend configuration)
     */
    window.setMetaPixelId = function (pixelId) {
        if (pixelId && typeof pixelId === 'string') {
            PIXEL_ID = pixelId.trim();
            window.__META_PIXEL_ID__ = PIXEL_ID;
            persistPixelId(PIXEL_ID);
            return initMetaPixel();
        }
        return false;
    };

    // Auto-initialize on script load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initMetaPixel().catch(err => {
                if (DEBUG_MODE) console.error('[Meta Pixel] Initialization error:', err);
            });
        });
    } else {
        initMetaPixel().catch(err => {
            if (DEBUG_MODE) console.error('[Meta Pixel] Initialization error:', err);
        });
    }
})();

