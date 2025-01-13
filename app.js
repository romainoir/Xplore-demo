import { fetchWikimediaPhotos, setupWikimediaEventListeners } from './wikimedia.js';
import { fetchPointsOfInterest, setupRefugesEventListeners } from './refuges.js';
import initializeThunderforestLayers from './thunderforest.js';
import { processOsmData, getOverpassQuery } from './signpost.js';
import { layerStyles, addLayersToMap } from './layers.js';
import { DirectionsManager } from './directions.js';
import { setupTerrainProtocol } from './terrainprotocol.js'; // Import the function

// Initialize DEM source
const demSource = new mlcontour.DemSource({
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    encoding: "terrarium",
    maxzoom: 14,
    worker: false // Disable the worker from mlcontour as we will handle it ourself
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

let directionsManager;

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
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sprite: "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/sprite/PlanIgn",
        projection: { type: 'globe' },
        light: {
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.3,
            position: [100, 90, 5]
        },
        sources: {
           'custom-dem': { // DEM
                  type: 'raster-dem',
                  encoding: 'mapbox',
                  tiles: ['customdem://{z}/{x}/{y}'], // this is the custom protocol for DEM
                   tileSize: 256,
                   maxzoom: 17
                },
            'custom-normal': {
              type: 'raster',
              tiles: ['customdem://{z}/{x}/{y}/normal'], // this is the custom protocol for normal maps
               tileSize: 256,
               maxzoom: 17
             },
              'custom-slope': {
                type: 'raster',
                tiles: ['customdem://{z}/{x}/{y}/slope'], // this is the custom protocol for slope maps
                 tileSize: 256,
                maxzoom: 17
            },
             'custom-aspect': {
                type: 'raster',
                 tiles: ['customdem://{z}/{x}/{y}/aspect'], // this is the custom protocol for aspect maps
                tileSize: 256,
                maxzoom: 17
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
            'sentinel2': {
                type: 'raster',
                tiles: [
                    'https://sh.dataspace.copernicus.eu/ogc/wms/7e15b662-449e-44ff-9f1b-28386c82867c?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=TRUE_COLOR&TILED=true&WIDTH=1024&HEIGHT=1024&CRS=EPSG:3857&BBOX={bbox-epsg-3857}'
                ],
                tileSize: 1024,
                attribution: '© Copernicus'
            },
            'heatmap': {
                type: 'raster',
                tiles: [
                    'https://proxy.nakarte.me/https/heatmap-external-c.strava.com/tiles-auth/winter/hot/{z}/{x}/{y}.png?v=19'
                ],
                tileSize: 512,
                maxzoom: 17,
                attribution: '© Data from Strava'
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
            },
            'plan-ign-vector': {
                type: 'vector',
                tiles: ['https://data.geopf.fr/tms/1.0.0/PLAN.IGN/{z}/{x}/{y}.pbf'],
                maxzoom: 17,
                attribution: '© Data from Geoportail'
            }
        },
         layers: [
            layerStyles.baseColor,
            layerStyles.orthophotosLayer,
            layerStyles.OpentopoLayer,
            layerStyles.sentinel2Layer,
            layerStyles.contours,
            layerStyles.contourText,
            layerStyles.hillshadeLayer,
            layerStyles.snowLayer,
            layerStyles.SlopeLayer,
            layerStyles.AspectSlopeLayer,
            layerStyles.NormalLayer,
            layerStyles.SlopeDEMLayer,
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
            layerStyles.thunderforestLakes,
        ],
        terrain: {
           source: 'custom-dem',
            exaggeration: 1.0
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
    hash: true,
    antialias: true,
    minZoom: 4,
    maxZoom: 19,
    maxPitch: 75,
    fadeDuration: 1000,
    bearing: 0,
    pitch: 0
});

// Layer management
let currentTerrain = 'custom-dem';
let planIGNLayers = [];


// Setup MapLibre protocol and controls
demSource.setupMaplibre(maplibregl);
setupTerrainProtocol(maplibregl); // Set up the custom protocol


map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    visualizePitch: true
}));

map.addControl(new maplibregl.GlobeControl());

map.addControl(new maplibregl.TerrainControl({
    source: 'custom-dem',
    exaggeration: 1.0,
    onToggle: (enabled) => {
        if (enabled) {
           map.setTerrain({ source: 'custom-dem', exaggeration: 1.0 });
        } else {
            // Disable 3D mode
            map.setTerrain(null);
        }
    }
}));

map.addControl(new maplibregl.ScaleControl());

