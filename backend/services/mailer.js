const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

let mailerRuntimeOverrides = {
    supportEmail: '',
};
let adminMailerColumnsReady = false;

async function ensureAdminMailerColumns() {
    if (adminMailerColumnsReady) return;

    const columns = [
        ['support_email', "VARCHAR(255) NULL"],
        ['smtp_app_password', "VARCHAR(255) NULL"],
        ['is_active', "BOOLEAN NOT NULL DEFAULT TRUE"]
    ];

    for (const [name, definition] of columns) {
        const [rows] = await db.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'admins'
               AND COLUMN_NAME = ?`,
            [name]
        );
        if (!rows.length) {
            await db.execute(`ALTER TABLE admins ADD COLUMN ${name} ${definition}`);
        }
    }

    adminMailerColumnsReady = true;
}

async function getActiveAdminMailerCredentials() {
    await ensureAdminMailerColumns();
    const [rows] = await db.execute(
        `SELECT support_email, smtp_app_password
         FROM admins
         WHERE is_active = TRUE
         ORDER BY id ASC
         LIMIT 1`
    );

    const admin = rows[0] || {};
    return {
        supportEmail: String(admin.support_email || '').trim(),
        appPassword: String(admin.smtp_app_password || '').trim()
    };
}

async function bootstrapMailerRuntimeConfig() {
    try {
        const credentials = await getActiveAdminMailerCredentials();
        if (credentials.supportEmail) {
            setMailerRuntimeConfig({
                supportEmail: credentials.supportEmail || ''
            });
        }
    } catch (err) {
        console.error('[MAIL] Failed to bootstrap runtime config:', err.message);
    }
}

function setMailerRuntimeConfig(overrides = {}) {
    mailerRuntimeOverrides = {
        supportEmail: String(overrides.supportEmail || '').trim()
    };
}

/* ─── Logo path for CID inline attachment ─── */

function getMailerConfig(purpose = 'verification') {
    const normalizedPurpose = String(purpose || 'verification').trim().toLowerCase();
    const shared = {
        supportEmail: mailerRuntimeOverrides.supportEmail || String(process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '').trim()
    };

    const profiles = {
        verification: {
            user: String(process.env.SMTP_USER || process.env.SMTP_USER_VERIFICATION || '').trim(),
            appPassword: String(process.env.SMTP_APP_PASSWORD || process.env.SMTP_APP_PASSWORD_VERIFICATION || '').trim(),
            fromName: String(process.env.SMTP_FROM_NAME || process.env.SMTP_FROM_NAME_VERIFICATION || 'DEVASTHRA').trim()
        },
        cancellation: {
            user: String(process.env.SMTP_USER_CANCELLATION || process.env.SMTP_USER || '').trim(),
            appPassword: String(process.env.SMTP_APP_PASSWORD_CANCELLATION || process.env.SMTP_APP_PASSWORD || '').trim(),
            fromName: String(process.env.SMTP_FROM_NAME_CANCELLATION || process.env.SMTP_FROM_NAME || 'Cancellation').trim()
        },
        refunds: {
            user: String(process.env.SMTP_USER_REFUNDS || process.env.SMTP_USER || '').trim(),
            appPassword: String(process.env.SMTP_APP_PASSWORD_REFUNDS || process.env.SMTP_APP_PASSWORD || '').trim(),
            fromName: String(process.env.SMTP_FROM_NAME_REFUNDS || process.env.SMTP_FROM_NAME || 'Refunds').trim()
        },
        return_exchange: {
            user: String(process.env.SMTP_USER_RETURN_EXCHANGE || process.env.SMTP_USER || '').trim(),
            appPassword: String(process.env.SMTP_APP_PASSWORD_RETURN_EXCHANGE || process.env.SMTP_APP_PASSWORD || '').trim(),
            fromName: String(process.env.SMTP_FROM_NAME_RETURN_EXCHANGE || process.env.SMTP_FROM_NAME || 'Return & Exchange').trim()
        },
        order_confirmation: {
            user: String(process.env.SMTP_USER_ORDER_CONFIRMATION || process.env.SMTP_USER || '').trim(),
            appPassword: String(process.env.SMTP_APP_PASSWORD_ORDER_CONFIRMATION || process.env.SMTP_APP_PASSWORD || '').trim(),
            fromName: String(process.env.SMTP_FROM_NAME_ORDER_CONFIRMATION || process.env.SMTP_FROM_NAME || 'Order Confirmation').trim()
        }
    };

    return { ...(profiles[normalizedPurpose] || profiles.verification), ...shared };
}

function isMailerConfigured(purpose = 'verification') {
    const { user, appPassword } = getMailerConfig(purpose);
    return Boolean(
        user &&
        appPassword &&
        user !== 'your_gmail@gmail.com' &&
        appPassword !== 'your_gmail_app_password'
    );
}

function createTransporter(purpose = 'verification') {
    const { user, appPassword } = getMailerConfig(purpose);
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user,
            pass: appPassword
        }
    });
}

function getFrontendUrl() {
    const raw = String(
        process.env.PUBLIC_SITE_URL ||
        process.env.FRONTEND_URL ||
        'http://localhost:5000'
    ).trim();
    return raw.split(',').map((entry) => entry.trim()).find(Boolean) || 'http://localhost:5000';
}

function getEmailLogoAttachment() {
    const customLogoPath = String(process.env.EMAIL_LOGO_PATH || '').trim();
    const logoPath = customLogoPath
        ? customLogoPath
        : path.join(__dirname, '..', 'images', 'red_text_logo.png');

    if (!fs.existsSync(logoPath)) {
        return null;
    }

    return {
        filename: 'red_text_logo.png',
        path: logoPath,
        cid: 'devasthra-logo',
        contentDisposition: 'inline',
        contentType: 'image/png'
    };
}

function buildEmailShell({ eyebrow, title, intro, bodyHtml, footerNote, primaryCtaLabel, primaryCtaHref }) {
    const frontendUrl = getFrontendUrl();
    return `
        <div style="margin:0;padding:28px 16px;background:#f7efe8;font-family:Arial,sans-serif;color:#2b1d22;">
            <div style="max-width:640px;margin:0 auto;background:#fffaf7;border:1px solid #ecd8cf;border-radius:22px;overflow:hidden;box-shadow:0 18px 48px rgba(34,20,18,0.08);">
                <div style="padding:24px 28px 10px;background:linear-gradient(135deg,#fff8f0 0%,#fffaf7 55%,#f8eee8 100%);">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
                        <div style="min-width:0;flex:1 1 auto;">
                            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">${eyebrow}</p>
                            <h1 style="margin:0;font-size:34px;line-height:1.08;color:#24161c;">${title}</h1>
                        </div>
                        <a href="${frontendUrl}" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:flex-end;flex:0 0 auto;">
                            <img src="cid:devasthra-logo" alt="DEVASTHRA" width="140" height="50" style="width:140px;max-width:140px;height:auto;max-height:50px;display:block;object-fit:contain;border:0;">
                        </a>
                    </div>
                    <p style="margin:18px 0 0;font-size:15px;line-height:1.8;color:#5b4345;">${intro}</p>
                </div>
                <div style="padding:22px 28px 28px;">
                    ${bodyHtml}
                    ${primaryCtaLabel && primaryCtaHref ? `
                        <div style="margin-top:22px;">
                            <a href="${primaryCtaHref}" style="display:inline-block;padding:14px 24px;border-radius:12px;background:#700823;color:#ffffff;text-decoration:none;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px;">${primaryCtaLabel}</a>
                        </div>
                    ` : ''}
                    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #efe1d6;">
                        <p style="margin:0;font-size:12px;line-height:1.7;color:#7b6668;">${footerNote || 'Sent by DEVASTHRA customer communications.'}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function sendMail({ to, subject, text, html, replyTo, attachments, mailPurpose = 'verification' }) {
    if (!isMailerConfigured(mailPurpose)) {
        throw new Error(`Mailer is not configured for ${mailPurpose}`);
    }

    const transporter = createTransporter(mailPurpose);
    const { user, fromName } = getMailerConfig(mailPurpose);
    const logoAttachment = getEmailLogoAttachment();
    const inlineAttachments = logoAttachment ? [logoAttachment] : [];

    await transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to,
        replyTo: replyTo || undefined,
        subject,
        text,
        html,
        attachments: [...inlineAttachments, ...(attachments?.length ? attachments : [])]
    });

    return { success: true };
}

