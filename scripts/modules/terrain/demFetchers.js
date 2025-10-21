import { processTile } from './demProcessor.js';
import { fetchMapterhornTile } from './mapterhornTiles.js';

const GLOBAL_SCOPE = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
const DEFAULT_MIME_TYPE = 'image/png';
const CUSTOM_DEM_PREFIX = 'customdem://';
const MAPTERHORN_PREFIX = 'mapterhorn://';
const CUSTOM_DEM_REGEX = /^customdem:\/\/(\d+)\/(\d+)\/(\d+)(?:\/.*)?$/;
const MAPTERHORN_REGEX = /^mapterhorn:\/\/(\d+)\/(\d+)\/(\d+)$/;

function assertFetchAvailable() {
    const fetchFn = GLOBAL_SCOPE?.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('Fetch API is not available in the current environment');
    }
    return fetchFn.bind(GLOBAL_SCOPE);
}

async function fetchCustomDemTile(url) {
    const match = url.match(CUSTOM_DEM_REGEX);
    if (!match) {
        throw new Error(`Invalid custom DEM URL: ${url}`);
    }

    const [, z, x, y] = match;
    return processTile({
        zoom: parseInt(z, 10),
        x: parseInt(x, 10),
        y: parseInt(y, 10),
        type: 'elevation'
    });
}

function normaliseUrl(input) {
    if (typeof input === 'string') {
        return input;
    }

    if (input instanceof URL) {
        return input.toString();
    }

    if (input && typeof input === 'object') {
        if (typeof input.url === 'string') {
            return input.url;
        }

        if (typeof input.toString === 'function') {
            return input.toString();
        }
    }

    return String(input);
}

async function fetchMapterhornDemTile(url) {
    const match = url.match(MAPTERHORN_REGEX);
    if (!match) {
        throw new Error(`Invalid Mapterhorn DEM URL: ${url}`);
    }

    const [, z, x, y] = match.map(Number);
    return fetchMapterhornTile(z, x, y);
}

export async function fetchDemTile(url, options = {}) {
    const normalizedUrl = normaliseUrl(url);

    if (normalizedUrl.startsWith(CUSTOM_DEM_PREFIX)) {
        return fetchCustomDemTile(normalizedUrl);
    }

    if (normalizedUrl.startsWith(MAPTERHORN_PREFIX)) {
        return fetchMapterhornDemTile(normalizedUrl);
    }

    const fetchFn = assertFetchAvailable();
    const { signal, headers, credentials, cache, mode } = options;

    const response = await fetchFn(normalizedUrl, { signal, headers, credentials, cache, mode });
    if (!response.ok) {
        throw new Error(`Failed to fetch DEM tile (${response.status} ${response.statusText}) for ${normalizedUrl}`);
    }

    return response.arrayBuffer();
}

function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    throw new Error('No canvas implementation available for DEM decoding');
}

async function decodeWithImageBitmap(blob) {
    const imageBitmap = await GLOBAL_SCOPE.createImageBitmap(blob);
    const canvas = createCanvas(imageBitmap.width, imageBitmap.height);
    const context = canvas.getContext('2d');

    if (!context) {
        if (typeof imageBitmap.close === 'function') {
            imageBitmap.close();
        }
        throw new Error('Unable to acquire a 2D rendering context to decode DEM data');
    }

    context.drawImage(imageBitmap, 0, 0);
    const imageData = context.getImageData(0, 0, imageBitmap.width, imageBitmap.height);

    if (typeof imageBitmap.close === 'function') {
        imageBitmap.close();
    }

    return imageData;
}

function decodeWithImageElement(blob) {
    return new Promise((resolve, reject) => {
        const urlCreator = GLOBAL_SCOPE.URL || GLOBAL_SCOPE.webkitURL;
        if (!urlCreator || typeof urlCreator.createObjectURL !== 'function') {
            reject(new Error('No URL.createObjectURL implementation available for DEM decoding'));
            return;
        }

        const objectUrl = urlCreator.createObjectURL(blob);
        const image = new Image();
        image.crossOrigin = 'anonymous';

        image.onload = () => {
            try {
                const canvas = createCanvas(image.width, image.height);
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('Unable to acquire a 2D rendering context to decode DEM data');
                }
                context.drawImage(image, 0, 0);
                const imageData = context.getImageData(0, 0, image.width, image.height);
                resolve(imageData);
            } catch (error) {
                reject(error);
            } finally {
                urlCreator.revokeObjectURL(objectUrl);
            }
        };

        image.onerror = () => {
            urlCreator.revokeObjectURL(objectUrl);
            reject(new Error('Failed to decode DEM image using HTMLImageElement'));
        };

        image.src = objectUrl;
    });
}

function normaliseDecodeInput(input, options) {
    if (input instanceof Blob) {
        return input;
    }

    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
        const mimeType = options?.mimeType || DEFAULT_MIME_TYPE;
        return new Blob([input], { type: mimeType });
    }

    if (input && typeof input === 'object') {
        const { data, mimeType } = input;
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            const type = mimeType || options?.mimeType || DEFAULT_MIME_TYPE;
            return new Blob([data], { type });
        }
        if (data instanceof Blob) {
            return data;
        }
    }

    throw new Error('Unsupported data type provided to decodeDemImage');
}

export async function decodeDemImage(input, options = {}) {
    const blob = normaliseDecodeInput(input, options);

    if (typeof GLOBAL_SCOPE.createImageBitmap === 'function') {
        return decodeWithImageBitmap(blob);
    }

    if (typeof document !== 'undefined') {
        return decodeWithImageElement(blob);
    }

    throw new Error('No supported image decoding implementation is available in this environment');
}

export const demSourceHooks = {
    fetch: fetchDemTile,
    decode: decodeDemImage,
    fetchTile: fetchDemTile,
    decodeTile: decodeDemImage
};

export default demSourceHooks;
