import { processTile, clearTileCaches } from './demProcessor.js';
import { Protocol as PMTilesProtocol } from 'https://unpkg.com/pmtiles@4.3.0/dist/pmtiles.mjs';
const SUPPORTS_WORKERS = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
const DEFAULT_MAX_WORKERS = 6;

class DemWorkerPool {
    constructor() {
        this.supported = SUPPORTS_WORKERS;
        this.workerUrl = this.supported ? new URL('./demTileWorker.js', import.meta.url) : null;
        this.maxWorkers = this.supported
            ? Math.max(1, Math.min(DEFAULT_MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1 || 1))
            : 0;
        this.workers = [];
        this.queue = [];
        this.pending = new Map();
        this.jobId = 0;
        this.initialized = false;
    }

    async ensureInitialized() {
        if (!this.supported || this.initialized) {
            return this.supported && this.initialized;
        }

        try {
            for (let i = 0; i < this.maxWorkers; i++) {
                const entry = { worker: new Worker(this.workerUrl, { type: 'module' }), busy: false, currentJobId: null };
                entry.worker.onmessage = (event) => this.handleMessage(entry, event);
                entry.worker.onerror = (event) => this.handleError(entry, event);
                this.workers.push(entry);
            }
            this.initialized = true;
        } catch (error) {
            console.warn('DEM worker initialization failed, falling back to main thread processing:', error);
            this.disableWorkers();
        }

        return this.initialized;
    }

    schedule(payload) {
        if (!this.supported) {
            return processTile(payload);
        }

        return new Promise((resolve, reject) => {
            this.ensureInitialized().then((initialized) => {
                if (!initialized) {
                    return processTile(payload).then(resolve).catch(reject);
                }

                this.queue.push({ payload, resolve, reject });
                this.dispatch();
            }).catch((error) => {
                console.warn('Failed to initialize DEM workers, using main thread instead:', error);
                this.disableWorkers();
                processTile(payload).then(resolve).catch(reject);
            });
        });
    }

    dispatch() {
        if (!this.initialized) {
            return;
        }

        for (const entry of this.workers) {
            if (this.queue.length === 0) {
                break;
            }

            if (entry.busy) {
                continue;
            }

            const job = this.queue.shift();
            const id = ++this.jobId;
            this.pending.set(id, job);
            entry.busy = true;
            entry.currentJobId = id;

            try {
                entry.worker.postMessage({ id, payload: job.payload });
            } catch (error) {
                entry.busy = false;
                entry.currentJobId = null;
                this.pending.delete(id);
                this.queue.unshift(job);
                console.error('Failed to post message to DEM worker, falling back to main thread:', error);
                this.disableWorkers();
                break;
            }
        }
    }

    handleMessage(entry, event) {
        entry.busy = false;
        const { id, buffer, error } = event.data || {};
        const job = id !== undefined ? this.pending.get(id) : undefined;
        entry.currentJobId = null;

        if (id !== undefined) {
            this.pending.delete(id);
        }

        if (!job) {
            this.dispatch();
            return;
        }

        if (error) {
            console.error('DEM worker reported an error, retrying on main thread:', error);
            this.runOnMain(job);
        } else if (buffer) {
            job.resolve(buffer);
        } else {
            this.runOnMain(job);
        }

        this.dispatch();
    }

    handleError(entry, event) {
        entry.busy = false;
        const jobId = entry.currentJobId;
        entry.currentJobId = null;

        if (jobId !== null && this.pending.has(jobId)) {
            const job = this.pending.get(jobId);
            this.pending.delete(jobId);
            console.error('DEM worker crashed, retrying job on main thread:', event?.message || event);
            this.runOnMain(job);
        }

        this.dispatch();
    }

    async runOnMain(job) {
        try {
            const buffer = await processTile(job.payload);
            job.resolve(buffer);
        } catch (error) {
            job.reject(error);
        }
    }

