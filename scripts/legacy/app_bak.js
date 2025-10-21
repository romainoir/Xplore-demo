// Initialize DEM source first
const demSource = new mlcontour.DemSource({
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    //url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/{z}/{x}/{y}.png",
    encoding: "terrarium",
    maxzoom: 14,
    worker: true
});

    // Constants
const THROTTLE_DELAY = 500;
const photoCache = new Map();
const processedFeatures = new Set();

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
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}
function calculateOptimizedBbox(bounds, center, currentZoom) {
    const padding = Math.max(0.1, 0.3 - (currentZoom * 0.01));
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    
    if (currentZoom > 14) {
        const bearing = map.getBearing();
        const viewFactor = 1.5;
        const northPadding = bearing > 180 ? padding * viewFactor : padding;
        const southPadding = bearing < 180 ? padding * viewFactor : padding;
        const eastPadding = bearing < 90 || bearing > 270 ? padding * viewFactor : padding;
        const westPadding = bearing > 90 && bearing < 270 ? padding * viewFactor : padding;
        
        return `${
            bounds.getWest() - (lngSpan * westPadding)
        },${
            bounds.getSouth() - (latSpan * southPadding)
        },${
            bounds.getEast() + (lngSpan * eastPadding)
        },${
            bounds.getNorth() + (latSpan * northPadding)
        }`;
    }
    
    return `${
        bounds.getWest() - (lngSpan * padding)
    },${
        bounds.getSouth() - (latSpan * padding)
    },${
        bounds.getEast() + (lngSpan * padding)
    },${
        bounds.getNorth() + (latSpan * padding)
    }`;
}

// Initialize MapLibre Map
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        light: {
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.2,
            position: [100.2, 90, 5]
        },
        sources: {
            'terrain-source': {
                type: 'raster-dem',
                tiles: ['/terrain_{z}_{x}_{y}.png'],
                tileSize: 512,
                maxzoom: 17,
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
                maxzoom: 19
            },
            'buildings': {
                type: 'vector',
                tiles: [
                    'https://tiles.stadiamaps.com/data/openmaptiles/{z}/{x}/{y}.pbf'
                ],
                maxzoom: 14
            },
            'refuges': {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            },
            'orthophotos': {
                type: 'raster',
                tiles: [
                    'https://wmts.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&' +
                    'TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg&STYLE=normal'
                ],
                tileSize: 256,
                minzoom: 6,
                maxzoom: 19,
                attribution: '© IGN/Geoportail'
            },
            'planIGN': {
                type: 'raster',
                tiles: [
                    'https://proxy.nakarte.me/https/heatmap-external-c.strava.com/tiles-auth/winter/hot/{z}/{x}/{y}.png?v=19&Key-Pair-Id=&Signature=&Policy='
                ],
                tileSize: 256,
                maxzoom: 16,
                attribution: '© Data from Geoportail'
            },
            'sentinel2': {
                type: 'raster',
                tiles: [
                    `https://sh.dataspace.copernicus.eu/ogc/wms/db2d70bd-05c6-4ec3-9b31-f31a651821d5?` +
                    `SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=TRUE_COLOR&` +
                    `TILED=true&WIDTH=1024&HEIGHT=1024&CRS=EPSG:3857&BBOX={bbox-epsg-3857}`
                ],
                tileSize: 256,
                maxzoom: 16,
                attribution: '© <a href="https://www.copernicus.eu/en">Copernicus</a>'
            },
            'snowDepth': {
                type: 'raster',
                tiles: [
                    'https://p20.cosmos-project.ch/BfOlLXvmGpviW0YojaYiRqsT9NHEYdn88fpHZlr_map/gmaps/sd20alps@epsg3857/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '© Data from Exolab'
            },
            'tree-dem': {
                type: 'raster-dem',
                tiles: [
                    'https://earthengine.googleapis.com/v1/projects/earthengine-legacy/maps/3ce07bec7bce2b88566109c83f790de0-4175e542a166fa08d4c7ca8e4e2dd1e8/tiles/{z}/{x}/{y}'
                ],
                tileSize: 256,
                maxzoom: 19,
                encoding: 'mapbox',
                attribution: '© <a href="https://research.facebook.com/blog/2023/4/every-tree-counts-large-scale-mapping-of-canopy-height-at-the-resolution-of-individual-trees/">Meta</a>'
            },
            'wikimedia': {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                },
                cluster: false,
                clusterMaxZoom: 14,
                clusterRadius: 30
            }
        },
        layers: [
            {
                id: 'baseColor',
                type: 'background',
                paint: {
                    'background-color': '#fff',
                    'background-opacity': 1.0,
                }
            },
            {
                id: 'contours',
                type: 'line',
                source: 'contours',
                'source-layer': 'contours',
                layout: { 
                    visibility: 'none',
                    'line-join': 'round'
                },
                paint: {
                    'line-color': 'rgba(0,0,0, 50%)',
                    'line-width': ['match', ['get', 'level'], 1, 1, 0.5]
                }
            },
            {
                id: 'contour-text',
                type: 'symbol',
                source: 'contours',
                'source-layer': 'contours',
                layout: {
                    visibility: 'none',
                    'symbol-placement': 'line',
                    'text-anchor': 'center',
                    'text-size': 10,
                    'text-field': ['concat', ['number-format', ['get', 'ele'], {}], 'm'],
                    'text-font': ['Noto Sans Regular']
                },
                paint: {
                    'text-halo-color': 'white',
                    'text-halo-width': 1
                },
                filter: ['>', ['get', 'level'], 0]
            },
            {
                id: 'sentinel2-layer',
                type: 'raster',
                source: 'sentinel2',
                minzoom: 6,
                maxzoom: 18,
                layout: { visibility: 'none' },
                paint: {
                    'raster-opacity': 0.8,
                    'raster-contrast': 0.1,
                    'raster-saturation': 0.1,
                    'raster-resampling': 'linear',
                    'raster-fade-duration': 300
                }
            },
            {
                id: 'Snow-layer',
                type: 'raster',
                source: 'snowDepth',
                minzoom: 0,
                maxzoom: 20,
                layout: { visibility: 'none' }
            },
           /* {
                id: 'tree-dem-hillshade',
                type: 'hillshade',
                source: 'tree-dem',
                layout: {visibility: 'visible'},
                paint: {
                    'hillshade-exaggeration': 0.1,
                    'hillshade-illumination-anchor': 'map',
                    'hillshade-illumination-direction': 280
                }
            },*/
            {
                id: 'hillshade-layer',
                type: 'hillshade',
                source: 'terrain-source',
                layout: {visibility: 'visible'},
                paint: {
                    'hillshade-exaggeration': 0.9,
                    'hillshade-illumination-anchor': 'map',
                    'hillshade-illumination-direction': 280
                }
            },
            {
                id: 'orthophotos-layer',
                type: 'raster',
                source: 'orthophotos',
                minzoom: 0,
                maxzoom: 19,
                layout: { visibility: 'visible' }
            },
            {
                id: 'planIGN-layer',
                type: 'raster',
                source: 'planIGN',
                minzoom: 0,
                maxzoom: 18,
                layout: { visibility: 'none' }
            },
            {
                'id': '3d-buildings',
                'source': 'buildings',
                'source-layer': 'building',
                'type': 'fill-extrusion',
                'minzoom': 14,
                'filter': ['!=', ['get', 'hide_3d'], true],
                'paint': {
                    'fill-extrusion-color': '#F5F5DC',  // Beige color
                    'fill-extrusion-height': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        15, 0,
                        16, ['get', 'render_height']
                    ],
                    'fill-extrusion-base': ['get', 'render_min_height'],
                    'fill-extrusion-opacity': 0.9
                }
            },
            {
                'id': 'refuges-layer',
                'type': 'symbol',
                'source': 'refuges',
                'layout': {
                    'icon-image': [
                       'case',
                        ['has', 'photoId'], ['get', 'photoId'],
                        ['match',
                            ['to-string', ['get', 'valeur', ['get', 'type']]],
                            'cabane non gardée', 'cabane',
                            'refuge gardé', 'refuge',
                            "gîte d'étape", 'gite',
                            "point d'eau", 'pt_eau',
                            'sommet', 'sommet',
                            'point de passage', 'pt_passage',
                            'bivouac', 'bivouac',
                            'lac', 'lac',
                            'cabane'
                        ]
                    ],
                    'icon-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 0.1,
                        15, 0.5
                    ],
                    'icon-allow-overlap': true,
                    'icon-anchor': 'bottom',
                    'text-field': ['get', 'nom'],
                    'text-font': ['Noto Sans Regular'],
                    'text-offset': [0, 0.5],
                    'text-anchor': 'top',
                    'text-size': 12,
                    'text-rotation-alignment': 'viewport',
                    'icon-rotation-alignment': 'viewport'
                },
                'paint': {
                    'text-color': '#000',
                    'text-halo-color': '#fff',
                    'text-halo-width': 2
                }
            },
            {
                id: 'wikimedia-photos',
                type: 'circle',
                source: 'wikimedia',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': '#4287f5',
                    'circle-radius': 8,
                    'circle-opacity': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        16, 0,
                        18, 1.0
                    ],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#fff',
                    'circle-stroke-opacity': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        16, 0,
                        18, 1.0
                    ]
                }
            },
        ],
        terrain:
        {
            source: 'terrain-source',
            exaggeration: 1.0
        },

        /*{
            source: 'tree-dem',
            exaggeration: 0.00002
        },*/

        sky: {
            "sky-color": "#199EF3",
            "sky-horizon-blend": 0.5,
            "horizon-color": "#ffffff",
            "horizon-fog-blend": 0.5,
            "fog-color": "#888888",
            "fog-ground-blend": 0.5,
            "atmosphere-blend": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0, 1, 10, 1, 12, 0
            ]
        }
    },
    center: [5.7245, 45.1885],
    zoom: 14,
    pitch: 70,
    hash: true,
    antialias: true,
    cancelPendingTileRequestsWhileZooming: true,
    maxZoom: 20,
    maxPitch: 70,
    fadeDuration: 2000
});

map.addControl(
    new maplibregl.TerrainControl({
        source: 'terrainSource',
        exaggeration: 0.1
    })
);
// Setup MapLibre protocol
demSource.setupMaplibre(maplibregl);

// =====================
// Configuration and Constants
// =====================
const osmCache = new Map();

const POI_PRIORITIES = {
    'peak': 1,
    'saddle': 2,
    'parking': 3,
    'shelter': 4,
    'alpine_hut': 4,
    'information': 5,  // signposts
    'spring': 6,
    'water_point': 6
};

const CONFIG = {
    POI_SEARCH_BUFFER: 0.1,  // 100m buffer around routes
    MIN_POI_DISTANCE: 0.05   // 50m minimum distance from signpost
};
    
