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

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22
});

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat,
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light.addTo(map)
};


const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map)
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

function showFeaturePanel(feature, layer) {
    const id = document.getElementById('id');
    const xls_app_no = document.getElementById('xls_app_no');
    const shpsplit_sqm = document.getElementById('shpsplit_sqm');

    id.value = feature.properties.id;
    xls_app_no.value = feature.properties.xls_app_no;
    shpsplit_sqm.value = Number(feature.properties.shparea_sqm).toFixed(0);
}

const getFeatureStyle = (feature) => {
    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'non-rubber'
            ? '#d7191c'
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

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', () => {
        map.fitBounds(layer.getBounds());
        showFeaturePanel(feature, layer);
        selectedLayer = layer;
    });
}

const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/getreclassfeatures/${tb}`);
        const { data } = await response.json();

        const tableData = data.map(item => ({
            id: item.id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            xls_app_no: item.xls_app_no,
            shparea_sqm: item.shparea_sqm,
            shpsplit_sqm: item.shpsplit_sqm,
            classtype: item.classtype
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
                { data: 'xls_app_no', title: 'Application No' },
                { data: 'id', title: 'id' },
                { data: 'shparea_sqm', title: 'เนื้อที่รวมของแปลงนี้ (m²)' },
                { data: 'shpsplit_sqm', title: 'เนื้อที่ส่วนนี้ (m²)' },
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

        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            visibleRows.forEach(row => {
                const geojson = {
                    type: 'Feature',
                    geometry: row.geom,
                    properties: {
                        id: row.id,
                        refinal: row.refinal,
                        xls_app_no: row.xls_app_no,
                        xls_sqm: row.xls_sqm,
                        shparea_sqm: row.shparea_sqm,
                        classtype: row.classtype
                    }
                }

                L.geoJson(geojson, {
                    style: getFeatureStyle,
                    onEachFeature: onEachFeature
                }).addTo(featureGroup);
            });
        };

        updateMap();

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

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reshape/index.html?tb=' + tb;
})

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }

        document.getElementById('tb').value = tb;
        await loadGeoData();
        map.fitBounds(featureGroup.getBounds());

        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด (แปลง)', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว (แปลง)', y: parseInt(data.reshp), color: '#434348' },
            { name: 'จำแนก landuse แล้ว (แปลง)', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('container', {
            chart: { type: 'bar', height: 240, style: { fontFamily: 'Noto Sans Thai' } },
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