async function sendLoginCodeEmail(email, code) {
    const frontendUrl = getFrontendUrl();
    return sendMail({
        to: email,
        subject: 'Your DEVASTHRA login code',
        text: `Your DEVASTHRA verification code is ${code}. This code expires in 10 minutes.`,
        html: buildEmailShell({
            eyebrow: 'DEVASTHRA Login',
            title: 'Your verification code',
            intro: 'Use the code below to continue your login or sign up. It expires in 10 minutes.',
            bodyHtml: `
                <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:#700823;color:#ffffff;font-size:30px;font-weight:700;letter-spacing:0.28em;">
                    ${code}
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#7b6668;">
                    If you did not request this code, you can safely ignore this email.
                </p>
            `,
            primaryCtaLabel: 'Visit DEVASTHRA',
            primaryCtaHref: frontendUrl
        }),
        mailPurpose: 'verification'
    });
}

async function sendOrderConfirmationEmail({
    to,
    customerName,
    orderReference,
    orderId,
    totalAmount,
    paymentMethod,
    awbCode,
    shippingCity
}) {
    if (!to) return { success: false, skipped: true };
    const frontendUrl = getFrontendUrl();

    const cityLower = String(shippingCity || '').toLowerCase();
    const isHyderabad = cityLower.includes('hyderabad');
    const deliveryEstimate = isHyderabad ? '2–3 business days' : '3–5 business days';
    const awbDisplay = awbCode || 'Assigning soon';

    return sendMail({
        to,
        subject: `Your DEVASTHRA order ${orderReference} is confirmed`,
        text:
            `Hi ${customerName || 'Customer'},\n\n` +
            `Your DEVASTHRA order has been confirmed.\n` +
            `Total: Rs. ${Number(totalAmount || 0).toFixed(2)}\n` +
            `Payment: ${paymentMethod}\n` +
            `AWB: ${awbDisplay}\n` +
            `Estimated delivery: ${deliveryEstimate}\n\n` +
            `Thank you for shopping with DEVASTHRA.`,
        html: buildEmailShell({
            eyebrow: 'Order Confirmed',
            title: 'Your order is confirmed',
            intro: `Hi ${customerName || 'Customer'}, your order has been placed successfully.`,
            bodyHtml: `
                <div style="background:#ffffff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 10px;"><strong>Total Amount:</strong> Rs. ${Number(totalAmount || 0).toFixed(2)}</p>
                    <p style="margin:0 0 10px;"><strong>Payment:</strong> ${paymentMethod}</p>
                    <p style="margin:0 0 10px;"><strong>AWB Number:</strong> ${awbDisplay}</p>
                    <p style="margin:0;"><strong>Estimated Delivery:</strong> ${deliveryEstimate}</p>
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#7b6668;">
                    Keep this email for quick tracking and support.
                </p>
            `,
            primaryCtaLabel: 'Visit DEVASTHRA',
            primaryCtaHref: frontendUrl
        }),
        mailPurpose: 'order_confirmation'
    });
}

