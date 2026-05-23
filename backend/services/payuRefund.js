const crypto = require('crypto');

function getPayuKey() {
    return String(process.env.PAYU_KEY || '').trim();
}

function getPayuSalt() {
    return String(process.env.PAYU_SALT || '').trim();
}

function getPayuPostServiceUrl() {
    const override = String(process.env.PAYU_REFUND_URL || '').trim();
    if (override) return override.replace(/\/+$/, '');

    const base = String(process.env.PAYU_BASE_URL || '').trim().toLowerCase();
    if (base.includes('secure.payu.in') || base.includes('info.payu.in')) {
        return 'https://info.payu.in/merchant/postservice.php';
    }
    return 'https://test.payu.in/merchant/postservice.php';
}

function getRefundCallbackUrl() {
    // This should be your webhook endpoint that receives refund status updates
    const override = String(process.env.PAYU_REFUND_CALLBACK_URL || '').trim();
    if (override) return override;
    
    // Default fallback - should be configured via env
    return 'https://your-domain.com/api/payu-webhook/refund-callback';
}

function sha512(value) {
    return crypto.createHash('sha512').update(String(value || '')).digest('hex');
}

function buildApiHash(command, var1, salt = null) {
    const key = getPayuKey();
    const _salt = salt || getPayuSalt();
    // Hash format: sha512(key|command|var1|salt)
    const hashString = [key, command, var1, _salt].join('|');
    return sha512(hashString);
}

function toFormBody(fields) {
    return new URLSearchParams(
        Object.entries(fields).reduce((acc, [key, value]) => {
            if (value === undefined || value === null || value === '') return acc;
            acc[key] = String(value);
            return acc;
        }, {})
    );
}

async function readPayuResponse(response) {
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        try {
            return { rawText: text, parsed: JSON.parse(text) };
        } catch {
            return { rawText: text, parsed: null };
        }
    }

    try {
        return { rawText: text, parsed: JSON.parse(text) };
    } catch {
        return { rawText: text, parsed: null };
    }
}

function extractRequestId(payload) {
    if (!payload) return '';
    const candidates = [
        payload.request_id,
        payload.requestId,
        payload.result?.request_id,
        payload.result?.requestId,
        payload.ref_id,
        payload.refId,
        payload.transaction_id,
        payload.transactionId
    ];
    const found = candidates.find((value) => String(value || '').trim());
    if (found) return String(found).trim();

    // Try to extract UUID from text
    const text = String(payload.msg || payload.message || payload.details || payload.Details || payload.rawText || '');
    const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuidMatch ? uuidMatch[0] : '';
}

function extractStatusText(payload) {
    if (!payload) return '';
    const candidates = [
        payload.msg,
        payload.message,
        payload.status,
        payload.Status,
        payload.result?.status,
        payload.result?.msg,
        payload.result?.message,
        payload.details,
        payload.Details,
        payload.refund_status,
        payload.refundStatus
    ];
    const found = candidates.find((value) => typeof value === 'string' && value.trim());
    return String(found || '').trim();
}

function classifyRefundStatus(payload, rawText = '') {
    const combined = `${extractStatusText(payload)} ${rawText}`.toLowerCase();
    
    // Check for completed statuses
    if (combined.includes('refund completed') || 
        combined.includes('refund successful') || 
        combined.includes('completed') ||
        combined.includes('success') ||
        combined.includes('partial refund successful')) {
        return 'Refund Completed';
    }
    
    // Check for failed statuses
    if (combined.includes('refund failed') || 
        combined.includes('failed') || 
        combined.includes('error') ||
        combined.includes('rejected') ||
        combined.includes('declined')) {
        return 'Refund Failed';
    }
    
    // Check for processing statuses
    if (combined.includes('queued') || 
        combined.includes('processing') || 
        combined.includes('initiated') ||
        combined.includes('pending') ||
        combined.includes('in progress')) {
        return 'Refund Initiated';
    }
    
    return '';
}

