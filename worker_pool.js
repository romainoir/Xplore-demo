// worker_pool.js

export const CACHE_LIMITS = {
    DEM_TILE_CACHE_LIMIT: 6000,
    QUEUE_LIMIT: 200,
    MAX_CONCURRENT_FETCHES: 200
};

export class WorkerPool {
    constructor(map) {
        this.map = map;
        this.workers = [];
        this.maxWorkers = navigator.hardwareConcurrency || 10;
        this.busy = [];
        this.queue = [];
        this.queueLimit = CACHE_LIMITS.QUEUE_LIMIT;
        this.lastMapState = { bearing: 0, pitch: 0 };
        this.terrainCache = new Map();
        this.pendingTiles = new Map();
    }

    initialize() {
        for (let i = 0; i < this.maxWorkers; i++) {
            const workerUrl = new URL('worker_maplibre.js', window.location.href);

            const worker = new Worker(workerUrl, { type: 'module' });
            this.workers.push(worker);
            this.busy.push(false);
            worker.onmessage = this.createMessageHandler(i);
            worker.onerror = this.createErrorHandler(i);
        }

        this.setupFetchInterceptor();
        this.setupMapEventListeners();
    }

    setupMapEventListeners() {
        this.map.on('move', () => {
            this.lastMapState = {
                bearing: this.map.getBearing(),
                pitch: this.map.getPitch(),
                zoom: this.map.getZoom(),
                center: this.map.getCenter()
            };
        });
    }

    setupFetchInterceptor() {
        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function(input, options) {
            try {
                let url, pathname;
                if (typeof input === 'string') {
                    url = new URL(input, window.location.origin);
                    pathname = url.pathname;
                } else if (input instanceof Request) {
                    url = new URL(input.url, window.location.origin);
                    pathname = url.pathname;
                } else {
                    return originalFetch(input, options);
                }

                const terrainTileMatch = pathname.match(/\/terrain_(\d+)_(\d+)_(\d+)\.png$/);
                if (!terrainTileMatch) {
                    return originalFetch(input, options);
                }

                const [_, z, x, y] = terrainTileMatch.map(Number);
                const tileKey = `${z}/${x}/${y}`;

                if (self.terrainCache.has(tileKey)) {
                    return new Response(self.terrainCache.get(tileKey), { 
                        headers: { 'Content-Type': 'image/png' } 
                    });
                }

                if (self.pendingTiles.has(tileKey)) {
                    return self.pendingTiles.get(tileKey).promise
                        .then(blob => new Response(blob, { headers: { 'Content-Type': 'image/png' } }))
                        .catch(() => originalFetch(input, options));
                }

                const { promise, resolve, reject } = await self.createTilePromise();
                self.pendingTiles.set(tileKey, { resolve, reject, promise });
                
                if (!self.postMessage({ zoom: z, x: x, y: y })) {
                    reject(new Error('No workers available'));
                    return originalFetch(input, options);
                }

                try {
                    const blob = await promise;
                    if (self.terrainCache.size >= CACHE_LIMITS.DEM_TILE_CACHE_LIMIT) {
                        const oldestKey = self.terrainCache.keys().next().value;
                        self.terrainCache.delete(oldestKey);
                    }
                    self.terrainCache.set(tileKey, blob);
                    return new Response(blob, { headers: { 'Content-Type': 'image/png' } });
                } catch (error) {
                    return originalFetch(input, options);
                }
            } catch (error) {
                return originalFetch(input, options);
            }
        };
    }

    async createTilePromise() {
        return await new Promise((res) => {
            let resolveTile, rejectTile;
            const tilePromise = new Promise((resolve, reject) => {
                resolveTile = resolve;
                rejectTile = reject;
            });
            res({ promise: tilePromise, resolve: resolveTile, reject: rejectTile });
        });
    }

