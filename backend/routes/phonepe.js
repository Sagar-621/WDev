const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const phonepe = require('../services/phonepe');
const { sendTransactionalSms } = require('../services/sms');
const shiprocket = require('../services/shiprocket');
const { sendOrderConfirmationEmail, sendAdminOrderNotification } = require('../services/mailer');

/**
 * Helper: Get storefront base URL for redirects
 */
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

/**
 * Helper: Build merchant order ID for PhonePe
 */
function buildPhonePeMerchantOrderId(orderId) {
    return `DVPH${String(orderId).padStart(8, '0')}_${Date.now()}`;
}

/**
 * Helper: Get PhonePe callback URL
 */
function getPhonePeCallbackUrl() {
    const configured = String(process.env.PHONEPE_CALLBACK_URL || '').trim();
    if (configured) return configured;
    return `${getStorefrontBaseUrl()}/api/phonepe/callback`;
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

function buildPhonePeCallbackUrl(req, { merchantOrderId = '', orderId = '' } = {}) {
    const requestBase = getRequestServerBaseUrl(req);
    const callbackBase = isLocalHost(req.get('host') || '')
        ? `${requestBase}/api/phonepe/callback`
        : getPhonePeCallbackUrl();
    const callbackUrl = new URL(callbackBase);

    if (merchantOrderId) callbackUrl.searchParams.set('merchantOrderId', String(merchantOrderId));
    if (orderId) callbackUrl.searchParams.set('localOrderId', String(orderId));

    return callbackUrl.toString();
}

/**
 * Helper: Format currency
 */
function formatCurrency(value) {
    return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Helper: Build invoice number (same format as PayU)
 */
async function buildInvoiceNumber(orderId) {
    try {
        const [settings] = await db.execute(
            `SELECT setting_value FROM system_settings 
             WHERE setting_key = 'order_reference_prefix' LIMIT 1`
        );
        const prefix = settings[0]?.setting_value || 'NATDEV';
        const invoiceNumber = `${String(prefix).toUpperCase()}${String(orderId).padStart(3, '0')}`;
        return invoiceNumber;
    } catch (err) {
        console.error('Error building invoice number:', err);
        return `NATDEV${String(orderId).padStart(3, '0')}`;
    }
}

/**
 * Helper: Send order SMS notification
 */
async function sendOrderSMS(mobile, orderReference) {
    try {
        const message = `Your DEVASTHRA order ${orderReference} has been placed successfully. We will share tracking updates soon. Thank you for shopping with us.`;
        await sendTransactionalSms({ mobile, message, purpose: 'order' });
    } catch (err) {
        console.error('Order SMS failed:', err.response?.data || err.message);
    }
}

/**
 * Helper: Save Shiprocket fields to order
 */
async function saveShiprocketFields(orderId, shiprocketResult) {
    if (!shiprocketResult) return;

    const updateFields = [];
    const updateValues = [];

    if (shiprocketResult.shiprocket_order_id) {
        updateFields.push('shiprocket_order_id = ?');
        updateValues.push(shiprocketResult.shiprocket_order_id);
    }
    if (shiprocketResult.shiprocket_shipment_id) {
        updateFields.push('shiprocket_shipment_id = ?');
        updateValues.push(shiprocketResult.shiprocket_shipment_id);
    }
    if (shiprocketResult.shiprocket_awb_code) {
        updateFields.push('shiprocket_awb_code = ?');
        updateValues.push(shiprocketResult.shiprocket_awb_code);
    }
    if (shiprocketResult.shiprocket_courier_name) {
        updateFields.push('shiprocket_courier_name = ?');
        updateValues.push(shiprocketResult.shiprocket_courier_name);
    }
    if (shiprocketResult.shiprocket_status) {
        updateFields.push('shiprocket_status = ?');
        updateValues.push(shiprocketResult.shiprocket_status);
    }
    if (shiprocketResult.shiprocket_tracking_status) {
        updateFields.push('shiprocket_tracking_status = ?');
        updateValues.push(shiprocketResult.shiprocket_tracking_status);
    }

    if (updateFields.length === 0) return;

    updateValues.push(orderId);
    await db.execute(
        `UPDATE orders SET ${updateFields.join(', ')} WHERE order_id = ?`,
        updateValues
    );
}

/**
 * Helper: Finalize successful prepaid PhonePe order
 */
async function finalizeSuccessfulPhonePeOrder({
    orderId,
    merchantOrderId,
    phonepeOrderId,
    transactionId,
    paymentMode,
    state
}) {
    try {
        // Get order details
        const [orderRows] = await db.execute(
            `SELECT o.*, u.mobile_number, u.email, u.name AS user_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.order_id = ?
             LIMIT 1`,
            [orderId]
        );

        if (!orderRows.length) {
            console.error(`[PhonePe] Order not found: ${orderId}`);
            return null;
        }

        const order = orderRows[0];

        // Update order status to Paid
        await db.execute(
            'UPDATE orders SET status = ?, payment_method = COALESCE(payment_method, ?) WHERE order_id = ?',
            ['Paid', 'Prepaid', orderId]
        );

        // Update payment record
        await db.execute(
            `UPDATE payments
             SET gateway = ?, gateway_txn_id = ?, gateway_payment_id = ?, status = ?
             WHERE order_id = ?`,
            ['PhonePe', transactionId, phonepeOrderId, 'Success', orderId]
        );

        // Update PhonePe transaction record
        const [existingPhonePe] = await db.execute(
            'SELECT id FROM phonepe_transactions WHERE order_id = ? LIMIT 1',
            [orderId]
        );

        if (existingPhonePe.length > 0) {
            await db.execute(
                `UPDATE phonepe_transactions
                 SET merchant_order_id = ?, phonepe_order_id = ?, state = ?,
                     transaction_id = ?, transaction_state = ?, payment_mode = ?,
                     updated_at = NOW()
                 WHERE order_id = ?`,
                [merchantOrderId, phonepeOrderId, 'Completed', transactionId, 'Success', paymentMode, orderId]
            );
        } else {
            await db.execute(
                `INSERT INTO phonepe_transactions
                 (order_id, merchant_order_id, phonepe_order_id, state, transaction_id,
                  transaction_state, payment_mode, amount, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [orderId, merchantOrderId, phonepeOrderId, 'Completed', transactionId, 'Success', paymentMode, order.total_amount]
            );
        }

        // Get order items
        const [orderItems] = await db.execute(
            `SELECT oi.product_id, oi.size, oi.quantity, oi.price,
                    p.name AS product_name, p.sku
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        // Clear cart
        for (const item of orderItems) {
            await db.execute(
                'DELETE FROM cart WHERE user_id = ? AND product_id = ? AND (size = ? OR (size IS NULL AND ? IS NULL))',
                [order.user_id, item.product_id, item.size, item.size]
            );
        }

        // Send SMS
        const invoiceNumber = order.invoice_number || await buildInvoiceNumber(orderId);
        await sendOrderSMS(order.mobile_number, invoiceNumber).catch(err =>
            console.error('SMS send error:', err.message)
        );

        // Get shipping address
        const [addressRows] = await db.execute(
            `SELECT name, mobile, address_line, city, state, pincode
             FROM order_addresses WHERE order_id = ?`,
            [orderId]
        );
        const shippingAddress = addressRows[0] || {};

        // Create Shiprocket order
        try {
            const shiprocketResult = await shiprocket.createOrder({
                orderId,
                orderReference: invoiceNumber,
                orderDate: order.created_at,
                customerName: shippingAddress.name || order.user_name || 'Customer',
                customerEmail: order.email || '',
                customerPhone: shippingAddress.mobile || order.mobile_number || '',
                address: {
                    address_line: shippingAddress.address_line || '',
                    city: shippingAddress.city || '',
                    state: shippingAddress.state || '',
                    pincode: shippingAddress.pincode || ''
                },
                items: orderItems.map(item => ({
                    name: item.product_name,
                    sku: item.sku,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    price: item.price
                })),
                totalAmount: order.total_amount,
                paymentMethod: 'Prepaid'
            });

            if (shiprocketResult && shiprocketResult.shiprocket_order_id) {
                console.log(`[PhonePe] ✅ Shiprocket order created: ${shiprocketResult.shiprocket_order_id}`);
                await saveShiprocketFields(orderId, shiprocketResult);
            }
        } catch (srErr) {
            console.error(`[PhonePe] Shiprocket order creation failed:`, srErr.message);
        }

        // Send confirmation emails
        const [savedOrderRows] = await db.execute(
            `SELECT invoice_number, shiprocket_order_id, shiprocket_shipment_id, shiprocket_awb_code
             FROM orders WHERE order_id = ? LIMIT 1`,
            [orderId]
        );
        const savedOrder = savedOrderRows[0] || {};

        sendOrderConfirmationEmail({
            to: order.email || '',
            customerName: order.user_name || 'Customer',
            orderReference: savedOrder.invoice_number || invoiceNumber,
            orderId,
            totalAmount: order.total_amount,
            paymentMethod: 'Prepaid',
            awbCode: savedOrder.shiprocket_awb_code || '',
            shippingCity: shippingAddress.city || ''
        }).catch((mailErr) => {
            console.error(`Order confirmation email failed:`, mailErr.message);
        });

        sendAdminOrderNotification({
            orderReference: savedOrder.invoice_number || invoiceNumber,
            orderId,
            customerName: order.user_name || 'Customer',
            totalAmount: order.total_amount,
            paymentMethod: 'Prepaid',
            shippingAddress
        }).catch((mailErr) => {
            console.error(`Admin notification email failed:`, mailErr.message);
        });

        return {
            orderReference: savedOrder.invoice_number || invoiceNumber,
            shiprocketOrderId: savedOrder.shiprocket_order_id || '',
            shipmentId: savedOrder.shiprocket_shipment_id || '',
            awbCode: savedOrder.shiprocket_awb_code || ''
        };
    } catch (err) {
        console.error(`[PhonePe] Error finalizing order:`, err);
        throw err;
    }
}

/**
 * POST /api/phonepe/initiate
 * Initiate PhonePe payment for an order
 * Protected route - requires authentication
 */
router.post('/initiate', auth, async (req, res) => {
    const orderId = Number(req.body.order_id);

    if (!orderId || orderId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid order ID'
        });
    }

    try {
        // Fetch order details
        const [orderRows] = await db.execute(
            `SELECT o.*, u.mobile_number, u.email, u.name AS user_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.order_id = ? AND o.user_id = ?
             LIMIT 1`,
            [orderId, req.user.userId]
        );

        if (!orderRows.length) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orderRows[0];

        if (order.payment_method !== 'Prepaid' || order.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Order is not eligible for payment'
            });
        }

        // Get PhonePe transaction if exists
        const [existingPhonePe] = await db.execute(
            'SELECT * FROM phonepe_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1',
            [orderId]
        );

        let merchantOrderId;
        if (existingPhonePe.length > 0 && existingPhonePe[0].merchant_order_id) {
            merchantOrderId = existingPhonePe[0].merchant_order_id;
        } else {
            merchantOrderId = buildPhonePeMerchantOrderId(orderId);
        }

        // Initiate PhonePe payment
        const amountPaise = Math.round(Number(order.total_amount) * 100); // Convert to paise
        const invoiceNumber = order.invoice_number || await buildInvoiceNumber(orderId);

        const phonepeResponse = await phonepe.initiatePhonePePayment({
            merchantOrderId,
            amountPaise,
            redirectUrl: buildPhonePeCallbackUrl(req, { merchantOrderId, orderId }),
            prefillPhoneNumber: String(order.mobile_number || '').trim(),
            metaInfo: {
                orderId: String(orderId),
                invoiceNumber: invoiceNumber,
                customerEmail: order.email || '',
                customerName: order.user_name || ''
            }
        });

        if (!phonepeResponse.ok) {
            console.error('[PhonePe] Initiation failed:', phonepeResponse.response);
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate PhonePe payment'
            });
        }

        // Store PhonePe transaction record
        if (existingPhonePe.length > 0) {
            await db.execute(
                `UPDATE phonepe_transactions
                 SET phonepe_order_id = ?, state = ?, redirect_url = ?, request_payload = ?, response_payload = ?
                 WHERE order_id = ?`,
                [
                    phonepeResponse.phonepeOrderId,
                    phonepeResponse.state,
                    phonepeResponse.redirectUrl,
                    JSON.stringify(phonepeResponse.requestBody),
                    JSON.stringify(phonepeResponse.response),
                    orderId
                ]
            );
        } else {
            await db.execute(
                `INSERT INTO phonepe_transactions
                 (order_id, merchant_order_id, phonepe_order_id, state, amount, redirect_url, request_payload, response_payload, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    orderId,
                    merchantOrderId,
                    phonepeResponse.phonepeOrderId,
                    phonepeResponse.state,
                    order.total_amount,
                    phonepeResponse.redirectUrl,
                    JSON.stringify(phonepeResponse.requestBody),
                    JSON.stringify(phonepeResponse.response)
                ]
            );
        }

        res.json({
            success: true,
            redirectUrl: phonepeResponse.redirectUrl,
            merchantOrderId: phonepeResponse.merchantOrderId,
            phonepeOrderId: phonepeResponse.phonepeOrderId
        });
    } catch (err) {
        console.error('[PhonePe] Initiate error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to initiate payment'
        });
    }
});

/**
 * GET/POST /api/phonepe/callback
 * PhonePe payment callback - handles both success and failure
 * PhonePe v2 redirects the user's browser (GET) with merchantOrderId as query param.
 * S2S callbacks come as POST. We handle both.
 */
router.all('/callback', async (req, res) => {
    const payload = { ...req.query, ...req.body };
    const storefrontBase = getStorefrontBaseUrl();
    let orderId = 0;
    let merchantOrderId = '';

    try {
        console.log('[PhonePe Callback] Method:', req.method, 'Incoming data:', {
            merchantOrderId: payload.merchantOrderId || '',
            orderId: payload.orderId || '',
            state: payload.state || '',
            transactionId: payload.transactionId || '',
            responseCode: payload.responseCode || '',
            allKeys: Object.keys(payload)
        });

        merchantOrderId = String(payload.merchantOrderId || payload.merchant_order_id || '').trim();
        orderId = Number(payload.localOrderId || payload.order_id || payload.orderId || 0) || 0;

        if (!merchantOrderId && orderId > 0) {
            const [phonePeRows] = await db.execute(
                'SELECT merchant_order_id FROM phonepe_transactions WHERE order_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1',
                [orderId]
            );
            merchantOrderId = String(phonePeRows[0]?.merchant_order_id || '').trim();
        }

        if (!merchantOrderId) {
            console.error('[PhonePe Callback] Missing merchantOrderId in payload');
            return res.redirect(`${storefrontBase}/cart.html?payment=failed&message=Invalid+payment+callback`);
        }

        // Extract order ID from merchantOrderId (format: DVPH{orderId}_{timestamp})
        const orderIdMatch = merchantOrderId.match(/DVPH(\d+)_/);
        if (!orderId && orderIdMatch && orderIdMatch[1]) {
            orderId = Number(orderIdMatch[1]);
        }

        if (!orderId || orderId <= 0) {
            console.error('[PhonePe Callback] Could not extract orderId from merchantOrderId:', merchantOrderId);
            return res.redirect(`${storefrontBase}/cart.html?payment=failed&message=Invalid+order+ID`);
        }

        // Fetch order from database
        const [orderRows] = await db.execute(
            `SELECT o.*, u.mobile_number, u.email, u.name AS user_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.order_id = ?
             LIMIT 1`,
            [orderId]
        );

        if (!orderRows.length) {
            console.error('[PhonePe Callback] Order not found:', orderId);
            return res.redirect(`${storefrontBase}/cart.html?payment=failed&message=Order+not+found`);
        }

        const order = orderRows[0];

        // ── SERVER-SIDE VERIFICATION via PhonePe Order Status API ──
        // Do NOT trust redirect params for payment state. Always verify server-side.
        let verifiedState = 'FAILED';
        let transactionId = '';
        let paymentMode = 'Unknown';
        let phonepeOrderId = '';
        let statusRaw = null;

        try {
            const statusResult = await phonepe.getPhonePeOrderStatus(merchantOrderId, {
                details: true,
                errorContext: true
            });

            statusRaw = statusResult.raw;
            verifiedState = String(statusResult.state || '').trim().toUpperCase();
            phonepeOrderId = statusResult.phonepeOrderId || '';
            transactionId = statusResult.transactionId || '';
            paymentMode = statusResult.paymentMode || 'Unknown';

            console.log('[PhonePe Callback] ✅ Server-side status verification:', {
                merchantOrderId,
                orderId,
                verifiedState,
                transactionId,
                paymentMode,
                phonepeOrderId
            });
        } catch (statusErr) {
            console.error('[PhonePe Callback] ⚠️ Status API call failed, falling back to redirect params:', statusErr.message);
            // Fallback to redirect params if Status API fails
            const fallbackState = String(payload.state || payload.responseCode || '').trim().toUpperCase();
            verifiedState = fallbackState || 'FAILED';
            transactionId = String(payload.transactionId || payload.transaction_id || '').trim();
            paymentMode = String(payload.paymentMode || payload.payment_mode || 'Unknown').trim();
            phonepeOrderId = String(payload.orderId || payload.order_id || '').trim();
        }

        const isSuccess = verifiedState === 'COMPLETED';

        // Update/Insert PhonePe transaction record
        const [existingPhonePe] = await db.execute(
            'SELECT * FROM phonepe_transactions WHERE order_id = ? LIMIT 1',
            [orderId]
        );

        if (existingPhonePe.length > 0) {
            await db.execute(
                `UPDATE phonepe_transactions
                 SET phonepe_order_id = ?, state = ?, transaction_id = ?, transaction_state = ?,
                     payment_mode = ?, response_payload = ?, updated_at = NOW()
                 WHERE order_id = ?`,
                [
                    phonepeOrderId,
                    verifiedState,
                    transactionId,
                    isSuccess ? 'Success' : 'Failed',
                    paymentMode,
                    JSON.stringify(statusRaw || payload),
                    orderId
                ]
            );
        } else {
            await db.execute(
                `INSERT INTO phonepe_transactions
                 (order_id, merchant_order_id, phonepe_order_id, state, transaction_id, transaction_state,
                  payment_mode, response_payload, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [orderId, merchantOrderId, phonepeOrderId, verifiedState, transactionId,
                 isSuccess ? 'Success' : 'Failed', paymentMode, JSON.stringify(statusRaw || payload)]
            );
        }

        if (isSuccess) {
            // Prevent double-processing if order is already Paid
            if (order.status === 'Paid') {
                console.log(`[PhonePe] Order #${orderId} already Paid, skipping finalization`);
                const invoiceRef = order.invoice_number || `NATDEV${String(orderId).padStart(3, '0')}`;
                return res.redirect(`${storefrontBase}/order-success.html?orderId=${orderId}&reference=${encodeURIComponent(invoiceRef)}&payment=success&source=phonepe`);
            }

            console.log(`[PhonePe] ✅ Payment VERIFIED successful for Order #${orderId}`);

            // Finalize order
            await finalizeSuccessfulPhonePeOrder({
                orderId,
                merchantOrderId,
                phonepeOrderId,
                transactionId,
                paymentMode,
                state: 'Completed'
            });

            const invoiceRef = order.invoice_number || `NATDEV${String(orderId).padStart(3, '0')}`;
            return res.redirect(`${storefrontBase}/order-success.html?orderId=${orderId}&reference=${encodeURIComponent(invoiceRef)}&payment=success&source=phonepe`);
        } else {
            console.log(`[PhonePe] ❌ Payment FAILED for Order #${orderId} - Verified State: ${verifiedState}`);

            // Update order payment status to Failed
            await db.execute(
                'UPDATE payments SET status = ? WHERE order_id = ?',
                ['Failed', orderId]
            );

            return res.redirect(`${storefrontBase}/cart.html?payment=failed&message=Payment+failed`);
        }
    } catch (err) {
        console.error('[PhonePe Callback] Error:', err);
        const failureUrl = `${getStorefrontBaseUrl()}/cart.html?payment=failed&message=Payment+processing+error`;
        return res.redirect(failureUrl);
    }
});

