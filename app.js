// app.js
import { fetchWikimediaPhotos, setupWikimediaEventListeners } from './wikimedia.js';
import { fetchPointsOfInterest, setupRefugesEventListeners } from './refuges.js';
import initializeThunderforestLayers from './thunderforest.js';
import { processOsmData, getOverpassQuery } from './signpost.js';
import { layerStyles, addLayersToMap } from './layers.js';
import { WorkerPool } from './worker_pool.js';

// Initialize DEM source
const demSource = new mlcontour.DemSource({
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    encoding: "terrarium",
    maxzoom: 18,
    worker: true
});

// Constants
const THROTTLE_DELAY = 500;
const osmCache = new Map();

// Utility Functions
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Initialize MapLibre Map
const map = new maplibregl.Map({
    container: 'map',
    canvasContextAttributes: {
        antialias: true,
        contextType: 'webgl2',
        preserveDrawingBuffer: true
    },
    style: {
        version: 8,
        projection: {type: 'globe'},
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        light: {
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.3,
            position: [100 , 90, 5]
            },
        sources: {
            'terrain-low': {
                    type: 'raster-dem',
                    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    maxzoom: 12,
                    encoding: 'terrarium'
                },
                'terrain-high': {
                    type: 'raster-dem',
                    tiles: ['/terrain_{z}_{x}_{y}.png'],
                    tileSize: 512,
                    minzoom: 12,
                    maxzoom: 18,
                    encoding: 'mapbox'
                },
            'dem': {
                type: 'raster-dem',
                encoding: 'terrarium',
                tiles: [demSource.sharedDemProtocolUrl],
                maxzoom: 14,
                tileSize: 256
            },
            'contours': {
                type: 'vector',
                tiles: [
                    demSource.contourProtocolUrl({
                        thresholds: {
                            11: [50, 200],
                            12: [50, 200],
                            13: [25, 100],
                            14: [25, 100],
                            15: [10, 50]
                        },
                        elevationKey: 'ele',
                        levelKey: 'level',
                        contourLayer: 'contours'
                    })
                ],
                maxzoom: 18
            },
            'buildings': {
                type: 'vector',
                tiles: ['https://tiles.stadiamaps.com/data/openmaptiles/{z}/{x}/{y}.pbf'],
                maxzoom: 14
            },
            'refuges': {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            },
            'orthophotos': {
                type: 'raster',
                tiles: [
                    'https://wmts.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg&STYLE=normal'
                ],
                tileSize: 256,
                minzoom: 0,
                maxzoom: 19,
                attribution: '© IGN/Geoportail'
            },
            'planIGN': {
                type: 'raster',
                tiles: [
                    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
                ],
                tileSize: 256,
                maxzoom: 17,
                attribution: '© Data from Geoportail'
            },
            'heatmap': {
                type: 'raster',
                tiles: [
                    'https://proxy.nakarte.me/https/heatmap-external-c.strava.com/tiles-auth/winter/hot/{z}/{x}/{y}.png?v=19&Key-Pair-Id=&Signature=&Policy='
                ],
                tileSize: 512,
                maxzoom: 17,
                attribution: '© Data from Strava'
            },
            'OpenTopo': {
                type: 'raster',
                tiles: [
                    'https://tile.opentopomap.org/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                maxzoom: 17,
                attribution: '&copy; OpenTopoMap contributors'
            },
            'sentinel2': {
                type: 'raster',
                tiles: [
                    'https://sh.dataspace.copernicus.eu/ogc/wms/db2d70bd-05c6-4ec3-9b31-f31a651821d5?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=TRUE_COLOR&TILED=true&WIDTH=1024&HEIGHT=1024&CRS=EPSG:3857&BBOX={bbox-epsg-3857}'
                    //'https://services.sentinel-hub.com/ogc/wms/20049cf0-16c4-4306-8fc0-9f8315705a5b?service=WMS&request=GetMap&layers=1_TRUE_COLOR&styles=&format=image/jpeg&transparent=true&version=1.1.1&height=256&width=256&srs=EPSG:3857&bbox={bbox-epsg-3857}&time=2024-01-01/2024-01-06'
                ],
                tileSize: 1024,
                attribution: '© Copernicus'
            },
            'Slope': {
                type: 'raster',
                tiles: [
                    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
                ],
                tileSize: 256,
                attribution: '© Data from Geoportail'
            },
            'snowDepth': {
                type: 'raster',
                tiles: [
                    'https://p20.cosmos-project.ch/BfOlLXvmGpviW0YojaYiRqsT9NHEYdn88fpHZlr_map/gmaps/sd20alps@epsg3857/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '© Data from Exolab'
            },
            'wikimedia': {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] },
                cluster: false,
                clusterMaxZoom: 14,
                clusterRadius: 30
            },
            'thunderforest-outdoors': {
                type: 'vector',
                tiles: [
                    'https://a.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25',
                    'https://b.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25',
                    'https://c.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=bbb81d9ac1334825af992c8f0a09ea25'
                ],
                maxzoom: 14
            }
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: {
                    'background-color': '#000'  // Black background for space
                }
            },
            layerStyles.baseColor,
            layerStyles.terrainLow,
            layerStyles.terrainHigh,
            layerStyles.orthophotosLayer,
            layerStyles.planIGNLayer,
            layerStyles.OpentopoLayer,
            layerStyles.sentinel2Layer,
            layerStyles.contours,
            layerStyles.contourText,
            layerStyles.hillshadeLayer,
            layerStyles.snowLayer,
            layerStyles.SlopeLayer,
            layerStyles.buildings3D,
            layerStyles.refugesLayer,
            layerStyles.wikimediaPhotos,
            layerStyles.pathsHitArea,
            layerStyles.pathsOutline,
            layerStyles.paths,
            layerStyles.pathDifficultyMarkers,
            layerStyles.hikingRoutes,
            layerStyles.poisth,
            layerStyles.thunderforestRoads,
            layerStyles.thunderforestParking,
            layerStyles.thunderforestLakes
        ],
        terrain: {
            source: 'terrain-low',
            exaggeration: 1.0,

        },
        sky: {
            "sky-color": "#87CEEB",
            "sky-horizon-blend": 0.5,
            "horizon-color": "#ffffff",
            "horizon-fog-blend": 0.5,
            "fog-color": "#888888",
            "fog-ground-blend": 0.5,
            "atmosphere-blend": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0, 1,
                5, 1,
                7, 0
            ]
        }
    },
    center: [5.7245, 45.1885],
    zoom: 14,
    pitch: 45,
    hash: true,
    antialias: true,
    cancelPendingTileRequestsWhileZooming: true,
    maxZoom: 19,
    maxPitch: 90,
    fadeDuration: 500
});

