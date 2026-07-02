function normalizeLabel(value, fallback = '') {
    const label = String(value || fallback).trim();
    if (!label) return '';
    return label
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item';
}

function normalizeAudience(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['men', 'man', 'male', 'gents', 'gentlemen'].includes(normalized)) return 'Men';
    if (['women', 'woman', 'female', 'ladies', 'lady'].includes(normalized)) return 'Women';
    if (['kids', 'kid', 'children', 'child', 'boys', 'girls'].includes(normalized)) return 'Kids';
    if (['unisex', 'all', 'all genders', 'everyone'].includes(normalized)) return 'Unisex';
    return '';
}

function normalizeFashionGroup(value) {
    return normalizeLabel(value);
}

function normalizeCategory(value) {
    return normalizeLabel(value);
}

function normalizeSubcategory(value) {
    return normalizeLabel(value);
}

function parseColorList(value) {
    let rawValues = [];
    if (Array.isArray(value)) {
        rawValues = value;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            rawValues = Array.isArray(parsed) ? parsed : trimmed.split(',');
        } catch {
            rawValues = trimmed.split(',');
        }
    }

    const unique = new Set();
    rawValues.forEach((entry) => {
        const normalized = normalizeLabel(entry);
        if (normalized) unique.add(normalized);
    });
    return Array.from(unique);
}

function parseSizeGuide(value) {
    if (!value) return null;

    let raw = value;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            raw = JSON.parse(trimmed);
        } catch {
            return null;
        }
    }

    if (!raw || typeof raw !== 'object') return null;

    const title = normalizeLabel(raw.title || raw.name || raw.label || 'Size Guide');
    const note = String(raw.note || raw.description || '').trim();
    const columns = Array.isArray(raw.columns)
        ? raw.columns.map((column) => String(column || '').trim()).filter(Boolean)
        : [];
    const rows = Array.isArray(raw.rows)
        ? raw.rows.map((row) => {
            if (Array.isArray(row)) {
                return row.map((cell) => String(cell ?? '').trim());
            }

            if (row && typeof row === 'object') {
                if (Array.isArray(row.values)) {
                    return [
                        String(row.label || row.size || row.name || '').trim(),
                        ...row.values.map((cell) => String(cell ?? '').trim())
                    ];
                }

                const orderedValues = columns.slice(1).map((column) => String(row[column] ?? row[column.toLowerCase()] ?? '').trim());
                return [String(row.label || row.size || row.name || '').trim(), ...orderedValues];
            }

            return [String(row ?? '').trim()];
        }).filter((row) => row.some(Boolean))
        : [];

    if (!columns.length || !rows.length) return null;

    return {
        title: title || 'Size Guide',
        note,
        columns,
        rows
    };
}

let catalogTablesReady = false;
let catalogTablesPromise = null;

