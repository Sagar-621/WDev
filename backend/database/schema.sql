-- =========================================
-- DATABASE
-- =========================================
CREATE DATABASE IF NOT EXISTS ecommerce_db;
USE ecommerce_db;

-- =========================================
-- 1. USERS (Registered customers)
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mobile_number VARCHAR(15) NOT NULL UNIQUE,
    name VARCHAR(100) NULL,
    email VARCHAR(255) NULL,
    dob DATE NULL,
    gender ENUM('Male','Female','Others') NULL, 
    address_line VARCHAR(255) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    pincode VARCHAR(10) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================
-- 2. OTP VERIFICATION (Legacy mobile login)
-- =========================================
CREATE TABLE IF NOT EXISTS otp_verification (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mobile_number VARCHAR(15) NOT NULL,
    otp VARCHAR(100) NOT NULL,
    expires_at DATETIME NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mobile (mobile_number)
);

-- =========================================
-- 2b. EMAIL VERIFICATION
-- =========================================
CREATE TABLE IF NOT EXISTS email_verification (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    expires_at DATETIME NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_verification_email (email)
);

-- =========================================
-- 3. USER ADDRESSES (Multiple delivery addresses per user)
-- =========================================
CREATE TABLE IF NOT EXISTS user_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) NOT NULL,
    address_line VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    recipient_name VARCHAR(100) NULL ,
    recipient_phone VARCHAR(15) NULL ,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_addresses_user (user_id),
    INDEX idx_user_addresses_default (user_id, is_default)
);


-- =========================================
-- 4. CATALOG TAXONOMY
-- =========================================
CREATE TABLE IF NOT EXISTS catalog_hierarchy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id INT NULL,
    node_type ENUM('audience','fashion','category','subcategory') NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    available_colors TEXT NULL COMMENT 'JSON array of allowed colors for category/subcategory',
    size_guide_json TEXT NULL COMMENT 'JSON size guide table for subcategories',
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_catalog_hierarchy_parent FOREIGN KEY (parent_id) REFERENCES catalog_hierarchy(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_catalog_hierarchy_node (parent_id, node_type, slug),
    INDEX idx_catalog_hierarchy_parent (parent_id, node_type, display_order),
    INDEX idx_catalog_hierarchy_type (node_type, is_active, display_order)
);