map.addControl(new maplibregl.GeolocateControl({
    positionOptions: {
        enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserHeading: true
}));

const geocoderApi = {
    forwardGeocode: async (config) => {
        const features = [];
        try {
            const request = `https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`;
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
        return { features };
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

    // Handle layer toggles (for features)
    layerToggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const layerId = e.currentTarget.dataset.layer;
            const isActive = e.currentTarget.classList.contains('active');
            
            e.currentTarget.classList.toggle('active');

            // Toggle specific layer groups
            if (layerId === 'paths') {
                ['paths', 'paths-hit-area', 'paths-outline', 'path-difficulty-markers'].forEach(pathLayer => {
                    map.setLayoutProperty(pathLayer, 'visibility', isActive ? 'none' : 'visible');
                });
            } else if (layerId === 'thunderforest') {
                ['thunderforest-parking', 'thunderforest-roads', 'thunderforest-lakes'].forEach(tfLayer => {
                    map.setLayoutProperty(tfLayer, 'visibility', isActive ? 'none' : 'visible');
                });
            } else if (layerId === 'refuges') {
                map.setLayoutProperty('refuges', 'visibility', isActive ? 'none' : 'visible');
            } else if (layerId === 'wikimedia') {
                map.setLayoutProperty('wikimedia', 'visibility', isActive ? 'none' : 'visible');
            } else {
                map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
            }
        });
    });

    // Layer option handlers
    layerOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            const layerId = e.currentTarget.dataset.layer;
            
            // Handle basemaps and hillshade
            if (['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer', 'hillshade-layer'].includes(layerId)) {
                const basemapOptions = Array.from(layerOptions).filter(opt => 
                    ['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer'].includes(opt.dataset.layer)
                );

                if (layerId === 'hillshade-layer') {
                    e.currentTarget.classList.toggle('active');
                    const hillshadeEnabled = e.currentTarget.classList.contains('active');
                    map.setLayoutProperty('hillshade-layer', 'visibility', hillshadeEnabled ? 'visible' : 'none');

                    if (hillshadeEnabled && !basemapOptions.some(opt => opt.classList.contains('active'))) {
                        updateBasemapVisibility();
                    }
                } else {
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

                if (['normal-layer', 'slope-layer', 'aspect-layer'].includes(layerId)) {
                    // Handle terrain analysis layers using opacity
                    const newOpacity = isActive ? 0 : 1;
                    map.setPaintProperty(layerId, 'raster-opacity', newOpacity);
                    
                    // If enabling one terrain analysis layer, disable others
                    if (!isActive) {
                        ['normal-layer', 'slope-layer', 'aspect-layer'].forEach(id => {
                            if (id !== layerId) {
                                map.setPaintProperty(id, 'raster-opacity', 0);
                                const otherOption = Array.from(layerOptions).find(opt => opt.dataset.layer === id);
                                if (otherOption) otherOption.classList.remove('active');
                            }
                        });
                    }
                }
                // Special handling for Sentinel-2
                else if (layerId === 'sentinel2-layer') {
                    map.setLayoutProperty('sentinel2-layer', 'visibility', isActive ? 'none' : 'visible');
                    const sentinel2Controls = document.getElementById('sentinel2-controls');
                    if (sentinel2Controls) {
                        sentinel2Controls.style.display = isActive ? 'none' : 'block';
                    }
                }
                // Handle other regular raster layers with visibility
                else if (['Snow-layer', 'heatmap-layer', 'Slope-layer'].includes(layerId)) {
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
                }
                // Handle contours
                else if (layerId === 'contours') {
                    ['contours', 'contour-text'].forEach(contourLayer => {
                        map.setLayoutProperty(contourLayer, 'visibility', isActive ? 'none' : 'visible');
                    });
                }
                // Handle buildings
                else if (layerId === 'buildings') {
                    map.setLayoutProperty('buildings-3d', 'visibility', isActive ? 'none' : 'visible');
                }
                // For any other layers, fallback to visibility toggle
                else {
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
                }
            }
        });
    });

    // Setup Sentinel-2 controls
    setupSentinel2Controls(layerControl);

    // Initialize hillshade
    const hillshadeOption = Array.from(layerOptions).find(opt => opt.dataset.layer === 'hillshade-layer');
    if (hillshadeOption) {
        hillshadeOption.classList.add('active');
    }
    map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');
}

