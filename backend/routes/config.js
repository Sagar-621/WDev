const express = require('express');
const router = express.Router();
const phonepe = require('../services/phonepe');

/**
 * GET /api/config/tracking
 * Returns tracking configuration (Pixel ID) for frontend
 * This is safe to expose publicly as Pixel ID is not sensitive
 */
router.get('/tracking', (req, res) => {
    try {
        const pixelId = process.env.META_PIXEL_ID || null;
        
        res.json({
            success: true,
            meta_pixel_id: pixelId,
            configured: !!pixelId
        });
    } catch (error) {
        console.error('Error fetching tracking config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tracking configuration'
        });
    }
});

/**
 * GET /api/config/payment-gateways
 * Returns available payment gateways configuration
 * This is safe to expose publicly
 */
router.get('/payment-gateways', (req, res) => {
    try {
        const gateways = {
            success: true,
            available: [],
            configured: {}
        };

        // Check PayU configuration
        const payuKey = String(process.env.PAYU_KEY || '').trim();
        const payuSalt = String(process.env.PAYU_SALT || '').trim();
        if (payuKey && payuSalt) {
            gateways.available.push('PayU');
            gateways.configured.payu = {
                name: 'PayU',
                enabled: true,
                description: 'Credit/Debit Card, Wallet, UPI'
            };
        }

        // Check PhonePe configuration
        const phonePeClientId = phonepe.getPhonePeClientId();
        const phonePeClientSecret = phonepe.getPhonePeClientSecret();
        if (phonePeClientId && phonePeClientSecret) {
            gateways.available.push('PhonePe');
            gateways.configured.phonepe = {
                name: 'PhonePe',
                enabled: true,
                description: 'UPI, Card, Wallet',
                apiEndpoint: '/api/phonepe/initiate'
            };
        }

        // Always show COD as available
        gateways.available.push('COD');
        gateways.configured.cod = {
            name: 'Cash on Delivery',
            enabled: true,
            description: 'Pay when product is delivered'
        };

        res.json(gateways);
    } catch (error) {
        console.error('Error fetching payment gateways config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment gateways configuration'
        });
    }
});

module.exports = router;

