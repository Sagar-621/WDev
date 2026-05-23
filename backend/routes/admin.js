const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const adminAuth = require('../middleware/adminAuth');
const multer = require('multer');
const imagekit = require('../services/imagekit');
const shiprocket = require('../services/shiprocket');
const {
    sendAdminOTP,
    sendRefundStatusNotification,
    setMailerRuntimeConfig,
    ensureAdminMailerColumns,
    getActiveAdminMailerCredentials
} = require('../services/mailer');
const { normalizeIndianMobile, sendManagedOtp, verifyManagedOtp, sendTransactionalSms } = require('../services/sms');
const {
    initiatePayuRefund,
    checkRefundStatusByRequestId,
    checkRefundStatusByPayuId,
    classifyRefundStatus
} = require('../services/payuRefund');
const { ensureBannerTable, getBanners } = require('../utils/banners');
const {
    deleteCatalogNode,
    ensureCatalogPath,
    ensureCatalogTables,
    fetchCatalogTaxonomy,
    flattenCatalogTaxonomy,
    updateCatalogNode
} = require('../utils/catalogTaxonomy');
const {
    ensureInventorySchema,
    getProductSizeInventory,
    parseJsonArray: parseSizeArray,
    sanitizeSizeQuantities,
    syncProductSizeInventory,
    restockInventoryForItems
} = require('../utils/inventory');

// ── Audit Log Helper ──
async function logAudit(req, { action, entityType, entityId, oldValues, newValues, description }) {
    try {
        const adminId = req.admin ? req.admin.adminId : null;
        // In admin routes, user_id is usually null unless we're logging a user action
        const userId = null;

        const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '';
        const ua = req.headers['user-agent'] || '';
        await db.execute(
            `INSERT INTO audit_logs (admin_id, user_id, action, entity_type, entity_id, old_values, new_values, description, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [adminId, userId, action, entityType, entityId || null,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                description || null, ip, ua.substring(0, 500)]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

// ── Multer config (memory storage for ImageKit uploads) ──
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|jfif/;
        const mimeOk = allowed.test(file.mimetype);
        cb(null, mimeOk);
    }
});

// ── ImageKit Upload Helper ──
async function uploadToImageKit(fileBuffer, fileName, folder = '/products') {
    const result = await imagekit.upload({
        file: fileBuffer,
        fileName: fileName,
        folder: folder,
        useUniqueFileName: true
    });
    return { url: result.url, fileId: result.fileId };
}

async function deleteImageKitFileSilently(fileId) {
    if (!fileId) return;
    try {
        await imagekit.deleteFile(fileId);
    } catch (err) {
        console.error('ImageKit delete error:', err.message);
    }
}

function normalizeImageRecord(image) {
    if (!image) return null;
    if (typeof image === 'string') {
        return { url: image, fileId: null };
    }
    return {
        url: image.url || image.imagekit_url || '',
        fileId: image.fileId || image.imagekit_id || null
    };
}

function normalizePolicyText(value) {
    const text = String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim();

    if (!text) return '';

    if (!/[<>]/.test(text)) {
        return text.replace(/\n{3,}/g, '\n\n');
    }

    return text
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\/\s*(p|div|section|article|header|footer|h[1-6]|li|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

let adminProductColumnsReady = false;
let adminOrderColumnsReady = false;
let adminBannerTableReady = false;

// In-memory admin OTP store: { [adminId]: { sessionId, expiresAt, username } }
const adminOtpStore = new Map();

function getAdminOtpMobile() {
    return normalizeIndianMobile(process.env.ADMIN_OTP_MOBILE || '');
}

async function getSystemSettingsMap(keys = []) {
    if (!Array.isArray(keys) || !keys.length) return {};
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN (${placeholders})`,
        keys
    );
    return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value || '']));
}

async function publishPrivacyPolicyVersion({
    adminId = null,
    title,
    lastUpdated,
    content,
    documentUrl
}) {
    const normalizedContent = normalizePolicyText(content);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const entries = [
            ['privacy_policy_title', title],
            ['privacy_policy_last_updated', lastUpdated],
            ['privacy_policy_content', normalizedContent],
            ['privacy_policy_document_url', documentUrl]
        ];

        for (const [key, value] of entries) {
            await conn.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value]
            );
        }

        await conn.execute(
            `UPDATE legal_policy_versions
             SET is_current = FALSE
             WHERE policy_type = 'privacy_policy'`
        );

        const [insertResult] = await conn.execute(
            `INSERT INTO legal_policy_versions
             (policy_type, title, last_updated_label, content, document_url, is_current, created_by_admin_id, published_at)
             VALUES ('privacy_policy', ?, ?, ?, ?, TRUE, ?, NOW())`,
            [title, lastUpdated || null, normalizedContent, documentUrl || null, adminId]
        );

        await conn.commit();
        return insertResult.insertId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function publishTermsOfServiceVersion({
    adminId = null,
    title,
    lastUpdated,
    content,
    documentUrl
}) {
    const normalizedContent = normalizePolicyText(content);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const entries = [
            ['terms_of_service_title', title],
            ['terms_of_service_last_updated', lastUpdated],
            ['terms_of_service_content', normalizedContent],
            ['terms_of_service_document_url', documentUrl]
        ];

        for (const [key, value] of entries) {
            await conn.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value]
            );
        }

        await conn.execute(
            `UPDATE legal_policy_versions
             SET is_current = FALSE
             WHERE policy_type = 'terms_of_service'`
        );

        const [insertResult] = await conn.execute(
            `INSERT INTO legal_policy_versions
             (policy_type, title, last_updated_label, content, document_url, is_current, created_by_admin_id, published_at)
             VALUES ('terms_of_service', ?, ?, ?, ?, TRUE, ?, NOW())`,
            [title, lastUpdated || null, normalizedContent, documentUrl || null, adminId]
        );

        await conn.commit();
        return insertResult.insertId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

function getPolicySettingKeys(settingPrefix) {
    return [
        `${settingPrefix}_title`,
        `${settingPrefix}_last_updated`,
        `${settingPrefix}_content`,
        `${settingPrefix}_document_url`
    ];
}

function mapPolicySettings(settings, settingPrefix, defaultTitle) {
    return {
        title: settings[`${settingPrefix}_title`] || defaultTitle,
        last_updated: settings[`${settingPrefix}_last_updated`] || '',
        content: normalizePolicyText(settings[`${settingPrefix}_content`] || ''),
        document_url: settings[`${settingPrefix}_document_url`] || ''
    };
}

async function publishPolicyVersion({
    policyType,
    settingPrefix,
    adminId = null,
    title,
    lastUpdated,
    content,
    documentUrl
}) {
    const normalizedContent = normalizePolicyText(content);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const entries = [
            [`${settingPrefix}_title`, title],
            [`${settingPrefix}_last_updated`, lastUpdated],
            [`${settingPrefix}_content`, normalizedContent],
            [`${settingPrefix}_document_url`, documentUrl]
        ];

        for (const [key, value] of entries) {
            await conn.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value]
            );
        }

        await conn.execute(
            `UPDATE legal_policy_versions
             SET is_current = FALSE
             WHERE policy_type = ?`,
            [policyType]
        );

        const [insertResult] = await conn.execute(
            `INSERT INTO legal_policy_versions
             (policy_type, title, last_updated_label, content, document_url, is_current, created_by_admin_id, published_at)
             VALUES (?, ?, ?, ?, ?, TRUE, ?, NOW())`,
            [policyType, title, lastUpdated || null, normalizedContent, documentUrl || null, adminId]
        );

        await conn.commit();
        return insertResult.insertId;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function ensureAdminProductColumns() {
    if (adminProductColumnsReady) return;

    await ensureCatalogTables(db);

    // Ensure rating columns exist on products table
    const productColumns = [
        ['initial_rating', 'DECIMAL(3,1) NULL'],
        ['avg_rating', 'DECIMAL(3,1) NULL'],
        ['review_count', 'INT DEFAULT 0']
    ];

    for (const [name, definition] of productColumns) {
        const [rows] = await db.execute(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
            [name]
        );
        if (!rows.length) {
            await db.execute(`ALTER TABLE products ADD COLUMN ${name} ${definition}`);
        }
    }

    adminProductColumnsReady = true;
}

