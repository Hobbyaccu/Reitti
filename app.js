function showStreetView() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    mapContainer.innerHTML = '';

    const map = L.map('map').setView([60.20911396893135, 24.955160312780436], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);
}