// =====================
// Distance and Time Calculations
// =====================
function calculateHikingTime(distance, elevationGain, difficulty) {
    const baseSpeed = 4.5;
    const slope = distance > 0 ? elevationGain / (distance * 1000) : 0;
    const speedFactor = Math.exp(-3.5 * Math.abs(slope + 0.05));
    const difficultyFactors = {
        'hiking': 1.0,
        'mountain_hiking': 0.85,
        'demanding_mountain_hiking': 0.7,
        'alpine_hiking': 0.6,
        'demanding_alpine_hiking': 0.5,
        'difficult_alpine_hiking': 0.4,
        'road': 1.0
    };
    const difficultyFactor = difficultyFactors[difficulty] || 1.0;
    const speed = baseSpeed * speedFactor * difficultyFactor;
    const timeHours = distance / (speed || 1);
    const elevationTime = elevationGain / 600;
    const totalTime = timeHours + elevationTime;
    const hours = Math.floor(totalTime);
    const minutes = Math.round((totalTime - hours) * 60);
    return `${hours}h${minutes.toString().padStart(2, '0')}`;
}
    
// =====================
// Direction calculation functions
// =====================
function getCardinalDirection(bearing) {
    bearing = (bearing + 360) % 360;
    if (bearing >= 337.5 || bearing < 22.5) return '↑ N';
    if (bearing >= 22.5 && bearing < 67.5) return '↗ NE';
    if (bearing >= 67.5 && bearing < 112.5) return '→ E';
    if (bearing >= 112.5 && bearing < 157.5) return '↘ SE';
    if (bearing >= 157.5 && bearing < 202.5) return '↓ S';
    if (bearing >= 202.5 && bearing < 247.5) return '↙ SW';
    if (bearing >= 247.5 && bearing < 292.5) return '← W';
    if (bearing >= 292.5 && bearing < 337.5) return '↖ NW';
    return '↑ N';
}
function getPathDirections(networkCoords, startPoint) {
    const startPointTurf = turf.point([startPoint.lng, startPoint.lat]);
    const NEAR_DISTANCE = 0.02; // 20 meters
    const MIN_ANGLE_DIFF = 20; // Minimum angle difference to consider paths distinct
    
    // Find all segments connected to the guidepost
    const startSegments = [];
    
    for (let i = 0; i < networkCoords.length - 1; i++) {
        const start = networkCoords[i];
        const end = networkCoords[i + 1];
        
        const startDist = turf.distance(startPointTurf, turf.point(start), {units: 'kilometers'});
        const endDist = turf.distance(startPointTurf, turf.point(end), {units: 'kilometers'});
        
        if (startDist < NEAR_DISTANCE || endDist < NEAR_DISTANCE) {
            // Calculate bearing away from guidepost
            const bearing = startDist < endDist ?
                turf.bearing(turf.point(start), turf.point(end)) :
                turf.bearing(turf.point(end), turf.point(start));
            
            startSegments.push({
                path: {
                    start: startDist < endDist ? start : end,
                    end: startDist < endDist ? end : start
                },
                bearing: bearing,
                direction: getCardinalDirection(bearing)
            });
        }
    }
    
    // Consolidate similar paths
    const uniquePaths = [];
    startSegments.forEach(segment => {
        const isUnique = !uniquePaths.some(existing => {
            let angleDiff = Math.abs(existing.bearing - segment.bearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            return angleDiff < MIN_ANGLE_DIFF;
        });
        
        if (isUnique) {
            uniquePaths.push(segment);
        }
    });
    
    return uniquePaths;
}
// =====================
// Network Building with Debug Info
// =====================
function isIntersection(nodeId, nodeWays, nodePositions, ways) {
    const wayIds = nodeWays.get(nodeId);
    if (!wayIds || wayIds.size < 2) return false;
    if (wayIds.size > 2) return true;

    const position = nodePositions.get(nodeId);
    if (!position) return false;

    const connectedWays = Array.from(wayIds)
        .map(wayId => ways.find(w => w.id === wayId))
        .filter(Boolean);

    if (connectedWays.length !== 2) return false;

    const bearings = connectedWays.map(way => {
        const nodeIndex = way.nodes.indexOf(nodeId);
        const otherNodeId = nodeIndex === 0 ? 
            way.nodes[1] : 
            way.nodes[way.nodes.length - 2];
        const otherNode = nodePositions.get(otherNodeId);
        if (!otherNode) return null;
        
        const bearing = turf.bearing(
            turf.point(position),
            turf.point(otherNode)
        );
        return { bearing, wayId: way.id };
    }).filter(Boolean);

    if (bearings.length !== 2) return false;

    let angleDiff = Math.abs(bearings[0].bearing - bearings[1].bearing);
    if (angleDiff > 180) angleDiff = 360 - angleDiff;

    return angleDiff > 45;
}
function findAllRoutes(nodes, ways, nodeWays, nodePositions, lon, lat) {
    // Find starting points
    const startNodes = new Set();
    const guidepostNode = nodes.find(n => 
        Math.abs(n.lat - lat) < 0.0001 && Math.abs(n.lon - lon) < 0.0001
    );
    
    if (guidepostNode) {
        startNodes.add(guidepostNode.id);
        // Also add nearby nodes
        nodes.forEach(n => {
            if (Math.abs(n.lat - lat) < 0.0002 && Math.abs(n.lon - lon) < 0.0002) {
                startNodes.add(n.id);
            }
        });
    }

    const routes = [];
    const visited = new Set();

    function findRoutes(nodeId, currentWayId = null, path = [], visitedWays = new Set(), depth = 0) {
        if (depth > 40 || routes.length >= 30) return;
        
        const nodePos = nodePositions.get(nodeId);
        if (!nodePos) return;
        
        if (!currentWayId) {
            // Get all connected ways and sort them by ID for consistency
            const connectedWays = Array.from(nodeWays.get(nodeId) || new Set())
                .sort((a, b) => {
                    // Sort by way length first (prefer longer ways)
                    const wayA = ways.find(w => w.id === a);
                    const wayB = ways.find(w => w.id === b);
                    if (!wayA || !wayB) return 0;
                    
                    // Then by way ID for stable sorting
                    return wayA.id.localeCompare(wayB.id);
                });
            
            // Explore all connected ways
            for (const wayId of connectedWays) {
                if (!visitedWays.has(wayId)) {
                    findRoutes(nodeId, wayId, [nodePos], new Set(visitedWays), depth);
                }
            }
            return;
        }
        
        if (!visitedWays.has(currentWayId)) {
            visitedWays.add(currentWayId);
            const way = ways.find(w => w.id === currentWayId);
            if (way) {
                const nodeIndex = way.nodes.indexOf(nodeId);
                if (nodeIndex !== -1) {
                    const directions = [];
                    
                    // Forward direction
                    if (nodeIndex < way.nodes.length - 1) {
                        const forwardCoords = [];
                        for (let i = nodeIndex; i < way.nodes.length; i++) {
                            const pos = nodePositions.get(way.nodes[i]);
                            if (pos) forwardCoords.push(pos);
                        }
                        if (forwardCoords.length > 1) {
                            directions.push({
                                coords: forwardCoords,
                                nextNode: way.nodes[way.nodes.length - 1]
                            });
                        }
                    }
                    
                    // Backward direction
                    if (nodeIndex > 0) {
                        const backwardCoords = [];
                        for (let i = nodeIndex; i >= 0; i--) {
                            const pos = nodePositions.get(way.nodes[i]);
                            if (pos) backwardCoords.push(pos);
                        }
                        if (backwardCoords.length > 1) {
                            directions.push({
                                coords: backwardCoords,
                                nextNode: way.nodes[0]
                            });
                        }
                    }
                    
                    for (const direction of directions) {
                        const newPath = [...path, ...direction.coords.slice(1)];
                        const connectedWays = Array.from(nodeWays.get(direction.nextNode) || new Set());
                        
                        for (const nextWayId of connectedWays) {
                            if (!visitedWays.has(nextWayId)) {
                                findRoutes(direction.nextNode, nextWayId, newPath, new Set(visitedWays), depth + 1);
                            }
                        }
                    }
                }
            }
            visitedWays.delete(currentWayId);
        }
        
        if (path.length > 3) {
            const uniqueCoords = new Set();
            let lastCoord = null;
            for (const coord of path) {
                if (!lastCoord || 
                    Math.abs(coord[0] - lastCoord[0]) > 0.0001 || 
                    Math.abs(coord[1] - lastCoord[1]) > 0.0001) {
                    uniqueCoords.add(coord.join(','));
                    lastCoord = coord;
                }
            }
            if (uniqueCoords.size > 3) {
                routes.push(path);
            }
        }
    }

    // Find routes from each start node
    for (const startNodeId of startNodes) {
        findRoutes(startNodeId);
    }

    return routes;
}
function getOverpassQuery(lat, lon) {
    const PATH_RADIUS = 3000;  // 8km for paths
    const POI_RADIUS = 4000;   // 5km for POIs
    
    return `[out:json][timeout:25];
(
    // Get paths with larger radius
    way(around:${PATH_RADIUS},${lat},${lon})[highway~"^(path|footway|track)$"];
    node(w); // Get nodes for those ways
    
    // Natural features
    node(around:${POI_RADIUS},${lat},${lon})[natural~"^(peak|saddle|spring|water_point)$"];
    
    // Amenities
    node(around:${POI_RADIUS},${lat},${lon})[amenity~"^(parking|shelter|alpine_hut|drinking_water)$"];
    
    // Tourism and Information
    node(around:${POI_RADIUS},${lat},${lon})[tourism="alpine_hut"];
    node(around:${POI_RADIUS},${lat},${lon})[tourism="information"][information!="guidepost"];
    
    // Additional query for guideposts
    node(around:${POI_RADIUS},${lat},${lon})[information="guidepost"][tourism="information"];
    
    // Additional query for parking locations
    node(around:${POI_RADIUS},${lat},${lon})[amenity="parking"];
);
out body;
>;
out body qt;`;
}
function findPOIsForNetwork(networkCoords, startPoint, osmData) {
    // Remove duplicates by ID
    const uniqueElements = new Map();
    osmData.elements.forEach(el => {
        if (el.type === 'node' && el.tags) {
            const key = `${el.id}-${el.type}`;
            uniqueElements.set(key, el);
        }
    });

    const networkLine = turf.lineString(networkCoords);
    const buffer = turf.buffer(networkLine, 0.5, {units: 'kilometers'});
    const signpostBuffer = turf.buffer(
        turf.point([startPoint.lng, startPoint.lat]), 
        0.01,
        {units: 'kilometers'}
    );

    // Process unique POIs
    const pois = Array.from(uniqueElements.values())
        .filter(el => {
            // Skip the current guidepost
            if (el.lat === startPoint.lat && el.lon === startPoint.lng) {
                return false;
            }

            // Determine feature type
            let feature = null;

            // Check for parking
            if (el.tags.amenity === 'parking') {
                feature = 'parking';
            }
            // Check for guidepost
            else if (el.tags.tourism === 'information' && el.tags.information === 'guidepost') {
                feature = 'information';  // guidepost
            }
            // Check other features
            else {
                feature = el.tags.natural || 
                         el.tags.amenity || 
                         (el.tags.tourism === 'alpine_hut' ? 'alpine_hut' : null);
            }

            return POI_PRIORITIES.hasOwnProperty(feature);
        })
        .map(node => {
            // Determine feature type with priority for certain tags
            let feature;
            if (node.tags.amenity === 'parking') {
                feature = 'parking';
            } else if (node.tags.tourism === 'information' && node.tags.information === 'guidepost') {
                feature = 'information';
            } else {
                feature = node.tags.natural || 
                         node.tags.amenity || 
                         (node.tags.tourism === 'alpine_hut' ? 'alpine_hut' : node.tags.tourism);
            }

            return {
                geometry: {
                    type: 'Point',
                    coordinates: [node.lon, node.lat]
                },
                properties: {
                    name: node.tags.name || feature,
                    feature: feature,
                    ele: node.tags.ele,
                    tags: node.tags,
                    id: node.id
                }
            };
        });

    const filteredPois = pois.filter(poi => {
        const point = turf.point(poi.geometry.coordinates);
        const isAwayFromSignpost = !turf.booleanPointInPolygon(point, signpostBuffer);
        const isImportantPOI = POI_PRIORITIES[poi.properties.feature] <= 3; // Include parking in important POIs
        const effectiveBuffer = isImportantPOI ? 
            turf.buffer(networkLine, 1, {units: 'kilometers'}) : buffer;
        
        const isInNetworkBuffer = turf.booleanPointInPolygon(point, effectiveBuffer);

        return isInNetworkBuffer && isAwayFromSignpost;
    });

    return filteredPois.map(poi => {
        const coordinates = poi.geometry.coordinates;
        const distance = turf.distance(
            turf.point([startPoint.lng, startPoint.lat]),
            turf.point(coordinates),
            {                units: 'kilometers'}
        );

        return {
            name: poi.properties.name || 
                `${poi.properties.feature} (${poi.properties.ele}m)`,
            type: poi.properties.feature,
            priority: POI_PRIORITIES[poi.properties.feature] || 999,
            geometry: poi.geometry,
            distance,
            elevation: poi.properties.ele || 0,
            time: calculateHikingTime(
                distance,
                Math.max(0, (poi.properties.ele || 0) - startPoint.ele),
                'hiking'
            ),
            id: poi.properties.id
        };
    });
}
function processRoutes(routes, startPoint) {
    const directionalRoutes = new Map();
    
    routes.forEach(route => {
        const direction = calculatePathDirection(startPoint, route);
        if (!direction) return;
        
        if (!directionalRoutes.has(direction)) {
            directionalRoutes.set(direction, []);
        }
        
        const distance = turf.length(turf.lineString(route), {units: 'kilometers'});
        const pois = findPOIsForRoute(route, startPoint);
        
        directionalRoutes.get(direction).push({
            coords: route,
            distance: distance,
            destinations: pois
        });
    });

    return Array.from(directionalRoutes.entries())
        .map(([direction, routes]) => ({
            direction,
            destinations: routes[0].destinations || []
        }))
        .filter(result => result.destinations.length > 0)
        .sort((a, b) => {
            const minPriorityA = Math.min(...a.destinations.map(d => d.priority));
            const minPriorityB = Math.min(...b.destinations.map(d => d.priority));
            return minPriorityA - minPriorityB;
        });
}
function findNetworkCoordinates(nodes, ways, nodeWays, nodePositions, lon, lat) {
    const startNodes = new Set();
    const guidepostNode = nodes.find(n => 
        Math.abs(n.lat - lat) < 0.0001 && Math.abs(n.lon - lon) < 0.0001
    );
    
    if (guidepostNode) {
        startNodes.add(guidepostNode.id);
        nodes.forEach(n => {
            if (Math.abs(n.lat - lat) < 0.0002 && Math.abs(n.lon - lon) < 0.0002) {
                startNodes.add(n.id);
            }
        });
    }

    const networkCoords = new Set();
    const visited = new Set();

    function traverseNetwork(nodeId, currentWayId = null, visitedWays = new Set()) {
        const nodePos = nodePositions.get(nodeId);
        if (!nodePos) return;
        
        networkCoords.add(nodePos.join(','));
        
        if (!currentWayId) {
            const connectedWays = Array.from(nodeWays.get(nodeId) || new Set()).sort();
            for (const wayId of connectedWays) {
                if (!visitedWays.has(wayId)) {
                    traverseNetwork(nodeId, wayId, new Set(visitedWays));
                }
            }
            return;
        }
        
        if (!visitedWays.has(currentWayId)) {
            visitedWays.add(currentWayId);
            const way = ways.find(w => w.id === currentWayId);
            if (way) {
                const nodeIndex = way.nodes.indexOf(nodeId);
                if (nodeIndex !== -1) {
                    const directions = [];
                    
                    if (nodeIndex < way.nodes.length - 1) {
                        directions.push(way.nodes[way.nodes.length - 1]);
                    }
                    
                    if (nodeIndex > 0) {
                        directions.push(way.nodes[0]);
                    }
                    
                    for (const nextNodeId of directions) {
                        const connectedWays = Array.from(nodeWays.get(nextNodeId) || new Set());
                        
                        for (const nextWayId of connectedWays) {
                            if (!visitedWays.has(nextWayId)) {
                                traverseNetwork(nextNodeId, nextWayId, new Set(visitedWays));
                            }
                        }
                    }
                }
            }
            visitedWays.delete(currentWayId);
        }
    }

    for (const startNodeId of startNodes) {
        traverseNetwork(startNodeId);
    }

    return Array.from(networkCoords).map(str => str.split(',').map(parseFloat));
}
function getAvailableDirections(networkCoords, startPoint) {
    // Find the closest point in the network to the start point
    const startPointTurf = turf.point([startPoint.lng, startPoint.lat]);
    let nearestIndex = 0;
    let minDistance = Infinity;
    
    networkCoords.forEach((coord, index) => {
        const distance = turf.distance(startPointTurf, turf.point(coord));
        if (distance < minDistance) {
            minDistance = distance;
            nearestIndex = index;
        }
    });

    // Get connected segments
    const directions = new Set();
    const SEGMENT_DISTANCE = 0.05; // 50m segments

    // Look for segments connected to the nearest point
    for (let i = 0; i < networkCoords.length - 1; i++) {
        const start = networkCoords[i];
        const end = networkCoords[i + 1];
        
        // Check if this segment is connected to our point
        const startDist = turf.distance(startPointTurf, turf.point(start));
        const endDist = turf.distance(startPointTurf, turf.point(end));
        
        if (startDist < SEGMENT_DISTANCE || endDist < SEGMENT_DISTANCE) {
            // Calculate bearing for this segment
            const bearing = turf.bearing(
                turf.point(start),
                turf.point(end)
            );
            directions.add(getCardinalDirection(bearing));
        }
    }

    return Array.from(directions);
}
function getTrailDirections(networkCoords, startPoint) {
    const startPointTurf = turf.point([startPoint.lng, startPoint.lat]);
    const NEAR_DISTANCE = 0.02; // 20 meters
    const MIN_ANGLE_DIFF = 20; // Minimum angle difference to consider paths distinct
    
    // Find segments that start near the guidepost
    const startSegments = [];
    
    // First pass: find all segments connected to the guidepost
    for (let i = 0; i < networkCoords.length - 1; i++) {
        const start = networkCoords[i];
        const end = networkCoords[i + 1];
        
        const startDist = turf.distance(startPointTurf, turf.point(start), {units: 'kilometers'});
        const endDist = turf.distance(startPointTurf, turf.point(end), {units: 'kilometers'});
        
        if (startDist < NEAR_DISTANCE || endDist < NEAR_DISTANCE) {
            // Calculate bearing away from guidepost
            const bearing = startDist < endDist ?
                turf.bearing(turf.point(start), turf.point(end)) :
                turf.bearing(turf.point(end), turf.point(start));
            
            startSegments.push({
                direction: getCardinalDirection(bearing),
                coords: [start, end],
                bearing: bearing
            });
        }
    }
    
    // Consolidate similar directions
    const uniqueDirections = [];
    startSegments.forEach(segment => {
        const isUnique = !uniqueDirections.some(existing => {
            let angleDiff = Math.abs(existing.bearing - segment.bearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            return angleDiff < MIN_ANGLE_DIFF;
        });
        
        if (isUnique) {
            uniqueDirections.push(segment);
        }
    });
    
    return uniqueDirections;
}

/*function getPathDirections(networkCoords, startPoint) {
    const startPointTurf = turf.point([startPoint.lng, startPoint.lat]);
    const NEAR_DISTANCE = 0.02; // 20 meters
    const MIN_ANGLE_DIFF = 45; // Increased from 20 to 45 degrees - more strict about distinct paths
    
    // Find segments that start near the guidepost
    const nearbySegments = [];
    
    // First find all segments that are very close to the guidepost
    for (let i = 0; i < networkCoords.length - 1; i++) {
        const start = networkCoords[i];
        const end = networkCoords[i + 1];
        
        const startDist = turf.distance(startPointTurf, turf.point(start), {units: 'kilometers'});
        const endDist = turf.distance(startPointTurf, turf.point(end), {units: 'kilometers'});
        
        if (startDist < NEAR_DISTANCE || endDist < NEAR_DISTANCE) {
            // Use multiple points along the segment to get a more accurate direction
            const segment = turf.lineString([start, end]);
            const length = turf.length(segment, {units: 'kilometers'});
            const points = [];
            
            // Sample several points along the segment
            for (let j = 0; j < 5; j++) {
                const point = turf.along(segment, length * j / 4, {units: 'kilometers'});
                points.push(point.geometry.coordinates);
            }
            
            // Calculate bearing using multiple points for more accuracy
            const bearing = startDist < endDist ?
                turf.bearing(turf.point(points[0]), turf.point(points.length - 1)) :
                turf.bearing(turf.point(points[points.length - 1]), turf.point(points[0]));
            
            nearbySegments.push({
                path: {
                    start: startDist < endDist ? start : end,
                    end: startDist < endDist ? end : start,
                    points: points
                },
                bearing: bearing,
                direction: getCardinalDirection(bearing),
                distance: Math.min(startDist, endDist)
            });
        }
    }
    
    // Sort by distance to start point
    nearbySegments.sort((a, b) => a.distance - b.distance);
    
    // Use only the closest segments for determining initial directions
    const closestSegments = nearbySegments.filter(seg => seg.distance < NEAR_DISTANCE * 0.5);
    
    // Consolidate similar paths
    const uniquePaths = [];
    closestSegments.forEach(segment => {
        const isUnique = !uniquePaths.some(existing => {
            let angleDiff = Math.abs(existing.bearing - segment.bearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            return angleDiff < MIN_ANGLE_DIFF;
        });
        
        if (isUnique) {
            uniquePaths.push(segment);
        }
    });
    
    return uniquePaths;
}*/

// Update how we process POIs based on path directions
function processNetwork(pois, startPoint, networkCoords) {
    // Get the actual paths from the guidepost
    const paths = getPathDirections(networkCoords, startPoint);
    const poisByPath = new Map();
    
    // Initialize collections for each path
    paths.forEach(path => {
        poisByPath.set(path.direction, []);
    });
    
    // Assign POIs to nearest path
    pois.forEach(poi => {
        let bestPath = null;
        let minAngleDiff = 180;
        
        const poiBearing = turf.bearing(
            turf.point([startPoint.lng, startPoint.lat]),
            turf.point(poi.geometry.coordinates)
        );
        
        // Find which physical path this POI belongs to
        paths.forEach(path => {
            let angleDiff = Math.abs(path.bearing - poiBearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            
            if (angleDiff < minAngleDiff) {
                minAngleDiff = angleDiff;
                bestPath = path;
            }
        });
        
        if (bestPath && poisByPath.has(bestPath.direction)) {
            poisByPath.get(bestPath.direction).push({
                ...poi,
                pathBearing: bestPath.bearing
            });
        }
    });
    
    return Array.from(poisByPath.entries())
        .filter(([_, pois]) => pois.length > 0)
        .map(([direction, pois]) => ({
            direction,
            destinations: pois
                .sort((a, b) => {
                    if (a.priority !== b.priority) return a.priority - b.priority;
                    return a.distance - b.distance;
                })
                .slice(0, 3)
        }))
        .sort((a, b) => {
            const minPriorityA = Math.min(...a.destinations.map(d => d.priority));
            const minPriorityB = Math.min(...b.destinations.map(d => d.priority));
            return minPriorityA - minPriorityB;
        });
}
function findPathToDestination(networkCoords, startPoint, endPoint) {
    const startPointTurf = turf.point([startPoint.lng, startPoint.lat]);
    const endPointTurf = turf.point(endPoint);
    
    // Find closest network point to start and end
    let startNodeIndex = 0;
    let endNodeIndex = 0;
    let minStartDist = Infinity;
    let minEndDist = Infinity;
    
    networkCoords.forEach((coord, index) => {
        const pointTurf = turf.point(coord);
        const startDist = turf.distance(startPointTurf, pointTurf);
        const endDist = turf.distance(endPointTurf, pointTurf);
        
        if (startDist < minStartDist) {
            minStartDist = startDist;
            startNodeIndex = index;
        }
        if (endDist < minEndDist) {
            minEndDist = endDist;
            endNodeIndex = index;
        }
    });
    
    // Build adjacency graph
    const graph = new Map();
    for (let i = 0; i < networkCoords.length - 1; i++) {
        const current = networkCoords[i].join(',');
        const next = networkCoords[i + 1].join(',');
        
        if (!graph.has(current)) graph.set(current, new Set());
        if (!graph.has(next)) graph.set(next, new Set());
        
        graph.get(current).add(next);
        graph.get(next).add(current); // Paths are bidirectional
    }
    
    // Find path using BFS
    const startKey = networkCoords[startNodeIndex].join(',');
    const endKey = networkCoords[endNodeIndex].join(',');
    const visited = new Set();
    const queue = [[startKey]];
    visited.add(startKey);
    
    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];
        
        if (current === endKey) {
            // Convert path back to coordinates
            return path.map(key => key.split(',').map(Number));
        }
        
        const neighbors = graph.get(current) || new Set();
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }
    
    return null;
}
function findRelevantRoutes(networkCoords, directionalResults, startPoint) {
    const relevantWays = [];
    const processedPaths = new Set();
    
    directionalResults.forEach((dirResult, dirIndex) => {
        // For each destination in this direction
        dirResult.destinations.forEach(poi => {
            const path = findPathToDestination(
                networkCoords,
                startPoint,
                poi.geometry.coordinates
            );
            
            if (path) {
                // Create segments from the path
                for (let i = 0; i < path.length - 1; i++) {
                    const pathKey = `${path[i].join(',')}-${path[i + 1].join(',')}`;
                    const reverseKey = `${path[i + 1].join(',')}-${path[i].join(',')}`;
                    
                    if (!processedPaths.has(pathKey) && !processedPaths.has(reverseKey)) {
                        processedPaths.add(pathKey);
                        relevantWays.push({
                            type: 'Feature',
                            properties: {
                                color: dirIndex === 0 ? '#00FF00' : // green
                                       dirIndex === 1 ? '#FF0000' : // red
                                                      '#FF69B4',    // pink
                                direction: dirResult.direction,
                                destination: poi.name
                            },
                            geometry: {
                                type: 'LineString',
                                coordinates: [path[i], path[i + 1]]
                            }
                        });
                    }
                }
            }
        });
    });
    
    return relevantWays;
}
// =====================
// Visualization Functions
// =====================
function setupMapLayers(map, routeFeatures) {
    // Clean up ALL existing layers
    ['route-lines', 'debug-network', 'debug-nodes', 'debug-pois'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
    });

    // Only add the route visualization
    map.addSource('route-lines', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: routeFeatures
        }
    });

    map.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'route-lines',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.8
        }
    });
}
// =====================
// Main Function with Debug Support
// =====================
function processOsmData(data, lon, lat, feature) {
    console.log('Processing OSM data for:', feature.properties);

    // Extract OSM elements by type
    const ways = data.elements.filter(el => el.type === 'way' && el.nodes?.length > 1);
    const nodes = data.elements.filter(el => el.type === 'node');

    // Initialize starting point
    const startPoint = {
        lng: lon,
        lat: lat,
        ele: feature.properties.ele || 0
    };

    // Build node lookup maps
    const nodeWays = new Map();
    const nodePositions = new Map();

    ways.forEach(way => {
        way.nodes.forEach(nodeId => {
            if (!nodeWays.has(nodeId)) {
                nodeWays.set(nodeId, new Set());
                const node = nodes.find(n => n.id === nodeId);
                if (node) {
                    nodePositions.set(nodeId, [node.lon, node.lat]);
                }
            }
            nodeWays.get(nodeId).add(way.id);
        });
    });

    // Get network coordinates
    const networkCoords = findNetworkCoordinates(nodes, ways, nodeWays, nodePositions, lon, lat);

    // Find POIs along the network
    const pois = findPOIsForNetwork(networkCoords, startPoint, data);

    // Process POIs into directional groups
    const directionalResults = processNetwork(pois, startPoint, networkCoords);

    // Get only the relevant routes for visualization
    const relevantRoutes = findRelevantRoutes(networkCoords, directionalResults, startPoint);

    // Create and display the popup
    const content = createSignpostPopup(
        directionalResults,
        feature.properties.name || 'Signpost',
        feature.properties.ele
    );

    // Position and display the popup
    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '500px',
        className: 'signpost-popup'
    })
        .setLngLat([lon, lat])
        .setHTML(content)
        .addTo(map);

    return {
        pois,
        directionalResults,
        networkCoords
    };
}
function createSignpostPopup(results, signpostLabel, signpostElevation) {
    if (!results || results.length === 0) {
        return `
            <div class="signpost-popup" style="padding: 10px;">
                <div style="color: #666;">No destinations found nearby</div>
            </div>
        `;
    }

    const content = results.map(direction => `
        <div class="signpost-direction" style="
            margin-bottom: 5px;
            background: #FFD700;
            padding: 5px;
            border-radius: 4px;
        ">
            <!-- Arrow + Cardinal Direction -->
            <div style="display: flex; align-items: center; font-weight: bold; margin-bottom: 5px;">
                <div style="margin-right: 8px; font-size: 16px;">➤</div>
                <div>${direction.direction}</div>
            </div>

            <!-- POI List -->
            ${direction.destinations.map(dest => `
                <div class="destination" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 5px;
                    font-size: 12px;
                    color: #333;
                ">
                    <!-- POI Name -->
                    <div style="font-weight: bold; flex: 1;">
                        <span style="margin-right: 30px;">${dest.name}</span>
                    </div>
                    <!-- Distance and Duration -->
                    <div style="
                        display: flex;
                        gap: 10px;
                        white-space: nowrap; /* Ensures no line breaks */
                    ">
                        <span>${dest.distance.toFixed(1)} km</span>
                        <span>${dest.time}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');

    return `
        <div class="signpost-popup" style="
            padding: 10px;
            max-width: 500px;
            background: #fff;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            font-family: Arial, sans-serif;
        ">
            <!-- Square Header -->
            <div style="
                background: #4CAF50;
                color: #fff;
                height: 80px;
                width: 80px;
                margin: 0 auto 10px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                border-radius: 4px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                font-size: 12px;
                font-weight: bold;
            ">
                <div style="font-weight: bold; font-size: 12px;">${signpostLabel || 'Signpost'}</div>
                <div>${signpostElevation ? `${signpostElevation}m` : 'N/A'}</div>
            </div>
            ${content}
        </div>
    `;
}
// =====================
// Functions to Fetch external datas
// =====================
async function fetchPointsOfInterest() {
    const currentZoom = map.getZoom();
    if (currentZoom < 11) {
        map.getSource('refuges').setData({
            type: 'FeatureCollection',
            features: []
        });
        return;
    }

    try {
        const bounds = map.getBounds();
        const center = map.getCenter();
        const bbox = calculateOptimizedBbox(bounds, center, currentZoom);

        const response = await fetch(
            `https://www.refuges.info/api/bbox?bbox=${bbox}&type_points=cabane,refuge,gite,pt_eau,sommet,pt_passage,bivouac,lac&format=geojson&detail=complet`
        );
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        const featuresWithDistance = data.features.map(feature => ({
            feature,
            distance: getDistanceFromLatLonInM(
                center.lat,
                center.lng,
                feature.geometry.coordinates[1],
                feature.geometry.coordinates[0]
            )
        }));

        featuresWithDistance.sort((a, b) => a.distance - b.distance);

        featuresWithDistance.forEach(({ feature }) => {
            const photoId = `photo-${feature.properties.id}`;
            if (photoCache.has(photoId)) {
                feature.properties.photoId = photoId;
            }
        });

        data.features = featuresWithDistance.map(f => f.feature);
        if (map.getSource('refuges')) {
            map.getSource('refuges').setData(data);
        }

        const BATCH_SIZE = 3;
        const unprocessedFeatures = featuresWithDistance.filter(
            ({ feature }) => !processedFeatures.has(feature.properties.id)
        );

        for (let i = 0; i < unprocessedFeatures.length; i += BATCH_SIZE) {
            const batch = unprocessedFeatures.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ feature }) => {
                const photoId = `photo-${feature.properties.id}`;
                
                if (processedFeatures.has(feature.properties.id)) return;

                try {
                    const photoUrls = await getPointPhotos(feature);
                    if (photoUrls && photoUrls.length > 0) {
                        feature.properties.photoUrls = photoUrls;
                        
                        if (!map.hasImage(photoId)) {
                            const photoUrl = `https://www.refuges.info${photoUrls[0]}`;
                            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(photoUrl)}`;
                            const photoResponse = await fetch(proxyUrl);
                            if (!photoResponse.ok) return;

                            const photoBlob = await photoResponse.blob();
                            const imageBitmap = await createImageBitmap(photoBlob);

                            const size = 128;
                            const canvas = document.createElement('canvas');
                            canvas.width = size;
                            canvas.height = size;
                            const ctx = canvas.getContext('2d');

                            // Determine color based on type
                            const type = feature.properties.type.valeur;
                            let typeColor;
                            if (type.includes("point d'eau")) {
                                typeColor = '#558e5b';
                            } else if (type.includes('sommet') || type.includes('passage')) {
                                typeColor = '#ff4444';
                            } else if (type.includes('refuge') || type.includes('cabane') || type.includes('gîte')) {
                                typeColor = '#ffffff';
                            } else if (type.includes('lac')) {
                                typeColor = '#4682B4';
                            } else if (type.includes('bivouac')) {
                                typeColor = '#f5a442';
                            } else {
                                typeColor = '#f5a442';
                            }

                            ctx.beginPath();
                            ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
                            ctx.fillStyle = 'white';
                            ctx.fill();

                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(size/2, size/2, size/2 - 4, 0, Math.PI * 2);
                            ctx.clip();
                            ctx.drawImage(imageBitmap, 0, 0, size, size);
                            ctx.restore();

                            ctx.beginPath();
                            ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
                            ctx.strokeStyle = typeColor;
                            ctx.lineWidth = 4;
                            ctx.stroke();

                            const imageData = ctx.getImageData(0, 0, size, size);
                            map.addImage(photoId, imageData);
                        }

                        feature.properties.photoId = photoId;
                        photoCache.set(photoId, photoUrls);
                        processedFeatures.add(feature.properties.id);

                        const currentData = map.getSource('refuges')._data;
                        const index = currentData.features.findIndex(f => 
                            f.properties.id === feature.properties.id
                        );
                        if (index !== -1) {
                            currentData.features[index] = feature;
                            map.getSource('refuges').setData(currentData);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to process photos for point ${feature.properties.id}:`, error);
                }
            }));
        }

        data.features.forEach(feature => {
            feature.properties.onClick = () => {
                const coordinates = feature.geometry.coordinates.slice();
                const properties = feature.properties;
                createPointPopup(coordinates, properties);
            };
        });

    } catch (error) {
        console.error('Error fetching points of interest:', error);
    }
}
function formatPopupContent(properties) {
    let p = properties;
    
    const parseJsonProp = (prop) => {
        if (typeof prop === 'string' && prop.startsWith('{')) {
            try {
                return JSON.parse(prop);
            } catch (e) {
                return prop;
            }
        }
        return prop;
    };

    // Parse JSON strings
    p.coord = parseJsonProp(p.coord);
    p.places = parseJsonProp(p.places);
    p.proprio = parseJsonProp(p.proprio);
    p.info_comp = parseJsonProp(p.info_comp);
    p.remarque = parseJsonProp(p.remarque);
    p.acces = parseJsonProp(p.acces);
    p.type = parseJsonProp(p.type);
    p.date = parseJsonProp(p.date);

    // Create carousel HTML
    let carouselHtml = '';
    if (p.photoUrls && p.photoUrls.length > 0) {
        const uniquePhotos = [...new Set(p.photoUrls)];

        carouselHtml = `
            <div class="carousel-container" style="margin-bottom: 15px; position: relative;">
                <div class="carousel-slides" style="position: relative; min-height: 200px;">
                    ${uniquePhotos.map((url, index) => {
                        const fullUrl = `https://www.refuges.info${url}`;
                        
                        return `
                            <div class="carousel-slide ${index === 0 ? 'active' : ''}" 
                                 data-index="${index}" 
                                 style="display: ${index === 0 ? 'block' : 'none'}; position: absolute; width: 100%;">
                                <img src="${fullUrl}" 
                                     alt="${p.nom} - Photo ${index + 1}" 
                                     style="width: 100%; height: 200px; object-fit: cover; border-radius: 4px;">
                            </div>
                        `;
                    }).join('')}
                </div>
                ${uniquePhotos.length > 1 ? `
                    <div class="carousel-controls" style="position: absolute; bottom: 10px; left: 0; right: 0; display: flex; justify-content: center; gap: 10px; z-index: 10;">
                        <button class="carousel-button" onclick="changeSlide(this, -1)" 
                                style="background: rgba(255,255,255,0.8); border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; display: flex; align-items: center; justify-content: center;">❮</button>
                        <span class="carousel-counter" style="background: rgba(255,255,255,0.8); padding: 4px 8px; border-radius: 12px;">1/${uniquePhotos.length}</span>
                        <button class="carousel-button" onclick="changeSlide(this, 1)"
                                style="background: rgba(255,255,255,0.8); border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; display: flex; align-items: center; justify-content: center;">❯</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    return `
        <div class="refuge-popup">
            <h3 style="margin: 0 0 15px 0; color: #2d4059; border-bottom: 2px solid #2d4059; padding-bottom: 5px;">
                ${p.nom}
            </h3>
            ${carouselHtml}
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; margin-bottom: 15px;">
                <div style="font-weight: bold;">Altitude:</div>
                <div>${p.coord.alt}m</div>
                <div style="font-weight: bold;">Capacité:</div>
                <div>${p.places.valeur} places</div>
                <div style="font-weight: bold;">Propriétaire:</div>
                <div>${p.proprio.valeur}</div>
            </div>
            <div style="margin: 15px 0; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                <div style="font-weight: bold; margin-bottom: 8px;">Équipements:</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px;">
                    ${p.info_comp.eau.valeur === "1" ? '<div>💧 Eau à proximité</div>' : ''}
                    ${p.info_comp.bois.valeur === "1" ? '<div>🌳 Forêt à proximité</div>' : ''}
                    ${p.info_comp.poele.valeur === "1" ? '<div>🔥 Poêle</div>' : ''}
                    ${p.info_comp.latrines.valeur === "1" ? '<div>🚽 Latrines</div>' : ''}
                    ${p.info_comp.cheminee.valeur === "1" ? '<div>🏠 Cheminée</div>' : ''}
                    ${p.info_comp.couvertures.valeur === "1" ? '<div>🛏️ Couvertures</div>' : ''}
                </div>
            </div>
            <div style="margin-top: 15px; font-size: 0.9em; color: #666;">
                <div>Type: ${p.type.valeur}</div>
                <div style="word-break: break-all; margin-top: 10px;">
                    <a href="${p.lien}" target="_blank">${p.lien}</a>
                </div>
            </div>
        </div>
    `;
}
async function getPointPhotos(feature) {
    try {
        const pageUrl = feature.properties.lien;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`;
        
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            console.warn(`Failed to fetch page for point ${feature.properties.id}:`, response.status);
            return null;
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const photoRegex = /photos_points\/\d+-reduite\.jpeg/;
        const images = Array.from(doc.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => photoRegex.test(src))
            .map(src => src.replace(/^https?:\/\/[^/]+/, ''));

        return images;
        
    } catch (error) {
        console.warn(`Error getting photo for point ${feature.properties.id}:`, error);
        return null;
    }
}
async function createPointPopup(coordinates, properties) {
    const photoId = `photo-${properties.id}`;
    if (photoCache.has(photoId) && !properties.photoUrls) {
        properties.photoUrls = photoCache.get(photoId);
    }

    if (!properties.photoUrls) {
        properties.photoUrls = await getPointPhotos({ properties });
    }

    const popupContent = formatPopupContent(properties);

new maplibregl.Popup()
        .setLngLat(coordinates)
        .setHTML(popupContent)
        .addTo(map);
}
window.changeSlide = function(button, direction) {
    const container = button.closest('.carousel-container');
    const slides = container.querySelectorAll('.carousel-slide');
    const counter = container.querySelector('.carousel-counter');
    
    let currentIndex = Array.from(slides).findIndex(slide => 
        slide.classList.contains('active')
    );
    
    slides[currentIndex].classList.remove('active');
    slides[currentIndex].style.display = 'none';
    
    currentIndex = (currentIndex + direction + slides.length) % slides.length;
    
    slides[currentIndex].classList.add('active');
    slides[currentIndex].style.display = 'block';
    
    counter.textContent = `${currentIndex + 1}/${slides.length}`;
    
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
    const nextIndex = (currentIndex + 1) % slides.length;
    slides[prevIndex].querySelector('img').setAttribute('loading', 'lazy');
    slides[nextIndex].querySelector('img').setAttribute('loading', 'lazy');
};
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
}
function deg2rad(deg) {
    return deg * (Math.PI/180);
}
// =====================
// Functions to Fetch external datas
// =====================
function fetchWikimediaPhotos() {
    const currentZoom = map.getZoom();
    if (currentZoom >= 15) {
        const bounds = map.getBounds();
        const url = `https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gsbbox=${bounds.getNorth()}|${bounds.getWest()}|${bounds.getSouth()}|${bounds.getEast()}&gsnamespace=6&gslimit=500&format=json&origin=*`;
        
        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (!data.query || !data.query.geosearch) return;
                
                const features = data.query.geosearch.map(item => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [item.lon, item.lat]
                    },
                    properties: {
                        title: item.title,
                        url: item.title,
                        pageid: item.pageid
                    }
                }));
                
                map.getSource('wikimedia').setData({
                    type: 'FeatureCollection',
                    features: features
                });
            })
            .catch(error => console.error('Error fetching Wikimedia photos:', error));
    } else {
        // Clear the Wikimedia data when outside the desired zoom range
        map.getSource('wikimedia').setData({
            type: 'FeatureCollection',
            features: []
        });
    }
}
// Add a function to fetch photo metadata
async function fetchPhotoMetadata(title) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=user|timestamp|extmetadata&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        const imageInfo = pages[pageId].imageinfo?.[0];
        
        if (imageInfo) {
            const metadata = imageInfo.extmetadata || {};
            return {
                author: metadata.Artist?.value || imageInfo.user || 'Unknown',
                license: metadata.License?.value || 'Unknown license',
                description: metadata.ImageDescription?.value || '',
                dateUploaded: new Date(imageInfo.timestamp).toLocaleDateString(),
                creditLine: metadata.Credit?.value || ''
            };
        }
        return null;
    } catch (error) {
        console.error('Error fetching photo metadata:', error);
        return null;
    }
}
// Usage in click handler
map.on('click', 'poisth', async (e) => {
    const feature = e.features[0];
    if (feature.properties.feature === 'information' && 
        feature.properties.information === 'guidepost') {
        const [lon, lat] = feature.geometry.coordinates;

        try {
            const query = getOverpassQuery(lat, lon);
            
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'data=' + encodeURIComponent(query)
            });

            if (!response.ok) {
                const text = await response.text();
                console.error('Overpass API Error:', text);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            osmCache.set(feature.properties.id, data);
            processOsmData(data, lon, lat, feature);

        } catch (error) {
            console.error('Error querying OSM:', error);
            new maplibregl.Popup()
                .setLngLat([lon, lat])
                .setHTML(`
                    <div style="padding:10px;">
                        <strong>Error querying OSM data</strong><br>
                        ${error.message}
                    </div>
                `)
                .addTo(map);
        }
    }
});
// =====================
// Thunderforest Layers
// =====================
async function initializeThunderforestLayers() {
    try {
        const apiKey = 'bbb81d9ac1334825af992c8f0a09ea25';
        const MAX_DISTANCE_KM = 4;

        if (map.getSource('thunderforest-outdoors')) {
            map.removeSource('thunderforest-outdoors');
        }

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

        // Add source
        map.addSource('thunderforest-outdoors', {
            type: 'vector',
            tiles: [
                `https://a.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=${apiKey}`,
                `https://b.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=${apiKey}`,
                `https://c.tile.thunderforest.com/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf?apikey=${apiKey}`
            ],
            maxzoom: 14
        });

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

        // Add all layers with distance filtering
        map.addLayer({
            'id': 'paths-hit-area',
            'type': 'line',
            'source': 'thunderforest-outdoors',
            'source-layer': 'path',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'visible',
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#000000',
                'line-width': 20,
                'line-opacity': 0
            }
        }, 'refuges-layer');

        map.addLayer({
            'id': 'paths-outline',
            'type': 'line',
            'source': 'thunderforest-outdoors',
            'source-layer': 'path',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'visible',
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#FFFFFF',
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    15,
                    0
                ],
                'line-opacity': 0.5
            }
        }, 'paths-hit-area');

        map.addLayer({
            'id': 'paths',
            'type': 'line',
            'source': 'thunderforest-outdoors',
            'source-layer': 'path',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'visible',
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': [
                    'match',
                    ['get', 'sac_scale'],
                    'hiking', '#4444FF',
                    'mountain_hiking', '#44FF44',
                    'demanding_mountain_hiking', '#FFFF44',
                    'alpine_hiking', '#FFA500',
                    'demanding_alpine_hiking', '#FF4444',
                    'difficult_alpine_hiking', '#FF0000',
                    '#4444FF'
                ],
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 2,
                    16, 4
                ],
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15, 0,
                    17, 1
                ],
                'line-opacity-transition': {
                    'duration': 2000,
                    'delay': 0
                }
            }
        }, 'paths-outline');

        map.addLayer({
            'id': 'path-difficulty-markers',
            'type': 'symbol',
            'source': 'thunderforest-outdoors',
            'source-layer': 'path',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'none',
                'symbol-placement': 'line',
                'symbol-spacing': 300,
                'text-field': [
                    'match',
                    ['get', 'sac_scale'],
                    'hiking', 'T1',
                    'mountain_hiking', 'T2',
                    'demanding_mountain_hiking', 'T3',
                    'alpine_hiking', 'T4',
                    'demanding_alpine_hiking', 'T5',
                    'difficult_alpine_hiking', 'T6',
                    ''
                ],
                'text-size': 12,
                'text-font': ['Noto Sans Regular'],
                'text-allow-overlap': false,
                'text-ignore-placement': false,
                'text-padding': 2
            },
            'paint': {
                'text-color': [
                    'match',
                    ['get', 'sac_scale'],
                    'hiking', '#4444FF',
                    'mountain_hiking', '#44FF44',
                    'demanding_mountain_hiking', '#FFFF44',
                    'alpine_hiking', '#FFA500',
                    'demanding_alpine_hiking', '#FF4444',
                    'difficult_alpine_hiking', '#FF0000',
                    '#4444FF'
                ],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2,
                'text-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15, 0,
                    16, 1
                ],
                'text-opacity-transition': {
                    'duration': 2000,
                    'delay': 0
                }
            }
        });

        map.addLayer({
            'id': 'hiking-routes',
            'type': 'line',
            'source': 'thunderforest-outdoors',
            'source-layer': 'hiking',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'visible',
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#FF4444',
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 1,
                    16, 3
                ],
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15, 0,
                    17, 1
                ],
                'line-opacity-transition': {
                    'duration': 2000,
                    'delay': 0
                }
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
                        map.addImage(iconName, ctx.getImageData(0, 0, size, size));
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn(`Failed to load icon: ${iconName}`);
                        resolve(); // Resolve anyway to continue loading other icons
                    };
                    img.src = `/${iconName}.png`; // Adjust path as needed
                })
            )
        );

        // Add the POI layer with icons
        map.addLayer({
            'id': 'poisth',
            'type': 'symbol',
            'source': 'thunderforest-outdoors',
            'source-layer': 'poi-label',
            'minzoom': 14,
            'filter': ['all',
                distanceFilter,
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
            ],
            'layout': {
                'visibility': 'visible',
                'icon-image': [
                    'match',
                    ['get', 'feature'],
                    'peak', 'peak',
                    'alpine_hut', 'shelter',
                    'shelter', 'shelter',
                    'viewpoint', 'viewpoint',
                    'saddle', 'saddle',
                    'spring', 'eau',
                    'cave', 'cave',
                    'camp_site', 'camp_site',
                    'picnic_site', 'picnic_site',
                    'information', 'information',
                    'guidepost', 'guidepost',
                    'parking', 'parking',
                    'water_point', 'water_point',
                    'alpine_hut'
                ],
                'icon-size': 1.4,
                'icon-allow-overlap': false,
                'icon-offset': [0, -10],
                'text-field': [
                    'case',
                    ['match',
                        ['get', 'feature'],
                        [
                            'spring', 
                            'water_point', 
                            'information',
                            'parking',
                            'viewpoint',
                            'picnic_site',
                            'camp_site'
                        ],
                        true,
                        false
                    ],
                    '',  // No text for matched features
                    ['get', 'name']  // Show text for everything else
                ],
                'text-font': ['Noto Sans Regular'],
                'text-size': 12,
                'text-offset': [0, 1],
                'text-anchor': 'top'
            },
            'paint': {
                'icon-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    13, ['match',
                        ['get', 'feature'],
                        'peak', 0,
                        0  // Everything starts hidden
                    ],
                    14, ['match',
                        ['get', 'feature'],
                        'peak', 1,  // Peaks fade in at 14
                        0   // Everything else stays hidden
                    ],
                    15, ['match',
                        ['get', 'feature'],
                        'peak', 1,
                        ['spring', 'water_point'], 1,  // Water sources fade in at 15
                        0   // Everything else stays hidden
                    ],
                    16, ['match',
                        ['get', 'feature'],
                        ['peak', 'spring', 'water_point'], 1,
                        0   // Start fading in everything else
                    ],
                    17, 1  // Everything fully visible
                ],
                'icon-opacity-transition': {
                    'duration': 2000,
                    'delay': 0
                },
                'text-color': [
                    'match',
                    ['get', 'feature'],
                    'peak', '#FF4444',
                    'alpine_hut', '#4444FF',
                    'shelter', '#44FF44',
                    'viewpoint', '#FF8C00',
                    'saddle', '#8B4513',
                    'spring', '#4682B4',
                    'cave', '#8B4513',
                    'camp_site', '#228B22',
                    'picnic_site', '#32CD32',
                    'information', '#4B0082',
                    'guidepost', '#DAA520',
                    'parking', '#4444FF',
                    'water_point', '#4682B4',
                    '#000000'
                ],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
            }
        });

        map.addLayer({
            'id': 'thunderforest-parking',
            'type': 'fill',
            'source': 'thunderforest-outdoors',
            'source-layer': 'landuse',
            'filter': ['all', ['==', ['get', 'type'], 'parking'], distanceFilter],
            'layout': { 'visibility': 'visible' },
            'paint': {
                'fill-color': '#4444FF',
                'fill-opacity': 0.5,
                'fill-outline-color': '#2222FF'
            }
        }, 'refuges-layer');

        map.addLayer({
            'id': 'thunderforest-roads',
            'type': 'line',
            'source': 'thunderforest-outdoors',
            'source-layer': 'road',
            'filter': distanceFilter,
            'layout': {
                'visibility': 'visible',
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': [
                    'match',
                    ['get', 'highway'],
                    'motorway', '#FF4444',
                    'trunk', '#FF8C00',
                    'primary', '#FFA500',
                    'secondary', '#FFD700',
                    'tertiary', '#FFEB3B',
                    '#FFFFFF'
                ],
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 1,
                    16, 4
                ],
                'line-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15, 0,
                    16, 1
                ],
                'line-opacity-transition': {
                    'duration': 2000,
                    'delay': 0
                }
            }
        }, 'refuges-layer');

        map.addLayer({
            'id': 'thunderforest-lakes',
            'type': 'fill',
            'source': 'thunderforest-outdoors',
            'source-layer': 'water',
            'filter': ['all', ['==', ['get', 'type'], 'water'], distanceFilter],
            'layout': { 'visibility': 'visible' },
            'paint': {
                'fill-color': '#4682B4',
                'fill-opacity': 1.0,
                'fill-translate': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, ['literal', [0, 0]],
                    18, ['literal', [100, 100]]
                ],
                'fill-pattern': {
                    'property': 'type',
                    'type': 'categorical',
                    'stops': [
                        ['water', 'water_texture']
                    ]
                }
            }
        });

        // Water texture setup
        const waterTextureImage = new Image();
        waterTextureImage.onload = () => {
            map.addImage('water_texture', waterTextureImage);
        };
        waterTextureImage.src = 'water_texture.webp';

        map.addImage('waterTextureImage', {
            width: 256,
            height: 256,
            data: getWaterTexture()
        });

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

