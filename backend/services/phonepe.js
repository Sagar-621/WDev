const crypto = require('crypto');
const axios = require('axios');

let cachedAuthToken = '';
let cachedAuthTokenExpiresAt = 0;

function getPhonePeBaseUrl() {
    return String(
        process.env.PHONEPE_BASE_URL ||
        (process.env.NODE_ENV === 'production'
            ? 'https://api.phonepe.com/apis/pg'
            : 'https://api-preprod.phonepe.com/apis/pg-sandbox')
    ).replace(/\/+$/, '');
}

function getPhonePeAuthUrl() {
    const configured = String(process.env.PHONEPE_AUTH_URL || '').trim();
    if (configured) return configured;

    // Production uses identity-manager path; sandbox uses pg-sandbox path
    return process.env.NODE_ENV === 'production'
        ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';
}

function getPhonePeCheckoutUrl() {
    return `${getPhonePeBaseUrl()}/checkout/v2/pay`;
}

function getPhonePeOrderStatusUrl(merchantOrderId) {
    const exact = String(process.env.PHONEPE_ORDER_STATUS_URL || '').trim();
    if (exact) {
        return exact.replace('{merchantOrderId}', encodeURIComponent(String(merchantOrderId || '').trim()));
    }

    const template = String(process.env.PHONEPE_ORDER_STATUS_URL_TEMPLATE || '').trim();
    if (template) {
        return template.replace('{merchantOrderId}', encodeURIComponent(String(merchantOrderId || '').trim()));
    }

    return `${getPhonePeBaseUrl()}/checkout/v2/order/${encodeURIComponent(String(merchantOrderId || '').trim())}/status`;
}

function getPhonePeClientId() {
    return String(
        process.env.PHONEPE_CLIENT_ID || 
        process.env.PHONEPE_MERCHANT_ID || 
        process.env.PHONEPE_MID || 
        ''
    ).trim();
}

function getPhonePeClientSecret() {
    return String(
        process.env.PHONEPE_CLIENT_SECRET || 
        process.env.PHONEPE_SALT_KEY || 
        process.env.PHONEPE_SALT || 
        ''
    ).trim();
}

function getPhonePeClientVersion() {
    return String(
        process.env.PHONEPE_CLIENT_VERSION || 
        process.env.PHONEPE_SALT_INDEX || 
        process.env.PHONEPE_KEY_INDEX || 
        '1'
    ).trim();
}

function getPhonePeWebhookUsername() {
    return String(process.env.PHONEPE_WEBHOOK_USERNAME || '').trim();
}

function getPhonePeWebhookPassword() {
    return String(process.env.PHONEPE_WEBHOOK_PASSWORD || '').trim();
}

function normalizeState(state) {
    const normalized = String(state || '').trim().toUpperCase();
    if (normalized === 'COMPLETED') return 'Success';
    if (normalized === 'FAILED') return 'Failed';
    if (normalized === 'PENDING' || normalized === 'INITIATED' || normalized === 'CREATED') return 'Created';
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase() : 'Created';
}

