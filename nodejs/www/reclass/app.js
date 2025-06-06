const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
let showAreas = true;

// Configure base layer
const gmap_road = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_sat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_terrain = L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_hybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22
});


const ndvi = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/gwc/service/wms?", {
    layers: 'rubber:rubber4326',
    format: 'image/png',
    transparent: true,
    maxZoom: 24,
    zIndex: 5
});

const rubber_parcel = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/rubber/wms?", {
    layers: 'rubber:rubber_pacel',
    format: 'image/png',
    transparent: true,
    maxZoom: 24,
    zIndex: 6
});

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

const ndviTile = L.featureGroup();
const trueColorTile = L.featureGroup();

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map),
    "แปลงยาง(เดิม)": rubber_parcel,
    "NDVI": ndvi,
    "NDVI gee": ndviTile,
    "S2 gee": trueColorTile
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

fetch('/rub/api/gee')
    .then(res => res.json())
    .then((data) => {
        const truecolor = L.tileLayer(data.truecolor.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 3
        });

        const ndvi = L.tileLayer(data.ndvi.urlFormat, {
            attribution: 'Google Earth Engine',
            maxZoom: 24,
            zIndex: 4
        });

        // Add layers to map
        truecolor.addTo(trueColorTile);
        ndvi.addTo(ndviTile);
    });

// Configure Geoman controls
map.pm.addControls({
    position: 'topright',
    drawCircle: false,
    drawMarker: false,
    drawPolyline: true,
    drawRectangle: false,
    drawPolygon: false,
    editMode: true,
    dragMode: false,
    cutPolygon: false,
    removalMode: false,
    rotateMode: false,
    drawText: false,
    drawCircleMarker: false,
});

