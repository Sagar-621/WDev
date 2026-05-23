require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_URL = process.env.FRONTEND_URL || '';

// ── Security Headers ──
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false
}));

// ── Gzip Compression ──
app.use(compression());

// ── CORS ──
app.use(cors({
    origin: function (origin, callback) {

        if (!origin) return callback(null, true);

        const allowed = [
            /^http:\/\/localhost/,
            /^http:\/\/127\.0\.0\.1/,
            /^http:\/\/192\.168\./,
            /^null$/
        ];

        if (FRONTEND_URL) {
            FRONTEND_URL.split(',').forEach(url => {
                const trimmed = url.trim().replace(/\/$/, '');
                if (trimmed) {
                    allowed.push(new RegExp('^' + trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
                }
            });
        }

        const isAllowed = allowed.some(pattern => pattern.test(origin));

        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS blocked origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Trust proxy ──
app.set('trust proxy', 1);

// ── Body Parsers ──
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Serve uploaded product images ──
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '1d',
    setHeaders: (res, path, stat) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

// ── Serve product images ──
app.use('/backend/images', express.static(path.join(__dirname, 'images'), {
    maxAge: '30d',
    setHeaders: (res, path, stat) => {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
}));

// ── Serve product catalog images ──
app.use('/images/Btshirt-catalog', express.static(path.join(__dirname, '..', 'Btshirt-catalog'), {
    maxAge: '30d',
    setHeaders: (res, path, stat) => {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
}));

app.use('/images/PLBTshirt-catalog', express.static(path.join(__dirname, '..', 'PLBTshirt-catalog'), {
    maxAge: '30d',
    setHeaders: (res, path, stat) => {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
}));

// ── Routes ──
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);
app.use('/api', authRoutes);
const { ensureBannerTable, getBanners } = require('./utils/banners');

// Public Taxonomy Route (Defined explicitly for both paths)
const taxonomyHandler = async (req, res) => {
    try {
        const db = require('./db');
        const { fetchCatalogTaxonomy, flattenCatalogTaxonomy } = require('./utils/catalogTaxonomy');
        const structuredTaxonomy = await fetchCatalogTaxonomy(db, { includeInactive: true });
        const taxonomy = flattenCatalogTaxonomy(structuredTaxonomy);
        res.json({ success: true, taxonomy, structuredTaxonomy });
    } catch (err) {
        console.error('Public taxonomy fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch taxonomy' });
    }
};

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

function readPublicPolicy(rows, keyPrefix, defaultTitle) {
    const settings = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value || '']));
    return {
        title: settings[`${keyPrefix}_title`] || defaultTitle,
        last_updated: settings[`${keyPrefix}_last_updated`] || '',
        content: normalizePolicyText(settings[`${keyPrefix}_content`] || ''),
        document_url: settings[`${keyPrefix}_document_url`] || ''
    };
}

function normalizeBooleanSetting(value) {
    return value !== '0' && value !== 'false' && value !== 0 && value !== false;
}

async function getPublicStoreConfig(db) {
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('cod_enabled', 'min_order_value', 'cod_min_order_value', 'shipping_charge', 'maintenance_enabled', 'maintenance_message', 'maintenance_expected_back_at')`
    );
    const settings = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value || '']));

    return {
        cod_enabled: normalizeBooleanSetting(settings.cod_enabled),
        min_order_value: Number(settings.min_order_value) || 0,
        cod_min_order_value: Number(settings.cod_min_order_value) || 0,
        shipping_charge: Number(settings.shipping_charge) || 0,
        maintenance_enabled: normalizeBooleanSetting(settings.maintenance_enabled),
        maintenance_message: settings.maintenance_message || '',
        maintenance_expected_back_at: settings.maintenance_expected_back_at || ''
    };
}

app.get(['/banners', '/api/banners'], async (req, res) => {
    try {
        const db = require('./db');
        await ensureBannerTable(db);
        const allowedBannerSlots = new Set(['hero_slide_1', 'hero_slide_2', 'hero_slide_3', 'offer_strip', 'festive_drop', 'corner_popup_left', 'corner_popup_right']);
        const banners = (await getBanners(db, { includeInactive: false }))
            .filter((banner) => allowedBannerSlots.has(banner.slot_key));
        res.json({ success: true, banners });
    } catch (err) {
        console.error('Public banner fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch banners' });
    }
});

app.get('/api/policies/privacy', async (req, res) => {
    try {
        const db = require('./db');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value
             FROM system_settings
             WHERE setting_key IN ('privacy_policy_title', 'privacy_policy_last_updated', 'privacy_policy_content', 'privacy_policy_document_url')`
        );
        res.json({ success: true, policy: readPublicPolicy(rows, 'privacy_policy', 'Privacy Policy') });
    } catch (err) {
        console.error('Public privacy policy fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch privacy policy' });
    }
});

