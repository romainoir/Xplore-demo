// terrainprotocol.js

class CacheManager {
    constructor(maxSize) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.accessOrder = new Map();
        this.accessCounter = 0;
    }

    get(key) {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.accessOrder.set(key, ++this.accessCounter);
            return value;
        }
        return null;
    }

    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            let oldestAccess = Infinity;
            let oldestKey = null;
            for (const [k, accessTime] of this.accessOrder) {
                if (accessTime < oldestAccess) {
                    oldestAccess = accessTime;
                    oldestKey = k;
                }
            }
            if (oldestKey) {
                this.cache.delete(oldestKey);
                this.accessOrder.delete(oldestKey);
            }
        }
        this.cache.set(key, value);
        this.accessOrder.set(key, ++this.accessCounter);
    }
}

// Initialize cache managers with increased size
const MAX_CACHE_SIZE = 4000;
const demCacheManager = new CacheManager(MAX_CACHE_SIZE);
const processedCacheManager = new CacheManager(MAX_CACHE_SIZE);
const demCapabilities = new Map();

// Constants for calculations
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

// Optimized key generation
const getCacheKey = (zoom, x, y, type) => `${zoom}_${x}_${y}_${type}`;

function calculateTileBounds(zoom, x, y) {
    const n = 1 << zoom;
    const lonLeft = (x / n) * 360 - 180;
    const lonRight = ((x + 1) / n) * 360 - 180;
    const latTop = tile2lat(y, zoom);
    const latBottom = tile2lat(y + 1, zoom);
    return [[latBottom, lonLeft], [latTop, lonRight]];
}

function tile2lat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / (1 << z);
    return RAD_TO_DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function calculateZoomScale(zoom) {
    // Base scale at zoom level 16 (typical reference zoom)
    const baseZoom = 16;
    const baseScale = 1.0;
    
    // Scale factor changes with zoom level
    return baseScale * Math.pow(2, baseZoom - zoom);
}

function calculateNormals(heightmap, width, height, zoom) {
    const scale = calculateZoomScale(zoom);
    const normals = new Float32Array(width * height * 3);
    const widthMinus1 = width - 1;
    const heightMinus1 = height - 1;
    const invScale = 1 / scale;
    
    for (let y = 0; y < height; y++) {
        const yPrev = y > 0 ? y - 1 : 0;
        const yNext = y < heightMinus1 ? y + 1 : heightMinus1;
        
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const xPrev = x > 0 ? x - 1 : 0;
            const xNext = x < widthMinus1 ? x + 1 : widthMinus1;
            
            const dzdx = (heightmap[y * width + xNext] - heightmap[y * width + xPrev]) * 
                        ((x === 0 || x === widthMinus1) ? invScale : (0.5 * invScale));
            
            const dzdy = (heightmap[yNext * width + x] - heightmap[yPrev * width + x]) * 
                        ((y === 0 || y === heightMinus1) ? invScale : (0.5 * invScale));
            
            const invLength = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
            
            normals[idx] = -dzdx * invLength;
            normals[idx + 1] = -dzdy * invLength;
            normals[idx + 2] = invLength;
        }
    }
    
    return normals;
}

function calculateSlope(heightmap, width, height, zoom) {
    const scale = calculateZoomScale(zoom);
    const slopes = new Float32Array(width * height);
    const widthMinus1 = width - 1;
    const heightMinus1 = height - 1;
    const invScale = 1 / scale;
    
    for (let y = 0; y < height; y++) {
        const yPrev = y > 0 ? y - 1 : 0;
        const yNext = y < heightMinus1 ? y + 1 : heightMinus1;
        
        for (let x = 0; x < width; x++) {
            const xPrev = x > 0 ? x - 1 : 0;
            const xNext = x < widthMinus1 ? x + 1 : widthMinus1;
            
            const dzdx = (heightmap[y * width + xNext] - heightmap[y * width + xPrev]) * 
                        ((x === 0 || x === widthMinus1) ? invScale : (0.5 * invScale));
            
            const dzdy = (heightmap[yNext * width + x] - heightmap[yPrev * width + x]) * 
                        ((y === 0 || y === heightMinus1) ? invScale : (0.5 * invScale));
            
            slopes[y * width + x] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * RAD_TO_DEG;
        }
    }
    
    return slopes;
}

