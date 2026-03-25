let map = null;
let mainPath = null;
let walkedPath = null;
let userMarker = null;
let accuracyCircle = null;
let headingMarker = null;
let offPathLine = null;
let pathPoints = [];
let isDrawing = false;
let isNavigating = false;
let locationWatchId = null;
let totalDistance = 0;
let maxReachedIndex = 0;
let hasEnteredFullscreen = false;

const OFF_PATH_THRESHOLD = 40;
const LOOP_SNAP_THRESHOLD = 30;
const ARRIVAL_THRESHOLD = 0.95;

// --- UI STATE MANAGER ---
function setUIState(state) {
    document.querySelectorAll('.state-view').forEach(el => el.classList.remove('active'));
    document.getElementById(`state-${state}`).classList.add('active');

    if (state === 'idle') {
        const hasSaved = localStorage.getItem('customPath') !== null;
        document.getElementById('load-btn').style.display = hasSaved ? 'flex' : 'none';
    } else if (state === 'ready') {
        document.getElementById('route-distance').textContent = (totalDistance / 1000).toFixed(2) + ' km';
    }
}

// --- MATH & PROJECTIONS ---
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

// --- MAP UPDATES ---
function updateUserMarkerAndCircle(rawPos, accuracy) {
    if (!userMarker) {
        userMarker = L.circleMarker(rawPos, { radius: 8, color: '#ffffff', fillColor: '#007aff', fillOpacity: 1, weight: 3 }).addTo(map);
    } else userMarker.setLatLng(rawPos);

    if (!accuracyCircle) {
        accuracyCircle = L.circle(rawPos, { radius: accuracy || 30, color: '#007aff', fillColor: '#007aff', fillOpacity: 0.15, weight: 0 }).addTo(map);
    } else accuracyCircle.setLatLng(rawPos).setRadius(accuracy || 30);
}

function updateHeading(rawPos, heading) {
    if (!headingMarker) {
        headingMarker = L.marker(rawPos, {
            icon: L.divIcon({ className: 'heading-arrow', html: '<div style="font-size:24px; color:#007aff; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">▲</div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
            zIndexOffset: 1000
        }).addTo(map);
    } else headingMarker.setLatLng(rawPos);

    const el = headingMarker.getElement();
    if (el) {
        const div = el.querySelector('div');
        if (div) div.style.transform = heading !== null ? `rotate(${heading}deg)` : 'rotate(0deg)';
    }
}

function updateInfo(traveled, speed, accuracy, offPathDist) {
    const walkedKm = (traveled / 1000).toFixed(2);
    const remaining = Math.max(0, totalDistance - traveled);
    const remKm = (remaining / 1000).toFixed(2);
    const speedKmh = speed !== null ? (speed * 3.6).toFixed(1) : "0.0";
    
    let html = `
        <div class="stats-grid">
            <div class="stat-item">
                <span class="stat-label">Walked</span>
                <span class="stat-value">${walkedKm} km</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Remaining</span>
                <span class="stat-value">${remKm} km</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Speed</span>
                <span class="stat-value">${speedKmh} km/h</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Accuracy</span>
                <span class="stat-value">±${accuracy ? accuracy.toFixed(0) : "—"} m</span>
            </div>
        </div>
    `;

    if (offPathDist > OFF_PATH_THRESHOLD) {
        html += `<div class="warning-banner">⚠️ Off path by ${offPathDist.toFixed(0)}m</div>`;
    }

    document.getElementById('path-info-content').innerHTML = html;
}

// --- CORE LOGIC ---
function startPermanentLocationWatch() {
    if (locationWatchId) return;
    locationWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const rawPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
            const acc = pos.coords.accuracy || 30;

            updateUserMarkerAndCircle(rawPos, acc);
            updateHeading(rawPos, pos.coords.heading);

            if (isNavigating) {
                const proj = projectPosition(rawPos);
                if (proj.index > maxReachedIndex) maxReachedIndex = proj.index;

                if (walkedPath) {
                    const walkedPts = pathPoints.slice(0, proj.index + 1);
                    walkedPts.push(proj.point);
                    walkedPath.setLatLngs(walkedPts);
                }

                const distToPath = rawPos.distanceTo(proj.point);
                if (distToPath > OFF_PATH_THRESHOLD) {
                    if (!offPathLine) offPathLine = L.polyline([rawPos, proj.point], { color: '#ff3b30', weight: 3, opacity: 0.8, dashArray: '6, 6' }).addTo(map);
                    else offPathLine.setLatLngs([rawPos, proj.point]);
                } else if (offPathLine) { offPathLine.remove(); offPathLine = null; }

                map.panTo(rawPos, { animate: true });
                updateInfo(proj.traveled, pos.coords.speed, acc, distToPath);

                if (totalDistance > 0 && proj.traveled / totalDistance > ARRIVAL_THRESHOLD && maxReachedIndex >= pathPoints.length - 2) {
                    alert("🎉 You've reached the end! Great job!");
                    stopNavigation();
                }
            }
        },
        (err) => { if (err.code !== 1) console.error(err); },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
}

async function enterFullscreen() {
    if (hasEnteredFullscreen || !document.fullscreenEnabled) return;

    try {
        await document.documentElement.requestFullscreen({
            navigationUI: 'hide'
        });
        hasEnteredFullscreen = true;
        console.log("✅ Entered fullscreen mode");
    } catch (err) {
        console.log("Fullscreen request failed:", err);
    }
}

function initializeApp() {
    if (map) return;
    map = L.map('map', { zoomControl: false }).setView([60.20911396893135, 24.955160312780436], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    startPermanentLocationWatch();

    navigator.geolocation.getCurrentPosition(
        (pos) => map.flyTo(L.latLng(pos.coords.latitude, pos.coords.longitude), 15, { duration: 1.5 }),
        () => {}
    );

    map.on('click', e => {
        if (!isDrawing) return;
        pathPoints.push(e.latlng);
        if (mainPath) mainPath.setLatLngs(pathPoints);
        else mainPath = L.polyline(pathPoints, { color: '#007aff', weight: 6, opacity: 0.85 }).addTo(map);
        
        document.getElementById('undo-btn').disabled = false;
        if(pathPoints.length >= 2) document.getElementById('finish-btn').disabled = false;
    });

    setUIState('idle'); // Initialize UI

    const handleFirstInteraction = () => {
        enterFullscreen();
        // Remove listeners so it only happens once
        document.removeEventListener('touchstart', handleFirstInteraction, { once: true });
        document.removeEventListener('click', handleFirstInteraction, { once: true });
    };

    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('click', handleFirstInteraction, { once: true });
}

function findMe() {
    if (!map) return alert("Load map first");
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const userPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
            map.flyTo(userPos, Math.max(map.getZoom(), 16), { duration: 1 });
            const temp = L.circleMarker(userPos, { radius: 20, color: '#007aff', fillOpacity: 0.3, weight: 0 }).addTo(map);
            setTimeout(() => temp.remove(), 1000);
        },
        () => alert("Couldn't get location — check browser/phone settings")
    );
}