// Add zoom event listener for terrain transition
// In app.js
map.on('zoom', () => {
    const zoom = map.getZoom();
    const currentBearing = map.getBearing();
    const currentCenter = map.getCenter();
    
    if (zoom >= 12) {
        map.setTerrain({ source: 'terrain-high', exaggeration: 1.0 });
        // Small zoom adjustment to trigger terrain refresh
        map.setZoom(zoom + 0.00001);
        map.setCenter(currentCenter);
        map.setBearing(currentBearing);
    } else {
        map.setTerrain({ source: 'terrain-low', exaggeration: 1.0 });
        map.setZoom(zoom + 0.00001);
        map.setCenter(currentCenter);
        map.setBearing(currentBearing);
    }
});

// Setup MapLibre protocol and controls
demSource.setupMaplibre(maplibregl);

// Add Navigation Control
map.addControl(new maplibregl.NavigationControl({ 
    visualizePitch: true,
    showZoom: true,
    showCompass: true
}));

// Add Globe Control
map.addControl(new maplibregl.GlobeControl());

// Updated TerrainControl with vertical field of view
map.addControl(new maplibregl.TerrainControl({
    source: 'terrain-low', // Change from terrain-source
    exaggeration: 1.0,
    onToggle: (enabled) => {
        if (enabled) {
            const currentZoom = map.getZoom();
            const source = currentZoom >= 12 ? 'terrain-high' : 'terrain-low';
            map.setTerrain({ source: source, exaggeration: 1.0 });
            map.setVerticalFieldOfView(45);
            
            if (map.getLayer('hillshade-layer')) {
                map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');
            }
        } else {
            map.setTerrain(null);
            map.setVerticalFieldOfView(60);
            if (map.getLayer('hillshade-layer')) {
                map.setLayoutProperty('hillshade-layer', 'visibility', 'none');
            }
        }
    }
}));

// Add Scale Control
map.addControl(new maplibregl.ScaleControl());

// Add Geolocation Control
map.addControl(new maplibregl.GeolocateControl({
    positionOptions: {
        enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserHeading: true
}));

// Add Geocoder Control with Nominatim
const geocoderApi = {
    forwardGeocode: async (config) => {
        const features = [];
        try {
            const request = `https://nominatim.openstreetmap.org/search?q=${
                config.query
            }&format=geojson&polygon_geojson=1&addressdetails=1`;
            const response = await fetch(request);
            const geojson = await response.json();
            for (const feature of geojson.features) {
                const center = [
                    feature.bbox[0] + (feature.bbox[2] - feature.bbox[0]) / 2,
                    feature.bbox[1] + (feature.bbox[3] - feature.bbox[1]) / 2
                ];
                const point = {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: center
                    },
                    place_name: feature.properties.display_name,
                    properties: feature.properties,
                    text: feature.properties.display_name,
                    place_type: ['place'],
                    center
                };
                features.push(point);
            }
        } catch (e) {
            console.error(`Failed to forwardGeocode with error: ${e}`);
        }
        return {
            features
        };
    }
};