function calculateAspect(heightmap, width, height, zoom) {
    const scale = calculateZoomScale(zoom);
    const aspects = new Float32Array(width * height);
    const widthMinus1 = width - 1;
    const heightMinus1 = height - 1;
    const invScale = 1 / scale;
    
    for (let y = 0; y < height; y++) {
        const yPrev = y > 0 ? y - 1 : 0;
        const yNext = y < heightMinus1 ? y + 1 : heightMinus1;
        
        for (let x = 0; x < width; x++) {
            const xPrev = x > 0 ? x - 1 : 0;
            const xNext = x < widthMinus1 ? x + 1 : widthMinus1;
            
            const dzdx = (heightmap[y * width + xNext] - heightmap[y * width + xPrev]) * 
                        ((x === 0 || x === widthMinus1) ? invScale : (0.5 * invScale));
            
            const dzdy = (heightmap[yNext * width + x] - heightmap[yPrev * width + x]) * 
                        ((y === 0 || y === heightMinus1) ? invScale : (0.5 * invScale));
            
            let aspect = Math.atan2(dzdy, -dzdx) * RAD_TO_DEG;
            aspect = 90 - aspect;
            if (aspect < 0) aspect += 360;
            if (aspect > 360) aspect -= 360;
            
            aspects[y * width + x] = aspect;
        }
    }
    
    return aspects;
}

const COLOR_MAPS = {
    SLOPE: {
        TRANSPARENT: [0, 0, 0, 0],
        YELLOW: [255, 255, 0, 255],
        ORANGE: [255, 165, 0, 255],
        RED: [255, 0, 0, 255],
        VIOLET: [148, 0, 211, 255]
    }
};

function encodeNormalMap(normals) {
    const rgba = new Uint8ClampedArray(normals.length / 3 * 4);
    const len = normals.length / 3;
    
    for (let i = 0; i < len; i++) {
        const idx = i * 4;
        const nIdx = i * 3;
        rgba[idx] = Math.floor((normals[nIdx] + 1) * 127.5);
        rgba[idx + 1] = Math.floor((normals[nIdx + 1] + 1) * 127.5);
        rgba[idx + 2] = Math.floor((normals[nIdx + 2] + 1) * 127.5);
        rgba[idx + 3] = 255;
    }
    
    return rgba;
}

function encodeSlopeMap(slopes) {
    const rgba = new Uint8ClampedArray(slopes.length * 4);
    const colors = COLOR_MAPS.SLOPE;
    
    for (let i = 0; i < slopes.length; i++) {
        const idx = i * 4;
        const slope = slopes[i];
        
        let color;
        if (slope < 30) {
            color = colors.TRANSPARENT;
        } else if (slope < 35) {
            color = colors.YELLOW;
        } else if (slope < 40) {
            color = colors.ORANGE;
        } else if (slope < 45) {
            color = colors.RED;
        } else {
            color = colors.VIOLET;
        }
        
        rgba[idx] = color[0];
        rgba[idx + 1] = color[1];
        rgba[idx + 2] = color[2];
        rgba[idx + 3] = color[3];
    }
    
    return rgba;
}

function encodeAspectMap(aspects) {
    const rgba = new Uint8ClampedArray(aspects.length * 4);
    
    for (let i = 0; i < aspects.length; i++) {
        const idx = i * 4;
        const hue = aspects[i] / 360;
        const rgb = HSVtoRGB(hue, 1, 1);
        
        rgba[idx] = Math.floor(rgb.r * 255);
        rgba[idx + 1] = Math.floor(rgb.g * 255);
        rgba[idx + 2] = Math.floor(rgb.b * 255);
        rgba[idx + 3] = 255;
    }
    
    return rgba;
}

function HSVtoRGB(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    
    let r, g, b;
    switch (i % 6) {
        case 0: [r, g, b] = [v, t, p]; break;
        case 1: [r, g, b] = [q, v, p]; break;
        case 2: [r, g, b] = [p, v, t]; break;
        case 3: [r, g, b] = [p, q, v]; break;
        case 4: [r, g, b] = [t, p, v]; break;
        case 5: [r, g, b] = [v, p, q]; break;
    }
    
    return { r, g, b };
}

function encodeTerrainRGB(elevation) {
    if (isNaN(elevation) || elevation === -9999) {
        return [0, 0, 0];
    }
    const height = Math.max(-10000, Math.min(10000, elevation));
    const encodedHeight = (height + 10000) * 10;
    return [
        Math.floor(encodedHeight / 65536),
        Math.floor((encodedHeight % 65536) / 256),
        Math.floor(encodedHeight % 256)
    ];
}

