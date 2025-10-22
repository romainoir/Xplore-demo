import { getMapterhornProtocolInstance, computeMapterhornTileUrl } from './mapterhornTiles.js';

const GLOBAL_SCOPE = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
const ORIGINAL_FETCH = typeof GLOBAL_SCOPE.fetch === 'function' ? GLOBAL_SCOPE.fetch.bind(GLOBAL_SCOPE) : null;
const HAS_REQUEST = typeof Request !== 'undefined';
const MAPTERHORN_URL_PATTERN = /^mapterhorn:\/\/(\d+)\/(\d+)\/(\d+)$/;

if (ORIGINAL_FETCH && !GLOBAL_SCOPE.__mapterhornFetchPatched) {
    GLOBAL_SCOPE.__mapterhornFetchPatched = true;

    GLOBAL_SCOPE.fetch = async function patchedFetch(input, init) {
        const url = typeof input === 'string'
            ? input
            : (HAS_REQUEST && input instanceof Request
                ? input.url
                : (input && typeof input === 'object' && 'url' in input
                    ? input.url
                    : String(input)));

        if (typeof url === 'string' && url.startsWith('mapterhorn://')) {
            const match = url.match(MAPTERHORN_URL_PATTERN);
            if (!match) {
                throw new TypeError(`Invalid Mapterhorn URL: ${url}`);
            }

            const [, zStr, xStr, yStr] = match;
            const z = parseInt(zStr, 10);
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);

            const protocol = await getMapterhornProtocolInstance();
            const tileUrl = computeMapterhornTileUrl(z, x, y);
            const response = await protocol.tile({ url: tileUrl });

            if (!response || response.data == null) {
                throw new Error(`Tile z=${z} x=${x} y=${y} not found.`);
            }

            const body = response.data instanceof ArrayBuffer || ArrayBuffer.isView(response.data)
                ? response.data
                : (response.data.data ?? response.data);

            const headers = new Headers(response.headers || {});
            if (!headers.has('Content-Type')) {
                headers.set('Content-Type', 'image/webp');
            }

            return new Response(body, { status: 200, statusText: 'OK', headers });
        }

        return ORIGINAL_FETCH(input, init);
    };
}