app.get('/api/policies/terms', async (req, res) => {
    try {
        const db = require('./db');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value
             FROM system_settings
             WHERE setting_key IN ('terms_of_service_title', 'terms_of_service_last_updated', 'terms_of_service_content', 'terms_of_service_document_url')`
        );
        res.json({ success: true, policy: readPublicPolicy(rows, 'terms_of_service', 'Terms of Service') });
    } catch (err) {
        console.error('Public terms of service fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch terms of service' });
    }
});

app.get('/api/policies/refund-replacement', async (req, res) => {
    try {
        const db = require('./db');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value
             FROM system_settings
             WHERE setting_key IN ('refund_replacement_policy_title', 'refund_replacement_policy_last_updated', 'refund_replacement_policy_content', 'refund_replacement_policy_document_url')`
        );
        res.json({ success: true, policy: readPublicPolicy(rows, 'refund_replacement_policy', 'Refund and Replacement Policy') });
    } catch (err) {
        console.error('Public refund and replacement policy fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch refund and replacement policy' });
    }
});

app.get('/api/policies/exchange', async (req, res) => {
    try {
        const db = require('./db');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value
             FROM system_settings
             WHERE setting_key IN ('exchange_policy_title', 'exchange_policy_last_updated', 'exchange_policy_content', 'exchange_policy_document_url')`
        );
        res.json({ success: true, policy: readPublicPolicy(rows, 'exchange_policy', 'Exchange Policy') });
    } catch (err) {
        console.error('Public exchange policy fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch exchange policy' });
    }
});

app.get('/api/policies/shipping', async (req, res) => {
    try {
        const db = require('./db');
        const [rows] = await db.execute(
            `SELECT setting_key, setting_value
             FROM system_settings
             WHERE setting_key IN ('shipping_policy_title', 'shipping_policy_last_updated', 'shipping_policy_content', 'shipping_policy_document_url')`
        );
        res.json({ success: true, policy: readPublicPolicy(rows, 'shipping_policy', 'Shipping Policy') });
    } catch (err) {
        console.error('Public shipping policy fetch error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch shipping policy' });
    }
});

app.get('/api/store-config', async (req, res) => {
    try {
        const db = require('./db');
        const settings = await getPublicStoreConfig(db);
        res.json({
            success: true,
            ...settings
        });
    } catch (err) {
        console.error('Public store-config error:', err);
        res.json({
            success: true,
            cod_enabled: true,
            min_order_value: 0,
            cod_min_order_value: 0,
            shipping_charge: 0,
            maintenance_enabled: false,
            maintenance_message: '',
            maintenance_expected_back_at: ''
        });
    }
});

app.get(['/site-status', '/api/site-status'], async (req, res) => {
    try {
        const db = require('./db');
        const settings = await getPublicStoreConfig(db);
        res.json({
            success: true,
            site_status: settings
        });
    } catch (err) {
        console.error('Public site-status error:', err);
        res.json({
            success: true,
            site_status: {
                cod_enabled: true,
                min_order_value: 0,
                cod_min_order_value: 0,
                shipping_charge: 0,
                maintenance_enabled: false,
                maintenance_message: '',
                maintenance_expected_back_at: ''
            }
        });
    }
});

app.use(async (req, res, next) => {
    const pathName = String(req.path || '').toLowerCase();
    const method = String(req.method || 'GET').toUpperCase();

    const maintenanceExempt =
        pathName.startsWith('/admin') ||
        pathName.startsWith('/api/admin') ||
        pathName.startsWith('/api/site-status') ||
        pathName.startsWith('/site-status') ||
        pathName.startsWith('/api/store-config') ||
        pathName.startsWith('/api/config') ||
        pathName.startsWith('/backend/images') ||
        pathName.startsWith('/images') ||
        pathName.startsWith('/uploads') ||
        pathName === '/runtime-env.js' ||
        pathName === '/maintenance.html';

    if (maintenanceExempt) return next();

    try {
        const db = require('./db');
        const status = await getPublicStoreConfig(db);
        if (!status.maintenance_enabled) return next();

        if (method !== 'GET' && method !== 'HEAD') {
            return res.status(503).json({
                success: false,
                message: 'Website is under maintenance',
                site_status: status
            });
        }

        const accept = String(req.headers.accept || '').toLowerCase();
        if (accept.includes('text/html')) {
            return res.status(503).sendFile(path.join(__dirname, '..', 'maintenance.html'));
        }

        if (pathName.startsWith('/api/')) {
            return res.status(503).json({
                success: false,
                message: 'Website is under maintenance',
                site_status: status
            });
        }

        return next();
    } catch (err) {
        console.error('Maintenance gate error:', err);
        return next();
    }
});

// Ensure taxonomy routes are registered BEFORE generic product routes
app.get(['/products/taxonomy', '/api/products/taxonomy'], taxonomyHandler);

app.use('/products', require('./routes/products'));
app.use('/api/products', require('./routes/products'));

app.use('/', require('./routes/cart'));
app.use('/', require('./routes/address'));
app.use('/', require('./routes/orders'));
app.use('/api', require('./routes/orders'));
app.use('/returns', require('./routes/returns'));
app.use('/admin', require('./routes/admin'));
app.use('/user', require('./routes/user'));
app.use('/', require('./routes/support'));
app.use('/', require('./routes/coupons'));

app.use('/upload', require('./routes/upload'));
app.use('/api/config', require('./routes/config'));

// ── Reviews ──
let reviewsRouter = null;
try {
    reviewsRouter = require('./routes/reviews');
} catch (err) {
    console.error('Failed to load reviews routes:', err.message);
}
if (reviewsRouter) {
    app.use('/reviews', reviewsRouter);
    app.use('/api/reviews', reviewsRouter);
    // Public review routes: GET /api/products/:id/reviews, GET /api/products/:id/rating-summary
    app.use('/api', reviewsRouter);
}

const { bootstrapMailerRuntimeConfig } = require('./services/mailer');
bootstrapMailerRuntimeConfig().catch((err) => {
    console.error('Failed to bootstrap mailer runtime config:', err.message);
});

// Explicitly handle 404s for API routes to prevent them from falling back to the HTML app.
// This must be after all other API routes but BEFORE the static file serving.
app.use(/^\/api\//, (req, res) => {
    res.status(404).json({
        success: false,
        message: `API endpoint not found: ${req.method} ${req.originalUrl}`
    });
});

// Serve the sitemap directly so it is not swallowed by express.static's HTML fallback.
app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'sitemap.xml'));
});

app.use(express.static(path.join(__dirname, '..'), {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
        if (/\.(css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ── Health Check ──
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        message: 'DEVASTHRA API is running 🚀'
    });
});

// ── 404 Handler ──
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`
    });
});