async function ensureCatalogTables(db) {
    if (catalogTablesReady) return;
    if (catalogTablesPromise) return catalogTablesPromise;

    catalogTablesPromise = (async () => {
        const [guideColumns] = await db.execute(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'catalog_hierarchy'
               AND COLUMN_NAME = 'size_guide_json'`
        );
        if (!guideColumns.length) {
            await db.execute(`ALTER TABLE catalog_hierarchy ADD COLUMN size_guide_json TEXT NULL COMMENT 'JSON size guide table for subcategories'`);
        }
        catalogTablesReady = true;
    })();

    try {
        await catalogTablesPromise;
    } finally {
        catalogTablesPromise = null;
    }
}

async function ensureFixedAudiences(db) {
    await ensureCatalogTables(db);
    const fixedAudiences = [
        { name: 'Men', slug: 'men', display_order: 1 },
        { name: 'Women', slug: 'women', display_order: 2 },
        { name: 'Kids', slug: 'kids', display_order: 3 },
        { name: 'Unisex', slug: 'unisex', display_order: 4 }
    ];

    for (const audience of fixedAudiences) {
        const existing = await findNode(db, { parentId: null, nodeType: 'audience', slug: audience.slug });
        if (existing) {
            await db.execute(
                `UPDATE catalog_hierarchy SET name = ?, display_order = ?, is_active = TRUE WHERE id = ?`,
                [audience.name, audience.display_order, existing.id]
            );
        } else {
            await db.execute(
                `INSERT INTO catalog_hierarchy (parent_id, node_type, name, slug, display_order, is_active)
                 VALUES (NULL, 'audience', ?, ?, ?, TRUE)`,
                [audience.name, audience.slug, audience.display_order]
            );
        }
    }
}

async function getFixedAudienceRows(db) {
    await ensureFixedAudiences(db);
    const [rows] = await db.execute(
        `SELECT * FROM catalog_hierarchy WHERE node_type = 'audience' ORDER BY display_order ASC, name ASC`
    );
    return rows;
}

async function fetchCatalogTaxonomy(db, { includeInactive = false } = {}) {
    await ensureFixedAudiences(db);

    let query = `
        SELECT id, parent_id, node_type, name, slug, available_colors, size_guide_json, display_order, is_active
        FROM catalog_hierarchy
        WHERE 1 = 1
    `;
    if (!includeInactive) {
        query += ` AND is_active = TRUE`;
    }
    query += ` ORDER BY display_order ASC, name ASC`;

    const [rows] = await db.execute(query);
    const byId = new Map(rows.map(row => [row.id, { ...row, children: [] }]));
    const roots = [];

    rows.forEach((row) => {
        const entry = byId.get(row.id);
        if (row.parent_id && byId.has(row.parent_id)) {
            byId.get(row.parent_id).children.push(entry);
        } else {
            roots.push(entry);
        }
    });

    const structured = {};
    roots
        .filter(row => row.node_type === 'audience')
        .forEach((audience) => {
            const audienceIsActive = Boolean(audience.is_active);
            structured[audience.name] = {
                audienceId: audience.id,
                audience: audience.name,
                slug: audience.slug,
                isActive: audienceIsActive,
                selfIsActive: audienceIsActive,
                fashions: audience.children
                    .filter(child => child.node_type === 'fashion')
                    .map((fashion) => ({
                        id: fashion.id,
                        fashion: fashion.name,
                        slug: fashion.slug,
                        isActive: audienceIsActive && Boolean(fashion.is_active),
                        selfIsActive: Boolean(fashion.is_active),
                        lockedByParent: !audienceIsActive,
                        categories: fashion.children
                            .filter(child => child.node_type === 'category')
                            .map((category) => ({
                                id: category.id,
                                category: category.name,
                                slug: category.slug,
                                isActive: audienceIsActive && Boolean(fashion.is_active) && Boolean(category.is_active),
                                selfIsActive: Boolean(category.is_active),
                                lockedByParent: !audienceIsActive || !Boolean(fashion.is_active),
                                availableColors: parseColorList(category.available_colors),
                                subcategories: category.children
                                    .filter(child => child.node_type === 'subcategory')
                                    .map((subcategory) => ({
                                        id: subcategory.id,
                                        subcategory: subcategory.name,
                                        slug: subcategory.slug,
                                        isActive: audienceIsActive && Boolean(fashion.is_active) && Boolean(category.is_active) && Boolean(subcategory.is_active),
                                        selfIsActive: Boolean(subcategory.is_active),
                                        lockedByParent: !audienceIsActive || !Boolean(fashion.is_active) || !Boolean(category.is_active),
                                        availableColors: parseColorList(subcategory.available_colors),
                                        sizeGuideJson: subcategory.size_guide_json || null,
                                        sizeGuide: parseSizeGuide(subcategory.size_guide_json)
                                    }))
                            }))
                    }))
            };
        });

    return structured;
}

async function fetchCatalogHierarchyRows(db, { includeInactive = false } = {}) {
    await ensureFixedAudiences(db);
    let query = `
        SELECT id, parent_id, node_type, name, slug, available_colors, size_guide_json, display_order, is_active
        FROM catalog_hierarchy
        WHERE 1 = 1
    `;
    if (!includeInactive) {
        query += ` AND is_active = TRUE`;
    }
    query += ` ORDER BY display_order ASC, name ASC`;
    const [rows] = await db.execute(query);
    return rows;
}

function flattenCatalogTaxonomy(nestedTaxonomy = {}) {
    return Object.fromEntries(
        Object.entries(nestedTaxonomy).map(([audience, audienceEntry]) => [
            audience,
            (audienceEntry.fashions || []).flatMap((fashionEntry) =>
                (fashionEntry.categories || []).map((categoryEntry) => ({
                    id: categoryEntry.id,
                    fashion: fashionEntry.fashion,
                    fashionIsActive: Boolean(fashionEntry.isActive),
                    fashionSelfIsActive: Boolean(fashionEntry.selfIsActive),
                    audienceIsActive: Boolean(audienceEntry.isActive),
                    category: categoryEntry.category,
                    isActive: Boolean(categoryEntry.isActive),
                    selfIsActive: Boolean(categoryEntry.selfIsActive),
                    lockedByParent: Boolean(categoryEntry.lockedByParent),
                    subcategories: (categoryEntry.subcategories || []).map((sub) => ({
                        id: sub.id,
                        subcategory: sub.subcategory,
                        isActive: Boolean(sub.isActive),
                        selfIsActive: Boolean(sub.selfIsActive),
                        lockedByParent: Boolean(sub.lockedByParent),
                        sizeGuideJson: sub.sizeGuideJson || null,
                        sizeGuide: sub.sizeGuide || null
                    }))
                }))
            )
        ])
    );
}

function buildHierarchyMaps(rows) {
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    const childrenByParent = new Map();

    rows.forEach((row) => {
        const parentId = row.parent_id === null ? null : Number(row.parent_id);
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(row);
    });

    return { byId, childrenByParent };
}

function collectDescendantIds(childrenByParent, parentId) {
    const ids = [];
    const stack = [Number(parentId)];

    while (stack.length) {
        const current = stack.pop();
        const children = childrenByParent.get(current) || [];
        children.forEach((child) => {
            ids.push(Number(child.id));
            stack.push(Number(child.id));
        });
    }

    return ids;
}

function hasInactiveAncestor(byId, node) {
    let currentParentId = node.parent_id === null ? null : Number(node.parent_id);
    while (currentParentId !== null) {
        const parent = byId.get(currentParentId);
        if (!parent) break;
        if (!Boolean(parent.is_active)) return true;
        currentParentId = parent.parent_id === null ? null : Number(parent.parent_id);
    }
    return false;
}

async function findNode(db, { parentId, nodeType, slug }) {
    const [rows] = await db.execute(
        `SELECT * FROM catalog_hierarchy WHERE ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} AND node_type = ? AND slug = ? LIMIT 1`,
        parentId === null ? [nodeType, slug] : [parentId, nodeType, slug]
    );
    return rows[0] || null;
}

async function createNode(db, { parentId, nodeType, name, displayOrder = 0, availableColors = [], sizeGuideJson = undefined }) {
    const slug = slugify(name);
    const normalizedColors = parseColorList(availableColors);
    const normalizedSizeGuide = sizeGuideJson === undefined ? undefined : parseSizeGuide(sizeGuideJson);
    const existing = await findNode(db, { parentId, nodeType, slug });
    if (existing) {
        const updates = [];
        const params = [];
        if (normalizedColors.length && ['category', 'subcategory'].includes(nodeType)) {
            updates.push('available_colors = ?');
            params.push(JSON.stringify(normalizedColors));
        }
        if (normalizedSizeGuide !== undefined && nodeType === 'subcategory') {
            updates.push('size_guide_json = ?');
            params.push(normalizedSizeGuide ? JSON.stringify(normalizedSizeGuide) : null);
        }
        if (updates.length) {
            params.push(existing.id);
            await db.execute(
                `UPDATE catalog_hierarchy SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
            const [rows] = await db.execute(`SELECT * FROM catalog_hierarchy WHERE id = ? LIMIT 1`, [existing.id]);
            return rows[0];
        }
        return existing;
    }

    const insertColumns = ['parent_id', 'node_type', 'name', 'slug', 'available_colors', 'display_order', 'is_active'];
    const insertValues = [parentId, nodeType, name, slug, normalizedColors.length ? JSON.stringify(normalizedColors) : null, displayOrder, true];
    if (nodeType === 'subcategory' && normalizedSizeGuide !== undefined) {
        insertColumns.splice(5, 0, 'size_guide_json');
        insertValues.splice(5, 0, normalizedSizeGuide ? JSON.stringify(normalizedSizeGuide) : null);
    }

    const [result] = await db.execute(
        `INSERT INTO catalog_hierarchy (${insertColumns.join(', ')})
         VALUES (${insertColumns.map(() => '?').join(', ')})`,
        insertValues
    );
    const [rows] = await db.execute(`SELECT * FROM catalog_hierarchy WHERE id = ? LIMIT 1`, [result.insertId]);
    return rows[0];
}

