import { GEOPORTAIL_CAPABILITIES_URL, buildGeoportailDemTileUrlRaw } from './geoportailConfig.js';

// Cache only raw DEM tiles
class DEMCache {
    constructor(maxSize = 800) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.accessOrder = [];
    }

    get(key) {
        const entry = this.cache.get(key);
        if (entry) {
            // Move to end of access order
            this.accessOrder = this.accessOrder.filter(k => k !== key);
            this.accessOrder.push(key);
            return entry;
        }
        return null;
    }

    set(key, value) {
        // Evict oldest entries if cache is full
        while (this.cache.size >= this.maxSize) {
            const oldestKey = this.accessOrder.shift();
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, value);
        this.accessOrder.push(key);
    }

    clear() {
        this.cache.clear();
        this.accessOrder = [];
    }
}
class RequestQueue {
    constructor() {
        this.pending = new Map();
    }

    async enqueue(key, operation) {
        if (this.pending.has(key)) {
            // Return existing promise if this request is already in flight
            return this.pending.get(key);
        }

        const promise = operation().finally(() => {
            this.pending.delete(key);
        });

        this.pending.set(key, promise);
        return promise;
    }
}

// Create instances
const demRequestQueue = new RequestQueue();

// Single cache instance for raw DEM data
const demCache = new DEMCache(400); // Smaller cache size since MapLibre handles final tiles
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

// Efficient implementation of median filter for terrain data
function medianFilter(data, width, height, kernelSize = 3) {
    const halfKernel = Math.floor(kernelSize / 2);
    const result = new Float32Array(width * height);
    const kernel = new Float32Array(kernelSize * kernelSize);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let kernelIndex = 0;
            
            // Gather values for the kernel window
            for (let ky = -halfKernel; ky <= halfKernel; ky++) {
                const ny = Math.max(0, Math.min(height - 1, y + ky));
                
                for (let kx = -halfKernel; kx <= halfKernel; kx++) {
                    const nx = Math.max(0, Math.min(width - 1, x + kx));
                    kernel[kernelIndex++] = data[ny * width + nx];
                }
            }
            
            // Sort kernel values and take median
            kernel.sort((a, b) => a - b);
            result[y * width + x] = kernel[Math.floor(kernelSize * kernelSize / 2)];
        }
    }
    
    return result;
}

// Gaussian blur for smoother results
function gaussianBlur(data, width, height, sigma = 1.4) {
    const kernelSize = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
    const halfKernel = Math.floor(kernelSize / 2);
    const kernel = createGaussianKernel(kernelSize, sigma);
    const result = new Float32Array(width * height);
    const temp = new Float32Array(width * height);
    
    // Horizontal pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            let weightSum = 0;
            
            for (let kx = -halfKernel; kx <= halfKernel; kx++) {
                const nx = Math.max(0, Math.min(width - 1, x + kx));
                const weight = kernel[kx + halfKernel];
                sum += data[y * width + nx] * weight;
                weightSum += weight;
            }
            
            temp[y * width + x] = sum / weightSum;
        }
    }
    
    // Vertical pass
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let sum = 0;
            let weightSum = 0;
            
            for (let ky = -halfKernel; ky <= halfKernel; ky++) {
                const ny = Math.max(0, Math.min(height - 1, y + ky));
                const weight = kernel[ky + halfKernel];
                sum += temp[ny * width + x] * weight;
                weightSum += weight;
            }
            
            result[y * width + x] = sum / weightSum;
        }
    }
    
    return result;
}

function createGaussianKernel(size, sigma) {
    const kernel = new Float32Array(size);
    const center = Math.floor(size / 2);
    let sum = 0;
    
    for (let i = 0; i < size; i++) {
        const x = i - center;
        kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
        sum += kernel[i];
    }
    
    // Normalize kernel
    for (let i = 0; i < size; i++) {
        kernel[i] /= sum;
    }
    
    return kernel;
}

// Combined filter that applies both median and gaussian blur
function applyTerrainFilters(heightmap, width, height, options = {}) {
    const {
        medianKernelSize = 3,
        gaussianSigma = 1.4,
        iterations = 1
    } = options;
    
    let filtered = heightmap;
    
    for (let i = 0; i < iterations; i++) {
        // Apply median filter first to remove spikes
        filtered = medianFilter(filtered, width, height, medianKernelSize);
        
        // Then apply gaussian blur for smoother transitions
        filtered = gaussianBlur(filtered, width, height, gaussianSigma);
    }
    
    return filtered;
}