function normalizePaymentMode(paymentMode) {
    return String(paymentMode || '').trim().toUpperCase();
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
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

function normalizeWebhookAuthorizationHeader(value) {
    return String(value || '').trim().replace(/^SHA256\s*/i, '').replace(/^SHA256\(/i, '').replace(/\)$/,'');
}

function verifyWebhookAuthorization(headerValue) {
    const username = getPhonePeWebhookUsername();
    const password = getPhonePeWebhookPassword();
    if (!username || !password) return false;
    const expected = sha256(`${username}:${password}`);
    const received = normalizeWebhookAuthorizationHeader(headerValue);
    return received.length > 0 && received === expected;
}

async function readAxiosResponse(response) {
    const data = response?.data ?? null;
    const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();

    if (typeof data === 'string') {
        try {
            return { raw: data, parsed: JSON.parse(data), contentType };
        } catch {
            return { raw: data, parsed: null, contentType };
        }
    }

    return { raw: data, parsed: data, contentType };
}

async function getPhonePeAuthToken({ forceRefresh = false } = {}) {
    const clientId = getPhonePeClientId();
    const clientSecret = getPhonePeClientSecret();
    const clientVersion = getPhonePeClientVersion();

    if (!clientId || !clientSecret || !clientVersion) {
        throw new Error('PhonePe credentials are not configured (PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION required)');
    }

    const now = Date.now();
    if (!forceRefresh && cachedAuthToken && cachedAuthTokenExpiresAt > now + 30_000) {
        return {
            accessToken: cachedAuthToken,
            expiresAt: cachedAuthTokenExpiresAt
        };
    }

    const body = toFormBody({
        client_id: clientId,
        client_version: clientVersion,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    });

    const authUrl = getPhonePeAuthUrl();
    console.log('[PhonePe Auth] Requesting token from:', authUrl);

    let response;
    try {
        response = await axios.request({
            method: 'POST',
            url: authUrl,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: body.toString()
        });
    } catch (err) {
        const statusCode = err?.response?.status || 0;
        const responseData = err?.response?.data ?? null;
        console.error('[PhonePe Auth] Token request failed:', {
            status: statusCode,
            url: authUrl,
            response: responseData
        });
        const error = new Error(
            `PhonePe auth token request failed${statusCode ? ` with status ${statusCode}` : ''}`
        );
        error.statusCode = statusCode;
        error.responseData = responseData;
        throw error;
    }

    const { parsed, raw } = await readAxiosResponse(response);
    const accessToken = String(parsed?.access_token || parsed?.encrypted_access_token || '').trim();

    if (!accessToken) {
        console.error('[PhonePe Auth] No access token in response:', parsed);
        throw new Error('PhonePe auth token response did not include an access token');
    }

    // Handle expires_at as either seconds-since-epoch or milliseconds-since-epoch
    let expiresAt = Number(parsed?.expires_at || parsed?.session_expires_at || 0);
    // If the value looks like seconds (before year ~2033), convert to ms
    if (expiresAt > 0 && expiresAt < 2_000_000_000) expiresAt *= 1000;
    cachedAuthToken = accessToken;
    cachedAuthTokenExpiresAt = Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : now + 30 * 60 * 1000;

    console.log('[PhonePe Auth] Token obtained, expires in', Math.round((cachedAuthTokenExpiresAt - now) / 1000), 'seconds');

    return {
        accessToken,
        expiresAt: cachedAuthTokenExpiresAt,
        raw: parsed || raw
    };
}

async function initiatePhonePePayment({
    merchantOrderId,
    amountPaise,
    redirectUrl,
    prefillPhoneNumber = '',
    metaInfo = {},
    paymentModeConfig = null,
    disablePaymentRetry = true,
    expireAfter = 1200
}) {
    const token = await getPhonePeAuthToken();
    const requestBody = {
        merchantOrderId: String(merchantOrderId || '').trim(),
        amount: Math.max(0, Math.round(Number(amountPaise || 0))),
        expireAfter: Number(expireAfter) > 0 ? Number(expireAfter) : 1200,
        paymentFlow: {
            type: 'PG_CHECKOUT',
            merchantUrls: {
                redirectUrl: String(redirectUrl || '').trim()
            }
        },
        disablePaymentRetry: Boolean(disablePaymentRetry),
        metaInfo: Object.fromEntries(
            Object.entries(metaInfo || {}).map(([key, value]) => [key, value == null ? '' : String(value)])
        )
    };

    if (prefillPhoneNumber) {
        requestBody.prefillUserLoginDetails = {
            phoneNumber: String(prefillPhoneNumber).trim()
        };
    }

    if (paymentModeConfig) {
        requestBody.paymentFlow.paymentModeConfig = paymentModeConfig;
    }

    const checkoutUrl = getPhonePeCheckoutUrl();
    console.log('[PhonePe Checkout] Initiating payment:', {
        url: checkoutUrl,
        merchantOrderId: requestBody.merchantOrderId,
        amount: requestBody.amount,
        redirectUrl: requestBody.paymentFlow?.merchantUrls?.redirectUrl
    });

    let response;
    try {
        response = await axios.request({
            method: 'POST',
            url: checkoutUrl,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `O-Bearer ${token.accessToken}`
            },
            data: requestBody
        });
    } catch (err) {
        const statusCode = err?.response?.status || err?.statusCode || 0;
        const responseData = err?.response?.data ?? null;
        console.error('[PhonePe Checkout] Initiation failed:', {
            status: statusCode,
            url: checkoutUrl,
            requestBody: { ...requestBody, metaInfo: '...' },
            response: responseData
        });
        const error = new Error(
            `PhonePe checkout initiation failed${statusCode ? ` with status ${statusCode}` : ''}`
        );
        error.statusCode = statusCode || 502;
        error.responseData = responseData;
        error.requestBody = requestBody;
        error.cause = err;
        throw error;
    }

    const { parsed, raw } = await readAxiosResponse(response);
    const checkoutRedirectUrl = String(parsed?.redirectUrl || parsed?.data?.redirectUrl || '').trim();

    return {
        ok: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        requestBody,
        response: parsed || raw,
        raw: parsed || raw,
        merchantOrderId: String(parsed?.merchantOrderId || requestBody.merchantOrderId || merchantOrderId || '').trim(),
        phonepeOrderId: String(parsed?.orderId || parsed?.data?.orderId || '').trim(),
        state: String(parsed?.state || parsed?.data?.state || '').trim(),
        expireAt: Number(parsed?.expireAt || parsed?.data?.expireAt || 0) || null,
        redirectUrl: checkoutRedirectUrl,
        accessTokenExpiresAt: token.expiresAt
    };
}