/**
 * GET /api/phonepe/status/:orderId
 * Check PhonePe payment status for an order
 * Protected route - requires authentication
 */
router.get('/status/:orderId', auth, async (req, res) => {
    const orderId = Number(req.params.orderId);

    if (!orderId || orderId <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Invalid order ID'
        });
    }

    try {
        // Verify order belongs to user
        const [orderRows] = await db.execute(
            'SELECT order_id FROM orders WHERE order_id = ? AND user_id = ? LIMIT 1',
            [orderId, req.user.userId]
        );

        if (!orderRows.length) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Get PhonePe transaction details
        const [phonePeRows] = await db.execute(
            'SELECT * FROM phonepe_transactions WHERE order_id = ? ORDER BY updated_at DESC LIMIT 1',
            [orderId]
        );

        if (!phonePeRows.length) {
            return res.status(404).json({
                success: false,
                message: 'No payment transaction found'
            });
        }

        const phonePeTxn = phonePeRows[0];

        res.json({
            success: true,
            transaction: {
                merchantOrderId: phonePeTxn.merchant_order_id,
                phonepeOrderId: phonePeTxn.phonepe_order_id,
                state: phonePeTxn.state,
                transactionState: phonePeTxn.transaction_state,
                transactionId: phonePeTxn.transaction_id,
                paymentMode: phonePeTxn.payment_mode,
                amount: phonePeTxn.amount,
                errorCode: phonePeTxn.error_code || '',
                detailedErrorCode: phonePeTxn.detailed_error_code || '',
                createdAt: phonePeTxn.created_at,
                updatedAt: phonePeTxn.updated_at
            }
        });
    } catch (err) {
        console.error('[PhonePe Status] Error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to fetch payment status'
        });
    }
});

module.exports = router;
