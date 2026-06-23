const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const axios = require('axios');
const shiprocket = require('../services/shiprocket');
const phonepe = require('../services/phonepe');
const { sendTransactionalSms } = require('../services/sms');
const {
    initiatePayuRefund,
    checkRefundStatusByRequestId,
    checkRefundStatusByPayuId,
    classifyRefundStatus
} = require('../services/payuRefund');
const { sendOrderConfirmationEmail, sendAdminOrderNotification, sendCancellationRequestNotification, sendRefundStatusNotification } = require('../services/mailer');
const {
    ensureInventorySchema,
    reserveInventoryForItems,
    restockInventoryForItems
} = require('../utils/inventory');

let addressTablesReady = false;
let orderColumnsReady = false;
let orderReferenceSettingsReady = false;
let cachedOrderReferenceSettings = null;
const CANCELLATION_REASONS = new Set([
    'Ordered by mistake',
    'Found cheaper elsewhere',
    'Delivery time too long',
    'Change in address',
    'Payment issue',
    'Other'
]);

function normalizeDob(value) {
    const dob = String(value || '').trim();
    if (!dob) return '';
    const match = dob.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    const dateOnly = match[1];

    const parsed = new Date(`${dateOnly}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;

    const [year, month, day] = dateOnly.split('-').map(Number);
    const isSameDate =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day;

    return isSameDate ? dateOnly : null;
}

async function ensureAddressTables() {
    addressTablesReady = true;
}

async function migrateLegacyAddressIfNeeded(userId) {
    await ensureAddressTables();

    const [existing] = await db.execute(
        'SELECT id FROM user_addresses WHERE user_id = ? LIMIT 1',
        [userId]
    );
    if (existing.length > 0) return;

    const [users] = await db.execute(
        `SELECT name, mobile_number, address_line, city, state, pincode
         FROM users WHERE id = ?`,
        [userId]
    );
    const legacy = users[0];
    if (!legacy || !legacy.address_line || !legacy.city || !legacy.state || !legacy.pincode) return;

    await db.execute(
        `INSERT INTO user_addresses
         (user_id, name, mobile, address_line, city, state, pincode, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
            userId,
            legacy.name || '',
            legacy.mobile_number || '',
            legacy.address_line,
            legacy.city,
            legacy.state,
            legacy.pincode
        ]
    );
}

async function ensureOrderColumns() {
    if (orderColumnsReady) return;

    const columns = [
        ['cancellation_request_status', "ENUM('None','Requested','Approved','Rejected') NOT NULL DEFAULT 'None'"],
        ['cancellation_reason', 'VARCHAR(120) NULL'],
        ['cancellation_reason_detail', 'TEXT NULL'],
        ['cancellation_requested_at', 'DATETIME NULL'],
        ['cancellation_reviewed_at', 'DATETIME NULL']
    ];

    for (const [name, definition] of columns) {
        const [rows] = await db.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'orders'
               AND COLUMN_NAME = ?`,
            [name]
        );
        if (!rows.length) {
            await db.execute(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
        }
    }

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

    await db.execute(`
        CREATE TABLE IF NOT EXISTS refund_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            return_request_id INT NULL,
            exchange_request_id INT NULL,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            mode ENUM('Original Payment','Store Credit','Manual Transfer') DEFAULT 'Original Payment',
            status ENUM('Refund Initiated','Refund Completed','Refund Failed') DEFAULT 'Refund Initiated',
            gateway_reference VARCHAR(120) NULL,
            remarks TEXT NULL,
            initiated_at DATETIME NULL,
            completed_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_refund_order (order_id),
            INDEX idx_refund_return_request (return_request_id),
            INDEX idx_refund_exchange_request (exchange_request_id),
            INDEX idx_refund_status (status)
        )
    `);

    const returnColumns = [
        ['shipping_charge', 'DECIMAL(10,2) NULL'],
        ['net_refund_amount', 'DECIMAL(10,2) NULL'],
        ['shiprocket_return_order_id', 'VARCHAR(50) NULL'],
        ['shiprocket_return_shipment_id', 'VARCHAR(50) NULL'],
        ['shiprocket_awb_code', 'VARCHAR(50) NULL'],
        ['shiprocket_courier_name', 'VARCHAR(120) NULL'],
        ['shiprocket_status', "VARCHAR(120) NULL"],
        ['shiprocket_tracking_status', "VARCHAR(120) NULL"],
        ['shiprocket_latest_activity', 'VARCHAR(255) NULL'],
        ['shiprocket_latest_activity_at', 'DATETIME NULL'],
        ['shiprocket_tracking_json', 'LONGTEXT NULL'],
        ['shiprocket_pickup_scheduled', 'BOOLEAN DEFAULT FALSE'],
        ['pickup_token_number', 'VARCHAR(80) NULL'],
        ['pickup_scheduled_at', 'DATETIME NULL'],
        ['picked_up_at', 'DATETIME NULL'],
        ['delivered_at', 'DATETIME NULL']
    ];

    for (const [name, definition] of returnColumns) {
        const [rows] = await db.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'return_requests'
               AND COLUMN_NAME = ?`,
            [name]
        );
        if (!rows.length) {
            await db.execute(`ALTER TABLE return_requests ADD COLUMN ${name} ${definition}`);
        }
    }

    orderColumnsReady = true;
}

async function ensureOrderReferenceSettings() {
    if (orderReferenceSettingsReady) return;

    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('order_reference_prefix', 'NATDEV')
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`
    );
    await db.execute(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('order_reference_start', '1')
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`
    );

    orderReferenceSettingsReady = true;
}

async function getOrderReferenceSettings() {
    if (cachedOrderReferenceSettings) return cachedOrderReferenceSettings;

    await ensureOrderReferenceSettings();
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN ('order_reference_prefix', 'order_reference_start')`
    );

    const map = Object.fromEntries(rows.map((row) => [row.setting_key, String(row.setting_value || '').trim()]));
    const prefix = (map.order_reference_prefix || 'NATDEV').toUpperCase();
    const start = Number.parseInt(map.order_reference_start || '1', 10);

    cachedOrderReferenceSettings = {
        prefix,
        start: Number.isFinite(start) && start > 0 ? start : 1
    };

    return cachedOrderReferenceSettings;
}

async function saveShiprocketFields(orderId, shiprocketResult) {
    if (!shiprocketResult) return;

    const normalizedLatestActivityAt = normalizeShiprocketDatetime(
        shiprocketResult.shiprocket_latest_activity_at || shiprocketResult.latest_activity_at
    );

    await db.execute(
        `UPDATE orders
         SET shiprocket_order_id = ?,
             shiprocket_shipment_id = ?,
             shiprocket_awb_code = ?,
             shiprocket_courier_name = ?,
             shiprocket_status = ?,
             shiprocket_tracking_status = ?,
             shiprocket_latest_activity = ?,
             shiprocket_latest_activity_at = ?,
             shiprocket_tracking_json = ?,
             shiprocket_pickup_scheduled = ?
         WHERE order_id = ?`,
        [
            shiprocketResult.shiprocket_order_id || null,
            shiprocketResult.shiprocket_shipment_id || null,
            shiprocketResult.shiprocket_awb_code || null,
            shiprocketResult.shiprocket_courier_name || null,
            shiprocketResult.shiprocket_status || null,
            shiprocketResult.shiprocket_tracking_status || null,
            shiprocketResult.shiprocket_latest_activity || null,
            normalizedLatestActivityAt,
            shiprocketResult.shiprocket_tracking_json
                ? JSON.stringify(shiprocketResult.shiprocket_tracking_json)
                : null,
            shiprocketResult.shiprocket_pickup_scheduled ? 1 : 0,
            orderId
        ]
    );
}

function normalizeShiprocketDatetime(value) {
    if (!value) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const pad = (part) => String(part).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }

    if (typeof value === 'object') {
        const nested = value.date || value.datetime || value.timestamp || value.created_at || value.updated_at || value.time;
        if (nested) {
            return normalizeShiprocketDatetime(nested);
        }
    }

    const text = String(value).trim();
    if (!text) return null;

    const isoLikeMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/i);
    const date = new Date(text);
    if (isoLikeMatch && Number.isNaN(date.getTime())) {
        return `${isoLikeMatch[1]} ${isoLikeMatch[2]}`;
    }

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeTrackEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeTrackMobile(mobile) {
    const digits = String(mobile || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseTrackingJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function summarizeShiprocketTracking(order) {
    const tracking = parseTrackingJson(order.shiprocket_tracking_json);
    const trackingSummary = shiprocket.extractTrackingSummary(tracking, {
        shiprocket_status: order.shiprocket_status,
        shiprocket_tracking_status: order.shiprocket_tracking_status,
        shiprocket_latest_activity: order.shiprocket_latest_activity,
        shiprocket_latest_activity_at: order.shiprocket_latest_activity_at
    });
    const normalizedTracking = shiprocket.normalizeShiprocketStatus(
        trackingSummary.display_status || trackingSummary.tracking_status || trackingSummary.shiprocket_status || order.shiprocket_tracking_status || order.shiprocket_status,
        trackingSummary.latest_activity || order.shiprocket_latest_activity
    );
    const fallbackTrackingStatus = shiprocket.normalizeShiprocketStatus(order.shiprocket_status, order.shiprocket_latest_activity).display_status || '';
    const fallbackTrackingLabel = shiprocket.normalizeShiprocketStatus(order.shiprocket_tracking_status, order.shiprocket_latest_activity).display_status || '';

    return {
        ...order,
        shiprocket_status: trackingSummary.shiprocket_status || order.shiprocket_status || '',
        shiprocket_tracking_status: trackingSummary.tracking_status || fallbackTrackingLabel || fallbackTrackingStatus || '',
        shiprocket_latest_activity: trackingSummary.latest_activity || shiprocket.normalizeShiprocketStatus(order.shiprocket_latest_activity, order.shiprocket_latest_activity).display_status || '',
        shiprocket_latest_activity_at: trackingSummary.latest_activity_at || order.shiprocket_latest_activity_at || null,
        shiprocket_display_status: trackingSummary.display_status || trackingSummary.tracking_status || trackingSummary.shiprocket_status || fallbackTrackingLabel || fallbackTrackingStatus || '',
        shiprocket_system_status: trackingSummary.system_status || normalizedTracking.system_status || '',
        shiprocket_user_message: trackingSummary.user_message || normalizedTracking.user_message || ''
    };
}

function deriveLocalOrderStatusFromShiprocket(order) {
    const trackingLabel = String(
        order.shiprocket_system_status ||
        order.shiprocket_display_status ||
        order.shiprocket_tracking_status ||
        order.shiprocket_latest_activity ||
        order.shiprocket_status ||
        ''
    ).trim().toLowerCase();

    if (!trackingLabel) return '';
    if (
        trackingLabel.includes('cancellation requested') ||
        trackingLabel.includes('cancel requested') ||
        trackingLabel.includes('cancel request')
    ) {
        return '';
    }
    if (
        trackingLabel.includes('cancel') ||
        trackingLabel.includes('canceled') ||
        trackingLabel.includes('cancelled') ||
        trackingLabel.includes('rto') ||
        trackingLabel.includes('return to seller') ||
        trackingLabel.includes('returning to seller')
    ) {
        return '';
    }
    if (trackingLabel.includes('deliver')) return 'Delivered';
    if (
        trackingLabel.includes('ship') ||
        trackingLabel.includes('transit') ||
        trackingLabel.includes('out for delivery') ||
        trackingLabel.includes('picked up')
    ) {
        return 'Shipped';
    }
    if (
        trackingLabel.includes('pickup') ||
        trackingLabel.includes('confirmed') ||
        trackingLabel.includes('packed') ||
        trackingLabel.includes('awb') ||
        trackingLabel.includes('manifest') ||
        trackingLabel.includes('label') ||
        trackingLabel.includes('ready to ship') ||
        trackingLabel.includes('booked')
    ) {
        return 'Packed';
    }
    return '';
}

async function syncOrderTrackingForUser(order) {
    try {
        if (!order?.order_id) return summarizeShiprocketTracking(order);
        if (!order.shiprocket_shipment_id && !order.shiprocket_awb_code) {
            console.log(`[Tracking Sync] Order #${order.order_id} has no Shiprocket shipment/AWB - using cached data`);
            return summarizeShiprocketTracking(order);
        }

        console.log(`[Tracking Sync] Fetching fresh tracking for Order #${order.order_id}`, {
            shipmentId: order.shiprocket_shipment_id,
            awbCode: order.shiprocket_awb_code
        });

        const syncResult = await shiprocket.syncShipment({
            shipmentId: order.shiprocket_shipment_id || '',
            awbCode: order.shiprocket_awb_code || '',
            orderStatus: order.status || ''
        });

        if (!syncResult) {
            console.warn(`[Tracking Sync] Shiprocket returned empty result for Order #${order.order_id} - using cached data`);
            return summarizeShiprocketTracking(order);
        }

        console.log(`[Tracking Sync] ✅ Fresh tracking received for Order #${order.order_id}`, {
            status: syncResult.shiprocket_status,
            tracking_status: syncResult.tracking_status,
            latest_activity: syncResult.latest_activity
        });

        await saveShiprocketFields(order.order_id, {
            shiprocket_order_id: order.shiprocket_order_id || '',
            ...syncResult
        });

        const mergedOrder = summarizeShiprocketTracking({
            ...order,
            ...syncResult
        });

        const derivedStatus = deriveLocalOrderStatusFromShiprocket(mergedOrder);
        if (derivedStatus && derivedStatus !== order.status) {
            console.log(`[Tracking Sync] Status derived from Shiprocket for Order #${order.order_id}: ${order.status} → ${derivedStatus}`);
            await db.execute(
                'UPDATE orders SET status = ? WHERE order_id = ?',
                [derivedStatus, order.order_id]
            );
            return {
                ...mergedOrder,
                status: derivedStatus
            };
        }

        return mergedOrder;
    } catch (err) {
        console.error(`[Tracking Sync] ❌ Shiprocket sync failed for order #${order?.order_id}:`, err.message);
        return summarizeShiprocketTracking(order);
    }
}

