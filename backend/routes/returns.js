const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendReturnRequestNotification, sendExchangeRequestNotification } = require('../services/mailer');
const { sendTransactionalSms } = require('../services/sms');
const shiprocket = require('../services/shiprocket');

function getReturnExchangeServiceCharge(city) {
    const normalized = String(city || '').trim().toLowerCase();
    return normalized.includes('hyderabad') ? 49 : 59;
}

function parseSafeDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getEffectiveShiprocketStatus(order) {
    const normalized = shiprocket.normalizeShiprocketStatus(
        order?.shiprocket_system_status ||
        order?.shiprocket_display_status ||
        order?.shiprocket_tracking_status ||
        order?.shiprocket_latest_activity ||
        order?.shiprocket_status ||
        order?.status ||
        '',
        order?.shiprocket_latest_activity || ''
    );

    return normalized.display_status || normalized.system_status || String(order?.status || '').trim();
}

function isDeliveredOrder(order) {
    const status = getEffectiveShiprocketStatus(order).trim().toUpperCase();
    return status === 'DELIVERED' || status.includes('DELIVERED');
}

function getEffectiveDeliveryDate(order) {
    const deliveryDate = parseSafeDate(order?.delivery_date);
    if (deliveryDate) return deliveryDate;

    if (!isDeliveredOrder(order)) {
        return null;
    }

    return parseSafeDate(order?.shiprocket_latest_activity_at) || new Date();
}

function getReturnDeadline(order, returnWindowDays) {
    const baseDate = getEffectiveDeliveryDate(order);
    if (!baseDate) return null;

    const windowDays = Number.parseInt(returnWindowDays, 10);
    const safeWindowDays = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 0;
    const deadline = new Date(baseDate);
    deadline.setDate(deadline.getDate() + safeWindowDays);
    deadline.setHours(23, 59, 59, 999);
    return deadline;
}

function getDaysRemaining(deadline, today = new Date()) {
    if (!deadline) return 0;
    const currentDay = new Date(today);
    currentDay.setHours(0, 0, 0, 0);

    const normalizedDeadline = new Date(deadline);
    normalizedDeadline.setHours(23, 59, 59, 999);

    return Math.ceil((normalizedDeadline - currentDay) / (1000 * 60 * 60 * 24));
}

async function ensureReturnExchangeChargeColumns() {
    const columns = [
        ['return_requests', 'shipping_charge', 'DECIMAL(10,2) NULL'],
        ['return_requests', 'net_refund_amount', 'DECIMAL(10,2) NULL'],
        ['return_requests', 'shiprocket_return_order_id', 'VARCHAR(50) NULL'],
        ['return_requests', 'shiprocket_return_shipment_id', 'VARCHAR(50) NULL'],
        ['return_requests', 'shiprocket_awb_code', 'VARCHAR(50) NULL'],
        ['return_requests', 'shiprocket_courier_name', 'VARCHAR(120) NULL'],
        ['return_requests', 'shiprocket_status', "VARCHAR(120) NULL"],
        ['return_requests', 'shiprocket_tracking_status', "VARCHAR(120) NULL"],
        ['return_requests', 'shiprocket_latest_activity', 'VARCHAR(255) NULL'],
        ['return_requests', 'shiprocket_latest_activity_at', 'DATETIME NULL'],
        ['return_requests', 'shiprocket_tracking_json', 'LONGTEXT NULL'],
        ['return_requests', 'shiprocket_pickup_scheduled', 'BOOLEAN DEFAULT FALSE'],
        ['return_requests', 'pickup_token_number', 'VARCHAR(80) NULL'],
        ['return_requests', 'pickup_scheduled_at', 'DATETIME NULL'],
        ['return_requests', 'picked_up_at', 'DATETIME NULL'],
        ['return_requests', 'delivered_at', 'DATETIME NULL'],
        ['exchange_requests', 'shipping_charge', 'DECIMAL(10,2) NULL']
    ];

    for (const [tableName, columnName, definition] of columns) {
        const [rows] = await db.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = ?
               AND COLUMN_NAME = ?`,
            [tableName, columnName]
        );

        if (!rows.length) {
            await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    }
}

async function ensureExchangeTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS exchange_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            order_item_id INT NOT NULL,
            user_id INT NOT NULL,
            product_id INT NULL,
            product_name VARCHAR(200) NULL,
            requested_size VARCHAR(20) NULL,
            reason VARCHAR(120) NOT NULL,
            reason_detail TEXT NULL,
            status ENUM(
                'Requested','Approved','Rejected',
                'Exchange Approved','Re-shipped','Exchange Completed'
            ) DEFAULT 'Requested',
            admin_remarks TEXT NULL,
            shiprocket_exchange_order_id VARCHAR(100) NULL,
            replacement_order_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_exchange_order (order_id),
            INDEX idx_exchange_item (order_item_id),
            INDEX idx_exchange_user (user_id),
            INDEX idx_exchange_status (status)
        )
    `);

    await ensureReturnExchangeChargeColumns();
}

