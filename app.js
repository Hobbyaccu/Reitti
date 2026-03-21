let map = null;
let mainPath = null;          
let walkedPath = null;        
let userMarker = null;        
let accuracyCircle = null;
let offPathLine = null;       
let pathPoints = [];
let isDrawing = false;
let watchId = null;
let totalDistance = 0;

const WALK_SPEED = 5; // km/h
const OFF_PATH_THRESHOLD = 40; 

function calculateDistance(pts) {
    let d = 0;
    for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
    return d;
}

function closestPointOnSegment(p, a, b) {
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { point: a, t: 0 };
    let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { point: L.latLng(a.lat + t * dy, a.lng + t * dx), t };
}

function projectPosition(currentPos) {
    if (pathPoints.length < 2) return { point: currentPos, traveled: 0, index: 0 };

    let bestDist = Infinity, bestPoint = null, bestIndex = 0, bestT = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const res = closestPointOnSegment(currentPos, pathPoints[i], pathPoints[i + 1]);
        const dist = currentPos.distanceTo(res.point);
        if (dist < bestDist) {
            bestDist = dist;
            bestPoint = res.point;
            bestIndex = i;
            bestT = res.t;
        }
    }

    let traveled = 0;
    for (let i = 0; i < bestIndex; i++) traveled += pathPoints[i].distanceTo(pathPoints[i + 1]);
    traveled += bestT * pathPoints[bestIndex].distanceTo(pathPoints[bestIndex + 1]);

    return { point: bestPoint, traveled, index: bestIndex };
}

function updateInfo(traveled, speed, accuracy, offPathDist) {
    const walkedKm = (traveled / 1000).toFixed(2);
    const remaining = Math.max(0, totalDistance - traveled);
    const remKm = (remaining / 1000).toFixed(2);
    const percent = totalDistance > 0 ? Math.round((traveled / totalDistance) * 100) : 0;
    const speedKmh = speed !== null ? (speed * 3.6).toFixed(1) : "—";
    const accM = accuracy ? accuracy.toFixed(0) : "—";

    let extra = '';
    if (offPathDist > OFF_PATH_THRESHOLD) {
        extra = `<br><strong style="color:#ff8800;">Off path (+${offPathDist.toFixed(0)} m)</strong>`;
    }

    document.getElementById('path-info').innerHTML = `
        <strong>Walked:</strong> ${walkedKm} km 
        <strong>Remaining:</strong> ${remKm} km<br>
        <strong>Progress:</strong> ${percent}% 
        <strong>Speed:</strong> ${speedKmh} km/h 
        <strong>Accuracy:</strong> ±${accM} m${extra}
    `;
    document.getElementById('path-info').style.display = 'block';
}