map.addControl(
    new MaplibreGeocoder(geocoderApi, {
        maplibregl,
        marker: true,
        showResultsWhileTyping: true,
        position: 'top-left'
    })
);

// Initialize worker pool
const workerPool = new WorkerPool(map);
workerPool.initialize();

let currentTerrain = 'terrain-source';

function handleTerrainToggle(source) {
    if (currentTerrain === source) return;
    currentTerrain = source;
    if (map.getLayer('hillshade-layer')) {
        map.removeLayer('hillshade-layer');
    }
    map.setTerrain({
        source: source,
        exaggeration: 1.0
    });
    map.addLayer({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: source,
        layout: { visibility: 'visible' },
        paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'viewport',
            'hillshade-shadow-color': '#000000',
            'hillshade-highlight-color': '#ffffff',
            'hillshade-accent-color': '#000000'
        }
    }, layerStyles.sentinel2Layer.id);
}

// Update event listeners to use new subscription model
const throttledFetchAll = throttle(() => {
    fetchPointsOfInterest(map);
    fetchWikimediaPhotos();
}, THROTTLE_DELAY);

// Update event handlers
map.on('load', async () => {
    // Delay to ensure everything loads properly
    setTimeout(async () => {
        try {
            addLayersToMap();
            setupLayerControls();
            setupMenuToggle();
            setupWikimediaEventListeners();
            setupRefugesEventListeners();

            // Set up separate event listeners instead of chaining
            map.on('moveend', throttledFetchAll);
            
            await initializeThunderforestLayers();
            console.log('Thunderforest initialization successful');

            // Remove loading screen with fade effect
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('fade-out');
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 500);
            }

        } catch (error) {
            console.error('Initialization error:', error);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('fade-out');
            }
        }
    }, 5000);

    // Update click handler for signposts with new subscription model
    map.on('click', async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['poisth'] });
        if (features.length > 0 &&
            features[0].properties.feature === 'guidepost' &&
            features[0].properties.information === 'guidepost') {

            const [lon, lat] = features[0].geometry.coordinates;
            try {
                const query = getOverpassQuery(lat, lon);
                const response = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: 'data=' + encodeURIComponent(query)
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                const data = await response.json();
                osmCache.set(features[0].properties.id, data);
                processOsmData(data, lon, lat, features[0]);
            } catch (error) {
                console.error('Error querying OSM:', error);
                new maplibregl.Popup()
                    .setLngLat([lon, lat])
                    .setHTML(`<div style="padding:10px;"><strong>Error querying OSM data</strong><br>${error.message}</div>`)
                    .addTo(map);
            }
        }
    });
});

// Clean up subscriptions on unload
window.addEventListener('unload', () => {
    workerPool.terminate();
    osmCache.clear();
});

export { map };