// ── Multer config for return proof images ──
const returnStorage = multer.diskStorage({
    destination(req, file, cb) {
        const dir = path.join(__dirname, '..', 'uploads', 'returns');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, `return_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
});
const upload = multer({
    storage: returnStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const ok = /jpeg|jpg|png|webp/.test(file.mimetype);
        cb(ok ? null : new Error('Images only'), ok);
    }
});

// =========================================
// GET /returns/eligibility/:orderId
// Check return eligibility for all items in an order
// =========================================
router.get('/eligibility/:orderId', auth, async (req, res) => {
    const userId = req.user.userId;
    const orderId = req.params.orderId;

    try {
        await ensureExchangeTables();
        // Get order with return deadline
        const [orders] = await db.execute(
            `SELECT o.order_id, o.status, o.delivery_date, o.return_eligible_until, o.total_amount,
                    o.shiprocket_status, o.shiprocket_tracking_status, o.shiprocket_latest_activity,
                    o.shiprocket_latest_activity_at,
                    COALESCE(oa.city, u.city, '') AS city
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [orderId, userId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        const effectiveStatus = getEffectiveShiprocketStatus(order);

        // Get order items with product return info
        const [items] = await db.execute(
            `SELECT oi.order_item_id, oi.product_id, oi.quantity, oi.size, oi.price,
                    p.name, p.image_url, p.is_returnable, p.return_window_days
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        // Check existing returns for these items
        const [existingReturns] = await db.execute(
            `SELECT order_item_id, status FROM return_requests WHERE order_id = ?`,
            [orderId]
        );
        const returnMap = {};
        existingReturns.forEach(r => { returnMap[r.order_item_id] = r.status; });

        const [existingExchanges] = await db.execute(
            `SELECT order_item_id, status FROM exchange_requests WHERE order_id = ?`,
            [orderId]
        );
        const exchangeMap = {};
        existingExchanges.forEach((row) => { exchangeMap[row.order_item_id] = row.status; });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const eligibility = items.map(item => {
            const hasReturn = returnMap[item.order_item_id];
            const hasExchange = exchangeMap[item.order_item_id];
            let eligible = false;
            let reason = '';
            let daysLeft = 0;
            const deadline = getReturnDeadline(order, item.return_window_days);

            if (hasReturn) {
                reason = `Return already ${hasReturn.toLowerCase()}`;
            } else if (hasExchange) {
                reason = `Exchange already ${hasExchange.toLowerCase()}`;
            } else if (!isDeliveredOrder(order)) {
                reason = `Order is ${effectiveStatus || 'not yet delivered'}`;
            } else if (!item.is_returnable) {
                reason = 'This product is non-returnable';
            } else if (!deadline) {
                reason = 'Delivery date not available';
            } else {
                daysLeft = getDaysRemaining(deadline, today);
                if (daysLeft > 0) {
                    eligible = true;
                    reason = `${daysLeft} day${daysLeft > 1 ? 's' : ''} left to return`;
                } else {
                    reason = 'Return window has expired';
                }
            }

            return {
                order_item_id: item.order_item_id,
                product_id: item.product_id,
                name: item.name,
                image_url: item.image_url,
                size: item.size,
                quantity: item.quantity,
                price: item.price,
                is_returnable: item.is_returnable,
                return_window_days: item.return_window_days,
                return_eligible_until: deadline ? deadline.toISOString().split('T')[0] : null,
                eligible,
                reason,
                days_left: daysLeft,
                existing_return_status: hasReturn || null,
                existing_exchange_status: hasExchange || null
            };
        });

        const serviceCharge = getReturnExchangeServiceCharge(order.city);

        res.json({
            success: true,
            order_id: order.order_id,
            order_status: effectiveStatus || order.status,
            shiprocket_status: order.shiprocket_status || '',
            shiprocket_tracking_status: order.shiprocket_tracking_status || '',
            shiprocket_latest_activity: order.shiprocket_latest_activity || '',
            shiprocket_latest_activity_at: order.shiprocket_latest_activity_at || null,
            delivery_date: order.delivery_date,
            return_eligible_until: order.return_eligible_until,
            service_charge: serviceCharge,
            items: eligibility
        });
    } catch (err) {
        console.error('return eligibility error:', err);
        res.status(500).json({ success: false, message: 'Failed to check eligibility' });
    }
});

router.post('/exchange-request', auth, async (req, res) => {
    const userId = req.user.userId;
    const { order_id, order_item_id, reason, reason_detail, requested_size } = req.body || {};

    if (!order_id || !order_item_id || !reason) {
        return res.status(400).json({ success: false, message: 'order_id, order_item_id and reason are required' });
    }

    try {
        await ensureExchangeTables();

        const [orders] = await db.execute(
            `SELECT o.order_id, o.status, o.delivery_date, o.return_eligible_until,
                    o.shiprocket_status, o.shiprocket_tracking_status, o.shiprocket_latest_activity,
                    o.shiprocket_latest_activity_at,
                    COALESCE(oa.city, u.city, '') AS city
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [order_id, userId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        const effectiveStatus = getEffectiveShiprocketStatus(order);
        if (!isDeliveredOrder(order)) {
            return res.status(400).json({
                success: false,
                message: `Exchanges can only be requested after delivery (current status: ${effectiveStatus || 'Unknown'})`
            });
        }

        const serviceCharge = getReturnExchangeServiceCharge(order.city);

        const [items] = await db.execute(
            `SELECT oi.order_item_id, oi.product_id, oi.size, p.name, p.is_returnable, p.return_window_days
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = ? AND oi.order_item_id = ?`,
            [order_id, order_item_id]
        );

        if (!items.length) {
            return res.status(404).json({ success: false, message: 'Order item not found' });
        }

        const item = items[0];
        if (!item.is_returnable) {
            return res.status(400).json({ success: false, message: 'This product is non-returnable' });
        }

        const deadline = getReturnDeadline(order, item.return_window_days);
        if (!deadline) {
            return res.status(400).json({ success: false, message: 'Delivery date not available' });
        }

        const daysLeft = getDaysRemaining(deadline);
        if (daysLeft <= 0) {
            return res.status(400).json({ success: false, message: 'Exchange window has expired' });
        }

        const [existing] = await db.execute(
            `SELECT id
             FROM exchange_requests
             WHERE order_id = ? AND order_item_id = ? AND status IN ('Requested','Approved','Exchange Approved','Re-shipped')`,
            [order_id, order_item_id]
        );

        if (existing.length) {
            return res.status(409).json({ success: false, message: 'An exchange request already exists for this item' });
        }

        await db.execute(
            `INSERT INTO exchange_requests
             (order_id, order_item_id, user_id, product_id, product_name, requested_size, reason, reason_detail, shipping_charge, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Requested')`,
            [
                order_id,
                order_item_id,
                userId,
                item.product_id,
                item.name || null,
                requested_size || item.size || null,
                String(reason).trim(),
                String(reason_detail || '').trim() || null,
                serviceCharge
            ]
        );

        const [[userRow]] = await db.execute(
            'SELECT name, email, mobile_number FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const [[orderRefRow]] = await db.execute(
            'SELECT invoice_number FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1',
            [order_id, userId]
        );

        sendExchangeRequestNotification({
            orderId: Number(order_id),
            orderReference: orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`,
            customerName: userRow?.name || 'Customer',
            customerEmail: userRow?.email || '',
            customerPhone: userRow?.mobile_number || '',
            productName: item.name || '',
            requestedSize: requested_size || item.size || '',
            reason: String(reason).trim(),
            reasonDetail: String(reason_detail || '').trim()
        }).catch((mailErr) => {
            console.error(`Exchange request email failed for Order #${order_id}:`, mailErr.message);
        });

        sendTransactionalSms({
            mobile: userRow?.mobile_number || '',
            purpose: 'return',
            message: `Your DEVASTHRA exchange request for Order ${orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`} has been received. Our team will review it shortly.`
        }).catch((smsErr) => {
            console.error(`Exchange request SMS failed for Order #${order_id}:`, smsErr.message);
        });

        res.json({ success: true, message: 'Exchange request submitted successfully' });
    } catch (err) {
        console.error('exchange request error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit exchange request' });
    }
});

// =========================================
// POST /returns/request
// Submit a return request
// =========================================
router.post('/request', auth, upload.array('proof_images', 5), async (req, res) => {
    const userId = req.user.userId;
    const { order_id, order_item_id, reason, sub_reason, description } = req.body;

    if (!order_id || !order_item_id || !reason) {
        return res.status(400).json({ success: false, message: 'order_id, order_item_id, and reason are required' });
    }

    try {
        // Verify order belongs to user and is delivered
        const [orders] = await db.execute(
            `SELECT o.order_id, o.status, o.delivery_date, o.return_eligible_until,
                    o.shiprocket_status, o.shiprocket_tracking_status, o.shiprocket_latest_activity,
                    o.shiprocket_latest_activity_at,
                    COALESCE(oa.city, u.city, '') AS city
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [order_id, userId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        const effectiveStatus = getEffectiveShiprocketStatus(order);
        if (!isDeliveredOrder(order)) {
            return res.status(400).json({
                success: false,
                message: `Returns can only be requested after delivery (current status: ${effectiveStatus || 'Unknown'})`
            });
        }

        // Verify item belongs to order and is returnable
        const serviceCharge = getReturnExchangeServiceCharge(order.city);

        const [items] = await db.execute(
            `SELECT oi.order_item_id, oi.price, oi.quantity, p.name, p.is_returnable, p.return_window_days
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_item_id = ? AND oi.order_id = ?`,
            [order_item_id, order_id]
        );

        if (!items.length) {
            return res.status(404).json({ success: false, message: 'Order item not found' });
        }

        if (!items[0].is_returnable) {
            return res.status(400).json({ success: false, message: 'This product is non-returnable' });
        }

        const deadline = getReturnDeadline(order, items[0].return_window_days);
        if (!deadline) {
            return res.status(400).json({ success: false, message: 'Delivery date not available' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (today > deadline) {
            return res.status(400).json({ success: false, message: 'Return window has expired' });
        }

        // Check for duplicate return
        const [existing] = await db.execute(
            `SELECT id FROM return_requests WHERE order_item_id = ? AND status NOT IN ('Rejected','Closed')`,
            [order_item_id]
        );

        if (existing.length) {
            return res.status(400).json({ success: false, message: 'A return request already exists for this item' });
        }

        // Build proof images array
        const proofImages = req.files ? req.files.map(f => `uploads/returns/${f.filename}`) : [];
        const grossAmount = items[0].price * items[0].quantity;
        const refundAmount = Math.max(Number(grossAmount || 0) - Number(serviceCharge || 0), 0);

        const conn = await db.getConnection();
        let returnInsertResult;
        try {
            await conn.beginTransaction();

            [returnInsertResult] = await conn.execute(
                `INSERT INTO return_requests
                 (order_id, order_item_id, user_id, product_name, reason, sub_reason, description, proof_images, shipping_charge, net_refund_amount, refund_amount, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Requested')`,
                [
                    order_id, order_item_id, userId, items[0].name,
                    reason, sub_reason || null, description || null,
                    JSON.stringify(proofImages), serviceCharge, refundAmount, refundAmount
                ]
            );

            await conn.execute(
                `UPDATE orders
                 SET status = 'Return Requested'
                 WHERE order_id = ? AND user_id = ?`,
                [order_id, userId]
            );

            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        const [[userRow]] = await db.execute(
            'SELECT name, email, mobile_number FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        const [[orderRefRow]] = await db.execute(
            'SELECT invoice_number FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1',
            [order_id, userId]
        );

        sendReturnRequestNotification({
            orderId: Number(order_id),
            orderReference: orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`,
            customerName: userRow?.name || 'Customer',
            customerEmail: userRow?.email || '',
            customerPhone: userRow?.mobile_number || '',
            productName: items[0].name || '',
            reason,
            reasonDetail: sub_reason || '',
            description: description || ''
        }).catch((mailErr) => {
            console.error(`Return request email failed for Order #${order_id}:`, mailErr.message);
        });

        sendTransactionalSms({
            mobile: userRow?.mobile_number || '',
            purpose: 'return',
            message: `Your DEVASTHRA return request for Order ${orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`} has been received. Our team will review it shortly.`
        }).catch((smsErr) => {
            console.error(`Return request SMS failed for Order #${order_id}:`, smsErr.message);
        });

        res.json({
            success: true,
            message: 'Return request submitted successfully',
            return_id: returnInsertResult.insertId,
            refund_amount: refundAmount,
            shipping_charge: serviceCharge
        });
    } catch (err) {
        console.error('return request error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit return request' });
    }
});

