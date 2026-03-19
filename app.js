function showSatelliteMap() {
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.innerHTML = 
            '<iframe src="https://maps.google.com/?output=embed" ' +
            'width="100%" height="500" style="border:0;" ' +
            'allowfullscreen="" loading="lazy"></iframe>';
    }
}