-- =========================================
-- 5. PRODUCTS
-- =========================================
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sku VARCHAR(100) UNIQUE,
    parent_product_id INT NULL,
    is_main_product BOOLEAN DEFAULT FALSE,
    display_order INT DEFAULT 0,
    catalog_audience_id INT NULL,
    catalog_fashion_group_id INT NULL,
    catalog_category_id INT NULL,
    catalog_subcategory_id INT NULL,
    fashion_group VARCHAR(100),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    brand VARCHAR(100),
    color TEXT COMMENT 'JSON array of selected colors',
    ideal_for VARCHAR(50),
    price DECIMAL(10,2) NOT NULL,
    original_price DECIMAL(10,2) NULL,
    min_order_qty INT DEFAULT 1,
    listing_status ENUM('Active','Inactive','Draft') DEFAULT 'Active',
    image_url VARCHAR(500),
    catalog_folder VARCHAR(200),
    catalog_images TEXT COMMENT 'JSON array of image filenames',
    highlights TEXT COMMENT 'JSON array of highlight strings',
    sizes TEXT COMMENT 'JSON array of size strings',
    badge VARCHAR(50) NULL,
    badge_class VARCHAR(50) NULL,
    stock INT DEFAULT 0,
    image_file_id VARCHAR(255) NULL COMMENT 'ImageKit file ID for main image deletion',
    is_returnable BOOLEAN DEFAULT TRUE,
    return_window_days INT DEFAULT 7 COMMENT 'Return window in days after delivery',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_parent FOREIGN KEY (parent_product_id) REFERENCES products(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_catalog_audience FOREIGN KEY (catalog_audience_id) REFERENCES catalog_hierarchy(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_catalog_fashion FOREIGN KEY (catalog_fashion_group_id) REFERENCES catalog_hierarchy(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_catalog_category FOREIGN KEY (catalog_category_id) REFERENCES catalog_hierarchy(id) ON DELETE SET NULL,
    CONSTRAINT fk_products_catalog_subcategory FOREIGN KEY (catalog_subcategory_id) REFERENCES catalog_hierarchy(id) ON DELETE SET NULL,
    INDEX idx_products_parent (parent_product_id),
    INDEX idx_products_main (is_main_product),
    INDEX idx_products_display (display_order),
    INDEX idx_products_catalog_audience (catalog_audience_id),
    INDEX idx_products_catalog_fashion (catalog_fashion_group_id),
    INDEX idx_products_catalog_category (catalog_category_id),
    INDEX idx_products_catalog_subcategory (catalog_subcategory_id)
);

-- =========================================
-- 5. CART
-- =========================================
CREATE TABLE IF NOT EXISTS cart (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT DEFAULT 1,
    size VARCHAR(10) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_product_size (user_id, product_id, size),
    INDEX idx_cart_user (user_id)
);

-- =========================================
-- 6. ORDERS
-- =========================================
CREATE TABLE IF NOT EXISTS orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    subtotal_amount DECIMAL(10,2) NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    coupon_id INT NULL,
    coupon_code VARCHAR(50) NULL,
    status ENUM('Pending','Paid','Packed','Shipped','Delivered','Cancelled') DEFAULT 'Pending',
    payment_method ENUM('Prepaid','COD') DEFAULT 'Prepaid',
    invoice_number VARCHAR(50) NULL,
    invoice_date DATETIME NULL,
    delivery_date DATETIME NULL,
    return_eligible_until DATE NULL COMMENT 'Auto-set when delivered: delivery_date + return_window_days',
    cancellation_request_status ENUM('None','Requested','Approved','Rejected') NOT NULL DEFAULT 'None',
    cancellation_reason VARCHAR(120) NULL,
    cancellation_reason_detail TEXT NULL,
    cancellation_requested_at DATETIME NULL,
    cancellation_reviewed_at DATETIME NULL,
    shiprocket_order_id VARCHAR(100) NULL COMMENT 'Shiprocket order ID after auto-sync',
    shiprocket_shipment_id VARCHAR(100) NULL COMMENT 'Shiprocket shipment ID after auto-sync',
    shiprocket_awb_code VARCHAR(100) NULL COMMENT 'Assigned AWB code from Shiprocket',
    shiprocket_courier_name VARCHAR(150) NULL COMMENT 'Courier name assigned by Shiprocket',
    shiprocket_status VARCHAR(150) NULL COMMENT 'Latest Shiprocket shipment status',
    shiprocket_tracking_status VARCHAR(150) NULL COMMENT 'Tracking status summary for customer-facing tracking',
    shiprocket_latest_activity VARCHAR(255) NULL COMMENT 'Latest shipment activity text',
    shiprocket_latest_activity_at DATETIME NULL COMMENT 'Timestamp of latest shipment activity',
    shiprocket_tracking_json LONGTEXT NULL COMMENT 'Latest raw tracking payload from Shiprocket',
    shiprocket_pickup_scheduled BOOLEAN DEFAULT FALSE COMMENT 'Whether pickup was generated in Shiprocket',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_orders_user (user_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_coupon_id (coupon_id),
    INDEX idx_orders_coupon_code (coupon_code)
);

-- =========================================
-- 6b. ORDER ADDRESSES (Snapshot of delivery address per order)
-- =========================================
CREATE TABLE IF NOT EXISTS order_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL UNIQUE,
    user_address_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) NOT NULL,
    address_line VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_order_address_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_order_address_user_address FOREIGN KEY (user_address_id) REFERENCES user_addresses(id) ON DELETE RESTRICT,
    INDEX idx_order_addresses_order (order_id),
    INDEX idx_order_addresses_user_address (user_address_id)
);

-- =========================================
-- 7. ORDER ITEMS
-- =========================================
CREATE TABLE IF NOT EXISTS order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    size VARCHAR(10) NULL,
    price DECIMAL(10,2) NOT NULL,
    CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- =========================================
-- 8. PAYMENTS (Gateway Transactions)
-- =========================================
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    gateway VARCHAR(30) NULL,
    gateway_txn_id VARCHAR(100) NULL,
    gateway_payment_id VARCHAR(100) NULL,
    gateway_signature VARCHAR(255) NULL,
    gateway_response LONGTEXT NULL,
    hash_verified BOOLEAN DEFAULT FALSE,
    amount DECIMAL(10,2) NOT NULL,
    STATUS ENUM('Created','Success','Failed') DEFAULT 'Created',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    INDEX idx_payments_order (order_id),
    INDEX idx_payments_gateway_txn (gateway, gateway_txn_id),
    INDEX idx_payments_gateway_payment (gateway, gateway_payment_id)
);

-- =========================================
-- 8a. PHONEPE TRANSACTIONS
-- =========================================
CREATE TABLE IF NOT EXISTS phonepe_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    payment_id INT NULL,
    merchant_order_id VARCHAR(80) NOT NULL,
    phonepe_order_id VARCHAR(80) NULL,
    state VARCHAR(30) NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    expire_at DATETIME NULL,
    payment_mode VARCHAR(50) NULL,
    transaction_id VARCHAR(100) NULL,
    transaction_state VARCHAR(30) NULL,
    error_code VARCHAR(80) NULL,
    detailed_error_code VARCHAR(80) NULL,
    redirect_url TEXT NULL,
    meta_info LONGTEXT NULL,
    request_payload LONGTEXT NULL,
    response_payload LONGTEXT NULL,
    webhook_event VARCHAR(80) NULL,
    webhook_authorization_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_phonepe_transaction_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    CONSTRAINT fk_phonepe_transaction_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
    INDEX idx_phonepe_order (order_id),
    INDEX idx_phonepe_payment (payment_id),
    INDEX idx_phonepe_merchant_order (merchant_order_id),
    INDEX idx_phonepe_transaction (transaction_id)
);

