import { getGeoportailCapabilitiesUrl, buildGeoportailDemTileUrlRaw } from './geoportailConfig.js';

// worker_maplibre.js

function formatTimeLog(start, tileKey, priority) {
    const duration = performance.now() - start;
    return `Tile ${tileKey} (priority: ${priority.toFixed(2)}) processed in ${duration.toFixed(2)}ms`;
}

// Class to parse WMTS Capabilities
class WMTSCapabilities {
    constructor() {
        this.tileMatrixSets = {};
    }

    async initialize() {
        const response = await fetch(getGeoportailCapabilitiesUrl());
        if (!response.ok) throw new Error(`Failed to fetch WMTS Capabilities: ${response.status}`);
        const text = await response.text();

        // Extract TileMatrixSets using regex
        const tileMatrixSetRegex = /<TileMatrixSet>([\s\S]*?)<\/TileMatrixSet>/g;
        let match;

        while ((match = tileMatrixSetRegex.exec(text)) !== null) {
            const tmsContent = match[1];
            const identifier = this.extractValue(tmsContent, 'ows:Identifier');
            if (identifier) {
                this.tileMatrixSets[identifier] = this.parseTileMatrixSet(tmsContent);
            }
        }
    }

    extractValue(content, tag) {
        const regex = new RegExp(`<${tag}>(.*?)<\/${tag}>`);
        const match = content.match(regex);
        return match ? match[1].trim() : null;
    }

    parseTileMatrixSet(content) {
        const matrices = {};
        const tileMatrixRegex = /<TileMatrix>([\s\S]*?)<\/TileMatrix>/g;
        let match;

        while ((match = tileMatrixRegex.exec(content)) !== null) {
            const matrixContent = match[1];
            const identifier = this.extractValue(matrixContent, 'ows:Identifier');

            if (identifier) {
                matrices[identifier] = {
                    scaleDenominator: parseFloat(this.extractValue(matrixContent, 'ScaleDenominator')),
                    topLeftCorner: this.extractValue(matrixContent, 'TopLeftCorner')?.split(' ').map(Number),
                    tileWidth: parseInt(this.extractValue(matrixContent, 'TileWidth')),
                    tileHeight: parseInt(this.extractValue(matrixContent, 'TileHeight')),
                    matrixWidth: parseInt(this.extractValue(matrixContent, 'MatrixWidth')),
                    matrixHeight: parseInt(this.extractValue(matrixContent, 'MatrixHeight'))
                };
            }
        }
        return matrices;
    }
}

// Projection and Coordinate Conversion Functions
function calculateTileBounds(zoom, x, y) {
    const n = Math.pow(2, zoom);

    const lonLeft = (x / n) * 360 - 180;
    const lonRight = ((x + 1) / n) * 360 - 180;

    const latTop = tile2lat(y, zoom);
    const latBottom = tile2lat(y + 1, zoom);

    return [
        [latBottom, lonLeft], // Southwest
        [latTop, lonRight]    // Northeast
    ];
}

function tile2lat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Resampling function for Float32Array using bilinear interpolation
function resampleFloatDEM(mergedDEM, mergedWidth, mergedHeight, demBounds, tileBounds, targetWidth, targetHeight) {
    const resampledDEM = new Float32Array(targetWidth * targetHeight);

    const [sw, ne] = tileBounds; // [ [southLat, westLng], [northLat, eastLng] ]
    const [swDem, neDem] = demBounds;

    // Calculate scaling factors based on tileBounds
    const latScale = (ne[0] - sw[0]) / targetHeight;
    const lonScale = (ne[1] - sw[1]) / targetWidth;

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            // Calculate the corresponding position in mergedDEM
            const lat = ne[0] - y * latScale; // Changed from sw[0] + y * latScale
            const lon = sw[1] + x * lonScale;

            // Convert geographical coordinates to pixel coordinates in mergedDEM
            const srcX = ((lon - swDem[1]) / (neDem[1] - swDem[1])) * mergedWidth;
            const srcY = ((neDem[0] - lat) / (neDem[0] - swDem[0])) * mergedHeight;

            // Bilinear interpolation
            const x0 = Math.floor(srcX);
            const y0 = Math.floor(srcY);
            const x1 = Math.min(x0 + 1, mergedWidth - 1);
            const y1 = Math.min(y0 + 1, mergedHeight - 1);

            const dx = srcX - x0;
            const dy = srcY - y0;

            const elevation =
                (1 - dx) * (1 - dy) * mergedDEM[y0 * mergedWidth + x0] +
                dx * (1 - dy) * mergedDEM[y0 * mergedWidth + x1] +
                (1 - dx) * dy * mergedDEM[y1 * mergedWidth + x0] +
                dx * dy * mergedDEM[y1 * mergedWidth + x1];

            resampledDEM[y * targetWidth + x] = elevation;
        }
    }
    return resampledDEM;
}

// Cache for DEM tiles with a limit of 100 tiles
const demTileCache = new Map();
const DEM_TILE_CACHE_LIMIT = 2000;