async function ensureAdminOrderColumns() {
    if (adminOrderColumnsReady) return;

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

    const extraColumns = [
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

    for (const [tableName, columnName, definition] of extraColumns) {
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

    adminOrderColumnsReady = true;
}

async function ensureAdminBannerColumns() {
    if (adminBannerTableReady) return;
    adminBannerTableReady = true;
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

function summarizeTracking(order) {
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
        shiprocket_tracking: tracking,
        shiprocket_status: trackingSummary.shiprocket_status || order.shiprocket_status || '',
        shiprocket_tracking_status: trackingSummary.tracking_status || fallbackTrackingLabel || fallbackTrackingStatus || '',
        shiprocket_latest_activity: trackingSummary.latest_activity || shiprocket.normalizeShiprocketStatus(order.shiprocket_latest_activity, order.shiprocket_latest_activity).display_status || '',
        shiprocket_latest_activity_at: trackingSummary.latest_activity_at || order.shiprocket_latest_activity_at || null,
        shiprocket_display_status: trackingSummary.display_status || trackingSummary.tracking_status || trackingSummary.shiprocket_status || fallbackTrackingLabel || fallbackTrackingStatus || '',
        shiprocket_system_status: trackingSummary.system_status || normalizedTracking.system_status || '',
        shiprocket_user_message: trackingSummary.user_message || normalizedTracking.user_message || ''
    };
}

async function syncRefundStatusForReturnRow(returnRow) {
    const currentStatus = String(returnRow?.refund_status || '').trim();
    if (!currentStatus || currentStatus === 'Refund Completed' || currentStatus === 'Refund Failed') {
        return returnRow;
    }

    const requestId = String(returnRow?.refund_request_id || '').trim();
    const payuPaymentId = String(returnRow?.gateway_payment_id || '').trim();
    if (!requestId && !payuPaymentId) {
        return returnRow;
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
                 WHERE order_id = ? ${returnRow.refund_return_request_id ? 'AND return_request_id = ?' : 'AND gateway_reference = ?'}
                 ORDER BY id DESC
                 LIMIT 1`,
                returnRow.refund_return_request_id
                    ? [normalized, refundNotes, normalized === 'Refund Completed' ? new Date() : null, returnRow.order_id, returnRow.refund_return_request_id]
                    : [normalized, refundNotes, normalized === 'Refund Completed' ? new Date() : null, returnRow.order_id, requestId]
            );

            if (returnRow.refund_return_request_id) {
                await db.execute(
                    'UPDATE return_requests SET status = ?, updated_at = NOW() WHERE id = ?',
                    [normalized, returnRow.refund_return_request_id]
                );
            }

            return {
                ...returnRow,
                refund_status: normalized,
                refund_notes: refundNotes,
                refund_completed_at: normalized === 'Refund Completed' ? new Date().toISOString() : returnRow.refund_completed_at || null
            };
        }

        await db.execute(
            `UPDATE refund_transactions
             SET remarks = ?, updated_at = NOW()
             WHERE order_id = ? ${returnRow.refund_return_request_id ? 'AND return_request_id = ?' : 'AND gateway_reference = ?'}
             ORDER BY id DESC
             LIMIT 1`,
            returnRow.refund_return_request_id
                ? [refundNotes, returnRow.order_id, returnRow.refund_return_request_id]
                : [refundNotes, returnRow.order_id, requestId]
        );

        return {
            ...returnRow,
            refund_notes: refundNotes
        };
    } catch (err) {
        console.error(`PayU refund sync failed for return #${returnRow?.id}:`, err.message);
        return returnRow;
    }
}

function normalizeReturnTrackingStatus(trackingResult = {}) {
    const status = String(
        trackingResult.display_status ||
        trackingResult.tracking_status ||
        trackingResult.shiprocket_status ||
        trackingResult.latest_activity ||
        ''
    ).trim().toLowerCase();

    const latestActivity = String(trackingResult.latest_activity || '').trim().toLowerCase();
    const combined = `${status} ${latestActivity}`.trim();

    if (!combined) {
        return { status: '', latest_activity: trackingResult.latest_activity || '', return_state: '' };
    }

    if (combined.includes('deliver') || combined.includes('delivered')) {
        return { status: 'Delivered', latest_activity: trackingResult.latest_activity || 'Delivered', return_state: 'Delivered' };
    }
    if (combined.includes('picked up') || combined.includes('pickup done')) {
        return { status: 'Picked Up', latest_activity: trackingResult.latest_activity || 'Picked Up', return_state: 'Picked Up' };
    }
    if (combined.includes('pickup scheduled') || combined.includes('pickup generated') || combined.includes('pickup requested')) {
        return { status: 'Pickup Scheduled', latest_activity: trackingResult.latest_activity || 'Pickup Scheduled', return_state: 'Pickup Scheduled' };
    }
    if (combined.includes('awb') || combined.includes('manifest') || combined.includes('created') || combined.includes('assigned')) {
        return { status: 'Approved', latest_activity: trackingResult.latest_activity || 'AWB Assigned', return_state: 'Approved' };
    }

    return {
        status: trackingResult.display_status || trackingResult.tracking_status || trackingResult.shiprocket_status || trackingResult.latest_activity || '',
        latest_activity: trackingResult.latest_activity || '',
        return_state: ''
    };
}

async function syncReturnShipmentForRow(returnRow) {
    const shipmentId = String(returnRow?.shiprocket_return_shipment_id || '').trim();
    const awbCode = String(returnRow?.shiprocket_awb_code || '').trim();
    if (!shipmentId && !awbCode) return returnRow;

    try {
        const tracking = awbCode
            ? await shiprocket.trackByAwb(awbCode)
            : await shiprocket.trackByShipment(shipmentId);
        if (!tracking) return returnRow;

        const mapped = normalizeReturnTrackingStatus(tracking);
        const nextStatus = mapped.return_state || String(returnRow.status || '').trim();
        const updates = [
            'shiprocket_status = ?',
            'shiprocket_tracking_status = ?',
            'shiprocket_latest_activity = ?',
            'shiprocket_latest_activity_at = NOW()',
            'shiprocket_tracking_json = ?'
        ];
        const params = [
            tracking.shiprocket_status || tracking.tracking_status || mapped.status || '',
            tracking.tracking_status || tracking.display_status || mapped.status || '',
            tracking.latest_activity || mapped.latest_activity || '',
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

        if (nextStatus === 'Pickup Scheduled') {
            updates.push('shiprocket_pickup_scheduled = 1');
            updates.push('pickup_scheduled_at = COALESCE(pickup_scheduled_at, NOW())');
        }
        if (nextStatus === 'Picked Up') {
            updates.push('picked_up_at = COALESCE(picked_up_at, NOW())');
        }
        if (nextStatus === 'Delivered') {
            updates.push('delivered_at = COALESCE(delivered_at, NOW())');
        }

        await db.execute(
            `UPDATE return_requests SET ${updates.join(', ')} WHERE id = ?`,
            [...params, returnRow.id]
        );

        return {
            ...returnRow,
            shiprocket_status: tracking.shiprocket_status || tracking.tracking_status || returnRow.shiprocket_status || '',
            shiprocket_tracking_status: tracking.tracking_status || tracking.display_status || returnRow.shiprocket_tracking_status || '',
            shiprocket_latest_activity: tracking.latest_activity || returnRow.shiprocket_latest_activity || '',
            shiprocket_latest_activity_at: new Date(),
            shiprocket_tracking_json: tracking.tracking_payload || tracking || null,
            shiprocket_awb_code: tracking.shiprocket_awb_code || returnRow.shiprocket_awb_code || '',
            shiprocket_courier_name: tracking.courier_name || returnRow.shiprocket_courier_name || '',
            shiprocket_return_shipment_id: tracking.shiprocket_shipment_id || returnRow.shiprocket_return_shipment_id || '',
            shiprocket_pickup_scheduled: nextStatus === 'Pickup Scheduled' ? 1 : returnRow.shiprocket_pickup_scheduled,
            status: nextStatus || returnRow.status
        };
    } catch (err) {
        console.error(`Return shipment sync failed for return #${returnRow?.id || '?'}:`, err.message);
        return returnRow;
    }
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

function isShiprocketActionBlocked(order) {
    const summary = summarizeTracking(order);
    const normalized = String(
        summary.shiprocket_system_status ||
        summary.shiprocket_display_status ||
        summary.shiprocket_tracking_status ||
        summary.shiprocket_status ||
        ''
    ).trim().toUpperCase();

    return normalized.includes('CANCEL') || normalized.includes('RTO') || normalized.includes('RETURN');
}

function getOrderStatusRank(status) {
    const normalized = String(status || '').trim().toLowerCase();
    const ranks = {
        pending: 1,
        paid: 2,
        packed: 3,
        shipped: 4,
        delivered: 5
    };
    return ranks[normalized] || 0;
}

function deriveOrderStatusFromShiprocket(order) {
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
        trackingLabel.includes('out-for-delivery')
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
        trackingLabel.includes('pick') ||
        trackingLabel.includes('booked')
    ) {
        return 'Packed';
    }
    return '';
}

async function applyDerivedOrderStatus(conn, order, nextStatus) {
    if (!nextStatus) return order;

    const currentStatus = String(order.status || '').trim();
    if (!currentStatus || currentStatus.toLowerCase() === 'cancelled') return order;
    if (getOrderStatusRank(nextStatus) <= getOrderStatusRank(currentStatus)) return order;

    let deliveryDate = order.delivery_date || null;
    let returnEligibleUntil = order.return_eligible_until || null;

    if (nextStatus === 'Delivered') {
        const latestDate = order.shiprocket_latest_activity_at
            ? new Date(order.shiprocket_latest_activity_at)
            : new Date();
        const safeDeliveryDate = Number.isNaN(latestDate.getTime()) ? new Date() : latestDate;
        deliveryDate = safeDeliveryDate.toISOString().split('T')[0];

        const [windowRows] = await conn.execute(
            `SELECT MAX(p.return_window_days) as max_window
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [order.order_id]
        );
        const returnDays = windowRows[0]?.max_window || 7;
        const returnDeadline = new Date(safeDeliveryDate);
        returnDeadline.setDate(returnDeadline.getDate() + returnDays);
        returnEligibleUntil = returnDeadline.toISOString().split('T')[0];

        await conn.execute(
            `UPDATE orders
             SET status = ?, delivery_date = COALESCE(delivery_date, ?), return_eligible_until = ?
             WHERE order_id = ?`,
            [nextStatus, deliveryDate, returnEligibleUntil, order.order_id]
        );
    } else {
        await conn.execute(
            'UPDATE orders SET status = ? WHERE order_id = ?',
            [nextStatus, order.order_id]
        );
    }

    return {
        ...order,
        status: nextStatus,
        delivery_date: deliveryDate,
        return_eligible_until: returnEligibleUntil
    };
}

async function syncOrderShippingState(order) {
    try {
        if (!order?.order_id) return order;
        if (!order.shiprocket_shipment_id && !order.shiprocket_awb_code) {
            return summarizeTracking(order);
        }

        const syncResult = await shiprocket.syncShipment({
            shipmentId: order.shiprocket_shipment_id || '',
            awbCode: order.shiprocket_awb_code || '',
            orderStatus: order.status || ''
        });

        if (!syncResult) {
            return summarizeTracking(order);
        }

        await saveShiprocketFields(order.order_id, syncResult);

        const mergedOrder = summarizeTracking({
            ...order,
            ...syncResult,
            shiprocket_status: syncResult.shiprocket_status || order.shiprocket_status || '',
            shiprocket_tracking_status: syncResult.shiprocket_tracking_status || order.shiprocket_tracking_status || '',
            shiprocket_latest_activity: syncResult.shiprocket_latest_activity || order.shiprocket_latest_activity || '',
            shiprocket_latest_activity_at: syncResult.shiprocket_latest_activity_at || order.shiprocket_latest_activity_at || null,
            shiprocket_tracking_json: syncResult.shiprocket_tracking_json || order.shiprocket_tracking_json || null,
            shiprocket_pickup_scheduled: syncResult.shiprocket_pickup_scheduled ?? order.shiprocket_pickup_scheduled
        });

        const derivedStatus = deriveOrderStatusFromShiprocket(mergedOrder);
        if (!derivedStatus) return mergedOrder;

        const conn = await db.getConnection();
        try {
            return await applyDerivedOrderStatus(conn, mergedOrder, derivedStatus);
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error(`Shiprocket sync failed for order #${order?.order_id}:`, err);
        return summarizeTracking(order);
    }
}

async function saveShiprocketFields(orderId, shiprocketResult) {
    if (!shiprocketResult) return;

    const normalizedLatestActivityAt = normalizeShiprocketDatetime(
        shiprocketResult.shiprocket_latest_activity_at || shiprocketResult.latest_activity_at
    );

    await db.execute(
        `UPDATE orders
         SET shiprocket_order_id = COALESCE(?, shiprocket_order_id),
             shiprocket_shipment_id = COALESCE(?, shiprocket_shipment_id),
             shiprocket_awb_code = COALESCE(?, shiprocket_awb_code),
             shiprocket_courier_name = COALESCE(?, shiprocket_courier_name),
             shiprocket_status = COALESCE(?, shiprocket_status),
             shiprocket_tracking_status = COALESCE(?, shiprocket_tracking_status),
             shiprocket_latest_activity = COALESCE(?, shiprocket_latest_activity),
             shiprocket_latest_activity_at = COALESCE(?, shiprocket_latest_activity_at),
             shiprocket_tracking_json = COALESCE(?, shiprocket_tracking_json),
             shiprocket_pickup_scheduled = ?
        WHERE order_id = ?`,
        [
            shiprocketResult.shiprocket_order_id || null,
            shiprocketResult.shiprocket_shipment_id || null,
            shiprocketResult.shiprocket_awb_code || null,
            shiprocketResult.shiprocket_courier_name || null,
            shiprocketResult.shiprocket_status || shiprocketResult.shiprocket_tracking_status || null,
            shiprocketResult.shiprocket_tracking_status || shiprocketResult.shiprocket_status || null,
            shiprocketResult.shiprocket_latest_activity || shiprocketResult.shiprocket_tracking_status || shiprocketResult.shiprocket_status || null,
            normalizedLatestActivityAt,
            shiprocketResult.shiprocket_tracking_json
                ? JSON.stringify(shiprocketResult.shiprocket_tracking_json)
                : null,
            shiprocketResult.shiprocket_pickup_scheduled ? 1 : 0,
            orderId
        ]
    );
}

function parseJsonArray(value) {
    try {
        return JSON.parse(value || '[]');
    } catch {
        return [];
    }
}

function parseJsonInput(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (Array.isArray(fallback)) {
        if (Array.isArray(value)) return value;
    } else if (typeof fallback === 'object' && typeof value === 'object') {
        return value;
    }

    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    return fallback;
}

function cleanHighlightText(value) {
    return String(value || '')
        .replace(/^(?:\uFEFF|\u00A0|\s|•|·|â€¢|Ã¢â‚¬Â¢)+/u, '')
        .trim();
}

function sanitizeHighlightList(value) {
    return parseJsonInput(value, [])
        .map(cleanHighlightText)
        .filter(Boolean);
}

async function enrichProductInventory(product) {
    const size_inventory = await getProductSizeInventory(product.id);
    return {
        ...product,
        color: parseJsonInput(product.color, []),
        sizes: parseSizeArray(product.sizes),
        size_inventory,
        has_size_inventory: size_inventory.length > 0
    };
}

function formatCurrency(value) {
    return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildInvoiceHtml({ order, items, address, title = 'DEVASTHRA Invoice' }) {
    const itemsHtml = items.map((item, index) => `
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
        <title>${title}</title>
        <style>
            body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; }
            .header, .meta, .address { margin-bottom: 24px; }
            .brand { font-size: 28px; font-weight: 700; color: #6B0F2B; }
            .subtle { color: #6b7280; font-size: 14px; }
            .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 14px; }
            th { background: #f3f4f6; }
            .totals { margin-top: 20px; width: 280px; margin-left: auto; }
            .totals div { display: flex; justify-content: space-between; padding: 8px 0; }
            .totals .grand { font-size: 18px; font-weight: 700; border-top: 2px solid #111827; margin-top: 8px; }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="brand">DEVASTHRA</div>
            <div class="subtle">Culture in Motion</div>
        </div>
        <div class="meta meta-grid">
            <div><strong>Invoice No:</strong> ${order.invoice_number || '-'}</div>
            <div><strong>Invoice Date:</strong> ${order.invoice_date || order.created_at}</div>
            <div><strong>Order Ref:</strong> ${order.invoice_number || `NATDEV${String(order.order_id).padStart(3, '0')}`}</div>
            <div><strong>Payment Method:</strong> ${order.payment_method || 'Prepaid'}</div>
            <div><strong>Order Status:</strong> ${order.status}</div>
            <div><strong>Customer:</strong> ${order.customer_name || address.name || '-'}</div>
        </div>
        <div class="address">
            <strong>Shipping Address</strong><br>
            ${[address.name, address.mobile, address.address_line, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
        </div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>
        <div class="totals">
            <div class="grand"><span>Grand Total</span><span>${formatCurrency(order.total_amount)}</span></div>
        </div>
    </body>
    </html>`;
}

// =========================================
// AUTH
// =========================================

// POST /admin/login — Step 1: send OTP to the configured admin mobile
router.post('/login', async (req, res) => {
    try {
        await ensureAdminMailerColumns();
        const adminMobile = getAdminOtpMobile();
        const [admins] = await db.execute(
            `SELECT id, username, support_email, smtp_app_password, is_active
             FROM admins
             WHERE is_active = TRUE
             ORDER BY id ASC
             LIMIT 1`
        );
        const admin = admins[0] || { id: 1, username: 'admin' };
        const inputEmail = String(req.body?.email || '').trim().toLowerCase();
        const inputPassword = String(req.body?.password || '').trim();
        const adminCredentials = {
            supportEmail: String(admin.support_email || '').trim(),
            appPassword: String(admin.smtp_app_password || '').trim()
        };
        if (!adminCredentials.supportEmail || !adminCredentials.appPassword) {
            return res.status(500).json({ success: false, message: 'Admin credentials are not configured in the database' });
        }
        setMailerRuntimeConfig({
            supportEmail: adminCredentials.supportEmail,
            user: adminCredentials.supportEmail,
            appPassword: adminCredentials.appPassword
        });
        const adminEmail = String(adminCredentials.supportEmail || '').trim().toLowerCase();

        if (!inputEmail || !inputPassword) {
            return res.status(400).json({ success: false, message: 'Admin email and password are required' });
        }

        if (inputEmail !== adminEmail || inputPassword !== adminCredentials.appPassword) {
            return res.status(401).json({ success: false, message: 'Login failed' });
        }

        if (!adminMobile && !adminEmail) {
            return res.status(500).json({ success: false, message: 'Admin OTP delivery is not configured' });
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        let otpResult = null;
        const deliveryResults = [];

        if (adminMobile) {
            try {
                console.log(`[ADMIN OTP] Requesting mobile OTP for ${adminMobile}`);
                otpResult = await sendManagedOtp({ mobile: adminMobile, otp });
                deliveryResults.push('mobile');
            } catch (smsErr) {
                console.error('[ADMIN OTP] Mobile OTP send failed:', smsErr.message || smsErr);
            }
        }

        if (adminEmail) {
            try {
                console.log(`[ADMIN OTP] Sending email OTP to ${adminEmail}`);
                await sendAdminOTP(otp);
                deliveryResults.push('email');
            } catch (mailErr) {
                console.error('[ADMIN OTP] Email OTP send failed:', mailErr.message || mailErr);
            }
        }

        if (!deliveryResults.length) {
            return res.status(500).json({ success: false, message: 'Failed to send admin OTP' });
        }

        adminOtpStore.set(admin.id, {
            sessionId: otpResult?.sessionId || '',
            otp,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
            username: admin.username,
            mobile: adminMobile,
            email: adminEmail
        });
        console.log(`[ADMIN OTP] OTP delivery prepared for admin #${admin.id}`);

        res.json({
            success: true,
            otpRequired: true,
            adminId: admin.id,
            mobileHint: adminMobile ? `+91 ${adminMobile.slice(0, 2)}******${adminMobile.slice(-2)}` : '',
            emailHint: adminEmail || '',
            channels: deliveryResults,
            message: deliveryResults.length === 2
                ? 'OTP sent to admin mobile and email'
                : deliveryResults[0] === 'mobile'
                    ? 'OTP sent to admin mobile'
                    : 'OTP sent to admin email'
        });
    } catch (err) {
        console.error('admin login error:', err);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// POST /admin/verify-otp — Step 2: verify OTP and issue JWT
router.post('/verify-otp', async (req, res) => {
    const { adminId, otp } = req.body;

    if (!adminId || !otp) {
        return res.status(400).json({ success: false, message: 'Admin ID and OTP required' });
    }

    try {
        const stored = adminOtpStore.get(Number(adminId));
        if (!stored) {
            return res.status(401).json({ success: false, message: 'No OTP found. Please login again.' });
        }

        if (Date.now() > stored.expiresAt) {
            adminOtpStore.delete(Number(adminId));
            return res.status(401).json({ success: false, message: 'OTP expired. Please login again.' });
        }

        if (stored.sessionId) {
            await verifyManagedOtp({ sessionId: stored.sessionId, otp });
        } else if (String(stored.otp || '').trim() !== String(otp || '').trim()) {
            return res.status(401).json({ success: false, message: 'Invalid OTP' });
        }

        // OTP valid — clear it and issue token
        adminOtpStore.delete(Number(adminId));

        const token = jwt.sign(
            { adminId: Number(adminId), username: stored.username, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Audit
        req.admin = { adminId: Number(adminId), username: stored.username };
        logAudit(req, { action: 'LOGIN', entityType: 'admin', entityId: Number(adminId), description: `Admin '${stored.username}' logged in (OTP verified)` });

        res.json({ success: true, token, username: stored.username });
    } catch (err) {
        console.error('admin OTP verify error:', err);
        if (/invalid otp/i.test(String(err.message || '')) || /expired/i.test(String(err.message || ''))) {
            return res.status(401).json({ success: false, message: 'Invalid OTP' });
        }
        res.status(500).json({ success: false, message: 'OTP verification failed' });
    }
});

// =========================================
// DASHBOARD STATS
// =========================================

// GET /admin/orders/stats (admin protected)
router.get('/orders/stats', adminAuth, async (req, res) => {
    try {
        const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM orders');
        const [[{ revenue }]] = await db.execute('SELECT SUM(total_amount) as revenue FROM orders WHERE status = "Paid"');
        const [[{ cancelled }]] = await db.execute('SELECT COUNT(*) as cancelled FROM orders WHERE status = "Cancelled"');
        const [[{ paid }]] = await db.execute('SELECT COUNT(*) as paid FROM orders WHERE status = "Paid"');
        const [[{ users }]] = await db.execute('SELECT COUNT(*) as users FROM users');
        const [[{ admins }]] = await db.execute('SELECT COUNT(*) as admins FROM admins');
        const [[{ products }]] = await db.execute('SELECT COUNT(*) as products FROM products');
        const [[{ lowStock }]] = await db.execute('SELECT COUNT(*) as lowStock FROM products WHERE stock <= 5 AND stock > 0');
        const [[{ pendingReturns }]] = await db.execute("SELECT COUNT(*) as pendingReturns FROM return_requests WHERE status = 'Requested'");

        res.json({
            success: true,
            stats: { total, revenue: revenue || 0, cancelled,  paid,  users, admins, products, lowStock, pendingReturns }
        });
    } catch (err) {
        console.error('GET /admin/orders/stats error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
});

// =========================================
// ORDERS
// =========================================

// GET /admin/orders (admin protected)
router.get('/orders', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        await ensureInventorySchema();
        const [orders] = await db.execute(
            `SELECT 
                o.order_id,
                o.invoice_number,
                o.total_amount,
                o.status,
                o.cancellation_request_status,
                o.cancellation_reason,
                o.cancellation_reason_detail,
                o.cancellation_requested_at,
                o.cancellation_reviewed_at,
                o.payment_method,
                o.invoice_number,
                o.delivery_date,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                rr.id AS return_request_id,
                rr.status AS return_request_status,
                rr.reason AS return_reason,
                rr.sub_reason AS return_reason_detail,
                rr.created_at AS return_requested_at,
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
                    o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.address_line, u.address_line) AS address_line,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode,
                p.gateway_payment_id,
                p.status AS payment_status
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
             ORDER BY o.created_at DESC`
        );

        const syncedOrders = [];
        for (const order of orders) {
            const syncedOrder = await syncOrderShippingState(order);
            const [items] = await db.execute(
                `SELECT oi.quantity, oi.size, oi.price,
                        pr.id AS product_id, pr.name AS product_name, pr.image_url
                 FROM order_items oi
                 JOIN products pr ON oi.product_id = pr.id
                 WHERE oi.order_id = ?`,
                [order.order_id]
            );
            syncedOrders.push({
                ...(syncedOrder || order),
                items
            });
        }

        res.json({ success: true, orders: syncedOrders.map(summarizeTracking), total: syncedOrders.length });
    } catch (err) {
        console.error('admin/orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
});

router.get('/shipments', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();

        const [shipments] = await db.execute(
            `SELECT
                o.order_id,
                o.invoice_number,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.shiprocket_order_id IS NOT NULL
                OR o.shiprocket_shipment_id IS NOT NULL
                OR o.shiprocket_awb_code IS NOT NULL
             ORDER BY o.created_at DESC`
        );

        const syncedShipments = [];
        for (const shipment of shipments) {
            const syncedShipment = await syncOrderShippingState(shipment);
            syncedShipments.push(summarizeTracking(syncedShipment || shipment));
        }

        res.json({
            success: true,
            shipments: syncedShipments,
            total: syncedShipments.length
        });
    } catch (err) {
        console.error('GET /admin/shipments error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch shipments' });
    }
});

router.post('/shipments/:orderId/sync', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const [orders] = await db.execute(
            `SELECT
                o.order_id,
                o.invoice_number,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                o.delivery_date,
                o.return_eligible_until,
                o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        if (!order.shiprocket_shipment_id && !order.shiprocket_awb_code) {
            return res.status(400).json({ success: false, message: 'This order is not linked to Shiprocket yet' });
        }

        const syncedOrder = await syncOrderShippingState(order);

        const [updatedRows] = await db.execute(
            `SELECT
                o.order_id,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                o.delivery_date,
                o.return_eligible_until,
                o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        const responseShipment = summarizeTracking(updatedRows[0] || syncedOrder || order);

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'shipment',
            entityId: orderId,
            description: `Shiprocket shipment synced for order #${orderId}`
        });

        res.json({
            success: true,
            shipment: responseShipment,
            message: `Shipment synced for order #${orderId}`
        });
    } catch (err) {
        console.error('POST /admin/shipments/:orderId/sync error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync shipment' });
    }
});

router.post('/shipments/:orderId/assign-awb', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const [orders] = await db.execute(
            `SELECT
                o.order_id,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                o.delivery_date,
                o.return_eligible_until,
                o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        if (!order.shiprocket_shipment_id) {
            return res.status(400).json({ success: false, message: 'This order does not have a Shiprocket shipment id yet' });
        }
        if (isShiprocketActionBlocked(order)) {
            return res.status(409).json({ success: false, message: 'This shipment is already cancelled or returning. AWB cannot be assigned.' });
        }
        if (order.shiprocket_awb_code) {
            return res.status(409).json({ success: false, message: 'AWB is already assigned for this order' });
        }

        const awbResult = await shiprocket.assignAwb(order.shiprocket_shipment_id);
        if (!awbResult?.awb_code) {
            return res.status(400).json({
                success: false,
                message: awbResult?.awb_assign_error || awbResult?.message || 'Shiprocket did not return an AWB for this shipment',
                shiprocket_error: awbResult?.awb_assign_error || awbResult?.message || '',
                shiprocket_status_code: awbResult?.status_code ?? null,
                shiprocket_awb_assign_status: awbResult?.awb_assign_status ?? null
            });
        }

        await saveShiprocketFields(orderId, {
            shiprocket_shipment_id: order.shiprocket_shipment_id,
            shiprocket_awb_code: awbResult.awb_code,
            shiprocket_courier_name: awbResult.courier_name || order.shiprocket_courier_name || '',
            shiprocket_status: 'AWB Assigned',
            shiprocket_tracking_status: 'AWB Assigned',
            shiprocket_latest_activity: 'AWB assigned from admin panel',
            shiprocket_latest_activity_at: new Date()
        });

        const syncedOrder = await syncOrderShippingState({
            ...order,
            shiprocket_awb_code: awbResult.awb_code,
            shiprocket_courier_name: awbResult.courier_name || order.shiprocket_courier_name || ''
        });

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'shipment',
            entityId: orderId,
            newValues: { shiprocket_awb_code: awbResult.awb_code, shiprocket_courier_name: awbResult.courier_name || '' },
            description: `AWB assigned from admin panel for order #${orderId}`
        });

        res.json({
            success: true,
            shipment: summarizeTracking(syncedOrder || order),
            message: `AWB assigned for order #${orderId}`
        });
    } catch (err) {
        console.error('POST /admin/shipments/:orderId/assign-awb error:', err);
        res.status(500).json({ success: false, message: 'Failed to assign AWB' });
    }
});

router.post('/shipments/:orderId/schedule-pickup', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        const orderId = Number(req.params.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const [orders] = await db.execute(
            `SELECT
                o.order_id,
                o.total_amount,
                o.status,
                o.payment_method,
                o.shiprocket_order_id,
                o.shiprocket_shipment_id,
                o.shiprocket_awb_code,
                o.shiprocket_courier_name,
                o.shiprocket_status,
                o.shiprocket_tracking_status,
                o.shiprocket_latest_activity,
                o.shiprocket_latest_activity_at,
                o.shiprocket_tracking_json,
                o.shiprocket_pickup_scheduled,
                o.delivery_date,
                o.return_eligible_until,
                o.created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const order = orders[0];
        if (!order.shiprocket_shipment_id) {
            return res.status(400).json({ success: false, message: 'This order does not have a Shiprocket shipment id yet' });
        }
        if (!order.shiprocket_awb_code) {
            return res.status(400).json({ success: false, message: 'Assign AWB before scheduling pickup' });
        }
        if (isShiprocketActionBlocked(order)) {
            return res.status(409).json({ success: false, message: 'This shipment is already cancelled or returning. Pickup cannot be scheduled.' });
        }
        if (Number(order.shiprocket_pickup_scheduled) === 1 || order.shiprocket_pickup_scheduled === true) {
            return res.status(409).json({ success: false, message: 'Pickup is already scheduled for this order' });
        }

        const pickupResult = await shiprocket.generatePickup(order.shiprocket_shipment_id);
        if (!pickupResult?.pickup_scheduled) {
            return res.status(400).json({
                success: false,
                message: pickupResult?.pickup_error || pickupResult?.pickup_status || 'Shiprocket did not confirm pickup scheduling',
                shiprocket_error: pickupResult?.pickup_error || pickupResult?.pickup_status || '',
                shiprocket_status_code: pickupResult?.pickup_status_code ?? null
            });
        }

        await saveShiprocketFields(orderId, {
            shiprocket_shipment_id: order.shiprocket_shipment_id,
            shiprocket_awb_code: order.shiprocket_awb_code,
            shiprocket_courier_name: order.shiprocket_courier_name || '',
            shiprocket_status: pickupResult.pickup_status || 'Pickup Scheduled',
            shiprocket_tracking_status: pickupResult.pickup_status || 'Pickup Scheduled',
            shiprocket_latest_activity: pickupResult.pickup_status || 'Pickup scheduled from admin panel',
            shiprocket_latest_activity_at: new Date(),
            shiprocket_pickup_scheduled: true
        });

        const syncedOrder = await syncOrderShippingState({
            ...order,
            shiprocket_pickup_scheduled: true
        });

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'shipment',
            entityId: orderId,
            newValues: { shiprocket_pickup_scheduled: true },
            description: `Pickup scheduled from admin panel for order #${orderId}`
        });

        res.json({
            success: true,
            shipment: summarizeTracking(syncedOrder || { ...order, shiprocket_pickup_scheduled: true }),
            message: `Pickup scheduled for order #${orderId}`
        });
    } catch (err) {
        console.error('POST /admin/shipments/:orderId/schedule-pickup error:', err);
        res.status(500).json({ success: false, message: 'Failed to schedule pickup' });
    }
});

router.get('/orders/:id/invoice', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        const orderId = Number(req.params.id);

        const [orders] = await db.execute(
            `SELECT o.order_id, o.total_amount, o.status, o.payment_method, o.invoice_number, o.invoice_date, o.created_at,
                    COALESCE(oa.name, u.name) AS customer_name,
                    COALESCE(oa.mobile, u.mobile_number) AS mobile,
                    COALESCE(oa.address_line, u.address_line) AS address_line,
                    COALESCE(oa.city, u.city) AS city,
                    COALESCE(oa.state, u.state) AS state,
                    COALESCE(oa.pincode, u.pincode) AS pincode
             FROM orders o
             JOIN users u ON o.user_id = u.id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!orders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const [items] = await db.execute(
            `SELECT p.name, oi.size, oi.quantity, oi.price
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(buildInvoiceHtml({
            order: orders[0],
            items,
            address: orders[0],
            title: `Invoice #${orders[0].invoice_number || orderId}`
        }));
    } catch (err) {
        console.error('admin invoice error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate invoice' });
    }
});