async function getDEMTile(tx, ty, demZoom, demMatrix) {
    const cacheKey = getCacheKey(demZoom, tx, ty, 'dem');
    const cachedTile = demCacheManager.get(cacheKey);
    if (cachedTile) return cachedTile;

    try {
        const demUrl = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS&TILEMATRIXSET=WGS84G&TILEMATRIX=${demZoom}&TILEROW=${ty}&TILECOL=${tx}&FORMAT=image/x-bil;bits=32&STYLE=normal`;
        const response = await fetch(demUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const buffer = await response.arrayBuffer();
        const elevationData = new Float32Array(buffer);

        const [originLon, originLat] = demMatrix.topLeftCorner;
        const degreesPerTileLon = 360 / demMatrix.matrixWidth;
        const degreesPerTileLat = 180 / demMatrix.matrixHeight;

        const tileBounds = [
            [originLat - (ty + 1) * degreesPerTileLat, originLon + tx * degreesPerTileLon],
            [originLat - ty * degreesPerTileLat, originLon + (tx + 1) * degreesPerTileLon]
        ];

        const tileData = { elevationData, bounds: tileBounds, x: tx, y: ty };
        demCacheManager.set(cacheKey, tileData);
        return tileData;
    } catch (error) {
        console.error('Error fetching DEM tile:', error);
        throw error;
    }
}

async function fetchCapabilities() {
    if (!demCapabilities.has('WGS84G')) {
        try {
            const response = await fetch('https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities');
            if (!response.ok) throw new Error(`Failed to fetch WMTS Capabilities: ${response.status}`);
            
            const text = await response.text();
            const tileMatrixSetRegex = /<TileMatrixSet>([\s\S]*?)<\/TileMatrixSet>/g;
            let match;

            while ((match = tileMatrixSetRegex.exec(text)) !== null) {
                const tmsContent = match[1];
                const identifier = extractValue(tmsContent, 'ows:Identifier');
                if (identifier) {
                    demCapabilities.set(identifier, parseTileMatrixSet(tmsContent));
                }
            }
        } catch (error) {
            console.error("Error fetching WMTS capabilities:", error);
            throw error;
        }
    }
}

function extractValue(content, tag) {
    const match = content.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
    return match ? match[1].trim() : null;
}

function parseTileMatrixSet(content) {
    const matrices = {};
    const tileMatrixRegex = /<TileMatrix>([\s\S]*?)<\/TileMatrix>/g;
    let match;
    while ((match = tileMatrixRegex.exec(content)) !== null) {
        const matrixContent = match[1];
        const identifier = extractValue(matrixContent, 'ows:Identifier');

        if (identifier) {
            matrices[identifier] = {
                scaleDenominator: parseFloat(extractValue(matrixContent, 'ScaleDenominator')),
                topLeftCorner: extractValue(matrixContent, 'TopLeftCorner')?.split(' ').map(Number),
                tileWidth: parseInt(extractValue(matrixContent, 'TileWidth')),
                tileHeight: parseInt(extractValue(matrixContent, 'TileHeight')),
                matrixWidth: parseInt(extractValue(matrixContent, 'MatrixWidth')),
                matrixHeight: parseInt(extractValue(matrixContent, 'MatrixHeight'))
            };
        }
    }
    return matrices;
}

async function processDEMTile({ zoom, x, y, type = 'elevation' }) {
    const cacheKey = getCacheKey(zoom, x, y, type);
    const cachedResult = processedCacheManager.get(cacheKey);
    if (cachedResult) return cachedResult;

    const OUTPUT_SIZE = 256;
    const demZoom = Math.max(0, zoom);

    await fetchCapabilities();
    const demMatrix = demCapabilities.get('WGS84G')?.[demZoom];
    if (!demMatrix) {
        throw new Error(`No DEM matrix found for zoom ${demZoom}`);
    }

    const tileBounds = calculateTileBounds(zoom, x, y);
    const [originLon, originLat] = demMatrix.topLeftCorner;
    const degreesPerTileLon = 360 / demMatrix.matrixWidth;
    const degreesPerTileLat = 180 / demMatrix.matrixHeight;

    // Calculate tile ranges
    const xMin = Math.floor((tileBounds[0][1] - originLon) / degreesPerTileLon);
    const xMax = Math.floor((tileBounds[1][1] - originLon) / degreesPerTileLon);
    const yMin = Math.floor((originLat - tileBounds[1][0]) / degreesPerTileLat);
    const yMax = Math.floor((originLat - tileBounds[0][0]) / degreesPerTileLat);

    // Fetch all required DEM tiles in parallel
    const demTilePromises = [];
    for (let tx = xMin; tx <= xMax; tx++) {
        for (let ty = yMin; ty <= yMax; ty++) {
            demTilePromises.push(getDEMTile(tx, ty, demZoom, demMatrix));
        }
    }

    const demTiles = (await Promise.all(demTilePromises)).filter(Boolean);
    if (!demTiles.length) {
        throw new Error('No DEM tiles fetched successfully.');
    }

    // Calculate merged DEM bounds
    const demTileBounds = demTiles.map(tile => tile.bounds);
    const demBounds = [
        [Math.min(...demTileBounds.map(b => b[0][0])), Math.min(...demTileBounds.map(b => b[0][1]))],
        [Math.max(...demTileBounds.map(b => b[1][0])), Math.max(...demTileBounds.map(b => b[1][1]))]
    ];

    // Merge DEM tiles
    const uniqueX = new Set(demTiles.map(t => t.x)).size;
    const uniqueY = new Set(demTiles.map(t => t.y)).size;
    const mergedWidth = uniqueX * 256;
    const mergedHeight = uniqueY * 256;
    const mergedDEM = new Float32Array(mergedWidth * mergedHeight);

    // Sort tiles for correct positioning
    demTiles.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

    // Merge tile data
    for (const tile of demTiles) {
        const col = tile.x - xMin;
        const row = tile.y - yMin;
        for (let y = 0; y < 256; y++) {
            const destOffset = ((row * 256 + y) * mergedWidth) + (col * 256);
            const srcOffset = y * 256;
            mergedDEM.set(tile.elevationData.subarray(srcOffset, srcOffset + 256), destOffset);
        }
    }

    // Resample to target size
    const resampledDEM = new Float32Array(OUTPUT_SIZE * OUTPUT_SIZE);
    const [sw, ne] = tileBounds;
    const latScale = (ne[0] - sw[0]) / OUTPUT_SIZE;
    const lonScale = (ne[1] - sw[1]) / OUTPUT_SIZE;

    for (let y = 0; y < OUTPUT_SIZE; y++) {
        const lat = ne[0] - y * latScale;
        for (let x = 0; x < OUTPUT_SIZE; x++) {
            const lon = sw[1] + x * lonScale;
            const xDem = ((lon - demBounds[0][1]) / (demBounds[1][1] - demBounds[0][1])) * mergedWidth;
            const yDem = ((demBounds[1][0] - lat) / (demBounds[1][0] - demBounds[0][0])) * mergedHeight;

            const x0 = Math.floor(xDem);
            const y0 = Math.floor(yDem);
            const x1 = Math.min(x0 + 1, mergedWidth - 1);
            const y1 = Math.min(y0 + 1, mergedHeight - 1);

            const dx = xDem - x0;
            const dy = yDem - y0;

            resampledDEM[y * OUTPUT_SIZE + x] = 
                (1 - dx) * (1 - dy) * mergedDEM[y0 * mergedWidth + x0] +
                dx * (1 - dy) * mergedDEM[y0 * mergedWidth + x1] +
                (1 - dx) * dy * mergedDEM[y1 * mergedWidth + x0] +
                dx * dy * mergedDEM[y1 * mergedWidth + x1];
        }
    }

    // Generate visualization based on type
    let imageData;
    switch (type) {
        case 'normal': {
            const normals = calculateNormals(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            imageData = encodeNormalMap(normals);
            break;
        }
        case 'slope': {
            const slopes = calculateSlope(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            imageData = encodeSlopeMap(slopes);
            break;
        }
        case 'aspect': {
            const aspects = calculateAspect(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            imageData = encodeAspectMap(aspects);
            break;
        }
        default: {
            // Default elevation encoding
            imageData = new Uint8ClampedArray(OUTPUT_SIZE * OUTPUT_SIZE * 4);
            for (let i = 0; i < OUTPUT_SIZE * OUTPUT_SIZE; i++) {
                const rgb = encodeTerrainRGB(resampledDEM[i]);
                const idx = i * 4;
                imageData[idx] = rgb[0];
                imageData[idx + 1] = rgb[1];
                imageData[idx + 2] = rgb[2];
                imageData[idx + 3] = 255;
            }
        }
    }

    // Convert to PNG buffer
    const canvas = new OffscreenCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    ctx.putImageData(new ImageData(imageData, OUTPUT_SIZE, OUTPUT_SIZE), 0, 0);

    const blob = await canvas.convertToBlob({ type: 'image/png', quality: 1.0 });
    const buffer = await blob.arrayBuffer();
    
    processedCacheManager.set(cacheKey, buffer);
    return buffer;
}

export async function setupTerrainProtocol(maplibregl) {
    maplibregl.addProtocol('customdem', async (params) => {
        try {
            const match = params.url.match(/^customdem:\/\/(\d+)\/(\d+)\/(\d+)(\/.*)?$/);
            if (!match) {
                throw new Error("Invalid URL format");
            }

            const [, z, x, y, typeMatch] = match;
            const type = typeMatch ? typeMatch.slice(1) : 'elevation';

            return {
                data: await processDEMTile({
                    zoom: parseInt(z, 10),
                    x: parseInt(x, 10),
                    y: parseInt(y, 10),
                    type
                })
            };
        } catch (error) {
            console.error('DEM map error:', error);
            throw error;
        }
    });
}
