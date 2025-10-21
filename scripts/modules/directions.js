// directions.js
export class DirectionsManager {
    constructor(map, uiElements) {
        this.map = map;
        this.waypoints = [];
        this.currentMode = 'foot-hiking';
        this.draggedWaypointIndex = null;
        this.hoveredWaypointIndex = null;
        this.isDragging = false;
       this.hoveredRouteSegment = null; // keep the segment index
         this.closestSegment = null; // closest segment for via
        // Get UI elements
        const [directionsToggle, directionsControl, transportModes, swapButton, clearButton, routeStats, elevationChart] = uiElements;
        this.directionsToggle = directionsToggle;
        this.directionsControl = directionsControl;
        this.transportModes = transportModes;
        this.swapButton = swapButton;
        this.clearButton = clearButton;
        this.routeStats = routeStats;
        this.elevationChart = elevationChart;

        // Colors for different modes
        this.modeColors = {
            'foot-hiking': '#f8b40b',     // orange
            'cycling-regular': '#1bbd14',  // green
            'driving-car': '#193ae1'      // blue
        };

        this.setupRouteLayers();
        this.setupUIHandlers();
        this.setupMapHandlers();
    }

    setupRouteLayers() {
        // Add source for the route
        this.map.addSource('route-line-source', {
            type: 'geojson',
            data: {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: []
                }
            }
        });

         // Add a dedicated source for route segments
        this.map.addSource('route-segments-source', {
            type: 'geojson',
            data: {
                 type: 'FeatureCollection',
                 features: []
            }
         });