// =====================
// Tree Canopy Layer
// =====================

function rgbToHeight(r, g, b) {
    // The tree canopy tiles use a color scale where 
    // dark purple (128, 0, 128) represents 0m and 
    // bright green (0, 255, 0) represents 30m.

    // Normalize the color channels
    const rNorm = r / 255;
    const gNorm = g / 255; 
    const bNorm = b / 255;

    // Calculate the distance in color space from purple to green
    const purpleDistance = Math.sqrt(
        Math.pow(rNorm - 128/255, 2) + 
        Math.pow(gNorm - 0/255, 2) + 
        Math.pow(bNorm - 128/255, 2)
    );
    const greenDistance = Math.sqrt(
        Math.pow(rNorm - 0/255, 2) + 
        Math.pow(gNorm - 255/255, 2) + 
        Math.pow(bNorm - 0/255, 2)
    );

    // Interpolate the height based on the color distances
    const totalDistance = purpleDistance + greenDistance;
    const heightFraction = greenDistance / totalDistance;
    return heightFraction * 30;  
}
const treeDemProtocol = {
    transformRequest: (url, resourceType) => {
        return { url: url.replace('tree-dem://', 'https://') };
    },
    transformTile: (data, width, height) => {
        // Convert the colormap PNG data to terrain-rgb format
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, width, height);

            // Convert colormap to height values
            const terrainData = new Uint8Array(width * height * 4);
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1]; 
                const b = imageData.data[i + 2];
                const height = rgbToHeight(r, g, b);
                
                // Encode height into RGBA format
                const rgbHeight = height * 10;
                terrainData[i] = rgbHeight & 0xff;
                terrainData[i + 1] = (rgbHeight >> 8) & 0xff;
                terrainData[i + 2] = (rgbHeight >> 16) & 0xff;
                terrainData[i + 3] = 0xff;
            }

            return Promise.resolve(terrainData.buffer);
        };
        
        img.src = URL.createObjectURL(new Blob([data]));
    }
};
// Register the protocol
maplibregl.addProtocol('tree-dem', treeDemProtocol);
// =====================
// Wikimedia Layers
// =====================

