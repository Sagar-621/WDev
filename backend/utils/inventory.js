const db = require('../db');

let inventoryTablesReady = false;

function normalizeSize(size) {
    return String(size || '').trim().toUpperCase();
}

async function ensureInventorySchema() {
    if (inventoryTablesReady) return;

    inventoryTablesReady = true;
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function sanitizeSizeQuantities(sizeQuantities = {}, sizes = []) {
    const allowed = new Set((sizes || []).map(normalizeSize).filter(Boolean));
    const entries = Object.entries(sizeQuantities || {})
        .map(([size, quantity]) => ({
            size: normalizeSize(size),
            quantity: Math.max(0, Number.parseInt(quantity, 10) || 0)
        }))
        .filter(item => item.size);

    if (!allowed.size) return entries;
    return entries.filter(item => allowed.has(item.size));
}

function sumSizeQuantities(sizeInventory = []) {
    return sizeInventory.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

async function getProductSizeInventory(productId, conn = db) {
    await ensureInventorySchema();
    const [rows] = await conn.execute(
        `SELECT size, quantity
         FROM product_size_inventory
         WHERE product_id = ?
         ORDER BY FIELD(size, 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'), size`,
        [productId]
    );

    return rows.map(row => ({
        size: normalizeSize(row.size),
        quantity: Number(row.quantity) || 0
    }));
}

async function syncProductSizeInventory(productId, sizeQuantities = {}, sizes = [], conn = db) {
    await ensureInventorySchema();

    const sanitized = sanitizeSizeQuantities(sizeQuantities, sizes);

    await conn.execute('DELETE FROM product_size_inventory WHERE product_id = ?', [productId]);

    for (const item of sanitized) {
        await conn.execute(
            'INSERT INTO product_size_inventory (product_id, size, quantity) VALUES (?, ?, ?)',
            [productId, item.size, item.quantity]
        );
    }

    const totalStock = sumSizeQuantities(sanitized);
    await conn.execute('UPDATE products SET stock = ? WHERE id = ?', [totalStock, productId]);

    return sanitized;
}

async function getProductAvailability(productId, requestedSize = null, conn = db) {
    await ensureInventorySchema();

    const [productRows] = await conn.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [productId]);
    const product = productRows[0];

    if (!product) {
        return { product: null, sizeInventory: [], availableSizes: [], hasSizeInventory: false, totalAvailable: 0 };
    }

    const sizeInventory = await getProductSizeInventory(productId, conn);
    const sizes = parseJsonArray(product.sizes).map(normalizeSize).filter(Boolean);
    const hasSizeInventory = sizeInventory.length > 0;
    const availableSizes = hasSizeInventory
        ? sizeInventory.filter(item => item.quantity > 0).map(item => item.size)
        : (Number(product.stock) > 0 ? sizes : []);
    const totalAvailable = hasSizeInventory
        ? sumSizeQuantities(sizeInventory)
        : Math.max(0, Number(product.stock) || 0);
    const normalizedRequestedSize = normalizeSize(requestedSize);
    const requestedSizeRow = normalizedRequestedSize
        ? sizeInventory.find(item => item.size === normalizedRequestedSize) || null
        : null;

    return {
        product,
        sizeInventory,
        sizes,
        hasSizeInventory,
        availableSizes,
        totalAvailable,
        requestedSize: normalizedRequestedSize || null,
        requestedSizeRow
    };
}

async function reserveInventoryForItems(conn, items) {
    await ensureInventorySchema();

    for (const item of items) {
        const quantity = Math.max(1, Number.parseInt(item.quantity, 10) || 0);
        const requestedSize = normalizeSize(item.size);
        const availability = await getProductAvailability(item.product_id, requestedSize, conn);

        if (!availability.product) {
            const err = new Error('Product not found');
            err.statusCode = 404;
            throw err;
        }

        if (availability.hasSizeInventory) {
            if (!requestedSize) {
                const err = new Error(`Please select a size for ${availability.product.name}`);
                err.statusCode = 400;
                err.availableSizes = availability.availableSizes;
                throw err;
            }

            const row = availability.requestedSizeRow;
            if (!row || row.quantity < quantity) {
                let message = `${availability.product.name} is out of stock`;
                if (row && row.quantity < quantity) {
                    message = `${availability.product.name} has only ${row.quantity} piece(s) left in size ${requestedSize}`;
                } else if (availability.availableSizes.length) {
                    message = `${availability.product.name} is unavailable in size ${requestedSize}. Available sizes: ${availability.availableSizes.join(', ')}`;
                }
                const err = new Error(message);
                err.statusCode = 400;
                err.availableSizes = availability.availableSizes;
                err.productId = availability.product.id;
                throw err;
            }

            await conn.execute(
                'UPDATE product_size_inventory SET quantity = quantity - ? WHERE product_id = ? AND size = ?',
                [quantity, item.product_id, requestedSize]
            );
            await conn.execute(
                `UPDATE products
                 SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM product_size_inventory
                    WHERE product_id = ?
                 )
                 WHERE id = ?`,
                [item.product_id, item.product_id]
            );
            continue;
        }

        if ((Number(availability.product.stock) || 0) < quantity) {
            const err = new Error(`${availability.product.name} is out of stock`);
            err.statusCode = 400;
            err.productId = availability.product.id;
            throw err;
        }

        await conn.execute(
            'UPDATE products SET stock = stock - ? WHERE id = ?',
            [quantity, item.product_id]
        );
    }
}

async function restockInventoryForItems(conn, items) {
    await ensureInventorySchema();

    for (const item of items) {
        const quantity = Math.max(1, Number.parseInt(item.quantity, 10) || 0);
        const requestedSize = normalizeSize(item.size);
        const availability = await getProductAvailability(item.product_id, requestedSize, conn);

        if (!availability.product) continue;

        if (availability.hasSizeInventory && requestedSize) {
            await conn.execute(
                `INSERT INTO product_size_inventory (product_id, size, quantity)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                [item.product_id, requestedSize, quantity]
            );
            await conn.execute(
                `UPDATE products
                 SET stock = (
                    SELECT COALESCE(SUM(quantity), 0)
                    FROM product_size_inventory
                    WHERE product_id = ?
                 )
                 WHERE id = ?`,
                [item.product_id, item.product_id]
            );
            continue;
        }

        await conn.execute(
            'UPDATE products SET stock = stock + ? WHERE id = ?',
            [quantity, item.product_id]
        );
    }
}

module.exports = {
    ensureInventorySchema,
    getProductSizeInventory,
    getProductAvailability,
    syncProductSizeInventory,
    reserveInventoryForItems,
    restockInventoryForItems,
    normalizeSize,
    parseJsonArray,
    sanitizeSizeQuantities,
    sumSizeQuantities
};

