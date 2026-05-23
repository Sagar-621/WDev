/**
 * DEVASTHRA — Coupon Routes (Admin CRUD + Public Validation)
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const adminAuth = require('../middleware/adminAuth');
const auth = require('../middleware/auth');

function normalizeCoupon(row) {
    return {
        ...row,
        scope_ids: row.scope_ids ? JSON.parse(row.scope_ids) : [],
        is_active: !!row.is_active,
        send_in_newsletter: !!row.send_in_newsletter
    };
}

function getStartOfDay(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
}

function getEndOfDay(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(23, 59, 59, 999);
    return date;
}

// ── Audit Log Helper ──
async function logAudit(req, { action, entityType, entityId, description }) {
    try {
        const adminId = req.admin ? req.admin.adminId : null;
        const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '';
        const ua = (req.headers['user-agent'] || '').substring(0, 500);
        await db.execute(
            `INSERT INTO audit_logs (admin_id, user_id, action, entity_type, entity_id, description, ip_address, user_agent)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
            [adminId, action, entityType, entityId || null, description || null, ip, ua]
        );
    } catch (err) { console.error('Coupon audit log error:', err.message); }
}

// ═══════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════

// GET all coupons
router.get('/admin/coupons', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM coupons ORDER BY created_at DESC');
        res.json({ success: true, coupons: rows.map(normalizeCoupon) });
    } catch (err) {
        console.error('Admin coupon list error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
    }
});

// POST — create coupon
router.post('/admin/coupons', adminAuth, async (req, res) => {
    try {
        const { code, discount_type, discount_value, max_discount, min_order_value,
            scope, scope_ids, usage_limit, per_user_limit, start_date, end_date, is_active, send_in_newsletter } = req.body;

        if (!code || !discount_value) {
            return res.status(400).json({ success: false, message: 'Code and discount value are required' });
        }

        await db.execute(
            `INSERT INTO coupons (code, discount_type, discount_value, max_discount, min_order_value,
                scope, scope_ids, usage_limit, per_user_limit, start_date, end_date, is_active, send_in_newsletter)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [code.toUpperCase().trim(), discount_type || 'percentage', discount_value,
            max_discount || null, min_order_value || 0, scope || 'all',
            scope_ids ? JSON.stringify(scope_ids) : null, usage_limit || null,
            per_user_limit || 1, start_date || null, end_date || null,
            is_active !== false ? 1 : 0, send_in_newsletter ? 1 : 0]
        );

        await logAudit(req, { action: 'CREATE', entityType: 'coupon', description: `Created coupon: ${code}` });
        res.json({ success: true, message: 'Coupon created successfully' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'A coupon with this code already exists' });
        }
        console.error('Admin coupon create error:', err);
        res.status(500).json({ success: false, message: 'Failed to create coupon' });
    }
});

// PUT — update coupon
router.put('/admin/coupons/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['code', 'discount_type', 'discount_value', 'max_discount', 'min_order_value',
            'scope', 'scope_ids', 'usage_limit', 'per_user_limit', 'start_date', 'end_date', 'is_active', 'send_in_newsletter'];
        const updates = [];
        const values = [];

        for (const key of allowed) {
            if (fields[key] !== undefined) {
                updates.push(`${key} = ?`);
                let val = fields[key];
                if (key === 'is_active' || key === 'send_in_newsletter') val = val ? 1 : 0;
                if (key === 'scope_ids' && Array.isArray(val)) val = JSON.stringify(val);
                if (key === 'code') val = String(val).toUpperCase().trim();
                values.push(val);
            }
        }

        if (!updates.length) return res.status(400).json({ success: false, message: 'No fields to update' });

        values.push(id);
        await db.execute(`UPDATE coupons SET ${updates.join(', ')} WHERE id = ?`, values);
        await logAudit(req, { action: 'UPDATE', entityType: 'coupon', entityId: id, description: `Updated coupon #${id}` });
        res.json({ success: true, message: 'Coupon updated' });
    } catch (err) {
        console.error('Admin coupon update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update coupon' });
    }
});

// DELETE coupon
router.delete('/admin/coupons/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await db.execute('DELETE FROM coupons WHERE id = ?', [id]);
        await logAudit(req, { action: 'DELETE', entityType: 'coupon', entityId: id, description: `Deleted coupon #${id}` });
        res.json({ success: true, message: 'Coupon deleted' });
    } catch (err) {
        console.error('Admin coupon delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete coupon' });
    }
});

// ═══════════════════════════════════════
// PUBLIC — VALIDATE COUPON AT CHECKOUT
// ═══════════════════════════════════════

router.post('/api/coupons/validate', auth, async (req, res) => {
    try {
        const { code, cart_total, product_ids, category_ids } = req.body;
        const userId = req.user.userId;

        if (!code) return res.status(400).json({ success: false, message: 'Coupon code is required' });

        const [coupons] = await db.execute(
            'SELECT * FROM coupons WHERE code = ? AND is_active = TRUE LIMIT 1',
            [code.toUpperCase().trim()]
        );

        if (!coupons.length) {
            return res.json({ success: false, message: 'Invalid or expired coupon code' });
        }

        const coupon = coupons[0];
        const now = new Date();
        const startDate = getStartOfDay(coupon.start_date);
        const endDate = getEndOfDay(coupon.end_date);

        // Check date validity
        if (startDate && startDate > now) {
            return res.json({ success: false, message: 'This coupon is not yet active' });
        }
        if (endDate && endDate < now) {
            return res.json({ success: false, message: 'This coupon has expired' });
        }

        // Check usage limit
        if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
            return res.json({ success: false, message: 'This coupon has reached its usage limit' });
        }

        // Check per-user limit
        const [userUsage] = await db.execute(
            'SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND user_id = ?',
            [coupon.id, userId]
        );
        if (coupon.per_user_limit && userUsage[0].cnt >= coupon.per_user_limit) {
            return res.json({ success: false, message: 'You have already used this coupon' });
        }

        // Check minimum order value
        const total = parseFloat(cart_total) || 0;
        if (coupon.min_order_value && total < coupon.min_order_value) {
            return res.json({ success: false, message: `Minimum order value of ₹${coupon.min_order_value} required` });
        }

        // Check scope (category/product targeting)
        if (coupon.scope !== 'all' && coupon.scope_ids) {
            const scopeIds = JSON.parse(coupon.scope_ids);
            if (coupon.scope === 'product' && product_ids) {
                const match = product_ids.some(pid => scopeIds.includes(pid));
                if (!match) return res.json({ success: false, message: 'This coupon is not valid for items in your cart' });
            }
            if (coupon.scope === 'category' && category_ids) {
                const match = category_ids.some(cid => scopeIds.includes(cid));
                if (!match) return res.json({ success: false, message: 'This coupon is not valid for your cart categories' });
            }
        }

        // Calculate discount
        let discount = 0;
        if (coupon.discount_type === 'flat') {
            discount = Math.min(coupon.discount_value, total);
        } else {
            discount = total * (coupon.discount_value / 100);
            if (coupon.max_discount) {
                discount = Math.min(discount, coupon.max_discount);
            }
        }

        discount = Math.round(discount * 100) / 100;

        res.json({
            success: true,
            valid: true,
            coupon: {
                id: coupon.id,
                code: coupon.code,
                discount_type: coupon.discount_type,
                discount_value: coupon.discount_value,
                max_discount: coupon.max_discount
            },
            discount_amount: discount,
            final_total: Math.max(0, total - discount),
            message: `Coupon applied! You save ₹${discount.toLocaleString('en-IN')}`
        });
    } catch (err) {
        console.error('Coupon validate error:', err);
        res.status(500).json({ success: false, message: 'Failed to validate coupon' });
    }
});

module.exports = router;

