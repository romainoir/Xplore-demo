import { fetchWikimediaPhotos, setupWikimediaEventListeners } from '../modules/wikimedia.js';
import { fetchPointsOfInterest, setupRefugesEventListeners } from '../modules/refuges.js';
import initializeThunderforestLayers from '../modules/thunderforest.js';
import { processOsmData, getOverpassQuery } from '../modules/signpost.js';
import { layerStyles, addLayersToMap } from '../modules/layers.js';
import { DirectionsManager } from '../modules/directions.js';
import { initializeMap, setupMapProtocols, getContourTileUrl } from './mapConfig.js';


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
const map = initializeMap(maplibregl);

// Layer management
let currentTerrain = 'dem';
let planIGNLayers = [];
let terrainControlHandle = null;
let previousTerrainViewState = null;
let terrainWarningNoteElement = null;

const terrainDependentLayerIds = ['normal-layer', 'slope-layer', 'aspect-layer'];

function updateContourSource(terrainId) {
    const contourSource = map.getSource('contours');
    if (!contourSource) {
        return;
    }

    const tiles = [getContourTileUrl(terrainId)];

    if (typeof contourSource.setTiles === 'function') {
        contourSource.setTiles(tiles);
        return;
    }

    const previousVisibility = {};
    ['contours', 'contour-text'].forEach(layerId => {
        if (map.getLayer(layerId)) {
            previousVisibility[layerId] = map.getLayoutProperty(layerId, 'visibility');
            map.removeLayer(layerId);
        }
    });

    map.removeSource('contours');
    map.addSource('contours', {
        type: 'vector',
        tiles,
        maxzoom: 18
    });

    addLayersToMap();

    Object.entries(previousVisibility).forEach(([layerId, visibility]) => {
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}

function setTerrainDependentLayersEnabled(enabled) {
    terrainDependentLayerIds.forEach(layerId => {
        const option = document.querySelector(`.layer-option[data-layer="${layerId}"]`);
        if (option) {
            option.disabled = !enabled;
            option.classList.toggle('disabled', !enabled);
            if (!enabled) {
                option.classList.remove('active');
            }
        }

        if (!map.getLayer(layerId)) {
            return;
        }

        if (enabled) {
            const isActive = option ? option.classList.contains('active') : false;
            map.setLayoutProperty(layerId, 'visibility', isActive ? 'visible' : 'none');
            map.setPaintProperty(layerId, 'raster-opacity', isActive ? 0.8 : 0);
        } else {
            map.setLayoutProperty(layerId, 'visibility', 'none');
            map.setPaintProperty(layerId, 'raster-opacity', 0);
        }
    });
}

function updateHillshadeVisibility(hillshadeEnabled) {
    const terrainHillshadeMap = {
        'custom-dem': 'hillshade-layer',
        'mapterhorn-dem': 'hillshade-layer-mapterhorn',
        'dem': 'hillshade-layer-terrarium'
    };

    const activeLayer = terrainHillshadeMap[currentTerrain] || terrainHillshadeMap['dem'];

    Object.values(terrainHillshadeMap).forEach(layerId => {
        if (!map.getLayer(layerId)) {
            return;
        }
        const visibility = hillshadeEnabled && layerId === activeLayer ? 'visible' : 'none';
        map.setLayoutProperty(layerId, 'visibility', visibility);
    });
}

function setTerrainSource(sourceId, terrainWarningNote = null) {
    if (!terrainWarningNote && terrainWarningNoteElement) {
        terrainWarningNote = terrainWarningNoteElement;
    }
    const supportedTerrains = new Set(['custom-dem', 'mapterhorn-dem', 'dem']);
    if (!supportedTerrains.has(sourceId)) {
        sourceId = 'dem';
    }

    const hillshadeButton = document.querySelector('.layer-option[data-layer="hillshade-layer"]');
    const hillshadeEnabled = hillshadeButton ? hillshadeButton.classList.contains('active') : false;

    currentTerrain = sourceId;
    map.setTerrain({ source: sourceId, exaggeration: 1.0 });
    updateContourSource(currentTerrain);

    const supportsTerrainAnalysis = sourceId === 'custom-dem';
    setTerrainDependentLayersEnabled(supportsTerrainAnalysis);

    if (terrainWarningNote) {
        terrainWarningNote.classList.toggle('visible', !supportsTerrainAnalysis);
    }

    if (terrainControlHandle) {
        if (terrainControlHandle._options) {
            terrainControlHandle._options.source = currentTerrain;
        }
        if ('_source' in terrainControlHandle) {
            terrainControlHandle._source = currentTerrain;
        }
    }

    updateHillshadeVisibility(hillshadeEnabled);
}

// Setup MapLibre protocol and controls
setupMapProtocols(maplibregl);

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

map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    visualizePitch: true
}));

