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

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22
});

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
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

        const res = await fetch(`/rub/api/area`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ geometry: geojsonFeature.geometry })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API error ${res.status}: ${errText}`);
        }

        const { area } = await res.json();
        const xls_sqm = document.getElementById('xls_sqm').value;

        document.getElementById('shparea_sqm').value = area.toFixed(0);
        const diff = Math.abs(area - xls_sqm);

        if (diff >= 100) {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-danger">เนื้อที่ยังไม่เท่ากัน</span></h5>';
        } else {
            document.getElementById('message').innerHTML = '<h5><span class="badge bg-success">เนื้อที่ใกล้เคียงกัน</span></h5>';
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
    const refinal = document.getElementById('refinal');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.xls_app_no;
    xls_sqm.value = feature.properties.xls_sqm;
    refinal.value = feature.properties.refinal;

    // console.log(feature.properties);
    updateAreaLabel(layer);
}

const getFeatureStyle = (feature) => {
    const xls = Number(feature.properties.xls_sqm);
    const shp = Number(feature.properties.shparea_sqm);
    const diff = xls - shp;
    const isEqual = Math.abs(diff) <= 100;

    return {
        color: isEqual ? '#00cc00' : '#ca0020',
        weight: 2,
        opacity: 0.9,
        fillColor: isEqual ? '#90ee90' : '#f4a582',
        fillOpacity: 0.1
    };
};

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', () => {
        // map.fitBounds(layer.getBounds());
        showFeaturePanel(feature, layer);
        featureGroup.eachLayer(l => l.pm.disable());
        layer.pm.enable();

        selectedLayer = layer;
    });

    layer.on('pm:edit pm:dragend pm:update pm:change', () => updateAreaLabel(layer));
}

var selectedLayer = null;
const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/getfeatures/${tb}`);
        const { data } = await response.json();

        const tableData = data.map(item => ({
            id: item.id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            xls_app_no: item.xls_app_no,
            xls_sqm: item.xls_sqm,
            shparea_sqm: item.shparea_sqm,
            classified: item.classified,
        }));

        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            columns: [
                {
                    data: null,
                    title: 'Zoom',
                    render: (data, type, row) => {
                        const _geojson = JSON.stringify(row.geom);
                        return `<a class="btn btn-success map-btn" 
                                    data-refid="${row.id}" 
                                    data-geojson='${_geojson}'
                                    href="#">
                                    <em class="icon ni ni-zoom-in"></em>&nbsp;ซูม
                                </a>`
                    }
                },
                { data: 'id', title: 'ID' },
                { data: 'xls_app_no', title: 'Application No' },
                { data: 'xls_sqm', title: 'เนื้อที่เป้าหมาย (m²)' },
                {
                    data: 'shparea_sqm',
                    title: 'เนื้อที่ขณะนี้ (m²)',
                    render: (data, type, row) => Number(data).toFixed(0)
                },
                {
                    data: null,
                    title: 'ตรวจสอบ (m²)',
                    render: (data, type, row) => {
                        const xls = Number(data.xls_sqm);
                        const shp = Number(data.shparea_sqm);
                        const diff = xls - shp;
                        const color = Math.abs(diff) <= 100 ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">
                                    ${Math.abs(diff) <= 100 ? "เนื้อที่ถูกต้อง" : "เนื้อที่ไม่ถูกต้อง"}
                                    (${diff.toLocaleString(undefined, { maximumFractionDigits: 1 })})
                                </span>`;
                    }
                },
                {
                    data: 'classified',
                    title: 'Classified',
                    render: (data, type, row) => {
                        const color = data ? 'green' : 'red';
                        const diffStyle = `color: ${color}; font-weight: bold;`;
                        return `<span style="${diffStyle}">${data ? "classify แล้ว" : "ยังไม่ classify"}</span>`;
                    }
                }
            ],
            pageLength: 10,
            responsive: false,
            select: true,
            destroy: true,
            scrollX: true,
        });

        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            visibleRows.forEach(row => {
                const geoJsonData = {
                    type: 'Feature',
                    geometry: row.geom,
                    properties: {
                        id: row.id,
                        refinal: row.refinal,
                        xls_app_no: row.xls_app_no,
                        xls_sqm: row.xls_sqm,
                        shparea_sqm: row.shparea_sqm
                    }
                }

                L.geoJson(geoJsonData, {
                    style: getFeatureStyle,
                    onEachFeature: onEachFeature,
                }).addTo(featureGroup);
            });
        };

        updateMap();

        dataTable.on('draw', () => {
            updateMap();
        });

        $('#featureTable tbody').on('click', '.map-btn', function (e) {
            try {
                e.stopPropagation();
                const geojson = $(this).data('geojson');
                const layer = L.geoJSON(geojson)

                const bounds = layer.getBounds();
                map.fitBounds(bounds, {
                    padding: [20, 20],
                    // maxZoom: 16         
                });
                selectedLayer = layer;
            } catch (error) {
                console.error('Failed to parse GeoJSON:', error);
            }
        });


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

    const id = document.getElementById('id').value
    const refinal = document.getElementById('refinal').value;

    const features = [];
    features.push(selectedLayer.toGeoJSON());

    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch('/rub/api/updatefeatures/' + tb, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, refinal, features })
        });
        const result = await response.json();
        alert(`อัพเดท features ${result.updated} เรียบร้อย`);

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
    const tb = document.getElementById('tb').value;
    fetch(`/rub/api/create_reclass_layer/${tb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    }).then(response => response.json())
        .then(data => {
            if (data.success) {
                window.open(`/rub/reclass/index.html?tb=${tb}&id=${id}`, '_self');
            } else {
                alert('Failed to create reclassification layer');
            }
        }).catch(error => {
            console.error('Error creating reclassification layer:', error);
            alert('Failed to create reclassification layer');
        });
});

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        } else {
            document.getElementById('tb').value = tb;
            await loadGeoData();
            map.fitBounds(featureGroup.getBounds());
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
});