let wikimediaInitialized = false;
// =====================
// Map Initialization and Event Handlers
// =====================
map.on('load', async () => {
    // Layer control setup
    const layerControl = document.querySelector('.layer-control');
    const refugeControl = document.createElement('label');
    refugeControl.innerHTML = '<input type="checkbox" id="refuges-checkbox" checked> Points of Interest';
    layerControl.appendChild(refugeControl);

    // Icon configuration
    const iconNames = {
    cabane: '../../assets/images/markers/shelter.png',
    refuge: '../../assets/images/markers/shelter.png',
    gite: '../../assets/images/markers/shelter.png',
    pt_eau: '../../assets/images/markers/eau.png',
    sommet: '../../assets/images/markers/summit.png',
    pt_passage: '../../assets/images/markers/summit.png',
    bivouac: '../../assets/images/markers/bivouac.png',
    lac: '../../assets/images/ui/lago.png'
    };

    // Icon Loading Function
const loadIcon = (iconName, iconPath) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            map.addImage(iconName, ctx.getImageData(0, 0, img.width, img.height));
            resolve();
        };

        img.onerror = () => {
            console.warn(`Failed to load icon: ${iconName}`);
            // Create fallback circle icon
            const size = 32;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/3, 0, Math.PI * 2);
            let fillColor = '#f5a442'; // Default orange

            switch(iconName) {
                case 'pt_eau': fillColor = '#4287f5'; break;
                case 'sommet':
                case 'pt_passage': fillColor = '#ff4444'; break;
                case 'refuge':
                case 'cabane':
                case 'gite': fillColor = '#42f554'; break;
                case 'lac': fillColor = '#4682B4'; break;
                case 'bivouac': fillColor = '#f5a442'; break;
            }
            
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            map.addImage(iconName, ctx.getImageData(0, 0, size, size));
            resolve();
        };

        img.src = iconPath;
    });
};

    // Load all icons
    try {
        await Promise.all(
            Object.entries(iconNames).map(([iconName, iconPath]) => 
                loadIcon(iconName, iconPath)
            )
        );
    } catch (error) {
        console.error('Error in icon loading:', error);
    }

     // Add Wikimedia source and layers only once
    if (!map.getSource('wikimedia')) {
      map.addSource('wikimedia', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        },
        cluster: false,
        clusterMaxZoom: 14,
        clusterRadius: 30
      });

       map.addLayer({
            id: 'wikimedia-photos',
            type: 'circle',
            source: 'wikimedia',
            filter: ['!', ['has', 'point_count']],
            paint: {
                'circle-color': '#4287f5',
                'circle-radius': 8,
                'circle-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16, 0,
                    18, 1.0
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
                'circle-stroke-opacity': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    16, 0,
                    18, 1.0
                ]
            }
        });
    }

    // Add layer
    map.addLayer({
        'id': 'refuges-layer',
        'type': 'symbol',
        'source': 'refuges',
        'layout': {
            'icon-image': [
                'case',
                ['has', 'photoId'], ['get', 'photoId'],
                ['match',
                    ['to-string', ['get', 'valeur', ['get', 'type']]],
                    'cabane non gardée', 'cabane',
                    'refuge gardé', 'refuge',
                    "gîte d'étape", 'gite',
                    "point d'eau", 'pt_eau',
                    'sommet', 'sommet',
                    'point de passage', 'pt_passage',
                    'bivouac', 'bivouac',
                    'lac', 'lac',
                    'cabane'
                ]
            ],
            'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 0.1,
                15, 0.5
            ],
            'icon-allow-overlap': true,
            'icon-anchor': 'bottom',
            'text-field': ['get', 'nom'],
            'text-font': ['Noto Sans Regular'],
            'text-offset': [0, 0.5],
            'text-anchor': 'top',
            'text-size': 12,
            'text-rotation-alignment': 'viewport',
            'icon-rotation-alignment': 'viewport'
        },
        'paint': {
            'text-color': '#000',
            'text-halo-color': '#fff',
            'text-halo-width': 2
        }
    });
    // Create popup
    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: 'none'
    });

    // Event Handlers
     map.on('click', 'refuges-layer', (e) => {
        if (e.features.length > 0) {
            const coordinates = e.features[0].geometry.coordinates.slice();
            const properties = e.features[0].properties;
            createPointPopup(coordinates, properties);
        }
    });

    // Add missing style handler
    map.on('styleimagemissing', (e) => {
        const id = e.id;
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(size/2, size/2, size/3, 0, Math.PI * 2);
        let fillColor = '#f5a442'; // Default orange

        if (id === 'pt_eau') fillColor = '#4287f5';
        else if (id === 'sommet' || id === 'pt_passage') fillColor = '#ff4444';
        else if (id === 'refuge' || id === 'cabane' || id === 'gite') fillColor = '#42f554';
        else if (id === 'lac') fillColor = '#4682B4';
        else if (id === 'bivouac') fillColor = '#f5a442';

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        map.addImage(id, ctx.getImageData(0, 0, size, size));
    });

    // Remove mouseleave event
    map.off('mouseleave', 'refuges-layer');

    // Add event listeners
    document.getElementById('refuges-checkbox').addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
        map.setLayoutProperty('refuges-layer', 'visibility', visibility);
    });
     // Then, after your existing layer control setup, add the Wikimedia control:
    const wikimediaControl = document.createElement('label');
    wikimediaControl.innerHTML = '<input type="checkbox" id="wikimedia-checkbox" checked> Wikimedia Photos';
    layerControl.appendChild(wikimediaControl);

    // Add Wikimedia toggle event listener
    document.getElementById('wikimedia-checkbox').addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
         map.setLayoutProperty('wikimedia-photos', 'visibility', visibility);
    });
    
        map.on('click', 'wikimedia-photos', async (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                const title = feature.properties.url;
                const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=300`;
                const wikiUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title.replace('File:', ''))}`;
        
        // Show loading popup first
                const popup = new maplibregl.Popup()
                    .setLngLat(feature.geometry.coordinates)
                    .setHTML(`
                        <div style="max-width: 300px;">
                            <p>Loading photo details...</p>
                        </div>
                    `)
                    .addTo(map);

                // Fetch metadata
                const metadata = await fetchPhotoMetadata(title);
                
                if (metadata) {
                    // Update popup with full information
                    popup.setHTML(`
                        <div style="max-width: 300px;">
                            <img src="${imgUrl}" style="width: 100%; height: auto;" alt="${title}">
                            <div style="margin-top: 10px; font-size: 0.9em;">
                                <p style="margin: 5px 0;"><strong>Author:</strong> ${metadata.author}</p>
                                <p style="margin: 5px 0;"><strong>License:</strong> ${metadata.license}</p>
                                <p style="margin: 5px 0;"><strong>Uploaded:</strong> ${metadata.dateUploaded}</p>
                                ${metadata.description ? `<p style="margin: 5px 0;"><strong>Description:</strong> ${metadata.description}</p>` : ''}
                                ${metadata.creditLine ? `<p style="margin: 5px 0;"><strong>Credit:</strong> ${metadata.creditLine}</p>` : ''}
                            </div>
                            <a href="${wikiUrl}" target="_blank" style="display: block; margin-top: 10px;">View on Wikimedia Commons</a>
                        </div>
                    `);
                }
            }
        });

        // Add cursor styling
        map.on('mouseenter', 'wikimedia-photos', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'wikimedia-photos', () => {
            map.getCanvas().style.cursor = '';
        });

    // Add cleanup
    window.addEventListener('unload', () => {
        photoCache.clear();
        processedFeatures.clear();
    });
       
    // Add throttled fetch to your existing moveend handler
    const throttledFetchAll = throttle(() => {
        fetchPointsOfInterest(map);
        fetchWikimediaPhotos();
    }, THROTTLE_DELAY);

    // Initialize fetching
    fetchWikimediaPhotos();
        // Call this after the map and source are loaded
       map.once('idle', inspectPOIs);

       map.on('moveend', throttledFetchAll);

       console.log('Map loaded, initializing Thunderforest...');
       try {
            await initializeThunderforestLayers();
            console.log('Thunderforest initialization successful');
       } catch (error) {
           console.error('Failed to initialize Thunderforest:', error);
        }
});
    
