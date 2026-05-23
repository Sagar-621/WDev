const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

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

        res.json({ success: true, user: rows[0] });
    } catch (err) {
        console.error('GET /user/profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
});

// PUT /user/profile — Update user profile
router.put('/profile', auth, async (req, res) => {
    const { name, email, dob, gender } = req.body;

    try {
        await db.execute(
            `UPDATE users SET name = ?, email = ?, dob = ?, gender = ? WHERE id = ?`,
            [name || null, email || null, dob || null, gender || null, req.user.userId]
        );

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('PUT /user/profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

module.exports = router;

