const MAPTERHORN_BASE_URL = 'https://download.mapterhorn.com';

let pmtilesProtocolCtor = null;
let mapterhornProtocolInstance = null;

function getGlobalPmtilesNamespace() {
    if (typeof globalThis !== 'undefined' && globalThis.pmtiles) {
        return globalThis.pmtiles;
    }
    return undefined;
}

export function resolvePMTilesProtocolCtor() {
    if (pmtilesProtocolCtor) {
        return pmtilesProtocolCtor;
    }

    const namespace = getGlobalPmtilesNamespace();
    const ProtocolCtor = namespace?.Protocol;

    if (!ProtocolCtor) {
        throw new Error('PMTiles global Protocol not available. Ensure pmtiles.js is loaded before app.js.');
    }

    pmtilesProtocolCtor = ProtocolCtor;
    return pmtilesProtocolCtor;
}

export async function getPMTilesProtocolCtor() {
    return resolvePMTilesProtocolCtor();
}

export function ensureMapterhornProtocolInstance() {
    if (!mapterhornProtocolInstance) {
        const ProtocolCtor = resolvePMTilesProtocolCtor();
        mapterhornProtocolInstance = new ProtocolCtor({ metadata: true, errorOnMissingTile: true });
    }

    return mapterhornProtocolInstance;
}

export async function getMapterhornProtocolInstance() {
    if (mapterhornProtocolInstance) {
        return mapterhornProtocolInstance;
    }

    const ProtocolCtor = await getPMTilesProtocolCtor();
    mapterhornProtocolInstance = new ProtocolCtor({ metadata: true, errorOnMissingTile: true });
    return mapterhornProtocolInstance;
}

export function computeMapterhornTileUrl(z, x, y) {
    const name = z <= 12 ? 'planet' : `6-${x >> (z - 6)}-${y >> (z - 6)}`;
    return `pmtiles://${MAPTERHORN_BASE_URL}/${name}.pmtiles/${z}/${x}/${y}.webp`;
}

export async function fetchMapterhornTile(z, x, y) {
    const protocol = await getMapterhornProtocolInstance();
    const url = computeMapterhornTileUrl(z, x, y);
    const response = await protocol.tile({ url });

    if (!response || response.data == null) {
        throw new Error(`Tile z=${z} x=${x} y=${y} not found.`);
    }

    return response.data;
}

export function resetMapterhornProtocolInstance() {
    mapterhornProtocolInstance = null;
}