async function sendContactFormEmails({ name, email, message }) {
    const { supportEmail } = getMailerConfig();
    const frontendUrl = getFrontendUrl();
    const ticketRef = `CT-${Date.now().toString().slice(-6)}`;

    const tasks = [];

    if (email) {
        tasks.push(
            sendMail({
                to: email,
                subject: 'We received your message - DEVASTHRA',
                text:
                    `Hi ${name},\n\n` +
                    `We received your message and our team will get back to you soon.\n\n` +
                    `Your message:\n${message}\n\n` +
                    `Thanks,\nDEVASTHRA`,
                html: buildEmailShell({
                    eyebrow: 'DEVASTHRA Contact',
                    title: 'We received your message',
                    intro: `Hi ${name}, thank you for reaching out. Our team will get back to you soon. Your conversation reference is ${ticketRef}.`,
                    bodyHtml: `
                        <div style="background:#ffffff;border:1px solid #ecd8cf;border-radius:18px;padding:18px 20px;">
                            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">Your message</p>
                            <div style="font-size:15px;line-height:1.8;color:#5b4345;">${message.replace(/\n/g, '<br>')}</div>
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px;">
                            <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Reference</p>
                                <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${ticketRef}</p>
                            </div>
                            <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Response Time</p>
                                <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">Usually within 24 hours</p>
                            </div>
                        </div>
                    `,
                    footerNote: 'If you need immediate help, reply to this email and our support desk will pick it up.',
                    primaryCtaLabel: 'Visit DEVASTHRA',
                    primaryCtaHref: frontendUrl
                })
            })
        );
    }

    if (supportEmail) {
        tasks.push(
            sendMail({
                to: supportEmail,
                replyTo: email,
                subject: `New contact enquiry from ${name}`,
                text:
                    `Name: ${name}\n` +
                    `Email: ${email}\n\n` +
                    `Message:\n${message}`,
                html: buildEmailShell({
                    eyebrow: 'New Contact Enquiry',
                    title: 'A customer sent a message',
                    intro: `${name} has submitted the contact form. You can reply directly to this email to continue the conversation.`,
                    bodyHtml: `
                        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                            <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Name</p>
                                <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${name}</p>
                            </div>
                            <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Email</p>
                                <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${email}</p>
                            </div>
                        </div>
                        <div style="margin-top:16px;background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">Message</p>
                            <div style="font-size:15px;line-height:1.8;color:#5b4345;">${message.replace(/\n/g, '<br>')}</div>
                        </div>
                    `,
                    footerNote: `Reference ${ticketRef}. Replying to this email will go back to the customer.`
                })
            })
        );
    }

    return Promise.allSettled(tasks);
}