async function getPhonePeOrderStatus(merchantOrderId, { details = false, errorContext = false } = {}) {
    const token = await getPhonePeAuthToken();
    const response = await axios.request({
        method: 'GET',
        url: getPhonePeOrderStatusUrl(merchantOrderId),
        params: {
            details: details ? 'true' : 'false',
            errorContext: errorContext ? 'true' : 'false'
        },
        headers: {
            'Content-Type': 'application/json',
            Authorization: `O-Bearer ${token.accessToken}`
        }
    });

    const { parsed, raw } = await readAxiosResponse(response);
    const paymentDetails = Array.isArray(parsed?.paymentDetails) ? parsed.paymentDetails : [];
    const latestPayment = paymentDetails[0] || {};

    return {
        ok: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        raw: parsed || raw,
        merchantOrderId: String(parsed?.merchantOrderId || parsed?.orderId || merchantOrderId || '').trim(),
        phonepeOrderId: String(parsed?.orderId || '').trim(),
        state: String(parsed?.state || '').trim(),
        amount: Number(parsed?.amount || 0) || 0,
        expireAt: Number(parsed?.expireAt || 0) || null,
        paymentDetails,
        latestPayment,
        paymentMode: normalizePaymentMode(latestPayment?.paymentMode || ''),
        transactionId: String(latestPayment?.transactionId || '').trim(),
        paymentState: String(latestPayment?.state || '').trim()
    };
}

function extractPhonePeTransactionSummary(payload = {}) {
    const paymentDetails = Array.isArray(payload.paymentDetails) ? payload.paymentDetails : [];
    const latestPayment = paymentDetails[0] || {};
    return {
        merchantOrderId: String(payload.merchantOrderId || payload.orderId || '').trim(),
        phonepeOrderId: String(payload.orderId || '').trim(),
        state: String(payload.state || '').trim(),
        amount: Number(payload.amount || 0) || 0,
        expireAt: Number(payload.expireAt || 0) || null,
        paymentMode: normalizePaymentMode(latestPayment.paymentMode || ''),
        transactionId: String(latestPayment.transactionId || '').trim(),
        paymentState: String(latestPayment.state || '').trim(),
        errorCode: String(latestPayment.errorCode || '').trim(),
        detailedErrorCode: String(latestPayment.detailedErrorCode || '').trim(),
        rawPayment: latestPayment,
        raw: payload
    };
}

module.exports = {
    getPhonePeBaseUrl,
    getPhonePeAuthUrl,
    getPhonePeCheckoutUrl,
    getPhonePeOrderStatusUrl,
    getPhonePeClientId,
    getPhonePeClientSecret,
    getPhonePeClientVersion,
    getPhonePeWebhookUsername,
    getPhonePeWebhookPassword,
    getPhonePeAuthToken,
    initiatePhonePePayment,
    getPhonePeOrderStatus,
    verifyWebhookAuthorization,
    extractPhonePeTransactionSummary,
    normalizeState
};
