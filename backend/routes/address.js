const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const axios = require('axios');

let addressTableReady = false;
const POSTAL_PINCODE_API_BASE = 'https://api.postalpincode.in/pincode';
const POSTAL_LOOKUP_TIMEOUT_MS = 4000;

function isTransientPostalLookupError(err) {
    const transientCodes = new Set([
        'ECONNRESET',
        'ECONNABORTED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ERR_NETWORK'
    ]);
    return !!(err && transientCodes.has(err.code));
}

async function fetchPostalPincodeDetails(pincode) {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await axios.get(`${POSTAL_PINCODE_API_BASE}/${pincode}`, {
                timeout: POSTAL_LOOKUP_TIMEOUT_MS,
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Cache-Control': 'no-cache'
                }
            });

            const data = response.data;
            if (data && data[0] && data[0].Status === 'Success') {
                const postOffices = data[0].PostOffice;
                if (postOffices && postOffices.length > 0) {
                    return {
                        city: postOffices[0].District || '',
                        state: postOffices[0].State || ''
                    };
                }
            }

            return null;
        } catch (err) {
            lastError = err;
            if (!isTransientPostalLookupError(err) || attempt === 2) {
                break;
            }
        }
    }

    throw lastError;
}

async function ensureAddressTable() {
    if (addressTableReady) return;

    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_addresses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(100) NOT NULL,
            mobile VARCHAR(15) NOT NULL,
            address_line VARCHAR(255) NOT NULL,
            city VARCHAR(100) NOT NULL,
            state VARCHAR(100) NOT NULL,
            pincode VARCHAR(10) NOT NULL,
            recipient_name VARCHAR(100) NULL COMMENT 'For gift/recipient orders',
            recipient_phone VARCHAR(15) NULL COMMENT 'For gift/recipient orders',
            is_default BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_addresses_user (user_id),
            INDEX idx_user_addresses_default (user_id, is_default)
        )
    `);

    addressTableReady = true;
}

async function migrateLegacyAddressIfNeeded(userId) {
    await ensureAddressTable();

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

// POST /save-address (protected)
router.post('/save-address', auth, async (req, res) => {
    const name = (req.body.name || '').trim();
    const mobile = (req.body.mobile || '').trim();
    const address_line = (req.body.address_line || '').trim();
    const city = (req.body.city || '').trim();
    const state = (req.body.state || '').trim();
    const pincode = (req.body.pincode || '').trim();
    const recipient_name = (req.body.recipient_name || '').trim() || null;
    const recipient_phone = (req.body.recipient_phone || '').trim() || null;
    const user_id = req.user.userId;

    if (!address_line || !city || !state || !pincode) {
        return res.status(400).json({ success: false, message: 'Address line, city, state, and pincode are required' });
    }

    if (recipient_name && !recipient_phone) {
        return res.status(400).json({ success: false, message: 'Recipient phone is required when entering recipient name' });
    }

    if (recipient_phone && !/^[6-9]\d{9}$/.test(recipient_phone)) {
        return res.status(400).json({ success: false, message: 'Invalid recipient mobile number' });
    }

    if (!/^\d{6}$/.test(pincode)) {
        return res.status(400).json({ success: false, message: 'Invalid pincode (6 digits required)' });
    }

    try {
        await ensureAddressTable();
        await migrateLegacyAddressIfNeeded(user_id);

        const [existingAddresses] = await db.execute(
            'SELECT id FROM user_addresses WHERE user_id = ? LIMIT 1',
            [user_id]
        );
        const isDefault = existingAddresses.length === 0 ? 1 : 0;

        const [insertResult] = await db.execute(
            `INSERT INTO user_addresses
             (user_id, name, mobile, address_line, city, state, pincode, recipient_name, recipient_phone, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user_id, name, mobile, address_line, city, state, pincode, recipient_name, recipient_phone, isDefault]
        );

        // Keep profile basics in users table too.
        await db.execute(
            `UPDATE users SET name = COALESCE(?, name) WHERE id = ?`,
            [name, user_id]
        );

        res.json({
            success: true,
            message: 'Address saved successfully',
            addressId: insertResult.insertId
        });
    } catch (err) {
        console.error('save-address error:', err);
        res.status(500).json({ success: false, message: 'Failed to save address' });
    }
});