async function sendNewsletterSignupEmail(email, coupon) {
    if (!email) return { success: false, skipped: true };
    const frontendUrl = getFrontendUrl();

    const hasCoupon = coupon && coupon.code;
    const discountLabel = hasCoupon
        ? (coupon.discount_type === 'flat' ? `\u20B9${coupon.discount_value} off` : `${coupon.discount_value}% off`)
        : '';

    const subjectLine = hasCoupon
        ? `Welcome to DEVASTHRA - your ${discountLabel} offer is inside`
        : 'Welcome to DEVASTHRA';

    const couponBlock = hasCoupon ? `
                <div style="background:#700823;color:#ffffff;border-radius:18px;padding:20px 22px;text-align:center;">
                    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;opacity:.8;margin-bottom:8px;">Use code</div>
                    <div style="font-size:34px;font-weight:700;letter-spacing:0.12em;">${coupon.code}</div>
                    <div style="margin-top:10px;font-size:14px;opacity:.88;">Get ${discountLabel} your order</div>
                </div>` : '';

    return sendMail({
        to: email,
        subject: subjectLine,
        text:
            `Welcome to DEVASTHRA.\n\n` +
            (hasCoupon ? `Thanks for joining our list. Use code ${coupon.code} to get ${discountLabel} your order.\n\n` : '') +
            `You will also receive updates on new drops, festive edits, and exclusive offers.\n\n` +
            `Shop now: ${frontendUrl}`,
        html: buildEmailShell({
            eyebrow: 'Welcome to DEVASTHRA',
            title: hasCoupon ? `Your ${discountLabel} offer is ready` : 'Welcome aboard!',
            intro: 'Thanks for joining the DEVASTHRA list. You will now receive launch updates, festive edits, and exclusive offers.',
            bodyHtml: `
                ${couponBlock}
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px;">
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">What you get</p>
                        <p style="margin:0;font-size:15px;line-height:1.7;color:#5b4345;">Exclusive offers, early drops, and festive edit updates.</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Best for</p>
                        <p style="margin:0;font-size:15px;line-height:1.7;color:#5b4345;">First-order customers and repeat buyers waiting for launches.</p>
                    </div>
                </div>
            `,
            footerNote: 'You can stay subscribed for product drops and exclusive campaigns, or ignore this email if you signed up by mistake.',
            primaryCtaLabel: 'Start Shopping',
            primaryCtaHref: frontendUrl
        })
    });
}