function inspectPOIs() {
   const features = map.querySourceFeatures('thunderforest-outdoors', {
        sourceLayer: 'poi-label'
    });
}

// =====================
// Worker and Cache setup
// =====================
// Setup MapLibre protocol
demSource.setupMaplibre(maplibregl);
// Caches for generated terrain-rgb tiles
const terrainCache = new Map();
const pendingTiles = new Map();

// Constants
const DEM_TILE_CACHE_LIMIT = 6000;
const QUEUE_LIMIT = 200;
const MAX_CONCURRENT_FETCHES = 200;

// Worker Pool Implementation
   const workerPool = {
   workers: [],
   maxWorkers: navigator.hardwareConcurrency || 10,
   nextWorker: 0,
   busy: [],
   queue: [],
   queueLimit: QUEUE_LIMIT,
   lastMapState: { bearing: 0, pitch: 0 },

   initialize() {
       for (let i = 0; i < this.maxWorkers; i++) {
           const worker = new Worker('worker_maplibre.js');
           this.workers.push(worker);
           this.busy.push(false);
           worker.onmessage = this.createMessageHandler(i);
           worker.onerror = this.createErrorHandler(i);
       }
   },

    createMessageHandler(index) {
        return (e) => {
            this.busy[index] = false;
            if (e.data.type === 'demTile') {
                const { z, x, y, pngBlob, duration } = e.data.data;
                const tileKey = `${z}/${x}/${y}`;
                const priority = this.calculatePriority(z, x, y);
                
                if (pendingTiles.has(tileKey)) {
                    pendingTiles.get(tileKey).resolve(pngBlob);
                    pendingTiles.delete(tileKey);
                    this.preloadAdjacentTiles(z, x, y);
                }
            }
            this.processQueue();
        };
    },

   createErrorHandler(index) {
       return (e) => {
           this.busy[index] = false;
           console.error(`Worker ${index} error:`, e);
           this.processQueue();
       };
   },

   getAvailableWorker() {
       const index = this.busy.findIndex(b => !b);
       if (index !== -1) {
           this.busy[index] = true;
           return this.workers[index];
       }
       return null;
   },

calculatePriority(z, x, y) {
    // Current factors:
    let priority = Math.min(19 - z, 10);  // Base priority from zoom level
    
    // Get current map state
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    const center = map.getCenter();
    
    // Calculate tile position relative to view
    const tileLat = this.tile2lat(y + 0.5, z);
    const tileLon = (x / Math.pow(2, z)) * 360 - 180;
    
    // Distance from center
    const dy = tileLat - center.lat;
    const dx = tileLon - center.lng;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Viewing angle calculations
    const tileAngle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const viewingAngle = (bearing + 360) % 360;
    const angleDiff = Math.abs(tileAngle - viewingAngle);

    // Enhanced priority calculations
    
    // 1. View Direction Bonus (more detailed for tiles we're looking at)
    if (angleDiff < 30) priority += 3;
    else if (angleDiff < 60) priority += 2;
    else if (angleDiff < 90) priority += 1;

    // 2. Distance Penalty (lower priority for far tiles)
    const distancePenalty = Math.min(distance * 0.5, 2);
    priority -= distancePenalty;

    // 3. Pitch Bonus (higher priority for tiles in front when pitched)
    if (pitch > 45 && angleDiff < 90) {
        priority += (pitch - 45) / 45 * 2;  // Up to +2 bonus at max pitch
    }

    // 4. Movement Prediction
    if (this.lastMapState) {
        const bearingDelta = Math.abs(bearing - this.lastMapState.bearing);
        if (bearingDelta > 2) {  // If rotating
            // Predict next view direction and boost those tiles
            const predictedAngle = (bearing + bearingDelta) % 360;
            const predictedAngleDiff = Math.abs(tileAngle - predictedAngle);
            if (predictedAngleDiff < 45) priority += 1;
        }
    }

    // 5. Cache Status Factor
    const tileKey = `${z}/${x}/${y}`;
    if (!terrainCache.has(tileKey) && !pendingTiles.has(tileKey)) {
        priority += 0.5;  // Slight boost for uncached tiles
    }

    // 6. Zoom Level Transitions
    const currentZoom = map.getZoom();
    const zoomDiff = Math.abs(z - currentZoom);
    if (zoomDiff < 1) priority += 1;  // Boost tiles at current zoom level

    // Keep priority in reasonable bounds
    return Math.max(0, Math.min(priority, 15));
},

   tile2lat(y, z) {
       const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
       return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
   },

   reprioritizeQueue() {
       this.queue = this.queue.map(item => ({
           ...item,
           priority: this.calculatePriority(
               item.data.zoom,
               item.data.x,
               item.data.y
           )
       })).sort((a, b) => b.priority - a.priority);
   },

   addToQueue(data, priority = 0) {
       const queueItem = { 
           data, 
           priority: priority || this.calculatePriority(data.zoom, data.x, data.y),
           timestamp: Date.now() 
       };
       
       this.queue.push(queueItem);
       
       if (this.queue.length > this.queueLimit) {
           this.queue.sort((a, b) => {
               if (a.priority !== b.priority) return b.priority - a.priority;
               return a.timestamp - b.timestamp;
           });
           this.queue = this.queue.slice(0, this.queueLimit);
       }
       
       this.processQueue();
   },

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
    },

    preloadAdjacentTiles(z, x, y) {
        const adjacent = [
            {x: x-1, y: y, p: 1}, {x: x+1, y: y, p: 1},
            {x: x, y: y-1, p: 1}, {x: x, y: y+1, p: 1},
            {x: x-1, y: y-1, p: 0.5}, {x: x+1, y: y-1, p: 0.5},
            {x: x-1, y: y+1, p: 0.5}, {x: x+1, y: y+1, p: 0.5}
        ];
        
        adjacent.forEach(tile => {
            const tileKey = `${z}/${tile.x}/${tile.y}`;
            if (!terrainCache.has(tileKey) && !pendingTiles.has(tileKey)) {
                this.addToQueue({ zoom: z, x: tile.x, y: tile.y }, tile.p * this.calculatePriority(z, tile.x, tile.y));
            }
        });
    },

   postMessage(data) {
       const worker = this.getAvailableWorker();
       if (worker) {
           worker.postMessage(data);
           return true;
       }
       this.addToQueue(data);
       return true;
   },

   terminate() {
       this.workers.forEach(worker => worker.terminate());
       this.workers = [];
       this.busy = [];
       this.queue = [];
   }
};

