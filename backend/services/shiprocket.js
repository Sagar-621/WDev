/**
 * Shiprocket service
 *
 * This module is fully independent from 2Factor/SMS logic.
 * It only talks to Shiprocket and only reads configuration
 * from environment variables.
 */

const axios = require('axios');

const SHIPROCKET_API = 'https://apiv2.shiprocket.in/v1/external';
const DEFAULT_PARCEL_DIMENSIONS = {
    length: 16,
    breadth: 12,
    height: 3,
    weight: 0.2
};
const PLACEHOLDER_VALUES = new Set([
    '',
    'your_shiprocket_email',
    'your_shiprocket_password',
    'your_channel_id'
]);

const SHIPROCKET_STATUS_CODE_LABELS = {
    1: 'AWB Assigned',
    2: 'Label Generated',
    3: 'Pickup Scheduled/Generated',
    4: 'Pickup Queued',
    5: 'Manifest Generated',
    6: 'Shipped',
    7: 'Delivered',
    8: 'Cancelled',
    9: 'RTO Initiated',
    10: 'RTO Delivered',
    11: 'Pending',
    12: 'Lost',
    13: 'Pickup Error',
    14: 'RTO Acknowledged',
    15: 'Pickup Rescheduled',
    16: 'Cancellation Requested',
    17: 'Out For Delivery',
    18: 'In Transit',
    19: 'Out For Pickup',
    20: 'Pickup Exception',
    21: 'Undelivered',
    22: 'Delayed',
    23: 'Partial Delivered',
    24: 'Destroyed',
    25: 'Damaged',
    26: 'Fulfilled',
    38: 'Reached at Destination',
    39: 'Misrouted',
    40: 'RTO NDR',
    41: 'RTO OFD',
    42: 'Picked Up',
    43: 'Self Fulfilled',
    44: 'Disposed Off',
    45: 'Cancelled Before Dispatched',
    46: 'RTO In Transit',
    47: 'QC Failed',
    48: 'Reached Warehouse',
    49: 'Custom Cleared',
    50: 'In Flight',
    51: 'Handover to Courier',
    52: 'Shipment Booked',
    54: 'In Transit Overseas',
    55: 'Connection Aligned',
    56: 'Reached Overseas Warehouse',
    57: 'Custom Cleared Overseas',
    59: 'Box Packing'
};

let cachedToken = null;
let tokenExpiry = 0;

function readEnv(name, fallback = '') {
    const value = String(process.env[name] || '').trim();
    return value || fallback;
}

function getConfig() {
    const email = readEnv('SHIPROCKET_EMAIL');
    const password = readEnv('SHIPROCKET_PASSWORD');
    const pickupLocation = readEnv('SHIPROCKET_PICKUP_LOCATION', 'Primary');
    const channelId = readEnv('SHIPROCKET_CHANNEL_ID');
    const sellerPickupLocationId = readEnv('SHIPROCKET_SELLER_PICKUP_LOCATION_ID');
    const sellerShippingLocationId = readEnv('SHIPROCKET_SELLER_SHIPPING_LOCATION_ID');
    const exchangeReturnReasonCode = readEnv('SHIPROCKET_RETURN_REASON_CODE', '29');

    return {
        email,
        password,
        pickupLocation,
        channelId: PLACEHOLDER_VALUES.has(channelId) ? '' : channelId,
        sellerPickupLocationId,
        sellerShippingLocationId,
        exchangeReturnReasonCode
    };
}

function isConfigured() {
    const { email, password } = getConfig();
    return !PLACEHOLDER_VALUES.has(email) && !PLACEHOLDER_VALUES.has(password);
}

function sanitizeError(error) {
    return error?.response?.data || error?.message || 'Unknown Shiprocket error';
}

function logStep(message, meta) {
    if (meta !== undefined) {
        console.log(`[Shiprocket] ${message}`, meta);
        return;
    }
    console.log(`[Shiprocket] ${message}`);
}

function logError(message, error) {
    console.error(`[Shiprocket] ${message}:`, sanitizeError(error));
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

function sanitizeShiprocketStatusValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d+$/.test(text)) return '';
    return cleanStatusLabel(text);
}

function getShiprocketStatusLabelFromCode(value) {
    const code = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(code)) return '';
    return SHIPROCKET_STATUS_CODE_LABELS[code] || '';
}

function normalizeShiprocketDatetime(value) {
    if (!value) return null;

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const pad = (part) => String(part).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }

    if (typeof value === 'object') {
        const nested = firstNonEmpty(
            value.date,
            value.datetime,
            value.timestamp,
            value.created_at,
            value.updated_at,
            value.time
        );
        if (nested) {
            return normalizeShiprocketDatetime(nested);
        }
    }

    const text = String(value).trim();
    if (!text) return null;

    const isoLikeMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/i);
    if (isoLikeMatch) {
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime())) {
            const pad = (part) => String(part).padStart(2, '0');
            return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
        }
        return `${isoLikeMatch[1]} ${isoLikeMatch[2]}`;
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    const pad = (part) => String(part).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

