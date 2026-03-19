function showStreetView() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    // Clear any previous map (safe to click button multiple times)
    mapContainer.innerHTML = '';

    // Create the dark street map (centered on New York by default – change coords/zoom as needed)
    const map = L.map('map').setView([40.7128, -74.0060], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);
}