// ── Error Handler ──
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// ── Start Server ──
app.listen(PORT, '0.0.0.0', () => {

    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log(`║  DEVASTHRA API running on port ${PORT}  ║`);
    console.log(`║  Environment: ${NODE_ENV.padEnd(21)}║`);
    console.log(`║  API Routes: /api/products active    ║`);
    console.log('╚══════════════════════════════════════╝');

    if (NODE_ENV !== 'production') {

        console.log('');
        console.log('📋 Available endpoints:');
        console.log('  POST /send-login-code');
        console.log('  POST /verify-login-code');
        console.log('  GET  /products');
        console.log('  GET  /products/:id');
        console.log('  POST /add-to-cart  [auth]');
        console.log('  GET  /cart         [auth]');
        console.log('  DELETE /cart/:id   [auth]');
        console.log('  POST /save-address [auth]');
        console.log('  GET  /addresses    [auth]');
        console.log('  POST /create-order [auth]');
        console.log('  ALL  /api/payu/callback');
        console.log('  POST /admin/login');
        console.log('  GET  /admin/orders [admin]');
        console.log('  GET  /api/products');
        console.log('  GET  /api/products/taxonomy');
        console.log('  PUT  /admin/order-status [admin]');
    }

    console.log('');
});

module.exports = app;