// Area calculation utilities
const formatArea = (area) => {
    return area >= 1e6
        ? `${(area / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
        : `${area.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²`;
};

const sub_id = document.getElementById('sub_id');
const xls_app_no = document.getElementById('xls_app_no');
const shpsplit_sqm = document.getElementById('shpsplit_sqm');
const classtype = document.getElementById('classtype');

function showFeaturePanel(feature, layer) {
    sub_id.value = feature.properties.sub_id;
    xls_app_no.value = feature.properties.app_no;
    shpsplit_sqm.value = Number(feature.properties.shpsplit_sqm).toFixed(0);
    classtype.value = feature.properties.classtype;
}

const getFeatureStyle = (feature) => {
    console.log('getFeatureStyle', feature);

    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'non-rubber'
            ? '#d7191c'
            : feature.properties.classtype === 'other'
                ? '#fdae61'
                : '#ff00ff';
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        dashArray: '3',
        fillOpacity: 0.2
    };
};

var selectedPolygon = null;
let highlightedLayer = null; // Track the currently highlighted layer

function onEachFeature(feature, layer) {
    featureGroup.addLayer(layer);
    layer.on({
        click: function (e) {
            selectedPolygon = layer;
            showFeaturePanel(feature, layer);
            if (highlightedLayer === e.target) {
                resetHighlight(e);
                highlightedLayer = null;
            } else {
                // Clicked new feature - highlight it
                if (highlightedLayer) {
                    resetHighlight({ target: highlightedLayer }); // Remove previous highlight
                }
                highlightFeature(e);
                highlightedLayer = e.target;
            }
        }
    });
}

var geojson;

function resetHighlight(e) {
    geojson.resetStyle(e.target);
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 5,
        color: '#0ccbf0',
        dashArray: '',
        fillOpacity: 0.3
    });
    layer.bringToFront();
}

const loadGeoData = async (id) => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch('/rub/api/getfeatures/' + tb + '/' + id);
        const { data } = await response.json();

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    sub_id: item.sub_id,
                    app_no: item.app_no,
                    shpsplit_sqm: item.shpsplit_sqm,
                    classtype: item.classtype
                }
            }))
        };

        geojson = L.geoJson(geoJsonData, {
            style: getFeatureStyle,
            onEachFeature: onEachFeature
        }).addTo(map);

        map.fitBounds(featureGroup.getBounds());
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

var selectedLine = null;
const handleLayerCreate = (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);
    layer.pm.enable({ allowSelfIntersection: true });
    selectedLine = layer;

    layer.on('pm:edit pm:dragend pm:update pm:change', () => console.log(layer));
    layer.on('click', () => {
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
    });
};

map.on('pm:create', handleLayerCreate);
map.on('pm:edit', (e) => {
    const layer = e.layer;
    featureGroup.eachLayer(l => l.pm.disable());
    layer.pm.enable();
});
map.on('click', () => featureGroup.eachLayer(l => l.pm.disable()));

const legend = L.control({ position: 'bottomright' });

legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'legend'),
        categories = ['rubber', 'non-rubber', 'other'],
        labels = ['ยางพารา', 'ไม่ใช่ยางพารา', 'ไม่แน่ใจ'];

    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { classtype: categories[i] } },
            style = getFeatureStyle(dummy);

        div.innerHTML +=
            `<i style="background:${style.fillColor};"></i> ${labels[i]}<br>`;
    }
    return div;
};

legend.addTo(map);

document.getElementById('classtype').addEventListener('change', (e) => {
    const selectedValue = e.target.value;
    const id = document.getElementById('id').value
    const tb = document.getElementById('tb').value;
    const displayName = document.getElementById('displayName').value;

    fetch('/rub/api/update_landuse/' + tb, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: id,
            sub_id: sub_id.value,
            classtype: selectedValue,
            displayName: displayName,
        })
    }).then(response => response.json())
        .then(async (data) => {
            if (data.success) {
                const id = document.getElementById('id').value;
                featureGroup.clearLayers();
                await loadGeoData(id);
            } else {
                alert('Update failed');
            }
        });
});

document.getElementById('clear').addEventListener('click', () => {
    if (highlightedLayer) {
        resetHighlight({ target: highlightedLayer });
        highlightedLayer = null;
    }

    selectedPolygon = null;
    selectedLine = null;
    sub_id.value = '';
    xls_app_no.value = '';
    shpsplit_sqm.value = '';
    classtype.value = '';
})

document.getElementById('split').addEventListener('click', () => {
    if (!selectedPolygon) {
        alert('เลือก polygon ก่อน');
        return;
    }
    if (!selectedLine) {
        alert('สร้าง line ที่จะใช้แบ่ง polygon ก่อน');
        return;
    }

    const id = document.getElementById('id').value;
    const polygon = selectedPolygon.toGeoJSON();
    const line = selectedLine.toGeoJSON();
    const displayName = document.getElementById('displayName').value;

    const srid = 32647;
    const data = {
        polygon_fc: polygon,
        line_fc: line,
        srid: srid,
        displayName: displayName,
    }

    const tb = document.getElementById('tb').value;
    fetch('/rub/api/splitfeature/' + tb, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    }).then(response => response.json())
        .then(async (data) => {
            if (data.success) {
                featureGroup.clearLayers();
                await loadGeoData(id);
            } else {
                alert('Split failed');
            }
        })
});

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});

const initApp = async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const id = urlParams.get('id');
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }

        document.getElementById('id').value = id;
        document.getElementById('tb').value = tb;
        await loadGeoData(id);
    } catch (error) {
        console.error('Error loading data:', error);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        if (user) {
            document.getElementById('google-login-link').style.display = 'none';
            document.getElementById('profile-section').style.display = 'flex';
            document.getElementById('profile-image').src = user.photo;
            document.getElementById('display-name').textContent = user.displayName;
            document.getElementById('displayName').value = user.displayName;

            await initApp();

            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    const result = await fetch('/rub/auth/logout');
                    const { success } = await result.json();
                    if (success) {
                        window.location.href = '/rub/index.html';
                    } else {
                        alert('Logout failed');
                    }
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        } else {
            window.location.href = '/rub/index.html';
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});