// PUT /admin/order-status (admin protected)
router.put('/order-status', adminAuth, async (req, res) => {
    const { order_id, status, delivery_date } = req.body;

    const validStatuses = ['Pending', 'Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
    if (!order_id || !status || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'order_id and valid status required' });
    }

    try {
        await ensureAdminOrderColumns();
        let query = 'UPDATE orders SET status = ?';
        let params = [status];
        const [existingOrders] = await db.execute(
            `SELECT o.user_id, o.status, o.invoice_number, o.total_amount, o.subtotal_amount, o.discount_amount,
                    o.shiprocket_order_id, o.shiprocket_shipment_id, o.shiprocket_awb_code,
                    shiprocket_status, shiprocket_tracking_status, shiprocket_latest_activity,
                    shiprocket_latest_activity_at, shiprocket_tracking_json, cancellation_request_status,
                    p.gateway AS payment_gateway, p.gateway_payment_id
             FROM orders o
             LEFT JOIN payments p ON p.order_id = o.order_id
             WHERE o.order_id = ?
             LIMIT 1`,
            [order_id]
        );
        if (!existingOrders.length) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const previousStatus = String(existingOrders[0].status || '').trim();
        const shiprocketOrderId = String(existingOrders[0].shiprocket_order_id || '').trim();
        const shiprocketShipmentId = String(existingOrders[0].shiprocket_shipment_id || '').trim();
        const shiprocketAwbCode = String(existingOrders[0].shiprocket_awb_code || '').trim();
        const cancellationRequestStatus = String(existingOrders[0].cancellation_request_status || 'None');
        const shiprocketDerivedStatus = deriveOrderStatusFromShiprocket(summarizeTracking(existingOrders[0]));
        const isShiprocketManaged = Boolean(shiprocketOrderId || shiprocketShipmentId || shiprocketAwbCode);
        const allowedTransitions = {
            Pending: ['Pending', 'Paid', 'Packed', 'Cancelled'],
            Paid: ['Paid', 'Packed', 'Cancelled'],
            Packed: cancellationRequestStatus === 'Requested'
                ? ['Packed', 'Shipped', 'Cancelled']
                : ['Packed', 'Shipped'],
            Shipped: ['Shipped', 'Delivered'],
            Delivered: ['Delivered'],
            Cancelled: ['Cancelled']
        };
        const nextAllowedStatuses = allowedTransitions[previousStatus] || [previousStatus];

        if (!nextAllowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Order in '${previousStatus}' status cannot be changed to '${status}'`
            });
        }

        if (
            (status === 'Packed' && !['Packed', 'Shipped', 'Delivered'].includes(shiprocketDerivedStatus)) ||
            (status === 'Shipped' && !['Shipped', 'Delivered'].includes(shiprocketDerivedStatus)) ||
            (status === 'Delivered' && shiprocketDerivedStatus !== 'Delivered')
        ) {
            return res.status(409).json({
                success: false,
                message: `Shiprocket is still '${existingOrders[0].shiprocket_tracking_status || existingOrders[0].shiprocket_status || 'NEW'}'. Update the shipment in Shiprocket first before marking this order as '${status}'.`
            });
        }

        if (
            isShiprocketManaged &&
            status !== previousStatus &&
            ['Packed', 'Shipped', 'Delivered'].includes(status)
        ) {
            return res.status(409).json({
                success: false,
                message: `This order is managed by Shiprocket. Use Shiprocket shipment actions and Sync instead of manually setting '${status}'.`
            });
        }

        if (delivery_date) {
            query += ', delivery_date = ?';
            params.push(delivery_date);
        }

        // Auto-set return deadline when marking as Delivered
        if (status === 'Delivered') {
            const delivDate = delivery_date || new Date().toISOString().split('T')[0];
            // Find the max return window from this order's products
            const [windowRows] = await db.execute(
                `SELECT MAX(p.return_window_days) as max_window
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order_id]
            );
            const returnDays = windowRows[0]?.max_window || 7;
            const returnDeadline = new Date(delivDate);
            returnDeadline.setDate(returnDeadline.getDate() + returnDays);

            query += ', delivery_date = COALESCE(delivery_date, ?), return_eligible_until = ?';
            params.push(delivDate, returnDeadline.toISOString().split('T')[0]);
        }

        let refundAmount = 0;
        let refundRequestId = '';
        let refundStatusText = '';
        let refundRemarks = '';
        let refundWillBeInitiated = false;

        if (previousStatus !== 'Cancelled' && status === 'Cancelled') {
            let cancelResult = null;
            if (shiprocketAwbCode) {
                cancelResult = await shiprocket.cancelShipmentByAwbs([shiprocketAwbCode]);
            }
            if (!cancelResult?.success && shiprocketOrderId) {
                cancelResult = await shiprocket.cancelOrder([shiprocketOrderId]);
            }
            if ((shiprocketAwbCode || shiprocketOrderId || shiprocketShipmentId) && !cancelResult?.success) {
                return res.status(502).json({
                    success: false,
                    message: 'Failed to cancel order in Shiprocket. Admin cancellation was not applied.'
                });
            }

            const totalAmount = Number(existingOrders[0].total_amount || 0);
            const subtotalAmount = Number(existingOrders[0].subtotal_amount || 0);
            const discountAmount = Number(existingOrders[0].discount_amount || 0);
            const baseAmount = Math.max(subtotalAmount - discountAmount, 0);
            const shippingCharge = Math.max(totalAmount - baseAmount, 0);
            refundAmount = Math.max(totalAmount - shippingCharge, 0);
            const paymentGateway = String(existingOrders[0].payment_gateway || '').trim().toLowerCase();
            const payuPaymentId = String(existingOrders[0].gateway_payment_id || '').trim();
            const orderRef = existingOrders[0].invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`;

            if (paymentGateway === 'payu' && payuPaymentId && refundAmount > 0) {
                const refundPayload = await initiatePayuRefund({
                    payuId: payuPaymentId,
                    amount: refundAmount
                });

                if (!refundPayload.ok) {
                    return res.status(502).json({
                        success: false,
                        message: refundPayload.statusText || 'Failed to initiate refund with PayU'
                    });
                }

                refundWillBeInitiated = true;
                refundRequestId = String(refundPayload.requestId || '').trim();
                refundStatusText = refundPayload.normalizedStatus || 'Refund Initiated';
                refundRemarks = JSON.stringify({
                    payu: refundPayload.raw || null,
                    merchantToken: refundPayload.merchantToken || null,
                    reason: 'admin_cancelled_order'
                });
            }

            query += ', shiprocket_status = ?, shiprocket_tracking_status = ?, shiprocket_latest_activity = ?, shiprocket_latest_activity_at = NOW(), cancellation_request_status = ?, cancellation_reviewed_at = NOW()';
            params.push(
                shiprocketAwbCode ? 'Cancellation Requested' : 'Cancelled',
                shiprocketAwbCode ? 'Cancellation Requested' : 'Cancelled',
                shiprocketAwbCode ? 'Cancellation requested from admin' : 'Order cancelled from admin',
                cancellationRequestStatus === 'Requested' ? 'Approved' : cancellationRequestStatus
            );

            query += ' WHERE order_id = ?';
            params.push(order_id);

            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();
                let result;
                [result] = await conn.execute(query, params);

                if (result.affectedRows === 0) {
                    throw new Error('Order not found');
                }

                if (previousStatus !== 'Cancelled') {
                    const [orderItems] = await conn.execute(
                        'SELECT product_id, size, quantity FROM order_items WHERE order_id = ?',
                        [order_id]
                    );
                    await restockInventoryForItems(conn, orderItems);
                }

                if (refundWillBeInitiated) {
                    await conn.execute(
                        `INSERT INTO refund_transactions
                         (order_id, amount, mode, status, gateway_reference, remarks, initiated_at, completed_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            order_id,
                            refundAmount,
                            'Original Payment',
                            refundStatusText || 'Refund Initiated',
                            refundRequestId || null,
                            refundRemarks || null,
                            new Date(),
                            refundStatusText === 'Refund Completed' ? new Date() : null
                        ]
                    );
                }

                await conn.commit();
            } catch (txErr) {
                await conn.rollback();
                if (String(txErr.message || '') !== 'Order not found') {
                    throw txErr;
                }
                return res.status(404).json({ success: false, message: 'Order not found' });
            } finally {
                conn.release();
            }
        } else {
            query += ' WHERE order_id = ?';
            params.push(order_id);

            const conn = await db.getConnection();
            let result;
            try {
                await conn.beginTransaction();
                [result] = await conn.execute(query, params);
                await conn.commit();
            } catch (txErr) {
                await conn.rollback();
                throw txErr;
            } finally {
                conn.release();
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }
        }

        // Audit: order status change
        logAudit(req, { action: 'STATUS_CHANGE', entityType: 'order', entityId: order_id, newValues: { status, delivery_date }, description: `Order #${order_id} status changed to ${status}` });

        if (status === 'Cancelled') {
            try {
                const [[userRow]] = await db.execute(
                    `SELECT COALESCE(NULLIF(name, ''), 'Customer') AS name, email, mobile_number
                     FROM users
                     WHERE id = ?
                     LIMIT 1`,
                    [existingOrders[0].user_id]
                );
                const [[orderRefRow]] = await db.execute(
                    'SELECT invoice_number FROM orders WHERE order_id = ? LIMIT 1',
                    [order_id]
                );
                const orderRef = orderRefRow?.invoice_number || `NATDEV${String(order_id).padStart(3, '0')}`;
                const totalAmount = Number(existingOrders[0].total_amount || 0);
                const subtotalAmount = Number(existingOrders[0].subtotal_amount || 0);
                const discountAmount = Number(existingOrders[0].discount_amount || 0);
                const refundAmount = Math.max(totalAmount - Math.max(totalAmount - Math.max(subtotalAmount - discountAmount, 0), 0), 0);

                await sendTransactionalSms({
                    mobile: userRow?.mobile_number || '',
                    purpose: 'cancellation',
                    message: refundWillBeInitiated
                        ? `Your DEVASTHRA order ${orderRef} has been cancelled. A refund of Rs. ${Number(refundAmount).toFixed(2)} has been initiated and should reflect within 2-3 business days.`
                        : `Your DEVASTHRA order ${orderRef} has been cancelled.`
                });

                if (refundWillBeInitiated) {
                    sendRefundStatusNotification({
                        to: userRow?.email || '',
                        customerName: userRow?.name || 'Customer',
                        orderReference: orderRef,
                        refundAmount,
                        refundMethod: 'Original Payment',
                        refundStatus: 'Refund Initiated'
                    }).catch((mailErr) => {
                        console.error(`Refund status email failed for Order #${order_id}:`, mailErr.message);
                    });
                }
            } catch (smsErr) {
                console.error(`Admin cancellation SMS failed for Order #${order_id}:`, smsErr.message);
            }
        }

        res.json({ success: true, message: `Order #${order_id} updated to ${status}` });
    } catch (err) {
        console.error('admin update status error:', err);
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
});

router.post('/orders/:id/cancel-request/reject', adminAuth, async (req, res) => {
    const orderId = Number(req.params.id);

    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Valid order id required' });
    }

    try {
        await ensureAdminOrderColumns();
        const [result] = await db.execute(
            `UPDATE orders
             SET cancellation_request_status = 'Rejected',
                 cancellation_reviewed_at = NOW()
             WHERE order_id = ?
               AND status != 'Cancelled'
               AND cancellation_request_status = 'Requested'`,
            [orderId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'No pending cancellation request found' });
        }

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'order',
            entityId: orderId,
            newValues: { cancellation_request_status: 'Rejected' },
            description: `Cancellation request rejected for order #${orderId}`
        });

        res.json({ success: true, message: `Cancellation request rejected for order #${orderId}` });
    } catch (err) {
        console.error('POST /admin/orders/:id/cancel-request/reject error:', err);
        res.status(500).json({ success: false, message: 'Failed to reject cancellation request' });
    }
});

router.post('/exchange-requests/:id/approve', adminAuth, async (req, res) => {
    const exchangeRequestId = Number(req.params.id);

    if (!exchangeRequestId) {
        return res.status(400).json({ success: false, message: 'Valid exchange request id required' });
    }

    try {
        await ensureAdminOrderColumns();
        const [rows] = await db.execute(
            `SELECT
                er.*,
                o.order_id,
                o.created_at AS order_created_at,
                o.payment_method,
                o.shiprocket_order_id,
                oi.product_id,
                oi.quantity,
                oi.size,
                oi.price,
                p.name AS catalog_product_name,
                p.sku,
                p.image_url,
                p.brand,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.address_line, u.address_line) AS address_line,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode,
                u.email
             FROM exchange_requests er
             JOIN orders o ON o.order_id = er.order_id
             JOIN order_items oi ON oi.order_item_id = er.order_item_id
             JOIN products p ON p.id = oi.product_id
             JOIN users u ON u.id = er.user_id
             LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
             WHERE er.id = ? AND er.status = 'Requested'`,
            [exchangeRequestId]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Exchange request not found or already processed' });
        }

        const exchangeRequest = rows[0];
        const shiprocketExchange = await shiprocket.createExchangeOrder({
            exchangeRequestId,
            orderId: exchangeRequest.order_id,
            orderDate: exchangeRequest.order_created_at || new Date(),
            existingOrderId: exchangeRequest.shiprocket_order_id || exchangeRequest.order_id,
            customer: {
                name: exchangeRequest.customer_name,
                email: exchangeRequest.email || '',
                phone: exchangeRequest.customer_mobile || '',
                address_line: exchangeRequest.address_line || '',
                city: exchangeRequest.city || '',
                state: exchangeRequest.state || '',
                pincode: exchangeRequest.pincode || ''
            },
            item: {
                order_item_id: exchangeRequest.order_item_id,
                product_id: exchangeRequest.product_id,
                name: exchangeRequest.product_name || exchangeRequest.catalog_product_name || 'Product',
                sku: exchangeRequest.sku || '',
                image_url: exchangeRequest.image_url || '',
                brand: exchangeRequest.brand || '',
                size: exchangeRequest.size || '',
                quantity: exchangeRequest.quantity || 1,
                price: exchangeRequest.price || 0
            },
            requestedSize: exchangeRequest.requested_size || exchangeRequest.size || '',
            reasonDetail: exchangeRequest.reason_detail || exchangeRequest.reason || '',
            subTotal: Number(exchangeRequest.price || 0) * Number(exchangeRequest.quantity || 1),
            paymentMethod: exchangeRequest.payment_method || 'Prepaid'
        });

        if (!shiprocketExchange) {
            return res.status(502).json({
                success: false,
                message: 'Failed to create exchange order in Shiprocket. Please verify channel and seller location ids.'
            });
        }

        const [result] = await db.execute(
            `UPDATE exchange_requests
             SET status = 'Exchange Approved',
                 admin_remarks = COALESCE(admin_remarks, 'Approved by admin'),
                 shiprocket_exchange_order_id = ?,
                 updated_at = NOW()
             WHERE id = ? AND status = 'Requested'`,
            [
                shiprocketExchange.shiprocket_exchange_order_id || null,
                exchangeRequestId
            ]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Exchange request not found or already processed' });
        }

        logAudit(req, {
            action: 'STATUS_CHANGE',
            entityType: 'exchange_request',
            entityId: exchangeRequestId,
            newValues: {
                status: 'Exchange Approved',
                shiprocket_exchange_order_id: shiprocketExchange.shiprocket_exchange_order_id || ''
            },
            description: `Exchange request #${exchangeRequestId} approved and Shiprocket exchange order created`
        });

        res.json({
            success: true,
            message: `Exchange request #${exchangeRequestId} approved`,
            shiprocket_exchange: shiprocketExchange
        });
    } catch (err) {
        console.error('Approve exchange request error:', err);
        res.status(500).json({ success: false, message: 'Failed to approve exchange request' });
    }
});

router.post('/exchange-requests/:id/reject', adminAuth, async (req, res) => {
    const exchangeRequestId = Number(req.params.id);

    if (!exchangeRequestId) {
        return res.status(400).json({ success: false, message: 'Valid exchange request id required' });
    }

    try {
        await ensureAdminOrderColumns();
        const [result] = await db.execute(
            `UPDATE exchange_requests
             SET status = 'Rejected',
                 admin_remarks = COALESCE(admin_remarks, 'Rejected by admin'),
                 updated_at = NOW()
             WHERE id = ? AND status = 'Requested'`,
            [exchangeRequestId]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Exchange request not found or already processed' });
        }

        logAudit(req, {
            action: 'STATUS_CHANGE',
            entityType: 'exchange_request',
            entityId: exchangeRequestId,
            newValues: { status: 'Rejected' },
            description: `Exchange request #${exchangeRequestId} rejected`
        });

        res.json({ success: true, message: `Exchange request #${exchangeRequestId} rejected` });
    } catch (err) {
        console.error('Reject exchange request error:', err);
        res.status(500).json({ success: false, message: 'Failed to reject exchange request' });
    }
});

// =========================================
// PRODUCTS CRUD
// =========================================

// GET /admin/products — All products (with search/filter)
router.get('/products', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        await ensureInventorySchema();
        const { search, category, status, sort } = req.query;
        let query = 'SELECT * FROM products WHERE 1=1';
        let params = [];

        if (search) {
            query += ' AND (name LIKE ? OR sku LIKE ? OR brand LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        if (status) {
            query += ' AND listing_status = ?';
            params.push(status);
        }

        // Sort
        if (sort === 'price_asc') query += ' ORDER BY price ASC';
        else if (sort === 'price_desc') query += ' ORDER BY price DESC';
        else if (sort === 'stock_low') query += ' ORDER BY stock ASC';
        else if (sort === 'newest') query += ' ORDER BY created_at DESC';
        else query += ' ORDER BY id DESC';

        const [rows] = await db.execute(query, params);

        const [mainProducts] = await db.execute(
            'SELECT id, name FROM products WHERE is_main_product = 1 ORDER BY display_order ASC, created_at DESC'
        );

        const products = await Promise.all(rows.map(async p => enrichProductInventory({
            ...p,
            catalog_images: parseJsonArray(p.catalog_images),
            highlights: parseJsonArray(p.highlights),
            sizes: parseSizeArray(p.sizes)
        })));

        res.json({ success: true, products, total: products.length, mainProducts });
    } catch (err) {
        console.error('GET /admin/products error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

router.get('/products/taxonomy', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        const structuredTaxonomy = await fetchCatalogTaxonomy(db, { includeInactive: true });
        const taxonomy = flattenCatalogTaxonomy(structuredTaxonomy);
        res.json({ success: true, taxonomy, structuredTaxonomy });
    } catch (err) {
        console.error('GET /admin/products/taxonomy error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch catalog taxonomy' });
    }
});

