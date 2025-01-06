// layers.js
import { map } from './app.js';

const layerStyles = {
    baseColor: {
        id: 'baseColor',
        type: 'background',
        paint: {
            'background-color': '#fff',
            'background-opacity': 1.0,
        },
    },
    terrainLow: {
        id: 'terrain-low',
        type: 'hillshade',
        source: 'terrain-low',
        layout: { visibility: 'visible' },
        paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'viewport',
            'hillshade-shadow-color': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11, '#000000',
                12, 'rgba(0,0,0,0)'
            ],
            'hillshade-highlight-color': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11, '#ffffff',
                12, 'rgba(255,255,255,0)'
            ]
        }
    },

    terrainHigh: {
        id: 'terrain-high',
        type: 'hillshade',
        source: 'terrain-high',
        layout: { visibility: 'visible' },
        paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'viewport',
            'hillshade-shadow-color': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11, 'rgba(0,0,0,0)',
                12, '#000000'
            ],
            'hillshade-highlight-color': [
                'interpolate',
                ['linear'],
                ['zoom'],
                11, 'rgba(255,255,255,0)',
                12, '#ffffff'
            ]
        }
    },
    sentinel2Layer: {
        id: 'sentinel2-layer',
        type: 'raster',
        source: 'sentinel2',
        layout: { visibility: 'none' },//will need to handle thta, temporary solution due to lack of credit
        paint: {
            'raster-opacity': 0,
            'raster-contrast': 0.2,
            'raster-saturation': 0.1,
            'raster-resampling': 'linear',
            'raster-fade-duration': 200

        }
    },
    contours: {
        id: 'contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        layout: {
            visibility: 'none',
            'line-join': 'round',
        },
        paint: {
            'line-color': 'rgba(0,0,0, 50%)',
            'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
        },
    },
    contourText: {
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
            'text-font': ['Noto Sans Regular'],
        },
        paint: {
            'text-halo-color': 'white',
            'text-halo-width': 1,
        },
        filter: ['>', ['get', 'level'], 0],
    },
    snowLayer: {
        id: 'Snow-layer',
        type: 'raster',
        source: 'snowDepth',
        minzoom: 0,
        maxzoom: 20,
        layout: { visibility: 'none' },
    },
    orthophotosLayer: {
        id: 'orthophotos-layer',
        type: 'raster',
        source: 'orthophotos',
        minzoom: 0,
        maxzoom: 19,
        layout: { visibility: 'visible' },
    },
    planIGNLayer: {
        id: 'planIGN-layer',
        type: 'raster',
        source: 'planIGN',
        minzoom: 0,
        maxzoom: 18,
        layout: { visibility: 'none' },
    },
    OpentopoLayer: {
        id: 'Opentopo-layer',
        type: 'raster',
        source: 'OpenTopo',
        minzoom: 0,
        maxzoom: 19,
        layout: { visibility: 'none' },
    },
    SlopeLayer: {
        id: 'Slope-layer',
        type: 'raster',
        source: 'Slope',
        minzoom: 0,
        maxzoom: 16,
        layout: { visibility: 'none' },
        paint: {
            'raster-opacity': 0.8},
    },
    HeatmapLayer: {
        id: 'heatmap-layer',
        type: 'raster',
        source: 'heatmap',
        minzoom: 6,
        maxzoom: 18,
        layout: { visibility: 'none' },
    },
    hillshadeLayer: {
        id: 'hillshade-layer',
        type: 'hillshade',
        source: 'terrain-low',
        layout: { visibility: 'visible' },
        paint: {
            'hillshade-exaggeration': 0.3,
            'hillshade-illumination-anchor': 'map',
            'hillshade-illumination-direction': 80,
        },
    },
    buildings3D: {
        id: '3d-buildings',
        source: 'buildings',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
            'fill-extrusion-color': '#F5F5DC',
            'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['zoom'],
                15, 0,
                16, ['get', 'render_height'],
            ],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.9,
        },
    },

  /* treeDemHillshade: {
    id: 'tree-dem-hillshade',
    type: 'hillshade',
    source: 'tree-dem',
    layout: { visibility: 'visible' },
    paint: {
      'hillshade-exaggeration': 0.1,
      'hillshade-illumination-anchor': 'map',
      'hillshade-illumination-direction': 280,
    },
  },*/
  refugesLayer: {
    id: 'refuges-layer',
    type: 'symbol',
    source: 'refuges',
    layout: {
      'icon-image': [
        'case',
        ['has', 'photoId'],
        ['get', 'photoId'],
        [
          'match',
          ['to-string', ['get', 'valeur', ['get', 'type']]],
          'cabane non gardée',
          'cabane',
          'refuge gardé',
          'refuge',
          "gîte d'étape",
          'gite',
          "point d'eau",
          'pt_eau',
          'sommet',
          'sommet',
          'point de passage',
          'pt_passage',
          'bivouac',
          'bivouac',
          'lac',
          'lac',
          'cabane',
        ],
      ],
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        0.1,
        15,
        0.5,
      ],
      'icon-allow-overlap': true,
      'icon-anchor': 'bottom',
      'text-field': ['get', 'nom'],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 0.5],
      'text-anchor': 'top',
      'text-size': 12,
      'text-rotation-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: {
      'text-color': '#000',
      'text-halo-color': '#fff',
      'text-halo-width': 2,
    },
  },
  wikimediaPhotos: {
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
        16,
        0,
        18,
        1.0,
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-stroke-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        16,
        0,
        18,
        1.0,
      ],
    },
  },
     pathsHitArea: {
        'id': 'paths-hit-area',
        'type': 'line',
        'source': 'thunderforest-outdoors',
        'source-layer': 'path',
        'layout': {
            'visibility': 'none',
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#000000',
            'line-width': 20,
            'line-opacity': 0
        }
    },
    pathsOutline: {
        'id': 'paths-outline',
        'type': 'line',
        'source': 'thunderforest-outdoors',
        'source-layer': 'path',
        'layout': {
            'visibility': 'none',
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
    },
    paths: {
        'id': 'paths',
        'type': 'line',
        'source': 'thunderforest-outdoors',
        'source-layer': 'path',
        'layout': {
            'visibility': 'none',
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
    },
    pathDifficultyMarkers: {
        'id': 'path-difficulty-markers',
        'type': 'symbol',
        'source': 'thunderforest-outdoors',
        'source-layer': 'path',
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
    },
    hikingRoutes: {
        'id': 'hiking-routes',
        'type': 'line',
        'source': 'thunderforest-outdoors',
        'source-layer': 'hiking',
        'layout': {
            'visibility': 'none',
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
    },
    poisth: {
        'id': 'poisth',
        'type': 'symbol',
        'source': 'thunderforest-outdoors',
        'source-layer': 'poi-label',
        'minzoom': 14,
        'layout': {
            'visibility': 'none',
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
    },
  thunderforestParking: {
      'id': 'thunderforest-parking',
      'type': 'fill',
      'source': 'thunderforest-outdoors',
      'source-layer': 'landuse',
      'layout': { 'visibility': 'none' },
      'paint': {
          'fill-color': '#4444FF',
          'fill-opacity': 0.5,
          'fill-outline-color': '#2222FF'
      }
  },
    thunderforestRoads: {
      'id': 'thunderforest-roads',
      'type': 'line',
      'source': 'thunderforest-outdoors',
      'source-layer': 'road',
      'layout': {
          'visibility': 'none',
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
  },
    thunderforestLakes: {
      'id': 'thunderforest-lakes',
      'type': 'fill',
      'source': 'thunderforest-outdoors',
      'source-layer': 'water',
        'layout': { 'visibility': 'none' },
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
  }
};

// Function to add layers to the map
export function addLayersToMap() {
    for (const key in layerStyles) {
        if (key !== 'thunderforestLakes' && 
            key !== 'thunderforestParking' && 
            key !== 'thunderforestRoads' && 
            key !== 'poisth' && 
            key !== 'hikingRoutes' && 
            key !== 'pathDifficultyMarkers' && 
            key !== 'paths' && 
            key !== 'pathsOutline' && 
            key !== 'pathsHitArea') {
            map.addLayer(layerStyles[key]);
        }
    }
}

export { layerStyles };