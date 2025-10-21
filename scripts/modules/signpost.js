import { map } from '../main/app.js';
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

            return Object.prototype.hasOwnProperty.call(POI_PRIORITIES,feature);
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

export { processOsmData, getOverpassQuery };