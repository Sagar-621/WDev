const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { generateBotResponse, summarizeConversation } = require('../services/geminiChat');
const { sendContactFormEmails, sendNewsletterSignupEmail, sendNewsletterAdminNotification } = require('../services/mailer');

let supportTablesReady = false;

async function ensureSupportTables() {
    supportTablesReady = true;
}

function buildMessagePayload(row) {
    return {
        id: row.id,
        conversation_id: row.conversation_id,
        sender_type: row.sender_type,
        message: row.message,
        is_read: !!row.is_read,
        created_at: row.created_at
    };
}

async function ensureConversationForUser(userId) {
    await ensureSupportTables();

    const [users] = await db.execute(
        'SELECT id, name, mobile_number FROM users WHERE id = ? LIMIT 1',
        [userId]
    );

    if (!users.length) {
        const err = new Error('Invalid session. Please log in again.');
        err.statusCode = 401;
        throw err;
    }

    const [existing] = await db.execute(
        'SELECT id, user_id, status, last_message_at, created_at, updated_at FROM support_conversations WHERE user_id = ? LIMIT 1',
        [userId]
    );

    if (existing.length) return existing[0];

    const [result] = await db.execute(
        'INSERT INTO support_conversations (user_id, status, last_message_at) VALUES (?, \'Open\', NULL)',
        [userId]
    );

    const [rows] = await db.execute(
        'SELECT id, user_id, status, last_message_at, created_at, updated_at FROM support_conversations WHERE id = ? LIMIT 1',
        [result.insertId]
    );

    return rows[0];
}

async function getConversationMessages(conversationId) {
    const [rows] = await db.execute(
        `SELECT id, conversation_id, sender_type, message, is_read, created_at
         FROM support_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC, id ASC`,
        [conversationId]
    );

    return rows.map(buildMessagePayload);
}

async function touchConversation(conversationId, conn = db) {
    await conn.execute(
        'UPDATE support_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?',
        [conversationId]
    );
}

async function getAIBotReply(message, conversationId) {
    try {
        // Load recent conversation history for context
        const [historyRows] = await db.execute(
            `SELECT sender_type, message FROM support_messages
             WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10`,
            [conversationId]
        );
        const history = historyRows.reverse().map(r => ({
            role: r.sender_type === 'user' ? 'user' : 'model',
            text: r.message
        }));

        const reply = await generateBotResponse(message, history);
        return reply;
    } catch (err) {
        console.error('AI bot reply error:', err.message);
        return 'Thanks for reaching out! Our support team will review your message shortly. In the meantime, feel free to browse our latest collections.';
    }
}

router.get('/support/conversation', auth, async (req, res) => {
    try {
        const conversation = await ensureConversationForUser(req.user.userId);
        const messages = await getConversationMessages(conversation.id);

        await db.execute(
            'UPDATE support_messages SET is_read = TRUE WHERE conversation_id = ? AND sender_type = \'admin\' AND is_read = FALSE',
            [conversation.id]
        );

        res.json({ success: true, conversation, messages });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            console.warn(`GET /support/conversation auth issue: ${err.message}`);
        } else {
            console.error('GET /support/conversation error:', err);
        }
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to load support chat' });
    }
});

router.post('/support/messages', auth, async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required' });
    }

    try {
        const conversation = await ensureConversationForUser(req.user.userId);
        const [result] = await db.execute(
            `INSERT INTO support_messages (conversation_id, sender_type, sender_user_id, message, is_read)
             VALUES (?, 'user', ?, ?, FALSE)`,
            [conversation.id, req.user.userId, message]
        );
        await touchConversation(conversation.id);

        const [rows] = await db.execute(
            'SELECT id, conversation_id, sender_type, message, is_read, created_at FROM support_messages WHERE id = ? LIMIT 1',
            [result.insertId]
        );

        // AI Bot auto-reply (async — don't block the user response)
        getAIBotReply(message, conversation.id).then(async (botReply) => {
            if (botReply) {
                try {
                    await db.execute(
                        `INSERT INTO support_messages (conversation_id, sender_type, message, is_read)
                         VALUES (?, 'admin', ?, FALSE)`,
                        [conversation.id, botReply]
                    );
                    await touchConversation(conversation.id);
                } catch (e) { console.error('Bot reply insert error:', e.message); }
            }
        });

        res.json({ success: true, message: buildMessagePayload(rows[0]) });
    } catch (err) {
        console.error('POST /support/messages error:', err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to send message' });
    }
});

router.post('/contact-messages', async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const message = String(req.body.message || '').trim();

    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: 'Name, email, and message are required' });
    }

    try {
        await ensureSupportTables();
        const [result] = await db.execute(
            'INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)',
            [name, email, message]
        );

        sendContactFormEmails({ name, email, message }).catch((mailErr) => {
            console.error('Contact email send error:', mailErr.message);
        });

        res.json({ success: true, id: result.insertId, message: 'Contact message submitted successfully' });
    } catch (err) {
        console.error('POST /contact-messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit contact message' });
    }
});

