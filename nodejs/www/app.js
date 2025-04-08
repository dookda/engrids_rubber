// Initialize map and feature group
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
    drawPolyline: false,
    drawRectangle: false,
    drawPolygon: true,
    editMode: false,
    dragMode: false,
    cutPolygon: true,
    removalMode: true,
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

// Label management
const updateAreaLabel = (layer) => {
    try {
        const geojsonFeature = layer.toGeoJSON();
        const area = turf.area(geojsonFeature);

        if (layer.areaLabel) layer.areaLabel.remove();

        if (showAreas) {
            const centroid = turf.centroid(geojsonFeature);

            layer.areaLabel = L.marker([centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]], {
                icon: L.divIcon({
                    className: 'area-label',
                    html: formatArea(area),
                    iconSize: null
                }),
                interactive: false
            }).addTo(map);
        }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

function showFeaturePanel(feature) {
    console.log('Feature clicked:', feature);

    const panel = document.getElementById('featurePanel');
    const content = `
        <h4>id ${feature.properties.xls_id}</h4>
        <div><strong>Shape App No:</strong> ${feature.properties.shp_app_no}</div>
        <div><strong>Excel App No:</strong> ${feature.properties.xls_app_no}</div>
        <div><strong>Excel Area:</strong> ${feature.properties.xls_sqm} m²</div>
        <div><strong>Shape Area:</strong> ${feature.properties.shp_sqm} m²</div>
        <div><strong>Calculated Area:</strong> ${feature.properties.shparea_sqm} m²</div>
    `;

    panel.innerHTML = content;
}

// Load initial data from API
const loadGeoData = async () => {
    try {
        const response = await fetch('/api/getdata');
        const { data } = await response.json();

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    xls_id: item.xls_id,
                    shp_app_no: item.shp_app_no,
                    xls_app_no: item.xls_app_no,
                    xls_sqm: item.xls_sqm,
                    shp_sqm: item.shp_sqm,
                    shparea_sqm: item.shparea_sqm
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
                // const popupContent = `
                //     <div class="feature-popup">
                //         <h4>Application ${feature.properties.xls_id}</h4>
                //         <p>Shape App No: ${feature.properties.shp_app_no}</p>
                //         <p>Excel App No: ${feature.properties.xls_app_no}</p>
                //         <p>Excel Area: ${feature.properties.xls_sqm} m²</p>
                //         <p>Shape Area: ${feature.properties.shp_sqm} m²</p>
                //         <p>Calculated Area: ${feature.properties.shparea_sqm} m²</p>
                //     </div>
                // `;

                // layer.bindPopup(popupContent);
                featureGroup.addLayer(layer);
                layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));
                layer.on('click', () => {
                    showFeaturePanel(feature);
                    featureGroup.eachLayer(l => l.pm.disable());
                    layer.pm.enable();
                });
            }
        }).addTo(map);

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

// Event handlers
const handleLayerCreate = (e) => {
    const layer = e.layer;
    featureGroup.addLayer(layer);

    layer.pm.enable({ allowSelfIntersection: false });
    updateAreaLabel(layer);

    layer.on('pm:edit pm:dragend pm:update', () => updateAreaLabel(layer));
    layer.on('click', () => {
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();
    });
};

map.on('pm:create', handleLayerCreate);
map.on('pm:remove', (e) => e.layer.areaLabel?.remove());
map.on('click', () => featureGroup.eachLayer(l => l.pm.disable()));

// Toggle visibility control
document.getElementById('toggleArea').addEventListener('click', () => {
    showAreas = !showAreas;
    document.getElementById('toggleArea').textContent = showAreas ? 'Hide Areas' : 'Show Areas';
    featureGroup.eachLayer(updateAreaLabel);
});

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    loadGeoData();
});