function mapReturnTrackingStatus(tracking = {}) {
    const text = String(
        tracking.display_status ||
        tracking.tracking_status ||
        tracking.shiprocket_status ||
        tracking.latest_activity ||
        ''
    ).trim().toLowerCase();

    if (!text) return '';
    if (text.includes('deliver')) return 'Delivered';
    if (text.includes('picked up') || text.includes('pickup done')) return 'Picked Up';
    if (text.includes('pickup scheduled') || text.includes('pickup generated') || text.includes('pickup requested')) return 'Pickup Scheduled';
    if (text.includes('awb') || text.includes('manifest') || text.includes('assigned') || text.includes('created')) return 'Approved';
    return '';
}

async function syncReturnTrackingForUser(order) {
    if (!order?.order_id) return order;

    try {
        const [rows] = await db.execute(
            `SELECT *
             FROM return_requests
             WHERE order_id = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [order.order_id]
        );

        const returnReq = rows[0];
        if (!returnReq) return order;

        const shipmentId = String(returnReq.shiprocket_return_shipment_id || '').trim();
        const awbCode = String(returnReq.shiprocket_awb_code || '').trim();
        if (!shipmentId && !awbCode) {
            return {
                ...order,
                return_request_id: returnReq.id,
                return_request_status: returnReq.status,
                return_reason: returnReq.reason,
                return_reason_detail: returnReq.sub_reason,
                return_description: returnReq.description,
                return_requested_at: returnReq.created_at,
                return_shiprocket_order_id: returnReq.shiprocket_return_order_id || '',
                return_shiprocket_shipment_id: returnReq.shiprocket_return_shipment_id || '',
                return_shiprocket_awb_code: returnReq.shiprocket_awb_code || '',
                return_shiprocket_courier_name: returnReq.shiprocket_courier_name || '',
                return_shiprocket_status: returnReq.shiprocket_status || '',
                return_shiprocket_tracking_status: returnReq.shiprocket_tracking_status || '',
                return_latest_activity: returnReq.shiprocket_latest_activity || '',
                return_latest_activity_at: returnReq.shiprocket_latest_activity_at || null,
                return_pickup_scheduled: returnReq.shiprocket_pickup_scheduled || 0,
                return_pickup_token_number: returnReq.pickup_token_number || '',
                return_pickup_scheduled_at: returnReq.pickup_scheduled_at || null,
                return_picked_up_at: returnReq.picked_up_at || null,
                return_delivered_at: returnReq.delivered_at || null,
                refund_status: order.refund_status || '',
                refund_amount: order.refund_amount || null
            };
        }

        const tracking = awbCode
            ? await shiprocket.trackByAwb(awbCode)
            : await shiprocket.trackByShipment(shipmentId);

        if (!tracking) {
            return order;
        }

        const statusHint = mapReturnTrackingStatus(tracking);
        const updates = [
            'shiprocket_status = ?',
            'shiprocket_tracking_status = ?',
            'shiprocket_latest_activity = ?',
            'shiprocket_latest_activity_at = NOW()',
            'shiprocket_tracking_json = ?'
        ];
        const params = [
            tracking.shiprocket_status || tracking.tracking_status || statusHint || returnReq.shiprocket_status || '',
            tracking.tracking_status || tracking.display_status || statusHint || returnReq.shiprocket_tracking_status || '',
            tracking.latest_activity || returnReq.shiprocket_latest_activity || '',
            JSON.stringify(tracking.tracking_payload || tracking || null)
        ];

        if (tracking.shiprocket_awb_code) {
            updates.push('shiprocket_awb_code = ?');
            params.push(tracking.shiprocket_awb_code);
        }
        if (tracking.courier_name) {
            updates.push('shiprocket_courier_name = ?');
            params.push(tracking.courier_name);
        }
        if (tracking.shiprocket_shipment_id) {
            updates.push('shiprocket_return_shipment_id = ?');
            params.push(tracking.shiprocket_shipment_id);
        }
        if (statusHint === 'Pickup Scheduled') {
            updates.push("status = CASE WHEN status = 'Requested' THEN 'Pickup Scheduled' ELSE status END");
            updates.push('shiprocket_pickup_scheduled = 1');
            updates.push('pickup_scheduled_at = COALESCE(pickup_scheduled_at, NOW())');
        }
        if (statusHint === 'Picked Up') {
            updates.push("status = CASE WHEN status IN ('Requested','Approved','Pickup Scheduled') THEN 'Picked Up' ELSE status END");
            updates.push('picked_up_at = COALESCE(picked_up_at, NOW())');
        }
        if (statusHint === 'Delivered') {
            updates.push('delivered_at = COALESCE(delivered_at, NOW())');
        }

        await db.execute(
            `UPDATE return_requests SET ${updates.join(', ')} WHERE id = ?`,
            [...params, returnReq.id]
        );

        return {
            ...order,
            return_request_id: returnReq.id,
            return_request_status: statusHint && ['Pickup Scheduled', 'Picked Up'].includes(statusHint) ? statusHint : returnReq.status,
            return_reason: returnReq.reason,
            return_reason_detail: returnReq.sub_reason,
            return_description: returnReq.description,
            return_requested_at: returnReq.created_at,
            return_shiprocket_order_id: returnReq.shiprocket_return_order_id || '',
            return_shiprocket_shipment_id: tracking.shiprocket_shipment_id || returnReq.shiprocket_return_shipment_id || '',
            return_shiprocket_awb_code: tracking.shiprocket_awb_code || returnReq.shiprocket_awb_code || '',
            return_shiprocket_courier_name: tracking.courier_name || returnReq.shiprocket_courier_name || '',
            return_shiprocket_status: tracking.shiprocket_status || returnReq.shiprocket_status || '',
            return_shiprocket_tracking_status: tracking.tracking_status || tracking.display_status || returnReq.shiprocket_tracking_status || '',
            return_latest_activity: tracking.latest_activity || returnReq.shiprocket_latest_activity || '',
            return_latest_activity_at: tracking.latest_activity_at || returnReq.shiprocket_latest_activity_at || null,
            return_pickup_scheduled: statusHint === 'Pickup Scheduled' ? 1 : returnReq.shiprocket_pickup_scheduled || 0,
            return_pickup_token_number: returnReq.pickup_token_number || '',
            return_pickup_scheduled_at: returnReq.pickup_scheduled_at || null,
            return_picked_up_at: statusHint === 'Picked Up' ? new Date().toISOString() : returnReq.picked_up_at || null,
            return_delivered_at: statusHint === 'Delivered' ? new Date().toISOString() : returnReq.delivered_at || null
        };
    } catch (err) {
        console.error(`[Orders] Return tracking sync failed for order #${order?.order_id}:`, err.message);
        return order;
    }
}

async function syncRefundStatusForOrder(order) {
    const currentStatus = String(order?.refund_status || '').trim();
    if (!currentStatus || currentStatus === 'Refund Completed' || currentStatus === 'Refund Failed') {
        return order;
    }

    const requestId = String(order?.refund_request_id || '').trim();
    const payuPaymentId = String(order?.gateway_payment_id || '').trim();
    if (!requestId && !payuPaymentId) {
        return order;
    }

    try {
        const refundPayload = requestId
            ? await checkRefundStatusByRequestId(requestId)
            : await checkRefundStatusByPayuId(payuPaymentId);
        const normalized = classifyRefundStatus(refundPayload.raw, refundPayload.rawText) || refundPayload.normalizedStatus || '';
        const refundNotes = JSON.stringify({
            payu: refundPayload.raw || null,
            checked_at: new Date().toISOString()
        });

        if (normalized === 'Refund Completed' || normalized === 'Refund Failed') {
            await db.execute(
                `UPDATE refund_transactions
                 SET status = ?, remarks = ?, completed_at = ?, updated_at = NOW()
                 WHERE order_id = ? ${order.refund_return_request_id ? 'AND return_request_id = ?' : 'AND gateway_reference = ?'}
                 ORDER BY id DESC
                 LIMIT 1`,
                order.refund_return_request_id
                    ? [normalized, refundNotes, normalized === 'Refund Completed' ? new Date() : null, order.order_id, order.refund_return_request_id]
                    : [normalized, refundNotes, normalized === 'Refund Completed' ? new Date() : null, order.order_id, requestId]
            );

            if (order.refund_return_request_id) {
                await db.execute(
                    'UPDATE return_requests SET status = ?, updated_at = NOW() WHERE id = ?',
                    [normalized, order.refund_return_request_id]
                );
            }

            return {
                ...order,
                refund_status: normalized,
                refund_notes: refundNotes,
                refund_completed_at: normalized === 'Refund Completed' ? new Date().toISOString() : order.refund_completed_at || null,
                return_request_status: normalized
            };
        }

        await db.execute(
            `UPDATE refund_transactions
             SET remarks = ?, updated_at = NOW()
             WHERE order_id = ? ${order.refund_return_request_id ? 'AND return_request_id = ?' : 'AND gateway_reference = ?'}
             ORDER BY id DESC
             LIMIT 1`,
            order.refund_return_request_id
                ? [refundNotes, order.order_id, order.refund_return_request_id]
                : [refundNotes, order.order_id, requestId]
        );

        return {
            ...order,
            refund_notes: refundNotes
        };
    } catch (err) {
        console.error(`PayU refund sync failed for order #${order?.order_id}:`, err.message);
        return order;
    }
}

function buildSafeTrackingPayload(order) {
    const summary = summarizeShiprocketTracking(order);
    return {
        orderId: summary.order_id,
        orderReference: summary.invoice_number || '',
        orderStatus: summary.status || '',
        paymentMethod: summary.payment_method || '',
        createdAt: summary.created_at || null,
        shipmentId: summary.shiprocket_shipment_id || '',
        shiprocketOrderId: summary.shiprocket_order_id || '',
        awbCode: summary.shiprocket_awb_code || '',
        courierName: summary.shiprocket_courier_name || '',
        shipmentStatus: summary.shiprocket_status || '',
        trackingStatus: summary.shiprocket_tracking_status || '',
        displayStatus: summary.shiprocket_display_status || '',
        systemStatus: summary.shiprocket_system_status || '',
        userMessage: summary.shiprocket_user_message || '',
        latestActivity: summary.shiprocket_latest_activity || '',
        latestActivityAt: summary.shiprocket_latest_activity_at || null,
        pickupScheduled: Boolean(summary.shiprocket_pickup_scheduled)
    };
}

async function loadOrderForTracking(orderId) {
    const [rows] = await db.execute(
        `SELECT o.order_id, o.invoice_number, o.status, o.payment_method, o.created_at,
                o.shiprocket_order_id, o.shiprocket_shipment_id, o.shiprocket_awb_code,
                o.shiprocket_courier_name, o.shiprocket_status, o.shiprocket_tracking_status,
                o.shiprocket_latest_activity, o.shiprocket_latest_activity_at, o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled
         FROM orders o
         WHERE o.order_id = ?`,
        [orderId]
    );

    return rows[0] || null;
}

async function buildInvoiceNumber(orderId) {
    const settings = await getOrderReferenceSettings();
    const visibleNumber = Math.max(settings.start + Number(orderId) - 1, settings.start);
    return `${String(settings.prefix || 'NATDEV').toUpperCase()}${String(visibleNumber).padStart(3, '0')}`;
}

async function ensureOrderInvoiceReference(orderId, existingInvoiceNumber = null, conn = db) {
    const trimmedExisting = String(existingInvoiceNumber || '').trim();
    if (trimmedExisting) return trimmedExisting;

    const invoiceNumber = await buildInvoiceNumber(orderId);
    const invoiceDate = new Date();
    await conn.execute(
        'UPDATE orders SET invoice_number = COALESCE(invoice_number, ?), invoice_date = COALESCE(invoice_date, ?) WHERE order_id = ?',
        [invoiceNumber, invoiceDate, orderId]
    );
    return invoiceNumber;
}

function formatCurrency(value) {
    return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sha512(value) {
    return crypto.createHash('sha512').update(String(value || '')).digest('hex');
}

function getStorefrontBaseUrl() {
    const configured = String(process.env.STOREFRONT_URL || '').trim();
    if (configured) return configured.replace(/\/+$/, '');

    const frontendUrls = String(process.env.FRONTEND_URL || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);

    const preferred = frontendUrls.find((url) => /^https?:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url) && !/admin\./i.test(url));
    const fallback = frontendUrls.find((url) => /^https?:\/\//i.test(url) && !/admin\./i.test(url));
    return (preferred || fallback || 'https://devasthra.com').replace(/\/+$/, '');
}

function getPayuBaseUrl() {
    return String(process.env.PAYU_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://secure.payu.in' : 'https://test.payu.in')).replace(/\/+$/, '');
}

function getPayuCallbackUrl() {
    const configured = String(process.env.PAYU_CALLBACK_URL || '').trim();
    if (configured) return configured;
    return `${getStorefrontBaseUrl()}/api/payu/callback`;
}

function isLocalHost(host = '') {
    return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(host || '').trim());
}

function getRequestServerBaseUrl(req) {
    const host = String(req.get('host') || '').trim();
    if (!host) return '';
    const protocol = isLocalHost(host) ? 'http' : (req.protocol || 'https');
    return `${protocol}://${host}`.replace(/\/+$/, '');
}

function getPhonePeCallbackUrl(req, { merchantOrderId = '', orderId = '' } = {}) {
    const requestBase = getRequestServerBaseUrl(req);
    const configured = String(process.env.PHONEPE_CALLBACK_URL || '').trim();
    const callbackBase = isLocalHost(req.get('host') || '')
        ? `${requestBase}/api/phonepe/callback`
        : (configured || `${getStorefrontBaseUrl()}/api/phonepe/callback`);
    const callbackUrl = new URL(callbackBase);

    if (merchantOrderId) callbackUrl.searchParams.set('merchantOrderId', String(merchantOrderId));
    if (orderId) callbackUrl.searchParams.set('localOrderId', String(orderId));

    return callbackUrl.toString();
}

function buildPayuRequestHash({
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = '',
    udf6 = '',
    udf7 = '',
    udf8 = '',
    udf9 = '',
    udf10 = ''
}) {
    const key = String(process.env.PAYU_KEY || '').trim();
    const salt = String(process.env.PAYU_SALT || '').trim();
    const sequence = [
        key,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        udf1,
        udf2,
        udf3,
        udf4,
        udf5,
        udf6,
        udf7,
        udf8,
        udf9,
        udf10,
        salt
    ];
    return sha512(sequence.join('|'));
}

function buildPayuResponseHash(body) {
    const key = String(process.env.PAYU_KEY || '').trim();
    const salt = String(process.env.PAYU_SALT || '').trim();
    const sequence = [];

    if (body.additionalCharges) {
        sequence.push(String(body.additionalCharges));
    }

    sequence.push(
        salt,
        body.status || '',
        body.udf10 || '',
        body.udf9 || '',
        body.udf8 || '',
        body.udf7 || '',
        body.udf6 || '',
        body.udf5 || '',
        body.udf4 || '',
        body.udf3 || '',
        body.udf2 || '',
        body.udf1 || '',
        body.email || '',
        body.firstname || '',
        body.productinfo || '',
        String(body.amount || ''),
        body.txnid || '',
        key
    );

    return sha512(sequence.join('|'));
}

async function finalizeSuccessfulPrepaidOrder({
    order,
    orderId,
    userId,
    gatewayTxnId,
    gatewayPaymentId,
    gatewaySignature,
    gatewayResponse,
    hashVerified
}) {
    const orderReference = await ensureOrderInvoiceReference(orderId, order.invoice_number, db);
    let shippingAddress = {};

    await db.execute(
        'UPDATE orders SET status = ?, payment_method = COALESCE(payment_method, ?), invoice_number = ?, invoice_date = COALESCE(invoice_date, ?) WHERE order_id = ?',
        ['Paid', 'Prepaid', orderReference, new Date(), orderId]
    );

    await db.execute(
        `UPDATE payments
         SET gateway = ?, gateway_txn_id = ?, gateway_payment_id = ?, gateway_signature = ?, gateway_response = ?, hash_verified = ?, status = ?
         WHERE order_id = ?`,
        [
            'PayU',
            gatewayTxnId || null,
            gatewayPaymentId || null,
            gatewaySignature || null,
            JSON.stringify(gatewayResponse || {}),
            hashVerified ? 1 : 0,
            'Success',
            orderId
        ]
    );

    if (order.coupon_id && Number(order.discount_amount || 0) > 0) {
        await recordCouponUsage(db, {
            couponId: order.coupon_id,
            userId,
            orderId,
            discountAmount: Number(order.discount_amount || 0)
        });
    }

    const [orderItems] = await db.execute(
        `SELECT oi.product_id, oi.size, oi.quantity, oi.price,
                p.name AS product_name, p.sku
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [orderId]
    );

    for (const item of orderItems) {
        await db.execute(
            'DELETE FROM cart WHERE user_id = ? AND product_id = ? AND (size = ? OR (size IS NULL AND ? IS NULL))',
            [userId, item.product_id, item.size, item.size]
        );
    }

    sendOrderSMS(order.mobile_number, orderReference).catch(err =>
        console.error('SMS send error (non-blocking):', err.message)
    );

    // CRITICAL: Create Shiprocket order for prepaid - this is BLOCKING
    const [addressRows] = await db.execute(
        `SELECT name, mobile, address_line, city, state, pincode
         FROM order_addresses WHERE order_id = ?`,
        [orderId]
    );

    shippingAddress = addressRows[0] || {};
    
    try {
        const shiprocketResult = await ensurePrepaidShiprocketOrder({
            orderId,
            orderReference,
            order,
            paymentMethod: 'Prepaid'
        });

        if (shiprocketResult && shiprocketResult.shiprocket_order_id) {
            // DEFENSIVE: Check if returned order is in a cancelled state
            const statusLower = String(shiprocketResult.shiprocket_status || '').toLowerCase();
            if (statusLower.includes('cancel') || statusLower.includes('rto') || statusLower.includes('return')) {
                console.error(`[CRITICAL ERROR] Shiprocket returned order with terminal status: ${shiprocketResult.shiprocket_status}. This is likely an OLD CANCELLED order. Order #${orderId}`);
                throw new Error(`Shiprocket order is in terminal state (${shiprocketResult.shiprocket_status}) - possible old order reuse`);
            }
            console.log(`[CRITICAL] ✅ Shiprocket prepaid order created for Order #${orderId} - SR Order: ${shiprocketResult.shiprocket_order_id}, Status: ${shiprocketResult.shiprocket_status}`);
        } else {
            console.error(`[CRITICAL ERROR] Shiprocket order creation returned empty result for Order #${orderId}`);
            throw new Error('Shiprocket order creation failed - no order ID returned');
        }
    } catch (srErr) {
        console.error(`[CRITICAL ERROR] Shiprocket sync failed for Order #${orderId}:`, srErr.message);
        // Log detailed error for debugging
        console.error(`Order ${orderId} status will be INCOMPLETE without Shiprocket tracking`);
        // Don't silently fail - this needs attention
        throw new Error(`Cannot finalize prepaid order without Shiprocket: ${srErr.message}`);
    }

    const [savedOrderRows] = await db.execute(
        `SELECT invoice_number, shiprocket_order_id, shiprocket_shipment_id, shiprocket_awb_code
         FROM orders WHERE order_id = ? LIMIT 1`,
        [orderId]
    );
    const savedOrder = savedOrderRows[0] || {};

    sendOrderConfirmationEmail({
        to: order.email || '',
        customerName: order.user_name || 'Customer',
        orderReference: savedOrder.invoice_number || orderReference,
        orderId,
        totalAmount: order.total_amount,
        paymentMethod: 'Prepaid',
        awbCode: savedOrder.shiprocket_awb_code || '',
        shippingCity: shippingAddress.city || ''
    }).catch((mailErr) => {
        console.error(`Order confirmation email failed for Order #${orderId}:`, mailErr.message);
    });

    sendAdminOrderNotification({
        orderReference: savedOrder.invoice_number || orderReference,
        orderId,
        customerName: order.user_name || 'Customer',
        totalAmount: order.total_amount,
        paymentMethod: 'Prepaid',
        shippingAddress
    }).catch((mailErr) => {
        console.error(`Admin order notification failed for Order #${orderId}:`, mailErr.message);
    });

    return {
        orderReference: savedOrder.invoice_number || orderReference,
        shiprocketOrderId: savedOrder.shiprocket_order_id || '',
        shipmentId: savedOrder.shiprocket_shipment_id || '',
        awbCode: savedOrder.shiprocket_awb_code || ''
    };
}

