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
            ],
            pageLength: 10,
            responsive: true,
            select: true,
            destroy: true,
            scrollX: true,
        });

        const layerMap = new Map();

        L.geoJSON(geoJsonData, {
            style: style,
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`${feature.properties.id}`);
                layerMap.set(feature.properties.id, layer);
                layer.on('click', () => {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(feature, layer);
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

        updateMap();
        dataTable.on('draw', () => {
            updateMap();
        });

        $('#featureTable tbody').on('click', 'tr', function (e) {
            if (!$(e.target).hasClass('zoom-btn')) {
                const rowData = dataTable.row(this).data();
                const layer = layerMap.get(rowData.id);
                if (layer) {
                    map.fitBounds(layer.getBounds());
                    showFeaturePanel(layer.feature, layer);
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

map.on('click', (e) => featureGroup.eachLayer(l => l.pm.disable()));

document.addEventListener('DOMContentLoaded', () => {
    loadGeoData();
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/rub/api/countsfeatures');
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด (แปลง)', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว (แปลง)', y: parseInt(data.reshp), color: '#434348' },
            { name: 'จำแนก landuse แล้ว (แปลง)', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('container', {
            chart: { type: 'bar', style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { type: 'category', title: { text: 'แปลงยางพารา', style: { fontFamily: 'Noto Sans Thai' } } },
            yAxis: { min: 0, title: { text: 'จำนวนแปลง', style: { fontFamily: 'Noto Sans Thai' } } },
            series: [{
                name: 'Counts',
                data: chartData,
                dataLabels: { enabled: true, format: '{y}' }
            }],
            tooltip: { pointFormat: '<b>{point.y}</b> records' },
            legend: { enabled: false }
        });
    } catch (err) {
        console.error('Error fetching data:', err);
    }
});