async function ensureCatalogPath(db, { audience, fashionGroup, category, subcategory, availableColors, sizeGuideJson }) {
    await ensureFixedAudiences(db);

    const normalizedAudience = normalizeAudience(audience);
    const normalizedFashion = normalizeFashionGroup(fashionGroup);
    const normalizedCategory = normalizeCategory(category);
    const normalizedSubcategory = normalizeSubcategory(subcategory);

    if (!normalizedAudience || !normalizedFashion || !normalizedCategory) {
        throw new Error('Gender, fashion group, and category are required');
    }

    const audienceRow = await findNode(db, {
        parentId: null,
        nodeType: 'audience',
        slug: slugify(normalizedAudience)
    });
    if (!audienceRow) {
        throw new Error('Invalid gender. Allowed values: Men, Women, Kids, Unisex');
    }

    const fashionRow = await createNode(db, {
        parentId: audienceRow.id,
        nodeType: 'fashion',
        name: normalizedFashion
    });

    const categoryRow = await createNode(db, {
        parentId: fashionRow.id,
        nodeType: 'category',
        name: normalizedCategory,
        availableColors: normalizedSubcategory ? [] : availableColors
    });

    let subcategoryRow = null;
    if (normalizedSubcategory) {
        subcategoryRow = await createNode(db, {
            parentId: categoryRow.id,
            nodeType: 'subcategory',
            name: normalizedSubcategory,
            availableColors,
            sizeGuideJson
        });
    }

    return {
        audience: { id: audienceRow.id, name: audienceRow.name },
        fashionGroup: { id: fashionRow.id, name: fashionRow.name },
        category: { id: categoryRow.id, name: categoryRow.name },
        subcategory: subcategoryRow ? { id: subcategoryRow.id, name: subcategoryRow.name } : null
    };
}

