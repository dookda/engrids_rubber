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
    editMode: false,
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

function showFeaturePanel(feature, layer) {
    const id = document.getElementById('id');
    const xls = Number(feature.properties.xls_sqm);
    const shp = Number(feature.properties.shp_sqm);
    const shparea = Number(feature.properties.shparea_sqm);

    console.log(shparea);


    const shp_app_no = document.getElementById('shp_app_no');
    const xls_app_no = document.getElementById('xls_app_no');
    const xls_sqm = document.getElementById('xls_sqm');
    const shp_sqm = document.getElementById('shp_sqm');
    const shparea_sqm = document.getElementById('shparea_sqm');

    id.textContent = feature.properties.id;
    shp_app_no.textContent = feature.properties.shp_app_no;
    xls_app_no.textContent = feature.properties.xls_app_no;
    xls_sqm.textContent = formatArea(xls);
    shp_sqm.textContent = formatArea(shp);
    shparea_sqm.textContent = formatArea(shparea);
    // updateAreaLabel(layer);
}

const getFeatureStyle = (feature) => {
    const id = feature.properties.id;
    const xls = Number(feature.properties.xls_sqm);
    const shp = Number(feature.properties.shparea_sqm);
    const isEqual = Math.abs(xls - shp) <= 100;
    // console.log(`id: ${id}, xls: ${xls}, shp: ${shp}, isEqual: ${isEqual}`);

    return {
        color: isEqual ? '#00cc00' : '#ca0020',
        weight: 2,
        opacity: 0.7,
        fillColor: isEqual ? '#90ee90' : '#f4a582',
        fillOpacity: 0.2
    };
};

const loadGeoData = async () => {
    try {
        const response = await fetch('/api/getfeatures');
        const { data } = await response.json();

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    shp_app_no: item.shp_app_no,
                    xls_app_no: item.xls_app_no,
                    xls_sqm: item.xls_sqm,
                    shp_sqm: item.shp_sqm,
                    shparea_sqm: Number(item.shparea_sqm || 0).toFixed(0)
                }
            }))
        };

        L.geoJSON(geoJsonData, {
            style: {
                color: '#3388ff',
                weight: 2,
                opacity: 0.7,
                fillOpacity: 0.2
            },
            onEachFeature: (feature, layer) => {
                featureGroup.addLayer(layer);
                layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));

                layer.on('click', (e) => {
                    e.originalEvent.preventDefault();
                    showFeaturePanel(feature, layer);
                    // map.fitBounds(layer.getBounds());
                    // featureGroup.eachLayer(l => l.pm.disable());
                    // layer.pm.enable();
                    // layer.bringToFront();
                    layer.setStyle({
                        weight: 3,
                        color: '#ff0000'
                    });

                    // Reset style on other layers
                    featureGroup.eachLayer(otherLayer => {
                        if (otherLayer !== layer) {
                            otherLayer.setStyle({
                                weight: 2,
                                color: '#3388ff'
                            });
                        }
                    });
                });
            }
        })

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

// Layer event handling
const handleLayerCreate = (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);

    layer.pm.enable({ allowSelfIntersection: false });
    // updateAreaLabel(layer);

    // layer.on('pm:edit pm:dragend pm:update', () => updateAreaLabel(layer));
    layer.on('click', () => {
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
    });
};


// Update event listeners section to include pm:cut
map.on('pm:create', handleLayerCreate);
map.on('click', () => featureGroup.eachLayer(l => l.pm.disable()));

// Toggle visibility control
document.getElementById('toggleArea').addEventListener('click', () => {
    showAreas = !showAreas;
    document.getElementById('toggleArea').textContent = showAreas ? 'Hide Areas' : 'Show Areas';
    featureGroup.eachLayer(updateAreaLabel);
});

document.addEventListener('DOMContentLoaded', () => {
    loadGeoData();
});