function setupLayerControls() {
    const layerControl = document.querySelector('.layer-control');
    const tabButtons = layerControl.querySelectorAll('.tab-button');
    const tabContents = layerControl.querySelectorAll('.tab-content');
    const layerToggleButtons = layerControl.querySelectorAll('.layer-toggle-button');
    const layerOptions = layerControl.querySelectorAll('.layer-option');

    // Tab switching functionality
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            button.classList.add('active');
            const tabId = button.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });

    function updateBasemapVisibility(selectedId = null) {
        const basemaps = ['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer'];
        basemaps.forEach(id => {
            map.setLayoutProperty(id, 'visibility', 'none');
        });
        if (selectedId) {
            map.setLayoutProperty(selectedId, 'visibility', 'visible');
        }
    }

    // Handle all layer options (basemaps and overlays)
    layerOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            const layerId = e.currentTarget.dataset.layer;
            
            if (['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer', 'hillshade-layer'].includes(layerId)) {
                // Handle basemap selection
                const basemapOptions = Array.from(layerOptions).filter(opt => 
                    ['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer'].includes(opt.dataset.layer)
                );

                if (layerId === 'hillshade-layer') {
                    // Toggle hillshade
                    e.currentTarget.classList.toggle('active');
                    const hillshadeEnabled = e.currentTarget.classList.contains('active');
                    map.setLayoutProperty('hillshade-layer', 'visibility', hillshadeEnabled ? 'visible' : 'none');

                    // If enabling hillshade and no basemap is selected, deselect all basemaps
                    if (hillshadeEnabled && !basemapOptions.some(opt => opt.classList.contains('active'))) {
                        updateBasemapVisibility();
                    }
                } else {
                    // Handle regular basemap selection
                    const wasActive = e.currentTarget.classList.contains('active');
                    basemapOptions.forEach(opt => opt.classList.remove('active'));
                    
                    if (!wasActive) {
                        e.currentTarget.classList.add('active');
                        updateBasemapVisibility(layerId);
                    } else {
                        updateBasemapVisibility();
                    }
                }
            } else {
                // Handle overlay layers
                const isActive = e.currentTarget.classList.contains('active');
                e.currentTarget.classList.toggle('active');

                if (layerId === 'sentinel2-layer') {
                    const newOpacity = isActive ? 0 : 0.7;
                    map.setPaintProperty('sentinel2-layer', 'raster-opacity', newOpacity);
                    const sentinel2Controls = document.getElementById('sentinel2-controls');
                    if (sentinel2Controls) {
                        sentinel2Controls.style.display = newOpacity === 0 ? 'none' : 'block';
                        const opacitySlider = document.getElementById('sentinel-opacity');
                        if (opacitySlider) {
                            opacitySlider.value = newOpacity;
                            document.getElementById('opacity-value').textContent = newOpacity.toFixed(1);
                        }
                    }
                } else if (layerId === 'Snow-layer') {
                    map.setLayoutProperty('Snow-layer', 'visibility', isActive ? 'none' : 'visible');
                } else if (layerId === 'heatmap-layer') {
                    map.setLayoutProperty('heatmap-layer', 'visibility', isActive ? 'none' : 'visible');
                } else if (layerId === 'Slope-layer') {
                    map.setLayoutProperty('Slope-layer', 'visibility', isActive ? 'none' : 'visible');
                }
            }
        });
    });

    // Handle feature toggle buttons
    layerToggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const layerId = e.currentTarget.dataset.layer;
            const isActive = e.currentTarget.classList.contains('active');
            
            // Toggle button state
            e.currentTarget.classList.toggle('active');
            
            // Update layer visibility
            if (layerId === 'contours') {
                map.setLayoutProperty('contours', 'visibility', isActive ? 'none' : 'visible');
                map.setLayoutProperty('contour-text', 'visibility', isActive ? 'none' : 'visible');
            } else if (layerId === 'paths') {
                // Toggle all path-related layers
                ['paths', 'paths-hit-area', 'paths-outline', 'path-difficulty-markers'].forEach(pathLayer => {
                    map.setLayoutProperty(pathLayer, 'visibility', isActive ? 'none' : 'visible');
                });
            } else if (layerId === '3d-buildings') {
                map.setLayoutProperty('3d-buildings', 'visibility', isActive ? 'none' : 'visible');
            } else {
                // Handle all other feature layers
                map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
            }
        });
    });

    setupSentinel2Controls(layerControl);

    // Initialize hillshade as visible and selected
    const hillshadeOption = Array.from(layerOptions).find(opt => opt.dataset.layer === 'hillshade-layer');
    if (hillshadeOption) {
        hillshadeOption.classList.add('active');
    }
    map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');

    // Initialize all feature layers as hidden
    layerToggleButtons.forEach(button => {
        const layerId = button.dataset.layer;
        if (layerId === 'contours') {
            map.setLayoutProperty('contours', 'visibility', 'none');
            map.setLayoutProperty('contour-text', 'visibility', 'none');
        } else if (layerId === 'paths') {
            ['paths', 'paths-hit-area', 'paths-outline', 'path-difficulty-markers'].forEach(pathLayer => {
                map.setLayoutProperty(pathLayer, 'visibility', 'none');
            });
        } else {
            map.setLayoutProperty(layerId, 'visibility', 'none');
        }
    });
}

function setupSentinel2Controls(layerControl) {
    const sentinel2Controls = document.getElementById('sentinel2-controls');
    if (sentinel2Controls) {
        ['opacity', 'contrast', 'saturation'].forEach(param => {
            const input = document.getElementById(`sentinel-${param}`);
            if (input) {
                input.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    map.setPaintProperty('sentinel2-layer', `raster-${param}`, value);
                    document.getElementById(`${param}-value`).textContent = value.toFixed(1);
                });
            }
        });
    }
}

function setupMenuToggle() {
    const menuToggle = document.querySelector('.menu-toggle');
    const layerControl = document.querySelector('.layer-control');
    let isMenuVisible = false;

    layerControl.classList.remove('visible');
    menuToggle.classList.remove('active');

    menuToggle.addEventListener('click', () => {
        isMenuVisible = !isMenuVisible;
        layerControl.classList.toggle('visible');
        menuToggle.classList.toggle('active');
    });

    map.on('click', () => {
        if (isMenuVisible) {
            isMenuVisible = false;
            layerControl.classList.remove('visible');
            menuToggle.classList.remove('active');
        }
    });

    layerControl.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}