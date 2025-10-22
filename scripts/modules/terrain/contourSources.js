import { demSourceHooks } from './demFetchers.js';

const GLOBAL_SCOPE = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof window !== 'undefined'
        ? window
        : (typeof self !== 'undefined' ? self : undefined));

const CONTOUR_PROTOCOL_BASE_OPTIONS = {
    thresholds: {
        11: [50, 200],
        12: [50, 200],
        13: [25, 100],
        14: [25, 100],
        15: [10, 50]
    },
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours'
};

function getMlcontourNamespace() {
    const namespace = GLOBAL_SCOPE?.mlcontour;
    if (!namespace || typeof namespace.DemSource !== 'function') {
        throw new Error('MapLibre contour library is not available. Make sure maplibre-contour is loaded before app.js.');
    }
    return namespace;
}

function createDemSource(options) {
    const { DemSource } = getMlcontourNamespace();
    return new DemSource({
        ...options,
        ...demSourceHooks
    });
}

const contourDemSources = {
    'dem': createDemSource({
        url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        encoding: 'terrarium',
        maxzoom: 14,
        worker: false
    }),
    'mapterhorn-dem': createDemSource({
        url: 'mapterhorn://{z}/{x}/{y}',
        encoding: 'terrarium',
        maxzoom: 14,
        worker: false
    }),
    'custom-dem': createDemSource({
        url: 'customdem://{z}/{x}/{y}',
        encoding: 'mapbox',
        maxzoom: 17,
        worker: false
    })
};

function getContourDemSource(terrainId) {
    return contourDemSources[terrainId] || contourDemSources['dem'];
}

export function getContourTileUrl(terrainId) {
    return getContourDemSource(terrainId).contourProtocolUrl(CONTOUR_PROTOCOL_BASE_OPTIONS);
}

export function getSharedDemProtocolUrl(terrainId) {
    const source = getContourDemSource(terrainId);
    if (!source.sharedDemProtocolUrl) {
        throw new Error('Contour DEM protocol has not been registered yet. Call setupContourDemProtocols(maplibregl) before creating the map.');
    }
    return source.sharedDemProtocolUrl;
}

let protocolsRegistered = false;

export function setupContourDemProtocols(maplibregl) {
    if (protocolsRegistered) {
        return;
    }

    Object.values(contourDemSources).forEach((source) => {
        source.setupMaplibre(maplibregl, demSourceHooks);
    });

    protocolsRegistered = true;
}

export function isContourTerrainSupported(terrainId) {
    return Boolean(contourDemSources[terrainId]);
}

export function getAvailableContourTerrainIds() {
    return Object.keys(contourDemSources);
}

export default {
    setupContourDemProtocols,
    getContourTileUrl,
    getSharedDemProtocolUrl,
    isContourTerrainSupported,
    getAvailableContourTerrainIds
};