async function ensurePrepaidShiprocketOrder({
    orderId,
    orderReference,
    order,
    paymentMethod = 'Prepaid'
}) {
    if (!orderId || !order) return null;

    if (order.shiprocket_order_id || order.shiprocket_shipment_id || order.shiprocket_awb_code) {
        if (order.shiprocket_shipment_id || order.shiprocket_awb_code) {
            const refreshed = await shiprocket.syncShipment({
                shipmentId: order.shiprocket_shipment_id || '',
                awbCode: order.shiprocket_awb_code || '',
                orderStatus: order.status || ''
            });

            if (refreshed) {
                await saveShiprocketFields(orderId, {
                    shiprocket_order_id: order.shiprocket_order_id || '',
                    ...refreshed
                });

                return {
                    shiprocket_order_id: refreshed.shiprocket_order_id || order.shiprocket_order_id || '',
                    shiprocket_shipment_id: refreshed.shiprocket_shipment_id || order.shiprocket_shipment_id || '',
                    shiprocket_awb_code: refreshed.shiprocket_awb_code || order.shiprocket_awb_code || '',
                    shiprocket_courier_name: refreshed.shiprocket_courier_name || order.shiprocket_courier_name || '',
                    shiprocket_status: refreshed.shiprocket_status || order.shiprocket_status || '',
                    shiprocket_tracking_status: refreshed.shiprocket_tracking_status || order.shiprocket_tracking_status || '',
                    shiprocket_latest_activity: refreshed.shiprocket_latest_activity || order.shiprocket_latest_activity || '',
                    shiprocket_latest_activity_at: refreshed.shiprocket_latest_activity_at || order.shiprocket_latest_activity_at || null,
                    shiprocket_tracking_json: refreshed.shiprocket_tracking_json || order.shiprocket_tracking_json || null,
                    shiprocket_pickup_scheduled: Boolean(refreshed.shiprocket_pickup_scheduled || order.shiprocket_pickup_scheduled)
                };
            }
        }

        return {
            shiprocket_order_id: order.shiprocket_order_id || '',
            shiprocket_shipment_id: order.shiprocket_shipment_id || '',
            shiprocket_awb_code: order.shiprocket_awb_code || '',
            shiprocket_courier_name: order.shiprocket_courier_name || '',
            shiprocket_status: order.shiprocket_status || '',
            shiprocket_tracking_status: order.shiprocket_tracking_status || '',
            shiprocket_latest_activity: order.shiprocket_latest_activity || '',
            shiprocket_latest_activity_at: order.shiprocket_latest_activity_at || null,
            shiprocket_tracking_json: order.shiprocket_tracking_json || null,
            shiprocket_pickup_scheduled: Boolean(order.shiprocket_pickup_scheduled)
        };
    }

    const [addressRows] = await db.execute(
        `SELECT name, mobile, address_line, city, state, pincode
         FROM order_addresses WHERE order_id = ?`,
        [orderId]
    );
    const shippingAddress = addressRows[0] || {};
    const [orderItems] = await db.execute(
        `SELECT oi.product_id, oi.size, oi.quantity, oi.price,
                p.name AS product_name, p.sku
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [orderId]
    );

    if (!orderItems.length) {
        throw new Error('Order items not found for Shiprocket sync');
    }

    console.log(`[Orders] Creating Shiprocket ${paymentMethod} order for ${orderReference || orderId}`);
    const shiprocketResult = await shiprocket.createOrder({
        orderId,
        orderReference,
        orderDate: order.created_at,
        customerName: shippingAddress?.name || order.user_name || 'Customer',
        customerEmail: order.email || '',
        customerPhone: shippingAddress?.mobile || order.mobile_number || '',
        address: {
            address_line: shippingAddress?.address_line || '',
            city: shippingAddress?.city || '',
            state: shippingAddress?.state || '',
            pincode: shippingAddress?.pincode || ''
        },
        items: orderItems.map(item => ({
            name: item.product_name,
            sku: item.sku,
            product_id: item.product_id,
            quantity: item.quantity,
            price: item.price
        })),
        totalAmount: order.total_amount,
        paymentMethod
    });

    if (!shiprocketResult) {
        return null;
    }

    await saveShiprocketFields(orderId, shiprocketResult);
    return shiprocketResult;
}

async function createShiprocketShipmentForOrder({
    orderId,
    orderReference,
    order,
    orderItems,
    shippingAddress,
    paymentMethod = 'Prepaid'
}) {
    if (!orderId || !order || !Array.isArray(orderItems) || !orderItems.length) {
        return null;
    }

    if (order.shiprocket_shipment_id || order.shiprocket_awb_code) {
        return {
            shiprocket_order_id: order.shiprocket_order_id || '',
            shiprocket_shipment_id: order.shiprocket_shipment_id || '',
            shiprocket_awb_code: order.shiprocket_awb_code || '',
            shiprocket_courier_name: order.shiprocket_courier_name || '',
            shiprocket_status: order.shiprocket_status || '',
            shiprocket_tracking_status: order.shiprocket_tracking_status || '',
            shiprocket_latest_activity: order.shiprocket_latest_activity || '',
            shiprocket_latest_activity_at: order.shiprocket_latest_activity_at || null,
            shiprocket_tracking_json: order.shiprocket_tracking_json || null,
            shiprocket_pickup_scheduled: Boolean(order.shiprocket_pickup_scheduled)
        };
    }

    return ensurePrepaidShiprocketOrder({
        orderId,
        orderReference,
        order: {
            ...order,
            created_at: order.created_at,
            user_name: order.user_name,
            email: order.email,
            mobile_number: order.mobile_number
        },
        paymentMethod
    });
}

async function validateCouponForCart({ code, userId, cartTotal, cartItems }) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { coupon: null, discountAmount: 0, finalTotal: Number(cartTotal) || 0 };
    }

    const [coupons] = await db.execute(
        'SELECT * FROM coupons WHERE code = ? AND is_active = TRUE LIMIT 1',
        [normalizedCode]
    );

    if (!coupons.length) {
        const error = new Error('Invalid or expired coupon code');
        error.statusCode = 400;
        throw error;
    }

    const coupon = coupons[0];
    const now = new Date();
    if (coupon.start_date && new Date(coupon.start_date) > now) {
        const error = new Error('This coupon is not yet active');
        error.statusCode = 400;
        throw error;
    }
    if (coupon.end_date && new Date(coupon.end_date) < now) {
        const error = new Error('This coupon has expired');
        error.statusCode = 400;
        throw error;
    }
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
        const error = new Error('This coupon has reached its usage limit');
        error.statusCode = 400;
        throw error;
    }

    const [userUsage] = await db.execute(
        'SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND user_id = ?',
        [coupon.id, userId]
    );
    if (coupon.per_user_limit && userUsage[0].cnt >= coupon.per_user_limit) {
        const error = new Error('You have already used this coupon');
        error.statusCode = 400;
        throw error;
    }

    const total = Number(cartTotal) || 0;
    if (coupon.min_order_value && total < Number(coupon.min_order_value)) {
        const error = new Error(`Minimum order value of ₹${coupon.min_order_value} required`);
        error.statusCode = 400;
        throw error;
    }

    if (coupon.scope !== 'all' && coupon.scope_ids) {
        const scopeIds = JSON.parse(coupon.scope_ids);
        const productIds = cartItems.map(item => Number(item.product_id)).filter(Boolean);
        const categoryIds = [...new Set(cartItems.map(item => Number(item.category_id)).filter(Boolean))];

        if (coupon.scope === 'product') {
            const match = productIds.some(pid => scopeIds.includes(pid));
            if (!match) {
                const error = new Error('This coupon is not valid for items in your cart');
                error.statusCode = 400;
                throw error;
            }
        }

        if (coupon.scope === 'category') {
            const match = categoryIds.some(cid => scopeIds.includes(cid));
            if (!match) {
                const error = new Error('This coupon is not valid for your cart categories');
                error.statusCode = 400;
                throw error;
            }
        }
    }

    let discountAmount = 0;
    if (coupon.discount_type === 'flat') {
        discountAmount = Math.min(Number(coupon.discount_value) || 0, total);
    } else {
        discountAmount = total * ((Number(coupon.discount_value) || 0) / 100);
        if (coupon.max_discount) {
            discountAmount = Math.min(discountAmount, Number(coupon.max_discount) || 0);
        }
    }

    discountAmount = Math.round(discountAmount * 100) / 100;
    return {
        coupon,
        discountAmount,
        finalTotal: Math.max(0, total - discountAmount)
    };
}

async function recordCouponUsage(executor, { couponId, userId, orderId, discountAmount }) {
    if (!couponId || !(Number(discountAmount) > 0)) return;

    const [existing] = await executor.execute(
        'SELECT id FROM coupon_usage WHERE order_id = ? LIMIT 1',
        [orderId]
    );
    if (existing.length) return;

    await executor.execute(
        'INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount) VALUES (?, ?, ?, ?)',
        [couponId, userId, orderId, discountAmount]
    );
    await executor.execute(
        'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?',
        [couponId]
    );
}

function buildInvoiceHtml({ order, items }) {
    const itemRows = items.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${item.name}</td>
            <td>${item.size || '-'}</td>
            <td>${item.quantity}</td>
            <td>${formatCurrency(item.price)}</td>
            <td>${formatCurrency(Number(item.price) * Number(item.quantity))}</td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Invoice ${order.invoice_number || ''}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
            .brand { font-size: 28px; font-weight: 700; color: #6B0F2B; margin-bottom: 6px; }
            .muted { color: #6b7280; font-size: 14px; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 24px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; font-size: 14px; }
            th { background: #f3f4f6; text-align: left; }
            .totals { width: 300px; margin-left: auto; margin-top: 20px; }
            .totals .line { display: flex; justify-content: space-between; padding: 8px 0; }
            .totals .grand { font-size: 18px; font-weight: 700; border-top: 2px solid #111827; }
        </style>
    </head>
    <body>
        <div class="brand">DEVASTHRA</div>
        <div class="muted">Culture in Motion</div>
        <div class="meta">
            <div><strong>Invoice No:</strong> ${order.invoice_number || '-'}</div>
            <div><strong>Invoice Date:</strong> ${order.invoice_date || order.created_at}</div>
            <div><strong>Order Ref:</strong> ${order.invoice_number || `NATDEV${String(order.order_id).padStart(3, '0')}`}</div>
            <div><strong>Payment Method:</strong> ${order.payment_method || 'Prepaid'}</div>
            <div><strong>Status:</strong> ${order.status}</div>
            <div><strong>Customer:</strong> ${order.name || '-'}</div>
        </div>
        <div style="margin-bottom: 18px;">
            <strong>Delivery Address</strong><br>
            ${[order.name, order.mobile, order.address_line, order.city, order.state, order.pincode].filter(Boolean).join(', ')}
        </div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>${itemRows}</tbody>
        </table>
        <div class="totals">
            <div class="line grand"><span>Grand Total</span><span>${formatCurrency(order.total_amount)}</span></div>
        </div>
    </body>
    </html>`;
}

function calculateCancellationRefundAmount(order) {
    const totalAmount = Number(order?.total_amount || 0);
    const subtotalAmount = Number(order?.subtotal_amount || 0);
    const discountAmount = Number(order?.discount_amount || 0);
    const baseAmount = Math.max(subtotalAmount - discountAmount, 0);
    const shippingCharge = Math.max(totalAmount - baseAmount, 0);
    return Math.max(totalAmount - shippingCharge, 0);
}

// Send SMS notification via 2Factor.in
async function sendOrderSMS(mobile, orderReference) {
    try {
        const message = `Your DEVASTHRA order ${orderReference} has been placed successfully. We will share tracking updates soon. Thank you for shopping with us.`;
        await sendTransactionalSms({ mobile, message, purpose: 'order' });
    } catch (err) {
        console.error('Order SMS failed:', err.response?.data || err.message);
        // Don't throw — SMS failure shouldn't break order flow
    }
}

// POST /create-order (protected)
router.post('/create-order', auth, async (req, res) => {
    const addressId = Number(req.body.address_id);
    const cartItemIds = req.body.cart_item_ids; // Array of cart item IDs
    const paymentMethod = req.body.payment_method === 'COD' ? 'COD' : 'Prepaid';
    const couponCode = String(req.body.coupon_code || '').trim().toUpperCase();
    const user_id = req.user.userId;
    const customerDetails = req.body.customer_details || {};
    const submittedCustomerName = String(customerDetails.name ?? req.body.customer_name ?? '').trim();
    const submittedCustomerEmail = String(customerDetails.email ?? req.body.customer_email ?? '').trim().toLowerCase();
    const submittedCustomerMobile = String(customerDetails.mobile ?? req.body.customer_mobile ?? '').trim();
    const submittedCustomerDob = String(customerDetails.dob ?? req.body.customer_dob ?? '').trim();
    const submittedCustomerGender = String(customerDetails.gender ?? req.body.customer_gender ?? '').trim();
    const normalizedSubmittedDob = normalizeDob(submittedCustomerDob);

    if (!Number.isInteger(addressId) || addressId <= 0) {
        return res.status(400).json({ success: false, message: 'address_id is required' });
    }

    if (submittedCustomerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedCustomerEmail)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }
    if (submittedCustomerMobile && !/^[6-9]\d{9}$/.test(submittedCustomerMobile)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit phone number' });
    }
    if (submittedCustomerDob && normalizedSubmittedDob === null) {
        return res.status(400).json({ success: false, message: 'Please enter a valid date of birth' });
    }
    if (submittedCustomerGender && !['Male', 'Female', 'Others'].includes(submittedCustomerGender)) {
        return res.status(400).json({ success: false, message: 'Please select a valid gender' });
    }

    try {
        await ensureAddressTables();
        await ensureOrderColumns();
        await ensureInventorySchema();
        await migrateLegacyAddressIfNeeded(user_id);

        if (submittedCustomerEmail) {
            const [emailUsers] = await db.execute(
                'SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1',
                [submittedCustomerEmail, user_id]
            );
            if (emailUsers.length) {
                return res.status(400).json({ success: false, message: 'This email is already linked to another account' });
            }
        }

        if (submittedCustomerMobile) {
            const [mobileUsers] = await db.execute(
                'SELECT id FROM users WHERE mobile_number = ? AND id <> ? LIMIT 1',
                [submittedCustomerMobile, user_id]
            );
            if (mobileUsers.length) {
                return res.status(400).json({ success: false, message: 'This phone number is already linked to another account' });
            }
        }

        if (submittedCustomerName || submittedCustomerEmail || submittedCustomerMobile || submittedCustomerDob || submittedCustomerGender) {
            await db.execute(
                `UPDATE users
                 SET name = COALESCE(NULLIF(?, ''), name),
                     email = COALESCE(NULLIF(?, ''), email),
                     mobile_number = COALESCE(NULLIF(?, ''), mobile_number),
                     dob = COALESCE(NULLIF(?, ''), dob),
                     gender = COALESCE(NULLIF(?, ''), gender)
                 WHERE id = ?`,
                [
                    submittedCustomerName,
                    submittedCustomerEmail,
                    submittedCustomerMobile,
                    normalizedSubmittedDob || '',
                    submittedCustomerGender,
                    user_id
                ]
            );
        }

        // Ensure selected address belongs to current user.
        const [selectedAddressRows] = await db.execute(
            `SELECT id, name, mobile, address_line, city, state, pincode
             FROM user_addresses
             WHERE id = ? AND user_id = ?`,
            [addressId, user_id]
        );

        if (selectedAddressRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Please select a valid delivery address' });
        }

        const selectedAddress = selectedAddressRows[0];
        const isAddressComplete = (
            selectedAddress.name &&
            selectedAddress.mobile &&
            selectedAddress.address_line &&
            selectedAddress.city &&
            selectedAddress.state &&
            selectedAddress.pincode
        );
        if (!isAddressComplete) {
            return res.status(400).json({ success: false, message: 'Selected address is incomplete' });
        }

        // Get cart items (filtered if cartItemIds provided)
        let query = `SELECT c.id as cart_id, c.product_id, c.quantity, c.size, p.price, p.name, p.stock, p.catalog_category_id AS category_id
                     FROM cart c JOIN products p ON c.product_id = p.id
                     WHERE c.user_id = ?`;
        let params = [user_id];

        if (Array.isArray(cartItemIds) && cartItemIds.length > 0) {
            const placeholders = cartItemIds.map(() => '?').join(',');
            query += ` AND c.id IN (${placeholders})`;
            params = params.concat(cartItemIds.map(id => Number(id)));
        }

        const [cartItems] = await db.execute(query, params);

        if (cartItems.length === 0) {
            return res.status(400).json({ success: false, message: 'Cart is empty or selected items not found' });
        }

        const [userRows] = await db.execute(
            'SELECT email, name, mobile_number, dob, gender FROM users WHERE id = ? LIMIT 1',
            [user_id]
        );
        const userProfile = userRows[0] || {};
        const customerEmail = String(userProfile.email || '').trim();
        const customerName = selectedAddress.name || userProfile.name || 'Customer';

        const paymentGateway = req.body.payment_gateway || 'PayU';

        if (paymentMethod === 'Prepaid') {
            if (paymentGateway === 'PhonePe') {
                const phonePeClientId = phonepe.getPhonePeClientId();
                const phonePeClientSecret = phonepe.getPhonePeClientSecret();
                if (!phonePeClientId || !phonePeClientSecret) {
                    return res.status(400).json({ success: false, message: 'PhonePe is not configured on this server' });
                }
            } else if (paymentGateway === 'PayU') {
                if (!process.env.PAYU_KEY || !process.env.PAYU_SALT) {
                    return res.status(500).json({ success: false, message: 'PayU is not configured yet' });
                }
            } else {
                return res.status(400).json({ success: false, message: `Unsupported payment gateway: ${paymentGateway}` });
            }
        }

        if (paymentMethod === 'Prepaid' && !customerEmail) {
            return res.status(400).json({ success: false, message: 'A valid email is required for online payments' });
        }

        const subtotal = cartItems.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);

        // Enforce configurable free-shipping threshold and COD minimum order values
        let minOrderValue = 0;
        let codMinOrderValue = 0;
        let shippingCharge = 0;
        try {
            const [minRows] = await db.execute(
                `SELECT setting_key, setting_value
                 FROM system_settings
                 WHERE setting_key IN ('min_order_value', 'cod_min_order_value', 'shipping_charge')`
            );
            const config = Object.fromEntries(minRows.map((row) => [row.setting_key, row.setting_value]));
            minOrderValue = Number(config.min_order_value) || 0;
            codMinOrderValue = Number(config.cod_min_order_value) || 0;
            shippingCharge = Number(config.shipping_charge) || 0;
        } catch (e) { /* ignore */ }

        
        let discountAmount = 0;
        let discountedSubtotal = subtotal;
        let appliedCoupon = null;

        if (couponCode) {
            const couponResult = await validateCouponForCart({
                code: couponCode,
                userId: user_id,
                cartTotal: subtotal,
                cartItems
            });
            appliedCoupon = couponResult.coupon;
            discountAmount = couponResult.discountAmount;
            discountedSubtotal = couponResult.finalTotal;
        }

        const appliedShippingCharge = minOrderValue > 0 && discountedSubtotal < minOrderValue
            ? shippingCharge
            : 0;
        const finalTotal = discountedSubtotal + appliedShippingCharge;

        if (paymentMethod === 'COD' && codMinOrderValue > 0 && discountedSubtotal < codMinOrderValue) {
            return res.status(400).json({
                success: false,
                message: `COD is available only for orders of Rs. ${codMinOrderValue} or above`
            });
        }


        const conn = await db.getConnection();
        let orderId;
        let invoiceNumber;
        let payuTxnId = null;
        try {
            await conn.beginTransaction();

            await reserveInventoryForItems(conn, cartItems);

            // Create order in DB
            const [orderResult] = await conn.execute(
                `INSERT INTO orders
                 (user_id, total_amount, subtotal_amount, discount_amount, coupon_id, coupon_code, status, payment_method, invoice_number, invoice_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user_id,
                    finalTotal,
                    subtotal,
                    discountAmount,
                    appliedCoupon?.id || null,
                    appliedCoupon?.code || null,
                    paymentMethod === 'COD' ? 'Pending' : 'Pending',
                    paymentMethod,
                    null,
                    null
                ]
            );
            orderId = orderResult.insertId;

            invoiceNumber = await ensureOrderInvoiceReference(orderId, null, conn);
            if (!invoiceNumber) {
                throw new Error('Failed to generate invoice number for this order');
            }

            if (paymentMethod === 'Prepaid') {
                payuTxnId = `DV${orderId}_${Date.now()}`;
            }

            // Persist selected address snapshot against this order.
            await conn.execute(
                `INSERT INTO order_addresses
                 (order_id, user_address_id, name, mobile, address_line, city, state, pincode)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    selectedAddress.id,
                    selectedAddress.name,
                    selectedAddress.mobile,
                    selectedAddress.address_line,
                    selectedAddress.city,
                    selectedAddress.state,
                    selectedAddress.pincode
                ]
            );

            // Insert order items
            for (const item of cartItems) {
                await conn.execute(
                    'INSERT INTO order_items (order_id, product_id, quantity, size, price) VALUES (?, ?, ?, ?, ?)',
                    [orderId, item.product_id, item.quantity, item.size, item.price]
                );
            }

            // Store payment record
            await conn.execute(
                `INSERT INTO payments
                 (order_id, gateway, gateway_txn_id, amount, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    orderId,
                    paymentMethod === 'COD' ? 'COD' : 'PayU',
                    payuTxnId,
                    finalTotal,
                    'Created'
                ]
            );

            if (paymentMethod === 'COD' && appliedCoupon?.id) {
                await recordCouponUsage(conn, {
                    couponId: appliedCoupon.id,
                    userId: user_id,
                    orderId,
                    discountAmount
                });
            }

            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        if (paymentMethod === 'COD') {
            const [orderItems] = await db.execute(
                `SELECT oi.product_id, oi.size, oi.quantity, oi.price,
                        p.name AS product_name, p.sku
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [orderId]
            );

            for (const item of orderItems) {
                await db.execute(
                    'DELETE FROM cart WHERE user_id = ? AND product_id = ? AND (size = ? OR (size IS NULL AND ? IS NULL))',
                    [user_id, item.product_id, item.size, item.size]
                );
            }

            sendOrderSMS(selectedAddress.mobile, invoiceNumber).catch(err =>
                console.error('SMS send error (non-blocking):', err.message)
            );

            try {
                console.log(`[COD Order] Creating Shiprocket order for ${invoiceNumber} (Order #${orderId})`);
                
                const shiprocketResult = await shiprocket.createOrder({
                    orderId,
                    orderReference: invoiceNumber,
                    orderDate: new Date().toISOString(),
                    customerName: selectedAddress.name,
                    customerEmail: '',
                    customerPhone: selectedAddress.mobile,
                    address: {
                        address_line: selectedAddress.address_line,
                        city: selectedAddress.city,
                        state: selectedAddress.state,
                        pincode: selectedAddress.pincode
                    },
                    items: orderItems.map(item => ({
                        name: item.product_name,
                        sku: item.sku,
                        product_id: item.product_id,
                        quantity: item.quantity,
                        price: item.price
                    })),
                    totalAmount: finalTotal,
                    paymentMethod: 'COD'
                });

                if (shiprocketResult && shiprocketResult.shiprocket_order_id) {
                    // DEFENSIVE: Check if returned order is in a cancelled state
                    const statusLower = String(shiprocketResult.shiprocket_status || '').toLowerCase();
                    if (statusLower.includes('cancel') || statusLower.includes('rto') || statusLower.includes('return')) {
                        console.error(`[COD Order] ⚠️ REJECTED: Shiprocket returned order with terminal status: ${shiprocketResult.shiprocket_status}. This is likely an OLD CANCELLED order being reused. Order #${orderId}`);
                        // Don't save this - it's a bad/old order
                    } else {
                        console.log(`[COD Order] ✅ Shiprocket order created: ${shiprocketResult.shiprocket_order_id}, Status: ${shiprocketResult.shiprocket_status}, Shipment: ${shiprocketResult.shiprocket_shipment_id || 'pending'}`);
                        await saveShiprocketFields(orderId, shiprocketResult);
                    }
                } else {
                    console.error(`[COD Order] ❌ Shiprocket creation failed - no order_id returned for ${invoiceNumber}`);
                }
            } catch (srErr) {
                console.error(`[COD Order] ❌ Shiprocket exception for ${invoiceNumber}:`, srErr.message);
            }

            const [userRows] = await db.execute(
                'SELECT email, name FROM users WHERE id = ? LIMIT 1',
                [user_id]
            );
            const customerEmail = userRows[0]?.email || '';
            const customerName = selectedAddress.name || userRows[0]?.name || 'Customer';
            const [savedOrderRows] = await db.execute(
                `SELECT invoice_number, shiprocket_order_id, shiprocket_shipment_id, shiprocket_awb_code
                 FROM orders WHERE order_id = ? LIMIT 1`,
                [orderId]
            );
            const savedOrder = savedOrderRows[0] || {};

            sendOrderConfirmationEmail({
                to: customerEmail,
                customerName,
                orderReference: savedOrder.invoice_number || invoiceNumber,
                orderId,
                totalAmount: finalTotal,
                paymentMethod: 'COD',
                awbCode: savedOrder.shiprocket_awb_code || '',
                shippingCity: selectedAddress.city || ''
            }).catch((mailErr) => {
                console.error(`Order confirmation email failed for Order #${orderId}:`, mailErr.message);
            });

            sendAdminOrderNotification({
                orderReference: savedOrder.invoice_number || invoiceNumber,
                orderId,
                customerName,
                totalAmount: finalTotal,
                paymentMethod: 'COD',
                shippingAddress: selectedAddress
            }).catch((mailErr) => {
                console.error(`Admin order notification failed for Order #${orderId}:`, mailErr.message);
            });

            return res.json({
                success: true,
                orderId,
                orderReference: savedOrder.invoice_number || invoiceNumber,
                shiprocketOrderId: savedOrder.shiprocket_order_id || '',
                shipmentId: savedOrder.shiprocket_shipment_id || '',
                awbCode: savedOrder.shiprocket_awb_code || '',
                paymentMethod: 'COD',
                cod: true,
                message: 'Cash on Delivery order placed successfully'
            });
        }

        // Check which payment gateway to use
        if (paymentGateway === 'PhonePe') {
            // PhonePe payment — single-step: create order + initiate payment
            const merchantOrderId = `DVPH${String(orderId).padStart(8, '0')}_${Date.now()}`;
            const amountPaise = Math.round(Number(finalTotal) * 100);

            // Update payment record to PhonePe
            await db.execute(
                `UPDATE payments SET gateway = ? WHERE order_id = ?`,
                ['PhonePe', orderId]
            );

            // Build the callback/redirect URL (where PhonePe sends user back).
            // PhonePe v2 does not always append merchantOrderId on redirects, so
            // keep our own identifiers in the redirect URL for callback recovery.
            const callbackUrl = getPhonePeCallbackUrl(req, { merchantOrderId, orderId });

            // Initiate PhonePe payment
            let phonepeResponse;
            try {
                phonepeResponse = await phonepe.initiatePhonePePayment({
                    merchantOrderId,
                    amountPaise,
                    redirectUrl: callbackUrl,
                    prefillPhoneNumber: String(selectedAddress.mobile || userProfile.mobile_number || '').trim(),
                    metaInfo: {
                        orderId: String(orderId),
                        invoiceNumber: invoiceNumber,
                        customerEmail: customerEmail || '',
                        customerName: customerName || ''
                    }
                });
            } catch (ppErr) {
                console.error('[PhonePe] Payment initiation failed:', ppErr.message, ppErr.responseData || '');
                return res.status(502).json({
                    success: false,
                    message: 'Failed to initiate PhonePe payment. Please try again or use a different payment method.'
                });
            }

            if (!phonepeResponse.ok || !phonepeResponse.redirectUrl) {
                console.error('[PhonePe] No redirect URL in response:', phonepeResponse.response);
                return res.status(502).json({
                    success: false,
                    message: 'PhonePe payment could not be started. Please try again.'
                });
            }

            // Store PhonePe transaction record
            await db.execute(
                `INSERT INTO phonepe_transactions
                 (order_id, merchant_order_id, phonepe_order_id, state, amount, redirect_url, request_payload, response_payload, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    orderId,
                    merchantOrderId,
                    phonepeResponse.phonepeOrderId || '',
                    phonepeResponse.state || 'CREATED',
                    finalTotal,
                    phonepeResponse.redirectUrl,
                    JSON.stringify(phonepeResponse.requestBody),
                    JSON.stringify(phonepeResponse.response)
                ]
            );

            console.log(`[PhonePe] ✅ Payment initiated for Order #${orderId}, redirecting to PhonePe`);

            res.json({
                success: true,
                orderId,
                orderReference: invoiceNumber,
                paymentMethod,
                paymentGateway: 'PhonePe',
                merchantOrderId: merchantOrderId,
                phonepe: {
                    redirectUrl: phonepeResponse.redirectUrl,
                    merchantOrderId: merchantOrderId,
                    phonepeOrderId: phonepeResponse.phonepeOrderId || ''
                }
            });
        } else {
            // PayU payment (default)
            const payuFields = {
                key: String(process.env.PAYU_KEY || '').trim(),
                txnid: payuTxnId,
                amount: Number(finalTotal).toFixed(2),
                productinfo: `DEVASTHRA Order ${invoiceNumber}`,
                firstname: customerName,
                email: customerEmail,
                phone: selectedAddress.mobile,
                surl: getPayuCallbackUrl(),
                furl: getPayuCallbackUrl(),
                service_provider: 'payu_paisa',
                udf1: String(orderId),
                udf2: String(user_id),
                udf3: invoiceNumber,
                udf4: '',
                udf5: ''
            };
            payuFields.hash = buildPayuRequestHash(payuFields);

            res.json({
                success: true,
                orderId,
                orderReference: invoiceNumber,
                paymentMethod,
                paymentGateway: 'PayU',
                payu: {
                    action: `${getPayuBaseUrl()}/_payment`,
                    fields: payuFields
                }
            });
        }
    } catch (err) {
        console.error('create-order error:', err);
        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || 'Failed to create order',
            availableSizes: err.availableSizes || []
        });
    }
});

