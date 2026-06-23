const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { ensureInventorySchema, getProductAvailability, normalizeSize } = require('../utils/inventory');

async function validateCartQuantity(productId, size, quantity) {
    await ensureInventorySchema();
    const normalizedSize = normalizeSize(size);
    const availability = await getProductAvailability(productId, normalizedSize);

    if (!availability.product) {
        return { success: false, status: 404, message: 'Product not found' };
    }

    if (availability.hasSizeInventory) {
        if (!normalizedSize) {
            return {
                success: false,
                status: 400,
                message: 'Please select a size',
                availableSizes: availability.availableSizes
            };
        }

        if (!availability.requestedSizeRow || availability.requestedSizeRow.quantity < Number(quantity || 1)) {
            return {
                success: false,
                status: 400,
                message: availability.availableSizes.length
                    ? `Selected size is unavailable. Available sizes: ${availability.availableSizes.join(', ')}`
                    : 'This product is out of stock',
                availableSizes: availability.availableSizes
            };
        }
    } else if ((Number(availability.product.stock) || 0) < Number(quantity || 1)) {
        return { success: false, status: 400, message: 'This product is out of stock' };
    }

    return { success: true, availability, normalizedSize };
}

async function getCartCount(userId) {
    const [countResult] = await db.execute(
        'SELECT SUM(quantity) as total FROM cart WHERE user_id = ?',
        [userId]
    );
    return Number(countResult[0]?.total) || 0;
}

async function getCartItems(userId) {
    await ensureInventorySchema();
    const [items] = await db.execute(
        `SELECT c.id, c.quantity, c.size, 
                p.id as product_id, p.catalog_category_id AS category_id, p.name, p.price, p.original_price,
                p.image_url, p.stock
         FROM cart c
         JOIN products p ON c.product_id = p.id
         WHERE c.user_id = ?
         ORDER BY c.created_at DESC`,
        [userId]
    );

    const enrichedItems = await Promise.all(items.map(async item => {
        const availability = await getProductAvailability(item.product_id, item.size);
        return {
            ...item,
            size_inventory: availability.sizeInventory,
            available_sizes: availability.availableSizes,
            has_size_inventory: availability.hasSizeInventory,
            is_available: availability.hasSizeInventory
                ? !!(availability.requestedSizeRow && availability.requestedSizeRow.quantity >= Number(item.quantity))
                : (Number(availability.product?.stock) || 0) >= Number(item.quantity)
        };
    }));

    const total = enrichedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    return { items: enrichedItems, total };
}

async function upsertCartItem(userId, productId, size, quantity) {
    const normalizedSize = normalizeSize(size) || null;
    const addQuantity = Math.max(1, Math.min(10, Number(quantity) || 1));

    const [existingRows] = await db.execute(
        `SELECT id, quantity FROM cart
         WHERE user_id = ? AND product_id = ? AND (size = ? OR (size IS NULL AND ? IS NULL))
         LIMIT 1`,
        [userId, productId, normalizedSize, normalizedSize]
    );

    const nextQuantity = Math.max(1, Math.min(10, (Number(existingRows[0]?.quantity) || 0) + addQuantity));
    const quantityCheck = await validateCartQuantity(productId, normalizedSize, nextQuantity);
    if (!quantityCheck.success) {
        return quantityCheck;
    }

    if (existingRows.length) {
        await db.execute(
            'UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?',
            [nextQuantity, existingRows[0].id, userId]
        );
    } else {
        await db.execute(
            'INSERT INTO cart (user_id, product_id, quantity, size) VALUES (?, ?, ?, ?)',
            [userId, productId, addQuantity, quantityCheck.normalizedSize || null]
        );
    }

    return { success: true };
}

