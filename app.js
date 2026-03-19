function showSatelliteMap() {
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.innerHTML = 
            '<iframe src="https://maps.google.com/?output=embed" ' +
            'width="100%" height="500" style="border:0;" ' +
            'allowfullscreen="" loading="lazy"></iframe>';
    }
}

function showStreetView() {
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.innerHTML = 
            '<iframe src="https://maps.google.com/?output=embed&styles=element:geometry%7Ccolor:0x212121&styles=element:labels%7Cinvert_lightness:true&styles=element:labels.text.fill%7Ccolor:0xbdbdbd&styles=element:labels.text.stroke%7Ccolor:0x212121&styles=feature:administrative%7Celement:geometry%7Ccolor:0x757575&styles=feature:administrative.country%7Celement:geometry.stroke%7Ccolor:0x404040&styles=feature:water%7Celement:color%7Ccolor:0x263238" ' +
            'width="100%" height="500" style="border:0;" ' +
            'allowfullscreen="" loading="lazy"></iframe>';
    }
}