async function sendNewsletterAdminNotification({ email, source }) {
    const { supportEmail } = getMailerConfig();
    if (!supportEmail || !email) return { success: false, skipped: true };

    return sendMail({
        to: supportEmail,
        subject: `New newsletter signup from ${email}`,
        text:
            `A new newsletter signup was captured.\n\n` +
            `Email: ${email}\n` +
            `Source: ${source || 'website'}`,
        html: buildEmailShell({
            eyebrow: 'Newsletter Lead',
            title: 'New email signup captured',
            intro: 'A visitor joined your DEVASTHRA email list.',
            bodyHtml: `
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Email</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${email}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Source</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${source || 'website'}</p>
                    </div>
                </div>
            `,
            footerNote: 'This lead was captured on your website and saved to newsletter_signups.'
        })
    });
}

async function sendAdminOrderNotification({
    orderReference,
    orderId,
    customerName,
    totalAmount,
    paymentMethod,
    shippingAddress
}) {
    const { supportEmail } = getMailerConfig();
    if (!supportEmail) return { success: false, skipped: true };

    const addrLines = [
        shippingAddress?.name,
        shippingAddress?.mobile,
        shippingAddress?.address_line,
        [shippingAddress?.city, shippingAddress?.state, shippingAddress?.pincode].filter(Boolean).join(', ')
    ].filter(Boolean);

    return sendMail({
        to: supportEmail,
        subject: `New Order ${orderReference} — Rs. ${Number(totalAmount || 0).toFixed(2)} (${paymentMethod})`,
        text:
            `New order placed on DEVASTHRA.\n\n` +
            `Order: ${orderReference}\n` +
            `Customer: ${customerName}\n` +
            `Total: Rs. ${Number(totalAmount || 0).toFixed(2)}\n` +
            `Payment: ${paymentMethod}\n` +
            `Address: ${addrLines.join(', ')}`,
        html: buildEmailShell({
            eyebrow: 'New Order Placed',
            title: `Order ${orderReference}`,
            intro: `${customerName} placed a new order. Check admin dashboard for details.`,
            bodyHtml: `
                <div style="background:#ffffff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 8px;"><strong>Order:</strong> ${orderReference}</p>
                    <p style="margin:0 0 8px;"><strong>Customer:</strong> ${customerName}</p>
                    <p style="margin:0 0 8px;"><strong>Total:</strong> Rs. ${Number(totalAmount || 0).toFixed(2)}</p>
                    <p style="margin:0 0 8px;"><strong>Payment:</strong> ${paymentMethod}</p>
                    <p style="margin:0;"><strong>Ship to:</strong> ${addrLines.join(', ')}</p>
                </div>
            `,
            footerNote: 'This is an automated admin notification from DEVASTHRA.'
        })
    });
}

