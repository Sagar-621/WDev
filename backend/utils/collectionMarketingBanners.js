async function ensureCollectionMarketingBannerTable(db) {
    return;
}

function normalizeCollectionMarketingBanner(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        title: row.title || '',
        description: row.description || '',
        image_url: row.image_url || '',
        image_file_id: row.image_file_id || '',
        button_link: row.button_link || '',
        is_active: Boolean(row.is_active),
        display_order: Number(row.display_order || 0),
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
}

async function getCollectionMarketingBanners(db, { includeInactive = false } = {}) {
    await ensureCollectionMarketingBannerTable(db);
    let query = 'SELECT * FROM collection_marketing_banners';
    if (!includeInactive) {
        query += ' WHERE is_active = TRUE';
    }
    query += ' ORDER BY display_order ASC, id ASC';
    const [rows] = await db.execute(query);
    return rows.map(normalizeCollectionMarketingBanner);
}

module.exports = {
    ensureCollectionMarketingBannerTable,
    getCollectionMarketingBanners,
    normalizeCollectionMarketingBanner
};