router.get('/banners', adminAuth, async (req, res) => {
    try {
        await ensureAdminBannerColumns();
        const allowedBannerSlots = new Set(['hero_slide_1', 'hero_slide_2', 'hero_slide_3', 'offer_strip', 'festive_drop', 'corner_popup_left', 'corner_popup_right']);
        const banners = (await getBanners(db, { includeInactive: true }))
            .filter((banner) => allowedBannerSlots.has(banner.slot_key));
        res.json({ success: true, banners });
    } catch (err) {
        console.error('GET /admin/banners error:', err);
        res.status(500).json({ success: false, message: 'Failed to load banners' });
    }
});

router.post('/banners', adminAuth, async (req, res) => {
    try {
        await ensureAdminBannerColumns();
        const {
            slot_key,
            title,
            kicker,
            subtitle,
            description,
            button_text,
            button_link,
            secondary_button_text,
            secondary_button_link,
            image_url,
            image_file_id,
            mobile_image_url,
            mobile_image_file_id,
            countdown_target,
            show_countdown,
            is_active,
            display_order
        } = req.body;

        if (!slot_key || !title) {
            return res.status(400).json({ success: false, message: 'Slot and title are required' });
        }
        if (!['hero_slide_1', 'hero_slide_2', 'hero_slide_3', 'offer_strip', 'festive_drop', 'corner_popup_left', 'corner_popup_right'].includes(slot_key)) {
            return res.status(400).json({ success: false, message: 'This banner slot is no longer supported' });
        }

        const [[existingBanner]] = await db.execute(
            'SELECT id, image_file_id, mobile_image_file_id, image_url, mobile_image_url FROM site_banners WHERE slot_key = ? LIMIT 1',
            [slot_key]
        );

        const nextImageUrl = image_url || null;
        const nextImageFileId = image_file_id || null;
        const nextMobileImageUrl = mobile_image_url || null;
        const nextMobileImageFileId = mobile_image_file_id || null;

        if (existingBanner?.image_file_id &&
            existingBanner.image_file_id !== nextImageFileId &&
            (!nextImageUrl || existingBanner.image_url !== nextImageUrl)) {
            await deleteImageKitFileSilently(existingBanner.image_file_id);
        }

        if (existingBanner?.mobile_image_file_id &&
            existingBanner.mobile_image_file_id !== nextMobileImageFileId &&
            (!nextMobileImageUrl || existingBanner.mobile_image_url !== nextMobileImageUrl)) {
            await deleteImageKitFileSilently(existingBanner.mobile_image_file_id);
        }

        await db.execute(
            `INSERT INTO site_banners
                (slot_key, title, kicker, subtitle, description, button_text, button_link, secondary_button_text, secondary_button_link, image_url, image_file_id, mobile_image_url, mobile_image_file_id, countdown_target, show_countdown, is_active, display_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                kicker = VALUES(kicker),
                subtitle = VALUES(subtitle),
                description = VALUES(description),
                button_text = VALUES(button_text),
                button_link = VALUES(button_link),
                secondary_button_text = VALUES(secondary_button_text),
                secondary_button_link = VALUES(secondary_button_link),
                image_url = VALUES(image_url),
                image_file_id = VALUES(image_file_id),
                mobile_image_url = VALUES(mobile_image_url),
                mobile_image_file_id = VALUES(mobile_image_file_id),
                countdown_target = VALUES(countdown_target),
                show_countdown = VALUES(show_countdown),
                is_active = VALUES(is_active),
                display_order = VALUES(display_order)`,
            [
                slot_key,
                title,
                kicker || null,
                subtitle || null,
                description || null,
                button_text || null,
                button_link || null,
                secondary_button_text || null,
                secondary_button_link || null,
                nextImageUrl,
                nextImageFileId,
                nextMobileImageUrl,
                nextMobileImageFileId,
                countdown_target || null,
                Boolean(show_countdown),
                typeof is_active === 'boolean' ? is_active : true,
                Number(display_order || 0)
            ]
        );

        logAudit(req, {
            action: 'UPSERT',
            entityType: 'site_banner',
            description: `Banner saved for slot ${slot_key}`,
            newValues: req.body
        });

        res.json({ success: true, message: 'Banner saved successfully' });
    } catch (err) {
        console.error('POST /admin/banners error:', err);
        res.status(500).json({ success: false, message: 'Failed to save banner' });
    }
});

router.put('/banners/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminBannerColumns();
        const id = Number(req.params.id);
        const [[existingBanner]] = await db.execute(
            'SELECT id, image_file_id, mobile_image_file_id, image_url, mobile_image_url FROM site_banners WHERE id = ? LIMIT 1',
            [id]
        );
        const fields = [
            'slot_key', 'title', 'kicker', 'subtitle', 'description', 'button_text', 'button_link',
            'secondary_button_text', 'secondary_button_link', 'image_url', 'image_file_id',
            'mobile_image_url', 'mobile_image_file_id', 'countdown_target', 'show_countdown', 'is_active', 'display_order'
        ];
        const updates = [];
        const params = [];

        fields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates.push(`${field} = ?`);
                if (field === 'is_active' || field === 'show_countdown') params.push(Boolean(req.body[field]));
                else if (field === 'display_order') params.push(Number(req.body[field] || 0));
                else params.push(req.body[field] || null);
            }
        });

        if (!updates.length) {
            return res.status(400).json({ success: false, message: 'No banner fields provided' });
        }
        if (Object.prototype.hasOwnProperty.call(req.body, 'slot_key') &&
            !['hero_slide_1', 'hero_slide_2', 'hero_slide_3', 'offer_strip', 'festive_drop', 'corner_popup_left', 'corner_popup_right'].includes(req.body.slot_key)) {
            return res.status(400).json({ success: false, message: 'This banner slot is no longer supported' });
        }

        if (existingBanner) {
            const nextImageUrl = Object.prototype.hasOwnProperty.call(req.body, 'image_url') ? (req.body.image_url || null) : existingBanner.image_url;
            const nextImageFileId = Object.prototype.hasOwnProperty.call(req.body, 'image_file_id') ? (req.body.image_file_id || null) : existingBanner.image_file_id;
            const nextMobileImageUrl = Object.prototype.hasOwnProperty.call(req.body, 'mobile_image_url') ? (req.body.mobile_image_url || null) : existingBanner.mobile_image_url;
            const nextMobileImageFileId = Object.prototype.hasOwnProperty.call(req.body, 'mobile_image_file_id') ? (req.body.mobile_image_file_id || null) : existingBanner.mobile_image_file_id;

            if (existingBanner.image_file_id &&
                existingBanner.image_file_id !== nextImageFileId &&
                (!nextImageUrl || existingBanner.image_url !== nextImageUrl)) {
                await deleteImageKitFileSilently(existingBanner.image_file_id);
            }

            if (existingBanner.mobile_image_file_id &&
                existingBanner.mobile_image_file_id !== nextMobileImageFileId &&
                (!nextMobileImageUrl || existingBanner.mobile_image_url !== nextMobileImageUrl)) {
                await deleteImageKitFileSilently(existingBanner.mobile_image_file_id);
            }
        }

        params.push(id);
        await db.execute(`UPDATE site_banners SET ${updates.join(', ')} WHERE id = ?`, params);

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'site_banner',
            entityId: id,
            description: `Banner updated #${id}`,
            newValues: req.body
        });

        res.json({ success: true, message: 'Banner updated successfully' });
    } catch (err) {
        console.error('PUT /admin/banners/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to update banner' });
    }
});

router.delete('/banners/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminBannerColumns();
        await db.execute('DELETE FROM site_banners WHERE id = ?', [Number(req.params.id)]);
        logAudit(req, {
            action: 'DELETE',
            entityType: 'site_banner',
            entityId: Number(req.params.id),
            description: `Banner deleted #${req.params.id}`
        });
        res.json({ success: true, message: 'Banner deleted successfully' });
    } catch (err) {
        console.error('DELETE /admin/banners/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete banner' });
    }
});

router.post('/catalog/taxonomy', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        const { audience, fashion_group, category, subcategory, available_colors, size_guide_json } = req.body;
        const path = await ensureCatalogPath(db, {
            audience,
            fashionGroup: fashion_group,
            category,
            subcategory,
            availableColors: available_colors,
            sizeGuideJson: size_guide_json
        });

        logAudit(req, {
            action: 'CREATE',
            entityType: 'catalog_taxonomy',
            description: `Catalog taxonomy saved: ${path.audience.name} > ${path.fashionGroup.name} > ${path.category.name}${path.subcategory ? ` > ${path.subcategory.name}` : ''}`,
            newValues: path
        });

        res.json({ success: true, message: 'Catalog taxonomy saved successfully', path });
    } catch (err) {
        console.error('POST /admin/catalog/taxonomy error:', err);
        res.status(400).json({ success: false, message: err.message || 'Failed to save catalog taxonomy' });
    }
});

router.put('/catalog/taxonomy/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        const updated = await updateCatalogNode(db, {
            id: Number(req.params.id),
            name: req.body.name,
            availableColors: req.body.available_colors,
            sizeGuideJson: req.body.size_guide_json,
            isActive: typeof req.body.is_active === 'boolean' ? req.body.is_active : undefined
        });

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'catalog_taxonomy',
            entityId: updated.id,
            description: `Catalog ${updated.node_type} updated to ${updated.name}`,
            newValues: updated
        });

        res.json({ success: true, message: 'Catalog item updated successfully', item: updated });
    } catch (err) {
        console.error('PUT /admin/catalog/taxonomy/:id error:', err);
        res.status(400).json({ success: false, message: err.message || 'Failed to update catalog taxonomy' });
    }
});

router.delete('/catalog/taxonomy/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        const result = await deleteCatalogNode(db, Number(req.params.id));

        logAudit(req, {
            action: 'DELETE',
            entityType: 'catalog_taxonomy',
            entityId: Number(req.params.id),
            description: `Catalog taxonomy deleted for node #${req.params.id}`,
            oldValues: result
        });

        res.json({ success: true, message: 'Catalog item deleted successfully' });
    } catch (err) {
        console.error('DELETE /admin/catalog/taxonomy/:id error:', err);
        res.status(400).json({ success: false, message: err.message || 'Failed to delete catalog taxonomy' });
    }
});

// GET /admin/products/:id — Single product
router.get('/products/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminProductColumns();
        await ensureInventorySchema();
        const [rows] = await db.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        const p = rows[0];
        const product = await enrichProductInventory({
            ...p,
            catalog_images: parseJsonArray(p.catalog_images),
            highlights: parseJsonArray(p.highlights),
            sizes: parseSizeArray(p.sizes)
        });
        res.json({ success: true, product });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch product' });
    }
});

// POST /admin/products — Create product with images
router.post('/products', adminAuth, upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'catalog_images', maxCount: 10 }
]), async (req, res) => {
    try {
        await ensureAdminProductColumns();
        await ensureInventorySchema();
        const {
            name, description, sku, fashion_group, category, subcategory, brand,
            color, ideal_for,
            price, original_price, min_order_qty, listing_status,
            highlights, sizes, size_quantities, badge, badge_class, stock,
            parent_product_id, is_main_product, display_order, initial_rating
        } = req.body;

        if (!name || !price) {
            return res.status(400).json({ success: false, message: 'Product name and price are required' });
        }

        const catalogPath = await ensureCatalogPath(db, {
            audience: ideal_for,
            fashionGroup: fashion_group,
            category,
            subcategory
        });
        const parsedColors = parseJsonInput(color, []);

        // Auto-generate SKU if not provided or just a number
        let finalSku = sku;
        if (!sku || sku.trim() === '' || /^\d+$/.test(sku.trim())) {
            // Generate format: DVS-{CATEGORY}-{TIMESTAMP}
            const categoryCode = (catalogPath.category.name || category || 'PROD').substring(0, 3).toUpperCase();
            const timestamp = Date.now().toString().slice(-6);
            finalSku = `DVS-${categoryCode}-${timestamp}`;
        }

        // Upload main image to ImageKit
        let image_url = '';
        let image_file_id = '';
        if (req.files && req.files.main_image && req.files.main_image[0]) {
            const mainFile = req.files.main_image[0];
            const uploaded = await uploadToImageKit(mainFile.buffer, mainFile.originalname);
            image_url = uploaded.url;
            image_file_id = uploaded.fileId;
        }

        // Upload catalog images to ImageKit
        let catalogImagesArr = [];
        if (req.files && req.files.catalog_images) {
            for (const f of req.files.catalog_images) {
                const uploaded = await uploadToImageKit(f.buffer, f.originalname);
                catalogImagesArr.push({ url: uploaded.url, fileId: uploaded.fileId });
            }
        }

        // Parse highlights and sizes (they come as JSON strings from the form)
        const parsedHighlights = sanitizeHighlightList(highlights);
        const parsedSizes = parseJsonInput(sizes, []);
        if (!parsedSizes.length) {
            return res.status(400).json({ success: false, message: 'Please select at least one size for a new product' });
        }
        const parsedSizeQuantities = parseJsonInput(size_quantities, {});
        const sanitizedSizeInventory = sanitizeSizeQuantities(parsedSizeQuantities, parsedSizes);
        const totalStock = sanitizedSizeInventory.length
            ? sanitizedSizeInventory.reduce((sum, item) => sum + item.quantity, 0)
            : (parseInt(stock) || 0);

        const [result] = await db.execute(
            `INSERT INTO products 
                (name, description, sku, parent_product_id, is_main_product, display_order, catalog_audience_id, catalog_fashion_group_id, catalog_category_id, catalog_subcategory_id, fashion_group, category, subcategory, brand, color, ideal_for,
                 price, original_price, min_order_qty, listing_status, image_url, catalog_images, highlights, sizes, badge, badge_class, stock, image_file_id, initial_rating, avg_rating)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
            [
                name, description || null, finalSku,
                parent_product_id ? Number(parent_product_id) : null,
                String(is_main_product) === 'true' || Number(is_main_product) === 1,
                parseInt(display_order) || 0,
                catalogPath.audience.id,
                catalogPath.fashionGroup.id,
                catalogPath.category.id,
                catalogPath.subcategory ? catalogPath.subcategory.id : null,
                catalogPath.fashionGroup.name,
                catalogPath.category.name,
                catalogPath.subcategory ? catalogPath.subcategory.name : null,
                brand || null, JSON.stringify(parsedColors), catalogPath.audience.name,
                parseFloat(price), original_price ? parseFloat(original_price) : null,
                parseInt(min_order_qty) || 1, listing_status || 'Active',
                image_url, JSON.stringify(catalogImagesArr),
                JSON.stringify(parsedHighlights), JSON.stringify(parsedSizes),
                badge || null, badge_class || null, totalStock,
                image_file_id || null,
                initial_rating ? parseFloat(initial_rating) : null,
                initial_rating ? parseFloat(initial_rating) : null
            ]
        );

        if (sanitizedSizeInventory.length) {
            await syncProductSizeInventory(
                result.insertId,
                Object.fromEntries(sanitizedSizeInventory.map(item => [item.size, item.quantity])),
                parsedSizes
            );
        }

        // Audit: product created
        logAudit(req, {
            action: 'CREATE',
            entityType: 'product',
            entityId: result.insertId,
            newValues: {
                name,
                sku: finalSku,
                price,
                audience: catalogPath.audience.name,
                fashion_group: catalogPath.fashionGroup.name,
                category: catalogPath.category.name,
                subcategory: catalogPath.subcategory ? catalogPath.subcategory.name : null,
                stock: totalStock,
                size_inventory: sanitizedSizeInventory,
                parent_product_id: parent_product_id ? Number(parent_product_id) : null,
                is_main_product: String(is_main_product) === 'true' || Number(is_main_product) === 1
            },
            description: `Product '${name}' created (ID: ${result.insertId}, SKU: ${finalSku})`
        });

        res.json({
            success: true,
            message: 'Product created successfully',
            productId: result.insertId,
            sku: finalSku
        });
    } catch (err) {
        console.error('POST /admin/products error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'A product with this SKU already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to create product' });
    }
});

// PUT /admin/products/:id — Update product
router.put('/products/:id', adminAuth, upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'catalog_images', maxCount: 10 }
]), async (req, res) => {
    try {
        await ensureAdminProductColumns();
        await ensureInventorySchema();
        const { id } = req.params;
        const {
            name, description, sku, fashion_group, category, subcategory, brand,
            color, ideal_for,
            price, original_price, min_order_qty, listing_status,
            highlights, sizes, size_quantities, badge, badge_class, stock,
            existing_catalog_images, parent_product_id, is_main_product, display_order,
            remove_main_image, initial_rating
        } = req.body;

        // Check product exists
        const [existing] = await db.execute('SELECT * FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const catalogPath = await ensureCatalogPath(db, {
            audience: ideal_for,
            fashionGroup: fashion_group,
            category,
            subcategory
        });
        const parsedColors = parseJsonInput(color, []);

        // Handle main image — keep old if no new one uploaded
        let image_url = existing[0].image_url;
        let image_file_id = existing[0].image_file_id || null;
        const shouldRemoveMainImage = String(remove_main_image) === 'true' || remove_main_image === true;

        if (shouldRemoveMainImage && !(req.files && req.files.main_image && req.files.main_image[0])) {
            await deleteImageKitFileSilently(image_file_id);
            await db.execute('DELETE FROM product_images WHERE imagekit_id = ? OR imagekit_url = ?', [image_file_id, image_url]);
            image_url = '';
            image_file_id = null;
        }

        if (req.files && req.files.main_image && req.files.main_image[0]) {
            await deleteImageKitFileSilently(image_file_id);
            await db.execute('DELETE FROM product_images WHERE imagekit_id = ? OR imagekit_url = ?', [image_file_id, image_url]);
            const mainFile = req.files.main_image[0];
            const uploaded = await uploadToImageKit(mainFile.buffer, mainFile.originalname);
            image_url = uploaded.url;
            image_file_id = uploaded.fileId;
        }

        // Handle catalog images — keep selected current images + append new ones.
        let persistedCatalogImages = [];
        try { persistedCatalogImages = JSON.parse(existing[0].catalog_images || '[]'); } catch { }

        let catalogImagesArr = [];
        try { catalogImagesArr = JSON.parse(existing_catalog_images || '[]'); } catch { }
        catalogImagesArr = Array.isArray(catalogImagesArr)
            ? catalogImagesArr.map(normalizeImageRecord).filter(image => image && image.url)
            : [];

        const keptCatalogFileIds = new Set(catalogImagesArr.map(image => image.fileId).filter(Boolean));
        const removedCatalogImages = persistedCatalogImages
            .map(normalizeImageRecord)
            .filter(image => image && image.fileId && !keptCatalogFileIds.has(image.fileId));

        for (const image of removedCatalogImages) {
            await deleteImageKitFileSilently(image.fileId);
            await db.execute('DELETE FROM product_images WHERE imagekit_id = ? OR imagekit_url = ?', [image.fileId, image.url]);
        }

        if (req.files && req.files.catalog_images) {
            for (const f of req.files.catalog_images) {
                const uploaded = await uploadToImageKit(f.buffer, f.originalname);
                catalogImagesArr.push({ url: uploaded.url, fileId: uploaded.fileId });
            }
        }

        // Parse highlights and sizes
        const parsedHighlights = sanitizeHighlightList(highlights);
        const parsedSizes = parseJsonInput(sizes, []);
        const parsedSizeQuantities = parseJsonInput(size_quantities, {});
        const sanitizedSizeInventory = sanitizeSizeQuantities(parsedSizeQuantities, parsedSizes);
        const totalStock = sanitizedSizeInventory.length
            ? sanitizedSizeInventory.reduce((sum, item) => sum + item.quantity, 0)
            : (parseInt(stock) || 0);

        // Auto-generate SKU if not provided or just a number
        let finalSku = sku;
        if (!sku || sku.trim() === '' || /^\d+$/.test(sku.trim())) {
            // Keep existing SKU, or generate if doesn't exist
            finalSku = existing[0].sku || `DVS-${(catalogPath.category.name || category || 'PROD').substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;
        }

        // Normalize and prepare rating updates
        const parsedInitialRating = initial_rating ? parseFloat(initial_rating) : null;
        let avgRatingUpdate = '';
        let avgRatingParams = [];

        // We ALWAYS update initial_rating if it's in the request (it could be null to clear it)
        if (req.body.hasOwnProperty('initial_rating')) {
            // Check if we should also update avg_rating (only if no real reviews exist)
            try {
                const [reviewCheck] = await db.execute(
                    `SELECT COUNT(*) as cnt FROM product_reviews WHERE product_id = ? AND status = 'Approved'`, [id]
                );
                
                if (!reviewCheck[0]?.cnt) {
                    // No real reviews: initial_rating sets the avg_rating
                    avgRatingUpdate = ', avg_rating=?, initial_rating=?';
                    avgRatingParams = [parsedInitialRating, parsedInitialRating];
                } else {
                    // Real reviews exist: only update the "starting" baseline, don't overwrite current average
                    avgRatingUpdate = ', initial_rating=?';
                    avgRatingParams = [parsedInitialRating];
                }
            } catch (e) {
                // Fallback in case table doesn't exist yet or other error
                avgRatingUpdate = ', avg_rating=?, initial_rating=?';
                avgRatingParams = [parsedInitialRating, parsedInitialRating];
            }
        }

        await db.execute(
            `UPDATE products SET 
                name=?, description=?, sku=?, parent_product_id=?, is_main_product=?, display_order=?, catalog_audience_id=?, catalog_fashion_group_id=?, catalog_category_id=?, catalog_subcategory_id=?, fashion_group=?, category=?, subcategory=?, brand=?, 
                color=?, ideal_for=?,
                price=?, original_price=?, min_order_qty=?, listing_status=?,
                image_url=?, catalog_images=?, highlights=?, sizes=?,
                badge=?, badge_class=?, stock=?, image_file_id=?${avgRatingUpdate}
             WHERE id=?`,
            [
                name, description || null, finalSku,
                parent_product_id ? Number(parent_product_id) : null,
                String(is_main_product) === 'true' || Number(is_main_product) === 1,
                parseInt(display_order) || 0,
                catalogPath.audience.id,
                catalogPath.fashionGroup.id,
                catalogPath.category.id,
                catalogPath.subcategory ? catalogPath.subcategory.id : null,
                catalogPath.fashionGroup.name,
                catalogPath.category.name,
                catalogPath.subcategory ? catalogPath.subcategory.name : null,
                brand || null, JSON.stringify(parsedColors), catalogPath.audience.name,
                parseFloat(price), original_price ? parseFloat(original_price) : null,
                parseInt(min_order_qty) || 1, listing_status || 'Active',
                image_url, JSON.stringify(catalogImagesArr),
                JSON.stringify(parsedHighlights), JSON.stringify(parsedSizes),
                badge || null, badge_class || null, totalStock,
                image_file_id || null,
                ...avgRatingParams,
                id
            ]
        );

        await syncProductSizeInventory(
            id,
            Object.fromEntries(sanitizedSizeInventory.map(item => [item.size, item.quantity])),
            parsedSizes
        );

        // Audit: product updated
        logAudit(req, {
            action: 'UPDATE',
            entityType: 'product',
            entityId: id,
            oldValues: {
                name: existing[0].name,
                price: existing[0].price,
                stock: existing[0].stock,
                parent_product_id: existing[0].parent_product_id,
                is_main_product: existing[0].is_main_product
            },
            newValues: {
                name,
                price,
                audience: catalogPath.audience.name,
                fashion_group: catalogPath.fashionGroup.name,
                category: catalogPath.category.name,
                subcategory: catalogPath.subcategory ? catalogPath.subcategory.name : null,
                stock: totalStock,
                size_inventory: sanitizedSizeInventory,
                parent_product_id: parent_product_id ? Number(parent_product_id) : null,
                is_main_product: String(is_main_product) === 'true' || Number(is_main_product) === 1
            },
            description: `Product '${name}' (ID: ${id}) updated`
        });

        res.json({ success: true, message: `Product #${id} updated successfully` });
    } catch (err) {
        console.error('PUT /admin/products error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'A product with this SKU already exists' });
        }
        res.status(500).json({ success: false, message: 'Failed to update product' });
    }
});

