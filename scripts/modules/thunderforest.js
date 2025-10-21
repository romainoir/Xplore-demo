// thunderforest.js
import { map } from '../main/app.js';
import { layerStyles } from './layers.js';

const ICON_BASE_URL = new URL('../../assets/images/markers/', import.meta.url);

async function initializeThunderforestLayers() {
    try {
        if (map.__thunderforestInitialized) {
            return;
        }
        map.__thunderforestInitialized = true;

        const apiKey = 'bbb81d9ac1334825af992c8f0a09ea25';
        const MAX_DISTANCE_KM = 4;

        const thunderforestLayerIds = [
            'paths-hit-area',
            'paths-outline',
            'paths',
            'path-difficulty-markers',
            'hiking-routes',
            'poisth',
            'thunderforest-parking',
            'thunderforest-roads',
            'thunderforest-lakes'
        ];

        // Ensure all dependent layers are removed before manipulating the source
        thunderforestLayerIds.forEach((layerId) => {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
        });

        // Create the distance filter using a circle
        function createDistanceFilter() {
            const center = map.getCenter();
            const radius = MAX_DISTANCE_KM;  // Keep in km for turf
            const circle = turf.circle([center.lng, center.lat], radius, {
                steps: 64,
                units: 'kilometers'
            });
            
            return ['within', circle];
        }

        // Add source if it does not already exist in the style
        if (!map.getSource('thunderforest-outdoors')) {
            map.addSource('thunderforest-outdoors', {
                type: 'vector',
                tiles: [
                    'https://a.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25',
                    'https://b.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25',
                    'https://c.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25'
                ],
                maxzoom: 14
            });
        }

        // Wait for source to be loaded
        await new Promise((resolve) => {
            const checkSource = () => {
                if (map.isSourceLoaded('thunderforest-outdoors')) {
                    resolve();
                } else {
                    map.once('sourcedata', checkSource);
                }
            };
            checkSource();
        });

        // Create the initial distance filter
        const distanceFilter = createDistanceFilter();

        map.on('sourcedata', (e) => {
            if (e.sourceId === 'thunderforest-outdoors' && e.isSourceLoaded) {
                const features = map.querySourceFeatures('thunderforest-outdoors', {
                    sourceLayer: 'path'
                });
            }
        });
        const orderedLayerAdds = [
            { style: layerStyles.pathsHitArea, before: 'refuges-layer' },
            { style: layerStyles.pathsOutline, before: 'paths-hit-area' },
            { style: layerStyles.paths, before: 'paths-outline' },
            { style: layerStyles.pathDifficultyMarkers },
            { style: layerStyles.hikingRoutes },
            { style: layerStyles.poisth },
            { style: layerStyles.thunderforestParking, before: 'refuges-layer' },
            { style: layerStyles.thunderforestRoads, before: 'refuges-layer' },
            { style: layerStyles.thunderforestLakes }
        ];

        orderedLayerAdds.forEach(({ style, before }) => {
            if (!style?.id) {
                return;
            }

            if (map.getLayer(style.id)) {
                return;
            }

            if (before) {
                map.addLayer(style, before);
            } else {
                map.addLayer(style);
            }
        });

        // Load icons first (add this before adding the layer)
        const iconNames = [
            'peak',
            'alpine_hut',
            'shelter',
            'viewpoint',
            'saddle',
            'eau',
            'cave',
            'camp_site',
            'picnic_site',
            'information',
            'guidepost',
            'parking',
            'water_point'
        ];

        await Promise.all(
            iconNames.map(iconName => 
                new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const size = 20; // Standard size for all icons
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, size, size);
                        if (!map.hasImage(iconName)) {
                            map.addImage(iconName, ctx.getImageData(0, 0, size, size));
                        }
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn(`Failed to load icon: ${iconName}`);
                        resolve(); // Resolve anyway to continue loading other icons
                    };
                    img.src = new URL(`${iconName}.png`, ICON_BASE_URL).href;
                })
            )
        );

        // Water texture setup
        const waterTextureImage = new Image();
        waterTextureImage.onload = () => {
            if (!map.hasImage('water_texture')) {
                map.addImage('water_texture', waterTextureImage);
            }
        };
        waterTextureImage.src = 'water_texture.webp';

        if (!map.hasImage('waterTextureImage')) {
            map.addImage('waterTextureImage', {
                width: 256,
                height: 256,
                data: getWaterTexture()
            });
        }

        function getWaterTexture() {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 256;

            const gradient = context.createLinearGradient(0, 0, 256, 256);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            context.fillStyle = gradient;
            context.fillRect(0, 0, 256, 256);

            return context.getImageData(0, 0, 256, 256).data;
        }
        map.on('moveend', () => {
            const newCircleFilter = createDistanceFilter();
            
            ['paths', 'paths-outline', 'paths-hit-area', 'path-difficulty-markers',
             'hiking-routes', 'thunderforest-roads'].forEach(layerId => {
                if (map.getLayer(layerId)) {
                    map.setFilter(layerId, newCircleFilter);
                }
            });

            ['thunderforest-parking', 'thunderforest-lakes'].forEach(layerId => {
                if (map.getLayer(layerId)) {
                    const typeFilter = layerId === 'thunderforest-parking' ?
                        ['==', ['get', 'type'], 'parking'] :
                        ['==', ['get', 'type'], 'water'];
                    map.setFilter(layerId, ['all', typeFilter, newCircleFilter]);
                }
            });
             if (map.getLayer('poisth')) {
                map.setFilter('poisth', ['all',
                    newCircleFilter,
                    ['match',
                        ['get', 'feature'],
                        [
                            'peak',
                            'alpine_hut',
                            'shelter',
                            'viewpoint',
                            'saddle',
                            'spring',
                            'cave',
                            'camp_site',
                            'picnic_site',
                            'information',
                            'guidepost',
                            'parking',
                            'water_point'
                        ],
                        true,
                        false
                    ]
                ]);
            }
        });

        // Click handling
        let selectedPathId = null;
        let justClickedPath = false;  // Flag to track path clicks

        // Handler for clicking on paths
        map.on('click', 'paths-hit-area', (e) => {
            justClickedPath = true;  // Set flag when clicking a path
            
            const bbox = [
                [e.point.x - 5, e.point.y - 5],
                [e.point.x + 5, e.point.y + 5]
            ];
            const features = map.queryRenderedFeatures(bbox, { layers: ['paths-hit-area'] });
            
            if (!features.length) return;

            const feature = features[0];
            
            if (selectedPathId !== feature.id) {
                // Deselect previous path if exists
                if (selectedPathId !== null) {
                    map.setFeatureState(
                        { source: 'thunderforest-outdoors', sourceLayer: 'path', id: selectedPathId },
                        { selected: false }
                    );
                }

                // Select new path
                selectedPathId = feature.id;
                map.setFeatureState(
                    { source: 'thunderforest-outdoors', sourceLayer: 'path', id: selectedPathId },
                    { selected: true }
                );
                map.getCanvas().style.cursor = 'pointer';

                // Show popup
                const properties = feature.properties;
                const content = `
                    <div style="max-width: 300px;">
                        ${properties.sac_scale ? `<p style="margin: 4px 0;"><strong>Difficulté:</strong> ${properties.sac_scale.replace(/_/g, ' ')}</p>` : ''}
                        ${properties.trail_visibility ? `<p style="margin: 4px 0;"><strong>Visibilité:</strong> ${properties.trail_visibility}</p>` : ''}
                        ${properties.surface ? `<p style="margin: 4px 0;"><strong>Terrain:</strong> ${properties.surface}</p>` : ''}
                    </div>
                `;

                new maplibregl.Popup()
                    .setLngLat(e.lngLat)
                    .setHTML(content)
                    .addTo(map);
            }

            // Reset flag after a short delay to allow the map click handler to run
            setTimeout(() => {
                justClickedPath = false;
            }, 0);
        });

        // Handler for clicking anywhere on the map
        map.on('click', (e) => {
            // Only deselect if we didn't just click a path
            if (!justClickedPath && selectedPathId !== null) {
                map.setFeatureState(
                    { source: 'thunderforest-outdoors', sourceLayer: 'path', id: selectedPathId },
                    { selected: false }
                );
                selectedPathId = null;
                map.getCanvas().style.cursor = '';
            }
        });

        // Keep your existing hover effects
        map.on('mouseenter', 'paths-hit-area', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'paths-hit-area', () => {
            if (!selectedPathId) {
                map.getCanvas().style.cursor = '';
            }
        });

        // Layer controls
        const layerControls = [
            { id: 'thunderforest-paths-checkbox', label: 'Thunderforest Paths', layers: ['paths', 'paths-outline', 'paths-hit-area'] },
            { id: 'thunderforest-path-markers-checkbox', label: 'Path Difficulty Markers', layers: ['path-difficulty-markers'] },
            { id: 'thunderforest-parking-checkbox', label: 'Parking Areas', layers: ['thunderforest-parking'] },
             { id: 'thunderforest-Trek-checkbox', label: 'Trekking route', layers: ['hiking-routes'] },
           { id: 'thunderforest-lakes-checkbox', label: 'Lakes', layers: ['thunderforest-lakes'] },
           { id: 'thunderforest-water-checkbox', label: 'Water Sources', layers: ['thunderforest-water-sources'] },
            { id: 'thunderforest-roads-checkbox', label: 'Roads', layers: ['thunderforest-roads'] },
            { id: 'thunderforest-poi-checkbox', label: 'Points of Interest (thunderforest)', layers: ['poisth'] }
        ];

        // Create controls with event listeners
        const layerControl = document.querySelector('.layer-control');
        if (!layerControl) {
            console.error('Layer control container not found! Make sure you have <div class="layer-control"></div> in your HTML');
            return;
        }

        layerControls.forEach(control => {
            const label = document.createElement('label');
            label.style.display = 'block';  // Make each control appear on a new line
            label.style.margin = '5px 0';   // Add some spacing
            label.innerHTML = `<input type="checkbox" id="${control.id}" checked> ${control.label}`;
                        layerControl.appendChild(label);
            
            const checkbox = document.getElementById(control.id);
            if (!checkbox) {
                console.error(`Checkbox for ${control.id} not created properly`);
                return;
            }
            
            checkbox.addEventListener('change', (e) => {
                const visibility = e.target.checked ? 'visible' : 'none';
                if (Array.isArray(control.layers)) {
                    control.layers.forEach(layer => {
                        if (map.getLayer(layer)) {
                            map.setLayoutProperty(layer, 'visibility', visibility);
                        }
                    });
                } else {
                    if (map.getLayer(control.layers)) {
                        map.setLayoutProperty(control.layers, 'visibility', visibility);
                    }
                }
            });
        });

    } catch (error) {
        console.error('Error initializing Thunderforest layers:', error);
        throw error;
    }
}

export default initializeThunderforestLayers;