map.addControl(new maplibregl.GlobeControl());

terrainControlHandle = new maplibregl.TerrainControl({
    source: 'dem',
    exaggeration: 1.0,
    onToggle: (enabled) => {
        if (enabled) {
            if (terrainWarningNoteElement) {
                setTerrainSource(currentTerrain, terrainWarningNoteElement);
            } else {
                map.setTerrain({ source: currentTerrain, exaggeration: 1.0 });
            }
            if (previousTerrainViewState) {
                const { pitch, bearing } = previousTerrainViewState;
                previousTerrainViewState = null;
                const needsPitchRestore = Math.abs(map.getPitch() - pitch) > 0.1;
                const needsBearingRestore = Math.abs(map.getBearing() - bearing) > 0.1;
                if (needsPitchRestore || needsBearingRestore) {
                    map.easeTo({
                        pitch,
                        bearing,
                        duration: 600,
                        essential: true
                    });
                }
            }
        } else {
            previousTerrainViewState = {
                pitch: map.getPitch(),
                bearing: map.getBearing()
            };
            // Disable 3D mode
            map.setTerrain(null);
            if (map.getPitch() !== 0) {
                map.easeTo({
                    pitch: 0,
                    duration: 400,
                    essential: true
                });
            }
        }
    }
});

map.addControl(terrainControlHandle);

/*
map.addControl(new maplibregl.ScaleControl({
    position: 'bottom'
}));*/

map.addControl(new maplibregl.GeolocateControl({
    positionOptions: {
        enableHighAccuracy: true
    },
    trackUserLocation: true,
    showUserHeading: true
}));