-- =========================================
-- 8b. COUPONS
-- =========================================
CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_type ENUM('flat','percentage') NOT NULL DEFAULT 'percentage',
    discount_value DECIMAL(10,2) NOT NULL,
    max_discount DECIMAL(10,2) NULL,
    min_order_value DECIMAL(10,2) DEFAULT 0,
    scope ENUM('all','category','product') DEFAULT 'all',
    scope_ids TEXT NULL COMMENT 'JSON array of category/product IDs',
    usage_limit INT NULL,
    used_count INT DEFAULT 0,
    per_user_limit INT DEFAULT 1,
    start_date DATETIME NULL,
    end_date DATETIME NULL,
    is_active BOOLEAN DEFAULT TRUE,
    send_in_newsletter BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_coupons_code (code),
    INDEX idx_coupons_active (is_active, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS coupon_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coupon_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_coupon_usage_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    CONSTRAINT fk_coupon_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_coupon_usage_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    UNIQUE KEY uniq_coupon_usage_order (order_id),
    INDEX idx_coupon_usage_coupon (coupon_id),
    INDEX idx_coupon_usage_user (user_id, coupon_id)
);

-- =========================================
-- 9. ADMINS
-- =========================================
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    support_email VARCHAR(255) NULL,
    smtp_app_password VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================
-- 10. SYSTEM SETTINGS
-- =========================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(120) NOT NULL UNIQUE,
    setting_value TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legal_policy_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    policy_type VARCHAR(60) NOT NULL,
    title VARCHAR(255) NOT NULL,
    last_updated_label VARCHAR(120) NULL,
    content LONGTEXT NOT NULL,
    document_url TEXT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    created_by_admin_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME NULL,
    INDEX idx_legal_policy_type_created (policy_type, created_at DESC),
    INDEX idx_legal_policy_current (policy_type, is_current),
    CONSTRAINT fk_legal_policy_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

-- =========================================
-- 11. AUDIT LOGS (Accountability trail)
-- =========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NULL COMMENT 'FK to admins',
    user_id INT NULL COMMENT 'FK to users',
    action VARCHAR(50) NOT NULL COMMENT 'LOGIN, CREATE, UPDATE, DELETE, STATUS_CHANGE',
    entity_type VARCHAR(50) NOT NULL COMMENT 'product, order, user, return, etc.',
    entity_id INT NULL COMMENT 'ID of the affected record',
    old_values JSON NULL,
    new_values JSON NULL,
    description TEXT NULL,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_entity (entity_type, entity_id),
    INDEX idx_audit_date (created_at)
);

CREATE TABLE IF NOT EXISTS site_banners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    slot_key VARCHAR(60) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    kicker VARCHAR(120) NULL,
    subtitle VARCHAR(255) NULL,
    description TEXT NULL,
    button_text VARCHAR(120) NULL,
    button_link VARCHAR(255) NULL,
    secondary_button_text VARCHAR(120) NULL,
    secondary_button_link VARCHAR(255) NULL,
    image_url TEXT NULL,
    image_file_id VARCHAR(255) NULL,
    mobile_image_url TEXT NULL,
    mobile_image_file_id VARCHAR(255) NULL,
    countdown_target DATETIME NULL,
    show_countdown BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_site_banners_active (is_active, display_order),
    INDEX idx_site_banners_slot (slot_key)
);

-- =========================================
-- 12. COLLECTION MARKETING BANNERS
-- =========================================
CREATE TABLE IF NOT EXISTS collection_marketing_banners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    image_url TEXT NOT NULL,
    image_file_id VARCHAR(255) NULL,
    button_link VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_collection_marketing_active (is_active, display_order)
);