// Function to get DEM tile from cache or fetch it
async function getDEMTile(tx, ty, demZoom, demMatrix) {
    const tileKey = `${demZoom}_${tx}_${ty}`;

    if (demTileCache.has(tileKey)) {
        // Move the tile to the end to mark it as recently used
        const tileData = demTileCache.get(tileKey);
        demTileCache.delete(tileKey);
        demTileCache.set(tileKey, tileData);
        return tileData;
    } else {
        try {
            // Fetch the DEM tile
            const demUrl = buildGeoportailDemTileUrlRaw({
                layer: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS'
            }, { z: demZoom, x: tx, y: ty });

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

            // Add to cache
            demTileCache.set(tileKey, tileData);

            // Evict least recently used tiles if cache exceeds limit
            if (demTileCache.size > DEM_TILE_CACHE_LIMIT) {
                const oldestKey = demTileCache.keys().next().value;
                demTileCache.delete(oldestKey);
            }

            return tileData;
        } catch (error) {
            throw error; // Propagate error to be handled in processDEMTile
        }
    }
}

// Function to calculate the normal map from elevation data
function calculateNormalMap(elevationData, width, height, scale = 0.2) {
    const normalMap = new Float32Array(width * height * 3);

    const getElevation = (x, y) => {
        if (x < 0) x = 0;
        if (x >= width) x = width - 1;
        if (y < 0) y = 0;
        if (y >= height) y = height - 1;
        const elevation = elevationData[y * width + x];
        return elevation === -9999 ? 0 : elevation;
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const left = getElevation(x - 1, y);
            const right = getElevation(x + 1, y);
            const up = getElevation(x, y - 1);
            const down = getElevation(x, y + 1);

            const dzdx = (right - left) * scale;
            const dzdy = (down - up) * scale;

            const length = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
            normalMap[idx] = -dzdx / length;
            normalMap[idx + 1] = -dzdy / length;
            normalMap[idx + 2] = 1.0 / length;
        }
    }
    return normalMap;
}

// Add this function at the top level
function encodeTerrainRGB(elevation) {
    // Handle no-data or invalid values
    if (isNaN(elevation) || elevation === -9999) {
        return [0, 0, 0];
    }

    // Clamp elevation to valid range (-10000m to 10000m)
    const height = Math.max(-10000, Math.min(10000, elevation));
    
    // Encode elevation following Mapbox's encoding:
    // height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
    const encodedHeight = (height + 10000) * 10;

    return [
        Math.floor(encodedHeight / (256 * 256)),          // R
        Math.floor((encodedHeight % (256 * 256)) / 256),  // G
        Math.floor(encodedHeight % 256)                   // B
    ];
}

