// wikimedia.js
import { map } from '../main/app.js';

let wikimediaInitialized = false;

// Functions to Fetch external datas
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

function setupWikimediaEventListeners() {
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

map.on('mouseenter', 'wikimedia-photos', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'wikimedia-photos', () => {
    map.getCanvas().style.cursor = '';
});
}

export {fetchWikimediaPhotos, setupWikimediaEventListeners};