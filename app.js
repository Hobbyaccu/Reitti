let map = null;
let mainPath = null;
let walkedPath = null;
let accuracyCircle = null;
let headingMarker = null;
let offPathLine = null;
let pathPoints = [];
let isDrawing = false;
let isNavigating = false;
let locationWatchId = null;
let totalDistance = 0;
let hasEnteredFullscreen = false;
let editMarkers = [];
let isEditing = false;
let currentWaypointIndex = 1; 
let wakeLock = null;
let hasAnnouncedTurn = false;
let editUndoStack = [];

// silent audio.. idk?
const silentWavData = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const heartbeatAudio = new Audio(silentWavData);
heartbeatAudio.loop = true;


const OFF_PATH_THRESHOLD = 40;
const LOOP_SNAP_THRESHOLD = 30;
const TURN_ANNOUNCE_THRESHOLD = 10; // Trigger audio 10m before turn
const WAYPOINT_REACHED_THRESHOLD = 15; // Must get within 15m to progress to the next line

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

function calculateDistance(pts) {
    let d = 0;
    for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
    return d;
}

function closestPointOnSegment(p, a, b) {
    const scale = Math.cos(a.lat * Math.PI / 180); 
    const dx = (b.lng - a.lng) * scale;
    const dy = b.lat - a.lat;
    const len2 = dx * dx + dy * dy;
    
    if (len2 === 0) return { point: a, t: 0 };
    
    let t = (((p.lng - a.lng) * scale) * dx + (p.lat - a.lat) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    
    return { point: L.latLng(a.lat + t * dy, a.lng + (t * dx) / scale), t };
}

// Determines Left or Right based on 3 points (prev, current, next)
function getTurnDirection(pPrev, pCurr, pNext) {
    const scale = Math.cos(pCurr.lat * Math.PI / 180);
    
    // Vector 1 (Entering the turn)
    const dx1 = (pCurr.lng - pPrev.lng) * scale;
    const dy1 = pCurr.lat - pPrev.lat;
    
    // Vector 2 (Exiting the turn)
    const dx2 = (pNext.lng - pCurr.lng) * scale;
    const dy2 = pNext.lat - pCurr.lat;

    // 2D Cross Product
    const cross = dx1 * dy2 - dy1 * dx2;
    
    // Calculate angle to filter out slight bends (Dot Product)
    const dot = dx1 * dx2 + dy1 * dy2;
    const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (mag1 === 0 || mag2 === 0) return null;
    
    const angle = Math.acos(dot / (mag1 * mag2)) * (180 / Math.PI);
    
    // If the turn is less than 20 degrees, it's just a curve, don't announce
    if (angle < 20) return null;

    // Cross product > 0 is a Left turn in map coordinates
    return cross > 0 ? 'Left' : 'Right';
}

// --- AUDIO & BACKGROUND HANDLERS ---
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log("☀️ Wake Lock active");
        }
    } catch (err) {
        console.error(`Wake Lock error: ${err.message}`);
    }
}

function initMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Navigating Route',
            artist: 'Nav App',
            album: 'Background Mode Active'
        });
        navigator.mediaSession.setActionHandler('play', () => heartbeatAudio.play());
        navigator.mediaSession.setActionHandler('pause', () => heartbeatAudio.pause());
    }
}

function announceTurn(direction) {
    console.log(`🔊 Announcing Turn: ${direction}`);
    const sound = new Audio(`${direction}.mp3`);
    sound.play().catch(e => console.log("Audio play blocked", e));
}

// --- MAP UPDATES ---
function updateAccuracyCircle(rawPos, accuracy) {
    if (!accuracyCircle) {
        accuracyCircle = L.circle(rawPos, {
            radius: accuracy || 30,
            color: '#007aff',
            fillColor: '#007aff',
            fillOpacity: 0.15,
            weight: 0
        }).addTo(map);
    } else {
        accuracyCircle.setLatLng(rawPos).setRadius(accuracy || 30);
    }
}