async function loadPlanIGNLayers() {
    try {
        const response = await fetch(
            'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json'
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch standard.json: ${response.statusText}`);
        }
        const styleJson = await response.json();

        if (planIGNLayers.length > 0) {
            planIGNLayers.forEach(layer => {
                if (map.getLayer(layer.id)) {
                    map.removeLayer(layer.id);
                }
            });
        }

        // Process IGN layers
        planIGNLayers = styleJson.layers
            .filter(layer => layer.source === 'plan_ign')
            .map(layer => {
                const newLayer = {
                    ...layer,
                    source: 'plan-ign-vector'
                };

                // Handle layout properties
                if (newLayer.layout) {
                    const { 'text-font': _, ...restLayout } = newLayer.layout;
                    
                    // If layer has text rendering capabilities
                    if (restLayout['text-field']) {
                        newLayer.layout = {
                            ...restLayout,
                            // Use Noto Sans as it's reliably available
                            'text-font': ['Noto Sans Regular']
                        };
                    } else {
                        newLayer.layout = restLayout;
                    }
                }

                return newLayer;
            });

        // Add layers before hillshade-layer
        planIGNLayers.forEach(layer => {
            try {
                map.addLayer(layer, 'hillshade-layer');
            } catch (error) {
                console.error(`Error adding layer "${layer.id}":`, error);
            }
        });
    } catch (error) {
        console.error('Error loading IGN layers:', error);
    }
}

async function loadOpenTopoLayers() {
    try {
        const response = await fetch('https://tiles.openfreemap.org/styles/liberty');
        if (!response.ok) {
            throw new Error(`Failed to fetch OpenTopo style: ${response.statusText}`);
        }
        const styleJson = await response.json();

        // Remove existing OpenTopo layers if any
        if (window.openTopoLayers) {
            window.openTopoLayers.forEach(layer => {
                if (map.getLayer(layer.id)) {
                    map.removeLayer(layer.id);
                }
            });
        }

        // Process OpenTopo layers
        window.openTopoLayers = styleJson.layers.map(layer => {
            const newLayer = {
                ...layer,
                id: `opentopo-${layer.id}` // Ensure unique layer IDs
            };

            // Handle layout properties
            if (newLayer.layout && newLayer.layout['text-font']) {
                newLayer.layout = {
                    ...newLayer.layout,
                    'text-font': ['Noto Sans Regular']
                };
            }

            return newLayer;
        });

        // Add sources from the style
        Object.entries(styleJson.sources).forEach(([id, source]) => {
            if (!map.getSource(`opentopo-${id}`)) {
                map.addSource(`opentopo-${id}`, {
                    ...source,
                    attribution: '© OpenTopoMap contributors'
                });
            }
        });

        // Add layers before hillshade-layer
        window.openTopoLayers.forEach(layer => {
            try {
                // Update source reference
                layer.source = `opentopo-${layer.source}`;
                map.addLayer(layer, 'hillshade-layer');
            } catch (error) {
                console.error(`Error adding OpenTopo layer "${layer.id}":`, error);
            }
        });

    } catch (error) {
        console.error('Error loading OpenTopo layers:', error);
    }
}

function updateBasemapVisibility(selectedId = null) {
    const basemaps = ['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer'];
    basemaps.forEach(id => {
        map.setLayoutProperty(id, 'visibility', 'none');
    });
    
    if (selectedId) {
        map.setLayoutProperty(selectedId, 'visibility', 'visible');
        if (selectedId === 'planIGN-layer') {
            loadPlanIGNLayers();
        } else if (selectedId === 'Opentopo-layer') {
            loadOpenTopoLayers();
        } else {
            removePlanIGNLayers();
            removeOpenTopoLayers();
        }
    } else {
        removePlanIGNLayers();
        removeOpenTopoLayers();
    }
}

function removeOpenTopoLayers() {
    if (window.openTopoLayers) {
        window.openTopoLayers.forEach(layer => {
            if (map.getLayer(layer.id)) {
                map.removeLayer(layer.id);
            }
        });
        window.openTopoLayers = [];
    }
}

function removePlanIGNLayers() {
    if (planIGNLayers.length > 0) {
        planIGNLayers.forEach(layer => {
            if (map.getLayer(layer.id)) {
                map.removeLayer(layer.id);
            }
        });
        planIGNLayers = [];
    }
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

// Map initialization and event handlers
map.on('load', async () => {
    const directionsToggle = document.querySelector('.directions-toggle');
    const directionsControl = document.querySelector('.directions-control');
    const transportModes = document.querySelectorAll('.transport-mode');
    const swapButton = document.getElementById('swap-points');
    const clearButton = document.getElementById('clear-route');
    const routeStats = document.getElementById('route-stats');
    const elevationChart = document.getElementById('elevation-chart');

    const directionsManager = new DirectionsManager(map, [
        directionsToggle,
        directionsControl,
        transportModes,
        swapButton,
        clearButton,
        routeStats,
        elevationChart
    ]);
    
    setTimeout(async () => {
        try {
            addLayersToMap();
            setupLayerControls();
            setupMenuToggle();
            setupWikimediaEventListeners();
            setupRefugesEventListeners();

            map.on('moveend', throttle(() => {
                fetchPointsOfInterest(map);
                fetchWikimediaPhotos();
            }, THROTTLE_DELAY));
            
            await initializeThunderforestLayers();

            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('fade-out');
                setTimeout(() => loadingScreen.style.display = 'none', 500);
            }
        } catch (error) {
            console.error('Initialization error:', error);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('fade-out');
            }
        }
    }, 3000);

    // Handle signpost clicks
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


export { map };