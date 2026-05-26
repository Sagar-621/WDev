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

    function ensureFbq() {
        if (window.fbq) return true;
        return initMetaPixel();
    }

    function normalizeItems(items = []) {
        return (items || []).map((item) => ({
            id: item.product_id || item.sku || item.id || '',
            quantity: Number(item.quantity) || 1,
            item_price: Number(item.price ?? item.item_price ?? 0) || 0,
            category: item.category || 'Product',
            name: item.name || ''
        }));
    }

    function trackEvent(eventName, eventData = {}) {
        if (!ensureFbq() || !window.fbq) return false;

        try {
            window.fbq('track', eventName, eventData);
            return true;
        } catch (error) {
            if (DEBUG_MODE) console.error(`[Meta Pixel] ${eventName} failed:`, error);
            return false;
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
        if (!ensureFbq()) return false;
        const items = normalizeItems(cartData.items);
        const eventData = {
            content_name: cartData.content_name || 'Checkout Initiated',
            content_category: 'Ecommerce',
            value: parseFloat(cartData.total || 0),
            currency: 'INR',
            content_type: 'product',
            content_ids: items.map((item) => item.id).filter(Boolean),
            contents: items.map(({ id, quantity, item_price }) => ({ id, quantity, item_price })),
            num_items: items.length,
            coupon_code: cartData.coupon_code || ''
        };

        const fired = trackEvent('InitiateCheckout', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] InitiateCheckout fired:', eventData);
        return fired;
    };

    /**
     * Fire AddPaymentInfo event
     * Triggered when user initiates payment
     */
    window.firePixelAddPaymentInfo = function (orderData = {}) {
        if (!ensureFbq()) return false;
        const items = normalizeItems(orderData.items);
        const eventData = {
            content_name: orderData.content_name || 'Payment Info Added',
            content_category: 'Ecommerce',
            value: parseFloat(orderData.total || 0),
            currency: 'INR',
            payment_method: orderData.payment_method || 'Unknown',
            content_type: 'product',
            content_ids: items.map((item) => item.id).filter(Boolean),
            contents: items.map(({ id, quantity, item_price }) => ({ id, quantity, item_price })),
            num_items: items.length
        };

        const fired = trackEvent('AddPaymentInfo', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] AddPaymentInfo fired:', eventData);
        return fired;
    };

    /**
     * Fire Purchase event
     * Triggered when order is successfully placed
     */
    window.firePixelPurchase = function (orderData = {}) {
        if (!ensureFbq()) return false;
        const items = normalizeItems(orderData.items);
        const eventData = {
            content_name: orderData.content_name || 'Purchase',
            content_category: 'Ecommerce',
            content_type: 'product',
            value: parseFloat(orderData.total || 0),
            currency: 'INR',
            content_ids: items.map((item) => item.id).filter(Boolean),
            contents: items.map(({ id, quantity, item_price }) => ({ id, quantity, item_price })),
            num_items: items.length,
            delivery_category: 'home_delivery',
            // Shiprocket tracking data
            shiprocket_order_id: orderData.shiprocket_order_id || '',
            shiprocket_shipment_id: orderData.shiprocket_shipment_id || '',
            awb_code: orderData.awb_code || '',
            order_reference: orderData.order_reference || '',
            order_id: orderData.order_id || ''
        };

        const fired = trackEvent('Purchase', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] Purchase fired:', eventData);
        return fired;
    };

    /**
     * Fire AddToCart event (for tracking product additions)
     */
    window.firePixelAddToCart = function (product = {}) {
        if (!ensureFbq()) return false;
        const eventData = {
            content_name: product.name || 'Add to Cart',
            content_category: 'Ecommerce',
            value: parseFloat(product.price || 0),
            currency: 'INR',
            content_type: 'product',
            content_ids: [product.product_id || product.sku || product.id || ''].filter(Boolean),
            contents: [{
                id: product.product_id || product.sku || '',
                quantity: product.quantity || 1,
                item_price: parseFloat(product.price || 0)
            }],
            num_items: Number(product.quantity) || 1
        };

        const fired = trackEvent('AddToCart', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] AddToCart fired:', eventData);
        return fired;
    };

    /**
     * Fire ViewContent event (for product page views)
     */
    window.firePixelViewContent = function (product = {}) {
        if (!ensureFbq()) return false;
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
                item_price: parseFloat(product.price || 0)
            }],
            num_items: 1
        };

        const fired = trackEvent('ViewContent', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] ViewContent fired:', eventData);
        return fired;
    };

    window.firePixelLead = function (leadData = {}) {
        if (!ensureFbq()) return false;
        const eventData = {
            content_name: leadData.content_name || 'Lead',
            content_category: leadData.content_category || 'Lead',
            content_type: leadData.content_type || 'lead',
            value: parseFloat(leadData.value || 0),
            currency: leadData.currency || 'INR',
            email: leadData.email || '',
            source: leadData.source || '',
            status: leadData.status || 'submitted'
        };
        const fired = trackEvent('Lead', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] Lead fired:', eventData);
        return fired;
    };

    window.firePixelContact = function (contactData = {}) {
        if (!ensureFbq()) return false;
        const eventData = {
            content_name: contactData.content_name || 'Contact',
            content_category: contactData.content_category || 'Customer Support',
            content_type: contactData.content_type || 'contact',
            value: parseFloat(contactData.value || 0),
            currency: contactData.currency || 'INR',
            method: contactData.method || 'form',
            email: contactData.email || ''
        };
        const fired = trackEvent('Contact', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] Contact fired:', eventData);
        return fired;
    };

    window.firePixelCompleteRegistration = function (registrationData = {}) {
        if (!ensureFbq()) return false;
        const eventData = {
            content_name: registrationData.content_name || 'Complete Registration',
            content_category: registrationData.content_category || 'Registration',
            content_type: registrationData.content_type || 'registration',
            value: parseFloat(registrationData.value || 0),
            currency: registrationData.currency || 'INR',
            method: registrationData.method || 'otp'
        };
        const fired = trackEvent('CompleteRegistration', eventData);
        if (DEBUG_MODE && fired) console.log('[Meta Pixel] CompleteRegistration fired:', eventData);
        return fired;
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