function cleanStatusLabel(value) {
    return String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isCancellationRequestedLabel(value) {
    const normalized = cleanStatusLabel(value).toLowerCase();
    return (
        normalized.includes('cancellation requested') ||
        normalized.includes('cancel request') ||
        normalized.includes('cancel requested')
    );
}

function normalizeShiprocketStatus(rawStatus, fallbackLatestActivity = '') {
    const raw = sanitizeShiprocketStatusValue(rawStatus)
        || getShiprocketStatusLabelFromCode(rawStatus)
        || sanitizeShiprocketStatusValue(fallbackLatestActivity)
        || getShiprocketStatusLabelFromCode(fallbackLatestActivity);
    const normalized = raw.toLowerCase();

    if (!normalized) {
        return {
            system_status: '',
            user_message: '',
            display_status: ''
        };
    }

    if (isCancellationRequestedLabel(normalized)) {
        return {
            system_status: 'CANCELLATION REQUESTED',
            user_message: 'Cancellation requested',
            display_status: 'CANCELLATION REQUESTED'
        };
    }

    if (normalized.includes('cancel')) {
        return {
            system_status: 'CANCELED',
            user_message: 'Order cancelled',
            display_status: 'CANCELED'
        };
    }

    if (normalized.includes('rto')) {
        return {
            system_status: 'RTO',
            user_message: 'Returning to seller',
            display_status: 'RTO'
        };
    }

    if (normalized.includes('deliver')) {
        return {
            system_status: 'DELIVERED',
            user_message: 'Delivered successfully',
            display_status: 'DELIVERED'
        };
    }

    if (normalized.includes('out for delivery')) {
        return {
            system_status: 'OUT FOR DELIVERY',
            user_message: 'Out for delivery today',
            display_status: 'OUT FOR DELIVERY'
        };
    }

    if (normalized.includes('destination')) {
        return {
            system_status: 'REACHED DESTINATION CITY',
            user_message: 'Reached your city',
            display_status: 'REACHED DESTINATION CITY'
        };
    }

    if (normalized.includes('in transit') || normalized.includes('transit') || normalized.includes('on the way')) {
        return {
            system_status: 'IN TRANSIT',
            user_message: 'Order is on the way',
            display_status: 'IN TRANSIT'
        };
    }

    if (normalized.includes('picked up') || normalized === 'picked up' || normalized.includes('pickup done')) {
        return {
            system_status: 'PICKED UP',
            user_message: 'Order picked up',
            display_status: 'PICKED UP'
        };
    }

    if (normalized.includes('pickup scheduled') || normalized.includes('pickup generated') || normalized.includes('pickup requested')) {
        return {
            system_status: 'PICKUP SCHEDULED',
            user_message: 'Will be picked up soon',
            display_status: 'PICKUP SCHEDULED'
        };
    }

    if (normalized.includes('confirm')) {
        return {
            system_status: 'CONFIRMED',
            user_message: 'Your order is confirmed',
            display_status: 'CONFIRMED'
        };
    }

    if (
        normalized.includes('new') ||
        normalized.includes('created') ||
        normalized.includes('awb assigned') ||
        normalized.includes('awb generated') ||
        normalized.includes('booked') ||
        normalized.includes('manifest')
    ) {
        return {
            system_status: 'NEW',
            user_message: 'Order placed successfully',
            display_status: 'NEW'
        };
    }

    return {
        system_status: raw.toUpperCase(),
        user_message: raw,
        display_status: raw.toUpperCase()
    };
}

function getShiprocketStatusRank(value) {
    const normalized = sanitizeShiprocketStatusValue(value).toLowerCase();
    if (!normalized) return 0;
    if (isCancellationRequestedLabel(normalized)) return 0;
    if (normalized.includes('cancel') || normalized.includes('rto') || normalized.includes('return')) return 4;
    if (normalized.includes('deliver')) return 3;
    if (normalized.includes('ship') || normalized.includes('transit') || normalized.includes('out for delivery')) return 2;
    if (
        normalized.includes('pickup') ||
        normalized.includes('confirm') ||
        normalized.includes('packed') ||
        normalized.includes('awb') ||
        normalized.includes('manifest') ||
        normalized.includes('label') ||
        normalized.includes('ready to ship') ||
        normalized.includes('booked') ||
        normalized.includes('pick')
    ) {
        return 1;
    }
    return 0;
}

function pickPreferredShiprocketStatus(...values) {
    let chosen = '';
    let chosenRank = -1;

    for (const value of values) {
        const text = cleanStatusLabel(value);
        if (!text) continue;

        const rank = getShiprocketStatusRank(text);
        if (rank > chosenRank || (!chosen && rank === chosenRank)) {
            chosen = text;
            chosenRank = rank;
        }
    }

    return chosen;
}

function shouldSkipPickupGeneration({ orderStatus = '', shiprocketStatus = '', trackingStatus = '', latestActivity = '' } = {}) {
    const localStatus = String(orderStatus || '').trim().toLowerCase();
    if (localStatus === 'cancelled' || localStatus === 'canceled') {
        return true;
    }

    const combinedLabel = sanitizeShiprocketStatusValue([shiprocketStatus, trackingStatus, latestActivity].filter(Boolean).join(' '));
    const normalized = normalizeShiprocketStatus(combinedLabel, combinedLabel);
    const searchable = `${combinedLabel} ${normalized.system_status} ${normalized.display_status} ${normalized.user_message}`.toLowerCase();
    const cancellationRequested = isCancellationRequestedLabel(searchable);

    return (
        (searchable.includes('cancel') && !cancellationRequested) ||
        searchable.includes('rto') ||
        searchable.includes('return')
    );
}

function extractAwbAssignmentResult(payload) {
    if (!payload || typeof payload !== 'object') {
        return { awb_code: '', courier_name: '', message: '', awb_assign_error: '', status_code: null, awb_assign_status: null, raw: payload || null };
    }

    const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const awbCode = firstNonEmpty(
        root.awb_code,
        root.awbCode,
        root.awb,
        root.awb_number,
        payload.awb_code,
        payload.awbCode,
        payload.awb,
        payload.awb_number,
        root.data?.awb_code,
        root.data?.awbCode,
        root.data?.awb
    );
    const courierName = firstNonEmpty(
        root.courier_name,
        root.courier_company_name,
        root.courier,
        payload.courier_name,
        payload.courier_company_name,
        payload.courier,
        root.data?.courier_name,
        root.data?.courier_company_name,
        root.data?.courier
    );
    const message = firstNonEmpty(
        root.message,
        root.msg,
        root.status,
        payload.message,
        payload.msg,
        payload.status,
        root.data?.message,
        root.data?.msg,
        root.data?.status,
        root.data?.awb_assign_error
    );
    const awbAssignError = firstNonEmpty(
        root.awb_assign_error,
        payload.awb_assign_error,
        root.data?.awb_assign_error
    );
    const statusCode = firstNonEmpty(
        root.status_code,
        payload.status_code,
        root.data?.status_code
    );
    const awbAssignStatus = firstNonEmpty(
        root.awb_assign_status,
        payload.awb_assign_status,
        root.data?.awb_assign_status
    );

    return {
        awb_code: awbCode,
        courier_name: courierName,
        message,
        awb_assign_error: awbAssignError,
        status_code: statusCode ? Number(statusCode) : null,
        awb_assign_status: awbAssignStatus ? Number(awbAssignStatus) : null,
        raw: payload
    };
}

function pickLatestTrackingEvent(trackingData) {
    const events = [
        ...(Array.isArray(trackingData?.shipment_track) ? trackingData.shipment_track : []),
        ...(Array.isArray(trackingData?.shipment_track_activities) ? trackingData.shipment_track_activities : [])
    ].filter((event) => event && typeof event === 'object');

    if (!events.length) return null;

    const parsedEvents = events.map((event, index) => {
        const rawDate = firstNonEmpty(event.date, event.updated_date, event.created_at, event.event_date);
        const timestamp = rawDate ? Date.parse(rawDate) : NaN;
        return {
            event,
            index,
            timestamp: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
        };
    });

    parsedEvents.sort((a, b) => {
        if (a.timestamp === b.timestamp) return a.index - b.index;
        return a.timestamp - b.timestamp;
    });

    return parsedEvents[parsedEvents.length - 1]?.event || events[events.length - 1] || null;
}

async function getToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiry - 3600000) {
        return cachedToken;
    }

    const { email, password } = getConfig();
    if (!isConfigured()) {
        logStep('Credentials not configured in .env; skipping Shiprocket sync');
        return null;
    }

    try {
        logStep(`Authenticating with API user ${email}`);
        const response = await axios.post(
            `${SHIPROCKET_API}/auth/login`,
            { email, password },
            { timeout: 20000 }
        );

        cachedToken = response.data?.token || null;
        tokenExpiry = now + 24 * 60 * 60 * 1000;

        if (!cachedToken) {
            logStep('Auth response did not include a token');
            return null;
        }

        logStep('Authenticated successfully');
        return cachedToken;
    } catch (error) {
        logError('Auth failed', error);
        return null;
    }
}

