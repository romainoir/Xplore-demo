const GEOPORTAIL_BASE = `https://data.geopf.fr`;
export const GEOPORTAIL_WMTS_BASE = `${GEOPORTAIL_BASE}/wmts`;
export const GEOPORTAIL_TMS_BASE = `${GEOPORTAIL_BASE}/tms/1.0.0`;

const STORAGE_KEY = 'geoportailApiKey';
const GEO_KEY_QUERY_PARAM = 'geoportailKey';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

function readFromStorage() {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(STORAGE_KEY) || '';
        }
    } catch (error) {
        console.warn('[Geoportail] Unable to access localStorage:', error);
    }
    return '';
}

function writeToStorage(value) {
    try {
        if (typeof localStorage !== 'undefined') {
            if (value) {
                localStorage.setItem(STORAGE_KEY, value);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    } catch (error) {
        console.warn('[Geoportail] Unable to persist API key:', error);
    }
}

function sanitizeKey(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function readKeyFromSearchParams() {
    if (typeof location === 'undefined' || !location.search) {
        return '';
    }

    try {
        const params = new URLSearchParams(location.search);
        const fromQuery = sanitizeKey(params.get(GEO_KEY_QUERY_PARAM));

        if (fromQuery) {
            if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
                params.delete(GEO_KEY_QUERY_PARAM);
                const nextSearch = params.toString();
                const newUrl = `${location.origin}${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`;
                history.replaceState(null, '', newUrl);
            }
            return fromQuery;
        }
    } catch (error) {
        console.warn('[Geoportail] Failed to parse geoportailKey query parameter:', error);
    }

    return '';
}

function initialiseApiKey() {
    const fromQuery = readKeyFromSearchParams();
    if (fromQuery) {
        writeToStorage(fromQuery);
        return fromQuery;
    }

    if (typeof globalScope.__GEOPORTAIL_API_KEY__ === 'string' && globalScope.__GEOPORTAIL_API_KEY__) {
        return sanitizeKey(globalScope.__GEOPORTAIL_API_KEY__);
    }

    return readFromStorage();
}

let geoportailApiKey = initialiseApiKey();

if (geoportailApiKey && typeof globalScope === 'object') {
    globalScope.__GEOPORTAIL_API_KEY__ = geoportailApiKey;
}

let hasWarnedAboutMissingKey = false;

function appendApiKey(url) {
    const key = getGeoportailApiKey();
    if (!key) {
        if (!hasWarnedAboutMissingKey) {
            console.warn('[Geoportail] No API key configured. Layers that rely on Geoportail WMTS services may fail to load. Provide a key via the "geoportailKey" URL parameter or by calling window.setGeoportailApiKey("<your-key>").');
            hasWarnedAboutMissingKey = true;
        }
        return url;
    }

    try {
        const parsed = new URL(url);
        parsed.searchParams.set('apiKey', key);
        return parsed.toString();
    } catch (error) {
        // Fallback for relative URLs or invalid inputs
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}apiKey=${encodeURIComponent(key)}`;
    }
}

export function getGeoportailApiKey() {
    return geoportailApiKey;
}

export function setGeoportailApiKey(value, { persist = true } = {}) {
    const sanitised = sanitizeKey(value);
    geoportailApiKey = sanitised;

    if (typeof globalScope === 'object') {
        globalScope.__GEOPORTAIL_API_KEY__ = sanitised;
    }

    if (persist) {
        writeToStorage(sanitised);
    }
}

if (typeof globalScope === 'object') {
    if (typeof globalScope.setGeoportailApiKey !== 'function') {
        globalScope.setGeoportailApiKey = (value, options) => setGeoportailApiKey(value, options);
    }
    if (typeof globalScope.getGeoportailApiKey !== 'function') {
        globalScope.getGeoportailApiKey = () => getGeoportailApiKey();
    }
}

export function getGeoportailCapabilitiesUrl() {
    return appendApiKey(`${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities`);
}

export function buildGeoportailTileUrl({
    layer,
    style = 'normal',
    format = 'image/png',
    matrixSet = 'PM',
    extraParams = ''
}) {
    const params = new URLSearchParams({
        SERVICE: 'WMTS',
        REQUEST: 'GetTile',
        VERSION: '1.0.0',
        LAYER: layer,
        STYLE: style,
        FORMAT: format,
        TILEMATRIXSET: matrixSet,
        TILEMATRIX: '{z}',
        TILEROW: '{y}',
        TILECOL: '{x}'
    });

    if (extraParams) {
        new URLSearchParams(extraParams).forEach((value, key) => {
            params.set(key, value);
        });
    }

    const query = params
        .toString()
        .replace(/%7B/gi, '{')
        .replace(/%7D/gi, '}');

    return appendApiKey(`${GEOPORTAIL_WMTS_BASE}?${query}`);
}

export function buildGeoportailDemTileUrl({
    layer,
    matrixSet = 'WGS84G',
    format = 'image/x-bil;bits=32'
}) {
    const url = `${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&TILEMATRIXSET=${matrixSet}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`;
    return appendApiKey(url);
}

export function buildGeoportailDemTileUrlRaw({
    layer,
    matrixSet = 'WGS84G',
    format = 'image/x-bil;bits=32'
}, { z, x, y }) {
    const url = `${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&TILEMATRIXSET=${matrixSet}&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`;
    return appendApiKey(url);
}

export function buildGeoportailTmsPath(path) {
    return appendApiKey(`${GEOPORTAIL_TMS_BASE}/${path}`);
}
