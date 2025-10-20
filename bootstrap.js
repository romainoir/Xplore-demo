const externalScripts = [
    {
        url: 'https://unpkg.com/maplibre-gl@v5.0.0/dist/maplibre-gl.js',
        stripSourceMap: true,
        description: 'MapLibre GL JS'
    },
    {
        url: 'https://unpkg.com/maplibre-contour@0.0.5/dist/index.min.js',
        description: 'maplibre-contour'
    },
    {
        url: 'https://unpkg.com/@turf/turf@6/turf.min.js',
        description: '@turf/turf'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js',
        description: 'pako'
    },
    {
        url: 'https://unpkg.com/@maplibre/maplibre-gl-geocoder@1.5.0/dist/maplibre-gl-geocoder.min.js',
        description: 'MapLibre GL Geocoder'
    }
];

async function loadExternalScript({ url, stripSourceMap = false, description }) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${description || url} (${response.status} ${response.statusText})`);
    }

    let scriptContent = await response.text();
    if (stripSourceMap) {
        scriptContent = scriptContent.replace(/\/\/#[#@]\s*sourceMappingURL=.*$/gm, '');
    }

    const scriptElement = document.createElement('script');
    scriptElement.type = 'text/javascript';
    scriptElement.text = scriptContent;
    document.head.appendChild(scriptElement);
}

function showBootstrapError(error) {
    console.error('Failed to bootstrap the Xplore map application.', error);

    const errorBanner = document.createElement('div');
    errorBanner.className = 'bootstrap-error';
    errorBanner.textContent = 'An error occurred while loading required map libraries. Please check your internet connection and reload the page.';
    document.body.prepend(errorBanner);
}

(async () => {
    try {
        for (const script of externalScripts) {
            await loadExternalScript(script);
        }

        await import('./app.js');
    } catch (error) {
        showBootstrapError(error);
    }
})();
