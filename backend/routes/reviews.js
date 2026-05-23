const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// ── Ensure product_reviews table exists ──
let _tableEnsured = false;
async function ensureReviewTables() {
    if (_tableEnsured) return;
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS product_reviews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                product_id INT NOT NULL,
                user_id INT NOT NULL,
                order_id VARCHAR(50) NOT NULL,
                order_item_id INT NOT NULL,
                rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                title VARCHAR(255) DEFAULT NULL,
                review_text TEXT DEFAULT NULL,
                admin_response TEXT DEFAULT NULL,
                status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
                helpful_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_user_order_item (user_id, order_item_id),
                KEY idx_product_status (product_id, status),
                KEY idx_user_id (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        _tableEnsured = true;
    } catch (err) {
        console.error('ensureReviewTables error:', err.message);
    }
}

function isDeliveredOrder(order) {
    const normalizedStatus = String(order?.status || order?.order_status || '').trim().toLowerCase();
    const normalizedShiprocket = String(
        order?.shiprocket_system_status ||
        order?.shiprocket_display_status ||
        order?.shiprocket_tracking_status ||
        order?.shiprocket_status ||
        ''
    ).trim().toUpperCase();

    return normalizedStatus === 'delivered' || normalizedShiprocket === 'DELIVERED';
}

async function loadOrderForReview(orderId, userId) {
    const [rows] = await db.execute(
        `SELECT *
         FROM orders
         WHERE order_id = ? AND user_id = ?`,
        [orderId, userId]
    );
    return rows[0] || null;
}

// ── Helper: recalculate product rating cache ──
async function recalcProductRating(productId) {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS cnt, ROUND(AVG(rating), 1) AS avg_rating
         FROM product_reviews
         WHERE product_id = ? AND status = 'Approved'`,
        [productId]
    );
    const cnt = Number(rows[0]?.cnt) || 0;
    const avg = rows[0]?.avg_rating || null;
    await db.execute(
        `UPDATE products SET avg_rating = ?, review_count = ? WHERE id = ?`,
        [avg, cnt, productId]
    );
}

// ── POST /reviews — Submit a new review ──
router.post('/', auth, async (req, res) => {
    await ensureReviewTables();
    const userId = req.user.userId || req.user.id;
    const { order_id, order_item_id, product_id: bodyProductId, rating, title, review_text } = req.body;

    if (!order_id || !order_item_id || !rating) {
        return res.status(400).json({ success: false, message: 'order_id, order_item_id, and rating are required' });
    }
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    try {
        // Verify order belongs to user and is Delivered
        const order = await loadOrderForReview(order_id, userId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (!isDeliveredOrder(order)) {
            return res.status(400).json({ success: false, message: 'You can only review products from delivered orders' });
        }

        // Get the product_id from order_items
        const [items] = await db.execute(
            `SELECT product_id FROM order_items WHERE order_item_id = ? AND order_id = ?`,
            [order_item_id, order_id]
        );
        if (!items.length) {
            return res.status(404).json({ success: false, message: 'Order item not found' });
        }
        const productId = items[0].product_id;
        if (bodyProductId && Number(bodyProductId) !== Number(productId)) {
            return res.status(400).json({ success: false, message: 'Product does not match the selected order item' });
        }

        // Check for duplicate
        const [existing] = await db.execute(
            `SELECT id FROM product_reviews WHERE user_id = ? AND order_item_id = ?`,
            [userId, order_item_id]
        );
        if (existing.length) {
            return res.status(409).json({ success: false, message: 'You have already reviewed this item' });
        }

        // Insert review
        const [result] = await db.execute(
            `INSERT INTO product_reviews (product_id, user_id, order_id, order_item_id, rating, title, review_text, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved')`,
            [productId, userId, order_id, order_item_id, rating, title || null, review_text || null]
        );

        // Recalculate product rating cache
        await recalcProductRating(productId);

        res.json({ success: true, message: 'Review submitted successfully', reviewId: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'You have already reviewed this item' });
        }
        console.error('POST /reviews error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit review' });
    }
});