// PayU payment callback
router.all('/api/payu/callback', async (req, res) => {
    const payload = { ...req.query, ...req.body };
    const storefrontBase = getStorefrontBaseUrl();
    const failureUrl = new URL('cart.html', storefrontBase);
    let orderId = 0;
    let txnid = '';

    try {
        console.log('[PayU Callback] Incoming payload:', {
            txnid: payload.txnid || '',
            status: payload.status || '',
            mihpayid: payload.mihpayid || '',
            udf1: payload.udf1 || payload.order_id || '',
            udf2: payload.udf2 || '',
            udf3: payload.udf3 || '',
            hashPresent: Boolean(payload.hash)
        });

        await ensureOrderColumns();
        await ensureInventorySchema();

        orderId = Number(payload.udf1 || payload.order_id || 0);
        txnid = String(payload.txnid || '').trim();
        if (!orderId || !txnid) {
            console.error('[PayU Callback] Missing orderId or txnid', {
                orderId,
                txnid
            });
            failureUrl.searchParams.set('payment', 'failed');
            failureUrl.searchParams.set('message', 'Invalid payment callback');
            return res.redirect(failureUrl.toString());
        }

        const [orders] = await db.execute(
            `SELECT o.*, u.mobile_number, u.email, u.name AS user_name, p.status AS payment_status
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN payments p ON p.order_id = o.order_id
             WHERE o.order_id = ?
             LIMIT 1`,
            [orderId]
        );

        if (!orders.length) {
            console.error('[PayU Callback] Order not found for callback', { orderId, txnid });
            failureUrl.searchParams.set('payment', 'failed');
            failureUrl.searchParams.set('message', 'Order not found');
            return res.redirect(failureUrl.toString());
        }

        const order = orders[0];
        const receivedHash = String(payload.hash || '').trim().toLowerCase();
        const expectedHash = buildPayuResponseHash(payload).toLowerCase();
        const hashVerified = Boolean(receivedHash) && receivedHash === expectedHash;
        const normalizedStatus = String(payload.status || '').trim().toLowerCase();

        console.log('[PayU Callback] Verification result:', {
            orderId,
            txnid,
            normalizedStatus,
            hashVerified,
            receivedHashPrefix: receivedHash ? receivedHash.slice(0, 12) : '',
            expectedHashPrefix: expectedHash ? expectedHash.slice(0, 12) : ''
        });

        if (!hashVerified || normalizedStatus !== 'success') {
            console.error('[PayU Callback] Redirecting to failure URL', {
                orderId,
                txnid,
                hashVerified,
                normalizedStatus
            });
            await db.execute(
                `UPDATE payments
                 SET gateway = ?, gateway_txn_id = ?, gateway_payment_id = ?, gateway_signature = ?, gateway_response = ?, hash_verified = ?, status = ?
                 WHERE order_id = ?`,
                [
                    'PayU',
                    txnid || null,
                    payload.mihpayid || null,
                    payload.hash || null,
                    JSON.stringify(payload || {}),
                    hashVerified ? 1 : 0,
                    'Failed',
                    orderId
                ]
            );

            failureUrl.searchParams.set('payment', 'failed');
            failureUrl.searchParams.set('orderId', String(orderId));
            failureUrl.searchParams.set('message', hashVerified ? 'Payment was not completed' : 'Payment verification failed');
            return res.redirect(failureUrl.toString());
        }

        const ensuredOrderReference = await ensureOrderInvoiceReference(orderId, order.invoice_number, db);

        let paymentResult = {
            orderReference: ensuredOrderReference,
            shiprocketOrderId: order.shiprocket_order_id || '',
            shipmentId: order.shiprocket_shipment_id || '',
            awbCode: order.shiprocket_awb_code || ''
        };

        if (order.status !== 'Paid' || order.payment_status !== 'Success') {
            console.log('[PayU Callback] Finalizing prepaid order', { orderId, txnid });
            paymentResult = await finalizeSuccessfulPrepaidOrder({
                order,
                orderId,
                userId: order.user_id,
                gatewayTxnId: txnid,
                gatewayPaymentId: payload.mihpayid || '',
                gatewaySignature: payload.hash || '',
                gatewayResponse: payload,
                hashVerified
            });
        } else if (!order.shiprocket_order_id && !order.shiprocket_shipment_id && !order.shiprocket_awb_code) {
            console.log('[PayU Callback] Payment already marked successful but Shiprocket is missing. Reconciling now.', { orderId, txnid });
            paymentResult = await ensurePrepaidShiprocketOrder({
                orderId,
                orderReference: ensuredOrderReference,
                order,
                paymentMethod: 'Prepaid'
            }) || paymentResult;
        }

        const successUrl = new URL('order-success.html', storefrontBase);
        successUrl.searchParams.set('payment', 'success');
        successUrl.searchParams.set('source', 'payu');
        successUrl.searchParams.set('orderId', String(orderId));
        if (paymentResult.orderReference) successUrl.searchParams.set('orderRef', String(paymentResult.orderReference));
        if (paymentResult.shipmentId) successUrl.searchParams.set('shipmentId', String(paymentResult.shipmentId));
        if (paymentResult.shiprocketOrderId) successUrl.searchParams.set('shiprocketOrderId', String(paymentResult.shiprocketOrderId));
        if (paymentResult.awbCode) successUrl.searchParams.set('awb', String(paymentResult.awbCode));
        console.log('[PayU Callback] Redirecting to success URL', successUrl.toString());
        return res.redirect(successUrl.toString());
    } catch (err) {
        console.error('[PayU Callback] Unhandled processing error:', {
            orderId,
            txnid,
            message: err?.message || 'Unknown callback error',
            stack: err?.stack || ''
        });
        failureUrl.searchParams.set('payment', 'failed');
        if (orderId) failureUrl.searchParams.set('orderId', String(orderId));
        failureUrl.searchParams.set('message', 'Payment processing error');
        return res.redirect(failureUrl.toString());
    }
});

