async function ensureBannerTable(db) {
    return;
}

function normalizeBanner(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        slot_key: row.slot_key,
        title: row.title || '',
        kicker: row.kicker || '',
        subtitle: row.subtitle || '',
        description: row.description || '',
        button_text: row.button_text || '',
        button_link: row.button_link || '',
        secondary_button_text: row.secondary_button_text || '',
        secondary_button_link: row.secondary_button_link || '',
        image_url: row.image_url || '',
        image_file_id: row.image_file_id || '',
        mobile_image_url: row.mobile_image_url || '',
        mobile_image_file_id: row.mobile_image_file_id || '',
        countdown_target: row.countdown_target || null,
        show_countdown: Boolean(row.show_countdown),
        is_active: Boolean(row.is_active),
        display_order: Number(row.display_order || 0),
        created_at: row.created_at || null,
        updated_at: row.updated_at || null
    };
}

async function getBanners(db, { includeInactive = false } = {}) {
    await ensureBannerTable(db);
    let query = 'SELECT * FROM site_banners';
    const params = [];
    if (!includeInactive) {
        query += ' WHERE is_active = TRUE';
    }
    query += ' ORDER BY display_order ASC, id ASC';
    const [rows] = await db.execute(query, params);
    return rows.map(normalizeBanner);
}

module.exports = {
    ensureBannerTable,
    getBanners,
    normalizeBanner
};