// Adaptive filter settings based on zoom level
function getFilterSettings(zoom) {
    // Adjust filter parameters based on zoom level
    if (zoom >= 16) {
        return {
            medianKernelSize: 5,    // Larger kernel for high zoom levels
            gaussianSigma: 1.8,
            iterations: 2
        };
    } else if (zoom >= 14) {
        return {
            medianKernelSize: 3,
            gaussianSigma: 1.4,
            iterations: 1
        };
    } else {
        return {
            medianKernelSize: 3,
            gaussianSigma: 1.2,
            iterations: 1
        };
    }
}
function calculateGradients(heightmap, width, height, zoom) {
    const scale = calculateZoomScale(zoom);
    const gradients = new Float32Array(width * height * 2);
    const invScale = 1 / scale;
    const widthMinus1 = width - 1;
    const heightMinus1 = height - 1;
    
    // Apply terrain filtering with zoom-dependent settings
    const filterSettings = getFilterSettings(zoom);
    const filteredHeightmap = applyTerrainFilters(heightmap, width, height, filterSettings);
    
    // Process 4 pixels at once where possible
    const blockSize = 4;
    const blockEnd = Math.floor(width * height / blockSize) * blockSize;
    
    for (let i = 0; i < blockEnd; i += blockSize) {
        const y = Math.floor(i / width);
        const x = i % width;
        
        // Process 4 consecutive pixels
        for (let j = 0; j < blockSize; j++) {
            const currY = Math.floor((i + j) / width);
            const currX = (i + j) % width;
            
            if (currY >= height) continue;
            
            const yPrev = currY > 0 ? currY - 1 : 0;
            const yNext = currY < heightMinus1 ? currY + 1 : heightMinus1;
            const xPrev = currX > 0 ? currX - 1 : 0;
            const xNext = currX < widthMinus1 ? currX + 1 : widthMinus1;
            
            const dzdx = (filteredHeightmap[currY * width + xNext] - filteredHeightmap[currY * width + xPrev]) * 
                        ((currX === 0 || currX === widthMinus1) ? invScale : (0.5 * invScale));
            
            const dzdy = (filteredHeightmap[yNext * width + currX] - filteredHeightmap[yPrev * width + currX]) * 
                        ((currY === 0 || currY === heightMinus1) ? invScale : (0.5 * invScale));
            
            const gradIdx = (i + j) * 2;
            gradients[gradIdx] = dzdx;
            gradients[gradIdx + 1] = dzdy;
        }
    }
    
    // Handle remaining pixels
    for (let i = blockEnd; i < width * height; i++) {
        const y = Math.floor(i / width);
        const x = i % width;
        
        const yPrev = y > 0 ? y - 1 : 0;
        const yNext = y < heightMinus1 ? y + 1 : heightMinus1;
        const xPrev = x > 0 ? x - 1 : 0;
        const xNext = x < widthMinus1 ? x + 1 : widthMinus1;
        
        const dzdx = (filteredHeightmap[y * width + xNext] - filteredHeightmap[y * width + xPrev]) * 
                    ((x === 0 || x === widthMinus1) ? invScale : (0.5 * invScale));
        
        const dzdy = (filteredHeightmap[yNext * width + x] - filteredHeightmap[yPrev * width + x]) * 
                    ((y === 0 || y === heightMinus1) ? invScale : (0.5 * invScale));
        
        const gradIdx = i * 2;
        gradients[gradIdx] = dzdx;
        gradients[gradIdx + 1] = dzdy;
    }
    
    return gradients;
}