router.post('/newsletter-signups', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const source = String(req.body.source || 'website').trim().slice(0, 80);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    try {
        await ensureSupportTables();
        const [existingRows] = await db.execute(
            'SELECT id FROM newsletter_signups WHERE email = ? LIMIT 1',
            [email]
        );
        const alreadySubscribed = existingRows.length > 0;

        await db.execute(
            `INSERT INTO newsletter_signups (email, source)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE source = VALUES(source)`,
            [email, source || 'website']
        );

        if (!alreadySubscribed) {
            // Fetch the coupon admin has flagged for newsletter emails
            let welcomeCoupon = null;
            try {
                const [couponRows] = await db.execute(
                    `SELECT code, discount_type, discount_value FROM coupons
                     WHERE is_active = TRUE AND send_in_newsletter = TRUE
                       AND (start_date IS NULL OR start_date <= NOW())
                       AND (end_date IS NULL OR end_date >= NOW())
                     ORDER BY created_at DESC LIMIT 1`
                );
                if (couponRows.length) welcomeCoupon = couponRows[0];
            } catch (couponErr) {
                console.error('Newsletter welcome coupon lookup error:', couponErr.message);
            }

            sendNewsletterSignupEmail(email, welcomeCoupon).catch((mailErr) => {
                console.error('Newsletter welcome email error:', mailErr.message);
            });
            sendNewsletterAdminNotification({ email, source: source || 'website' }).catch((mailErr) => {
                console.error('Newsletter admin notification error:', mailErr.message);
            });
        }

        res.json({
            success: true,
            alreadySubscribed,
            message: alreadySubscribed ? 'You are already subscribed' : 'Email saved successfully'
        });
    } catch (err) {
        console.error('POST /newsletter-signups error:', err);
        res.status(500).json({ success: false, message: 'Failed to save email signup' });
    }
});

router.get('/admin/support/conversations', adminAuth, async (req, res) => {
    try {
        await ensureSupportTables();
        const [rows] = await db.execute(
            `SELECT sc.id, sc.user_id, sc.status, sc.last_message_at, sc.created_at, sc.updated_at,
                    u.name AS user_name, u.mobile_number,
                    (
                        SELECT COUNT(*)
                        FROM support_messages sm
                        WHERE sm.conversation_id = sc.id AND sm.sender_type = 'user' AND sm.is_read = FALSE
                    ) AS unread_count,
                    (
                        SELECT sm.message
                        FROM support_messages sm
                        WHERE sm.conversation_id = sc.id
                        ORDER BY sm.created_at DESC, sm.id DESC
                        LIMIT 1
                    ) AS last_message
             FROM support_conversations sc
             JOIN users u ON u.id = sc.user_id
             ORDER BY COALESCE(sc.last_message_at, sc.updated_at, sc.created_at) DESC`
        );

        res.json({ success: true, conversations: rows });
    } catch (err) {
        console.error('GET /admin/support/conversations error:', err);
        res.status(500).json({ success: false, message: 'Failed to load conversations' });
    }
});

router.get('/admin/support/conversations/:id/messages', adminAuth, async (req, res) => {
    try {
        await ensureSupportTables();
        const conversationId = Number(req.params.id);
        const [conversations] = await db.execute(
            `SELECT sc.*, u.name AS user_name, u.mobile_number
             FROM support_conversations sc
             JOIN users u ON u.id = sc.user_id
             WHERE sc.id = ? LIMIT 1`,
            [conversationId]
        );

        if (!conversations.length) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        await db.execute(
            'UPDATE support_messages SET is_read = TRUE WHERE conversation_id = ? AND sender_type = \'user\' AND is_read = FALSE',
            [conversationId]
        );

        const messages = await getConversationMessages(conversationId);
        res.json({ success: true, conversation: conversations[0], messages });
    } catch (err) {
        console.error('GET /admin/support/conversations/:id/messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to load chat messages' });
    }
});

router.post('/admin/support/conversations/:id/messages', adminAuth, async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) {
        return res.status(400).json({ success: false, message: 'Message is required' });
    }

    try {
        await ensureSupportTables();
        const conversationId = Number(req.params.id);
        const [conversations] = await db.execute(
            'SELECT id FROM support_conversations WHERE id = ? LIMIT 1',
            [conversationId]
        );

        if (!conversations.length) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        const [result] = await db.execute(
            `INSERT INTO support_messages (conversation_id, sender_type, sender_admin_id, message, is_read)
             VALUES (?, 'admin', ?, ?, FALSE)`,
            [conversationId, req.admin.adminId, message]
        );
        await touchConversation(conversationId);

        const [rows] = await db.execute(
            'SELECT id, conversation_id, sender_type, message, is_read, created_at FROM support_messages WHERE id = ? LIMIT 1',
            [result.insertId]
        );

        res.json({ success: true, message: buildMessagePayload(rows[0]) });
    } catch (err) {
        console.error('POST /admin/support/conversations/:id/messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to send admin reply' });
    }
});

router.get('/admin/contact-messages', adminAuth, async (req, res) => {
    try {
        await ensureSupportTables();
        const [rows] = await db.execute(
            `SELECT id, name, email, message, status, created_at, reviewed_at
             FROM contact_messages
             ORDER BY created_at DESC`
        );

        res.json({ success: true, messages: rows });
    } catch (err) {
        console.error('GET /admin/contact-messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to load contact messages' });
    }
});

router.put('/admin/contact-messages/:id/review', adminAuth, async (req, res) => {
    try {
        await ensureSupportTables();
        const id = Number(req.params.id);
        await db.execute(
            'UPDATE contact_messages SET status = \'Reviewed\', reviewed_at = NOW() WHERE id = ?',
            [id]
        );
        res.json({ success: true, message: 'Contact message marked as reviewed' });
    } catch (err) {
        console.error('PUT /admin/contact-messages/:id/review error:', err);
        res.status(500).json({ success: false, message: 'Failed to update contact message' });
    }
});

module.exports = router;

