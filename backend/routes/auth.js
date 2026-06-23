const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const { sendLoginCodeEmail } = require('../services/mailer');
const { normalizeIndianMobile, sendManagedOtp, verifyManagedOtp } = require('../services/sms');

let emailAuthSchemaReady = false;
const mobileOtpStore = new Map();
const mobileOtpSendLocks = new Map();
const MOBILE_OTP_RESEND_COOLDOWN_MS = 45 * 1000;

async function ensureEmailAuthSchema() {
    if (emailAuthSchemaReady) return;

    await db.execute(`
        CREATE TABLE IF NOT EXISTS email_verification (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            code VARCHAR(10) NOT NULL,
            expires_at DATETIME NOT NULL,
            verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_email_verification_email (email)
        )
    `);

    await db.execute(`
        ALTER TABLE users
        MODIFY COLUMN mobile_number VARCHAR(15) NULL
    `);

    emailAuthSchemaReady = true;
}

async function logAudit(req, { actorType, actorId, action, entityType, entityId, description }) {
    try {
        const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '';
        const ua = req.headers['user-agent'] || '';
        const adminId = actorType === 'admin' ? actorId : null;
        const userId = actorType === 'user' ? actorId : null;

        await db.execute(
            `INSERT INTO audit_logs (admin_id, user_id, action, entity_type, entity_id, description, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [adminId, userId, action, entityType, entityId || null, description || null, ip, ua.substring(0, 500)]
        );
    } catch (err) {
        console.error('Auth audit log error:', err.message);
    }
}

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeMobile(value) {
    return normalizeIndianMobile(value);
}

function mobilesMatch(storedValue, inputValue) {
    const stored = normalizeMobile(storedValue);
    const input = normalizeMobile(inputValue);
    if (!stored || !input) return false;
    return stored === input;
}

function normalizedDbMobileExpr() {
    return `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(mobile_number), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')`;
}

async function findExistingLoginUser({ mobile = '', email = '' } = {}) {
    const normalizedMobile = normalizeMobile(mobile);
    const normalizedEmail = normalizeEmail(email);

    const candidates = [
        {
            sql: `
                SELECT id, name, email, gender, mobile_number, dob
                FROM users
                WHERE (? <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '[^0-9]', ''), 10) = ?)
                   OR (? <> '' AND LOWER(TRIM(email)) = ?)
                LIMIT 1
            `,
            params: [normalizedMobile, normalizedMobile, normalizedEmail, normalizedEmail]
        },
        {
            sql: `
                SELECT id, name, email, gender, mobile_number, dob
                FROM users
                WHERE (? <> '' AND mobile_number = ?)
                   OR (? <> '' AND LOWER(TRIM(email)) = ?)
                LIMIT 1
            `,
            params: [normalizedMobile, normalizedMobile, normalizedEmail, normalizedEmail]
        },
        {
            sql: `
                SELECT id, name, email, gender, mobile_number, dob
                FROM users
                WHERE (? <> '' AND mobile_number LIKE ?)
                   OR (? <> '' AND LOWER(TRIM(email)) = ?)
                LIMIT 1
            `,
            params: [normalizedMobile, `%${normalizedMobile}%`, normalizedEmail, normalizedEmail]
        }
    ];

    for (const candidate of candidates) {
        try {
            const [rows] = await db.execute(candidate.sql, candidate.params);
            if (!rows.length) continue;
            const row = rows[0];
            if (normalizedMobile && mobilesMatch(row.mobile_number, normalizedMobile)) {
                return row;
            }
            if (normalizedEmail && normalizeEmail(row.email) === normalizedEmail) {
                return row;
            }
        } catch (err) {
            const message = String(err?.message || '');
            if (/regexp_replace|function .* does not exist|unknown function/i.test(message)) {
                continue;
            }
            throw err;
        }
    }

    return null;
}

function isValidEmailAddress(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeDob(value) {
    const dob = String(value || '').trim();
    if (!dob) return '';
    const match = dob.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;
    const dateOnly = match[1];

    const [year, month, day] = dateOnly.split('-').map(Number);
    if (year < 1900 || year > new Date().getFullYear()) return null;

    const parsed = new Date(`${dateOnly}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;

    const isSameDate =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day;

    if (!isSameDate) return null;

    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (parsed.getTime() > todayUtc) return null;

    return dateOnly;
}

function buildMobileOtpResponse(existingUser, mobile) {
    return {
        success: true,
        message: 'OTP sent successfully',
        dev: false,
        isNewUser: !existingUser,
        user: existingUser ? {
            id: existingUser.id,
            email: existingUser.email || '',
            name: existingUser.name || '',
            gender: existingUser.gender || '',
            mobile_number: existingUser.mobile_number || mobile,
            dob: normalizeDob(existingUser.dob) || ''
        } : null
    };
}

async function lookupMobileOtpUser(mobile, email) {
    const existingUser = await findExistingLoginUser({ mobile, email });
    console.log(
        `[USER AUTH] Mobile OTP lookup for ${mobile}${email ? ` / ${email}` : ''}: ` +
        (existingUser
            ? `existing user found (userId=${existingUser.id}, matchedMobile=${existingUser.mobile_number || ''}, matchedEmail=${existingUser.email || ''})`
            : 'no match found, treat as new user')
    );
    return existingUser;
}

async function sendEmailCode(email, code) {
    return sendLoginCodeEmail(email, code);
}

async function sendMobileCode(mobile, code) {
    return sendManagedOtp({ mobile, otp: code });
}

/*
 * Legacy mobile OTP flow note:
 * The old 2Factor SMS OTP login remains available in git history and can be restored later.
 * Current live auth flow uses Gmail + App Password verification codes instead.
 */

router.post('/send-login-code', async (req, res) => {
    const email = normalizeEmail(req.body.email);

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    try {
        await ensureEmailAuthSchema();

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await db.execute('DELETE FROM email_verification WHERE email = ?', [email]);
        const emailResult = await sendEmailCode(email, code);

        if (emailResult.dev) {
            return res.status(503).json({
                success: false,
                message: 'Login OTP was not sent to this email address because email delivery is not configured right now.'
            });
        }

        await db.execute(
            'INSERT INTO email_verification (email, code, expires_at) VALUES (?, ?, ?)',
            [email, code, expiresAt]
        );

        const [existingUsers] = await db.execute(
            'SELECT id, name, email, gender, mobile_number, dob FROM users WHERE LOWER(email) = ? LIMIT 1',
            [email]
        );

        const existingUser = existingUsers[0] || null;

        res.json({
            success: true,
            message: 'Verification code sent successfully',
            dev: false,
            isNewUser: !existingUser,
            user: existingUser ? {
                id: existingUser.id,
                email: existingUser.email,
                name: existingUser.name,
                gender: existingUser.gender,
                mobile_number: existingUser.mobile_number || '',
                dob: normalizeDob(existingUser.dob) || ''
            } : null
        });
    } catch (err) {
        console.error('send-login-code error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to send verification code' });
    }
});

router.post('/verify-login-code', async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || req.body.otp || '').trim();
    const name = String(req.body.name || '').trim();
    const mobile = String(req.body.mobile || req.body.mobile_number || '').trim();
    const dob = String(req.body.dob || '').trim();
    const gender = String(req.body.gender || '').trim();
    const normalizedDob = normalizeDob(dob);

    if (!isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    if (!code) {
        return res.status(400).json({ success: false, message: 'Email and verification code are required' });
    }

    try {
        await ensureEmailAuthSchema();

        const [rows] = await db.execute(
            `SELECT *
             FROM email_verification
             WHERE email = ? AND code = ? AND verified = FALSE AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [email, code]
        );

        if (!rows.length) {
            return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
        }

        if (dob && normalizedDob === null) {
            return res.status(400).json({ success: false, message: 'Please enter a valid date of birth' });
        }

        if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit phone number' });
        }
        if (gender && !['Male', 'Female', 'Others'].includes(gender)) {
            return res.status(400).json({ success: false, message: 'Please select a valid gender' });
        }

        await db.execute('UPDATE email_verification SET verified = TRUE WHERE id = ?', [rows[0].id]);

        let [users] = await db.execute('SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);

        let userId;
        let userName = '';

        if (!users.length) {
            if (mobile) {
                const [mobileUsers] = await db.execute(
                    'SELECT id FROM users WHERE mobile_number = ? LIMIT 1',
                    [mobile]
                );
                if (mobileUsers.length) {
                    return res.status(400).json({ success: false, message: 'This phone number is already linked to another account' });
                }
            }
            if (!name || !email || !mobile || !dob || normalizedDob === null || !gender) {
                return res.status(400).json({
                    success: false,
                    message: 'Please complete your signup details to continue'
                });
            }

            const [result] = await db.execute(
                'INSERT INTO users (mobile_number, name, email, dob, gender) VALUES (?, ?, ?, ?, ?)',
                [mobile || null, name || null, email, normalizedDob || null, gender || null]
            );
            userId = result.insertId;
            userName = name || '';
        } else {
            userId = users[0].id;
            if (mobile && mobile !== (users[0].mobile_number || '')) {
                const [mobileUsers] = await db.execute(
                    'SELECT id FROM users WHERE mobile_number = ? AND id <> ? LIMIT 1',
                    [mobile, userId]
                );
                if (mobileUsers.length) {
                    return res.status(400).json({ success: false, message: 'This phone number is already linked to another account' });
                }
            }
            await db.execute(
                `UPDATE users
                 SET name = COALESCE(NULLIF(?, ''), name),
                     email = COALESCE(NULLIF(?, ''), email),
                     mobile_number = COALESCE(NULLIF(?, ''), mobile_number),
                     dob = COALESCE(NULLIF(?, ''), dob),
                     gender = COALESCE(NULLIF(?, ''), gender)
                 WHERE id = ?`,
                [name, email, mobile, normalizedDob || '', gender, userId]
            );

            [users] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
            userName = users[0]?.name || '';
        }

        const token = jwt.sign(
            { userId, email, role: 'user' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            userId,
            email,
            name: userName,
            mobile: users[0]?.mobile_number || mobile || '',
            dob: normalizeDob(users[0]?.dob) || normalizedDob || '',
            gender: users[0]?.gender || gender || ''
        });

        logAudit(req, {
            actorType: 'user',
            actorId: userId,
            action: 'LOGIN',
            entityType: 'user',
            entityId: userId,
            description: `User ${email} logged in via email code`
        });
    } catch (err) {
        console.error('verify-login-code error:', err);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

router.post('/send-mobile-login-otp', async (req, res) => {
    const mobile = normalizeMobile(req.body.mobile || req.body.mobile_number);
    const email = normalizeEmail(req.body.email);

    if (!/^[6-9]\d{9}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit phone number' });
    }

    if (email && !isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    try {
        await ensureEmailAuthSchema();

        const now = Date.now();
        const existingOtp = mobileOtpStore.get(mobile);
        if (
            existingOtp?.sessionId &&
            existingOtp.expiresAt > now &&
            now - Number(existingOtp.sentAt || 0) < MOBILE_OTP_RESEND_COOLDOWN_MS
        ) {
            console.log(`[USER OTP] Reusing active OTP session for ${mobile}; duplicate send suppressed`);
            const existingUser = await lookupMobileOtpUser(mobile, email);
            return res.json(buildMobileOtpResponse(existingUser, mobile));
        }

        if (mobileOtpSendLocks.has(mobile)) {
            console.log(`[USER OTP] Joining in-flight OTP request for ${mobile}; duplicate send suppressed`);
            const existingUser = await mobileOtpSendLocks.get(mobile);
            return res.json(buildMobileOtpResponse(existingUser, mobile));
        }

        const sendOtpPromise = (async () => {
            const code = generateCode();
            console.log(`[USER OTP] Requesting 2Factor OTP for ${mobile} using configured template`);
            const otpResult = await sendMobileCode(mobile, code);
            mobileOtpStore.set(mobile, {
                sessionId: otpResult.sessionId || '',
                expiresAt: Date.now() + 10 * 60 * 1000,
                sentAt: Date.now()
            });
            console.log(`[USER OTP] 2Factor OTP session created for ${mobile}`);
            return lookupMobileOtpUser(mobile, email);
        })();

        mobileOtpSendLocks.set(mobile, sendOtpPromise);

        try {
            const existingUser = await sendOtpPromise;
            return res.json(buildMobileOtpResponse(existingUser, mobile));
        } finally {
            if (mobileOtpSendLocks.get(mobile) === sendOtpPromise) {
                mobileOtpSendLocks.delete(mobile);
            }
        }
    } catch (err) {
        console.error('send-mobile-login-otp error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to send OTP' });
    }
});

router.post('/verify-mobile-login-otp', async (req, res) => {
    const mobile = normalizeMobile(req.body.mobile || req.body.mobile_number);
    const code = String(req.body.code || req.body.otp || '').trim();
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim();
    const dob = String(req.body.dob || '').trim();
    const gender = String(req.body.gender || '').trim();
    const normalizedDob = normalizeDob(dob);

    if (!/^[6-9]\d{9}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit phone number' });
    }
    if (!code) {
        return res.status(400).json({ success: false, message: 'Mobile number and OTP are required' });
    }
    if (email && !isValidEmailAddress(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }
    if (gender && !['Male', 'Female', 'Others'].includes(gender)) {
        return res.status(400).json({ success: false, message: 'Please select a valid gender' });
    }

    try {
        await ensureEmailAuthSchema();

        const storedOtp = mobileOtpStore.get(mobile);
        if (!storedOtp || !storedOtp.sessionId || Date.now() > storedOtp.expiresAt) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }

        await verifyManagedOtp({ sessionId: storedOtp.sessionId, otp: code });
        mobileOtpStore.delete(mobile);

        if (dob && normalizedDob === null) {
            return res.status(400).json({ success: false, message: 'Please enter a valid date of birth' });
        }

        let existingUser = await findExistingLoginUser({ mobile, email });
        console.log(
            `[USER AUTH] Mobile OTP verify for ${mobile}${email ? ` / ${email}` : ''}: ` +
            (existingUser
                ? `existing user login (userId=${existingUser.id})`
                : 'new user signup flow')
        );

        let userId;
        let userName = '';
        let userEmail = email;

        if (!existingUser) {
            if (email) {
                const [emailUsers] = await db.execute(
                    'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1',
                    [email]
                );
                if (emailUsers.length) {
                    return res.status(400).json({ success: false, message: 'This email is already linked to another account' });
                }
            }
            if (!name || !email || !mobile || !dob || normalizedDob === null || !gender) {
                return res.status(400).json({
                    success: false,
                    message: 'Please complete your signup details to continue'
                });
            }

            const [result] = await db.execute(
                'INSERT INTO users (mobile_number, name, email, dob, gender) VALUES (?, ?, ?, ?, ?)',
                [mobile, name || null, email || null, normalizedDob || null, gender || null]
            );
            userId = result.insertId;
            userName = name || '';
            console.log(
                `[USER AUTH] New user created via mobile OTP: userId=${userId}, mobile=${mobile}, email=${email}`
            );
        } else {
            userId = existingUser.id;
            if (email && normalizeEmail(existingUser.email) !== email) {
                const [emailUsers] = await db.execute(
                    'SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1',
                    [email, userId]
                );
                if (emailUsers.length) {
                    return res.status(400).json({ success: false, message: 'This email is already linked to another account' });
                }
            }

            await db.execute(
                `UPDATE users
                 SET mobile_number = COALESCE(NULLIF(?, ''), mobile_number),
                     name = COALESCE(NULLIF(?, ''), name),
                     email = COALESCE(NULLIF(?, ''), email),
                     dob = COALESCE(NULLIF(?, ''), dob),
                     gender = COALESCE(NULLIF(?, ''), gender)
                 WHERE id = ?`,
                [mobile, name, email || '', normalizedDob || '', gender, userId]
            );

            const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
            existingUser = users[0] || existingUser;
            userName = existingUser.name || '';
            userEmail = existingUser.email || email || '';
            console.log(
                `[USER AUTH] Existing user updated via mobile OTP: userId=${userId}, mobile=${userEmail ? existingUser.mobile_number || mobile : mobile}, email=${userEmail || email || ''}`
            );
        }

        const token = jwt.sign(
            { userId, mobile, role: 'user' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            userId,
            email: userEmail || '',
            name: userName,
            mobile,
            dob: normalizeDob(existingUser?.dob) || normalizedDob || '',
            gender: existingUser?.gender || gender || ''
        });
        console.log(
            `[USER AUTH] Mobile OTP login success: userId=${userId}, mobile=${mobile}, ` +
            `${existingUser ? 'existing user' : 'new user'}`
        );

        logAudit(req, {
            actorType: 'user',
            actorId: userId,
            action: 'LOGIN',
            entityType: 'user',
            entityId: userId,
            description: `User ${mobile} logged in via mobile OTP`
        });
    } catch (err) {
        console.error('verify-mobile-login-otp error:', err);
        if (/invalid otp/i.test(String(err.message || '')) || /expired/i.test(String(err.message || ''))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

module.exports = router;