async function getCatalogNodeById(db, id) {
    await ensureFixedAudiences(db);
    const [rows] = await db.execute(
        `SELECT id, parent_id, node_type, name, slug, available_colors, size_guide_json, display_order, is_active
         FROM catalog_hierarchy
         WHERE id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
}

async function updateCatalogNode(db, { id, name, availableColors, sizeGuideJson, isActive }) {
    const node = await getCatalogNodeById(db, id);
    if (!node) throw new Error('Catalog node not found');
    if (node.node_type === 'audience' && typeof isActive !== 'boolean' && typeof name !== 'string') {
        throw new Error('Fixed genders can only be enabled or disabled');
    }
    if (node.node_type === 'audience' && typeof name === 'string' && normalizeAudience(name) !== node.name) {
        throw new Error('Fixed genders cannot be renamed');
    }

    const resolvedName = typeof name === 'string' ? name : node.name;
    const normalizedName = node.node_type === 'audience'
        ? node.name
        : node.node_type === 'fashion'
            ? normalizeFashionGroup(resolvedName)
            : node.node_type === 'category'
                ? normalizeCategory(resolvedName)
                : normalizeSubcategory(resolvedName);

    if (!normalizedName) throw new Error('Name is required');

    const duplicate = await findNode(db, {
        parentId: node.parent_id,
        nodeType: node.node_type,
        slug: slugify(normalizedName)
    });
    if (duplicate && Number(duplicate.id) !== Number(node.id)) {
        throw new Error(`${node.node_type} already exists under the selected parent`);
    }

    const parsedColors = parseColorList(availableColors);
    const normalizedSizeGuide = sizeGuideJson === undefined ? undefined : parseSizeGuide(sizeGuideJson);
    const nextIsActive = typeof isActive === 'boolean' ? isActive : Boolean(node.is_active);
    const rows = await fetchCatalogHierarchyRows(db, { includeInactive: true });
    const { byId, childrenByParent } = buildHierarchyMaps(rows);

    if (nextIsActive && hasInactiveAncestor(byId, node)) {
        throw new Error('Enable the parent category first. Child categories stay locked while a parent is disabled.');
    }

    const updateColumns = ['name = ?', 'slug = ?', 'available_colors = ?', 'is_active = ?'];
    const updateValues = [
        normalizedName,
        slugify(normalizedName),
        ['category', 'subcategory'].includes(node.node_type) ? (parsedColors.length ? JSON.stringify(parsedColors) : null) : null,
        nextIsActive
    ];
    if (node.node_type === 'subcategory' && normalizedSizeGuide !== undefined) {
        updateColumns.splice(3, 0, 'size_guide_json = ?');
        updateValues.splice(3, 0, normalizedSizeGuide ? JSON.stringify(normalizedSizeGuide) : null);
    }
    updateValues.push(id);

    await db.execute(
        `UPDATE catalog_hierarchy
         SET ${updateColumns.join(', ')}
         WHERE id = ?`,
        updateValues
    );

    if (!nextIsActive) {
        const descendantIds = collectDescendantIds(childrenByParent, id);
        if (descendantIds.length) {
            const placeholders = descendantIds.map(() => '?').join(', ');
            await db.execute(
                `UPDATE catalog_hierarchy
                 SET is_active = FALSE
                 WHERE id IN (${placeholders})`,
                descendantIds
            );
        }
    }

    return getCatalogNodeById(db, id);
}

async function deleteCatalogNode(db, id) {
    const node = await getCatalogNodeById(db, id);
    if (!node) throw new Error('Catalog node not found');
    if (node.node_type === 'audience') throw new Error('Fixed genders cannot be deleted');

    const rows = await fetchCatalogHierarchyRows(db, { includeInactive: true });
    const childMap = new Map();
    rows.forEach((row) => {
        if (!childMap.has(row.parent_id)) childMap.set(row.parent_id, []);
        childMap.get(row.parent_id).push(row);
    });

    const idsToDelete = [];
    const stack = [node.id];
    while (stack.length) {
        const currentId = stack.pop();
        idsToDelete.push(currentId);
        const children = childMap.get(currentId) || [];
        children.forEach((child) => stack.push(child.id));
    }

    const placeholders = idsToDelete.map(() => '?').join(', ');
    const [[usage]] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM products
         WHERE catalog_audience_id IN (${placeholders})
            OR catalog_fashion_group_id IN (${placeholders})
            OR catalog_category_id IN (${placeholders})
            OR catalog_subcategory_id IN (${placeholders})`,
        [...idsToDelete, ...idsToDelete, ...idsToDelete, ...idsToDelete]
    );

    if (Number(usage.total) > 0) {
        throw new Error('This category path is already used by products and cannot be deleted');
    }

    await db.execute(
        `DELETE FROM catalog_hierarchy WHERE id IN (${placeholders})`,
        idsToDelete
    );

    return { deletedIds: idsToDelete };
}

module.exports = {
    deleteCatalogNode,
    ensureCatalogPath,
    ensureCatalogTables,
    ensureFixedAudiences,
    fetchCatalogTaxonomy,
    fetchCatalogHierarchyRows,
    flattenCatalogTaxonomy,
    getCatalogNodeById,
    getFixedAudienceRows,
    normalizeAudience,
    normalizeCategory,
    parseColorList,
    parseSizeGuide,
    normalizeFashionGroup,
    normalizeSubcategory,
    slugify,
    updateCatalogNode
};
