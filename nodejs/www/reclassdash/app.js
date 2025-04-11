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
        // const xls_sqm = document.getElementById('xls_sqm').value;

        // document.getElementById('shparea_sqm').value = area.toFixed(0);
        // const diff = Math.abs(area - xls_sqm);

        // if (diff >= 100) {
        //     document.getElementById('message').style.color = 'red';
        //     document.getElementById('message').innerHTML = 'เนื้อที่ไม่ตรงกัน';
        // } else {
        //     document.getElementById('message').style.color = 'green';
        //     document.getElementById('message').innerHTML = 'เนื้อที่ใกล้เคียงกัน';
        // }

        // if (layer.areaLabel) layer.areaLabel.remove();

        // if (showAreas) {
        // const centroid = turf.centroid(geojsonFeature);
        // layer.areaLabel = L.marker([centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]], {
        //     icon: L.divIcon({
        //         className: 'area-label',
        //         html: formatArea(area),
        //         iconSize: null
        //     }),
        //     interactive: false
        // }).addTo(map);

        // }
    } catch (error) {
        console.error('Error updating label:', error);
    }
};

function showFeaturePanel(feature, layer) {
    const xls = Number(feature.properties.xls_sqm);
    const id = document.getElementById('id');
    const xls_app_no = document.getElementById('xls_app_no');
    const classtype = document.getElementById('classtype');
    const shparea_sqm = document.getElementById('shparea_sqm');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.xls_app_no;
    classtype.value = feature.properties.classtype === 'rubber' ? 'ยางพารา' : feature.properties.classtype === 'building' ? 'สิ่งปลูกสร้าง' : feature.properties.classtype === 'agriculture' ? 'พท.เกษตร (ไม่ใช่ยางพารา)' : feature.properties.classtype === 'water' ? 'แหล่งน้ำ' : 'อื่นๆ';
    shparea_sqm.value = Number(feature.properties.shparea_sqm).toFixed(0);
    // updateAreaLabel(layer);
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

const loadGeoData = async () => {
    try {
        const response = await fetch('/rub/api/getreclassfeatures');
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
                    classtype: item.classtype,
                    shparea_sqm: Number(item.shparea_sqm || 0).toFixed(0)
                }
            }))
        };

        const tableData = geoJsonData.features.map(feature => ({
            id: feature.properties.id,
            xls_app_no: feature.properties.xls_app_no,
            xls_sqm: feature.properties.xls_sqm,
            classtype: feature.properties.classtype,
            shparea_sqm: feature.properties.shparea_sqm
        }));

        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            columns: [
                { data: 'xls_app_no', title: 'Application No' },
                { data: 'id', title: 'sub_id' },
                { data: 'xls_sqm', title: 'เนื้อที่รวมของแปลงนี้ (m²)' },
                { data: 'shparea_sqm', title: 'เนื้อที่ส่วนนี้ (m²)' },
                {
                    data: 'classtype',
                    title: 'ประเภท',
                    render: (data) => {
                        return data === 'rubber' ? 'แปลงยาง' : data === 'building' ? 'อาคาร' : data === 'agriculture' ? 'เกษตรกรรม' : data === 'water' ? 'น้ำ' : 'อื่นๆ';
                    }
                },
                // {
                //     data: null,
                //     title: 'Actions',
                //     orderable: false,
                //     searchable: false,
                //     render: (data, type, row) => {
                //         return `<button class="btn btn-info zoom-btn" data-id="${row.id}">Zoom to Feature</button>`;
                //     }
                // }
            ],
            pageLength: 10,
            responsive: true,
            select: true,
            destroy: true,
            scrollX: true,
        });

        // Map features to layers for easy lookup
        const layerMap = new Map();

        // Create GeoJSON layer but don't add to map yet
        L.geoJSON(geoJsonData, {
            style: style,
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`${feature.properties.id}`);
                layerMap.set(feature.properties.id, layer); // Store layer for filtering and interaction

                // layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));
                layer.on('click', () => {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(feature, layer);
                    // featureGroup.eachLayer(l => l.pm.disable());
                    // layer.pm.enable();

                    // Highlight row in DataTable
                    dataTable.rows().deselect();
                    dataTable.row(`#row_${feature.properties.id}`).select();
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

        // Initial map population
        updateMap();

        // Update map when DataTable is filtered or redrawn
        dataTable.on('draw', () => {
            updateMap();
        });

        // Add click event to DataTable rows
        $('#featureTable tbody').on('click', 'tr', function (e) {
            // Avoid triggering row click if zoom button is clicked
            if (!$(e.target).hasClass('zoom-btn')) {
                const rowData = dataTable.row(this).data();
                const layer = layerMap.get(rowData.id);
                if (layer) {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(layer.feature, layer);
                    // featureGroup.eachLayer(l => l.pm.disable());
                    // layer.pm.enable();
                }
            }
        });

        // Add click event for zoom buttons
        $('#featureTable tbody').on('click', '.zoom-btn', function () {
            const id = $(this).data('id');
            const layer = layerMap.get(id);
            if (layer) {
                map.fitBounds(layer.getBounds());
                showFeaturePanel(layer.feature, layer);
                // featureGroup.eachLayer(l => l.pm.disable());
                // layer.pm.enable();

                // Highlight row in DataTable
                dataTable.rows().deselect();
                dataTable.row(`#row_${id}`).select();
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
map.on('click', (e) => featureGroup.eachLayer(l => l.pm.disable()));


// document.getElementById('save').addEventListener('click', async () => {
//     const features = featureGroup.toGeoJSON().features;
//     try {
//         const response = await fetch('/rub/api/updatefeatures', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ features })
//         });
//         const result = await response.json();
//         alert(`Updated ${result.updated} features`);

//         if (result.success) {
//             featureGroup.eachLayer(layer => {
//                 layer.pm.disable();
//                 layer.areaLabel?.remove();
//             });

//             featureGroup.clearLayers();
//             loadGeoData();
//         } else {
//             alert('Failed to update features');
//         }
//     } catch (error) {
//         console.error('Error saving data:', error);
//         alert('Failed to save data');
//     }
// });

// document.getElementById('classify').addEventListener('click', () => {
//     const id = document.getElementById('id').value;
//     if (!id) {
//         alert('เลือกแปลงที่ต้องการ classify ก่อน');
//         return;
//     }
//     fetch(`/rub/api/create_reclass_layer`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ id })
//     }).then(response => response.json())
//         .then(data => {
//             if (data.success) {
//                 window.open(`/rub/reclassify/index.html?id=${id}`, '_self');
//             } else {
//                 alert('Failed to create reclassification layer');
//             }
//         }).catch(error => {
//             console.error('Error creating reclassification layer:', error);
//             alert('Failed to create reclassification layer');
//         });
// });

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    loadGeoData();
});

