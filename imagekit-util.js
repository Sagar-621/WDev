/**
 * ImageKit Utility Functions
 * Handles image transformations and responsive variants
 */

const ImageKitUtil = {
    /**
     * Generate responsive image URLs with transformations
     * @param {string} imagekitUrl - Original ImageKit URL
     * @returns {object} Object with different size variants
     */
    getImageVariants: function(imagekitUrl) {
        if (!imagekitUrl || !imagekitUrl.includes('imagekit.io')) {
            return {
                thumbnail: imagekitUrl,
                small: imagekitUrl,
                medium: imagekitUrl,
                large: imagekitUrl,
                original: imagekitUrl
            };
        }

        return {
            thumbnail: `${imagekitUrl}?tr=w:100,h:100,c:cover,q:80`,
            small: `${imagekitUrl}?tr=w:300,h:400,c:cover,q:85`,
            medium: `${imagekitUrl}?tr=w:600,h:800,c:cover,q:85`,
            large: `${imagekitUrl}?tr=w:1200,h:1600,c:cover,q:90`,
            original: imagekitUrl
        };
    },

    /**
     * Get optimized image URL for display
     * @param {string} imagekitUrl - ImageKit URL
     * @param {string} size - Size: 'thumbnail', 'small', 'medium', 'large', 'original'
     * @returns {string} Transformed URL
     */
    getOptimized: function(imagekitUrl, size = 'medium') {
        const variants = this.getImageVariants(imagekitUrl);
        return variants[size] || variants.medium;
    },

    /**
     * Generate srcset for responsive images
     * @param {string} imagekitUrl - ImageKit URL
     * @returns {string} srcset attribute value
     */
    generateSrcset: function(imagekitUrl) {
        const variants = this.getImageVariants(imagekitUrl);
        return `${variants.small} 1x, ${variants.medium} 2x, ${variants.large} 3x`;
    },

    /**
     * Create picture element with multiple sources
     * @param {string} imagekitUrl - ImageKit URL
     * @param {string} altText - Alt text
     * @returns {string} HTML picture element
     */
    createPictureElement: function(imagekitUrl, altText = 'Product image') {
        const variants = this.getImageVariants(imagekitUrl);
        return `
            <picture>
                <source media="(max-width: 600px)" srcset="${variants.small}">
                <source media="(max-width: 1024px)" srcset="${variants.medium}">
                <img src="${variants.large}" alt="${altText}" loading="lazy">
            </picture>
        `;
    },

    /**
     * Extract base URL from ImageKit transformed URL
     * @param {string} transformedUrl - URL with transformations
     * @returns {string} Base ImageKit URL
     */
    getBaseUrl: function(transformedUrl) {
        if (!transformedUrl) return '';
        return transformedUrl.split('?')[0];
    },

    /**
     * Apply custom transformation
     * @param {string} imagekitUrl - ImageKit URL
     * @param {object} transforms - Transformation object {width, height, quality, crop, etc}
     * @returns {string} Transformed URL
     */
    transform: function(imagekitUrl, transforms = {}) {
        if (!imagekitUrl) return '';

        const baseUrl = this.getBaseUrl(imagekitUrl);
        const params = [];

        if (transforms.width) params.push(`w:${transforms.width}`);
        if (transforms.height) params.push(`h:${transforms.height}`);
        if (transforms.crop) params.push(`c:${transforms.crop}`);
        if (transforms.quality) params.push(`q:${transforms.quality}`);
        if (transforms.format) params.push(`f:${transforms.format}`);
        if (transforms.dpr) params.push(`dpr:${transforms.dpr}`);
        if (transforms.blur) params.push(`bl:${transforms.blur}`);
        if (transforms.brightness) params.push(`br:${transforms.brightness}`);
        if (transforms.contrast) params.push(`con:${transforms.contrast}`);
        if (transforms.saturation) params.push(`sat:${transforms.saturation}`);
        if (transforms.rotate) params.push(`rt:${transforms.rotate}`);

        return params.length > 0 ? `${baseUrl}?tr=${params.join(',')}` : baseUrl;
    },

    /**
     * Generate lazy-load image HTML
     * @param {string} imagekitUrl - ImageKit URL
     * @param {string} altText - Alt text
     * @param {object} options - Additional options {classes, width, height}
     * @returns {string} Image HTML
     */
    lazyLoadImage: function(imagekitUrl, altText = '', options = {}) {
        const variants = this.getImageVariants(imagekitUrl);
        const classes = options.classes || '';
        const width = options.width || '';
        const height = options.height || '';

        return `
            <img 
                src="${variants.thumbnail}"
                data-src="${variants.medium}"
                alt="${altText}"
                class="lazy-load ${classes}"
                ${width ? `width="${width}"` : ''}
                ${height ? `height="${height}"` : ''}
                loading="lazy">
        `;
    }
};

/**
 * Initialize lazy loading for images with data-src attribute
 */
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        });

        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initLazyLoading);

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageKitUtil;
}