async function sendCancellationRequestNotification({
    orderId,
    orderReference,
    customerName,
    customerEmail,
    customerPhone,
    reason,
    reasonDetail
}) {
    const supportEmail = getMailerConfig('cancellation').supportEmail || 'support@devasthra.com';
    const detailText = String(reasonDetail || '').trim();

    return sendMail({
        to: supportEmail,
        replyTo: customerEmail || undefined,
        subject: `Cancellation request for Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
        text:
            `A customer has requested order cancellation.\n\n` +
            `Order: ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}\n` +
            `Customer: ${customerName || 'Customer'}\n` +
            `Email: ${customerEmail || 'N/A'}\n` +
            `Phone: ${customerPhone || 'N/A'}\n` +
            `Reason: ${reason || 'N/A'}\n` +
            `Details: ${detailText || 'N/A'}`,
        html: buildEmailShell({
            eyebrow: 'Cancellation Request',
            title: `Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
            intro: `${customerName || 'A customer'} has requested cancellation for this order. Please review it in the admin dashboard.`,
            bodyHtml: `
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Order</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Customer</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerName || 'Customer'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Email</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerEmail || 'N/A'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Phone</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerPhone || 'N/A'}</p>
                    </div>
                </div>
                <div style="margin-top:16px;background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">Reason</p>
                    <p style="margin:0 0 8px;font-size:15px;line-height:1.8;color:#24161c;font-weight:700;">${reason || 'N/A'}</p>
                    <p style="margin:0;font-size:15px;line-height:1.8;color:#5b4345;">${detailText || 'No additional details provided.'}</p>
                </div>
            `,
            footerNote: 'This request was submitted by the customer and is awaiting admin review.'
        }),
        mailPurpose: 'cancellation'
    });
}

async function sendReturnRequestNotification({
    orderId,
    orderReference,
    customerName,
    customerEmail,
    customerPhone,
    productName,
    reason,
    reasonDetail,
    description
}) {
    const supportEmail = getMailerConfig('return_exchange').supportEmail || 'support@devasthra.com';
    const detailText = [reasonDetail, description].filter(Boolean).join(' | ');

    return sendMail({
        to: supportEmail,
        replyTo: customerEmail || undefined,
        subject: `Return request for Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
        text:
            `A customer has requested a return.\n\n` +
            `Order: ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}\n` +
            `Customer: ${customerName || 'Customer'}\n` +
            `Email: ${customerEmail || 'N/A'}\n` +
            `Phone: ${customerPhone || 'N/A'}\n` +
            `Product: ${productName || 'N/A'}\n` +
            `Reason: ${reason || 'N/A'}\n` +
            `Details: ${detailText || 'N/A'}`,
        html: buildEmailShell({
            eyebrow: 'Return Request',
            title: `Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
            intro: `${customerName || 'A customer'} has submitted a return request. Please review it in the admin dashboard.`,
            bodyHtml: `
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Order</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Product</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${productName || 'N/A'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Customer</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerName || 'Customer'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Phone</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerPhone || 'N/A'}</p>
                    </div>
                </div>
                <div style="margin-top:16px;background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">Reason</p>
                    <p style="margin:0 0 8px;font-size:15px;line-height:1.8;color:#24161c;font-weight:700;">${reason || 'N/A'}</p>
                    <p style="margin:0;font-size:15px;line-height:1.8;color:#5b4345;">${detailText || 'No additional details provided.'}</p>
                </div>
            `,
            footerNote: 'This return request is awaiting admin review.'
        }),
        mailPurpose: 'return_exchange'
    });
}