    disableWorkers() {
        if (!this.supported) {
            return;
        }

        this.supported = false;
        this.terminateWorkers();

        for (const job of this.queue.splice(0)) {
            this.runOnMain(job);
        }

        for (const [id, job] of this.pending.entries()) {
            this.pending.delete(id);
            this.runOnMain(job);
        }
    }

    terminateWorkers() {
        for (const entry of this.workers) {
            try {
                entry.worker.postMessage({ type: 'terminate' });
                entry.worker.terminate();
            } catch (error) {
                console.warn('Failed to terminate DEM worker cleanly:', error);
            }
        }

        this.workers = [];
        this.initialized = false;
    }

    destroy() {
        this.terminateWorkers();
        this.queue.length = 0;
        for (const [id, job] of this.pending.entries()) {
            this.pending.delete(id);
            job.reject(new Error('DEM worker pool destroyed'));
        }
    }
}

const workerPool = new DemWorkerPool();

export async function setupTerrainProtocol(maplibregl) {
    maplibregl.addProtocol('customdem', async (params) => {
        const match = params.url.match(/^customdem:\/\/(\d+)\/(\d+)\/(\d+)(\/.*)?$/);
        if (!match) {
            throw new Error('Invalid URL format');
        }

        const [, z, x, y, typeMatch] = match;
        const payload = {
            zoom: parseInt(z, 10),
            x: parseInt(x, 10),
            y: parseInt(y, 10),
            type: typeMatch ? typeMatch.slice(1) : 'elevation'
        };

        try {
            const data = await workerPool.schedule(payload);
            return { data };
        } catch (error) {
            console.error('DEM processing failed:', error);
            throw error;
        }
    });

    return {
        cleanup: () => {
            workerPool.destroy();
            clearTileCaches();
        }
    };
}

let mapterhornProtocolInstance = null;
let mapterhornProtocolRegistered = false;
let pmtilesProtocolCtor = (typeof globalThis !== 'undefined' && globalThis.pmtiles && globalThis.pmtiles.Protocol)
    ? globalThis.pmtiles.Protocol
    : null;
let pmtilesProtocolPromise = null;

async function getPMTilesProtocolCtor() {
    if (pmtilesProtocolCtor) {
        return pmtilesProtocolCtor;
    }

    if (!pmtilesProtocolPromise) {
        pmtilesProtocolPromise = import('https://unpkg.com/pmtiles@4.3.0/dist/pmtiles.mjs')
            .then((module) => {
                if (!module?.Protocol) {
                    throw new Error('PMTiles module did not provide a Protocol export.');
                }
                pmtilesProtocolCtor = module.Protocol;
                return pmtilesProtocolCtor;
            })
            .catch((error) => {
                pmtilesProtocolPromise = null;
                throw error;
            });
    }

    return pmtilesProtocolPromise;
}

export function setupMapterhornProtocol(maplibregl) {
    if (mapterhornProtocolRegistered) {
        return;
    }

    maplibregl.addProtocol('mapterhorn', async (params, abortController) => {
        if (!mapterhornProtocolInstance) {
            try {
                const ProtocolCtor = await getPMTilesProtocolCtor();
                mapterhornProtocolInstance = new ProtocolCtor({ metadata: true, errorOnMissingTile: true });
            } catch (error) {
                console.error('Failed to initialize PMTiles protocol for Mapterhorn tiles:', error);
                throw error;
            }
        }

        const [z, x, y] = params.url.replace('mapterhorn://', '').split('/').map(Number);
        const name = z <= 12 ? 'planet' : `6-${x >> (z - 6)}-${y >> (z - 6)}`;
        const url = `pmtiles://https://download.mapterhorn.com/${name}.pmtiles/${z}/${x}/${y}.webp`;
        const response = await mapterhornProtocolInstance.tile({ ...params, url }, abortController);

        if (!response || response.data == null) {
            throw new Error(`Tile z=${z} x=${x} y=${y} not found.`);
        }

        return response;
    });

    mapterhornProtocolRegistered = true;
    if (!pmtilesProtocolCtor) {
        getPMTilesProtocolCtor().catch((error) => {
            console.error('Deferred PMTiles module load failed:', error);
        });
    }
}
