const express = require('express');
const router = express.Router();
const db = require('../db');
const imageKit = require('../services/imagekit');
const multer = require('multer');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const path = require('path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const wordExtractor = new WordExtractor();

// Configure multer for temporary file storage with size limits
const upload = multer({
    dest: '/tmp',
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max file size
    }
});

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizePlainText(value) {
    const text = String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim();
    if (!text) return '';

    if (!/[<>]/.test(text)) {
        return text.replace(/\n{3,}/g, '\n\n');
    }

    const stripped = text
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\/\s*(p|div|section|article|header|footer|h[1-6]|li|tr)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');

    return stripped
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractPolicyContent(uploadedFile) {
    const originalName = String(uploadedFile.originalname || '').toLowerCase();
    const extension = path.extname(originalName);
    const mimeType = String(uploadedFile.mimetype || '').toLowerCase();
    const fileBuffer = require('fs').readFileSync(uploadedFile.path);

    if (mimeType.includes('pdf') || extension === '.pdf') {
        let extractedText = '';
        try {
            const pdfParse = require('pdf-parse');
            const parsed = await pdfParse(fileBuffer);
            extractedText = normalizePlainText(parsed.text || '');
        } catch (error) {
            console.warn('PDF text extraction unavailable, continuing with empty text:', error.message);
        }
        return {
            extractedText,
            extractionType: 'pdf'
        };
    }

    if (mimeType.includes('wordprocessingml.document') || extension === '.docx') {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        const extractedText = normalizePlainText(result.value || '');
        return {
            extractedText,
            extractionType: 'docx'
        };
    }

    if (mimeType.includes('msword') || extension === '.doc') {
        const extracted = await wordExtractor.extract(uploadedFile.path);
        const extractedText = normalizePlainText(extracted.getBody() || '');
        return {
            extractedText,
            extractionType: 'doc'
        };
    }

    if (mimeType.startsWith('text/') || extension === '.txt' || extension === '.html' || extension === '.htm') {
        const extractedText = normalizePlainText(fileBuffer.toString('utf8'));
        return {
            extractedText,
            extractionType: 'text'
        };
    }

    return {
        extractedText: '',
        extractionType: ''
    };
}

// ── Generate ImageKit Auth Token for Client-Side Upload ──
router.get('/auth', async (req, res) => {
    const result = imageKit.getAuthenticationParameters();
    res.json({ success: true, auth: result });
});

// ── Server-Side Upload (Admin) ──
async function handleUpload(req, res) {
    try {
        const uploadedFile = req.files?.file?.[0] || req.files?.image?.[0] || req.file;

        if (!uploadedFile) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        const { productId, folder = 'products' } = req.body;
        const fs = require('fs');
        
        // Read file
        const fileBuffer = fs.readFileSync(uploadedFile.path);
        const policyContent = folder === 'legal' ? await extractPolicyContent(uploadedFile) : null;

        // Upload to ImageKit
        const response = await imageKit.upload({
            file: fileBuffer,
            fileName: `${productId || folder}-${Date.now()}-${uploadedFile.originalname}`,
            folder: `/DEVASTHRA/${folder}`,
            tags: [folder, 'devasthra', productId ? `product-${productId}` : 'generic-upload'],
            isPrivateFile: false
        });

        // Clean up temp file
        fs.unlinkSync(uploadedFile.path);

        res.json({
            success: true,
            message: 'Image uploaded successfully',
            url: response.url,
            fileId: response.fileId,
            thumbnailUrl: `${response.url}?tr=w:300,h:400,c:cover`,
            mediumUrl: `${response.url}?tr=w:600,h:800,c:cover`,
            largeUrl: `${response.url}?tr=w:1200,h:1600,c:cover`,
            extractedText: policyContent?.extractedText || '',
            extractionType: policyContent?.extractionType || ''
        });
    } catch (error) {
        // Clean up temp file if it exists
        const uploadedFile = req.files?.file?.[0] || req.files?.image?.[0] || req.file;
        if (uploadedFile?.path) {
            const fs = require('fs');
            try { fs.unlinkSync(uploadedFile.path); } catch (e) {}
        }
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

router.post('/image', adminAuth, upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]), handleUpload);

router.post('/file', adminAuth, upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]), handleUpload);

// ── Multer Error Handler ──
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                message: 'File size exceeds 50MB limit. Please upload a smaller image.'
            });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: `Unexpected upload field "${err.field}". Please try uploading again from the admin form.`
            });
        }
        if (err.code === 'LIMIT_PART_COUNT') {
            return res.status(400).json({ success: false, message: 'Too many form fields' });
        }
    }
    next(err);
});

// ── Save Product Image to Database ──
router.post('/save-image', adminAuth, async (req, res) => {
    try {
        const { productId, imagekitId, imagekitUrl, folder = 'products', displayOrder = 0, isFeatured = false } = req.body;

        if (!productId || !imagekitId || !imagekitUrl) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        if (isFeatured) {
            // Update featured image in products table
            await db.execute(
                'UPDATE products SET image_url = ?, image_file_id = ? WHERE id = ?',
                [imagekitUrl, imagekitId, productId]
            );
        }

        // Insert into product_images table
        await db.execute(
            `INSERT INTO product_images (product_id, imagekit_id, imagekit_url, folder, display_order) 
             VALUES (?, ?, ?, ?, ?)`,
            [productId, imagekitId, imagekitUrl, folder, displayOrder]
        );

        res.json({
            success: true,
            message: 'Image saved to database'
        });
    } catch (error) {
        console.error('Save image error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Delete Image from ImageKit ──
router.delete('/delete-image/:fileId', adminAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const { imageUrl } = req.body;

        // Delete from ImageKit
        await imageKit.deleteFile(fileId);

        // Delete from database if imageUrl provided
        if (imageUrl) {
            await db.execute(
                'DELETE FROM product_images WHERE imagekit_url = ?',
                [imageUrl]
            );
        }

        res.json({
            success: true,
            message: 'Image deleted successfully'
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── Get Product Images ──
router.get('/product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;

        const [images] = await db.execute(
            `SELECT id, imagekit_id, imagekit_url, folder, display_order 
             FROM product_images 
             WHERE product_id = ? 
             ORDER BY display_order ASC`,
            [productId]
        );

        const processedImages = images.map(img => ({
            id: img.id,
            fileId: img.imagekit_id,
            url: img.imagekit_url,
            folder: img.folder,
            displayOrder: img.display_order,
            // Generate responsive variants
            thumbnail: `${img.imagekit_url}?tr=w:100,h:100,c:cover`,
            medium: `${img.imagekit_url}?tr=w:400,h:500,c:cover`,
            large: `${img.imagekit_url}?tr=w:800,h:1000,c:cover`
        }));

        res.json({
            success: true,
            images: processedImages
        });
    } catch (error) {
        console.error('Get images error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export the router
module.exports = router;
