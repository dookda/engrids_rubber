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

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid
};

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map)
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

// Configure Geoman controls
map.pm.addControls({
    position: 'topleft',
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

const calculateArea = (layer) => {
    const feature = layer instanceof L.Polygon
        ? turf.polygon([layer.getLatLngs()[0].map(latlng => [latlng.lng, latlng.lat])])
        : turf.bboxPolygon(layer.getBounds().toBBoxString());

    return turf.area(feature);
};

// Label management
const updateAreaLabel = (layer) => {
    if (layer.areaLabel) {
        layer.areaLabel.remove();
    }

    if (showAreas) {
        const area = calculateArea(layer);
        const centroid = turf.centroid(layer instanceof L.Polygon
            ? turf.polygon([layer.getLatLngs()[0].map(latlng => [latlng.lng, latlng.lat])])
            : turf.bboxPolygon(layer.getBounds().toBBoxString())
        ).geometry.coordinates;

        layer.areaLabel = L.marker(L.latLng(centroid[1], centroid[0]), {
            icon: L.divIcon({
                className: 'area-label',
                html: formatArea(area),
                iconSize: null
            }),
            interactive: false
        }).addTo(map);
    }
};

const sub_id = document.getElementById('sub_id');
const xls_app_no = document.getElementById('xls_app_no');
const shparea_sqm = document.getElementById('shparea_sqm');
const classtype = document.getElementById('classtype');

function showFeaturePanel(feature, layer) {
    sub_id.value = feature.properties.sub_id;
    xls_app_no.value = feature.properties.xls_app_no;
    shparea_sqm.value = Number(feature.properties.shparea_sqm).toFixed(0);
    classtype.value = feature.properties.classtype;
}

const style = (feature) => {
    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'building'
            ? '#d7191c'
            : feature.properties.classtype === 'agriculture'
                ? '#a6d96a'
                : feature.properties.classtype === 'water'
                    ? '#2b83ba'
                    : '#ff00ff';
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        dashArray: '3',
        fillOpacity: 0.5
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

function resetHighlight(e) {
    geojson.resetStyle(e.target);
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 5,
        color: '#0ccbf0',
        dashArray: '',
        fillOpacity: 0.7
    });
    layer.bringToFront();
}

const loadGeoData = async (id) => {
    try {
        const response = await fetch('/rub/api/getfeatures/' + id);
        const { data } = await response.json();

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    sub_id: item.sub_id,
                    xls_app_no: item.xls_app_no,
                    shparea_sqm: item.shparea_sqm,
                    classtype: item.classtype
                }
            }))
        };

        geojson = L.geoJson(geoJsonData, {
            style: style,
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
    layer.pm.enable({ allowSelfIntersection: false });
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

document.getElementById('classtype').addEventListener('change', (e) => {
    const selectedValue = e.target.value;
    fetch('/rub/api/update_landuse', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sub_id: sub_id.value,
            classtype: selectedValue
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
    shparea_sqm.value = '';
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

    const srid = 32647;
    const data = {
        polygon_fc: polygon,
        line_fc: line,
        srid: srid,
    }

    fetch('/rub/api/split', {
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

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id || id === 'undefined') {
        alert('เลือกแปลงยางก่อน');
        window.location.href = './../../reshape/index.html';
        return;
    }
    document.getElementById('id').value = id;
    loadGeoData(id);
});