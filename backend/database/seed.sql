USE ecommerce_db;

-- =========================================
-- SEED: Catalog Taxonomy
-- =========================================
INSERT INTO catalog_hierarchy (id, parent_id, node_type, name, slug, available_colors, display_order)
VALUES
    (1, NULL, 'audience', 'Men', 'men', NULL, 1),
    (2, NULL, 'audience', 'Women', 'women', NULL, 2),
    (3, NULL, 'audience', 'Kids', 'kids', NULL, 3),
    (10, 1, 'fashion', 'Top Wear', 'top-wear', NULL, 1),
    (11, 1, 'fashion', 'Bottom Wear', 'bottom-wear', NULL, 2),
    (12, 1, 'fashion', 'Footwear', 'footwear', NULL, 3),
    (13, 1, 'fashion', 'Accessories', 'accessories', NULL, 4),
    (20, 10, 'category', 'T-Shirts', 't-shirts', '["Black","White","Navy Blue","Olive","Maroon"]', 1),
    (21, 10, 'category', 'Shirts', 'shirts', '["White","Sky Blue","Black","Beige"]', 2),
    (22, 11, 'category', 'Pants', 'pants', '["Black","Grey","Khaki","Navy Blue"]', 1),
    (23, 11, 'category', 'Shorts', 'shorts', '["Black","Grey","Olive"]', 2),
    (24, 12, 'category', 'Shoes', 'shoes', '["Black","White","Brown"]', 1),
    (25, 13, 'category', 'Watches', 'watches', '["Black","Brown","Silver"]', 1),
    (30, 20, 'subcategory', 'Polo', 'polo', '["Black","White","Navy Blue","Maroon"]', 1),
    (31, 20, 'subcategory', 'Round Neck', 'round-neck', '["Black","White","Navy Blue","Olive"]', 2),
    (32, 20, 'subcategory', 'Oversized', 'oversized', '["Black","Off White","Olive","Brown"]', 3),
    (33, 21, 'subcategory', 'Formal', 'formal', '["White","Sky Blue","Grey"]', 1),
    (34, 21, 'subcategory', 'Casual', 'casual', '["Black","Olive","Beige"]', 2),
    (35, 22, 'subcategory', 'Formal Pants', 'formal-pants', '["Black","Grey","Navy Blue"]', 1),
    (36, 22, 'subcategory', 'Sports', 'sports', '["Black","Grey","Olive"]', 2),
    (37, 23, 'subcategory', 'Casual Shorts', 'casual-shorts', '["Black","Grey","Olive"]', 1),
    (38, 24, 'subcategory', 'Crocs', 'crocs', '["Black","White","Navy Blue"]', 1),
    (39, 24, 'subcategory', 'Formals', 'formals', '["Black","Brown","Tan"]', 2),
    (40, 25, 'subcategory', 'Analog', 'analog', '["Black","Brown","Silver"]', 1),
    (50, 2, 'fashion', 'Top Wear', 'top-wear', NULL, 1),
    (51, 2, 'fashion', 'Bottom Wear', 'bottom-wear', NULL, 2),
    (52, 2, 'fashion', 'Footwear', 'footwear', NULL, 3),
    (53, 2, 'fashion', 'Accessories', 'accessories', NULL, 4),
    (60, 50, 'category', 'Kurtis', 'kurtis', '["Pink","Yellow","Blue","Green"]', 1),
    (61, 50, 'category', 'Tops', 'tops', '["White","Black","Peach","Lavender"]', 2),
    (62, 51, 'category', 'Jeans', 'jeans', '["Blue","Black","Grey"]', 1),
    (63, 52, 'category', 'Heels', 'heels', '["Black","Nude","Gold"]', 1),
    (64, 53, 'category', 'Bags', 'bags', '["Black","Tan","Cream"]', 1),
    (70, 60, 'subcategory', 'Printed Kurtis', 'printed-kurtis', '["Pink","Yellow","Blue"]', 1),
    (71, 60, 'subcategory', 'Casual Kurtis', 'casual-kurtis', '["Green","Blue","White"]', 2),
    (72, 61, 'subcategory', 'Casual Tops', 'casual-tops', '["White","Peach","Lavender"]', 1),
    (73, 62, 'subcategory', 'Skinny', 'skinny', '["Blue","Black","Grey"]', 1),
    (74, 63, 'subcategory', 'Party Heels', 'party-heels', '["Black","Gold","Nude"]', 1),
    (75, 64, 'subcategory', 'Handbags', 'handbags', '["Black","Tan","Cream"]', 1),
    (90, 3, 'fashion', 'Top Wear', 'top-wear', NULL, 1),
    (91, 3, 'fashion', 'Bottom Wear', 'bottom-wear', NULL, 2),
    (92, 3, 'fashion', 'Footwear', 'footwear', NULL, 3),
    (93, 3, 'fashion', 'Accessories', 'accessories', NULL, 4)