// ── GET /products/:id/reviews — Public, paginated ──
router.get('/products/:id/reviews', async (req, res) => {
    await ensureReviewTables();
    const productId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;
    const sort = req.query.sort === 'rating_asc' ? 'pr.rating ASC' :
                 req.query.sort === 'rating_desc' ? 'pr.rating DESC' :
                 req.query.sort === 'helpful' ? 'pr.helpful_count DESC' :
                 'pr.created_at DESC';
    const filterRating = parseInt(req.query.rating) || 0;

    try {
        let whereClause = `pr.product_id = ? AND pr.status = 'Approved'`;
        const params = [productId];

        if (filterRating >= 1 && filterRating <= 5) {
            whereClause += ' AND pr.rating = ?';
            params.push(filterRating);
        }

        const [reviews] = await db.execute(
            `SELECT pr.id, pr.rating, pr.title, pr.review_text, pr.helpful_count,
                    pr.created_at, pr.admin_response,
                    u.name AS reviewer_name
             FROM product_reviews pr
             LEFT JOIN users u ON pr.user_id = u.id
             WHERE ${whereClause}
             ORDER BY ${sort}
             LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        const [countResult] = await db.execute(
            `SELECT COUNT(*) AS total FROM product_reviews pr WHERE ${whereClause}`,
            params
        );

        res.json({
            success: true,
            reviews,
            pagination: {
                page,
                limit,
                total: countResult[0]?.total || 0,
                totalPages: Math.ceil((countResult[0]?.total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('GET /products/:id/reviews error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
});

// ── GET /products/:id/rating-summary — Public ──
router.get('/products/:id/rating-summary', async (req, res) => {
    await ensureReviewTables();
    const productId = req.params.id;

    try {
        const [summary] = await db.execute(
            `SELECT COUNT(*) AS total_reviews, ROUND(AVG(rating), 1) AS avg_rating
             FROM product_reviews
             WHERE product_id = ? AND status = 'Approved'`,
            [productId]
        );
        const [distribution] = await db.execute(
            `SELECT rating, COUNT(*) AS count
             FROM product_reviews
             WHERE product_id = ? AND status = 'Approved'
             GROUP BY rating
             ORDER BY rating DESC`,
            [productId]
        );

        const dist = {};
        for (let i = 1; i <= 5; i++) dist[i] = 0;
        distribution.forEach(row => { dist[row.rating] = row.count; });

        res.json({
            success: true,
            avg_rating: summary[0]?.avg_rating || null,
            total_reviews: summary[0]?.total_reviews || 0,
            distribution: dist
        });
    } catch (err) {
        console.error('GET /products/:id/rating-summary error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch rating summary' });
    }
});

// ── GET /orders/:id/reviewable-items — Auth required ──
router.get('/orders/:id/reviewable-items', auth, async (req, res) => {
    await ensureReviewTables();
    const userId = req.user.userId || req.user.id;
    const orderId = req.params.id;

    try {
        const order = await loadOrderForReview(orderId, userId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const delivered = isDeliveredOrder(order);

        const [items] = await db.execute(
            `SELECT oi.order_item_id, oi.product_id, oi.size, oi.quantity, oi.price,
                    p.name, p.image_url,
                    pr.id AS review_id, pr.rating AS existing_rating, pr.title AS existing_title,
                    pr.review_text AS existing_review_text
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             LEFT JOIN product_reviews pr ON pr.order_item_id = oi.order_item_id AND pr.user_id = ?
             WHERE oi.order_id = ?`,
            [userId, orderId]
        );

        res.json({
            success: true,
            order_status: order.status || order.order_status || '',
            items: items.map(item => ({
                ...item,
                is_reviewed: !!item.review_id,
                can_review: delivered && !item.review_id
            }))
        });
    } catch (err) {
        console.error('GET /orders/:id/reviewable-items error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch reviewable items' });
    }
});

// ── PUT /reviews/:id — Edit own review ──
router.put('/:id', auth, async (req, res) => {
    await ensureReviewTables();
    const userId = req.user.userId || req.user.id;
    const reviewId = req.params.id;
    const { rating, title, review_text } = req.body;

    try {
        const [reviews] = await db.execute(
            `SELECT id, product_id FROM product_reviews WHERE id = ? AND user_id = ?`,
            [reviewId, userId]
        );
        if (!reviews.length) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }
        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
        }

        const updates = [];
        const params = [];
        if (rating) { updates.push('rating = ?'); params.push(rating); }
        if (title !== undefined) { updates.push('title = ?'); params.push(title || null); }
        if (review_text !== undefined) { updates.push('review_text = ?'); params.push(review_text || null); }

        if (!updates.length) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        params.push(reviewId, userId);
        await db.execute(
            `UPDATE product_reviews SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
            params
        );

        await recalcProductRating(reviews[0].product_id);

        res.json({ success: true, message: 'Review updated successfully' });
    } catch (err) {
        console.error('PUT /reviews/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to update review' });
    }
});

// ── DELETE /reviews/:id — Delete own review ──
router.delete('/:id', auth, async (req, res) => {
    await ensureReviewTables();
    const userId = req.user.userId || req.user.id;
    const reviewId = req.params.id;

    try {
        const [reviews] = await db.execute(
            `SELECT id, product_id FROM product_reviews WHERE id = ? AND user_id = ?`,
            [reviewId, userId]
        );
        if (!reviews.length) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        await db.execute(`DELETE FROM product_reviews WHERE id = ? AND user_id = ?`, [reviewId, userId]);
        await recalcProductRating(reviews[0].product_id);

        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (err) {
        console.error('DELETE /reviews/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
});

module.exports = router;
module.exports.ensureReviewTables = ensureReviewTables;