        // Add source for distance markers
        this.map.addSource('distance-markers-source', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        // Add route line layer
        this.map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route-line-source',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': this.modeColors[this.currentMode],
                'line-width': 4
            }
        });

         // Add a layer for route segment hover
         this.map.addLayer({
             id: 'route-segment-hover',
            type: 'line',
            source: 'route-segments-source',
            layout: {
                 'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                 'line-color': 'yellow',
                 'line-width': 6,
                 'line-opacity': 0.8
            },
            filter: ['==', 'segmentIndex', -1],
         });

        // Add source for waypoints
        this.map.addSource('waypoints', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        // Add waypoint markers layer (for hit-testing only)
        this.map.addLayer({
            id: 'waypoints-hit-area',
            type: 'circle',
            source: 'waypoints',
            paint: {
                'circle-radius': 12,
                'circle-color': 'transparent',
            },
            filter: ['==', '$type', 'Point']
        });

        // Add waypoint markers layer (for the visual marker)
        this.map.addLayer({
            id: 'waypoints',
            type: 'circle',
            source: 'waypoints',
            paint: {
                'circle-radius': 8,
                'circle-color': '#fff',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#000'
            },
            filter: ['==', '$type', 'Point']
        });
        // Add a layer for route markers (A, B)
        this.map.addLayer({
            id: 'route-markers',
            type: 'symbol',
            source: 'waypoints',
            layout: {
                'symbol-placement': 'point',
                'text-field': ['get', 'title'],
                'text-size': 14,
                'text-offset': [0, 1.5],
            },
            paint: {
                'text-color': '#fff',
            }
        });


        // Add a layer for distance markers along the route
        this.map.addLayer({
            id: 'distance-markers',
            type: 'symbol',
            source: 'distance-markers-source',
            layout: {
                'symbol-placement': 'line',
                'text-field': '{distance}', // Get distance from the properties
                'text-size': 12,
                'text-offset': [0, 1.5], // Adjust as needed
                'symbol-spacing': 100, // adjust spacing
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': this.modeColors[this.currentMode] // Match the route color
            }
        });
        // Add a layer for hover and drag indicator
        this.map.addLayer({
            id: 'waypoint-hover-drag',
            type: 'circle',
            source: 'waypoints',
            paint: {
                'circle-radius': 16,
                'circle-color': 'rgba(255, 255, 0, 0.5)',
                'circle-stroke-width': 2,
                'circle-stroke-color': 'rgba(0, 0, 0, 0.7)'
            },
            filter: ['==', 'index', -1] // initially hide
        });
    }

    setupUIHandlers() {
        // Toggle directions panel
        this.directionsToggle.addEventListener('click', () => {
            this.directionsToggle.classList.toggle('active');
            this.directionsControl.classList.toggle('visible');
        });

        // Handle mode switches
        this.transportModes.forEach(button => {
            button.addEventListener('click', () => {
                const newMode = button.dataset.mode;
                if (newMode === this.currentMode) return;

                this.transportModes.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                this.currentMode = newMode;

                // Update route color
                this.map.setPaintProperty('route-line', 'line-color', this.modeColors[newMode]);

                // Recalculate route if we have waypoints
                if (this.waypoints.length >= 2) {
                    this.getRoute();
                }
            });
        });

        // Swap waypoints
        this.swapButton.addEventListener('click', () => {
            if (this.waypoints.length >= 2) {
                this.waypoints.reverse();
                this.updateWaypoints();
                this.getRoute();
            }
        });

        // Clear route
        this.clearButton.addEventListener('click', () => {
            this.waypoints = [];
            this.updateWaypoints();
            this.clearRoute();
            this.updateStats(null);
            this.updateElevationProfile([]);
            this.draggedWaypointIndex = null;
            this.map.setFilter('waypoint-hover-drag', ['==', 'index', -1]);
        });
    }

    setupMapHandlers() {

        // Mouse down on a waypoint
        this.map.on('mousedown', 'waypoints-hit-area', (e) => {
            if (!this.directionsControl.classList.contains('visible')) return;
            this.isDragging = true;
            this.draggedWaypointIndex = e.features[0].properties.index;
            this.map.setFilter('waypoint-hover-drag', ['==', 'index', this.draggedWaypointIndex]);
            this.map.dragPan.disable(); // Disable map drag
        });


        // Mouse move on map when dragging
        this.map.on('mousemove', (e) => {
            if (!this.directionsControl.classList.contains('visible')) return;

            if (this.isDragging && this.draggedWaypointIndex !== null) {
                // Update position of the dragged point
                this.waypoints[this.draggedWaypointIndex] = [e.lngLat.lng, e.lngLat.lat];
                this.updateWaypoints();
            }
             const features = this.map.queryRenderedFeatures(e.point, { layers: ['waypoints-hit-area'] });
            if (features.length > 0) {
                this.hoveredWaypointIndex = features[0].properties.index;
                this.map.setFilter('waypoint-hover-drag', ['==', 'index', this.hoveredWaypointIndex]);
                 // Reset the hovered route segment if we're over a waypoint
              this.hoveredRouteSegment = null;
                this.closestSegment = null;
                 this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]);
            } else if (this.hoveredWaypointIndex !== null) {
                this.hoveredWaypointIndex = null;
                this.map.setFilter('waypoint-hover-drag', ['==', 'index', -1]);
             }

             // Handle hover over route segments
            this.handleRouteSegmentHover(e);
        });

         // Mouse leave map remove route hover
         this.map.on('mouseleave', (e) => {
            if(this.hoveredRouteSegment !== null)
            {
              this.hoveredRouteSegment = null;
              this.closestSegment = null;
              this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]);
            }
         })

        // Mouse up (stop dragging)
        this.map.on('mouseup', () => {
            if (this.isDragging && this.draggedWaypointIndex !== null) {
                this.isDragging = false;
                this.draggedWaypointIndex = null;
                if (this.waypoints.length >= 2) {
                    this.getRoute();
                }
                this.map.dragPan.enable(); // Re-enable map drag
                this.map.setFilter('waypoint-hover-drag', ['==', 'index', -1]);
            }
        });


        // Click handler to add point on segment or map
        this.map.on('click', (e) => {
            if (!this.directionsControl.classList.contains('visible')) return;
            if (this.isDragging) return;

            const clickCoords = [e.lngLat.lng, e.lngLat.lat];
             const features = this.map.queryRenderedFeatures(e.point, { layers: ['waypoints-hit-area'] });
            if (features.length !== 0) {
               return;
           }
            if (this.hoveredRouteSegment !== null) {
                 this.addViaWaypoint(e.lngLat);
               this.hoveredRouteSegment = null; // reset
               this.closestSegment = null;
               this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]); // hide the highlight
                 return;
           }


            const routeData = this.map.getSource('route-line-source')._data;

            if (routeData && routeData.geometry && routeData.geometry.coordinates && routeData.geometry.coordinates.length > 1) {
                let closestSegment = null;
                let minDistance = Infinity;
                 let insertIndex = -1;

                const clickPixel = this.map.project(e.lngLat);

                for (let i = 0; i < routeData.geometry.coordinates.length - 1; i++) {
                    const startCoord = routeData.geometry.coordinates[i];
                    const endCoord = routeData.geometry.coordinates[i + 1];

                    const startPixel = this.map.project(new maplibregl.LngLat(startCoord[0], startCoord[1]));
                    const endPixel = this.map.project(new maplibregl.LngLat(endCoord[0], endCoord[1]));

                    const distance = this.pointToSegmentDistance(clickPixel, startPixel, endPixel);

                    if (distance < minDistance && distance < 10) {
                        minDistance = distance;
                         closestSegment = [startCoord, endCoord];
                         insertIndex = i;
                    }
                }

                if (closestSegment) {
                    const startLngLat = new maplibregl.LngLat(closestSegment[0][0], closestSegment[0][1])
                    const endLngLat = new maplibregl.LngLat(closestSegment[1][0], closestSegment[1][1])

                    const newLngLat = this.projectPointOnSegment(e.lngLat, startLngLat, endLngLat);

                    const closestWaypointBefore = insertIndex;
                     const closestWaypointAfter = insertIndex + 1;

                    if (closestWaypointBefore >= 0 && closestWaypointAfter < this.waypoints.length) {
                        this.waypoints.splice(closestWaypointAfter, 0, [newLngLat.lng, newLngLat.lat]);
                    } else {
                        this.waypoints.push([newLngLat.lng, newLngLat.lat]);
                    }
                    this.updateWaypoints();
                    this.getRoute();
                    return;
                }
            }
            this.waypoints.push(clickCoords);
            this.updateWaypoints();
            if (this.waypoints.length >= 2) {
                this.getRoute();
            }
        });


        // Double click to remove waypoint
        this.map.on('dblclick', 'waypoints-hit-area', (e) => {
            if (!this.directionsControl.classList.contains('visible')) return;
            const removeIndex = e.features[0].properties.index;
            if (removeIndex > 0 && removeIndex < this.waypoints.length - 1) {
                this.waypoints.splice(removeIndex, 1);
                this.updateWaypoints();
                if (this.waypoints.length >= 2) {
                    this.getRoute();
                } else {
                    this.clearRoute();
                    this.updateStats(null);
                    this.updateElevationProfile([]);
                }
            }
        });
    }