function updateHeading(rawPos, heading) {
    if (!headingMarker) {
        headingMarker = L.marker(rawPos, {
            icon: L.divIcon({
                className: 'heading-arrow',
                html: `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:32px; color:#007aff; text-shadow:0 2px 6px rgba(0,0,0,0.3);">▲</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            }),
            zIndexOffset: 1000
        }).addTo(map);
    } else {
        headingMarker.setLatLng(rawPos);
    }

    const el = headingMarker.getElement();
    if (el) {
        const div = el.querySelector('div');
        if (div) {
            div.style.transform = heading !== null ? `rotate(${heading}deg)` : 'rotate(0deg)';
        }
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
function saveEditState() {
    // Only save if the path actually changed (avoid duplicates)
    const currentSerialized = JSON.stringify(pathPoints.map(p => [p.lat, p.lng]));
    
    if (editUndoStack.length === 0 || 
        editUndoStack[editUndoStack.length - 1] !== currentSerialized) {
        
        editUndoStack.push(currentSerialized);
        
        // Limit stack size
        if (editUndoStack.length > 30) {
            editUndoStack.shift();
        }
    }
}

function refreshEditMarkers() {
    // Clear old markers
    editMarkers.forEach(m => m.remove());
    editMarkers = [];

    // Rebuild endpoint markers
    for (let i = 0; i < pathPoints.length; i++) {
        const marker = L.marker(pathPoints[i], {
            draggable: true,
            icon: L.divIcon({
                className: 'edit-point',
                html: `<div style="width:18px;height:18px;background:#007aff;border:3px solid white;border-radius:50%;box-shadow:0 3px 10px rgba(0,0,0,0.4);"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            })
        }).addTo(map);

        marker.on('drag', (e) => {
            pathPoints[i] = e.target.getLatLng();
            if (mainPath) mainPath.setLatLngs(pathPoints);
        });

        marker.on('dragend', () => {
            saveEditState();           // Save only after drag ends
            refreshEditMarkers();      // Rebuild markers (without saving again immediately)
        });

        editMarkers.push(marker);
    }

    // Rebuild midpoint markers
    for (let i = 0; i < pathPoints.length - 1; i++) {
        const midLat = (pathPoints[i].lat + pathPoints[i + 1].lat) / 2;
        const midLng = (pathPoints[i].lng + pathPoints[i + 1].lng) / 2;

        const midMarker = L.marker([midLat, midLng], {
            draggable: true,
            icon: L.divIcon({
                className: 'edit-midpoint',
                html: `<div style="width:14px;height:14px;background:#007aff;border-radius:50%;border:2px solid white;opacity:0.85;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            })
        }).addTo(map);

        let tempPointIndex = i + 1;

        midMarker.on('drag', (e) => {
            const tempPoints = [...pathPoints];
            tempPoints.splice(tempPointIndex, 0, e.target.getLatLng());
            if (mainPath) mainPath.setLatLngs(tempPoints);
        });

        midMarker.on('dragend', (e) => {
            pathPoints.splice(tempPointIndex, 0, e.target.getLatLng());
            if (mainPath) mainPath.setLatLngs(pathPoints);
            saveEditState();           // Save only after successful add
            refreshEditMarkers();
        });

        editMarkers.push(midMarker);
    }
}

function undoEdit() {
    if (editUndoStack.length <= 1) {
        // Disable button visually when nothing left to undo
        const undoBtn = document.getElementById('edit-undo-btn');
        if (undoBtn) undoBtn.disabled = true;
        return;
    }
    editUndoStack.pop();

    const previousSerialized = editUndoStack[editUndoStack.length - 1];
    const previousCoords = JSON.parse(previousSerialized);
    
    pathPoints = previousCoords.map(c => L.latLng(c[0], c[1]));

    if (mainPath) mainPath.setLatLngs(pathPoints);
    totalDistance = calculateDistance(pathPoints);

    refreshEditMarkers();   // Rebuild markers

    // Re-enable undo button if we still have history
    const undoBtn = document.getElementById('edit-undo-btn');
    if (undoBtn) undoBtn.disabled = editUndoStack.length <= 1;
}

function enterEditMode() {
    isEditing = true;
    isDrawing = false;
    map.doubleClickZoom.disable();

    if (mainPath) mainPath.setStyle({ color: '#007aff', weight: 6, opacity: 0.85 });

    editUndoStack = [];
    saveEditState();
    refreshEditMarkers();

    setUIState('editing');

    // Make sure undo button starts disabled (nothing to undo yet)
    const undoBtn = document.getElementById('edit-undo-btn');
    if (undoBtn) undoBtn.disabled = true;
}

function finishEditing() {
    isEditing = false;
    editMarkers.forEach(m => m.remove());
    editMarkers = [];
    editUndoStack = [];
    map.doubleClickZoom.enable();

    totalDistance = calculateDistance(pathPoints);
    savePathToStorage();
    setUIState('ready');
}

function cancelEditing() {
    isEditing = false;
    editMarkers.forEach(m => m.remove());
    editMarkers = [];
    editUndoStack = [];
    map.doubleClickZoom.enable();
    setUIState('ready');
}

function startPermanentLocationWatch() {
    if (locationWatchId) return;
    locationWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const rawPos = L.latLng(pos.coords.latitude, pos.coords.longitude);
            const acc = pos.coords.accuracy || 30;

            updateAccuracyCircle(rawPos, acc);
            updateHeading(rawPos, pos.coords.heading);

            if (isNavigating) {
                const distToUpcoming = rawPos.distanceTo(pathPoints[currentWaypointIndex]);

                // 1. ANNOUNCE TURN LOGIC (Trigger between 15m and 35m)
                if (!hasAnnouncedTurn && distToUpcoming <= TURN_ANNOUNCE_THRESHOLD && currentWaypointIndex < pathPoints.length - 1) {
                    const pPrev = pathPoints[currentWaypointIndex - 1];
                    const pCurr = pathPoints[currentWaypointIndex];
                    const pNext = pathPoints[currentWaypointIndex + 1];
                    
                    const direction = getTurnDirection(pPrev, pCurr, pNext);
                    if (direction) announceTurn(direction);
                    
                    hasAnnouncedTurn = true; // Prevent spamming
                }

                // 2. WAYPOINT PROGRESSION CHECK
                while (currentWaypointIndex < pathPoints.length && rawPos.distanceTo(pathPoints[currentWaypointIndex]) < WAYPOINT_REACHED_THRESHOLD) {
                    currentWaypointIndex++;
                    hasAnnouncedTurn = false; // Reset for the next waypoint
                }

                // 3. COMPLETION CHECK
                if (currentWaypointIndex >= pathPoints.length) {
                    updateInfo(totalDistance, pos.coords.speed, acc, 0);
                    walkedPath.setLatLngs(pathPoints);
                    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
                    
                    setTimeout(() => {
                        alert("🎉 You've reached the end! Great job!");
                        stopNavigation();
                    }, 100);
                    return; 
                }

                // 4. PROJECT ONTO ACTIVE SEGMENT
                const targetPt = pathPoints[currentWaypointIndex];
                const prevPt = pathPoints[currentWaypointIndex - 1];
                const projection = closestPointOnSegment(rawPos, prevPt, targetPt);
                const projPt = projection.point;
                const distToPath = rawPos.distanceTo(projPt);

                // 5. CALCULATE TRAVELED DISTANCE
                let traveledSoFar = 0;
                for (let i = 0; i < currentWaypointIndex - 1; i++) {
                    traveledSoFar += pathPoints[i].distanceTo(pathPoints[i + 1]);
                }
                traveledSoFar += prevPt.distanceTo(projPt);

                // 6. UPDATE MAP VISUALS
                const walkedPts = pathPoints.slice(0, currentWaypointIndex);
                walkedPts.push(projPt);
                walkedPath.setLatLngs(walkedPts);

                if (distToPath > OFF_PATH_THRESHOLD) {
                    if (!offPathLine) offPathLine = L.polyline([rawPos, projPt], { color: '#ff3b30', weight: 3, opacity: 0.8, dashArray: '6, 6' }).addTo(map);
                    else offPathLine.setLatLngs([rawPos, projPt]);
                } else if (offPathLine) { 
                    offPathLine.remove(); 
                    offPathLine = null; 
                }

                map.panTo(rawPos, { animate: true });
                updateInfo(traveledSoFar, pos.coords.speed, acc, distToPath);
            }
        },
        (err) => { if (err.code !== 1) console.error(err); },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
}

async function enterFullscreen() {
    if (hasEnteredFullscreen || !document.fullscreenEnabled) return;

    try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        hasEnteredFullscreen = true;
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
        () => { }
    );

    map.on('click', e => {
        if (!isDrawing) return;
        pathPoints.push(e.latlng);
        if (mainPath) mainPath.setLatLngs(pathPoints);
        else mainPath = L.polyline(pathPoints, { color: '#007aff', weight: 6, opacity: 0.85 }).addTo(map);

        document.getElementById('undo-btn').disabled = false;
        if (pathPoints.length >= 2) document.getElementById('finish-btn').disabled = false;
    });

    setUIState('idle');

    const handleFirstInteraction = () => {
        enterFullscreen();
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
        () => alert("Couldn't get location")
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
    currentWaypointIndex = 1;
    isDrawing = false;
    isNavigating = false;
    if (map) map.doubleClickZoom.enable();
    setUIState('idle');
}

function clearPath() {
    clearEverything();
    localStorage.removeItem('customPath');
}

async function startNavigation() {
    if (pathPoints.length < 2) return;
    
    // Kick off all background survival tactics on user gesture
    heartbeatAudio.play().catch(e => console.log("Heartbeat blocked", e));
    initMediaSession();
    await requestWakeLock();
    hasAnnouncedTurn = false;

    if (mainPath) mainPath.setStyle({ color: '#8e8e93', weight: 5, opacity: 0.6 });
    walkedPath = L.polyline([pathPoints[0]], { color: '#34c759', weight: 8, opacity: 1 }).addTo(map);

    currentWaypointIndex = 1; 
    isNavigating = true;
    updateInfo(0, 0, 0, 0);
    setUIState('navigating');
}

function stopNavigation() {
    isNavigating = false;
    heartbeatAudio.pause();
    if (wakeLock) wakeLock.release().then(() => wakeLock = null);
    
    if (walkedPath) { walkedPath.remove(); walkedPath = null; }
    if (offPathLine) { offPathLine.remove(); offPathLine = null; }
    if (mainPath) mainPath.setStyle({ color: '#007aff', weight: 6, opacity: 0.85 }); 
    setUIState('ready');
}

window.onload = () => setTimeout(() => { if (!map) initializeApp(); }, 150);