ON DUPLICATE KEY UPDATE
    parent_id = VALUES(parent_id),
    node_type = VALUES(node_type),
    name = VALUES(name),
    available_colors = VALUES(available_colors),
    display_order = VALUES(display_order),
    is_active = TRUE;

-- =========================================
-- SEED: Admin account
-- Active admin login seed
-- =========================================

INSERT INTO admins (id, username, password, support_email, smtp_app_password, is_active)
VALUES (1, 'admin', '$2a$10$W/5.oItHrCx4x7X6J/BLiOiG7Uhu60wARheAAP5vulw2LQAhnqBuG', 'support@devasthra.com', 'NatooKart@2026', TRUE)
ON DUPLICATE KEY UPDATE
    username = VALUES(username),
    password = VALUES(password),
    support_email = VALUES(support_email),
    smtp_app_password = VALUES(smtp_app_password),
    is_active = VALUES(is_active);
-- bcrypt hash of: NatooKart@2026

-- To use a different password, generate a hash with:
-- node -e "const b=require('bcryptjs');console.log(b.hashSync('YourPassword',10))"

-- Seed default return settings
INSERT IGNORE INTO return_settings (id, default_return_window, return_policy_text) 
VALUES (1, 7, 'Easy returns within 7 days of delivery. Items must be unused with all original tags attached.');

-- =========================================
-- SEED: Default store config
-- =========================================
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
    ('order_reference_prefix', 'NatDev'),
    ('order_reference_start', '1'),
    ('cod_enabled', '1'),
    ('min_order_value', '499'),
    ('maintenance_enabled', '0'),
    ('maintenance_message', ''),
    ('maintenance_expected_back_at', ''),
    ('privacy_policy_title', 'Privacy Policy'),
    ('privacy_policy_last_updated', 'March 27, 2026'),
    ('privacy_policy_content', 'Privacy Policy\n\nIntroduction\nDEVASTHRA respects your privacy and is committed to protecting your personal data. This privacy policy explains how we collect, use, disclose, and safeguard your information when you visit our website.\n\nThis website is operated by NATOO KART TECHNOLOGIES PRIVATE LIMITED.\n\nInformation We Collect\nWe may collect personal information you provide while placing orders, signing up, or contacting us, along with technical and usage information required to operate and improve the site.\n\nHow We Use Your Information\nWe use your information to process orders, provide support, communicate important updates, improve the website experience, and meet legal or operational obligations.\n\nThird-Party Services\nWe may share necessary data with trusted third-party service providers such as payment, delivery, analytics, and communication partners strictly for service fulfillment.\n\nYour Rights\nYou may contact us to request access, correction, or deletion of your personal data, subject to applicable law and legitimate business requirements.\n\nContact Us\nIf you have questions about this privacy policy, please contact NATOO KART TECHNOLOGIES PRIVATE LIMITED at admin.support@natookart.com.'),
    ('privacy_policy_document_url', ''),
    ('refund_replacement_policy_title', 'Refund and Replacement Policy'),
    ('refund_replacement_policy_last_updated', 'May 14, 2026'),
    ('refund_replacement_policy_content', 'Refund and Replacement Policy\n\nRefund and Replacement\nYou can request a replacement within 24 hours of product delivery. Return will be processed within 2-4 days.\n\nRefund will be processed and credited within 7-10 working days.'),
    ('refund_replacement_policy_document_url', ''),
    ('exchange_policy_title', 'Exchange Policy'),
    ('exchange_policy_last_updated', 'May 14, 2026'),
    ('exchange_policy_content', 'Exchange Policy\n\nExchange\nThe product must be returned in its original condition, with all tags, packaging, and accessories.\n\nOnce we receive the returned item and verify the issue, we will initiate the replacement process. If a replacement is not available, a refund will be issued as per the refund policy. Replacement or exchanges will be delivered within 7-10 working days.'),
    ('exchange_policy_document_url', ''),
    ('shipping_policy_title', 'Shipping Policy'),
    ('shipping_policy_last_updated', 'May 14, 2026'),
    ('shipping_policy_content', 'Shipping Policy\n\nShipping Time\nAfter processing, your order will be shipped within 5 business days. All the products will be delivered within 5-7 business days.'),
    ('shipping_policy_document_url', '');