function setupLayerControls() {
    const layerControl = document.querySelector('.layer-control');
    const tabButtons = layerControl.querySelectorAll('.tab-button');
    const tabContents = layerControl.querySelectorAll('.tab-content');
    const layerToggleButtons = layerControl.querySelectorAll('.layer-toggle-button');
    const layerOptions = layerControl.querySelectorAll('.layer-option');
    const terrainOptionButtons = layerControl.querySelectorAll('.terrain-option');
    const terrainWarningNote = layerControl.querySelector('.terrain-note');
    const basemapLayerIds = ['orthophotos-layer', 'planIGN-layer', 'Opentopo-layer'];

    terrainWarningNoteElement = terrainWarningNote;

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
            
            // Handle different layer groups
            switch (layerId) {
                case 'paths':
                    ['paths', 'paths-hit-area', 'paths-outline', 'path-difficulty-markers'].forEach(pathLayer => {
                        map.setLayoutProperty(pathLayer, 'visibility', isActive ? 'none' : 'visible');
                    });
                    break;
                    
                case 'thunderforest':
                    ['thunderforest-parking', 'thunderforest-roads', 'thunderforest-lakes'].forEach(tfLayer => {
                        map.setLayoutProperty(tfLayer, 'visibility', isActive ? 'none' : 'visible');
                    });
                    break;
                    
                case 'refuges-layer':
                    const newVisibility = isActive ? 'none' : 'visible';
                    map.setLayoutProperty('refuges-layer', 'visibility', newVisibility);
                    
                    // Clear data if hiding layer
                    if (newVisibility === 'none' && map.getSource('refuges')) {
                        map.getSource('refuges').setData({
                            type: 'FeatureCollection',
                            features: []
                        });
                    }
                    // Fetch data if showing layer
                    else if (newVisibility === 'visible') {
                        fetchPointsOfInterest();
                    }
                    break;

                case 'contours':
                    ['contours', 'contour-text'].forEach(contourLayer => {
                        map.setLayoutProperty(contourLayer, 'visibility', isActive ? 'none' : 'visible');
                    });
                    break;

                case '3d-buildings':
                    map.setLayoutProperty('buildings-3d', 'visibility', isActive ? 'none' : 'visible');
                    break;

                default:
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
                    break;
            }
        });
    });

    // Layer option handlers (for basemaps and overlays)
    layerOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            const layerId = e.currentTarget.dataset.layer;
            
            // Handle basemaps and hillshade
            if (basemapLayerIds.includes(layerId)) {
                const basemapOptions = Array.from(layerOptions).filter(opt => basemapLayerIds.includes(opt.dataset.layer));

                const wasActive = e.currentTarget.classList.contains('active');
                basemapOptions.forEach(opt => opt.classList.remove('active'));

                if (!wasActive) {
                    e.currentTarget.classList.add('active');
                    updateBasemapVisibility(layerId);
                } else {
                    updateBasemapVisibility();
                }
            } else if (layerId === 'hillshade-layer') {
                const basemapOptions = Array.from(layerOptions).filter(opt => basemapLayerIds.includes(opt.dataset.layer));
                const wasActive = e.currentTarget.classList.contains('active');
                e.currentTarget.classList.toggle('active');
                const hillshadeEnabled = !wasActive;
                updateHillshadeVisibility(hillshadeEnabled);

                if (hillshadeEnabled && !basemapOptions.some(opt => opt.classList.contains('active'))) {
                    updateBasemapVisibility();
                }
            } else {
                // Handle overlay layers
                const isActive = e.currentTarget.classList.contains('active');
                e.currentTarget.classList.toggle('active');

                // Handle terrain analysis layers
                if (['normal-layer', 'slope-layer', 'aspect-layer'].includes(layerId)) {
                    const newOpacity = isActive ? 0 : 0.8;
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
                    map.setPaintProperty(layerId, 'raster-opacity', newOpacity);

                    // If enabling one terrain analysis layer, disable others
                    if (!isActive) {
                        ['normal-layer', 'slope-layer', 'aspect-layer'].forEach(id => {
                            if (id !== layerId) {
                                map.setLayoutProperty(id, 'visibility', 'none');
                                map.setPaintProperty(id, 'raster-opacity', 0);
                                const otherOption = Array.from(layerOptions).find(opt => opt.dataset.layer === id);
                                if (otherOption) otherOption.classList.remove('active');
                            }
                        });
                    }
                }
                // Handle Sentinel-2
                else if (layerId === 'sentinel2-layer') {
                    map.setLayoutProperty('sentinel2-layer', 'visibility', isActive ? 'none' : 'visible');
                    const sentinel2Controls = document.getElementById('sentinel2-controls');
                    if (sentinel2Controls) {
                        sentinel2Controls.style.display = isActive ? 'none' : 'block';
                    }
                }
                // Handle contour overlays
                else if (layerId === 'contours') {
                    const visibility = isActive ? 'none' : 'visible';
                    ['contours', 'contour-text'].forEach(id => {
                        if (map.getLayer(id)) {
                            map.setLayoutProperty(id, 'visibility', visibility);
                        }
                    });
                }
                // Handle regular raster layers
                else if (['Snow-layer', 'heatmap-layer', 'Slope-layer'].includes(layerId)) {
                    map.setLayoutProperty(layerId, 'visibility', isActive ? 'none' : 'visible');
                }
            }
        });
    });

    terrainOptionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTerrain = button.dataset.terrain;
            if (!targetTerrain) {
                return;
            }

            if (!button.classList.contains('active')) {
                terrainOptionButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            }

            setTerrainSource(targetTerrain, terrainWarningNote);
        });
    });

    // Setup Sentinel-2 controls
    setupSentinel2Controls(layerControl);

    // Initialize hillshade
    const hillshadeOption = Array.from(layerOptions).find(opt => opt.dataset.layer === 'hillshade-layer');
    if (hillshadeOption) {
        hillshadeOption.classList.add('active');
    }
    setTerrainSource(currentTerrain, terrainWarningNote);
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
                setTimeout(() => loadingScreen.style.display = 'none', 50);
            }
        } catch (error) {
            console.error('Initialization error:', error);
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.classList.add('fade-out');
            }
        }
    }, 100);

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