handleRouteSegmentHover(e) {
        const routeData = this.map.getSource('route-line-source')._data;
        if (!routeData || !routeData.geometry || !routeData.geometry.coordinates || routeData.geometry.coordinates.length < 2) {
            this.hoveredRouteSegment = null;
            this.closestSegment = null;
            this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]);
            return;
        }

        let closestSegment = null;
        let minDistance = Infinity;
        let insertIndex = -1;
        let routeSegmentStartIndex = -1;

        const clickPixel = this.map.project(e.lngLat);


           if (this.waypoints.length > 1) {
            for (let i = 0; i < this.waypoints.length - 1; i++) {
              const currentWaypointCoords = this.waypoints[i];
               const nextWaypointCoords = this.waypoints[i + 1];


               let startIndex = -1;
               let segmentCoords = [];
              for (let j = 0; j < routeData.geometry.coordinates.length - 1; j++) {

                const startSegmentCoord = routeData.geometry.coordinates[j];
                   const endSegmentCoord = routeData.geometry.coordinates[j + 1];
                   if (startSegmentCoord[0] === currentWaypointCoords[0] && startSegmentCoord[1] === currentWaypointCoords[1]) {
                           startIndex = j;
                         segmentCoords.push(startSegmentCoord);
                      }
                     if(startIndex !== -1)
                     {
                         segmentCoords.push(endSegmentCoord);
                      }
                    if(endSegmentCoord[0] === nextWaypointCoords[0] && endSegmentCoord[1] === nextWaypointCoords[1])
                      break;


                  }

                 for (let k = 0; k < segmentCoords.length - 1; k++) {
                   const startCoord = segmentCoords[k];
                  const endCoord = segmentCoords[k + 1];
                 const startPixel = this.map.project(new maplibregl.LngLat(startCoord[0], startCoord[1]));
                 const endPixel = this.map.project(new maplibregl.LngLat(endCoord[0], endCoord[1]));
                 const distance = this.pointToSegmentDistance(clickPixel, startPixel, endPixel);

                      if (distance < minDistance && distance < 10) {
                        minDistance = distance;
                          closestSegment = [startCoord, endCoord];
                         insertIndex = i;
                          routeSegmentStartIndex = startIndex + k;


                      }
                 }
           }
          }
           else
          {
            for (let i = 0; i < routeData.geometry.coordinates.length - 1; i++) {
                 const startCoord = routeData.geometry.coordinates[i];
                const endCoord = routeData.geometry.coordinates[i+1];

                 const startPixel = this.map.project(new maplibregl.LngLat(startCoord[0], startCoord[1]));
                 const endPixel = this.map.project(new maplibregl.LngLat(endCoord[0], endCoord[1]));

                   const distance = this.pointToSegmentDistance(clickPixel, startPixel, endPixel);
                 if (distance < minDistance && distance < 10) {
                      minDistance = distance;
                     closestSegment = [startCoord, endCoord];
                       insertIndex = 0;
                    routeSegmentStartIndex = i;
                    }
                }
          }
         if (closestSegment) {
            this.hoveredRouteSegment = insertIndex;
             this.closestSegment = closestSegment;
           this.routeSegmentStartIndex = routeSegmentStartIndex;
              this.updateRouteSegmentsSource(routeData, this.routeSegmentStartIndex);
             this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', this.routeSegmentStartIndex]);
        }
         else if (this.hoveredRouteSegment !== null) {
           this.hoveredRouteSegment = null;
              this.closestSegment = null;
              this.routeSegmentStartIndex = null;
            this.updateRouteSegmentsSource(routeData, -1);
            this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]);
        }
    }
   addViaWaypoint(lngLat) {
        const routeData = this.map.getSource('route-line-source')._data;
         if (!routeData || !routeData.geometry || !routeData.geometry.coordinates || routeData.geometry.coordinates.length < 2) {
            return;
        }
       if (this.hoveredRouteSegment === null || this.closestSegment === null ) return;


        const segmentIndex = this.hoveredRouteSegment;
         const startCoord = this.closestSegment[0];
         const endCoord = this.closestSegment[1];

        const startLngLat = new maplibregl.LngLat(startCoord[0], startCoord[1]);
        const endLngLat = new maplibregl.LngLat(endCoord[0], endCoord[1]);
       const newLngLat = this.projectPointOnSegment(lngLat, startLngLat, endLngLat);

        let insertIndex = this.waypoints.length;

      if (this.waypoints.length > 0)
           insertIndex = segmentIndex+1;

        this.waypoints.splice(insertIndex, 0, [newLngLat.lng, newLngLat.lat]);
        this.updateWaypoints();
        this.getRoute();
    }
    updateRouteSegmentsSource(routeData, hoveredSegmentIndex)
    {
        const features = [];

      if(routeData && routeData.geometry && routeData.geometry.coordinates && routeData.geometry.coordinates.length > 1) {
         if(hoveredSegmentIndex !== -1){
             features.push({
                    type: 'Feature',
                    properties: {
                        segmentIndex: hoveredSegmentIndex
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: [routeData.geometry.coordinates[hoveredSegmentIndex], routeData.geometry.coordinates[hoveredSegmentIndex+1]]
                    }
                });
         }
      }
        this.map.getSource('route-segments-source').setData({
            type: 'FeatureCollection',
            features: features
          });
    }

    projectPointOnSegment(clickLngLat, startLngLat, endLngLat) {
        const start = this.map.project(startLngLat);
        const end = this.map.project(endLngLat);
        const click = this.map.project(clickLngLat);

        const l2 = (
            (end.x - start.x) * (end.x - start.x) +
            (end.y - start.y) * (end.y - start.y)
        );
        if (l2 === 0)
            return clickLngLat;

        let t = ((click.x - start.x) * (end.x - start.x) + (click.y - start.y) * (end.y - start.y)) / l2;

        t = Math.max(0, Math.min(1, t));

        const projection = {
            x: start.x + t * (end.x - start.x),
            y: start.y + t * (end.y - start.y)
        };

        return this.map.unproject(projection);
    }
    pointToSegmentDistance(clickPixel, startPixel, endPixel) {
        const l2 = (
            (endPixel.x - startPixel.x) * (endPixel.x - startPixel.x) +
            (endPixel.y - startPixel.y) * (endPixel.y - startPixel.y)
        );
        if (l2 === 0) {
            return Math.sqrt((clickPixel.x - startPixel.x) * (clickPixel.x - startPixel.x) + (clickPixel.y - startPixel.y) * (clickPixel.y - startPixel.y));
        }

        let t = ((clickPixel.x - startPixel.x) * (endPixel.x - startPixel.x) + (clickPixel.y - startPixel.y) * (endPixel.y - startPixel.y)) / l2;

        t = Math.max(0, Math.min(1, t));


        const projection = {
            x: startPixel.x + t * (endPixel.x - startPixel.x),
            y: startPixel.y + t * (endPixel.y - startPixel.y)
        };

        return Math.sqrt((clickPixel.x - projection.x) * (clickPixel.x - projection.x) + (clickPixel.y - projection.y) * (clickPixel.y - projection.y));
    }

    updateWaypoints() {
        // Update waypoints source
        const features = this.waypoints.map((coords, index) => ({
            type: 'Feature',
            properties: {
                index: index,
                title: index === 0 ? 'A' : index === this.waypoints.length - 1 ? 'B' : `Via ${index}`
            },
            geometry: {
                type: 'Point',
                coordinates: coords
            }
        }));

        this.map.getSource('waypoints').setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    clearRoute() {
        this.map.getSource('route-line-source').setData({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: []
            }
        });
        this.map.getSource('distance-markers-source').setData({
            type: 'FeatureCollection',
            features: []
        });
        this.updateRouteSegmentsSource(null, -1);
         this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]); // hide the highlight
    }
    updateStats(route) {
        if (!route || !this.routeStats) return;

        const distance = (route.properties.segments[0].distance / 1000).toFixed(1); // km
        const ascent = route.properties.segments[0].ascent.toFixed(0); // meters
        const descent = route.properties.segments[0].descent.toFixed(0); // meters

        this.routeStats.innerHTML = `
            <div class="distance">Distance: <span>${distance}</span> km</div>
            <div class="elevation">Ascent: <span>${ascent}</span> m</div>
            <div class="elevation">Descent: <span>${descent}</span> m</div>
        `;
    }
    updateElevationProfile(coordinates) {
        if (!coordinates.length || !this.elevationChart) return;

        // Extract elevations
        const elevations = coordinates.map(coord => coord[2]);
        const maxElevation = Math.max(...elevations);
        const minElevation = Math.min(...elevations);
        const range = maxElevation - minElevation;

        // Create elevation chart
        const chartHtml = elevations.map(ele => {
            const height = Math.max(1, ((ele - minElevation) / range * 80));
            return `<div class='elevation-bar' style='height:${height}%' title='${Math.round(ele)}m'></div>`;
        }).join('');

        this.elevationChart.innerHTML = `
            <div class='elevation-chart-container'>
                ${chartHtml}
            </div>
            <div class='elevation-labels'>
                <span>${Math.round(maxElevation)}m</span>
                <span>${Math.round(minElevation)}m</span>
            </div>
        `;
    }

    async getRoute() {
        if (this.waypoints.length < 2) return;

        try {
            const response = await fetch(`https://api.openrouteservice.org/v2/directions/${this.currentMode}/geojson`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
                    'Content-Type': 'application/json',
                    'Authorization': '5b3ce3597851110001cf62483828a115553d4a98817dd43f61935829'
                },
                body: JSON.stringify({
                    coordinates: this.waypoints,
                    elevation: true,
                    extra_info: ["waytype", "steepness"],
                    preference: this.currentMode === 'foot-hiking' ? 'recommended' : 'fastest',
                    units: 'km',
                    language: 'en'
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'Network response was not ok');
            }

            const data = await response.json();
            const route = data.features[0];

            // Update the route line
            this.map.getSource('route-line-source').setData(route);

            // Update the distance markers
            this.updateDistanceMarkers(route);
             this.updateRouteSegmentsSource(route,-1);
            this.map.setFilter('route-segment-hover', ['==', 'segmentIndex', -1]);
            // Update stats and elevation profile
            this.updateStats(route);
            this.updateElevationProfile(route.geometry.coordinates);


        } catch (error) {
            console.error('Error:', error);
        }
    }
    updateDistanceMarkers(route) {
        if (!route || !route.geometry || !route.geometry.coordinates) {
            // Ensure that the route source always has valid GeoJSON
            this.map.getSource('distance-markers-source').setData({
                type: 'FeatureCollection',
                features: []
            });
            return;
        }
        try {
            const line = turf.lineString(route.geometry.coordinates);
            const totalDistance = route.properties.segments[0].distance / 1000;
            const distanceMarkers = [];
            let currentDistance = 0;

            while (currentDistance < totalDistance) {
                const along = turf.along(line, currentDistance);
                distanceMarkers.push({
                    type: 'Feature',
                    properties: {
                        distance: `${currentDistance.toFixed(0)} km`,
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: along.geometry.coordinates
                    }
                });
                currentDistance += 1;
            }
            this.map.getSource('distance-markers-source').setData({
                type: 'FeatureCollection',
                features: distanceMarkers
            });
        }
        catch (error) {
            console.error("Error updating distance markers:", error);
            this.map.getSource('distance-markers-source').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
    }
}