function initializeApp() {
    if (map) return;
    map = L.map('map').setView([60.20911396893135, 24.955160312780436], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap &amp; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    map.on('click', e => {
        if (!isDrawing) return;
        pathPoints.push(e.latlng);
        if (mainPath) mainPath.setLatLngs(pathPoints);
        else {
            mainPath = L.polyline(pathPoints, { color: '#00ff88', weight: 6, opacity: 0.85 }).addTo(map);
        }
        document.getElementById('undo-btn').style.display = 'inline-block';
    });

    document.getElementById('draw-btn').disabled = false;
    document.getElementById('init-btn').disabled = true;

    const saved = localStorage.getItem('customPath');
    if (saved) document.getElementById('load-btn').disabled = false;
}

function startDrawing() { 
    if (!map) return alert("Load map first");
    clearEverything();
    isDrawing = true;
    document.getElementById('finish-btn').disabled = false;
    document.getElementById('undo-btn').style.display = 'inline-block';
    alert("Tap map to draw your path → Finish when done");
}

function undoLastPoint() { 
    if (!isDrawing || pathPoints.length === 0) return;
    pathPoints.pop();
    if (mainPath) mainPath.setLatLngs(pathPoints);
    if (pathPoints.length === 0) document.getElementById('undo-btn').style.display = 'none';
}

function finishDrawing() { 
    if (pathPoints.length < 2) return alert("Need at least 2 points");
    isDrawing = false;
    document.getElementById('undo-btn').style.display = 'none';
    document.getElementById('finish-btn').disabled = true;
    document.getElementById('nav-btn').disabled = false;
    document.getElementById('clear-btn').disabled = false;
    document.getElementById('load-btn').disabled = true;

    totalDistance = calculateDistance(pathPoints);
    savePathToStorage();
}

function loadSavedPath() { 
    const raw = localStorage.getItem('customPath');
    if (!raw) return;
    const coords = JSON.parse(raw);
    pathPoints = coords.map(c => L.latLng(c[0], c[1]));

    if (mainPath) mainPath.remove();
    mainPath = L.polyline(pathPoints, { color: '#00ff88', weight: 6, opacity: 0.85 }).addTo(map);

    totalDistance = calculateDistance(pathPoints);
    document.getElementById('nav-btn').disabled = false;
    document.getElementById('clear-btn').disabled = false;
    document.getElementById('load-btn').disabled = true;
    updateInfo(0, null, null, 0);
}

function savePathToStorage() { 
    const data = pathPoints.map(p => [p.lat, p.lng]);
    localStorage.setItem('customPath', JSON.stringify(data));
}

function clearEverything() {
    if (mainPath) { mainPath.remove(); mainPath = null; }
    if (walkedPath) { walkedPath.remove(); walkedPath = null; }
    if (userMarker) { userMarker.remove(); userMarker = null; }
    if (accuracyCircle) { accuracyCircle.remove(); accuracyCircle = null; }
    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
    pathPoints = [];
    totalDistance = 0;
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    document.getElementById('path-info').style.display = 'none';
    document.getElementById('undo-btn').style.display = 'none';
    document.getElementById('recenter-btn').style.display = 'none';
}

function clearPath() { 
    clearEverything();
    localStorage.removeItem('customPath');
    document.getElementById('draw-btn').disabled = false;
    document.getElementById('load-btn').disabled = false;
}

function startNavigation() {
    if (pathPoints.length < 2) return alert("Draw a path first");

    if (mainPath) mainPath.setStyle({ color: '#aaaaaa', weight: 4, opacity: 0.5 });
    walkedPath = L.polyline([], { color: '#00ff88', weight: 8, opacity: 1 }).addTo(map);

    document.getElementById('stop-btn').style.display = 'inline-block';
    document.getElementById('nav-btn').disabled = true;
    document.getElementById('recenter-btn').style.display = 'inline-block';

    watchId = navigator.geolocation.watchPosition(pos => {
        const rawPos = L.latLng(pos.coords.latitude, pos.coords.longitude);   // REAL GPS
        const proj = projectPosition(rawPos);                                 // for stats + trail

        // === BLUE DOT = REAL POSITION ===
        if (!userMarker) {
            userMarker = L.circleMarker(rawPos, {
                radius: 10,
                color: '#0066ff',
                fillColor: '#00aaff',
                fillOpacity: 1,
                weight: 3
            }).addTo(map);
        } else {
            userMarker.setLatLng(rawPos);
        }

        // Accuracy circle on real position
        if (!accuracyCircle) {
            accuracyCircle = L.circle(rawPos, {
                radius: pos.coords.accuracy || 30,
                color: '#3388ff',
                fillColor: '#3388ff',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(map);
        } else {
            accuracyCircle.setLatLng(rawPos).setRadius(pos.coords.accuracy || 30);
        }

        // Grow walked trail along the path (projection)
        const walkedPts = pathPoints.slice(0, proj.index + 1);
        walkedPts.push(proj.point);
        walkedPath.setLatLngs(walkedPts);

        const distToPath = rawPos.distanceTo(proj.point);
        if (distToPath > OFF_PATH_THRESHOLD) {
            if (!offPathLine) {
                offPathLine = L.polyline([rawPos, proj.point], {
                    color: '#ff8800',
                    weight: 3,
                    opacity: 0.75,
                    dashArray: '8, 6'
                }).addTo(map);
            } else {
                offPathLine.setLatLngs([rawPos, proj.point]);
            }
        } else if (offPathLine) {
            offPathLine.remove();
            offPathLine = null;
        }

        map.panTo(rawPos, { animate: true });   // center on real you

        updateInfo(proj.traveled, pos.coords.speed, pos.coords.accuracy, distToPath);

        // Auto-arrival
        if (proj.traveled / totalDistance > 0.97) {
            alert("🎉 You've reached the end!");
            stopNavigation();
        }
    }, err => {
        if (err.code === 1) console.log("Permission denied (normal in dev tools)");
        else console.error(err);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
}

function stopNavigation() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('recenter-btn').style.display = 'none';
    document.getElementById('nav-btn').disabled = false;
}

function recenterMap() {
    if (userMarker) map.flyTo(userMarker.getLatLng(), map.getZoom());
}

window.onload = () => setTimeout(() => { if (!map) initializeApp(); }, 200);

