// refuges.js
import { map } from './app.js';

const photoCache = new Map();
const processedFeatures = new Set();
const failedRequests = new Set();
let isRefugesEnabled = false;

class RequestLimiter {
    constructor(maxRequests = 20, timeWindow = 1000) {
        this.requests = [];
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
    }

    async checkLimit() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.timeWindow);
        
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = this.timeWindow - (now - oldestRequest);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.requests.push(now);
    }
}

const limiter = new RequestLimiter(3, 1000);

// Helper function to check if refuges should be fetched
function shouldFetchRefuges(map) {
    if (!map.getLayer('refuges-layer')) return false;
    const visibility = map.getLayoutProperty('refuges-layer', 'visibility');
    return visibility === 'visible';
}

// Utility Functions
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

async function fetchWithRetry(url, retries = 3) {
    if (failedRequests.has(url)) {
        throw new Error('URL previously failed');
    }

    for (let i = 0; i < retries; i++) {
        try {
            await limiter.checkLimit();
            
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            if (response.ok) return response;
            
            if (response.status === 400) {
                await limiter.checkLimit();
                const corsAnywhereUrl = `https://cors-anywhere.herokuapp.com/${url}`;
                const altResponse = await fetch(corsAnywhereUrl);
                if (altResponse.ok) return altResponse;
            }

            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        } catch (error) {
            console.warn(`Attempt ${i + 1} failed for ${url}:`, error);
            if (i === retries - 1) {
                failedRequests.add(url);
                throw error;
            }
        }
    }
    failedRequests.add(url);
    throw new Error('Failed after retries');
}

async function fetchPointsOfInterest() {
    // First check if we should fetch
    if (!shouldFetchRefuges(map)) {
        if (map.getSource('refuges')) {
            map.getSource('refuges').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        return;
    }

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

        const response = await fetchWithRetry(
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

        // First pass: update existing features with cached photos
        featuresWithDistance.forEach(({ feature }) => {
            const photoId = `photo-${feature.properties.id}`;
            if (photoCache.has(photoId)) {
                feature.properties.photoId = photoId;
            }
        });

        // Update the source with current data
        data.features = featuresWithDistance.map(f => f.feature);
        if (map.getSource('refuges')) {
            map.getSource('refuges').setData(data);
        }

        // Process unprocessed features in batches
        const BATCH_SIZE = 3;
        const unprocessedFeatures = featuresWithDistance.filter(
            ({ feature }) => !processedFeatures.has(feature.properties.id)
        );

        for (let i = 0; i < unprocessedFeatures.length; i += BATCH_SIZE) {
            const batch = unprocessedFeatures.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ feature }) => {
                const photoId = `photo-${feature.properties.id}`;
                
                if (processedFeatures.has(feature.properties.id)) return;
                if (map.hasImage(photoId)) return;

                try {
                    const photoUrls = await getPointPhotos(feature);
                    if (photoUrls && photoUrls.length > 0) {
                        feature.properties.photoUrls = photoUrls;
                        
                        if (!map.hasImage(photoId)) {
                            await loadPointImage(feature, photoUrls[0], photoId);

                            feature.properties.photoId = photoId;
                            photoCache.set(photoId, photoUrls);
                            processedFeatures.add(feature.properties.id);

                            // Update the specific feature in the source
                            const currentData = map.getSource('refuges')._data;
                            const index = currentData.features.findIndex(f => 
                                f.properties.id === feature.properties.id
                            );
                            if (index !== -1) {
                                currentData.features[index] = feature;
                                map.getSource('refuges').setData(currentData);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to process photos for point ${feature.properties.id}:`, error);
                }
            }));
        }

        // Add click handlers
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

async function loadPointImage(feature, photoUrl, photoId) {
    try {
        const fullPhotoUrl = `https://www.refuges.info${photoUrl}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(fullPhotoUrl)}`;
        const photoResponse = await fetchWithRetry(fullPhotoUrl);
        if (!photoResponse.ok) return;

        const photoBlob = await photoResponse.blob();
        const imageBitmap = await createImageBitmap(photoBlob);

        // Double-check image doesn't exist before creating it
        if (!map.hasImage(photoId)) {
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
    } catch (error) {
        console.warn(`Failed to load image for ${photoId}:`, error);
    }
}

async function getPointPhotos(feature) {
    try {
        const pageUrl = feature.properties.lien;
        if (failedRequests.has(pageUrl)) return null;

        const response = await fetchWithRetry(pageUrl);
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

function formatPopupContent(properties) {
    console.log('[DEBUG] Formatting popup with properties:', properties);
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

    console.log('[DEBUG] Raw PhotoUrls:', p.photoUrls);
    
    // Create carousel HTML
    let carouselHtml = '';
    if (p.photoUrls && p.photoUrls.length > 0) {
        const uniquePhotos = [...new Set(p.photoUrls)];
        console.log('[DEBUG] Processing unique photos:', uniquePhotos);

        carouselHtml = `
            <div class="carousel-container" style="margin-bottom: 15px; position: relative;">
                <div class="carousel-slides" style="position: relative; min-height: 200px;">
                    ${uniquePhotos.map((url, index) => {
                        const fullUrl = `https://www.refuges.info${url}`;
                        console.log('[DEBUG] Creating slide with URL:', fullUrl);
                        
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

async function createPointPopup(coordinates, properties) {
    const photoId = `photo-${properties.id}`;
    if (photoCache.has(photoId) && !properties.photoUrls) {
        properties.photoUrls = photoCache.get(photoId);
    }

    if (!properties.photoUrls) {
        properties.photoUrls = await getPointPhotos({ properties });
    }

    const popupContent = formatPopupContent(properties);

    new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '500px',
        className: 'refuge-popup'
    })
        .setLngLat(coordinates)
        .setHTML(popupContent)
        .addTo(map);
}

function changeSlide(button, direction) {
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
    
    // Update counter
    counter.textContent = `${currentIndex + 1}/${slides.length}`;
    
    // Preload adjacent images
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
    const nextIndex = (currentIndex + 1) % slides.length;
    
    // Set loading attribute for better performance
    slides.forEach((slide, index) => {
        const img = slide.querySelector('img');
        if (index === currentIndex || index === prevIndex || index === nextIndex) {
            img.setAttribute('loading', 'eager');
        } else {
            img.setAttribute('loading', 'lazy');
        }
    });
}

function setupRefugesEventListeners() {
    // Event listener for refuge layer clicks
    map.on('click', 'refuges-layer', (e) => {
        if (e.features.length > 0) {
            const coordinates = e.features[0].geometry.coordinates.slice();
            const properties = e.features[0].properties;
            createPointPopup(coordinates, properties);
        }
    });

    // Mouse enter/leave effects for refuges layer
    map.on('mouseenter', 'refuges-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'refuges-layer', () => {
        map.getCanvas().style.cursor = '';
    });

    // Add visibility change handler
    map.on('styledata', () => {
        const wasEnabled = isRefugesEnabled;
        isRefugesEnabled = shouldFetchRefuges(map);
        
        // If visibility changed from disabled to enabled, trigger a fetch
        if (!wasEnabled && isRefugesEnabled) {
            fetchPointsOfInterest();
        }
    });
}

// Attach changeSlide to window
window.changeSlide = changeSlide;

// Clean up when page unloads
window.addEventListener('unload', () => {
    photoCache.clear();
    processedFeatures.clear();
    failedRequests.clear();
});

export { fetchPointsOfInterest, setupRefugesEventListeners };