map.on('move', () => {
    workerPool.lastMapState = {
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        zoom: map.getZoom(),
        center: map.getCenter()
    };
});

// Modified fetch interceptor
const originalFetch = window.fetch;
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
        const contourTileMatch = pathname.match(/\/contours_(\d+)_(\d+)_(\d+)\.pbf$/);

        if (terrainTileMatch) {
            const [_, z, x, y] = terrainTileMatch.map(Number);
            const tileKey = `${z}/${x}/${y}`;

            if (terrainCache.has(tileKey)) {
                return new Response(terrainCache.get(tileKey), { 
                    headers: { 'Content-Type': 'image/png' } 
                });
            }

            if (pendingTiles.has(tileKey)) {
                return pendingTiles.get(tileKey).promise
                    .then(blob => new Response(blob, { headers: { 'Content-Type': 'image/png' } }))
                    .catch(() => originalFetch(input, options));
            }

            const { promise, resolve, reject } = await new Promise((res) => {
                let resolveTile, rejectTile;
                const tilePromise = new Promise((resolve, reject) => {
                    resolveTile = resolve;
                    rejectTile = reject;
                });
                res({ promise: tilePromise, resolve: resolveTile, reject: rejectTile });
            });

            pendingTiles.set(tileKey, { resolve, reject, promise });
            
            if (!workerPool.postMessage({ zoom: z, x: x, y: y })) {
                reject(new Error('No workers available'));
                return originalFetch(input, options);
            }

            try {
                const blob = await promise;
                if (terrainCache.size >= DEM_TILE_CACHE_LIMIT) {
                    const oldestKey = terrainCache.keys().next().value;
                    terrainCache.delete(oldestKey);
                }
                terrainCache.set(tileKey, blob);
                return new Response(blob, { headers: { 'Content-Type': 'image/png' } });
            } catch (error) {
                return originalFetch(input, options);
            }
        }

        return originalFetch(input, options);
    } catch (error) {
        return originalFetch(input, options);
    }
};

