// app.js

// Import modules (if needed)
// const module = require('module-name');

// Main application code
function main() {
    console.log('Application started');
}

// Run application
main();

function showSatelliteMap() {
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.innerHTML = '<iframe src="https://maps.google.com/?output=embed" width="100%" height="500" style="border:0;" allowfullscreen="" loading="lazy"></iframe>';
    }
}

// Expose function to global scope for HTML button
window.showSatelliteMap = showSatelliteMap;