// =========================================
// GET /returns/my-returns
// User's return history
// =========================================
router.get('/my-returns', auth, async (req, res) => {
    const userId = req.user.userId;

    try {
        const [returns] = await db.execute(
            `SELECT rr.*, oi.size, oi.quantity, p.image_url
             FROM return_requests rr
             JOIN order_items oi ON rr.order_item_id = oi.order_item_id
             JOIN products p ON oi.product_id = p.id
             WHERE rr.user_id = ?
             ORDER BY rr.created_at DESC`,
            [userId]
        );

        res.json({ success: true, returns });
    } catch (err) {
        console.error('my-returns error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch returns' });
    }
});

// =========================================
// GET /returns/:id/status
// Track a specific return
// =========================================
router.get('/:id/status', auth, async (req, res) => {
    const userId = req.user.userId;

    try {
        const [returns] = await db.execute(
            `SELECT rr.*, oi.size, oi.quantity, p.image_url
             FROM return_requests rr
             JOIN order_items oi ON rr.order_item_id = oi.order_item_id
             JOIN products p ON oi.product_id = p.id
             WHERE rr.id = ? AND rr.user_id = ?`,
            [req.params.id, userId]
        );

        if (!returns.length) {
            return res.status(404).json({ success: false, message: 'Return not found' });
        }

        res.json({ success: true, return_request: returns[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch return status' });
    }
});

module.exports = router;