// --- BUTTON ACTIONS ---
function startDrawing() {
    if (!map) return alert("Load map first");
    clearEverything();
    isDrawing = true;
    map.doubleClickZoom.disable();
    setUIState('drawing');
}

function undoLastPoint() {
    if (!isDrawing || pathPoints.length === 0) return;
    pathPoints.pop();
    if (mainPath) mainPath.setLatLngs(pathPoints);
    
    if (pathPoints.length === 0) document.getElementById('undo-btn').disabled = true;
    if (pathPoints.length < 2) document.getElementById('finish-btn').disabled = true;
}

function finishDrawing() {
    if (pathPoints.length < 2) return;

    // Loop snapping
    if (pathPoints.length >= 3) {
        const distToStart = pathPoints[0].distanceTo(pathPoints[pathPoints.length - 1]);
        if (distToStart < LOOP_SNAP_THRESHOLD) {
            pathPoints[pathPoints.length - 1] = L.latLng(pathPoints[0].lat, pathPoints[0].lng);
            if (mainPath) mainPath.setLatLngs(pathPoints);
        }
    }

    isDrawing = false;
    map.doubleClickZoom.enable();
    totalDistance = calculateDistance(pathPoints);
    savePathToStorage();
    setUIState('ready');
}

function loadSavedPath() { 
    const raw = localStorage.getItem('customPath');
    if (!raw) return;
    const coords = JSON.parse(raw);
    pathPoints = coords.map(c => L.latLng(c[0], c[1]));

    if (mainPath) mainPath.remove();
    mainPath = L.polyline(pathPoints, { color: '#007aff', weight: 6, opacity: 0.85 }).addTo(map);

    totalDistance = calculateDistance(pathPoints);
    map.fitBounds(mainPath.getBounds(), { padding: [50, 50] });
    setUIState('ready');
}

function savePathToStorage() { 
    const data = pathPoints.map(p => [p.lat, p.lng]);
    localStorage.setItem('customPath', JSON.stringify(data));
}

function clearEverything() {
    if (mainPath) { mainPath.remove(); mainPath = null; }
    if (walkedPath) { walkedPath.remove(); walkedPath = null; }
    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
    pathPoints = [];
    totalDistance = 0;
    maxReachedIndex = 0;
    isDrawing = false;
    isNavigating = false;
    if (map) map.doubleClickZoom.enable();
    setUIState('idle');
}

function clearPath() {
    clearEverything();
    localStorage.removeItem('customPath');
}

function startNavigation() {
    if (pathPoints.length < 2) return;
    if (mainPath) mainPath.setStyle({ color: '#8e8e93', weight: 5, opacity: 0.6 });
    walkedPath = L.polyline([], { color: '#34c759', weight: 8, opacity: 1 }).addTo(map);

    maxReachedIndex = 0;
    isNavigating = true;
    updateInfo(0, 0, 0, 0); // initial render
    setUIState('navigating');
}

function stopNavigation() {
    isNavigating = false;
    if (walkedPath) { walkedPath.remove(); walkedPath = null; }
    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
    if (mainPath) mainPath.setStyle({ color: '#007aff', weight: 6, opacity: 0.85 }); // Restore color
    setUIState('ready');
}

window.onload = () => setTimeout(() => { if (!map) initializeApp(); }, 150);