// Initialize the worker pool
workerPool.initialize();

// Clean up when page unloads
window.addEventListener('unload', () => {
    workerPool.terminate();
});


// Menu toggle functionality
const menuToggle = document.querySelector('.menu-toggle');
let isMenuVisible = false;

menuToggle.addEventListener('click', () => {
    isMenuVisible = !isMenuVisible;
    document.querySelector('.layer-control').classList.toggle('visible');
    menuToggle.classList.toggle('active');
});

// Close menu when clicking outside
map.on('click', () => {
    if (isMenuVisible) {
        isMenuVisible = false;
        document.querySelector('.layer-control').classList.remove('visible');
        menuToggle.classList.remove('active');
    }
});

// Prevent map click when clicking on controls
document.querySelector('.layer-control').addEventListener('click', (e) => {
    e.stopPropagation();
});   

// Add Navigation Control
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

// Layer Control UI Functionality
function toggleLayer(layerId, checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', checkbox.checked ? 'visible' : 'none');
    }
}

// Add a control panel section for Sentinel-2 layer adjustments
const layerControl = document.querySelector('.layer-control');
const sentinel2Controls = document.createElement('div');
sentinel2Controls.innerHTML = `
    <strong>Sentinel-2 Controls</strong>
    <label>Opacity: 
        <input type="range" id="sentinel-opacity" min="0" max="1" step="0.1" value="0.7">
        <span id="opacity-value">0.7</span>
    </label>
    <label>Contrast: 
        <input type="range" id="sentinel-contrast" min="-1" max="1" step="0.1" value="0.2">
        <span id="contrast-value">0.2</span>
    </label>
    <label>Saturation: 
        <input type="range" id="sentinel-saturation" min="-1" max="1" step="0.1" value="0.1">
        <span id="saturation-value">0.1</span>
    </label>
`;
layerControl.appendChild(sentinel2Controls);

