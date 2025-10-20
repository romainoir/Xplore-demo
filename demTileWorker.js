import { processTile } from './demProcessor.js';

self.onmessage = async (event) => {
    const { id, payload, type } = event.data;

    if (type === 'terminate') {
        self.close();
        return;
    }

    try {
        const buffer = await processTile(payload);
        self.postMessage({ id, buffer }, [buffer]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        self.postMessage({ id, error: message });
    }
};
