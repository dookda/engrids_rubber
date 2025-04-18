// Initialize map and feature group
const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();

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

// Label management
const updateAreaLabel = async (layer) => {
    try {
        const geojsonFeature = layer.toGeoJSON();
        const area = await turf.area(geojsonFeature);
        const xls_sqm = document.getElementById('xls_sqm').value;

        document.getElementById('shparea_sqm').value = area.toFixed(0);
        const diff = Math.abs(area - xls_sqm);

        if (diff >= 100) {
            document.getElementById('message').style.color = 'red';
            document.getElementById('message').innerHTML = 'เนื้อที่ไม่เท่ากัน';
        } else {
            document.getElementById('message').style.color = 'green';
            document.getElementById('message').innerHTML = 'เนื้อที่ใกล้เคียงกัน';
        }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

function showFeaturePanel(feature, layer) {
    const xls = Number(feature.properties.xls_sqm);
    const id = document.getElementById('id');
    const xls_app_no = document.getElementById('xls_app_no');
    const xls_sqm = document.getElementById('xls_sqm');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.xls_app_no;
    xls_sqm.value = feature.properties.xls_sqm;
    updateAreaLabel(layer);
}

const getFeatureStyle = (feature) => {
    const id = feature.properties.id;
    const xls = Number(feature.properties.xls_sqm);
    const shp = Number(feature.properties.shparea_sqm);
    const isEqual = Math.abs(xls - shp) <= 100;

    return {
        color: isEqual ? '#00cc00' : '#ca0020',
        weight: 2,
        opacity: 0.7,
        fillColor: isEqual ? '#90ee90' : '#f4a582',
        fillOpacity: 0.2
    };
};

var selectedLayer = null;
const loadGeoData = async () => {
    try {
        const response = await fetch('/rub/api/getfeatures');
        const { data } = await response.json();

        const geoJsonData = {
            type: 'FeatureCollection',
            features: data.map(item => ({
                type: 'Feature',
                geometry: JSON.parse(item.geom),
                properties: {
                    id: item.id,
                    xls_app_no: item.xls_app_no,
                    xls_sqm: item.xls_sqm,
                    shparea_sqm: Number(item.shparea_sqm || 0).toFixed(0)
                }
            }))
        };

        // Initialize DataTable
        const tableData = geoJsonData.features.map(feature => ({
            id: feature.properties.id,
            xls_app_no: feature.properties.xls_app_no,
            xls_sqm: feature.properties.xls_sqm,
            shparea_sqm: feature.properties.shparea_sqm
        }));

        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            columns: [
                { data: 'id', title: 'ID' },
                { data: 'xls_app_no', title: 'Application No' },
                { data: 'xls_sqm', title: 'เนื้อที่เป้าหมาย (m²)' },
                { data: 'shparea_sqm', title: 'เนื้อที่ขณะนี้ (m²)' },
                {
                    data: null,
                    title: 'Area Difference (m²)',
                    render: (data) => {
                        const xls = Number(data.xls_sqm);
                        const shp = Number(data.shparea_sqm);
                        const diff = xls - shp;
                        const color = Math.abs(diff) <= 100 ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">${diff.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>`;
                        // return `${diff.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                    }
                }
            ],
            pageLength: 10,
            responsive: false,
            select: true,
            destroy: true,
            scrollX: true,
        });

        // Map features to layers for easy lookup
        const layerMap = new Map();

        // Create GeoJSON layer but don't add to map yet
        L.geoJSON(geoJsonData, {
            style: getFeatureStyle,
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`${feature.properties.id}`);
                layerMap.set(feature.properties.id, layer); // Store layer for filtering and interaction

                layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));
                layer.on('click', () => {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(feature, layer);
                    featureGroup.eachLayer(l => l.pm.disable());
                    layer.pm.enable();

                    selectedLayer = layer;
                });
            }
        });

        // Function to update map based on filtered DataTable rows
        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();
            visibleRows.forEach(row => {
                const layer = layerMap.get(row.id);
                if (layer) {
                    featureGroup.addLayer(layer);
                }
            });
        };

        updateMap();

        dataTable.on('draw', () => {
            updateMap();
        });

        $('#featureTable tbody').on('click', 'tr', function (e) {
            // Avoid triggering row click if zoom button is clicked
            if (!$(e.target).hasClass('zoom-btn')) {
                const rowData = dataTable.row(this).data();
                const layer = layerMap.get(rowData.id);
                if (layer) {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(layer.feature, layer);
                    featureGroup.eachLayer(l => l.pm.disable());
                    layer.pm.enable();

                    selectedLayer = layer;
                }
            }
        });

        // Add row IDs for selection
        dataTable.rows().every(function () {
            const rowData = this.data();
            $(this.node()).attr('id', `row_${rowData.id}`);
        });

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

map.on('click', (e) => featureGroup.eachLayer(l => l.pm.disable()));

document.getElementById('save').addEventListener('click', async () => {
    if (!selectedLayer) {
        alert('กรุณาเลือกแปลงที่ต้องการบันทึกก่อน');
        return;
    }

    const features = [];
    features.push(selectedLayer.toGeoJSON());

    try {
        const response = await fetch('/rub/api/updatefeatures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features })
        });
        const result = await response.json();
        alert(`Updated ${result.updated} features`);

        if (result.success) {
            featureGroup.eachLayer(layer => {
                layer.pm.disable();
                layer.areaLabel?.remove();
            });

            featureGroup.clearLayers();
            loadGeoData();
        } else {
            alert('Failed to update features');
        }
    } catch (error) {
        console.error('Error saving data:', error);
        alert('Failed to save data');
    }
});

document.getElementById('classify').addEventListener('click', () => {
    const id = document.getElementById('id').value;
    if (!id) {
        alert('เลือกแปลงที่ต้องการ classify ก่อน');
        return;
    }
    fetch(`/rub/api/create_reclass_layer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).then(response => response.json())
        .then(data => {
            if (data.success) {
                window.open(`/rub/reclass/index.html?id=${id}`, '_self');
            } else {
                alert('Failed to create reclassification layer');
            }
        }).catch(error => {
            console.error('Error creating reclassification layer:', error);
            alert('Failed to create reclassification layer');
        });
});

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    loadGeoData();
});