// DELETE /admin/products/:id — Delete product
router.delete('/products/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Get product to find images to delete
        const [existing] = await db.execute('SELECT * FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const product = existing[0];

        // Delete main image from ImageKit
        if (product.image_file_id) {
            try { await imagekit.deleteFile(product.image_file_id); } catch (e) { console.error('ImageKit delete error:', e.message); }
        }

        // Delete catalog images from ImageKit
        try {
            const catalogImages = JSON.parse(product.catalog_images || '[]');
            for (const img of catalogImages) {
                const fileId = typeof img === 'object' ? img.fileId : null;
                if (fileId) {
                    try { await imagekit.deleteFile(fileId); } catch (e) { console.error('ImageKit delete error:', e.message); }
                }
            }
        } catch { }

        // Delete from database
        await db.execute('DELETE FROM products WHERE id = ?', [id]);

        // Audit: product deleted
        logAudit(req, { action: 'DELETE', entityType: 'product', entityId: id, oldValues: { name: product.name, sku: product.sku, price: product.price }, description: `Product '${product.name}' (ID: ${id}) deleted` });

        res.json({ success: true, message: `Product #${id} deleted successfully` });
    } catch (err) {
        console.error('DELETE /admin/products error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete product' });
    }
});

// GET /admin/customers — List all registered users

// ── Admin Review Management ──
router.get('/reviews', adminAuth, async (req, res) => {
    try {
        const status = req.query.status || '';
        let where = '1=1';
        const params = [];
        if (status) { where += ' AND pr.status = ?'; params.push(status); }

        const [reviews] = await db.execute(
            `SELECT pr.*, u.name AS reviewer_name, u.email AS reviewer_email,
                    p.name AS product_name, p.image_url AS product_image
             FROM product_reviews pr
             LEFT JOIN users u ON pr.user_id = u.id
             LEFT JOIN products p ON pr.product_id = p.id
             WHERE ${where}
             ORDER BY pr.created_at DESC
             LIMIT 200`,
            params
        );
        res.json({ success: true, reviews });
    } catch (err) {
        console.error('GET /admin/reviews error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
});

router.put('/reviews/:id/status', adminAuth, async (req, res) => {
    try {
        const { status, admin_response } = req.body;
        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const [rows] = await db.execute('SELECT id, product_id FROM product_reviews WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Review not found' });

        const updates = ['status = ?'];
        const updateParams = [status];
        if (admin_response !== undefined) {
            updates.push('admin_response = ?');
            updateParams.push(admin_response || null);
        }
        updateParams.push(req.params.id);

        await db.execute(`UPDATE product_reviews SET ${updates.join(', ')} WHERE id = ?`, updateParams);

        // Recalculate product rating
        const productId = rows[0].product_id;
        const [ratingRows] = await db.execute(
            `SELECT COUNT(*) AS cnt, ROUND(AVG(rating), 1) AS avg_rating
             FROM product_reviews WHERE product_id = ? AND status = 'Approved'`, [productId]
        );
        const cnt = Number(ratingRows[0]?.cnt) || 0;
        const avg = ratingRows[0]?.avg_rating || null;
        if (cnt > 0) {
            await db.execute('UPDATE products SET avg_rating = ?, review_count = ? WHERE id = ?', [avg, cnt, productId]);
        } else {
            // Fall back to initial_rating when no approved reviews
            await db.execute(
                'UPDATE products SET avg_rating = initial_rating, review_count = 0 WHERE id = ?', [productId]
            );
        }

        logAudit(req, {
            action: 'UPDATE', entityType: 'review', entityId: req.params.id,
            description: `Review #${req.params.id} status changed to ${status}`
        });

        res.json({ success: true, message: `Review ${status.toLowerCase()} successfully` });
    } catch (err) {
        console.error('PUT /admin/reviews/:id/status error:', err);
        res.status(500).json({ success: false, message: 'Failed to update review' });
    }
});

router.delete('/reviews/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, product_id FROM product_reviews WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Review not found' });

        await db.execute('DELETE FROM product_reviews WHERE id = ?', [req.params.id]);

        // Recalculate product rating
        const productId = rows[0].product_id;
        const [ratingRows] = await db.execute(
            `SELECT COUNT(*) AS cnt, ROUND(AVG(rating), 1) AS avg_rating
             FROM product_reviews WHERE product_id = ? AND status = 'Approved'`, [productId]
        );
        const cnt = Number(ratingRows[0]?.cnt) || 0;
        const avg = ratingRows[0]?.avg_rating || null;
        if (cnt > 0) {
            await db.execute('UPDATE products SET avg_rating = ?, review_count = ? WHERE id = ?', [avg, cnt, productId]);
        } else {
            await db.execute('UPDATE products SET avg_rating = initial_rating, review_count = 0 WHERE id = ?', [productId]);
        }

        logAudit(req, {
            action: 'DELETE', entityType: 'review', entityId: req.params.id,
            description: `Review #${req.params.id} deleted by admin`
        });

        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (err) {
        console.error('DELETE /admin/reviews/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete review' });
    }
});
router.get('/customers', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.mobile_number,
                u.gender,
                u.dob,
                u.address_line,
                u.city,
                u.state,
                u.pincode,
                u.created_at,
                COUNT(DISTINCT o.order_id) AS total_orders,
                COALESCE(SUM(CASE WHEN o.status = 'Paid' THEN o.total_amount ELSE 0 END), 0) AS total_paid_value
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY
                u.id, u.name, u.email, u.mobile_number, u.gender, u.dob,
                u.address_line, u.city, u.state, u.pincode, u.created_at
            ORDER BY u.created_at DESC
        `);
        res.json({ success: true, customers: rows });
    } catch (err) {
        console.error('GET /admin/customers error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch customers' });
    }
});

router.get('/settings/legal-policies', adminAuth, async (req, res) => {
    try {
        const settings = await getSystemSettingsMap([
            'privacy_policy_title',
            'privacy_policy_last_updated',
            'privacy_policy_content',
            'privacy_policy_document_url'
        ]);

        res.json({
            success: true,
            privacyPolicy: {
                title: settings.privacy_policy_title || 'Privacy Policy',
                last_updated: settings.privacy_policy_last_updated || '',
                content: normalizePolicyText(settings.privacy_policy_content || ''),
                document_url: settings.privacy_policy_document_url || ''
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies error:', err);
        res.status(500).json({ success: false, message: 'Failed to load legal policy settings' });
    }
});

router.get('/settings/legal-policies/history', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT lpv.id, lpv.policy_type, lpv.title, lpv.last_updated_label, lpv.document_url,
                    lpv.is_current, lpv.created_at, lpv.published_at, a.username AS admin_username
             FROM legal_policy_versions lpv
             LEFT JOIN admins a ON a.id = lpv.created_by_admin_id
             WHERE lpv.policy_type = 'privacy_policy'
             ORDER BY lpv.created_at DESC, lpv.id DESC`
        );

        res.json({ success: true, history: rows });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to load policy history' });
    }
});

router.get('/settings/legal-policies/history/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, policy_type, title, last_updated_label, content, document_url, is_current, created_at, published_at
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'privacy_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Policy version not found' });
        }

        res.json({
            success: true,
            version: {
                ...rows[0],
                content: normalizePolicyText(rows[0].content || '')
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/history/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to load policy version' });
    }
});

router.put('/settings/legal-policies', adminAuth, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim() || 'Privacy Policy';
        const lastUpdated = String(req.body.last_updated || '').trim();
        const content = normalizePolicyText(req.body.content || '');
        const documentUrl = String(req.body.document_url || '').trim();

        if (!content) {
            return res.status(400).json({ success: false, message: 'Privacy policy content is required' });
        }

        await publishPrivacyPolicyVersion({
            adminId: req.admin?.adminId || null,
            title,
            lastUpdated,
            content,
            documentUrl
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Published a new privacy policy version'
        });

        res.json({ success: true, message: 'Privacy policy published successfully' });
    } catch (err) {
        console.error('PUT /admin/settings/legal-policies error:', err);
        res.status(500).json({ success: false, message: 'Failed to save legal policy settings' });
    }
});

router.post('/settings/legal-policies/history/:id/publish', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, title, last_updated_label, content, document_url
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'privacy_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Policy version not found' });
        }

        const version = {
            ...rows[0],
            content: normalizePolicyText(rows[0].content || '')
        };

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE legal_policy_versions
                 SET is_current = FALSE
                 WHERE policy_type = 'privacy_policy'`
            );

            await conn.execute(
                `UPDATE legal_policy_versions
                 SET is_current = TRUE, published_at = NOW()
                 WHERE id = ?`,
                [version.id]
            );

            const entries = [
                ['privacy_policy_title', version.title],
                ['privacy_policy_last_updated', version.last_updated_label || ''],
                ['privacy_policy_content', version.content],
                ['privacy_policy_document_url', version.document_url || '']
            ];

            for (const [key, value] of entries) {
                await conn.execute(
                    `INSERT INTO system_settings (setting_key, setting_value)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                    [key, value]
                );
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: `Republished privacy policy version #${version.id}`
        });

        res.json({ success: true, message: 'Privacy policy version published successfully' });
    } catch (err) {
        console.error('POST /admin/settings/legal-policies/history/:id/publish error:', err);
        res.status(500).json({ success: false, message: 'Failed to publish policy version' });
    }
});

// ── Terms of Service Routes ──
router.get('/settings/legal-policies/terms', adminAuth, async (req, res) => {
    try {
        const settings = await getSystemSettingsMap([
            'terms_of_service_title',
            'terms_of_service_last_updated',
            'terms_of_service_content',
            'terms_of_service_document_url'
        ]);

        res.json({
            success: true,
            termsOfService: {
                title: settings.terms_of_service_title || 'Terms of Service',
                last_updated: settings.terms_of_service_last_updated || '',
                content: normalizePolicyText(settings.terms_of_service_content || ''),
                document_url: settings.terms_of_service_document_url || ''
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/terms error:', err);
        res.status(500).json({ success: false, message: 'Failed to load terms of service settings' });
    }
});

router.get('/settings/legal-policies/terms/history', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT lpv.id, lpv.policy_type, lpv.title, lpv.last_updated_label, lpv.document_url,
                    lpv.is_current, lpv.created_at, lpv.published_at, a.username AS admin_username
             FROM legal_policy_versions lpv
             LEFT JOIN admins a ON a.id = lpv.created_by_admin_id
             WHERE lpv.policy_type = 'terms_of_service'
             ORDER BY lpv.created_at DESC, lpv.id DESC`
        );

        res.json({ success: true, history: rows });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/terms/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to load terms of service history' });
    }
});

router.get('/settings/legal-policies/terms/history/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, policy_type, title, last_updated_label, content, document_url, is_current, created_at, published_at
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'terms_of_service'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Terms of service version not found' });
        }

        res.json({
            success: true,
            version: {
                ...rows[0],
                content: normalizePolicyText(rows[0].content || '')
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/terms/history/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to load terms of service version' });
    }
});

router.put('/settings/legal-policies/terms', adminAuth, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim() || 'Terms of Service';
        const lastUpdated = String(req.body.last_updated || '').trim();
        const content = normalizePolicyText(req.body.content || '');
        const documentUrl = String(req.body.document_url || '').trim();

        if (!content) {
            return res.status(400).json({ success: false, message: 'Terms of service content is required' });
        }

        await publishTermsOfServiceVersion({
            adminId: req.admin?.adminId || null,
            title,
            lastUpdated,
            content,
            documentUrl
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Published a new terms of service version'
        });

        res.json({ success: true, message: 'Terms of service published successfully' });
    } catch (err) {
        console.error('PUT /admin/settings/legal-policies/terms error:', err);
        res.status(500).json({ success: false, message: 'Failed to save terms of service settings' });
    }
});

router.post('/settings/legal-policies/terms/history/:id/publish', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, title, last_updated_label, content, document_url
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'terms_of_service'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Terms of service version not found' });
        }

        const version = {
            ...rows[0],
            content: normalizePolicyText(rows[0].content || '')
        };

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE legal_policy_versions
                 SET is_current = FALSE
                 WHERE policy_type = 'terms_of_service'`
            );

            await conn.execute(
                `UPDATE legal_policy_versions
                 SET is_current = TRUE, published_at = NOW()
                 WHERE id = ?`,
                [version.id]
            );

            const entries = [
                ['terms_of_service_title', version.title],
                ['terms_of_service_last_updated', version.last_updated_label || ''],
                ['terms_of_service_content', version.content],
                ['terms_of_service_document_url', version.document_url || '']
            ];

            for (const [key, value] of entries) {
                await conn.execute(
                    `INSERT INTO system_settings (setting_key, setting_value)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                    [key, value]
                );
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: `Republished terms of service version #${version.id}`
        });

        res.json({ success: true, message: 'Terms of service version published successfully' });
    } catch (err) {
        console.error('POST /admin/settings/legal-policies/terms/history/:id/publish error:', err);
        res.status(500).json({ success: false, message: 'Failed to publish terms of service version' });
    }
});

// â”€â”€ Refund & Replacement Policy Routes â”€â”€
router.get('/settings/legal-policies/refund-replacement', adminAuth, async (req, res) => {
    try {
        const settings = await getSystemSettingsMap(getPolicySettingKeys('refund_replacement_policy'));
        res.json({
            success: true,
            refundReplacementPolicy: mapPolicySettings(settings, 'refund_replacement_policy', 'Refund and Replacement Policy')
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/refund-replacement error:', err);
        res.status(500).json({ success: false, message: 'Failed to load refund and replacement policy settings' });
    }
});

router.get('/settings/legal-policies/refund-replacement/history', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT lpv.id, lpv.policy_type, lpv.title, lpv.last_updated_label, lpv.document_url,
                    lpv.is_current, lpv.created_at, lpv.published_at, a.username AS admin_username
             FROM legal_policy_versions lpv
             LEFT JOIN admins a ON a.id = lpv.created_by_admin_id
             WHERE lpv.policy_type = 'refund_replacement_policy'
             ORDER BY lpv.created_at DESC, lpv.id DESC`
        );
        res.json({ success: true, history: rows });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/refund-replacement/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to load refund and replacement policy history' });
    }
});

router.get('/settings/legal-policies/refund-replacement/history/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, policy_type, title, last_updated_label, content, document_url, is_current, created_at, published_at
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'refund_replacement_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Refund and replacement policy version not found' });
        }

        res.json({
            success: true,
            version: {
                ...rows[0],
                content: normalizePolicyText(rows[0].content || '')
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/refund-replacement/history/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to load refund and replacement policy version' });
    }
});

router.put('/settings/legal-policies/refund-replacement', adminAuth, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim() || 'Refund and Replacement Policy';
        const lastUpdated = String(req.body.last_updated || '').trim();
        const content = normalizePolicyText(req.body.content || '');
        const documentUrl = String(req.body.document_url || '').trim();

        if (!content) {
            return res.status(400).json({ success: false, message: 'Refund and replacement policy content is required' });
        }

        await publishPolicyVersion({
            policyType: 'refund_replacement_policy',
            settingPrefix: 'refund_replacement_policy',
            adminId: req.admin?.adminId || null,
            title,
            lastUpdated,
            content,
            documentUrl
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Published a new refund and replacement policy version'
        });

        res.json({ success: true, message: 'Refund and replacement policy published successfully' });
    } catch (err) {
        console.error('PUT /admin/settings/legal-policies/refund-replacement error:', err);
        res.status(500).json({ success: false, message: 'Failed to save refund and replacement policy settings' });
    }
});

router.post('/settings/legal-policies/refund-replacement/history/:id/publish', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, title, last_updated_label, content, document_url
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'refund_replacement_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Refund and replacement policy version not found' });
        }

        const version = {
            ...rows[0],
            content: normalizePolicyText(rows[0].content || '')
        };

        await publishPolicyVersion({
            policyType: 'refund_replacement_policy',
            settingPrefix: 'refund_replacement_policy',
            adminId: req.admin?.adminId || null,
            title: version.title,
            lastUpdated: version.last_updated_label || '',
            content: version.content,
            documentUrl: version.document_url || ''
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: `Republished refund and replacement policy version #${version.id}`
        });

        res.json({ success: true, message: 'Refund and replacement policy version published successfully' });
    } catch (err) {
        console.error('POST /admin/settings/legal-policies/refund-replacement/history/:id/publish error:', err);
        res.status(500).json({ success: false, message: 'Failed to publish refund and replacement policy version' });
    }
});