    createMessageHandler(index) {
        return (e) => {
            this.busy[index] = false;
            if (e.data.type === 'demTile') {
                const { z, x, y, pngBlob, duration } = e.data.data;
                const tileKey = `${z}/${x}/${y}`;
                
                if (this.pendingTiles.has(tileKey)) {
                    this.pendingTiles.get(tileKey).resolve(pngBlob);
                    this.pendingTiles.delete(tileKey);
                    this.preloadAdjacentTiles(z, x, y);
                }
            }
            this.processQueue();
        };
    }

    createErrorHandler(index) {
        return (e) => {
            this.busy[index] = false;
            console.error(`Worker ${index} error:`, e);
            this.processQueue();
        };
    }

    getAvailableWorker() {
        const index = this.busy.findIndex(b => !b);
        if (index !== -1) {
            this.busy[index] = true;
            return this.workers[index];
        }
        return null;
    }

    calculatePriority(z, x, y) {
        let priority = Math.min(19 - z, 10);
        
        const bearing = this.map.getBearing();
        const pitch = this.map.getPitch();
        const center = this.map.getCenter();
        
        const tileLat = this.tile2lat(y + 0.5, z);
        const tileLon = (x / Math.pow(2, z)) * 360 - 180;
        
        const dy = tileLat - center.lat;
        const dx = tileLon - center.lng;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const tileAngle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const viewingAngle = (bearing + 360) % 360;
        const angleDiff = Math.abs(tileAngle - viewingAngle);

        if (angleDiff < 30) priority += 3;
        else if (angleDiff < 60) priority += 2;
        else if (angleDiff < 90) priority += 1;

        const distancePenalty = Math.min(distance * 0.5, 2);
        priority -= distancePenalty;

        if (pitch > 45 && angleDiff < 90) {
            priority += (pitch - 45) / 45 * 2;
        }

        const currentZoom = this.map.getZoom();
        const zoomDiff = Math.abs(z - currentZoom);
        if (zoomDiff < 1) priority += 1;

        return Math.max(0, Math.min(priority, 15));
    }

    tile2lat(y, z) {
        const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }

    preloadAdjacentTiles(z, x, y) {
        const adjacent = [
            {x: x-1, y: y, p: 1}, {x: x+1, y: y, p: 1},
            {x: x, y: y-1, p: 1}, {x: x, y: y+1, p: 1},
            {x: x-1, y: y-1, p: 0.5}, {x: x+1, y: y-1, p: 0.5},
            {x: x-1, y: y+1, p: 0.5}, {x: x+1, y: y+1, p: 0.5}
        ];
        
        adjacent.forEach(tile => {
            const tileKey = `${z}/${tile.x}/${tile.y}`;
            if (!this.terrainCache.has(tileKey) && !this.pendingTiles.has(tileKey)) {
                this.addToQueue(
                    { zoom: z, x: tile.x, y: tile.y },
                    tile.p * this.calculatePriority(z, tile.x, tile.y)
                );
            }
        });
    }

    addToQueue(data, priority = 0) {
        const queueItem = {
            data,
            priority: priority || this.calculatePriority(data.zoom, data.x, data.y),
            timestamp: Date.now()
        };
        
        this.queue.push(queueItem);
        
        if (this.queue.length > this.queueLimit) {
            this.queue.sort((a, b) => b.priority - a.priority);
            this.queue = this.queue.slice(0, this.queueLimit);
        }
        
        this.processQueue();
    }

    processQueue() {
        const batchSize = 4;
        while (this.queue.length > 0) {
            const availableWorkers = this.busy.filter(b => !b).length;
            if (availableWorkers === 0) break;

            const batch = this.queue.splice(0, Math.min(batchSize, availableWorkers));
            batch.forEach(({ data }) => {
                const worker = this.getAvailableWorker();
                if (worker) worker.postMessage(data);
            });
        }
    }

    postMessage(data) {
        const worker = this.getAvailableWorker();
        if (worker) {
            worker.postMessage(data);
            return true;
        }
        this.addToQueue(data);
        return true;
    }

    terminate() {
        this.workers.forEach(worker => worker.terminate());
        this.workers = [];
        this.busy = [];
        this.queue = [];
        this.terrainCache.clear();
        this.pendingTiles.clear();
    }
}