router.post('/orders/:id/reconcile-shiprocket', auth, async (req, res) => {
    const userId = req.user.userId;
    const orderId = Number(req.params.id);
    const action = String(req.body.action || 'refresh').trim().toLowerCase(); // 'refresh' or 'create'

    try {
        await ensureOrderColumns();
        const [rows] = await db.execute(
            `SELECT o.*, u.mobile_number, u.email, u.name AS user_name, p.status AS payment_status
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN payments p ON p.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?
             LIMIT 1`,
            [orderId, userId]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = rows[0];
        const paymentMethod = String(order.payment_method || '').trim().toLowerCase();
        
        // Allow both Prepaid and COD to refresh tracking
        if (action === 'refresh') {
            // Refresh: Just resync tracking data from Shiprocket
            console.log(`[Reconcile] Refreshing tracking for Order #${orderId} (${paymentMethod})`);
            
            if (!order.shiprocket_shipment_id && !order.shiprocket_awb_code) {
                return res.status(409).json({
                    success: false,
                    message: 'Order has no Shiprocket tracking data to refresh'
                });
            }
            
            try {
                const syncResult = await shiprocket.syncShipment({
                    shipmentId: order.shiprocket_shipment_id || '',
                    awbCode: order.shiprocket_awb_code || '',
                    orderStatus: order.status || ''
                });
                
                if (syncResult) {
                    await saveShiprocketFields(orderId, {
                        shiprocket_order_id: order.shiprocket_order_id || '',
                        ...syncResult
                    });
                    
                    console.log(`[Reconcile] ✅ Tracking refreshed for Order #${orderId}: ${syncResult.shiprocket_status}`);
                    
                    return res.json({
                        success: true,
                        message: 'Shiprocket tracking refreshed successfully',
                        currentStatus: syncResult.shiprocket_status || order.shiprocket_status,
                        trackingStatus: syncResult.tracking_status || '',
                        latestActivity: syncResult.latest_activity || '',
                        shiprocket: syncResult
                    });
                } else {
                    return res.status(502).json({
                        success: false,
                        message: 'Failed to fetch current tracking status from Shiprocket'
                    });
                }
            } catch (syncErr) {
                console.error(`[Reconcile] Sync error for Order #${orderId}:`, syncErr.message);
                return res.status(502).json({
                    success: false,
                    message: `Failed to sync with Shiprocket: ${syncErr.message}`
                });
            }
        }
        
        // Create: Create missing Shiprocket order (only for Prepaid with successful payment)
        const paymentStatus = String(order.payment_status || '').trim();
        const isPaidPrepaidOrder = paymentMethod === 'prepaid' && (paymentStatus === 'Success' || String(order.status || '').trim() === 'Paid');

        if (action === 'create' && !isPaidPrepaidOrder) {
            return res.status(409).json({
                success: false,
                message: 'Only successful prepaid orders can create new Shiprocket orders'
            });
        }

        const orderReference = await ensureOrderInvoiceReference(orderId, order.invoice_number, db);
        const [addressRows] = await db.execute(
            `SELECT name, mobile, address_line, city, state, pincode
             FROM order_addresses WHERE order_id = ?`,
            [orderId]
        );
        const shippingAddress = addressRows[0] || {};
        const [orderItems] = await db.execute(
            `SELECT oi.product_id, oi.size, oi.quantity, oi.price,
                    p.name AS product_name, p.sku
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        if (!orderItems.length) {
            return res.status(409).json({ success: false, message: 'Order items not found for Shiprocket reconciliation' });
        }

        const shiprocketResult = await createShiprocketShipmentForOrder({
            orderId,
            orderReference,
            order,
            orderItems,
            shippingAddress,
            paymentMethod: 'Prepaid'
        });

        if (!shiprocketResult) {
            return res.status(502).json({ success: false, message: 'Unable to create Shiprocket order for this payment' });
        }

        const [savedOrderRows] = await db.execute(
            `SELECT invoice_number, shiprocket_order_id, shiprocket_shipment_id, shiprocket_awb_code
             FROM orders WHERE order_id = ? LIMIT 1`,
            [orderId]
        );
        const savedOrder = savedOrderRows[0] || {};

        return res.json({
            success: true,
            message: 'Shiprocket order reconciled successfully',
            orderReference: savedOrder.invoice_number || orderReference,
            shiprocketOrderId: savedOrder.shiprocket_order_id || '',
            shipmentId: savedOrder.shiprocket_shipment_id || '',
            awbCode: savedOrder.shiprocket_awb_code || '',
            shiprocket: shiprocketResult
        });
    } catch (err) {
        console.error('POST /orders/:id/reconcile-shiprocket error:', err);
        return res.status(500).json({ success: false, message: 'Failed to reconcile Shiprocket order' });
    }
});

// POST /track-order - safe guest tracking by order reference + email/mobile
router.post('/track-order', async (req, res) => {
    const orderReference = String(req.body.order_reference || '').trim();
    const email = normalizeTrackEmail(req.body.email);
    const mobile = normalizeTrackMobile(req.body.mobile);

    if (!orderReference) {
        return res.status(400).json({ success: false, message: 'Order reference is required' });
    }

    if (!email && !mobile) {
        return res.status(400).json({ success: false, message: 'Enter the email or mobile used for the order' });
    }

    try {
        await ensureAddressTables();
        await ensureOrderColumns();

        const [rows] = await db.execute(
            `SELECT o.order_id, o.invoice_number, o.status, o.payment_method, o.created_at,
                    o.shiprocket_order_id, o.shiprocket_shipment_id, o.shiprocket_awb_code,
                    o.shiprocket_courier_name, o.shiprocket_status, o.shiprocket_tracking_status,
                    o.shiprocket_latest_activity, o.shiprocket_latest_activity_at, o.shiprocket_pickup_scheduled,
                    LOWER(COALESCE(u.email, '')) AS email,
                    COALESCE(oa.mobile, u.mobile_number, '') AS mobile_number
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.invoice_number = ?
             LIMIT 1`,
            [orderReference]
        );

        const order = rows[0];
        if (!order) {
            return res.status(404).json({ success: false, message: 'Tracking details not found' });
        }

        const emailMatches = email && email === normalizeTrackEmail(order.email);
        const mobileMatches = mobile && mobile === normalizeTrackMobile(order.mobile_number);

        if (!(emailMatches || mobileMatches)) {
            return res.status(404).json({ success: false, message: 'Tracking details not found' });
        }

        if (order.shiprocket_shipment_id || order.shiprocket_awb_code) {
            const syncResult = await shiprocket.syncShipment({
                shipmentId: order.shiprocket_shipment_id || '',
                awbCode: order.shiprocket_awb_code || '',
                orderStatus: order.status || ''
            });
            if (syncResult) {
                await saveShiprocketFields(order.order_id, {
                    shiprocket_order_id: order.shiprocket_order_id || '',
                    ...syncResult
                });
            }
        }

        const refreshed = await loadOrderForTracking(order.order_id);
        return res.json({
            success: true,
            tracking: buildSafeTrackingPayload(refreshed || order)
        });
    } catch (err) {
        console.error('POST /track-order error:', err);
        res.status(500).json({ success: false, message: 'Unable to fetch tracking details' });
    }
});

// GET /orders — User's order history (protected)
router.get('/orders', auth, async (req, res) => {
    const user_id = req.user.userId;

    try {
        await ensureAddressTables();
        await ensureOrderColumns();
        const [orders] = await db.execute(
            `SELECT o.order_id, o.total_amount, o.status, o.payment_method, o.invoice_number, o.delivery_date, o.return_eligible_until, o.created_at,
                    o.cancellation_request_status, o.cancellation_reason, o.cancellation_reason_detail,
                    o.cancellation_requested_at, o.cancellation_reviewed_at,
                    o.shiprocket_order_id, o.shiprocket_shipment_id, o.shiprocket_awb_code, o.shiprocket_courier_name,
                    o.shiprocket_status, o.shiprocket_tracking_status, o.shiprocket_latest_activity, o.shiprocket_latest_activity_at,
                    o.shiprocket_tracking_json,
                    o.shiprocket_pickup_scheduled,
                    rr.id AS return_request_id,
                    rr.status AS return_request_status,
                    rr.reason AS return_reason,
                    rr.sub_reason AS return_reason_detail,
                    rr.created_at AS return_requested_at,
                    rr.shiprocket_return_order_id AS return_shiprocket_order_id,
                    rr.shiprocket_return_shipment_id AS return_shiprocket_shipment_id,
                    rr.shiprocket_awb_code AS return_shiprocket_awb_code,
                    rr.shiprocket_courier_name AS return_shiprocket_courier_name,
                    rr.shiprocket_status AS return_shiprocket_status,
                    rr.shiprocket_tracking_status AS return_shiprocket_tracking_status,
                    rr.shiprocket_latest_activity AS return_latest_activity,
                    rr.shiprocket_latest_activity_at AS return_latest_activity_at,
                    rr.shiprocket_pickup_scheduled AS return_pickup_scheduled,
                    rr.pickup_token_number AS return_pickup_token_number,
                    rr.pickup_scheduled_at AS return_pickup_scheduled_at,
                    rr.picked_up_at AS return_picked_up_at,
                    rr.delivered_at AS return_delivered_at,
                    er.id AS exchange_request_id,
                    er.status AS exchange_request_status,
                    er.reason AS exchange_reason,
                    er.reason_detail AS exchange_reason_detail,
                    er.requested_size AS exchange_requested_size,
                    er.created_at AS exchange_requested_at,
                    rf.status AS refund_status,
                    rf.amount AS refund_amount,
                    rf.mode AS refund_mode,
                    rf.return_request_id AS refund_return_request_id,
                    rf.gateway_reference AS refund_request_id,
                    rf.remarks AS refund_notes,
                    rf.created_at AS refund_requested_at,
                    rf.completed_at AS refund_completed_at,
                    p.gateway AS payment_gateway,
                    p.gateway_payment_id,
                    COALESCE(oa.name, u.name) AS name,
                    COALESCE(oa.mobile, u.mobile_number) AS mobile,
                    COALESCE(oa.address_line, u.address_line) AS address_line,
                    COALESCE(oa.city, u.city) AS city,
                    COALESCE(oa.state, u.state) AS state,
                    COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             LEFT JOIN payments p ON p.order_id = o.order_id
             LEFT JOIN (
                SELECT rr1.*
                FROM return_requests rr1
                INNER JOIN (
                    SELECT order_id, MAX(id) AS max_id
                    FROM return_requests
                    GROUP BY order_id
                ) rrmax ON rr1.id = rrmax.max_id
             ) rr ON rr.order_id = o.order_id
             LEFT JOIN (
                SELECT er1.*
                FROM exchange_requests er1
                INNER JOIN (
                    SELECT order_id, MAX(id) AS max_id
                    FROM exchange_requests
                    GROUP BY order_id
                ) ermax ON er1.id = ermax.max_id
             ) er ON er.order_id = o.order_id
             LEFT JOIN (
                SELECT rf1.*
                FROM refund_transactions rf1
                INNER JOIN (
                    SELECT order_id, MAX(id) AS max_id
                    FROM refund_transactions
                    GROUP BY order_id
                ) rfmax ON rf1.id = rfmax.max_id
             ) rf ON rf.order_id = o.order_id
             WHERE o.user_id = ?
             ORDER BY o.created_at DESC`,
            [user_id]
        );

        const syncedOrders = [];
        for (const order of orders) {
            const trackedOrder = await syncOrderTrackingForUser(order);
            const returnSyncedOrder = await syncReturnTrackingForUser(trackedOrder);
            syncedOrders.push(await syncRefundStatusForOrder(returnSyncedOrder));
        }

        res.json({ success: true, orders: syncedOrders });
    } catch (err) {
        console.error('GET /orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

// GET /orders/:id — Specific order details with items (protected)
router.get('/orders/:id', auth, async (req, res) => {
    const user_id = req.user.userId;
    const order_id = req.params.id;

    try {
        await ensureAddressTables();
        await ensureOrderColumns();
        // Get order details
        const [orderRows] = await db.execute(
            `SELECT o.*, 
                    COALESCE(oa.name, u.name) AS name,
                    COALESCE(oa.mobile, u.mobile_number) AS mobile,
                    COALESCE(oa.address_line, u.address_line) AS address_line,
                    COALESCE(oa.city, u.city) AS city,
                    COALESCE(oa.state, u.state) AS state,
                    COALESCE(oa.pincode, u.pincode) AS pincode,
                    rr.id AS return_request_id,
                    rr.status AS return_request_status,
                    rr.reason AS return_reason,
                    rr.sub_reason AS return_reason_detail,
                    rr.description AS return_description,
                    rr.created_at AS return_requested_at,
                    rr.shiprocket_return_order_id AS return_shiprocket_order_id,
                    rr.shiprocket_return_shipment_id AS return_shiprocket_shipment_id,
                    rr.shiprocket_awb_code AS return_shiprocket_awb_code,
                    rr.shiprocket_courier_name AS return_shiprocket_courier_name,
                    rr.shiprocket_status AS return_shiprocket_status,
                    rr.shiprocket_tracking_status AS return_shiprocket_tracking_status,
                    rr.shiprocket_latest_activity AS return_latest_activity,
                    rr.shiprocket_latest_activity_at AS return_latest_activity_at,
                    rr.shiprocket_pickup_scheduled AS return_pickup_scheduled,
                    rr.pickup_token_number AS return_pickup_token_number,
                    rr.pickup_scheduled_at AS return_pickup_scheduled_at,
                    rr.picked_up_at AS return_picked_up_at,
                    rr.delivered_at AS return_delivered_at,
                    rf.status AS refund_status,
                    rf.amount AS refund_amount,
                    rf.mode AS refund_mode,
                    rf.return_request_id AS refund_return_request_id,
                    rf.gateway_reference AS refund_request_id,
                    rf.remarks AS refund_notes,
                    rf.created_at AS refund_requested_at,
                    rf.completed_at AS refund_completed_at
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             LEFT JOIN (
                SELECT rr1.*
                FROM return_requests rr1
                INNER JOIN (
                    SELECT order_id, MAX(id) AS max_id
                    FROM return_requests
                    GROUP BY order_id
                ) rrmax ON rr1.id = rrmax.max_id
             ) rr ON rr.order_id = o.order_id
             LEFT JOIN (
                SELECT rf1.*
                FROM refund_transactions rf1
                INNER JOIN (
                    SELECT return_request_id, MAX(id) AS max_id
                    FROM refund_transactions
                    GROUP BY return_request_id
                ) rfmax ON rf1.id = rfmax.max_id
             ) rf ON rf.return_request_id = rr.id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [order_id, user_id]
        );

        if (orderRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const trackedOrder = await syncOrderTrackingForUser(orderRows[0]);
        const syncedOrder = await syncReturnTrackingForUser(trackedOrder);

        // Get order items
        const [itemRows] = await db.execute(
            `SELECT oi.*, p.name, p.image_url, p.category
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [order_id]
        );

        res.json({
            success: true,
            order: syncedOrder,
            items: itemRows
        });
    } catch (err) {
        console.error('GET /orders/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order details' });
    }
});

router.get('/orders/:id/invoice', auth, async (req, res) => {
    const user_id = req.user.userId;
    const order_id = Number(req.params.id);

    try {
        await ensureAddressTables();
        await ensureOrderColumns();

        const [orderRows] = await db.execute(
            `SELECT o.order_id, o.total_amount, o.status, o.payment_method, o.invoice_number, o.invoice_date, o.created_at,
                    COALESCE(oa.name, u.name) AS name,
                    COALESCE(oa.mobile, u.mobile_number) AS mobile,
                    COALESCE(oa.address_line, u.address_line) AS address_line,
                    COALESCE(oa.city, u.city) AS city,
                    COALESCE(oa.state, u.state) AS state,
                    COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [order_id, user_id]
        );

        if (!orderRows.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const [items] = await db.execute(
            `SELECT p.name, oi.size, oi.quantity, oi.price
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = ?`,
            [order_id]
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(buildInvoiceHtml({ order: orderRows[0], items }));
    } catch (err) {
        console.error('GET /orders/:id/invoice error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
});

// PUT /orders/cancel/:id — Cancel an order (protected)
router.put('/orders/cancel/:id', auth, async (req, res) => {
    const user_id = req.user.userId;
    const order_id = req.params.id;
    const reason = String(req.body?.reason || '').trim();
    const otherReason = String(req.body?.other_reason || '').trim();

    try {
        // Find order and check status
        await ensureOrderColumns();
        await ensureInventorySchema();
        const [orders] = await db.execute(
            `SELECT o.status, o.payment_method, o.cancellation_request_status,
                    total_amount, subtotal_amount, discount_amount,
                    shiprocket_order_id, shiprocket_shipment_id, shiprocket_awb_code,
                    shiprocket_status, shiprocket_tracking_status, shiprocket_latest_activity,
                    shiprocket_latest_activity_at,
                    p.gateway AS payment_gateway,
                    p.gateway_payment_id
             FROM orders o
             LEFT JOIN payments p ON p.order_id = o.order_id
             WHERE o.order_id = ? AND o.user_id = ?`,
            [order_id, user_id]
        );

        if (orders.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        const cancelableStatuses = ['Pending', 'Paid', 'Packed'];

        if (String(order.payment_method || '').trim().toUpperCase() === 'COD') {
            return res.status(400).json({
                success: false,
                message: 'COD orders cannot be cancelled from the user dashboard'
            });
        }

        if (!cancelableStatuses.includes(order.status)) {
            return res.status(400).json({
                success: false,
                message: `Order cannot be cancelled in '${order.status}' status. It may have already been packed or shipped.`
            });
        }

        if (!CANCELLATION_REASONS.has(reason)) {
            return res.status(400).json({ success: false, message: 'Please select a valid cancellation reason' });
        }

        if (reason === 'Other' && !otherReason) {
            return res.status(400).json({ success: false, message: 'Please specify your cancellation reason' });
        }

        if (order.cancellation_request_status === 'Requested') {
            return res.status(409).json({
                success: false,
                message: 'A cancellation request is already pending for this order'
            });
        }

        const [[userRow]] = await db.execute(
            `SELECT COALESCE(NULLIF(name, ''), 'Customer') AS name, email, mobile_number
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [user_id]
        );
        const [[orderRefRow]] = await db.execute(
            'SELECT invoice_number FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1',
            [order_id, user_id]
        );

        const orderRef = orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`;
        const shouldCancelShiprocket = Boolean(order.shiprocket_order_id || order.shiprocket_shipment_id || order.shiprocket_awb_code);
        if (shouldCancelShiprocket && String(order.status || '').trim().toLowerCase() !== 'cancelled') {
            let cancelResult = null;
            if (order.shiprocket_awb_code) {
                cancelResult = await shiprocket.cancelShipmentByAwbs([order.shiprocket_awb_code]);
            }
            if (!cancelResult?.success && order.shiprocket_order_id) {
                cancelResult = await shiprocket.cancelOrder([order.shiprocket_order_id]);
            }
            if (!cancelResult?.success) {
                return res.status(502).json({
                    success: false,
                    message: 'Failed to cancel order in Shiprocket. Please try again after sync.'
                });
            }
        }

        const paymentGateway = String(order.payment_gateway || '').trim().toLowerCase();
        const payuPaymentId = String(order.gateway_payment_id || '').trim();
        const refundAmount = calculateCancellationRefundAmount(order);
        let refundPayload = null;
        let refundRequestId = '';
        let refundStatus = '';
        let refundRemarks = '';
        let refundInitiated = false;

        if (paymentGateway === 'payu' && payuPaymentId) {
            refundPayload = await initiatePayuRefund({
                payuId: payuPaymentId,
                amount: refundAmount
            });

            refundRequestId = String(refundPayload.requestId || '').trim();
            refundStatus = refundPayload.normalizedStatus || (refundPayload.ok ? 'Refund Initiated' : 'Refund Failed');
            refundInitiated = Boolean(refundRequestId || refundStatus === 'Refund Initiated');
            refundRemarks = JSON.stringify({
                payu: refundPayload.raw || null,
                merchantToken: refundPayload.merchantToken || null,
                cancellation_reason: reason,
                cancellation_reason_detail: reason === 'Other' ? otherReason : null
            });

            if (!refundPayload.ok || refundStatus === 'Refund Failed') {
                return res.status(502).json({
                    success: false,
                    message: refundPayload.statusText || 'Failed to initiate refund with PayU'
                });
            }
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE orders
                 SET status = 'Cancelled',
                     cancellation_request_status = 'Approved',
                     cancellation_reason = ?,
                     cancellation_reason_detail = ?,
                     cancellation_requested_at = COALESCE(cancellation_requested_at, NOW()),
                     cancellation_reviewed_at = NOW()
                 WHERE order_id = ? AND user_id = ?`,
                [reason, reason === 'Other' ? otherReason : null, order_id, user_id]
            );

            const [orderItems] = await conn.execute(
                'SELECT product_id, size, quantity FROM order_items WHERE order_id = ?',
                [order_id]
            );
            await restockInventoryForItems(conn, orderItems);

            if (refundInitiated) {
                await conn.execute(
                    `INSERT INTO refund_transactions
                     (order_id, amount, mode, status, gateway_reference, remarks, initiated_at, completed_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        order_id,
                        refundAmount,
                        'Original Payment',
                        refundStatus || (refundAmount > 0 ? 'Refund Initiated' : 'Refund Completed'),
                        refundRequestId || null,
                        refundRemarks || null,
                        new Date(),
                        refundStatus === 'Refund Completed' ? new Date() : null
                    ]
                );
            }

            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        if (refundInitiated) {
            sendRefundStatusNotification({
                to: userRow?.email || '',
                customerName: userRow?.name || 'Customer',
                orderReference: orderRef,
                refundAmount,
                refundMethod: 'Original Payment',
                refundStatus: refundStatus || 'Refund Initiated'
            }).catch((mailErr) => {
                console.error(`Refund status email failed for Order #${order_id}:`, mailErr.message);
            });
        } else {
            sendCancellationRequestNotification({
                orderId: Number(order_id),
                orderReference: orderRef,
                customerName: userRow?.name || 'Customer',
                customerEmail: userRow?.email || '',
                customerPhone: userRow?.mobile_number || '',
                reason,
                reasonDetail: reason === 'Other' ? otherReason : ''
            }).catch((mailErr) => {
                console.error(`Cancellation request email failed for Order #${order_id}:`, mailErr.message);
            });
        }

        sendTransactionalSms({
            mobile: userRow?.mobile_number || '',
            purpose: 'cancellation',
            message: refundInitiated
                ? `Your DEVASTHRA order ${orderRef} has been cancelled. A refund of Rs. ${Number(refundAmount).toFixed(2)} has been initiated and should reflect within 2-3 business days.`
                : `Your DEVASTHRA order ${orderRef} has been cancelled successfully.`
        }).catch((smsErr) => {
            console.error(`Cancellation request SMS failed for Order #${order_id}:`, smsErr.message);
        });

        res.json({
            success: true,
            message: refundInitiated
                ? `Order ${orderRef} cancelled and refund initiated successfully.`
                : `Order ${orderRef} cancelled successfully.`
        });
    } catch (err) {
        console.error('Cancel order error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit cancellation request' });
    }
});

module.exports = router;