// â”€â”€ Exchange Policy Routes â”€â”€
router.get('/settings/legal-policies/exchange', adminAuth, async (req, res) => {
    try {
        const settings = await getSystemSettingsMap(getPolicySettingKeys('exchange_policy'));
        res.json({
            success: true,
            exchangePolicy: mapPolicySettings(settings, 'exchange_policy', 'Exchange Policy')
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/exchange error:', err);
        res.status(500).json({ success: false, message: 'Failed to load exchange policy settings' });
    }
});

router.get('/settings/legal-policies/exchange/history', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT lpv.id, lpv.policy_type, lpv.title, lpv.last_updated_label, lpv.document_url,
                    lpv.is_current, lpv.created_at, lpv.published_at, a.username AS admin_username
             FROM legal_policy_versions lpv
             LEFT JOIN admins a ON a.id = lpv.created_by_admin_id
             WHERE lpv.policy_type = 'exchange_policy'
             ORDER BY lpv.created_at DESC, lpv.id DESC`
        );
        res.json({ success: true, history: rows });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/exchange/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to load exchange policy history' });
    }
});

router.get('/settings/legal-policies/exchange/history/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, policy_type, title, last_updated_label, content, document_url, is_current, created_at, published_at
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'exchange_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Exchange policy version not found' });
        }

        res.json({
            success: true,
            version: {
                ...rows[0],
                content: normalizePolicyText(rows[0].content || '')
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/exchange/history/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to load exchange policy version' });
    }
});

router.put('/settings/legal-policies/exchange', adminAuth, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim() || 'Exchange Policy';
        const lastUpdated = String(req.body.last_updated || '').trim();
        const content = normalizePolicyText(req.body.content || '');
        const documentUrl = String(req.body.document_url || '').trim();

        if (!content) {
            return res.status(400).json({ success: false, message: 'Exchange policy content is required' });
        }

        await publishPolicyVersion({
            policyType: 'exchange_policy',
            settingPrefix: 'exchange_policy',
            adminId: req.admin?.adminId || null,
            title,
            lastUpdated,
            content,
            documentUrl
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Published a new exchange policy version'
        });

        res.json({ success: true, message: 'Exchange policy published successfully' });
    } catch (err) {
        console.error('PUT /admin/settings/legal-policies/exchange error:', err);
        res.status(500).json({ success: false, message: 'Failed to save exchange policy settings' });
    }
});

router.post('/settings/legal-policies/exchange/history/:id/publish', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, title, last_updated_label, content, document_url
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'exchange_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Exchange policy version not found' });
        }

        const version = {
            ...rows[0],
            content: normalizePolicyText(rows[0].content || '')
        };

        await publishPolicyVersion({
            policyType: 'exchange_policy',
            settingPrefix: 'exchange_policy',
            adminId: req.admin?.adminId || null,
            title: version.title,
            lastUpdated: version.last_updated_label || '',
            content: version.content,
            documentUrl: version.document_url || ''
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: `Republished exchange policy version #${version.id}`
        });

        res.json({ success: true, message: 'Exchange policy version published successfully' });
    } catch (err) {
        console.error('POST /admin/settings/legal-policies/exchange/history/:id/publish error:', err);
        res.status(500).json({ success: false, message: 'Failed to publish exchange policy version' });
    }
});

// â”€â”€ Shipping Policy Routes â”€â”€
router.get('/settings/legal-policies/shipping', adminAuth, async (req, res) => {
    try {
        const settings = await getSystemSettingsMap(getPolicySettingKeys('shipping_policy'));
        res.json({
            success: true,
            shippingPolicy: mapPolicySettings(settings, 'shipping_policy', 'Shipping Policy')
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/shipping error:', err);
        res.status(500).json({ success: false, message: 'Failed to load shipping policy settings' });
    }
});

router.get('/settings/legal-policies/shipping/history', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT lpv.id, lpv.policy_type, lpv.title, lpv.last_updated_label, lpv.document_url,
                    lpv.is_current, lpv.created_at, lpv.published_at, a.username AS admin_username
             FROM legal_policy_versions lpv
             LEFT JOIN admins a ON a.id = lpv.created_by_admin_id
             WHERE lpv.policy_type = 'shipping_policy'
             ORDER BY lpv.created_at DESC, lpv.id DESC`
        );
        res.json({ success: true, history: rows });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/shipping/history error:', err);
        res.status(500).json({ success: false, message: 'Failed to load shipping policy history' });
    }
});

router.get('/settings/legal-policies/shipping/history/:id', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, policy_type, title, last_updated_label, content, document_url, is_current, created_at, published_at
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'shipping_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Shipping policy version not found' });
        }

        res.json({
            success: true,
            version: {
                ...rows[0],
                content: normalizePolicyText(rows[0].content || '')
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/legal-policies/shipping/history/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to load shipping policy version' });
    }
});

router.put('/settings/legal-policies/shipping', adminAuth, async (req, res) => {
    try {
        const title = String(req.body.title || '').trim() || 'Shipping Policy';
        const lastUpdated = String(req.body.last_updated || '').trim();
        const content = normalizePolicyText(req.body.content || '');
        const documentUrl = String(req.body.document_url || '').trim();

        if (!content) {
            return res.status(400).json({ success: false, message: 'Shipping policy content is required' });
        }

        await publishPolicyVersion({
            policyType: 'shipping_policy',
            settingPrefix: 'shipping_policy',
            adminId: req.admin?.adminId || null,
            title,
            lastUpdated,
            content,
            documentUrl
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Published a new shipping policy version'
        });

        res.json({ success: true, message: 'Shipping policy published successfully' });
    } catch (err) {
        console.error('PUT /admin/settings/legal-policies/shipping error:', err);
        res.status(500).json({ success: false, message: 'Failed to save shipping policy settings' });
    }
});

router.post('/settings/legal-policies/shipping/history/:id/publish', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, title, last_updated_label, content, document_url
             FROM legal_policy_versions
             WHERE id = ? AND policy_type = 'shipping_policy'
             LIMIT 1`,
            [Number(req.params.id)]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Shipping policy version not found' });
        }

        const version = {
            ...rows[0],
            content: normalizePolicyText(rows[0].content || '')
        };

        await publishPolicyVersion({
            policyType: 'shipping_policy',
            settingPrefix: 'shipping_policy',
            adminId: req.admin?.adminId || null,
            title: version.title,
            lastUpdated: version.last_updated_label || '',
            content: version.content,
            documentUrl: version.document_url || ''
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: `Republished shipping policy version #${version.id}`
        });

        res.json({ success: true, message: 'Shipping policy version published successfully' });
    } catch (err) {
        console.error('POST /admin/settings/legal-policies/shipping/history/:id/publish error:', err);
        res.status(500).json({ success: false, message: 'Failed to publish shipping policy version' });
    }
});

router.get('/settings/admin-credentials', adminAuth, async (req, res) => {
    try {
        await ensureAdminMailerColumns();
        const credentials = await getActiveAdminMailerCredentials();
        if (!credentials.supportEmail || !credentials.appPassword) {
            return res.status(500).json({ success: false, message: 'Admin credentials are not configured in the database' });
        }

        setMailerRuntimeConfig({
            supportEmail: credentials.supportEmail,
            user: credentials.supportEmail,
            appPassword: credentials.appPassword
        });

        res.json({
            success: true,
            adminCredentials: {
                support_email: credentials.supportEmail,
                smtp_app_password: credentials.appPassword
            }
        });
    } catch (err) {
        console.error('GET /admin/settings/admin-credentials error:', err);
        res.status(500).json({ success: false, message: 'Failed to load admin credentials settings' });
    }
});

router.put('/settings/admin-credentials', adminAuth, async (req, res) => {
    try {
        await ensureAdminMailerColumns();
        const supportEmail = String(req.body.support_email || '').trim();
        const smtpAppPassword = String(req.body.smtp_app_password || '').trim();

        if (!supportEmail) {
            return res.status(400).json({ success: false, message: 'Support email is required' });
        }
        if (!smtpAppPassword) {
            return res.status(400).json({ success: false, message: 'SMTP app password is required' });
        }

        const [admins] = await db.execute(
            `SELECT id
             FROM admins
             ORDER BY id ASC
             LIMIT 1`
        );
        const targetAdminId = admins[0]?.id || 1;

        await db.execute('UPDATE admins SET is_active = FALSE');
        await db.execute(
            `UPDATE admins
             SET support_email = ?, smtp_app_password = ?, is_active = TRUE
             WHERE id = ?`,
            [supportEmail, smtpAppPassword, targetAdminId]
        );

        setMailerRuntimeConfig({
            supportEmail,
            user: supportEmail,
            appPassword: smtpAppPassword
        });

        await logAudit(req, {
            action: 'UPDATE',
            entityType: 'settings',
            description: 'Updated admin mail credentials'
        });

        res.json({
            success: true,
            message: 'Admin email credentials updated successfully'
        });
    } catch (err) {
        console.error('PUT /admin/settings/admin-credentials error:', err);
        res.status(500).json({ success: false, message: 'Failed to update admin credentials' });
    }
});

router.get('/customers/export', adminAuth, async (req, res) => {
    try {
        const format = String(req.query.format || 'csv').toLowerCase();
        const [rows] = await db.execute(`
            SELECT
                u.id AS customer_id,
                COALESCE(u.name, '') AS name,
                COALESCE(u.email, '') AS email,
                COALESCE(u.mobile_number, '') AS mobile_number,
                COALESCE(u.gender, '') AS gender,
                COALESCE(DATE_FORMAT(u.dob, '%Y-%m-%d'), '') AS dob,
                COALESCE(u.address_line, '') AS address_line,
                COALESCE(u.city, '') AS city,
                COALESCE(u.state, '') AS state,
                COALESCE(u.pincode, '') AS pincode,
                COALESCE(COUNT(DISTINCT o.order_id), 0) AS total_orders,
                COALESCE(SUM(CASE WHEN o.status = 'Paid' THEN o.total_amount ELSE 0 END), 0) AS paid_revenue,
                DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            GROUP BY
                u.id, u.name, u.email, u.mobile_number, u.gender, u.dob,
                u.address_line, u.city, u.state, u.pincode, u.created_at
            ORDER BY u.created_at DESC
        `);

        const headers = ['Customer ID', 'Name', 'Email', 'Mobile', 'Gender', 'DOB', 'Address', 'City', 'State', 'Pincode', 'Total Orders', 'Paid Revenue', 'Joined At'];

        if (format === 'excel' || format === 'xlsx' || format === 'xls') {
            const tableRows = rows.map((row) => `
                <tr>
                    <td>${row.customer_id}</td>
                    <td>${row.name}</td>
                    <td>${row.email}</td>
                    <td>${row.mobile_number}</td>
                    <td>${row.gender}</td>
                    <td>${row.dob}</td>
                    <td>${row.address_line}</td>
                    <td>${row.city}</td>
                    <td>${row.state}</td>
                    <td>${row.pincode}</td>
                    <td>${row.total_orders}</td>
                    <td>${row.paid_revenue}</td>
                    <td>${row.created_at}</td>
                </tr>
            `).join('');

            const workbook = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office"
                      xmlns:x="urn:schemas-microsoft-com:office:excel"
                      xmlns="http://www.w3.org/TR/REC-html40">
                <head><meta charset="utf-8"></head>
                <body>
                    <table border="1">
                        <tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr>
                        ${tableRows}
                    </table>
                </body>
                </html>
            `;

            res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="devasthra-customers.xls"');
            return res.send(workbook);
        }

        const csv = [
            headers.map(csvEscape).join(','),
            ...rows.map((row) => ([
                row.customer_id,
                row.name,
                row.email,
                row.mobile_number,
                row.gender,
                row.dob,
                row.address_line,
                row.city,
                row.state,
                row.pincode,
                row.total_orders,
                row.paid_revenue,
                row.created_at
            ].map(csvEscape).join(',')))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="devasthra-customers.csv"');
        res.send(csv);
    } catch (err) {
        console.error('GET /admin/customers/export error:', err);
        res.status(500).json({ success: false, message: 'Failed to export customers' });
    }
});

router.get('/orders/export', adminAuth, async (req, res) => {
    try {
        const format = String(req.query.format || 'csv').toLowerCase();
        const [rows] = await db.execute(`
            SELECT
                o.order_id,
                COALESCE(o.invoice_number, '') AS invoice_number,
                DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode,
                COALESCE(o.payment_method, '') AS payment_method,
                COALESCE(p.status, '') AS payment_status,
                COALESCE(o.status, '') AS status,
                COALESCE(o.total_amount, 0) AS total_amount,
                COALESCE(o.shiprocket_order_id, '') AS shiprocket_order_id,
                COALESCE(o.shiprocket_shipment_id, '') AS shiprocket_shipment_id,
                COALESCE(o.shiprocket_awb_code, '') AS shiprocket_awb_code,
                COALESCE(o.shiprocket_status, '') AS shiprocket_status,
                COALESCE(o.shiprocket_tracking_status, '') AS shiprocket_tracking_status,
                COALESCE(o.cancellation_request_status, 'None') AS cancellation_request_status,
                COALESCE(rr.status, '') AS return_request_status,
                COALESCE(er.status, '') AS exchange_request_status,
                COALESCE(rf.status, '') AS refund_status,
                COALESCE(rf.gateway_reference, '') AS refund_request_id,
                COALESCE(rf.amount, 0) AS refund_amount
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
            ORDER BY o.created_at DESC
        `);

        const headers = [
            'Order Ref',
            'Created At',
            'Customer Name',
            'Customer Mobile',
            'City',
            'State',
            'Pincode',
            'Payment Method',
            'Payment Status',
            'Order Status',
            'Total Amount',
            'Shiprocket Order ID',
            'Shiprocket Shipment ID',
            'AWB Code',
            'Shiprocket Status',
            'Tracking Status',
            'Cancellation Request',
            'Return Request',
            'Exchange Request',
            'Refund Status',
            'Refund Request ID',
            'Refund Amount'
        ];

        if (format === 'excel' || format === 'xlsx' || format === 'xls') {
            const tableRows = rows.map((row) => `
                <tr>
                    <td>${escapeHtml(row.invoice_number)}</td>
                    <td>${escapeHtml(row.created_at)}</td>
                    <td>${escapeHtml(row.customer_name)}</td>
                    <td>${escapeHtml(row.customer_mobile)}</td>
                    <td>${escapeHtml(row.city)}</td>
                    <td>${escapeHtml(row.state)}</td>
                    <td>${escapeHtml(row.pincode)}</td>
                    <td>${escapeHtml(row.payment_method)}</td>
                    <td>${escapeHtml(row.payment_status)}</td>
                    <td>${escapeHtml(row.status)}</td>
                    <td>${escapeHtml(row.total_amount)}</td>
                    <td>${escapeHtml(row.shiprocket_order_id)}</td>
                    <td>${escapeHtml(row.shiprocket_shipment_id)}</td>
                    <td>${escapeHtml(row.shiprocket_awb_code)}</td>
                    <td>${escapeHtml(row.shiprocket_status)}</td>
                    <td>${escapeHtml(row.shiprocket_tracking_status)}</td>
                    <td>${escapeHtml(row.cancellation_request_status)}</td>
                    <td>${escapeHtml(row.return_request_status)}</td>
                    <td>${escapeHtml(row.exchange_request_status)}</td>
                    <td>${escapeHtml(row.refund_status)}</td>
                    <td>${escapeHtml(row.refund_request_id)}</td>
                    <td>${escapeHtml(row.refund_amount)}</td>
                </tr>
            `).join('');

            const workbook = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office"
                      xmlns:x="urn:schemas-microsoft-com:office:excel"
                      xmlns="http://www.w3.org/TR/REC-html40">
                <head><meta charset="utf-8"></head>
                <body>
                    <table border="1">
                        <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
                        ${tableRows}
                    </table>
                </body>
                </html>
            `;

            res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="devasthra-orders.xls"');
            return res.send(workbook);
        }

        const csv = [
            headers.map(csvEscape).join(','),
            ...rows.map((row) => ([
                row.invoice_number,
                row.created_at,
                row.customer_name,
                row.customer_mobile,
                row.city,
                row.state,
                row.pincode,
                row.payment_method,
                row.payment_status,
                row.status,
                row.total_amount,
                row.shiprocket_order_id,
                row.shiprocket_shipment_id,
                row.shiprocket_awb_code,
                row.shiprocket_status,
                row.shiprocket_tracking_status,
                row.cancellation_request_status,
                row.return_request_status,
                row.exchange_request_status,
                row.refund_status,
                row.refund_request_id,
                row.refund_amount
            ].map(csvEscape).join(',')))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="devasthra-orders.csv"');
        res.send(csv);
    } catch (err) {
        console.error('GET /admin/orders/export error:', err);
        res.status(500).json({ success: false, message: 'Failed to export orders' });
    }
});

// GET /admin/products/categories/list — Get unique categories
router.get('/products/categories/list', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != "" ORDER BY category');
        res.json({ success: true, categories: rows.map(r => r.category) });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
});

// =========================================
// AUDIT LOGS
// =========================================

