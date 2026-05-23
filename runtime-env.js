(function () {
    const isFileProtocol = window.location.protocol === 'file:';
    const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
    const sameHostPort5000 = `${window.location.protocol}//${window.location.hostname}:5000`;
    const metaApiBase = document.querySelector('meta[name="devasthra-api-base"]')?.getAttribute('content')?.trim();
    const storedApiBase = (() => {
        try {
            return window.localStorage.getItem('devasthra.apiBase')?.trim();
        } catch (error) {
            return '';
        }
    })();
    const configuredApiBase = window.__API_BASE || metaApiBase || storedApiBase;
    const apiBase = configuredApiBase || (
        isFileProtocol || isLocalhost
            ? 'http://localhost:5000'
            : window.location.origin
    );
    const apiBaseCandidates = Array.from(new Set(
        [
            apiBase,
            !isFileProtocol && isLocalhost && window.location.port !== '5000' ? sameHostPort5000 : ''
        ].filter(Boolean)
    ));

    window.__API_BASE = apiBase;
    window.__DEVASTHRA_ENV = {
        isFileProtocol,
        isLocalhost,
        isLocalLike: isFileProtocol || isLocalhost,
        apiBase,
        apiBaseCandidates
    };
    window.__getApiBaseCandidates = function getApiBaseCandidates() {
        return [...apiBaseCandidates];
    };
    window.__buildApiUrl = function buildApiUrl(base, path) {
        const normalizedBase = String(base || '').replace(/\/+$/, '');
        const cleanPath = String(path || '').replace(/^\/+/, '');
        const normalizedPath = `/${cleanPath}`;
        return `${normalizedBase}${normalizedPath}`;
    };
    window.__fetchJsonWithApiFallback = async function fetchJsonWithApiFallback(path, options) {
        const attempts = [];

        for (const base of apiBaseCandidates) {
            const url = window.__buildApiUrl(base, path);

            try {
                const response = await fetch(url, options);
                const contentType = response.headers.get('content-type') || '';

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} from ${url}`);
                }

                if (!contentType.toLowerCase().includes('application/json')) {
                    const preview = (await response.text()).slice(0, 120).replace(/\s+/g, ' ').trim();
                    throw new Error(`Expected JSON from ${url} but received ${contentType || 'unknown content type'}: ${preview}`);
                }

                return {
                    base,
                    url,
                    response,
                    data: await response.json()
                };
            } catch (error) {
                attempts.push(error.message || String(error));
            }
        }

        throw new Error(attempts.join(' | '));
    };

    if (!isFileProtocol) return;

    const renderNotice = () => {
        if (!document.body || document.getElementById('localPreviewNotice')) return;

        const notice = document.createElement('div');
        notice.id = 'localPreviewNotice';
        notice.setAttribute('role', 'status');
        notice.style.cssText = [
            'position:sticky',
            'top:0',
            'z-index:10000',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'gap:12px',
            'flex-wrap:wrap',
            'padding:10px 16px',
            'background:#1a1a1a',
            'color:#f5f5f5',
            'font:500 13px/1.5 system-ui,sans-serif',
            'text-align:center',
            'box-shadow:0 6px 18px rgba(0,0,0,.16)'
        ].join(';');

        const normalizedPath = (window.location.pathname || '/index.html')
            .replace(/^\/+/, '')
            .replace(/\\/g, '/');
        const currentPath = normalizedPath || 'index.html';
        notice.innerHTML = `
            <span>Local file preview is limited. Open this page with the local server for full navigation, login, and API features.</span>
            <a href="${apiBase}/${currentPath}" style="display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:999px;background:#ffcf33;color:#111;text-decoration:none;font-weight:700;">
                Open on localhost
            </a>
        `;

        document.body.insertAdjacentElement('afterbegin', notice);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderNotice);
    } else {
        renderNotice();
    }

    console.warn(
        '[DEVASTHRA] This page is opened with file://. Use http://localhost:5000 for full functionality and to avoid browser security-origin errors.'
    );
})();