// Main processing function
async function processDEMTile({ zoom, x, y }, capabilities) {
    const OUTPUT_SIZE = 256;
    const tileKey = `${zoom}/${x}/${y}`;
    const demZoom = Math.max(0, zoom + 0);
    
    console.log('=== Starting DEM Tile Processing ===');
    console.log(`Original tile request: zoom ${zoom}, x ${x}, y ${y}`);
    console.log(`Using DEM zoom level: ${demZoom}`);

    // Calculate tile bounds
    const tileBounds = calculateTileBounds(zoom, x, y);
    console.log('Calculated tile bounds:', tileBounds);

    const demMatrix = capabilities.tileMatrixSets['WGS84G'][demZoom];
    if (!demMatrix) {
        console.error(`No DEM matrix found for zoom ${demZoom}`);
        return null;
    }

    const [originLon, originLat] = demMatrix.topLeftCorner;
    const degreesPerTileLon = 360 / demMatrix.matrixWidth;
    const degreesPerTileLat = 180 / demMatrix.matrixHeight;

    // Calculate DEM tile indices
    const xMin = Math.floor((tileBounds[0][1] - originLon) / degreesPerTileLon);
    const xMax = Math.floor((tileBounds[1][1] - originLon) / degreesPerTileLon);
    const yMin = Math.floor((originLat - tileBounds[1][0]) / degreesPerTileLat);
    const yMax = Math.floor((originLat - tileBounds[0][0]) / degreesPerTileLat);

    console.log('DEM tile coverage:', {
        xRange: `${xMin} to ${xMax}`,
        yRange: `${yMin} to ${yMax}`,
        totalTilesNeeded: (xMax - xMin + 1) * (yMax - yMin + 1)
    });

    const demTilePromises = [];
    const maxConcurrentFetches = 500;
    let currentFetches = 0;

    for (let tx = xMin; tx <= xMax; tx++) {
        for (let ty = yMin; ty <= yMax; ty++) {
            const fetchTile = async () => {
                try {
                    return await getDEMTile(tx, ty, demZoom, demMatrix);
                } catch (error) {
                    console.error(`Error fetching DEM tile ${tx},${ty}:`, error);
                    return null;
                }
            };

            demTilePromises.push(
                new Promise(async (resolve) => {
                    while (currentFetches >= maxConcurrentFetches) {
                        await new Promise((res) => setTimeout(res, 50));
                    }
                    currentFetches++;
                    const tile = await fetchTile();
                    currentFetches--;
                    resolve(tile);
                })
            );
        }
    }

    const start = performance.now();
    
    // Get DEM tiles
    const demTiles = (await Promise.all(demTilePromises)).filter((tile) => tile !== null);
    console.log(`Successfully fetched ${demTiles.length} DEM tiles`);

    if (demTiles.length === 0) {
        throw new Error('No DEM tiles fetched successfully.');
    }

    const demTileBounds = demTiles.map((tile) => tile.bounds);
    const demBounds = [
        [Math.min(...demTileBounds.map((b) => b[0][0])), Math.min(...demTileBounds.map((b) => b[0][1]))],
        [Math.max(...demTileBounds.map((b) => b[1][0])), Math.max(...demTileBounds.map((b) => b[1][1]))]
    ];

    // Calculate unique tile counts
    const uniqueX = new Set(demTiles.map((t) => t.x)).size;
    const uniqueY = new Set(demTiles.map((t) => t.y)).size;
    const mergedWidth = uniqueX * 256;
    const mergedHeight = uniqueY * 256;

    console.log('Preparing to merge tiles:', {
        uniqueX,
        uniqueY,
        mergedWidth,
        mergedHeight,
        totalPixels: mergedWidth * mergedHeight
    });

    // Create merged DEM
    const mergedDEM = new Float32Array(mergedWidth * mergedHeight);

    // Sort and merge tiles
    demTiles.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
    });

    // Merge tiles
    for (let i = 0; i < demTiles.length; i++) {
        const tile = demTiles[i];
        const col = tile.x - xMin;
        const row = tile.y - yMin;

        for (let rowIdx = 0; rowIdx < 256; rowIdx++) {
            const destRowOffset = (row * 256 + rowIdx) * mergedWidth + col * 256;
            const srcRowOffset = rowIdx * 256;
            for (let colIdx = 0; colIdx < 256; colIdx++) {
                mergedDEM[destRowOffset + colIdx] = tile.elevationData[srcRowOffset + colIdx];
            }
        }
    }

    // Log merged DEM statistics safely
    let mergedMin = Infinity;
    let mergedMax = -Infinity;
    let noDataCount = 0;
    for (let i = 0; i < mergedDEM.length; i++) {
        const val = mergedDEM[i];
        if (val === -9999) {
            noDataCount++;
        } else {
            mergedMin = Math.min(mergedMin, val);
            mergedMax = Math.max(mergedMax, val);
        }
    }
    console.log('Merged DEM statistics:', {
        min: mergedMin,
        max: mergedMax,
        noDataCount,
        totalPixels: mergedDEM.length
    });

    const resampledElevationData = resampleFloatDEM(
        mergedDEM,
        mergedWidth,
        mergedHeight,
        demBounds,
        tileBounds,
        OUTPUT_SIZE,
        OUTPUT_SIZE
    );

    // Log resampled statistics safely
    let resampledMin = Infinity;
    let resampledMax = -Infinity;
    let resampledNoData = 0;
    for (let i = 0; i < resampledElevationData.length; i++) {
        const val = resampledElevationData[i];
        if (val === -9999) {
            resampledNoData++;
        } else {
            resampledMin = Math.min(resampledMin, val);
            resampledMax = Math.max(resampledMax, val);
        }
    }
    console.log('Resampled DEM statistics:', {
        min: resampledMin,
        max: resampledMax,
        noDataCount: resampledNoData,
        totalPixels: resampledElevationData.length
    });

    // Create final image
    const imageData = new Uint8ClampedArray(OUTPUT_SIZE * OUTPUT_SIZE * 4);
    for (let i = 0; i < OUTPUT_SIZE * OUTPUT_SIZE; i++) {
        const elevation = resampledElevationData[i];
        const rgb = encodeTerrainRGB(elevation);
        const idx = i * 4;
        imageData[idx] = rgb[0];
        imageData[idx + 1] = rgb[1];
        imageData[idx + 2] = rgb[2];
        imageData[idx + 3] = 255;
    }

    const canvas = new OffscreenCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
    const ctx = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: false
    });
    
    ctx.putImageData(new ImageData(imageData, OUTPUT_SIZE, OUTPUT_SIZE), 0, 0);
    const blob = await canvas.convertToBlob({ 
        type: 'image/png',
        quality: 1.0
    });

    const duration = performance.now() - start;
    console.log(`=== Completed processing tile ${tileKey} in ${duration.toFixed(2)}ms ===`);

    return {
        z: zoom,
        x: x,
        y: y,
        pngBlob: blob,
        duration: duration
    };
}

// Initialize capabilities and then set up message handler
let capabilitiesPromise = (async () => {
    try {
        const cap = new WMTSCapabilities();
        await cap.initialize();
        return cap;
    } catch (error) {
        console.error('Failed to initialize WMTS Capabilities:', error);
        throw error;
    }
})();

self.onmessage = async function (e) {
    try {
        const capabilities = await capabilitiesPromise;
        const result = await processDEMTile(e.data, capabilities);
        self.postMessage({
            type: 'demTile',
            data: result
        });
    } catch (error) {
        console.error('Worker processing error:', error);
        self.postMessage({
            type: 'error',
            message: error.message,
            data: e.data // Optionally include tile coordinates
        });
    }
};