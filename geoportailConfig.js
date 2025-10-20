const DEFAULT_API_KEY = 'essentiels';

function resolveGeoportailApiKey() {
    if (typeof window !== 'undefined' && window.GEOFR_API_KEY) {
        return window.GEOFR_API_KEY;
    }
    if (typeof self !== 'undefined' && self.GEOFR_API_KEY) {
        return self.GEOFR_API_KEY;
    }
    return DEFAULT_API_KEY;
}

export const geoportailApiKey = resolveGeoportailApiKey();

const GEOPORTAIL_BASE = `https://data.geopf.fr/${geoportailApiKey}`;
export const GEOPORTAIL_WMTS_BASE = `${GEOPORTAIL_BASE}/wmts`;
export const GEOPORTAIL_TMS_BASE = `${GEOPORTAIL_BASE}/tms/1.0.0`;
export const GEOPORTAIL_CAPABILITIES_URL = `${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities`;

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

    return `${GEOPORTAIL_WMTS_BASE}?${params.toString()}`;
}

export function buildGeoportailDemTileUrl({
    layer,
    matrixSet = 'WGS84G',
    format = 'image/x-bil;bits=32'
}) {
    return `${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&TILEMATRIXSET=${matrixSet}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`;
}

export function buildGeoportailDemTileUrlRaw({
    layer,
    matrixSet = 'WGS84G',
    format = 'image/x-bil;bits=32'
}, { z, x, y }) {
    return `${GEOPORTAIL_WMTS_BASE}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&TILEMATRIXSET=${matrixSet}&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`;
}

export function buildGeoportailTmsPath(path) {
    return `${GEOPORTAIL_TMS_BASE}/${path}`;
}