-- =========================================
-- 13. RETURN REQUESTS
-- =========================================
CREATE TABLE IF NOT EXISTS return_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_item_id INT NOT NULL,
    user_id INT NOT NULL,
    product_name VARCHAR(200) NULL COMMENT 'Cached product name for quick display',
    reason ENUM(
        'Size Issue','Defective','Wrong Product','Not as Described',
        'Quality Issue','Changed Mind','Other'
    ) NOT NULL,
    sub_reason VARCHAR(255) NULL,
    description TEXT NULL,
    proof_images TEXT NULL COMMENT 'JSON array of uploaded image paths',
    status ENUM(
        'Requested','Approved','Rejected','Pickup Scheduled',
        'Picked Up','Refund Initiated','Refund Completed','Closed'
    ) DEFAULT 'Requested',
    admin_remarks TEXT NULL,
    refund_amount DECIMAL(10,2) NULL,
    refund_method ENUM('Original Payment','Store Credit') DEFAULT 'Original Payment',
    shiprocket_return_order_id VARCHAR(50) NULL COMMENT 'Shiprocket return order ID for reverse pickup',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_return_item FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_return_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_return_order (order_id),
    INDEX idx_return_status (status),
    INDEX idx_return_user (user_id)
);

CREATE TABLE IF NOT EXISTS exchange_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_item_id INT NOT NULL,
    user_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(200) NULL,
    requested_size VARCHAR(20) NULL,
    reason VARCHAR(120) NOT NULL,
    reason_detail TEXT NULL,
    status ENUM(
        'Requested','Approved','Rejected',
        'Exchange Approved','Re-shipped','Exchange Completed'
    ) DEFAULT 'Requested',
    admin_remarks TEXT NULL,
    shiprocket_exchange_order_id VARCHAR(100) NULL,
    replacement_order_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_exchange_order FOREIGN KEY (order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_exchange_item FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
    CONSTRAINT fk_exchange_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_exchange_order (order_id),
    INDEX idx_exchange_item (order_item_id),
    INDEX idx_exchange_user (user_id),
    INDEX idx_exchange_status (status)
);

CREATE TABLE IF NOT EXISTS refund_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    return_request_id INT NULL,
    exchange_request_id INT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    mode ENUM('Original Payment','Store Credit','Manual Transfer') DEFAULT 'Original Payment',
    status ENUM('Refund Initiated','Refund Completed','Refund Failed') DEFAULT 'Refund Initiated',
    gateway_reference VARCHAR(120) NULL,
    remarks TEXT NULL,
    initiated_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_refund_return_request FOREIGN KEY (return_request_id) REFERENCES return_requests(id) ON DELETE SET NULL,
    CONSTRAINT fk_refund_exchange_request FOREIGN KEY (exchange_request_id) REFERENCES exchange_requests(id) ON DELETE SET NULL,
    INDEX idx_refund_order (order_id),
    INDEX idx_refund_return_request (return_request_id),
    INDEX idx_refund_exchange_request (exchange_request_id),
    INDEX idx_refund_status (status)
);

-- =========================================
-- 14. RETURN SETTINGS (Admin-configurable)
-- =========================================
CREATE TABLE IF NOT EXISTS return_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    default_return_window INT DEFAULT 7,
    return_policy_text TEXT NULL,
    non_returnable_categories TEXT NULL COMMENT 'JSON array of category names',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================================
-- 15. PRODUCT IMAGES (ImageKit Integration)
-- =========================================
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    imagekit_id VARCHAR(255) UNIQUE NOT NULL COMMENT 'ImageKit file ID for deletion/management',
    imagekit_url VARCHAR(500) NOT NULL COMMENT 'CDN URL from ImageKit',
    folder VARCHAR(100) DEFAULT 'products' COMMENT 'ImageKit folder: products, collections, etc',
    display_order INT DEFAULT 0 COMMENT 'Order for gallery display',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_images_product (product_id),
    INDEX idx_product_images_display (product_id, display_order)
);

-- =========================================
-- 16. PRODUCT SIZE INVENTORY
-- =========================================
CREATE TABLE IF NOT EXISTS product_size_inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    size VARCHAR(20) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_size_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_product_size (product_id, size),
    INDEX idx_size_inventory_product (product_id)
);

-- =========================================
-- 17. SUPPORT CHAT
-- =========================================
CREATE TABLE IF NOT EXISTS support_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    status ENUM('Open','Closed') DEFAULT 'Open',
    last_message_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_support_conversation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_support_conversation_status (status),
    INDEX idx_support_conversation_last_message (last_message_at)
);

CREATE TABLE IF NOT EXISTS support_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_type ENUM('user','admin') NOT NULL,
    sender_user_id INT NULL,
    sender_admin_id INT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_support_message_conversation FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_support_message_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_support_message_admin FOREIGN KEY (sender_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
    INDEX idx_support_message_conversation (conversation_id, created_at)
);

-- =========================================
-- 18. CONTACT MESSAGES
-- =========================================
CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status ENUM('New','Reviewed') DEFAULT 'New',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,
    INDEX idx_contact_messages_status (status),
    INDEX idx_contact_messages_created (created_at)
);

-- =========================================
-- 19. NEWSLETTER SIGNUPS
-- =========================================
CREATE TABLE IF NOT EXISTS newsletter_signups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    source VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_newsletter_created (created_at)
);



