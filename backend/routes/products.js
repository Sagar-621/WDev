const express = require('express');
const router = express.Router();
const db = require('../db');
const {
    ensureInventorySchema,
    getProductSizeInventory,
    parseJsonArray
} = require('../utils/inventory');
const {
    ensureCatalogTables,
    fetchCatalogTaxonomy,
    flattenCatalogTaxonomy,
    parseSizeGuide
} = require('../utils/catalogTaxonomy');

let productColumnsReady = false;

async function ensureProductColumns() {
    if (productColumnsReady) return;
    await ensureCatalogTables(db);

    productColumnsReady = true;
}

function parseJson(value, fallback) {
    try {
        return JSON.parse(value || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

function cleanHighlightText(value) {
    return String(value || '')
        .replace(/^(?:\uFEFF|\u00A0|\s|•|·|â€¢|Ã¢â‚¬Â¢)+/u, '')
        .trim();
}

function parseProductRow(product) {
    return {
        ...product,
        color: parseJson(product.color, []),
        catalog_images: parseJson(product.catalog_images, []),
        highlights: parseJson(product.highlights, []).map(cleanHighlightText).filter(Boolean),
        sizes: parseJsonArray(product.sizes),
        avg_rating: product.avg_rating != null ? parseFloat(product.avg_rating) : null,
        review_count: parseInt(product.review_count) || 0
    };
}

async function enrichProductInventory(product) {
    const size_inventory = await getProductSizeInventory(product.id);
    const available_sizes = size_inventory.length
        ? size_inventory.filter(item => item.quantity > 0).map(item => item.size)
        : ((product.sizes || []).length && Number(product.stock) > 0 ? product.sizes : []);

    return {
        ...product,
        size_inventory,
        available_sizes,
        has_size_inventory: size_inventory.length > 0
    };
}

async function attachProductSizeGuide(product) {
    const subcategoryId = Number(product.catalog_subcategory_id) || null;
    if (subcategoryId) {
        const [rows] = await db.execute(
            `SELECT size_guide_json
             FROM catalog_hierarchy
             WHERE id = ? AND node_type = 'subcategory'
             LIMIT 1`,
            [subcategoryId]
        );
        const guide = parseSizeGuide(rows[0]?.size_guide_json || null);
        if (guide) {
            return {
                ...product,
                size_guide: guide
            };
        }
    }

    return {
        ...product,
        size_guide: null
    };
}

async function getCollectionProducts(baseProduct, parentProduct = null) {
    const rootProduct = baseProduct.is_main_product ? baseProduct : (parentProduct || baseProduct);
    const normalizedName = String(rootProduct.name || '').trim();

    let query = `
        SELECT *
        FROM products
        WHERE listing_status = 'Active'
          AND (
            id = ?
            OR parent_product_id = ?
          )
    `;
    const params = [rootProduct.id, rootProduct.id];

    if (normalizedName) {
        query += ' OR LOWER(TRIM(name)) = LOWER(TRIM(?))';
        params.push(normalizedName);
    }

    query += ' ORDER BY (id = ?) DESC, is_main_product DESC, display_order ASC, created_at DESC';
    params.push(rootProduct.id);

    const [rows] = await db.execute(query, params);
    const dedupedRows = rows.filter((row, index, list) => list.findIndex(item => Number(item.id) === Number(row.id)) === index);
    const enrichedRows = await Promise.all(dedupedRows.map(parseProductRow).map(enrichProductInventory));

    return {
        rootProduct,
        collectionProducts: enrichedRows,
        relatedProducts: enrichedRows.filter(item => Number(item.id) !== Number(rootProduct.id))
    };
}

router.get('/', async (req, res) => {
    try {
        await ensureProductColumns();
        await ensureInventorySchema();

        const { main_only, parent_id, product_type, category } = req.query;
        let query = `
            SELECT *
            FROM products
            WHERE listing_status = 'Active'
        `;
        const params = [];

        if (main_only === 'true') {
            query += ' AND is_main_product = 1';
        } else if (parent_id) {
            query += ' AND parent_product_id = ? AND stock > 0';
            params.push(Number(parent_id));
        } else {
            query += ' AND (is_main_product = 1 OR stock > 0)';
        }

        if (product_type) {
            query += ' AND product_type = ?';
            params.push(product_type);
        }

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        query += ' ORDER BY is_main_product DESC, display_order ASC, created_at DESC';

        const [rows] = await db.execute(query, params);
        const parsedProducts = rows.map(parseProductRow);
        const products = await Promise.all(parsedProducts.map(enrichProductInventory));
        res.json({ success: true, products });
    } catch (err) {
        console.error('GET /products error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products' });
    }
});

router.get('/taxonomy', async (req, res) => {
    try {
        await ensureProductColumns();
        const nested = await fetchCatalogTaxonomy(db, { includeInactive: true });
        const taxonomy = flattenCatalogTaxonomy(nested);
        res.json({ success: true, taxonomy, structuredTaxonomy: nested });
    } catch (err) {
        console.error('GET /products/taxonomy error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch catalog taxonomy' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await ensureProductColumns();
        await ensureInventorySchema();

        const [rows] = await db.execute('SELECT * FROM products WHERE id = ?', [id]);
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const baseProduct = parseProductRow(rows[0]);

        const [images] = await db.execute(
            `SELECT id, imagekit_id, imagekit_url
             FROM product_images
             WHERE product_id = ?
             ORDER BY display_order ASC`,
            [id]
        );

        const product = await attachProductSizeGuide(await enrichProductInventory({
            ...baseProduct,
            galleryImages: images.map(img => ({
                id: img.id,
                fileId: img.imagekit_id,
                url: img.imagekit_url,
                thumbnail: `${img.imagekit_url}?tr=w:100,h:100,c:cover`,
                medium: `${img.imagekit_url}?tr=w:400,h:500,c:cover`,
                large: `${img.imagekit_url}?tr=w:800,h:1000,c:cover`
            }))
        }));

        let parentProduct = null;
        let relatedProducts = [];
        let siblings = [];
        let collectionProducts = [];

        if (product.parent_product_id) {
            const [parentRows] = await db.execute('SELECT * FROM products WHERE id = ? LIMIT 1', [product.parent_product_id]);
            parentProduct = parentRows[0] ? parseProductRow(parentRows[0]) : null;
        }

        const collectionGroup = await getCollectionProducts(product, parentProduct);
        collectionProducts = collectionGroup.collectionProducts;
        relatedProducts = collectionProducts.filter(item => Number(item.id) !== Number(product.id));

        if (!product.is_main_product && product.parent_product_id) {
            siblings = relatedProducts.filter(item => Number(item.parent_product_id) === Number(product.parent_product_id));
        }

        res.json({ success: true, product, parentProduct, relatedProducts, siblings, collectionProducts, collectionRoot: collectionGroup.rootProduct });
    } catch (err) {
        console.error('GET /products/:id error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch product' });
    }
});

module.exports = router;

