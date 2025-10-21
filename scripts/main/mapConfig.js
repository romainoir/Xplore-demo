import { layerStyles } from '../modules/layers.js';
import { setupTerrainProtocol, setupMapterhornProtocol } from '../modules/terrain/terrainprotocol.js';

const CONTOUR_PROTOCOL_BASE_OPTIONS = {
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
};

const contourDemSources = {
    'dem': new mlcontour.DemSource({
        url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        encoding: 'terrarium',
        maxzoom: 14,
        worker: false
    }),
    'mapterhorn-dem': new mlcontour.DemSource({
        url: 'mapterhorn://{z}/{x}/{y}',
        encoding: 'terrarium',
        maxzoom: 14,
        worker: false
    }),
    'custom-dem': new mlcontour.DemSource({
        url: 'customdem://{z}/{x}/{y}',
        encoding: 'mapbox',
        maxzoom: 17,
        worker: false
    })
};

function getContourDemSource(terrainId) {
    return contourDemSources[terrainId] || contourDemSources['dem'];
}

export function getContourTileUrl(terrainId) {
    return getContourDemSource(terrainId).contourProtocolUrl(CONTOUR_PROTOCOL_BASE_OPTIONS);
}

function createMapSources() {
    return {
        'custom-dem': {
            type: 'raster-dem',
            encoding: 'mapbox',
            tiles: ['customdem://{z}/{x}/{y}'],
            tileSize: 256,
            maxzoom: 17
        },
        'custom-normal': {
            type: 'raster',
            tiles: ['customdem://{z}/{x}/{y}/normal'],
            tileSize: 256,
            maxzoom: 17
        },
        'custom-slope': {
            type: 'raster',
            tiles: ['customdem://{z}/{x}/{y}/slope'],
            tileSize: 256,
            maxzoom: 17
        },
        'mapterhorn-dem': {
            type: 'raster-dem',
            encoding: 'terrarium',
            tiles: ['mapterhorn://{z}/{x}/{y}'],
            tileSize: 512,
            maxzoom: 14,
            attribution: '© Mapterhorn'
        },
        'custom-aspect': {
            type: 'raster',
            tiles: ['customdem://{z}/{x}/{y}/aspect'],
            tileSize: 256,
            maxzoom: 17
        },
        'dem': {
            type: 'raster-dem',
            encoding: 'terrarium',
            tiles: [getContourDemSource('dem').sharedDemProtocolUrl],
            maxzoom: 14,
            tileSize: 256
        },
        'contours': {
            type: 'vector',
            tiles: [getContourTileUrl('dem')],
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
                'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'
            ],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: '© IGN/Geoportail'
        },
        'sentinel2': {
            type: 'raster',
            tiles: [
                'https://sh.dataspace.copernicus.eu/ogc/wms/7e15b662-449e-44ff-9f1b-28386c82867c?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=TRUE_COLOR&TILED=true&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX={bbox-epsg-3857}'
            ],
            tileSize: 256,
            attribution: '© Copernicus'
        },
        'heatmap': {
            type: 'raster',
            tiles: [
                ' https://proxy.nakarte.me/https/content-a.strava.com/identified/globalheat/all/hot/{z}/{x}/{y}.png?v=19'
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
    };
}

function createMapLayers() {
    return [
        layerStyles.baseColor,
        layerStyles.orthophotosLayer,
        layerStyles.OpentopoLayer,
        layerStyles.sentinel2Layer,
        layerStyles.contours,
        layerStyles.contourText,
        layerStyles.hillshadeLayerTerrarium,
        layerStyles.hillshadeLayer,
        layerStyles.hillshadeLayerMapterhorn,
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
        layerStyles.thunderforestLakes
    ];
}

function createMapStyle() {
    return {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sprite: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/sprite/PlanIgn',
        projection: { type: 'globe' },
        light: {
            anchor: 'viewport',
            color: '#ffffff',
            intensity: 0.3,
            position: [100, 90, 5]
        },
        sources: createMapSources(),
        layers: createMapLayers(),
        terrain: {
            source: 'dem',
            exaggeration: 1.0
        },
        sky: {
            'sky-color': '#87CEEB',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#ffffff',
            'horizon-fog-blend': 0.5,
            'fog-color': '#888888',
            'fog-ground-blend': 0.5,
            'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 1,
                5, 1,
                7, 0
            ]
        }
    };
}

export function initializeMap(maplibregl) {
    return new maplibregl.Map({
        container: 'map',
        canvasContextAttributes: {
            antialias: true,
            contextType: 'webgl2',
            preserveDrawingBuffer: true
        },
        style: createMapStyle(),
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
}

export function setupMapProtocols(maplibregl) {
    Object.values(contourDemSources).forEach(source => source.setupMaplibre(maplibregl));
    setupTerrainProtocol(maplibregl);
    setupMapterhornProtocol(maplibregl);
}
