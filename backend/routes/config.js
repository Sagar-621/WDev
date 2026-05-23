const express = require('express');
const router = express.Router();

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

module.exports = router;

