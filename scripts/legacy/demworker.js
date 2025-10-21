import { calculateNormals, calculateSlope, calculateAspect, encodeNormalMap, encodeSlopeMap, encodeAspectMap, encodeTerrainRGB } from '../modules/terrain/terrainprotocol.js';


onmessage = async (event) => {
    const { task, data } = event.data;
    let result;

    switch (task) {
        case 'processDemAndGenerateMaps': {
            const { mergedDEM, mergedWidth, mergedHeight, OUTPUT_SIZE, tileBounds, demBounds, zoom } = data;

            // Resample the DEM
            const [sw, ne] = tileBounds;
            const latScale = (ne[0] - sw[0]) / OUTPUT_SIZE;
            const lonScale = (ne[1] - sw[1]) / OUTPUT_SIZE;
            const resampledDEM = new Float32Array(OUTPUT_SIZE * OUTPUT_SIZE);

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
            // Calculate all the maps

            const normals = calculateNormals(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            const slopes = calculateSlope(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            const aspects = calculateAspect(resampledDEM, OUTPUT_SIZE, OUTPUT_SIZE, zoom);
            const encodedElevation = new Uint8ClampedArray(OUTPUT_SIZE * OUTPUT_SIZE * 4);

            for (let i = 0; i < OUTPUT_SIZE * OUTPUT_SIZE; i++) {
                const rgb = encodeTerrainRGB(resampledDEM[i]);
                const idx = i * 4;
                encodedElevation[idx] = rgb[0];
                encodedElevation[idx + 1] = rgb[1];
                encodedElevation[idx + 2] = rgb[2];
                encodedElevation[idx + 3] = 255;
            }

            const encodedNormals = encodeNormalMap(normals);
            const encodedSlopes = encodeSlopeMap(slopes);
            const encodedAspects = encodeAspectMap(aspects);


            result = {
                encodedNormals,
                encodedSlopes,
                encodedAspects,
                encodedElevation,
            };
            break;
        }

        default:
            console.error('Unknown task:', task);
            return;
    }

    postMessage({ task, result });
};