// GET /admin/audit-logs — View audit trail
router.get('/audit-logs', adminAuth, async (req, res) => {
    try {
        const { entity_type, action, limit } = req.query;
        let query = `
            SELECT al.*, 
                   a.username as admin_name, 
                   u.name as user_name, 
                   u.mobile_number as user_mobile
            FROM audit_logs al
            LEFT JOIN admins a ON al.admin_id = a.id
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1`;
        let params = [];
        if (entity_type) { query += ' AND al.entity_type = ?'; params.push(entity_type); }
        if (action) { query += ' AND al.action = ?'; params.push(action); }
        query += ' ORDER BY al.created_at DESC LIMIT ?';
        params.push(parseInt(limit) || 100);

        const [rows] = await db.query(query, params);

        // Add virtual fields for easy frontend consumption
        const logs = rows.map(l => ({
            ...l,
            actor_name: l.admin_name || l.user_name || l.user_mobile || 'System',
            actor_type: l.admin_id ? 'admin' : (l.user_id ? 'user' : 'system')
        }));

        res.json({ success: true, logs });
    } catch (err) {
        console.error('GET /admin/audit-logs error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
    }
});

// =========================================
// RETURNS MANAGEMENT
// =========================================

// GET /admin/returns — List all return requests
router.get('/returns', adminAuth, async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT rr.*,
                   o.invoice_number,
                   u.name AS customer_name, u.mobile_number AS customer_mobile,
                   oi.size, oi.quantity, oi.price AS item_price,
                   p.image_url,
                   pay.gateway AS payment_gateway,
                   pay.gateway_payment_id,
                   rf.return_request_id AS refund_return_request_id,
                   rf.status AS refund_status,
                   rf.amount AS refund_amount,
                   rf.mode AS refund_mode,
                   rf.gateway_reference AS refund_request_id,
                   rf.remarks AS refund_notes,
                   rf.created_at AS refund_requested_at,
                   rf.completed_at AS refund_completed_at
            FROM return_requests rr
            JOIN orders o ON rr.order_id = o.order_id
            JOIN users u ON rr.user_id = u.id
            JOIN order_items oi ON rr.order_item_id = oi.order_item_id
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN payments pay ON pay.order_id = rr.order_id
            LEFT JOIN (
                SELECT rf1.*
                FROM refund_transactions rf1
                INNER JOIN (
                    SELECT return_request_id, MAX(id) AS max_id
                    FROM refund_transactions
                    GROUP BY return_request_id
                ) rfmax ON rf1.id = rfmax.max_id
            ) rf ON rf.return_request_id = rr.id
            WHERE 1=1`;
        let params = [];

        if (status) {
            query += ' AND rr.status = ?';
            params.push(status);
        }

        query += ' ORDER BY rr.created_at DESC';

        const [returns] = await db.execute(query, params);

        returns.forEach(r => {
            try { r.proof_images = JSON.parse(r.proof_images || '[]'); } catch { r.proof_images = []; }
        });

        const syncedReturns = [];
        for (const row of returns) {
            const shipmentSynced = await syncReturnShipmentForRow(row);
            syncedReturns.push(await syncRefundStatusForReturnRow(shipmentSynced));
        }

        res.json({ success: true, returns: syncedReturns, total: syncedReturns.length });
    } catch (err) {
        console.error('GET /admin/returns error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch returns' });
    }
});

// PUT /admin/returns/:id/status — Update return status
router.put('/returns/:id/status', adminAuth, async (req, res) => {
    const returnId = req.params.id;
    let { status, admin_remarks, refund_method } = req.body;

    const validStatuses = ['Requested', 'Approved', 'Rejected', 'Pickup Scheduled', 'Picked Up', 'Refund Initiated', 'Refund Completed', 'Closed'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Valid status required' });
    }

    try {
        const [existing] = await db.execute('SELECT * FROM return_requests WHERE id = ?', [returnId]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Return request not found' });
        }

        const returnReq = existing[0];
        const oldStatus = returnReq.status;

        let query = 'UPDATE return_requests SET status = ?';
        let params = [status];

        if (admin_remarks) {
            query += ', admin_remarks = ?';
            params.push(admin_remarks);
        }
        if (refund_method) {
            query += ', refund_method = ?';
            params.push(refund_method);
        }

        // ── Auto-trigger Shiprocket on return lifecycle updates ──
        let shiprocketResult = null;
        if (status === 'Approved') {
            // Get order + address + items for Shiprocket
            const [orderRows] = await db.execute(
                `SELECT o.*,
                        COALESCE(oa.name, u.name) AS addr_name,
                        COALESCE(oa.mobile, u.mobile_number) AS mobile,
                        COALESCE(oa.address_line, u.address_line) AS address_line,
                        COALESCE(oa.city, u.city) AS city,
                        COALESCE(oa.state, u.state) AS state,
                        COALESCE(oa.pincode, u.pincode) AS pincode
                 FROM orders o
                 JOIN users u ON u.id = o.user_id
                 LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
                 WHERE o.order_id = ?`,
                [returnReq.order_id]
            );
            const order = orderRows[0];

            if (order) {
                const [returnItems] = await db.execute(
                    `SELECT oi.*, p.name, p.sku FROM order_items oi
                     JOIN products p ON oi.product_id = p.id
                     WHERE oi.order_item_id = ?`,
                    [returnReq.order_item_id]
                );

                if (returnItems.length) {
                    const [userRows] = await db.execute('SELECT email, mobile_number FROM users WHERE id = ?', [returnReq.user_id]);
                    const user = userRows[0] || {};

                    shiprocketResult = await shiprocket.createReturnOrder({
                        orderId: returnReq.order_id,
                        orderDate: order.created_at || new Date(),
                        customerName: order.addr_name || 'Customer',
                        customerEmail: user.email || '',
                        customerPhone: order.mobile || user.mobile_number || '',
                        address: {
                            address_line: order.address_line || '',
                            city: order.city || '',
                            state: order.state || '',
                            pincode: order.pincode || ''
                        },
                        items: returnItems.map(i => ({
                            name: i.name,
                            sku: i.sku || `PROD-${i.product_id}`,
                            product_id: i.product_id,
                            quantity: i.quantity,
                            price: i.price
                        })),
                        totalAmount: returnReq.refund_amount || 0,
                        paymentMethod: order.payment_method || 'Prepaid'
                    });

                    if (!shiprocketResult?.shiprocket_return_order_id || !shiprocketResult?.shiprocket_return_shipment_id) {
                        return res.status(502).json({
                            success: false,
                            message: 'Shiprocket did not return a valid return shipment for this approval'
                        });
                    }

                    let awbResult = null;
                    if (shiprocketResult.shiprocket_return_shipment_id) {
                        awbResult = await shiprocket.assignAwb(shiprocketResult.shiprocket_return_shipment_id, { isReturn: true });
                        if (awbResult?.awb_code) {
                            shiprocketResult.shiprocket_awb_code = awbResult.awb_code || '';
                            shiprocketResult.shiprocket_courier_name = awbResult.courier_name || '';
                            shiprocketResult.shiprocket_status = awbResult.awb_assign_status || awbResult.message || shiprocketResult.status || 'AWB Assigned';
                            shiprocketResult.shiprocket_tracking_status = awbResult.awb_assign_status || awbResult.message || shiprocketResult.status || 'AWB Assigned';
                            shiprocketResult.shiprocket_latest_activity = awbResult.message || 'AWB assigned for return shipment';
                            shiprocketResult.shiprocket_latest_activity_at = new Date().toISOString();
                            shiprocketResult.shiprocket_tracking_json = awbResult.raw || null;
                        }
                    }

                    query += ', shiprocket_return_order_id = ?, shiprocket_return_shipment_id = ?, shiprocket_awb_code = ?, shiprocket_courier_name = ?, shiprocket_status = ?, shiprocket_tracking_status = ?, shiprocket_latest_activity = ?, shiprocket_latest_activity_at = NOW(), shiprocket_tracking_json = ?, shiprocket_pickup_scheduled = 0';
                    params.push(
                        shiprocketResult.shiprocket_return_order_id || '',
                        shiprocketResult.shiprocket_return_shipment_id || '',
                        shiprocketResult.shiprocket_awb_code || '',
                        shiprocketResult.shiprocket_courier_name || '',
                        shiprocketResult.shiprocket_status || 'Approved',
                        shiprocketResult.shiprocket_tracking_status || 'Approved',
                        shiprocketResult.shiprocket_latest_activity || 'Return shipment created',
                        JSON.stringify(shiprocketResult.shiprocket_tracking_json || null)
                    );
                    console.log(`[Return #${returnId}] Shiprocket return order created: ${shiprocketResult.shiprocket_return_order_id}`);
                }
            }
        } else if (status === 'Pickup Scheduled') {
            const returnShipmentId = String(returnReq.shiprocket_return_shipment_id || '').trim();
            if (!returnShipmentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Shiprocket return shipment is missing. Approve the return first so AWB can be generated.'
                });
            }

            const pickupResult = await shiprocket.generatePickup(returnShipmentId);
            if (!pickupResult?.pickup_scheduled) {
                return res.status(502).json({
                    success: false,
                    message: pickupResult?.pickup_error || pickupResult?.pickup_status || 'Shiprocket did not confirm pickup scheduling',
                    shiprocket_error: pickupResult?.pickup_error || pickupResult?.pickup_status || '',
                    shiprocket_status_code: pickupResult?.pickup_status_code ?? null
                });
            }

            query += ', shiprocket_pickup_scheduled = 1, pickup_token_number = ?, pickup_scheduled_at = COALESCE(pickup_scheduled_at, NOW()), shiprocket_status = ?, shiprocket_tracking_status = ?, shiprocket_latest_activity = ?, shiprocket_latest_activity_at = NOW()';
            params.push(
                pickupResult.pickup_token_number || '',
                pickupResult.pickup_status || 'Pickup Scheduled',
                pickupResult.pickup_status || 'Pickup Scheduled',
                pickupResult.pickup_status || 'Pickup generated'
            );
            shiprocketResult = {
                pickup_scheduled: true,
                pickup_token_number: pickupResult.pickup_token_number || '',
                pickup_status: pickupResult.pickup_status || 'Pickup Scheduled'
            };
        } else if (status === 'Picked Up') {
            const liveReturn = await syncReturnShipmentForRow({ ...returnReq, id: returnId });
            const trackingText = String(
                liveReturn.shiprocket_tracking_status ||
                liveReturn.shiprocket_status ||
                liveReturn.shiprocket_latest_activity ||
                ''
            ).toLowerCase();

            if (!trackingText.includes('pick')) {
                return res.status(409).json({
                    success: false,
                    message: 'Shiprocket has not marked this return as picked up yet. Please sync tracking after pickup.'
                });
            }

            query += ', picked_up_at = COALESCE(picked_up_at, NOW()), shiprocket_status = ?, shiprocket_tracking_status = ?, shiprocket_latest_activity = COALESCE(?, shiprocket_latest_activity), shiprocket_latest_activity_at = NOW()';
            params.push(
                liveReturn.shiprocket_status || 'Picked Up',
                liveReturn.shiprocket_tracking_status || 'Picked Up',
                liveReturn.shiprocket_latest_activity || 'Picked up by courier'
            );
        } else if (status === 'Refund Initiated' || status === 'Refund Completed') {
            const liveReturn = await syncReturnShipmentForRow({ ...returnReq, id: returnId });
            const trackingText = String(
                liveReturn.shiprocket_tracking_status ||
                liveReturn.shiprocket_status ||
                liveReturn.shiprocket_latest_activity ||
                ''
            ).toLowerCase();

            if (!trackingText.includes('deliver')) {
                return res.status(409).json({
                    success: false,
                    message: 'Refund can be initiated only after the return reaches the warehouse and is delivered/received there.'
                });
            }
        }

        query += ' WHERE id = ?';
        params.push(returnId);

        if (status === 'Refund Initiated' || status === 'Refund Completed') {
            const [[paymentRow]] = await db.execute(
                `SELECT p.gateway, p.gateway_payment_id, p.gateway_txn_id, p.status AS payment_status, o.payment_method
                 FROM orders o
                 LEFT JOIN payments p ON p.order_id = o.order_id
                 WHERE o.order_id = ?
                 LIMIT 1`,
                [returnReq.order_id]
            );

            const refundAmount = Number(returnReq.refund_amount || 0);
            const refundMode = refund_method || 'Original Payment';
            const payuPaymentId = String(paymentRow?.gateway_payment_id || '').trim();
            const [refundRows] = await db.execute(
                'SELECT * FROM refund_transactions WHERE return_request_id = ? LIMIT 1',
                [returnId]
            );
            const existingRefund = refundRows[0] || null;
            let refundRecord = existingRefund;
            let targetStatus = status;
            let refundPayload = null;
            let payuMessage = '';

            if (refundMode === 'Original Payment' && String(paymentRow?.gateway || '').toLowerCase() === 'payu') {
                if (!payuPaymentId) {
                    return res.status(400).json({ success: false, message: 'PayU payment reference is missing for this order' });
                }

                if (status === 'Refund Initiated') {
                    refundPayload = await initiatePayuRefund({
                        payuId: payuPaymentId,
                        amount: refundAmount
                    });
                    payuMessage = refundPayload.statusText || refundPayload.normalizedStatus || 'Refund request sent to PayU';
                    if (!refundPayload.ok) {
                        return res.status(502).json({
                            success: false,
                            message: payuMessage || 'Failed to initiate refund with PayU'
                        });
                    }
                    const initiationState = classifyRefundStatus(refundPayload.raw, refundPayload.rawText) || refundPayload.normalizedStatus || '';
                    if (initiationState === 'Refund Failed') {
                        return res.status(502).json({
                            success: false,
                            message: payuMessage || 'PayU rejected the refund request'
                        });
                    }

                    const refundRequestId = refundPayload.requestId || null;
                    const refundRemarks = JSON.stringify({
                        payu: refundPayload.raw || null,
                        merchantToken: refundPayload.merchantToken || null
                    });

                    if (refundRecord) {
                        await db.execute(
                            `UPDATE refund_transactions
                             SET status = ?, amount = ?, mode = ?, gateway_reference = COALESCE(?, gateway_reference),
                                 remarks = ?, initiated_at = COALESCE(initiated_at, NOW()), completed_at = NULL,
                                 updated_at = NOW()
                             WHERE id = ?`,
                            [
                                'Refund Initiated',
                                refundAmount,
                                refundMode,
                                refundRequestId,
                                refundRemarks,
                                refundRecord.id
                            ]
                        );
                    } else {
                        const [insertResult] = await db.execute(
                            `INSERT INTO refund_transactions
                             (order_id, return_request_id, amount, mode, status, gateway_reference, remarks, initiated_at, completed_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                            [
                                returnReq.order_id,
                                returnId,
                                refundAmount,
                                refundMode,
                                'Refund Initiated',
                                refundRequestId,
                                refundRemarks,
                                new Date()
                            ]
                        );
                        refundRecord = { id: insertResult.insertId, gateway_reference: refundRequestId };
                    }

                    targetStatus = 'Refund Initiated';
                } else {
                    const requestId = String(existingRefund?.gateway_reference || '').trim();
                    if (requestId) {
                        refundPayload = await checkRefundStatusByRequestId(requestId);
                    } else if (payuPaymentId) {
                        refundPayload = await checkRefundStatusByPayuId(payuPaymentId);
                    } else {
                        return res.status(400).json({
                            success: false,
                            message: 'Refund request ID is missing. Initiate the refund first.'
                        });
                    }

                    payuMessage = refundPayload.statusText || refundPayload.normalizedStatus || 'Checked PayU refund status';
                    const normalized = classifyRefundStatus(refundPayload.raw, refundPayload.rawText) || refundPayload.normalizedStatus || '';

                    if (normalized === 'Refund Completed') {
                        targetStatus = 'Refund Completed';
                    } else if (normalized === 'Refund Failed') {
                        targetStatus = 'Refund Failed';
                    } else {
                        targetStatus = 'Refund Initiated';
                    }

                    await db.execute(
                        `UPDATE refund_transactions
                         SET status = ?, amount = ?, mode = ?, remarks = ?, completed_at = ?,
                             updated_at = NOW()
                         WHERE return_request_id = ?`,
                        [
                            targetStatus,
                            refundAmount,
                            refundMode,
                            JSON.stringify({ payu: refundPayload.raw || null, checked_at: new Date().toISOString() }),
                            targetStatus === 'Refund Completed' ? new Date() : null,
                            returnId
                        ]
                    );
                }
            } else {
                const [refundRowsFallback] = await db.execute(
                    'SELECT id FROM refund_transactions WHERE return_request_id = ? LIMIT 1',
                    [returnId]
                );
                if (refundRowsFallback.length) {
                    await db.execute(
                        `UPDATE refund_transactions
                         SET status = ?, amount = ?, mode = ?, completed_at = ?, updated_at = NOW()
                         WHERE id = ?`,
                        [
                            status,
                            refundAmount,
                            refundMode,
                            status === 'Refund Completed' ? new Date() : null,
                            refundRowsFallback[0].id
                        ]
                    );
                } else {
                    await db.execute(
                        `INSERT INTO refund_transactions
                         (order_id, return_request_id, amount, mode, status, initiated_at, completed_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            returnReq.order_id,
                            returnId,
                            refundAmount,
                            refundMode,
                            status,
                            new Date(),
                            status === 'Refund Completed' ? new Date() : null
                        ]
                    );
                }
            }

            params[0] = targetStatus;
            await db.execute(query, params);

            const [[userRow]] = await db.execute(
                `SELECT COALESCE(NULLIF(name, ''), 'Customer') AS name, email
                 FROM users
                 WHERE id = ?
                 LIMIT 1`,
                [returnReq.user_id]
            );
            const [[orderRefRow]] = await db.execute(
                'SELECT invoice_number FROM orders WHERE order_id = ? LIMIT 1',
                [returnReq.order_id]
            );

            sendRefundStatusNotification({
                to: userRow?.email || '',
                customerName: userRow?.name || 'Customer',
                orderReference: orderRefRow?.invoice_number || `NATDEV${String(returnReq.order_id).padStart(3, '0')}`,
                refundAmount: Number(returnReq.refund_amount || 0),
                refundMethod: refundMode,
                refundStatus: targetStatus
            }).catch((mailErr) => {
                console.error(`Refund status email failed for Return #${returnId}:`, mailErr.message);
            });

            sendTransactionalSms({
                mobile: userRow?.mobile_number || '',
                purpose: 'refund',
                message: `Your DEVASTHRA refund for Order ${orderRefRow?.invoice_number || `NATDEV${String(returnReq.order_id).padStart(3, '0')}`} is now ${targetStatus}. Amount: Rs. ${Number(returnReq.refund_amount || 0).toFixed(2)}.`
            }).catch((smsErr) => {
                console.error(`Refund status SMS failed for Return #${returnId}:`, smsErr.message);
            });

            status = targetStatus;
        } else {
            await db.execute(query, params);
        }

        // Audit
        logAudit(req, {
            action: 'STATUS_CHANGE',
            entityType: 'return',
            entityId: returnId,
            oldValues: { status: oldStatus },
            newValues: { status, admin_remarks },
            description: `Return #${returnId} (Order #${returnReq.order_id}) status: ${oldStatus} → ${status}${shiprocketResult ? ' [Shiprocket return created]' : ''}`
        });

        res.json({
            success: true,
            message: `Return #${returnId} updated to ${status}`,
            shiprocket_return: shiprocketResult || null
        });
    } catch (err) {
        console.error('PUT /admin/returns/:id/status error:', err);
        res.status(500).json({ success: false, message: 'Failed to update return' });
    }
});

// GET /admin/returns/stats — Return statistics
router.get('/returns/stats', adminAuth, async (req, res) => {
    try {
        const [[{ total }]] = await db.execute('SELECT COUNT(*) as total FROM return_requests');
        const [[{ requested }]] = await db.execute("SELECT COUNT(*) as requested FROM return_requests WHERE status = 'Requested'");
        const [[{ approved }]] = await db.execute("SELECT COUNT(*) as approved FROM return_requests WHERE status = 'Approved'");
        const [[{ refunded }]] = await db.execute("SELECT COUNT(*) as refunded FROM return_requests WHERE status = 'Refund Completed'");
        const [[{ totalRefundAmt }]] = await db.execute("SELECT COALESCE(SUM(refund_amount), 0) as totalRefundAmt FROM return_requests WHERE status = 'Refund Completed'");

        res.json({
            success: true,
            stats: { total, requested, approved, refunded, totalRefundAmount: totalRefundAmt }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch return stats' });
    }
});

// =========================================
// EXCHANGE REQUESTS MANAGEMENT
// =========================================

// GET /admin/exchanges — List all exchange requests
router.get('/exchanges', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();
        
        const { status } = req.query;
        let query = `
            SELECT
                er.id,
                er.order_id,
                er.order_item_id,
                er.user_id,
                er.product_id,
                er.product_name,
                er.requested_size,
                er.reason,
                er.reason_detail,
                er.status,
                er.admin_remarks,
                er.shiprocket_exchange_order_id,
                er.replacement_order_id,
                er.created_at,
                er.updated_at,
                o.invoice_number,
                o.total_amount,
                o.status AS order_status,
                oi.quantity,
                oi.size,
                oi.price,
                p.image_url,
                u.name AS customer_name,
                u.mobile_number AS customer_mobile,
                u.email
            FROM exchange_requests er
            JOIN orders o ON er.order_id = o.order_id
            JOIN order_items oi ON er.order_item_id = oi.order_item_id
            JOIN products p ON oi.product_id = p.id
            JOIN users u ON er.user_id = u.id
            WHERE 1=1
        `;
        
        let params = [];
        if (status) {
            query += ' AND er.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY er.created_at DESC LIMIT 500';
        
        const [exchanges] = await db.execute(query, params);
        
        res.json({
            success: true,
            exchanges: exchanges || []
        });
    } catch (err) {
        console.error('GET /admin/exchanges error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch exchange requests' });
    }
});