function calculateNormalMap(gradients, width, height) {
    const normals = new Float32Array(width * height * 3);
    
    for (let i = 0; i < width * height; i++) {
        const gradIdx = i * 2;
        const normIdx = i * 3;
        const dzdx = gradients[gradIdx];
        const dzdy = gradients[gradIdx + 1];
        
        const invLength = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        normals[normIdx] = -dzdx * invLength;
        normals[normIdx + 1] = -dzdy * invLength;
        normals[normIdx + 2] = invLength;
    }
    
    return encodeNormalMap(normals);
}
function calculateSlopeMap(gradients, width, height) {
    const slopes = new Float32Array(width * height);
    
    for (let i = 0; i < width * height; i++) {
        const gradIdx = i * 2;
        const dzdx = gradients[gradIdx];
        const dzdy = gradients[gradIdx + 1];
        slopes[i] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * RAD_TO_DEG;
    }
    
    return encodeSlopeMap(slopes);
}
function calculateAspectMap(gradients, width, height) {
    const aspects = new Float32Array(width * height);
    
    for (let i = 0; i < width * height; i++) {
        const gradIdx = i * 2;
        const dzdx = gradients[gradIdx];
        const dzdy = gradients[gradIdx + 1];
        
        let aspect = Math.atan2(dzdy, -dzdx) * RAD_TO_DEG;
        aspect = 90 - aspect;
        if (aspect < 0) aspect += 360;
        if (aspect > 360) aspect -= 360;
        aspects[i] = aspect;
    }
    
    return encodeAspectMap(aspects);
}
function calculateElevationMap(resampledDEM, width, height) {
    const imageData = new Uint8ClampedArray(width * height * 4);
    
    for (let i = 0; i < width * height; i++) {
        const rgb = encodeTerrainRGB(resampledDEM[i]);
        const idx = i * 4;
        imageData[idx] = rgb[0];
        imageData[idx + 1] = rgb[1];
        imageData[idx + 2] = rgb[2];
        imageData[idx + 3] = 255;
    }
    
    return imageData;
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

// Update getDEMTile to use the queue
async function getDEMTile(tx, ty, demZoom, demMatrix) {
    const cacheKey = `${demZoom}_${tx}_${ty}`;
    const cachedTile = demCache.get(cacheKey);
    if (cachedTile) return cachedTile;

    // Use request queue to deduplicate in-flight requests
    return demRequestQueue.enqueue(cacheKey, async () => {
        try {
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
            demCache.set(cacheKey, tileData);
            return tileData;
        } catch (error) {
            console.error('Error fetching DEM tile:', error);
            throw error;
        }
    });
}

// Also update fetchCapabilities to use request queue
const capabilitiesQueue = new RequestQueue();

async function fetchCapabilities() {
    if (!demCapabilities.has('WGS84G')) {
        return capabilitiesQueue.enqueue('capabilities', async () => {
            if (!demCapabilities.has('WGS84G')) {  // Double-check after getting queue lock
                try {
                    const response = await fetch(GEOPORTAIL_CAPABILITIES_URL);
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
        });
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

    // Fetch required DEM tiles
    const demTiles = (await Promise.all(
        Array.from({ length: (xMax - xMin + 1) * (yMax - yMin + 1) }, async (_, i) => {
            const tx = xMin + (i % (xMax - xMin + 1));
            const ty = yMin + Math.floor(i / (xMax - xMin + 1));
            try {
                return await getDEMTile(tx, ty, demZoom, demMatrix);
            } catch (error) {
                console.warn(`Failed to fetch DEM tile ${tx},${ty}`, error);
                return null;
            }
        })
    )).filter(Boolean); // Remove any null results from failed fetches

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
    if (type !== 'elevation') {
        // Calculate gradients once for all non-elevation types
        const gradients = calculateGradients(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
        
        switch (type) {
            case 'normal':
                imageData = calculateNormalMap(gradients, OUTPUT_SIZE, OUTPUT_SIZE);
                break;
            case 'slope':
                imageData = calculateSlopeMap(gradients, OUTPUT_SIZE, OUTPUT_SIZE);
                break;
            case 'aspect':
                imageData = calculateAspectMap(gradients, OUTPUT_SIZE, OUTPUT_SIZE);
                break;
            default:
                throw new Error(`Unknown visualization type: ${type}`);
        }
    } else {
        imageData = calculateElevationMap(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE);
    }

    // Convert to PNG buffer
    const canvas = new OffscreenCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    ctx.putImageData(new ImageData(imageData, OUTPUT_SIZE, OUTPUT_SIZE), 0, 0);

    const blob = await canvas.convertToBlob({ type: 'image/png', quality: 1.0 });
    return await blob.arrayBuffer();
}

export async function setupTerrainProtocol(maplibregl) {
    const handler = async (params) => {
        try {
            const match = params.url.match(/^customdem:\/\/(\d+)\/(\d+)\/(\d+)(\/.*)?$/);
            if (!match) {
                throw new Error("Invalid URL format");
            }

            const [, z, x, y, typeMatch] = match;
            const type = typeMatch ? typeMatch.slice(1) : 'elevation';

            // Let MapLibre handle the caching of processed tiles
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
    };

    if (typeof maplibregl?.addProtocol === 'function') {
        maplibregl.addProtocol('customdem', handler);

        return {
            cleanup: () => {
                if (typeof maplibregl.removeProtocol === 'function') {
                    maplibregl.removeProtocol('customdem');
                }
                demCache.clear();
                demCapabilities.clear();
            }
        };
    }

    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        const originalFetch = window.fetch.bind(window);

        window.fetch = async (input, init) => {
            const isRequest = typeof Request !== 'undefined' && input instanceof Request;
            const requestUrl = typeof input === 'string'
                ? input
                : (isRequest ? input.url : input?.url);

            if (typeof requestUrl === 'string' && requestUrl.startsWith('customdem://')) {
                const signal = init?.signal ?? (isRequest ? input.signal : undefined);
                if (signal?.aborted) {
                    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
                }

                const { data } = await handler({ url: requestUrl });
                return new Response(data, {
                    status: 200,
                    headers: { 'Content-Type': 'application/octet-stream' }
                });
            }

            return originalFetch(input, init);
        };

        return {
            cleanup: () => {
                window.fetch = originalFetch;
                demCache.clear();
                demCapabilities.clear();
            }
        };
    }

    console.error('No protocol support available for custom DEM tiles.');
    return {
        cleanup: () => {
            demCache.clear();
            demCapabilities.clear();
        }
    };
}