async function sendExchangeRequestNotification({
    orderId,
    orderReference,
    customerName,
    customerEmail,
    customerPhone,
    productName,
    requestedSize,
    reason,
    reasonDetail
}) {
    const supportEmail = getMailerConfig('return_exchange').supportEmail || 'support@devasthra.com';
    const detailText = String(reasonDetail || '').trim();

    return sendMail({
        to: supportEmail,
        replyTo: customerEmail || undefined,
        subject: `Exchange request for Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
        text:
            `A customer has requested an exchange.\n\n` +
            `Order: ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}\n` +
            `Customer: ${customerName || 'Customer'}\n` +
            `Email: ${customerEmail || 'N/A'}\n` +
            `Phone: ${customerPhone || 'N/A'}\n` +
            `Product: ${productName || 'N/A'}\n` +
            `Requested Size: ${requestedSize || 'N/A'}\n` +
            `Reason: ${reason || 'N/A'}\n` +
            `Details: ${detailText || 'N/A'}`,
        html: buildEmailShell({
            eyebrow: 'Exchange Request',
            title: `Order ${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}`,
            intro: `${customerName || 'A customer'} has submitted an exchange request. Please review it in the admin dashboard.`,
            bodyHtml: `
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Order</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${orderReference || `NATDEV${String(orderId).padStart(3, '0')}`}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Product</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${productName || 'N/A'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Requested Size</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${requestedSize || 'N/A'}</p>
                    </div>
                    <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:14px 16px;">
                        <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7b6668;font-weight:700;">Customer</p>
                        <p style="margin:0;font-size:16px;font-weight:700;color:#24161c;">${customerName || 'Customer'}</p>
                    </div>
                </div>
                <div style="margin-top:16px;background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8b1a3a;font-weight:700;">Reason</p>
                    <p style="margin:0 0 8px;font-size:15px;line-height:1.8;color:#24161c;font-weight:700;">${reason || 'N/A'}</p>
                    <p style="margin:0;font-size:15px;line-height:1.8;color:#5b4345;">${detailText || 'No additional details provided.'}</p>
                </div>
            `,
            footerNote: 'This exchange request is awaiting admin review.'
        }),
        mailPurpose: 'return_exchange'
    });
}

async function sendRefundStatusNotification({
    to,
    customerName,
    orderReference,
    refundAmount,
    refundMethod,
    refundStatus
}) {
    if (!to) return { success: false, skipped: true };

    return sendMail({
        to,
        subject: `Refund update for Order ${orderReference}`,
        text:
            `Hi ${customerName || 'Customer'},\n\n` +
            `Your refund status for order ${orderReference} is now ${refundStatus}.\n` +
            `Amount: Rs. ${Number(refundAmount || 0).toFixed(2)}\n` +
            `Mode: ${refundMethod || 'Original Payment'}\n\n` +
            `Thank you,\nDEVASTHRA`,
        html: buildEmailShell({
            eyebrow: 'Refund Update',
            title: `Order ${orderReference}`,
            intro: `Hi ${customerName || 'Customer'}, your refund status has been updated.`,
            bodyHtml: `
                <div style="background:#fff;border:1px solid #ecd8cf;border-radius:16px;padding:16px 18px;">
                    <p style="margin:0 0 8px;"><strong>Refund Status:</strong> ${refundStatus || 'Updated'}</p>
                    <p style="margin:0 0 8px;"><strong>Refund Amount:</strong> Rs. ${Number(refundAmount || 0).toFixed(2)}</p>
                    <p style="margin:0;"><strong>Refund Mode:</strong> ${refundMethod || 'Original Payment'}</p>
                </div>
            `,
            footerNote: 'If you have any questions, reply to this email and our team will help.'
        }),
        mailPurpose: 'refunds'
    });
}

async function sendAdminOTP(otp) {
    const { supportEmail } = getMailerConfig();
    if (!supportEmail) return { success: false, skipped: true };

    return sendMail({
        to: supportEmail,
        subject: `DEVASTHRA Admin Login OTP: ${otp}`,
        text: `Your DEVASTHRA admin login OTP is ${otp}. This code expires in 5 minutes.`,
        html: buildEmailShell({
            eyebrow: 'Admin Login',
            title: 'Your admin login OTP',
            intro: 'Use the code below to complete your admin login. It expires in 5 minutes.',
            bodyHtml: `
                <div style="display:inline-block;padding:14px 22px;border-radius:14px;background:#700823;color:#ffffff;font-size:30px;font-weight:700;letter-spacing:0.28em;">
                    ${otp}
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#7b6668;">
                    If you did not attempt to login, please secure your account immediately.
                </p>
            `,
            footerNote: 'This OTP was sent to the registered admin email.'
        })
    });
}

module.exports = {
    getMailerConfig,
    setMailerRuntimeConfig,
    bootstrapMailerRuntimeConfig,
    isMailerConfigured,
    sendMail,
    sendLoginCodeEmail,
    sendOrderConfirmationEmail,
    sendContactFormEmails,
    sendNewsletterSignupEmail,
    sendNewsletterAdminNotification,
    sendAdminOrderNotification,
    sendCancellationRequestNotification,
    sendReturnRequestNotification,
    sendExchangeRequestNotification,
    sendRefundStatusNotification,
    sendAdminOTP,
    ensureAdminMailerColumns,
    getActiveAdminMailerCredentials
};