// =========================================
// PAYMENT HISTORY (NEW)
// =========================================

// GET /admin/payment-history — List all transactions with filtering
router.get('/payment-history', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();

        const status = req.query.status || '';
        const from_date = req.query.from_date || '';
        const to_date = req.query.to_date || '';
        const min_amount = req.query.min_amount ? parseFloat(req.query.min_amount) : 0;
        const max_amount = req.query.max_amount ? parseFloat(req.query.max_amount) : Number.MAX_VALUE;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = 50;
        const offset = (page - 1) * pageSize;

        // Simplified: execute two separate queries
        let countQuery = 'SELECT COUNT(DISTINCT p.id) as total FROM payments p JOIN orders o ON p.order_id = o.order_id JOIN users u ON o.user_id = u.id LEFT JOIN order_addresses oa ON oa.order_id = o.order_id LEFT JOIN (SELECT rf1.* FROM refund_transactions rf1 INNER JOIN (SELECT order_id, MAX(id) AS max_id FROM refund_transactions GROUP BY order_id) rfmax ON rf1.id = rfmax.max_id) rf ON rf.order_id = p.order_id WHERE 1=1';
        let countParams = [];

        if (status) {
            countQuery += ' AND p.status = ?';
            countParams.push(status);
        }
        if (from_date) {
            countQuery += ' AND DATE(p.created_at) >= ?';
            countParams.push(from_date);
        }
        if (to_date) {
            countQuery += ' AND DATE(p.created_at) <= ?';
            countParams.push(to_date);
        }
        if (min_amount > 0) {
            countQuery += ' AND p.amount >= ?';
            countParams.push(min_amount);
        }
        if (max_amount < Number.MAX_VALUE) {
            countQuery += ' AND p.amount <= ?';
            countParams.push(max_amount);
        }

        const [[{ total }]] = await db.execute(countQuery, countParams);

        let dataQuery = 'SELECT p.id, p.order_id, p.gateway, p.gateway_txn_id, p.gateway_payment_id, p.amount, p.status AS payment_status, p.created_at AS transaction_date, o.invoice_number, o.total_amount, o.status AS order_status, o.payment_method, COALESCE(oa.name, u.name) AS customer_name, COALESCE(oa.mobile, u.mobile_number) AS customer_mobile, COALESCE(oa.city, u.city) AS city, COALESCE(oa.state, u.state) AS state, COALESCE(oa.pincode, u.pincode) AS pincode, rf.id AS refund_id, rf.status AS refund_status, rf.amount AS refund_amount, rf.mode AS refund_mode, rf.gateway_reference AS refund_request_id FROM payments p JOIN orders o ON p.order_id = o.order_id JOIN users u ON o.user_id = u.id LEFT JOIN order_addresses oa ON oa.order_id = o.order_id LEFT JOIN (SELECT rf1.* FROM refund_transactions rf1 INNER JOIN (SELECT order_id, MAX(id) AS max_id FROM refund_transactions GROUP BY order_id) rfmax ON rf1.id = rfmax.max_id) rf ON rf.order_id = p.order_id WHERE 1=1';
        let dataParams = [];

        if (status) {
            dataQuery += ' AND p.status = ?';
            dataParams.push(status);
        }
        if (from_date) {
            dataQuery += ' AND DATE(p.created_at) >= ?';
            dataParams.push(from_date);
        }
        if (to_date) {
            dataQuery += ' AND DATE(p.created_at) <= ?';
            dataParams.push(to_date);
        }
        if (min_amount > 0) {
            dataQuery += ' AND p.amount >= ?';
            dataParams.push(min_amount);
        }
        if (max_amount < Number.MAX_VALUE) {
            dataQuery += ' AND p.amount <= ?';
            dataParams.push(max_amount);
        }

        dataQuery += ` ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;

        const [payments] = await db.execute(dataQuery, dataParams);

        res.json({
            success: true,
            payments,
            pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
        });
    } catch (err) {
        console.error('GET /admin/payment-history error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
    }
});

// GET /admin/payments/:id — Get single payment details
router.get('/payments/:id', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();

        const paymentId = Number(req.params.id);

        const [payments] = await db.execute(`
            SELECT
                p.*,
                o.invoice_number,
                o.total_amount,
                o.status AS order_status,
                o.payment_method,
                COALESCE(oa.name, u.name) AS customer_name,
                COALESCE(oa.mobile, u.mobile_number) AS customer_mobile,
                u.email AS customer_email,
                COALESCE(oa.address_line, u.address_line) AS address_line,
                COALESCE(oa.city, u.city) AS city,
                COALESCE(oa.state, u.state) AS state,
                COALESCE(oa.pincode, u.pincode) AS pincode,
                rf.id AS refund_id,
                rf.status AS refund_status,
                rf.amount AS refund_amount,
                rf.mode AS refund_mode,
                rf.gateway_reference AS refund_request_id
            FROM payments p
            JOIN orders o ON p.order_id = o.order_id
            JOIN users u ON o.user_id = u.id
            LEFT JOIN order_addresses oa ON oa.order_id = o.order_id
            LEFT JOIN (
                SELECT rf1.*
                FROM refund_transactions rf1
                INNER JOIN (
                    SELECT order_id, MAX(id) AS max_id
                    FROM refund_transactions
                    GROUP BY order_id
                ) rfmax ON rf1.id = rfmax.max_id
            ) rf ON rf.order_id = p.order_id
            WHERE p.id = ?
        `, [paymentId]);

        if (!payments.length) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const payment = payments[0];

        try {
            payment.gateway_response = JSON.parse(payment.gateway_response || '{}');
        } catch {
            payment.gateway_response = {};
        }

        res.json({ success: true, payment });
    } catch (err) {
        console.error('GET /admin/payments/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch payment details' });
    }
});

// POST /admin/payments/:id/sync-status — Sync payment status with PayU
router.post('/payments/:id/sync-status', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();

        const paymentId = Number(req.params.id);

        const [payments] = await db.execute(`
            SELECT p.*, o.invoice_number
            FROM payments p
            JOIN orders o ON p.order_id = o.order_id
            WHERE p.id = ?
        `, [paymentId]);

        if (!payments.length) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const payment = payments[0];

        if (payment.status === 'Success' || payment.status === 'Failed') {
            return res.json({
                success: true,
                message: `Payment is already in final status (${payment.status}). No sync needed.`,
                payment: { ...payment, last_synced_at: new Date() }
            });
        }

        // Only PayU payments can be synced
        if (String(payment.gateway || '').toLowerCase() !== 'payu') {
            return res.status(400).json({
                success: false,
                message: `Payment gateway '${payment.gateway}' does not support status syncing. Only PayU payments can be synced.`
            });
        }

        const payuPaymentId = String(payment.gateway_payment_id || '').trim();
        if (!payuPaymentId) {
            return res.status(400).json({
                success: false,
                message: 'PayU payment ID is missing. Cannot sync status.'
            });
        }

        // Check status with PayU
        const payuResult = await checkRefundStatusByPayuId(payuPaymentId);
        const normalized = classifyRefundStatus(payuResult.raw, payuResult.rawText) || payuResult.normalizedStatus || '';

        // Map PayU result to payment status
        let newStatus = payment.status;
        if (normalized === 'Success' || normalized.includes('Success')) {
            newStatus = 'Success';
        } else if (normalized === 'Failed' || normalized.includes('Failed')) {
            newStatus = 'Failed';
        } else {
            newStatus = 'Created'; // Still pending
        }

        // Update payment status
        await db.execute(`
            UPDATE payments
            SET status = ?,
                gateway_response = ?
            WHERE id = ?
        `, [
            newStatus,
            JSON.stringify(payuResult.raw || {}),
            paymentId
        ]);

        // If payment became success and order is not paid, update order
        if (newStatus === 'Success' && payment.order_id) {
            const [orderRows] = await db.execute(
                'SELECT status FROM orders WHERE order_id = ? LIMIT 1',
                [payment.order_id]
            );

            if (orderRows[0] && orderRows[0].status === 'Pending') {
                await db.execute(
                    'UPDATE orders SET status = ?, updated_at = NOW() WHERE order_id = ?',
                    ['Paid', payment.order_id]
                );
            }
        }

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'payment',
            entityId: paymentId,
            oldValues: { status: payment.status },
            newValues: { status: newStatus },
            description: `Payment #${paymentId} status synced with PayU: ${payment.status} → ${newStatus}`
        });

        res.json({
            success: true,
            message: `Payment status synced: ${payment.status} → ${newStatus}`,
            payment: {
                ...payment,
                status: newStatus,
                gateway_response: payuResult.raw || {},
                last_synced_at: new Date()
            }
        });
    } catch (err) {
        console.error('POST /admin/payments/:id/sync-status error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync payment status' });
    }
});

// POST /admin/payments/:id/initiate-refund — Directly initiate refund from payment history
router.post('/payments/:id/initiate-refund', adminAuth, async (req, res) => {
    try {
        await ensureAdminOrderColumns();

        const paymentId = Number(req.params.id);
        const { refund_amount, refund_mode, remarks } = req.body;

        const [payments] = await db.execute(`
            SELECT p.*, o.order_id, o.invoice_number, o.total_amount, o.status AS order_status
            FROM payments p
            JOIN orders o ON p.order_id = o.order_id
            WHERE p.id = ?
        `, [paymentId]);

        if (!payments.length) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const payment = payments[0];
        const refundAmt = parseFloat(refund_amount) || payment.amount;

        // Validate refund amount
        if (refundAmt <= 0) {
            return res.status(400).json({ success: false, message: 'Refund amount must be greater than 0' });
        }

        if (refundAmt > payment.amount) {
            return res.status(400).json({
                success: false,
                message: `Refund amount (${refundAmt}) cannot exceed payment amount (${payment.amount})`
            });
        }

        // Check if refund already exists
        const [existingRefunds] = await db.execute(
            'SELECT id, status FROM refund_transactions WHERE order_id = ? LIMIT 1',
            [payment.order_id]
        );

        if (existingRefunds.length && !['Refund Failed'].includes(existingRefunds[0].status)) {
            return res.status(409).json({
                success: false,
                message: `A refund (${existingRefunds[0].status}) already exists for this order. Cannot create duplicate refund.`
            });
        }

        // Only PayU can be refunded via gateway
        const refundModeToUse = refund_mode || 'Original Payment';
        if (refundModeToUse === 'Original Payment') {
            if (String(payment.gateway || '').toLowerCase() !== 'payu') {
                return res.status(400).json({
                    success: false,
                    message: `Payment gateway '${payment.gateway}' does not support automatic refunds. Use 'Manual Transfer' or 'Store Credit' instead.`
                });
            }

            const payuPaymentId = String(payment.gateway_payment_id || '').trim();
            if (!payuPaymentId) {
                return res.status(400).json({
                    success: false,
                    message: 'PayU payment ID is missing. Cannot initiate refund.'
                });
            }

            // Initiate refund with PayU
            const refundPayload = await initiatePayuRefund({
                payuId: payuPaymentId,
                amount: refundAmt
            });

            if (!refundPayload.ok) {
                return res.status(502).json({
                    success: false,
                    message: refundPayload.statusText || 'Failed to initiate refund with PayU'
                });
            }

            const refundStatus = classifyRefundStatus(refundPayload.raw, refundPayload.rawText) || 'Refund Initiated';
            if (refundStatus === 'Refund Failed') {
                return res.status(502).json({
                    success: false,
                    message: 'PayU rejected the refund request'
                });
            }

            // Create refund transaction record
            const refundRequestId = refundPayload.requestId || null;
            const refundRemarks = JSON.stringify({
                payu: refundPayload.raw || null,
                merchantToken: refundPayload.merchantToken || null,
                initiated_by: 'admin_payment_history',
                admin_remarks: remarks || null
            });

            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();

                await conn.execute(`
                    INSERT INTO refund_transactions
                    (order_id, amount, mode, status, gateway_reference, remarks, initiated_at, completed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    payment.order_id,
                    refundAmt,
                    refundModeToUse,
                    refundStatus,
                    refundRequestId,
                    refundRemarks,
                    new Date(),
                    refundStatus === 'Refund Completed' ? new Date() : null
                ]);

                // Notify customer
                const [[userRow]] = await conn.execute(
                    'SELECT name, email, mobile_number FROM users JOIN orders ON users.id = orders.user_id WHERE orders.order_id = ? LIMIT 1',
                    [payment.order_id]
                );

                if (userRow?.email) {
                    sendRefundStatusNotification({
                        to: userRow.email,
                        customerName: userRow.name || 'Customer',
                        orderReference: payment.invoice_number || `NATDEV${String(payment.order_id).padStart(3, '0')}`,
                        refundAmount: refundAmt,
                        refundMethod: refundModeToUse,
                        refundStatus: refundStatus
                    }).catch((mailErr) => {
                        console.error(`Refund notification email failed for Payment #${paymentId}:`, mailErr.message);
                    });
                }

                if (userRow?.mobile_number) {
                    sendTransactionalSms({
                        mobile: userRow.mobile_number,
                        purpose: 'refund',
                        message: `Your DEVASTHRA refund for Order ${payment.invoice_number || `NATDEV${String(payment.order_id).padStart(3, '0')}`} is ${refundStatus}. Amount: Rs. ${refundAmt.toFixed(2)}.`
                    }).catch((smsErr) => {
                        console.error(`Refund notification SMS failed for Payment #${paymentId}:`, smsErr.message);
                    });
                }

                await conn.commit();
            } catch (txErr) {
                await conn.rollback();
                throw txErr;
            } finally {
                conn.release();
            }

            logAudit(req, {
                action: 'CREATE',
                entityType: 'refund_transaction',
                description: `Refund initiated from payment history. Payment #${paymentId}, Order #${payment.order_id}, Amount: Rs. ${refundAmt}`
            });

            return res.json({
                success: true,
                message: `Refund of Rs. ${refundAmt} initiated successfully`,
                refund: {
                    payment_id: paymentId,
                    order_id: payment.order_id,
                    amount: refundAmt,
                    mode: refundModeToUse,
                    status: refundStatus,
                    gateway_reference: refundRequestId,
                    initiated_at: new Date()
                }
            });
        } else {
            // Manual transfer or store credit — just create the record
            const conn = await db.getConnection();
            try {
                await conn.beginTransaction();

                await conn.execute(`
                    INSERT INTO refund_transactions
                    (order_id, amount, mode, status, remarks, initiated_at, completed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    payment.order_id,
                    refundAmt,
                    refundModeToUse,
                    'Refund Initiated',
                    JSON.stringify({
                        initiated_by: 'admin_payment_history',
                        admin_remarks: remarks || null,
                        manual_mode: refundModeToUse
                    }),
                    new Date(),
                    null
                ]);

                // Notify customer
                const [[userRow]] = await conn.execute(
                    'SELECT name, email, mobile_number FROM users JOIN orders ON users.id = orders.user_id WHERE orders.order_id = ? LIMIT 1',
                    [payment.order_id]
                );

                if (userRow?.email) {
                    sendRefundStatusNotification({
                        to: userRow.email,
                        customerName: userRow.name || 'Customer',
                        orderReference: payment.invoice_number || `NATDEV${String(payment.order_id).padStart(3, '0')}`,
                        refundAmount: refundAmt,
                        refundMethod: refundModeToUse,
                        refundStatus: 'Refund Initiated'
                    }).catch((mailErr) => {
                        console.error(`Refund notification email failed for Payment #${paymentId}:`, mailErr.message);
                    });
                }

                await conn.commit();
            } catch (txErr) {
                await conn.rollback();
                throw txErr;
            } finally {
                conn.release();
            }

            logAudit(req, {
                action: 'CREATE',
                entityType: 'refund_transaction',
                description: `${refundModeToUse} refund initiated from payment history. Payment #${paymentId}, Order #${payment.order_id}, Amount: Rs. ${refundAmt}`
            });

            return res.json({
                success: true,
                message: `${refundModeToUse} refund of Rs. ${refundAmt} initiated successfully`,
                refund: {
                    payment_id: paymentId,
                    order_id: payment.order_id,
                    amount: refundAmt,
                    mode: refundModeToUse,
                    status: 'Refund Initiated',
                    initiated_at: new Date()
                }
            });
        }
    } catch (err) {
        console.error('POST /admin/payments/:id/initiate-refund error:', err);
        res.status(500).json({ success: false, message: 'Failed to initiate refund' });
    }
});

// =========================================
// STORE CONFIGURATION
// =========================================

// GET /admin/store-config
router.get('/store-config', adminAuth, async (req, res) => {
    try {
        const config = await getSystemSettingsMap([
            'cod_enabled',
            'min_order_value',
            'cod_min_order_value',
            'shipping_charge',
            'maintenance_enabled',
            'maintenance_message',
            'maintenance_expected_back_at'
        ]);
        res.json({
            success: true,
            cod_enabled: config.cod_enabled !== '0' && config.cod_enabled !== 'false',
            min_order_value: Number(config.min_order_value) || 0,
            cod_min_order_value: Number(config.cod_min_order_value) || 0,
            shipping_charge: Number(config.shipping_charge) || 0,
            maintenance_enabled: config.maintenance_enabled !== '0' && config.maintenance_enabled !== 'false',
            maintenance_message: config.maintenance_message || '',
            maintenance_expected_back_at: config.maintenance_expected_back_at || ''
        });
    } catch (err) {
        console.error('GET /admin/store-config error:', err);
        res.status(500).json({ success: false, message: 'Failed to load store config' });
    }
});

// PUT /admin/store-config
router.put('/store-config', adminAuth, async (req, res) => {
    try {
        const {
            cod_enabled,
            min_order_value,
            cod_min_order_value,
            shipping_charge,
            maintenance_enabled,
            maintenance_message,
            maintenance_expected_back_at
        } = req.body;
        const isMaintenanceEnabled = maintenance_enabled === true || maintenance_enabled === 'true' || maintenance_enabled === 1 || maintenance_enabled === '1';

        if (cod_enabled !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('cod_enabled', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [cod_enabled ? '1' : '0']
            );
        }

        if (min_order_value !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('min_order_value', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [String(Number(min_order_value) || 0)]
            );
        }

        if (cod_min_order_value !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('cod_min_order_value', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [String(Number(cod_min_order_value) || 0)]
            );
        }

        if (shipping_charge !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('shipping_charge', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [String(Number(shipping_charge) || 0)]
            );
        }

        if (maintenance_enabled !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('maintenance_enabled', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [isMaintenanceEnabled ? '1' : '0']
            );
        }

        if (maintenance_message !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('maintenance_message', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [String(maintenance_message || '').trim()]
            );
        }

        if (maintenance_expected_back_at !== undefined) {
            await db.execute(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('maintenance_expected_back_at', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [String(maintenance_expected_back_at || '').trim()]
            );
        }

        logAudit(req, {
            action: 'UPDATE',
            entityType: 'store_config',
            description: `Store config updated: COD=${cod_enabled}, Free Shipping Threshold=${min_order_value}, Shipping Charge=${shipping_charge}, COD Min Order=${cod_min_order_value}, Maintenance=${isMaintenanceEnabled ? 'ON' : 'OFF'}`
        });

        res.json({ success: true, message: 'Store configuration updated' });
    } catch (err) {
        console.error('PUT /admin/store-config error:', err);
        res.status(500).json({ success: false, message: 'Failed to update store config' });
    }
});

module.exports = router;