// POST /add-to-cart (protected)
router.post('/add-to-cart', auth, async (req, res) => {
    const { product_id, quantity = 1, size } = req.body;
    const user_id = req.user.userId;

    if (!product_id) {
        return res.status(400).json({ success: false, message: 'product_id is required' });
    }

    try {
        const cartUpdate = await upsertCartItem(user_id, product_id, size, quantity);
        if (!cartUpdate.success) {
            return res.status(cartUpdate.status).json({
                success: false,
                message: cartUpdate.message,
                availableSizes: cartUpdate.availableSizes || []
            });
        }

        res.json({
            success: true,
            message: 'Added to cart',
            cartCount: await getCartCount(user_id)
        });
    } catch (err) {
        console.error('add-to-cart error:', err);
        
        // Handle Foreign Key Constraint Failure (Stale user token)
        if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid session. Please log in again.' 
            });
        }

        res.status(500).json({ success: false, message: 'Failed to add to cart' });
    }
});

// POST /api/cart/merge (protected)
router.post('/api/cart/merge', auth, async (req, res) => {
    const user_id = req.user.userId;
    const submittedItems = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!submittedItems.length) {
        const cart = await getCartItems(user_id);
        return res.json({
            success: true,
            message: 'No guest cart items to merge',
            items: cart.items,
            total: cart.total,
            cartCount: await getCartCount(user_id)
        });
    }

    try {
        const normalizedItems = submittedItems
            .map(item => ({
                productId: Number(item.productId || item.product_id),
                quantity: Math.max(1, Math.min(10, Number(item.quantity) || 1)),
                size: item.size ? String(item.size).trim() : null
            }))
            .filter(item => item.productId > 0);

        for (const item of normalizedItems) {
            const cartUpdate = await upsertCartItem(user_id, item.productId, item.size, item.quantity);
            if (!cartUpdate.success) {
                return res.status(cartUpdate.status).json({
                    success: false,
                    message: cartUpdate.message,
                    productId: item.productId,
                    availableSizes: cartUpdate.availableSizes || []
                });
            }
        }

        const cart = await getCartItems(user_id);
        res.json({
            success: true,
            message: 'Guest cart merged',
            items: cart.items,
            total: cart.total,
            cartCount: await getCartCount(user_id)
        });
    } catch (err) {
        console.error('POST /api/cart/merge error:', err);
        res.status(500).json({ success: false, message: 'Failed to merge guest cart' });
    }
});

// PUT /cart/:id (protected)
router.put('/cart/:id', auth, async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.userId;
    const quantity = Number(req.body?.quantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    }

    try {
        const [rows] = await db.execute(
            `SELECT c.id, c.product_id, c.size
             FROM cart c
             WHERE c.id = ? AND c.user_id = ?
             LIMIT 1`,
            [id, user_id]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Cart item not found' });
        }

        const cartItem = rows[0];
        const quantityCheck = await validateCartQuantity(cartItem.product_id, cartItem.size, quantity);
        if (!quantityCheck.success) {
            return res.status(quantityCheck.status).json({
                success: false,
                message: quantityCheck.message,
                availableSizes: quantityCheck.availableSizes || []
            });
        }

        await db.execute(
            'UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?',
            [quantity, id, user_id]
        );

        const [countResult] = await db.execute(
            'SELECT SUM(quantity) as total FROM cart WHERE user_id = ?',
            [user_id]
        );

        res.json({
            success: true,
            message: 'Cart quantity updated',
            cartCount: countResult[0].total || 0
        });
    } catch (err) {
        console.error('PUT /cart/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to update cart quantity' });
    }
});

// GET /cart (protected)
router.get('/cart', auth, async (req, res) => {
    const user_id = req.user.userId;

    try {
        const cart = await getCartItems(user_id);
        res.json({ success: true, items: cart.items, total: cart.total });
    } catch (err) {
        console.error('GET /cart error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch cart' });
    }
});

// GET /cart/count (protected)
router.get('/cart/count', auth, async (req, res) => {
    const user_id = req.user.userId;
    try {
        res.json({ success: true, count: await getCartCount(user_id) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get cart count' });
    }
});

// DELETE /cart/:id (protected)
router.delete('/cart/:id', auth, async (req, res) => {
    const { id } = req.params;
    const user_id = req.user.userId;

    try {
        const [result] = await db.execute(
            'DELETE FROM cart WHERE id = ? AND user_id = ?',
            [id, user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Cart item not found' });
        }

        res.json({ success: true, message: 'Item removed from cart' });
    } catch (err) {
        console.error('DELETE /cart/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to remove item' });
    }
});

module.exports = router;
