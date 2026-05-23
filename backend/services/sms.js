const axios = require('axios');

function normalizeIndianMobile(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 10) return '';
    return digits.slice(-10);
}

function getSmsConfig() {
    return {
        apiKey: String(process.env.TWO_FACTOR_API_KEY || '').trim(),
        senderId: String(process.env.TWO_FACTOR_SENDER_ID || 'NATOKT').trim(),
        templateName: String(process.env.TWO_FACTOR_TEMPLATE_NAME || 'NATDEV').trim()
    };
}

function getTransactionalSmsConfig(purpose = 'notification') {
    const normalizedPurpose = String(purpose || 'notification').trim().toLowerCase();
    const suffix = normalizedPurpose === 'otp' ? 'OTP' : normalizedPurpose === 'order' ? 'ORDER' : normalizedPurpose === 'refund' ? 'REFUND' : normalizedPurpose === 'return' ? 'RETURN' : normalizedPurpose === 'cancellation' ? 'CANCELLATION' : 'NOTIFICATION';

    return {
        apiKey: String(process.env.TWO_FACTOR_API_KEY || '').trim(),
        senderId: String(process.env[`TWO_FACTOR_${suffix}_SENDER_ID`] || process.env.TWO_FACTOR_SENDER_ID || 'NATOKT').trim(),
        templateName: String(process.env[`TWO_FACTOR_${suffix}_TEMPLATE_NAME`] || process.env[`TWO_FACTOR_${suffix}_TEMPLATE`] || '').trim()
    };
}

function isSmsConfigured() {
    const { apiKey } = getSmsConfig();
    return Boolean(apiKey && apiKey !== 'your_2factor_api_key');
}

async function sendSms({ mobile, message }) {
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
        throw new Error('A valid 10-digit mobile number is required');
    }

    if (!isSmsConfigured()) {
        throw new Error('2Factor API key and template name are required for OTP SMS');
    }

    const { apiKey, senderId, templateName } = getSmsConfig();
    const formattedMobile = `+91${normalizedMobile}`;
    const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/TSMS`;

    const payload = {
        From: senderId || 'FTORIN',
        To: formattedMobile,
        Msg: String(message || '').trim()
    };

    if (templateName) {
        payload.TemplateName = templateName;
    }

    console.log(`[SMS] Attempting OTP SMS to ${formattedMobile}...`);
    const response = await axios.post(url, payload);
    console.log('[SMS] 2Factor response:', response.data);

    if (String(response.data?.Status || '').toLowerCase() !== 'success') {
        throw new Error(response.data?.Details || '2Factor did not accept the SMS request');
    }

    return { success: true, dev: false, response: response.data };
}

async function sendTransactionalSms({ mobile, message, purpose = 'notification' }) {
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
        throw new Error('A valid 10-digit mobile number is required');
    }

    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        throw new Error('A message is required');
    }

    const { apiKey, senderId, templateName } = getTransactionalSmsConfig(purpose);
    if (!apiKey || apiKey === 'your_2factor_api_key') {
        throw new Error('2Factor API key is required for transactional SMS');
    }

    const formattedMobile = `+91${normalizedMobile}`;
    const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/TSMS`;
    const payload = {
        From: senderId || 'NATOKT',
        To: formattedMobile,
        Msg: normalizedMessage
    };

    if (templateName) {
        payload.TemplateName = templateName;
    }

    console.log(`[SMS] Attempting ${String(purpose || 'notification').toUpperCase()} SMS to ${formattedMobile}...`);
    const response = await axios.post(url, payload);
    console.log('[SMS] 2Factor transactional response:', response.data);

    if (String(response.data?.Status || '').toLowerCase() !== 'success') {
        throw new Error(response.data?.Details || '2Factor did not accept the SMS request');
    }

    return { success: true, dev: false, response: response.data };
}

async function sendManagedOtp({ mobile, otp }) {
    const normalizedMobile = normalizeIndianMobile(mobile);
    if (!normalizedMobile) {
        throw new Error('A valid 10-digit mobile number is required');
    }
    const normalizedOtp = String(otp || '').trim();
    if (!/^\d{4,6}$/.test(normalizedOtp)) {
        throw new Error('A valid 4-6 digit OTP is required');
    }

    if (!isSmsConfigured()) {
        throw new Error('2Factor API key and template name are required for OTP SMS');
    }

    const { apiKey, templateName } = getSmsConfig();
    const formattedMobile = `+91${normalizedMobile}`;
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${formattedMobile}/${normalizedOtp}/${encodeURIComponent(templateName)}`;

    console.log(`[SMS OTP] Requesting 2Factor template OTP for ${formattedMobile} using template ${templateName}...`);
    const response = await axios.get(url);
    console.log('[SMS OTP] 2Factor manual-send response:', response.data);

    if (String(response.data?.Status || '').toLowerCase() !== 'success') {
        throw new Error(response.data?.Details || '2Factor did not accept the OTP request');
    }

    return {
        success: true,
        dev: false,
        sessionId: String(response.data?.Details || '').trim(),
        response: response.data
    };
}

async function verifyManagedOtp({ sessionId, otp }) {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedOtp = String(otp || '').trim();

    if (!normalizedSessionId) {
        throw new Error('2Factor session ID is required');
    }

    if (!/^\d{4,8}$/.test(normalizedOtp)) {
        throw new Error('A valid OTP is required');
    }

    if (!isSmsConfigured()) {
        throw new Error('2Factor API key and template name are required for OTP verification');
    }

    const { apiKey } = getSmsConfig();
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/VERIFY/${normalizedSessionId}/${normalizedOtp}`;

    console.log(`[SMS OTP] Verifying 2Factor OTP session ${normalizedSessionId}...`);
    const response = await axios.get(url);
    console.log('[SMS OTP] 2Factor VERIFY response:', response.data);

    const status = String(response.data?.Status || '').toLowerCase();
    const details = String(response.data?.Details || '').trim();
    if (status !== 'success' && !/otp matched/i.test(details)) {
        throw new Error(response.data?.Details || 'Invalid OTP');
    }

    return { success: true, dev: false, response: response.data };
}

module.exports = {
    normalizeIndianMobile,
    isSmsConfigured,
    sendSms,
    sendTransactionalSms,
    sendManagedOtp,
    verifyManagedOtp
};