async function postPayuForm(fields) {
    const response = await fetch(`${getPayuPostServiceUrl()}?form=2`, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: toFormBody(fields)
    });
    const payload = await readPayuResponse(response);
    return { response, ...payload };
}

/**
 * Initiate a refund transaction using PayU's cancel_refund_transaction API
 * @param {Object} options
 * @param {string} options.payuId - The PayU Transaction ID (mihpayid) to refund
 * @param {number} options.amount - Refund amount in Rs (full or partial)
 * @param {string} options.callbackUrl - Optional webhook URL for refund status updates
 * @returns {Promise<Object>} Refund initiation response with request ID
 */
async function initiatePayuRefund({ payuId, amount, callbackUrl = null }) {
    const key = getPayuKey();
    const salt = getPayuSalt();
    
    if (!key || !salt) {
        throw new Error('PayU refund credentials are not configured (PAYU_KEY and PAYU_SALT required)');
    }

    const command = 'cancel_refund_transaction';
    const var1 = String(payuId || '').trim();
    
    if (!var1) {
        throw new Error('Original PayU payment id (mihpayid) is required for refund');
    }

    // Generate unique merchant token for this refund request (max 23 chars)
    const merchantToken = `REF-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.substring(0, 23);
    const refundAmount = Number(amount || 0).toFixed(2);
    
    if (Number(refundAmount) <= 0) {
        throw new Error('Refund amount must be greater than 0');
    }

    // var5 is the callback URL where PayU sends refund status updates
    const var5 = callbackUrl || getRefundCallbackUrl();
    
    // Build hash: sha512(key|command|var1|salt)
    const hash = buildApiHash(command, var1, salt);

    console.log(`[PayU Refund] Initiating refund: payuId=${var1}, amount=${refundAmount}, token=${merchantToken}`);

    const { response, parsed, rawText } = await postPayuForm({
        key,
        command,
        hash,
        var1,           // PayU Transaction ID (mihpayid)
        var2: merchantToken,  // Unique token for tracking (max 23 chars)
        var3: refundAmount,   // Refund amount
        var5            // Callback URL for webhook notifications
    });

    const requestId = extractRequestId(parsed || { rawText });
    const statusText = extractStatusText(parsed || { rawText });
    const normalizedStatus = classifyRefundStatus(parsed, rawText);

    console.log(`[PayU Refund] Response: status=${response.status}, requestId=${requestId}, normalizedStatus=${normalizedStatus}`);

    return {
        ok: response.ok,
        statusCode: response.status,
        requestId: requestId || merchantToken,
        merchantToken,
        statusText: statusText || (response.ok ? 'Refund request submitted to PayU' : rawText),
        normalizedStatus: normalizedStatus || (response.ok ? 'Refund Initiated' : 'Refund Failed'),
        raw: parsed || rawText,
        rawText,
        command,
        var1,
        var3: refundAmount
    };
}

/**
 * Check refund status using Request ID (returned from initiatePayuRefund)
 * @param {string} requestId - The Request ID from cancel_refund_transaction API response
 * @returns {Promise<Object>} Refund status information
 */
async function checkRefundStatusByRequestId(requestId) {
    const key = getPayuKey();
    const salt = getPayuSalt();
    
    if (!key || !salt) {
        throw new Error('PayU refund credentials are not configured');
    }

    const command = 'check_action_status';
    const var1 = String(requestId || '').trim();
    
    if (!var1) {
        throw new Error('PayU refund request ID is required to check status');
    }

    // Build hash: sha512(key|command|var1|salt)
    const hash = buildApiHash(command, var1, salt);

    console.log(`[PayU Status Check] Checking refund by request ID: requestId=${var1}`);

    const { response, parsed, rawText } = await postPayuForm({
        key,
        command,
        hash,
        var1  // Request ID from cancel_refund_transaction response
    });

    const statusText = extractStatusText(parsed || { rawText });
    const normalizedStatus = classifyRefundStatus(parsed, rawText);

    console.log(`[PayU Status Check] Response: status=${response.status}, normalizedStatus=${normalizedStatus}`);

    return {
        ok: response.ok,
        statusCode: response.status,
        requestId: var1,
        statusText,
        normalizedStatus: normalizedStatus || statusText || 'Unknown',
        raw: parsed || rawText,
        rawText
    };
}

/**
 * Check refund/action status using PayU ID (mihpayid)
 * This returns the latest action status for a given PayU transaction
 * @param {string} payuId - The PayU Transaction ID (mihpayid)
 * @returns {Promise<Object>} Action status information
 */
async function checkRefundStatusByPayuId(payuId) {
    const key = getPayuKey();
    const salt = getPayuSalt();
    
    if (!key || !salt) {
        throw new Error('PayU refund credentials are not configured');
    }

    const command = 'check_action_status';
    const var1 = String(payuId || '').trim();
    
    if (!var1) {
        throw new Error('PayU payment id (mihpayid) is required');
    }

    // Build hash: sha512(key|command|var1|salt)
    const hash = buildApiHash(command, var1, salt);

    console.log(`[PayU Status Check] Checking action status by PayU ID: payuId=${var1}`);

    const { response, parsed, rawText } = await postPayuForm({
        key,
        command,
        hash,
        var1,           // PayU Transaction ID (mihpayid)
        var2: 'payuid'  // Lookup type: 'payuid' means query by PayU ID
    });

    const statusText = extractStatusText(parsed || { rawText });
    const normalizedStatus = classifyRefundStatus(parsed, rawText);

    console.log(`[PayU Status Check] Response: status=${response.status}, normalizedStatus=${normalizedStatus}`);

    return {
        ok: response.ok,
        statusCode: response.status,
        payuId: var1,
        statusText,
        normalizedStatus: normalizedStatus || statusText || 'Unknown',
        raw: parsed || rawText,
        rawText
    };
}

/**
 * Get all refunds for a specific transaction ID
 * Returns comprehensive refund history including all refund attempts
 * @param {string} transactionId - The transaction ID (txnid) to get refunds for
 * @returns {Promise<Object>} Complete refund history
 */
async function getAllRefundsFromTransactionId(transactionId) {
    const key = getPayuKey();
    const salt = getPayuSalt();
    
    if (!key || !salt) {
        throw new Error('PayU refund credentials are not configured');
    }

    const command = 'getAllRefundsFromTxnIds';
    const var1 = String(transactionId || '').trim();
    
    if (!var1) {
        throw new Error('Transaction ID is required to fetch refund history');
    }

    // Build hash: sha512(key|command|var1|salt)
    const hash = buildApiHash(command, var1, salt);

    console.log(`[PayU Refund History] Fetching all refunds for transaction: txnId=${var1}`);

    const { response, parsed, rawText } = await postPayuForm({
        key,
        command,
        hash,
        var1  // Transaction ID
    });

    console.log(`[PayU Refund History] Response: status=${response.status}`);

    // Parse refunds array if present
    let refunds = [];
    try {
        if (parsed && Array.isArray(parsed.refunds)) {
            refunds = parsed.refunds;
        } else if (parsed && parsed.result && Array.isArray(parsed.result)) {
            refunds = parsed.result;
        }
    } catch (e) {
        console.error('[PayU Refund History] Error parsing refunds:', e.message);
    }

    return {
        ok: response.ok,
        statusCode: response.status,
        transactionId: var1,
        refunds: refunds || [],
        totalRefunds: refunds?.length || 0,
        raw: parsed || rawText,
        rawText
    };
}

module.exports = {
    initiatePayuRefund,
    checkRefundStatusByRequestId,
    checkRefundStatusByPayuId,
    getAllRefundsFromTransactionId,
    classifyRefundStatus,
    extractRequestId,
    extractStatusText,
    getPayuKey,
    getPayuSalt,
    getPayuPostServiceUrl,
    getRefundCallbackUrl
};

