let map = null;
let pathPolyline = null;
let pathPoints = [];
let isDrawing = false;
let userMarker = null;
let watchId = null;
let totalDistanceMeters = 0;
let estimatedMinutes = 0;

const WALKING_SPEED_KMH = 5; 

// Helper: distance between two points in meters (Leaflet already gives us this!)
function calculateDistance(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        total += points[i].distanceTo(points[i + 1]);
    }
    return total;
}

// Helper: closest point on a line segment + the parameter t (0-1)
function closestPointOnSegment(point, a, b) {
    const ax = a.lng, ay = a.lat;
    const bx = b.lng, by = b.lat;
    const px = point.lng, py = point.lat;

    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { point: a, t: 0 };

    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * dx;
    const cy = ay + t * dy;

    return {
        point: L.latLng(cy, cx),
        t: t
    };
}

function projectAndGetProgress(currentPos, points) {
    if (points.length < 2) return { point: currentPos, traveled: 0 };

    let minDist = Infinity;
    let closest = null;
    let bestIndex = -1;
    let bestT = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const result = closestPointOnSegment(currentPos, p1, p2);
        const distToProj = currentPos.distanceTo(result.point);

        if (distToProj < minDist) {
            minDist = distToProj;
            closest = result.point;
            bestIndex = i;
            bestT = result.t;
        }
    }

    // Calculate real distance traveled along the path up to the projected point
    let traveled = 0;
    for (let j = 0; j < bestIndex; j++) {
        traveled += points[j].distanceTo(points[j + 1]);
    }
    const segmentLength = points[bestIndex].distanceTo(points[bestIndex + 1]);
    traveled += bestT * segmentLength;

    return { point: closest, traveled: traveled };
}

// Update info panel
function updatePathInfo() {
    const infoDiv = document.getElementById('path-info');
    const distKm = (totalDistanceMeters / 1000).toFixed(2);
    const progress = totalDistanceMeters > 0 
        ? Math.min(100, Math.max(0, (0 / totalDistanceMeters) * 100)) // will be updated live
        : 0;

    infoDiv.innerHTML = `
        <strong>Path Distance:</strong> ${distKm} km<br>
        <strong>Estimated walking time:</strong> ${estimatedMinutes} min<br>
        <strong>Progress along path:</strong> <span id="live-progress">0%</span>
    `;
    infoDiv.style.display = 'block';
}

// Live updates
function updateLiveProgress(traveled) {
    const percent = totalDistanceMeters > 0 
        ? Math.min(100, Math.max(0, Math.round((traveled / totalDistanceMeters) * 100)))
        : 0;
    const span = document.getElementById('live-progress');
    if (span) span.textContent = `${percent}%`;
}

function initializeApp() {
    if (map) return; // already loaded

    map = L.map('map').setView([60.20911396893135, 24.955160312780436], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Enable map clicks for drawing
    map.on('click', (e) => {
        if (!isDrawing) return;
        pathPoints.push(e.latlng);
        if (pathPolyline) {
            pathPolyline.setLatLngs(pathPoints);
        } else {
            pathPolyline = L.polyline(pathPoints, {
                color: '#00ff00',
                weight: 5,
                opacity: 0.9
            }).addTo(map);
        }
    });

    // Enable the drawing buttons
    document.getElementById('draw-btn').disabled = false;
    document.getElementById('init-btn').disabled = true; // one-time init
}

function startDrawing() {
    if (!map) {
        alert("Load the map first!");
        return;
    }
    // Reset previous path
    if (pathPolyline) pathPolyline.remove();
    pathPoints = [];
    pathPolyline = null;
    isDrawing = true;

    alert("✅ Tap the map to add points for your custom path.\nWhen finished, click 'Finish Path'.");
    document.getElementById('finish-btn').disabled = false;
}

function finishDrawing() {
    if (pathPoints.length < 2) {
        alert("Add at least 2 points by tapping the map!");
        return;
    }
    isDrawing = false;
    document.getElementById('finish-btn').disabled = true;
    document.getElementById('nav-btn').disabled = false;
    document.getElementById('clear-btn').disabled = false;

    // Calculate once
    totalDistanceMeters = calculateDistance(pathPoints);
    const distKm = totalDistanceMeters / 1000;
    estimatedMinutes = Math.round((distKm / WALKING_SPEED_KMH) * 60);

    updatePathInfo();
}

function clearPath() {
    if (pathPolyline) pathPolyline.remove();
    pathPoints = [];
    pathPolyline = null;
    totalDistanceMeters = 0;
    estimatedMinutes = 0;
    isDrawing = false;

    if (userMarker) {
        userMarker.remove();
        userMarker = null;
    }
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    document.getElementById('path-info').style.display = 'none';
    document.getElementById('draw-btn').disabled = false;
    document.getElementById('nav-btn').disabled = true;
    document.getElementById('stop-btn').style.display = 'none';
}

function startNavigation() {
    if (!map || pathPoints.length < 2) {
        alert("Draw and finish a path first!");
        return;
    }

    document.getElementById('stop-btn').style.display = 'inline-block';
    document.getElementById('nav-btn').disabled = true;

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const userPos = L.latLng(
                position.coords.latitude,
                position.coords.longitude
            );

            const projection = projectAndGetProgress(userPos, pathPoints);

            // center dot
            if (!userMarker) {
                userMarker = L.circleMarker(projection.point, {
                    radius: 9,
                    color: '#00aaff',
                    fillColor: '#00aaff',
                    fillOpacity: 1,
                    weight: 3,
                    opacity: 1
                }).addTo(map);
            } else {
                userMarker.setLatLng(projection.point);
            }

            // Center map on current location
            map.panTo(projection.point, { animate: true });

            // progress update
            updateLiveProgress(projection.traveled);
        },
        (error) => {
            console.error(error);
            alert("GPS error: " + error.message + "\n\nMake sure location is enabled and try outdoors.");
        },
        {
            enableHighAccuracy: true,   // high accuracy for navigation
            maximumAge: 3000,
            timeout: 8000
        }
    );
}

function stopNavigation() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (userMarker) {
        userMarker.remove();
        userMarker = null;
    }
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('nav-btn').disabled = false;
}

// Auto-init
window.onload = () => {
    setTimeout(() => {
        if (!map) initializeApp();
    }, 100);
};
