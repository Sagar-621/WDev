const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

function normalizeDob(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) return null;

    const dateOnly = match[1];
    const [year, month, day] = dateOnly.split('-').map(Number);
    const parsed = new Date(`${dateOnly}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;

    const isSameDate =
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day;

    return isSameDate ? dateOnly : null;
}

// GET /user/profile — Get current user profile
router.get('/profile', auth, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, mobile_number, name, email, dob, gender, address_line, city, state, pincode, created_at
             FROM users WHERE id = ?`,
            [req.user.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            user: {
                ...rows[0],
                dob: normalizeDob(rows[0].dob) || ''
            }
        });
    } catch (err) {
        console.error('GET /user/profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
});

// PUT /user/profile — Update user profile
router.put('/profile', auth, async (req, res) => {
    const { name, email, dob, gender } = req.body;
    const normalizedDob = normalizeDob(dob);

    if (dob && normalizedDob === null) {
        return res.status(400).json({ success: false, message: 'Please enter a valid date of birth' });
    }

    try {
        await db.execute(
            `UPDATE users SET name = ?, email = ?, dob = ?, gender = ? WHERE id = ?`,
            [name || null, email || null, normalizedDob || null, gender || null, req.user.userId]
        );

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('PUT /user/profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

module.exports = router;