// Event Listeners
document.getElementById('orthophotos-checkbox').addEventListener('change', () => {
    toggleLayer('orthophotos-layer', 'orthophotos-checkbox');
});

document.getElementById('snow-checkbox').addEventListener('change', () => {
    toggleLayer('Snow-layer', 'snow-checkbox');
});

document.getElementById('planIGN-checkbox').addEventListener('change', () => {
    toggleLayer('planIGN-layer', 'planIGN-checkbox');
});

// Add event listeners for the controls
document.getElementById('sentinel-opacity').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    map.setPaintProperty('sentinel2-layer', 'raster-opacity', value);
    document.getElementById('opacity-value').textContent = value.toFixed(1);
});

document.getElementById('sentinel-contrast').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    map.setPaintProperty('sentinel2-layer', 'raster-contrast', value);
    document.getElementById('contrast-value').textContent = value.toFixed(1);
});

document.getElementById('sentinel-saturation').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    map.setPaintProperty('sentinel2-layer', 'raster-saturation', value);
    document.getElementById('saturation-value').textContent = value.toFixed(1);
});

// Update the existing sentinel2 checkbox event listener to show/hide controls
document.getElementById('sentinel2-checkbox').addEventListener('change', (e) => {
    toggleLayer('sentinel2-layer', 'sentinel2-checkbox');
    sentinel2Controls.style.display = e.target.checked ? 'block' : 'none';
});

// Initially hide the controls
sentinel2Controls.style.display = 'none';
document.getElementById('buildings-checkbox').addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    map.setLayoutProperty('3d-buildings', 'visibility', visibility);
});
document.getElementById('contours-checkbox').addEventListener('change', (e) => {
const visibility = e.target.checked ? 'visible' : 'none';
map.setLayoutProperty('contours', 'visibility', visibility);
map.setLayoutProperty('contour-text', 'visibility', visibility);
});
document.getElementById('hd-terrain-checkbox').addEventListener('change', (e) => {
    const isHD = e.target.checked;
    const loading = document.getElementById('loading');
    
    loading.style.display = 'block';

    // Update terrain source
    map.setTerrain({
        source: isHD ? 'terrain-source' : 'dem',
        exaggeration: 1.0
    });

    // Remove and re-add the hillshade layer with the new source
    if (map.getLayer('hillshade-layer')) {
        map.removeLayer('hillshade-layer');
    }

    // Add hillshade layer back with the new source
    map.addLayer({
        id: 'hillshade-layer',
        type: 'hillshade',
        source: isHD ? 'terrain-source' : 'dem',
        layout: {visibility: 'visible'},
        paint: {
                'hillshade-exaggeration': 0.15,
                'hillshade-illumination-anchor':'map',
                'hillshade-illumination-direction':280
            }
    });

    map.once('idle', () => {
        loading.style.display = 'none';
    });
});

export {map};