async function apiRequest(method, path, { data, params } = {}) {
    const token = await getToken();
    if (!token) return null;

    try {
        const response = await axios({
            method,
            url: `${SHIPROCKET_API}${path}`,
            data,
            params,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        return response.data;
    } catch (error) {
        logError(`${method.toUpperCase()} ${path} failed`, error);
        return null;
    }
}

function extractTrackingSummary(data, fallback = {}) {
    if (!data || typeof data !== 'object') {
        return {
            shiprocket_order_id: firstNonEmpty(fallback.shiprocket_order_id),
            shiprocket_shipment_id: firstNonEmpty(fallback.shiprocket_shipment_id),
            shiprocket_awb_code: firstNonEmpty(fallback.shiprocket_awb_code),
            courier_name: firstNonEmpty(fallback.shiprocket_courier_name),
            shiprocket_status: sanitizeShiprocketStatusValue(fallback.shiprocket_status),
            tracking_status: firstNonEmpty(
                sanitizeShiprocketStatusValue(fallback.shiprocket_tracking_status),
                sanitizeShiprocketStatusValue(fallback.shiprocket_status)
            ),
            display_status: firstNonEmpty(
                sanitizeShiprocketStatusValue(fallback.shiprocket_tracking_status),
                sanitizeShiprocketStatusValue(fallback.shiprocket_latest_activity),
                sanitizeShiprocketStatusValue(fallback.shiprocket_status)
            ),
            latest_activity: firstNonEmpty(
                sanitizeShiprocketStatusValue(fallback.shiprocket_latest_activity),
                sanitizeShiprocketStatusValue(fallback.shiprocket_tracking_status),
                sanitizeShiprocketStatusValue(fallback.shiprocket_status)
            ),
            latest_activity_at: fallback.shiprocket_latest_activity_at || null,
            tracking_payload: null
        };
    }

    const trackingData = data.tracking_data || data;
    const latestEvent = pickLatestTrackingEvent(trackingData);
    const primaryTrack = Array.isArray(trackingData.shipment_track) && trackingData.shipment_track.length
        ? trackingData.shipment_track[0]
        : null;
    const statusLabelFromCode = getShiprocketStatusLabelFromCode(
        trackingData.status ||
        trackingData.shipment_status ||
        primaryTrack?.status ||
        fallback.shiprocket_status
    );
    const shipmentStatus = firstNonEmpty(
        sanitizeShiprocketStatusValue(trackingData.current_status),
        sanitizeShiprocketStatusValue(primaryTrack?.current_status),
        statusLabelFromCode,
        sanitizeShiprocketStatusValue(fallback.shiprocket_status)
    );
    const trackingStatus = firstNonEmpty(
        sanitizeShiprocketStatusValue(latestEvent?.activity),
        sanitizeShiprocketStatusValue(latestEvent?.current_status),
        sanitizeShiprocketStatusValue(latestEvent?.status),
        statusLabelFromCode,
        sanitizeShiprocketStatusValue(fallback.shiprocket_tracking_status),
        shipmentStatus
    );
    const latestActivity = firstNonEmpty(
        sanitizeShiprocketStatusValue(latestEvent?.activity),
        sanitizeShiprocketStatusValue(latestEvent?.current_status),
        sanitizeShiprocketStatusValue(latestEvent?.status),
        statusLabelFromCode,
        trackingStatus,
        sanitizeShiprocketStatusValue(fallback.shiprocket_latest_activity),
        shipmentStatus
    );
    const latestActivityAt = firstNonEmpty(
        latestEvent?.date,
        latestEvent?.updated_date,
        latestEvent?.created_at,
        latestEvent?.event_date,
        normalizeShiprocketDatetime(trackingData.updated_at),
        normalizeShiprocketDatetime(trackingData.created_at),
        fallback.shiprocket_latest_activity_at
    );
    const normalizedStatus = normalizeShiprocketStatus(
        trackingStatus || shipmentStatus,
        latestActivity
    );

    return {
        shiprocket_order_id: firstNonEmpty(primaryTrack?.order_id, trackingData.order_id, fallback.shiprocket_order_id),
        shiprocket_shipment_id: firstNonEmpty(primaryTrack?.shipment_id, trackingData.shipment_id, fallback.shiprocket_shipment_id),
        shiprocket_awb_code: firstNonEmpty(primaryTrack?.awb_code, trackingData.awb_code, fallback.shiprocket_awb_code),
        courier_name: firstNonEmpty(primaryTrack?.courier_name, trackingData.courier_name, fallback.shiprocket_courier_name),
        shiprocket_status: shipmentStatus || trackingStatus,
        tracking_status: trackingStatus,
        display_status: trackingStatus || latestActivity || shipmentStatus,
        system_status: normalizedStatus.system_status,
        user_message: normalizedStatus.user_message,
        latest_activity: latestActivity,
        latest_activity_at: normalizeShiprocketDatetime(latestActivityAt) || null,
        tracking_payload: trackingData
    };
}

async function assignAwb(shipmentId, options = {}) {
    if (!shipmentId) return null;

    logStep(`Assigning AWB for shipment ${shipmentId}`);
    const shipmentNumericId = Number(shipmentId);
    const isReturn = Number(options.isReturn) === 1 || options.isReturn === true;
    const requestBodies = [
        isReturn ? { shipment_id: shipmentNumericId, is_return: 1 } : { shipment_id: shipmentNumericId },
        isReturn ? { shipment_id: [shipmentNumericId], is_return: 1 } : { shipment_id: [shipmentNumericId] }
    ];

    const token = await getToken();
    if (!token) return null;

    for (const body of requestBodies) {
        try {
            const response = await axios({
                method: 'post',
                url: `${SHIPROCKET_API}/courier/assign/awb`,
                data: body,
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = response.data || {};
            const result = extractAwbAssignmentResult(data);
            if (result.awb_code) {
                logStep(`AWB assignment response for shipment ${shipmentId}`, result);
                return result;
            }

            logStep(`Shiprocket assign AWB response for shipment ${shipmentId} did not include an AWB code`, result.raw);
            if (result.awb_assign_error || result.message) {
                return result;
            }
        } catch (error) {
            const details = sanitizeError(error);
            const detailsText = typeof details === 'string' ? details : JSON.stringify(details || {});
            const result = {
                awb_code: '',
                courier_name: '',
                message: detailsText,
                awb_assign_error: detailsText,
                status_code: error?.response?.status || null,
                awb_assign_status: null,
                terminal_cancelled: /cancelled state|already cancel|already cancelled|canceled state/i.test(detailsText),
                raw: details
            };

            logError(`POST /courier/assign/awb failed`, error);
            return result;
        }
    }

    return {
        awb_code: '',
        courier_name: '',
        message: '',
        awb_assign_error: '',
        status_code: null,
        awb_assign_status: null,
        raw: null
    };
}

async function generatePickup(shipmentId) {
    if (!shipmentId) return null;

    logStep(`Generating pickup for shipment ${shipmentId}`);
    const token = await getToken();
    if (!token) return null;

    try {
        const response = await axios({
            method: 'post',
            url: `${SHIPROCKET_API}/courier/generate/pickup`,
            data: { shipment_id: [Number(shipmentId)] },
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = response.data || {};
        const result = {
            pickup_scheduled: true,
            pickup_token_number: data.pickup_token_number || '',
            pickup_status: data.message || data.status || 'Pickup Generated'
        };

        logStep(`Pickup response for shipment ${shipmentId}`, result);
        return result;
    } catch (error) {
        const details = sanitizeError(error);
        const detailsText = typeof details === 'string' ? details : JSON.stringify(details || {});
        if (/already cancel/i.test(detailsText) || /already cancelled/i.test(detailsText)) {
            logStep(`Skipping pickup for shipment ${shipmentId} because Shiprocket says the order is already canceled`);
            return {
                pickup_scheduled: false,
                pickup_token_number: '',
                pickup_status: 'Order already canceled',
                pickup_skipped: true
            };
        }

        if (/already in pickup queue/i.test(detailsText) || /pickup queue/i.test(detailsText)) {
            logStep(`Skipping pickup for shipment ${shipmentId} because Shiprocket says it is already in the pickup queue`);
            return {
                pickup_scheduled: true,
                pickup_token_number: '',
                pickup_status: 'Pickup already scheduled',
                pickup_already_scheduled: true,
                raw: details
            };
        }

        logError(`POST /courier/generate/pickup failed`, error);
        return {
            pickup_scheduled: false,
            pickup_token_number: '',
            pickup_status: '',
            pickup_error: detailsText,
            pickup_status_code: error?.response?.status || null,
            raw: details
        };
    }
}

async function trackByAwb(awbCode) {
    if (!awbCode) return null;

    logStep(`Fetching tracking for AWB ${awbCode}`);
    const data = await apiRequest('get', `/courier/track/awb/${encodeURIComponent(awbCode)}`);
    if (!data) return null;

    const result = extractTrackingSummary(data);
    logStep(`Tracking response for AWB ${awbCode}`, {
        shiprocket_status: result.shiprocket_status,
        tracking_status: result.tracking_status,
        latest_activity: result.latest_activity
    });
    return result;
}

async function trackByShipment(shipmentId) {
    if (!shipmentId) return null;

    logStep(`Fetching tracking for shipment ${shipmentId}`);
    const data = await apiRequest('get', `/courier/track/shipment/${encodeURIComponent(shipmentId)}`);
    if (!data) return null;

    const result = extractTrackingSummary(data, {
        shiprocket_shipment_id: shipmentId
    });
    logStep(`Tracking response for shipment ${shipmentId}`, {
        shiprocket_order_id: result.shiprocket_order_id,
        shiprocket_shipment_id: result.shiprocket_shipment_id,
        shiprocket_awb_code: result.shiprocket_awb_code,
        courier_name: result.courier_name,
        tracking_status: result.tracking_status,
        latest_activity: result.latest_activity
    });
    return result;
}

async function getShipmentDetails(shipmentId) {
    if (!shipmentId) return null;

    logStep(`Fetching shipment details for shipment ${shipmentId}`);
    const data = await apiRequest('get', `/shipments/${encodeURIComponent(shipmentId)}`);
    if (!data || typeof data !== 'object') return null;

    const shipment = data.shipping_data?.shipment_data || data.shipment_data || data.data || data;
    const shipmentStatusCode = Number.parseInt(String(shipment?.status || '').trim(), 10);
    const statusLabelFromCode = getShiprocketStatusLabelFromCode(shipmentStatusCode);
    const awbCode = firstNonEmpty(
        shipment?.awb_code,
        shipment?.awb,
        shipment?.awb_data?.awb_code
    );
    const courierName = firstNonEmpty(
        shipment?.courier_name,
        shipment?.courier_company_name,
        shipment?.courier
    );
    const shipmentStatus = firstNonEmpty(
        sanitizeShiprocketStatusValue(shipment?.shipment_status),
        statusLabelFromCode,
        sanitizeShiprocketStatusValue(shipment?.current_status)
    );
    const normalizedStatus = normalizeShiprocketStatus(
        shipmentStatus || shipmentStatusCode,
        firstNonEmpty(
            sanitizeShiprocketStatusValue(shipment?.current_status),
            statusLabelFromCode,
            shipmentStatus
        )
    );
    const createdAt = normalizeShiprocketDatetime(shipment?.created_at);
    const updatedAt = normalizeShiprocketDatetime(shipment?.updated_at);
    const shippedAt = normalizeShiprocketDatetime(shipment?.shipped_date);
    const deliveredAt = normalizeShiprocketDatetime(shipment?.delivered_date);
    const returnedAt = normalizeShiprocketDatetime(shipment?.returned_date);
    const awbAssignedAt = normalizeShiprocketDatetime(shipment?.awb_assign_date);
    const pickupGeneratedAt = normalizeShiprocketDatetime(shipment?.pickup_generated_date);
    const latestActivityAt = updatedAt
        || deliveredAt
        || shippedAt
        || returnedAt
        || pickupGeneratedAt
        || awbAssignedAt
        || createdAt;
    const latestActivity = firstNonEmpty(
        normalizedStatus.user_message,
        normalizedStatus.system_status,
        statusLabelFromCode,
        sanitizeShiprocketStatusValue(shipment?.current_status),
        shipmentStatus
    );

    return {
        shiprocket_order_id: firstNonEmpty(shipment?.order_id),
        shiprocket_shipment_id: firstNonEmpty(shipment?.shipment_id, shipmentId),
        shiprocket_awb_code: awbCode,
        courier_name: courierName,
        shiprocket_status: normalizedStatus.display_status || shipmentStatus || statusLabelFromCode,
        tracking_status: normalizedStatus.display_status || shipmentStatus || statusLabelFromCode,
        display_status: normalizedStatus.display_status || shipmentStatus || statusLabelFromCode,
        system_status: normalizedStatus.system_status,
        user_message: normalizedStatus.user_message,
        latest_activity: latestActivity,
        latest_activity_at: latestActivityAt,
        tracking_payload: shipment
    };
}

async function syncShipment({ shipmentId, awbCode, orderStatus = '' } = {}) {
    if (!shipmentId && !awbCode) return null;

    const result = {
        shiprocket_shipment_id: shipmentId ? String(shipmentId) : '',
        shiprocket_awb_code: awbCode ? String(awbCode) : '',
        shiprocket_courier_name: '',
        shiprocket_status: '',
        shiprocket_tracking_status: '',
        shiprocket_latest_activity: '',
        shiprocket_latest_activity_at: null,
        shiprocket_tracking_json: null,
        shiprocket_pickup_scheduled: false
    };

    let shipmentTracking = null;
    let shipmentDetails = null;

    if (shipmentId) {
        [shipmentTracking, shipmentDetails] = await Promise.all([
            trackByShipment(shipmentId),
            getShipmentDetails(shipmentId)
        ]);

        if (shipmentTracking) {
            result.shiprocket_order_id = shipmentTracking.shiprocket_order_id || result.shiprocket_order_id;
            result.shiprocket_shipment_id = shipmentTracking.shiprocket_shipment_id || result.shiprocket_shipment_id;
            result.shiprocket_awb_code = shipmentTracking.shiprocket_awb_code || result.shiprocket_awb_code;
            result.shiprocket_courier_name = shipmentTracking.courier_name || result.shiprocket_courier_name;
            result.shiprocket_latest_activity = shipmentTracking.latest_activity || result.shiprocket_latest_activity;
            result.shiprocket_latest_activity_at = shipmentTracking.latest_activity_at || result.shiprocket_latest_activity_at;
            result.shiprocket_tracking_json = shipmentTracking.tracking_payload || result.shiprocket_tracking_json;
        }

        if (shipmentDetails) {
            result.shiprocket_order_id = shipmentDetails.shiprocket_order_id || result.shiprocket_order_id;
            result.shiprocket_shipment_id = shipmentDetails.shiprocket_shipment_id || result.shiprocket_shipment_id;
            result.shiprocket_awb_code = shipmentDetails.shiprocket_awb_code || result.shiprocket_awb_code;
            result.shiprocket_courier_name = shipmentDetails.courier_name || result.shiprocket_courier_name;
            result.shiprocket_latest_activity = shipmentDetails.latest_activity || result.shiprocket_latest_activity;
            result.shiprocket_latest_activity_at = shipmentDetails.latest_activity_at || result.shiprocket_latest_activity_at;
            result.shiprocket_tracking_json = result.shiprocket_tracking_json || shipmentDetails.tracking_payload || null;
        }

        const preferredStatus = pickPreferredShiprocketStatus(
            shipmentTracking?.shiprocket_status,
            shipmentTracking?.tracking_status,
            shipmentTracking?.latest_activity,
            shipmentDetails?.shiprocket_status,
            shipmentDetails?.tracking_status,
            shipmentDetails?.latest_activity,
            result.shiprocket_status,
            result.shiprocket_tracking_status
        );

        if (preferredStatus) {
            const normalizedPreferred = normalizeShiprocketStatus(preferredStatus, result.shiprocket_latest_activity);
            result.shiprocket_status = normalizedPreferred.display_status || preferredStatus;
            result.shiprocket_tracking_status = normalizedPreferred.display_status || preferredStatus;
        } else {
            result.shiprocket_status = shipmentTracking?.shiprocket_status || shipmentDetails?.shiprocket_status || result.shiprocket_status;
            result.shiprocket_tracking_status = shipmentTracking?.tracking_status || shipmentDetails?.tracking_status || result.shiprocket_tracking_status;
        }
    }

    const skipTerminalShipmentActions = shouldSkipPickupGeneration({
        orderStatus,
        shiprocketStatus: result.shiprocket_status,
        trackingStatus: result.shiprocket_tracking_status,
        latestActivity: result.shiprocket_latest_activity
    });

    let assignedAwbThisRun = false;

    if (!result.shiprocket_awb_code && shipmentId && !skipTerminalShipmentActions) {
        const awb = await assignAwb(shipmentId);
        if (awb) {
            result.shiprocket_awb_code = awb.awb_code || '';
            result.shiprocket_courier_name = awb.courier_name || '';
            if (awb.terminal_cancelled) {
                // Shiprocket can reject AWB assignment while an order is still
                // being propagated. Keep the local order state unchanged so we
                // don't auto-cancel a prepaid order from a transient sync error.
                result.shiprocket_latest_activity = awb.message || 'AWB assignment rejected';
                result.shiprocket_latest_activity_at = result.shiprocket_latest_activity_at || null;
                logStep(`Skipping further tracking for shipment ${shipmentId} because Shiprocket marked it as cancelled during AWB assignment`);
                return result;
            }
            assignedAwbThisRun = Boolean(result.shiprocket_awb_code);
        }
    } else if (shipmentId && skipTerminalShipmentActions) {
        logStep(`Skipping AWB assignment for shipment ${shipmentId} because Shiprocket says it is already canceled/returned`);
    }

    const skipPickupGeneration = skipTerminalShipmentActions;

    if (shipmentId && assignedAwbThisRun && !skipPickupGeneration) {
        const pickup = await generatePickup(shipmentId);
        if (pickup?.pickup_scheduled) {
            result.shiprocket_pickup_scheduled = true;
            result.shiprocket_status = pickup.pickup_status || result.shiprocket_status;
        }
    } else if (shipmentId && assignedAwbThisRun && skipPickupGeneration) {
        logStep(`Skipping pickup generation for shipment ${shipmentId} because the shipment is already canceled/returned`);
    }

    if (result.shiprocket_awb_code) {
        const tracking = await trackByAwb(result.shiprocket_awb_code);
        if (tracking) {
            result.shiprocket_order_id = tracking.shiprocket_order_id || result.shiprocket_order_id;
            result.shiprocket_shipment_id = tracking.shiprocket_shipment_id || result.shiprocket_shipment_id;
            result.shiprocket_awb_code = tracking.shiprocket_awb_code || result.shiprocket_awb_code;
            result.shiprocket_courier_name = tracking.courier_name || result.shiprocket_courier_name;
            const preferredStatus = pickPreferredShiprocketStatus(
                result.shiprocket_status,
                result.shiprocket_tracking_status,
                tracking.shiprocket_status,
                tracking.tracking_status,
                tracking.latest_activity
            );
            if (preferredStatus) {
                const normalizedPreferred = normalizeShiprocketStatus(preferredStatus, tracking.latest_activity || result.shiprocket_latest_activity);
                result.shiprocket_status = normalizedPreferred.display_status || preferredStatus;
                result.shiprocket_tracking_status = normalizedPreferred.display_status || preferredStatus;
            }
            result.shiprocket_latest_activity = tracking.latest_activity || result.shiprocket_latest_activity || '';
            result.shiprocket_latest_activity_at = tracking.latest_activity_at || result.shiprocket_latest_activity_at || null;
            result.shiprocket_tracking_json = tracking.tracking_payload || result.shiprocket_tracking_json || null;
        }
    } else {
        logStep(`No AWB returned yet for shipment ${shipmentId}`);
    }

    return result;
}

async function createOrder({
    orderId,
    orderReference,
    orderDate,
    customerName,
    customerEmail,
    customerPhone,
    address,
    items,
    totalAmount,
    paymentMethod = 'Prepaid'
}) {
    const token = await getToken();
    if (!token) return null;

    const { pickupLocation, channelId } = getConfig();
    const formattedDate = new Date(orderDate).toISOString().replace('T', ' ').substring(0, 16);
    const orderItems = items.map((item) => ({
        name: item.name,
        sku: item.sku || `PROD-${item.product_id}`,
        units: Number(item.quantity),
        selling_price: parseFloat(item.price),
        discount: 0,
        tax: 0,
        hsn: ''
    }));
    const normalizedOrderReference = String(orderReference || '').trim().replace(/^#/, '') || `NATDEV${String(orderId).padStart(3, '0')}`;
    
    // CRITICAL: Make order_id unique to avoid reusing old/cancelled orders in Shiprocket
    // If we don't include orderId, Shiprocket returns existing (possibly cancelled) orders with same reference
    const uniqueShiprocketOrderId = `${normalizedOrderReference}-${orderId}`;
    
    const payload = {
        order_id: uniqueShiprocketOrderId,  // ✅ UNIQUE: NATDEV001-1, NATDEV001-2, etc.
        order_date: formattedDate,
        pickup_location: pickupLocation,
        comment: `DEVASTHRA Order #${orderId}`,
        billing_customer_name: customerName || 'Customer',
        billing_last_name: '',
        billing_address: address.address_line || '',
        billing_address_2: '',
        billing_city: address.city || '',
        billing_pincode: address.pincode || '',
        billing_state: address.state || '',
        billing_country: 'India',
        billing_email: customerEmail || '',
        billing_phone: customerPhone || '',
        shipping_is_billing: true,
        shipping_customer_name: customerName || 'Customer',
        shipping_last_name: '',
        shipping_address: address.address_line || '',
        shipping_address_2: '',
        shipping_city: address.city || '',
        shipping_pincode: address.pincode || '',
        shipping_state: address.state || '',
        shipping_country: 'India',
        shipping_email: customerEmail || '',
        shipping_phone: customerPhone || '',
        order_items: orderItems,
        payment_method: paymentMethod,
        sub_total: parseFloat(totalAmount),
        length: DEFAULT_PARCEL_DIMENSIONS.length,
        breadth: DEFAULT_PARCEL_DIMENSIONS.breadth,
        height: DEFAULT_PARCEL_DIMENSIONS.height,
        weight: DEFAULT_PARCEL_DIMENSIONS.weight
    };

    if (channelId) {
        payload.channel_id = channelId;
    }

    try {
        logStep(`Creating order for ${normalizedOrderReference}`, {
            unique_shiprocket_order_id: uniqueShiprocketOrderId,
            database_order_id: orderId,
            pickup_location: payload.pickup_location,
            payment_method: payload.payment_method,
            item_count: payload.order_items.length,
            channel_id: payload.channel_id || ''
        });

        const response = await axios.post(`${SHIPROCKET_API}/orders/create/adhoc`, payload, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = response.data || {};
        const result = {
            shiprocket_order_id: String(data.order_id || ''),
            shiprocket_shipment_id: String(data.shipment_id || ''),
            shiprocket_awb_code: '',
            shiprocket_courier_name: '',
            shiprocket_status: sanitizeShiprocketStatusValue(data.status) || 'Created',
            shiprocket_tracking_status: '',
            shiprocket_latest_activity: '',
            shiprocket_latest_activity_at: null,
            shiprocket_tracking_json: null,
            shiprocket_pickup_scheduled: false
        };

        logStep(`✅ Order created successfully`, {
            invoice_reference: normalizedOrderReference,
            unique_shiprocket_id: uniqueShiprocketOrderId,
            db_order_id: orderId,
            sr_order_id: result.shiprocket_order_id,
            sr_shipment_id: result.shiprocket_shipment_id,
            payment_method: paymentMethod,
            status: result.shiprocket_status
        });

        // CRITICAL VALIDATION: Check if returned order is in a cancelled/terminal state
        // This would indicate Shiprocket returned an old order instead of creating new one
        const statusLower = String(result.shiprocket_status || '').toLowerCase();
        if (statusLower.includes('cancel') || statusLower.includes('rto') || statusLower.includes('return')) {
            logError(`⚠️ WARNING: Newly created order is already in terminal state: ${result.shiprocket_status}. This might be an old order being returned instead of a new one.`, {
                unique_id: uniqueShiprocketOrderId,
                status: result.shiprocket_status
            });
            // Still return it but log the warning - Shiprocket might be having issues
        }

        // DON'T sync immediately for COD - Shiprocket needs time to process the order
        // Syncing too fast retrieves old/stale/cached shipment data
        // Only sync if it's a Prepaid order and we have a shipment ID
        if (paymentMethod === 'Prepaid' && result.shiprocket_shipment_id) {
            // For Prepaid: wait a moment to let Shiprocket process, then sync
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const syncResult = await syncShipment({ shipmentId: result.shiprocket_shipment_id });
            if (syncResult) {
                result.shiprocket_awb_code = syncResult.shiprocket_awb_code || '';
                result.shiprocket_courier_name = syncResult.shiprocket_courier_name || '';
                // For Prepaid, prefer the sync result as it's more up-to-date
                result.shiprocket_status = syncResult.shiprocket_status || result.shiprocket_status;
                result.shiprocket_tracking_status = syncResult.shiprocket_tracking_status || '';
                result.shiprocket_latest_activity = syncResult.shiprocket_latest_activity || '';
                result.shiprocket_latest_activity_at = syncResult.shiprocket_latest_activity_at || null;
                result.shiprocket_tracking_json = syncResult.shiprocket_tracking_json || null;
                result.shiprocket_pickup_scheduled = Boolean(syncResult.shiprocket_pickup_scheduled);
            }
        } else if (paymentMethod === 'COD') {
            // For COD: DON'T sync immediately - return the fresh creation response
            // Syncing too fast gets old/cancelled/stale data
            logStep(`COD order created - skipping immediate sync to avoid stale data`);
            result.shiprocket_status = 'Pending';
            result.shiprocket_latest_activity = 'Order Created';
        }

        return result;
    } catch (error) {
        logError('Order creation failed', error);
        return null;
    }
}

async function cancelOrder(shiprocketOrderIds) {
    if (!shiprocketOrderIds || !shiprocketOrderIds.length) return null;

    const ids = shiprocketOrderIds.map(Number).filter(Boolean);
    if (!ids.length) return null;

    logStep(`Cancelling Shiprocket orders: ${ids.join(', ')}`);
    const data = await apiRequest('post', '/orders/cancel', {
        data: { ids }
    });

    if (!data) return null;

    logStep('Cancel response', data);
    return {
        success: true,
        response: data
    };
}

async function cancelShipmentByAwbs(awbs) {
    if (!Array.isArray(awbs) || !awbs.length) return null;

    const normalizedAwbs = awbs.map((awb) => String(awb || '').trim()).filter(Boolean);
    if (!normalizedAwbs.length) return null;

    logStep(`Cancelling Shiprocket shipments by AWB: ${normalizedAwbs.join(', ')}`);
    const data = await apiRequest('post', '/orders/cancel/shipment/awbs', {
        data: { awbs: normalizedAwbs }
    });

    if (!data) return null;

    logStep('Cancel shipment by AWB response', data);
    return {
        success: true,
        response: data
    };
}

async function createReturnOrder({
    orderId,
    orderDate,
    customerName,
    customerEmail,
    customerPhone,
    address,
    items,
    totalAmount,
    paymentMethod = 'Prepaid'
}) {
    const token = await getToken();
    if (!token) return null;

    const { pickupLocation, channelId } = getConfig();
    const formattedDate = new Date(orderDate).toISOString().replace('T', ' ').substring(0, 16);
    const pickupCustomerName = firstNonEmpty(customerName, 'Customer');
    const pickupAddress = firstNonEmpty(address?.address_line, '');
    const pickupCity = firstNonEmpty(address?.city, '');
    const pickupState = firstNonEmpty(address?.state, '');
    const pickupCountry = 'India';
    const pickupPhone = firstNonEmpty(customerPhone, '');
    const pickupPincode = firstNonEmpty(address?.pincode, '');

    const orderItems = items.map(item => ({
        name: item.name,
        sku: item.sku || `PROD-${item.product_id}`,
        units: Number(item.quantity),
        selling_price: parseFloat(item.price),
        discount: 0,
        tax: 0,
        hsn: ''
    }));

    const payload = {
        order_id: `DVST-RET-${orderId}`,
        order_date: formattedDate,
        pickup_location: pickupLocation,
        comment: `Return for DEVASTHRA Order #${orderId}`,
        pickup_customer_name: pickupCustomerName,
        pickup_last_name: '',
        pickup_address: pickupAddress,
        pickup_address_2: '',
        pickup_city: pickupCity,
        pickup_state: pickupState,
        pickup_country: pickupCountry,
        pickup_phone: pickupPhone,
        pickup_pincode: pickupPincode,
        billing_customer_name: customerName || 'Customer',
        billing_last_name: '',
        billing_address: address.address_line || '',
        billing_address_2: '',
        billing_city: address.city || '',
        billing_pincode: address.pincode || '',
        billing_state: address.state || '',
        billing_country: 'India',
        billing_email: customerEmail || '',
        billing_phone: customerPhone || '',
        shipping_is_billing: true,
        shipping_customer_name: customerName || 'Customer',
        shipping_last_name: '',
        shipping_address: address.address_line || '',
        shipping_address_2: '',
        shipping_city: address.city || '',
        shipping_pincode: address.pincode || '',
        shipping_state: address.state || '',
        shipping_country: 'India',
        shipping_email: customerEmail || '',
        shipping_phone: customerPhone || '',
        order_items: orderItems,
        payment_method: paymentMethod,
        sub_total: parseFloat(totalAmount),
        length: DEFAULT_PARCEL_DIMENSIONS.length,
        breadth: DEFAULT_PARCEL_DIMENSIONS.breadth,
        height: DEFAULT_PARCEL_DIMENSIONS.height,
        weight: DEFAULT_PARCEL_DIMENSIONS.weight
    };

    if (channelId) payload.channel_id = channelId;

    try {
        logStep(`Creating return order for DVST-RET-${orderId}`);
        const response = await axios.post(`${SHIPROCKET_API}/orders/create/return`, payload, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = response.data || {};
        logStep(`Return order created. Order ID: ${data.order_id}, Shipment ID: ${data.shipment_id}`);

        return {
            shiprocket_return_order_id: String(data.order_id || ''),
            shiprocket_return_shipment_id: String(data.shipment_id || ''),
            status: data.status || 'Return Created'
        };
    } catch (error) {
        logError('Return order creation failed', error);
        return null;
    }
}

async function createExchangeOrder({
    exchangeRequestId,
    orderId,
    orderDate,
    existingOrderId,
    customer,
    seller,
    item,
    requestedSize,
    reasonDetail = '',
    subTotal,
    paymentMethod = 'Prepaid'
}) {
    const token = await getToken();
    if (!token) return null;

    const {
        channelId,
        sellerPickupLocationId,
        sellerShippingLocationId,
        exchangeReturnReasonCode
    } = getConfig();

    if (!sellerPickupLocationId || !sellerShippingLocationId) {
        logStep('Seller pickup/shipping location ids are not configured for Shiprocket exchange flow');
        return null;
    }

    if (!channelId) {
        logStep('SHIPROCKET_CHANNEL_ID is required for Shiprocket exchange flow');
        return null;
    }

    const formattedDate = new Date(orderDate).toISOString().split('T')[0];
    const exchangeOrderId = `EX_${orderId}_${exchangeRequestId}`;
    const returnOrderId = `RET_${orderId}_${exchangeRequestId}`;

    const payload = {
        order_items: [
            {
                name: item.name,
                selling_price: String(item.price),
                units: String(item.quantity || 1),
                hsn: item.hsn || '',
                sku: item.sku || `PROD-${item.product_id}`,
                tax: '',
                discount: '',
                brand: item.brand || '',
                color: item.color || '',
                exchange_item_id: String(item.order_item_id || item.product_id || ''),
                exchange_item_name: item.name,
                exchange_item_sku: item.sku || `PROD-${item.product_id}`,
                qc_enable: true,
                qc_product_name: item.name,
                qc_product_image: item.image_url || '',
                qc_brand: item.brand || '',
                qc_color: item.color || '',
                qc_size: requestedSize || item.size || '',
                accessories: '',
                qc_used_check: '1',
                qc_sealtag_check: '1',
                qc_brand_box: '1',
                qc_check_damaged_product: reasonDetail || 'exchange requested'
            }
        ],
        buyer_pickup_first_name: customer.first_name || customer.name || 'Customer',
        buyer_pickup_last_name: customer.last_name || '',
        buyer_pickup_email: customer.email || '',
        buyer_pickup_address: customer.address_line || '',
        buyer_pickup_address_2: '',
        buyer_pickup_city: customer.city || '',
        buyer_pickup_state: customer.state || '',
        buyer_pickup_country: 'India',
        buyer_pickup_phone: customer.phone || '',
        buyer_pickup_pincode: String(customer.pincode || ''),
        buyer_shipping_first_name: customer.first_name || customer.name || 'Customer',
        buyer_shipping_last_name: customer.last_name || '',
        buyer_shipping_email: customer.email || '',
        buyer_shipping_address: customer.address_line || '',
        buyer_shipping_address_2: '',
        buyer_shipping_city: customer.city || '',
        buyer_shipping_state: customer.state || '',
        buyer_shipping_country: 'India',
        buyer_shipping_phone: customer.phone || '',
        buyer_shipping_pincode: String(customer.pincode || ''),
        seller_pickup_location_id: String(sellerPickupLocationId),
        seller_shipping_location_id: String(sellerShippingLocationId),
        exchange_order_id: exchangeOrderId,
        return_order_id: returnOrderId,
        payment_method: String(paymentMethod || 'Prepaid').toLowerCase(),
        order_date: formattedDate,
        channel_id: String(channelId),
        existing_order_id: String(existingOrderId || ''),
        return_reason: String(exchangeReturnReasonCode || '29'),
        sub_total: String(subTotal || item.price || 0),
        shipping_charges: '',
        giftwrap_charges: '',
        total_discount: '0',
        transaction_charges: '',
        exchange_length: String(DEFAULT_PARCEL_DIMENSIONS.length),
        exchange_breadth: String(DEFAULT_PARCEL_DIMENSIONS.breadth),
        exchange_height: String(DEFAULT_PARCEL_DIMENSIONS.height),
        exchange_weight: String(DEFAULT_PARCEL_DIMENSIONS.weight),
        return_length: String(DEFAULT_PARCEL_DIMENSIONS.length),
        return_breadth: String(DEFAULT_PARCEL_DIMENSIONS.breadth),
        return_height: String(DEFAULT_PARCEL_DIMENSIONS.height),
        return_weight: String(DEFAULT_PARCEL_DIMENSIONS.weight),
        qc_check: 'true'
    };

    try {
        logStep(`Creating exchange order ${exchangeOrderId} for order ${orderId}`);
        const response = await axios.post(`${SHIPROCKET_API}/orders/create/exchange`, payload, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = response.data || {};
        logStep(`Exchange order created for ${exchangeOrderId}`, data);

        return {
            shiprocket_exchange_order_id: firstNonEmpty(
                data.exchange_order_id,
                data.order_id,
                exchangeOrderId
            ),
            shiprocket_exchange_shipment_id: firstNonEmpty(
                data.exchange_shipment_id,
                data.shipment_id
            ),
            shiprocket_return_order_id: firstNonEmpty(
                data.return_order_id,
                returnOrderId
            ),
            status: firstNonEmpty(data.status, 'Exchange Created'),
            response: data
        };
    } catch (error) {
        logError('Exchange order creation failed', error);
        return null;
    }
}

module.exports = {
    getToken,
    createOrder,
    cancelOrder,
    cancelShipmentByAwbs,
    createReturnOrder,
    createExchangeOrder,
    assignAwb,
    generatePickup,
    trackByAwb,
    trackByShipment,
    getShipmentDetails,
    syncShipment,
    extractTrackingSummary,
    normalizeShiprocketStatus
};