// GET /addresses (protected)
router.get('/addresses', auth, async (req, res) => {
    const user_id = req.user.userId;

    try {
        await ensureAddressTable();
        await migrateLegacyAddressIfNeeded(user_id);

        const [rows] = await db.execute(
            `SELECT id, name, mobile, address_line, city, state, pincode, recipient_name, recipient_phone, is_default, created_at
             FROM user_addresses
             WHERE user_id = ?
             ORDER BY is_default DESC, created_at DESC`,
            [user_id]
        );

        res.json({ success: true, addresses: rows });
    } catch (err) {
        console.error('GET /addresses error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
});

// PUT /addresses/:id — Update address (protected)
router.put('/addresses/:id', auth, async (req, res) => {
    const user_id = req.user.userId;
    const addressId = req.params.id;
    const name = (req.body.name || '').trim();
    const mobile = (req.body.mobile || '').trim();
    const address_line = (req.body.address_line || '').trim();
    const city = (req.body.city || '').trim();
    const state = (req.body.state || '').trim();
    const pincode = (req.body.pincode || '').trim();

    if (!address_line || !city || !state || !pincode) {
        return res.status(400).json({ success: false, message: 'Address line, city, state, and pincode are required' });
    }
    if (!/^\d{6}$/.test(pincode)) {
        return res.status(400).json({ success: false, message: 'Invalid pincode (6 digits required)' });
    }

    try {
        await ensureAddressTable();

        // Verify the address belongs to this user
        const [existing] = await db.execute(
            'SELECT id FROM user_addresses WHERE id = ? AND user_id = ?',
            [addressId, user_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        await db.execute(
            `UPDATE user_addresses
             SET name = ?, mobile = ?, address_line = ?, city = ?, state = ?, pincode = ?
             WHERE id = ? AND user_id = ?`,
            [name, mobile, address_line, city, state, pincode, addressId, user_id]
        );

        res.json({ success: true, message: 'Address updated successfully' });
    } catch (err) {
        console.error('PUT /addresses/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to update address' });
    }
});

// DELETE /addresses/:id — Delete address (protected)
router.delete('/addresses/:id', auth, async (req, res) => {
    const user_id = req.user.userId;
    const addressId = req.params.id;

    try {
        await ensureAddressTable();

        const [existing] = await db.execute(
            'SELECT id, is_default FROM user_addresses WHERE id = ? AND user_id = ?',
            [addressId, user_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        const [usedRows] = await db.execute(
            'SELECT COUNT(*) AS total FROM order_addresses WHERE user_address_id = ?',
            [addressId]
        );
        if ((usedRows[0]?.total || 0) > 0) {
            return res.status(409).json({
                success: false,
                message: 'This address is linked to an existing order and cannot be deleted.'
            });
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            if (Number(existing[0].is_default) === 1) {
                const [replacementRows] = await conn.execute(
                    `SELECT id
                     FROM user_addresses
                     WHERE user_id = ? AND id <> ?
                     ORDER BY created_at DESC, id DESC
                     LIMIT 1`,
                    [user_id, addressId]
                );

                if (replacementRows.length > 0) {
                    await conn.execute(
                        'UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?',
                        [replacementRows[0].id, user_id]
                    );
                }
            }

            await conn.execute(
                'DELETE FROM user_addresses WHERE id = ? AND user_id = ?',
                [addressId, user_id]
            );

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        res.json({ success: true, message: 'Address deleted successfully' });
    } catch (err) {
        console.error('DELETE /addresses/:id error:', err);
        if (err?.code === 'ER_ROW_IS_REFERENCED_2' || err?.code === 'ER_ROW_IS_REFERENCED') {
            return res.status(409).json({
                success: false,
                message: 'This address is linked to an existing order and cannot be deleted.'
            });
        }
        res.status(500).json({ success: false, message: 'Failed to delete address' });
    }
});

// GET /pincode/:pincode (public - although could be protected)
router.get('/pincode/:pincode', async (req, res) => {
    const { pincode } = req.params;

    if (!/^\d{6}$/.test(pincode)) {
        return res.status(400).json({ success: false, message: 'Invalid pincode format (6 digits required)' });
    }

    try {
        const location = await fetchPostalPincodeDetails(pincode);

        if (location) {
            return res.json({
                success: true,
                city: location.city,
                state: location.state
            });
        }

        res.status(404).json({ success: false, message: 'Pincode not found' });
    } catch (err) {
        console.warn(`Pincode lookup temporarily unavailable for ${pincode}:`, err.code || err.message);
        res.json({
            success: false,
            temporary: true,
            message: 'Pincode auto-fill is temporarily unavailable. Please enter city and state manually.'
        });
    }
});

module.exports = router;

