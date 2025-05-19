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

const ldd = L.tileLayer.wms('https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?', {
    layers: 'V_PARCEL48',
    format: 'image/png',
    transparent: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 22,
    viewparams: 'utmmap:563821624'
});

const overlayMaps = {
    "แปลงยาง": featureGroup.addTo(map),
    "แปลงที่ดิน": ldd
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
    xls_app_no.value = feature.properties.app_no;
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
            farm_name: item.farm_name,
            f_name: item.f_name,
            l_name: item.l_name,
            age: item.age,
            geom: JSON.parse(item.geom),
            app_no: item.app_no,
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
                { data: 'farm_name', title: 'farm_name' },
                { data: 'f_name', title: 'f_name' },
                { data: 'l_name', title: 'l_name' },
                { data: 'age', title: 'age' },
                { data: 'app_no', title: 'Application No' },
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
                        app_no: row.app_no,
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
    const displayName = document.getElementById('displayName').value;

    const features = [];
    features.push(selectedLayer.toGeoJSON());

    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/updatefeatures/${tb}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, refinal, features, displayName })
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

document.getElementById("restore").addEventListener("click", () => {
    try {
        const modal = document.getElementById("restoreModal");
        if (modal) {
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        } else {
            console.error(`Modal with ID ${modalId} not found.`);
        }
    } catch (error) {
        console.error('Failed to fetch user:', err);
    }
})

document.getElementById('btnRestore').addEventListener("click", async () => {
    try {
        const tb = document.getElementById('tb').value;
        const id = document.getElementById('restoreId').value;
        const response = await fetch(`/rub/api/restorefeatures/${tb}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
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
            document.getElementById('restoreId').value = "";
            const modal = document.getElementById("restoreModal");
            if (modal) {
                const bsModal = bootstrap.Modal.getInstance(modal);
                bsModal.hide();
            } else {
                console.error(`Modal with ID ${modalId} not found.`);
            }
        } else {
            alert('Failed to update features');
        }
    } catch (error) {
        console.error('Error restoring data:', error);
        alert('Failed to restore data');
    }
});

document.getElementById('classify').addEventListener('click', () => {
    const id = document.getElementById('id').value;
    if (!id) {
        alert('เลือกแปลงที่ต้องการ classify ก่อน');
        return;
    }
    const tb = document.getElementById('tb').value;
    fetch(`/rub/api/create_reclass_feature/${tb}`, {
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

const initApp = async () => {
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
};

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/rub/api/ldd_getprovince');

        const provinces = await response.json();

        console.log(provinces.result);

        const provinceSelect = document.getElementById('provinceSelect');

        // Clear loading message
        provinceSelect.innerHTML = '<option selected disabled>Select a province</option>';

        provinces.result.forEach(province => {
            const option = document.createElement('option');
            option.value = province.pvcode;
            option.textContent = province.pvnamethai;
            provinceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading provinces:', error);
        provinceSelect.innerHTML = '<option selected disabled>Error loading provinces</option>';
    }
});

// Handle province selection change
document.getElementById('provinceSelect').addEventListener('change', async function () {
    const provinceId = this.value;
    const amphoeSelect = document.getElementById('amphoeSelect');

    if (!provinceId) {
        amphoeSelect.disabled = true;
        return;
    }

    try {
        amphoeSelect.disabled = true;
        amphoeSelect.innerHTML = '<option selected disabled>Loading amphoes...</option>';

        const response = await fetch(`/rub/api/ldd_getamphur/${provinceId}`);
        const amphoes = await response.json();
        amphoeSelect.innerHTML = '';
        amphoeSelect.disabled = false;

        amphoes.result.forEach(amphoe => {
            const option = document.createElement('option');
            option.value = amphoe.amcode; // Adjust based on actual API response structure
            option.textContent = amphoe.amnamethai;
            amphoeSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading amphoes:', error);
        amphoeSelect.innerHTML = '<option selected disabled>Error loading amphoes</option>';
    }
});

document.getElementById('searchButton').addEventListener('click', async function () {
    const provinceId = document.getElementById('provinceSelect').value;
    const amphoeId = document.getElementById('amphoeSelect').value;
    const pacelNumber = document.getElementById('pacelNumber').value

    console.log(provinceId, amphoeId, pacelNumber);
    if (!provinceId || !amphoeId) {
        return;
    }
    try {
        const response = await fetch(`/rub/api/ldd_getpacelbypacelnumber/${provinceId}/${amphoeId}/${pacelNumber}`);
        const pacel = await response.json();

        console.log(pacel);


        // zoom to the selected pacel by lat/lng
        const lat = pacel.result[0].parcellat;
        const lng = pacel.result[0].parcellon;
        const utm1 = pacel.result[0].utm1;
        const utm2 = pacel.result[0].utm2;
        const utm3 = pacel.result[0].utm3;
        map.setView([lat, lng], 16);
        const marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup(`เลขที่แปลง: ${pacel.result[0].pacelnumber}`);
        marker.openPopup();

        //get  https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?viewparams=utmmap%3A563821624&=&service=WMS&version=1.1.1&request=GetFeatureInfo&layers=LANDSMAPS%3AV_PARCEL48&bbox=103.29372122%2C14.69413140%2C103.29372123%2C14.69413141&width=256&height=256&srs=EPSG%3A4326&query_layers=LANDSMAPS%3AV_PARCEL48&info_format=application%2Fjson&x=103&y=85

        const url = `https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?viewparams=utmmap:${utm1}${utm2}${utm3}&service=WMS&version=1.1.1&request=GetFeatureInfo&layers=LANDSMAPS:V_PARCEL48&bbox=${lng},${lat},${Number(lng) + 0.000001},${Number(lat) + 0.000001}&width=256&height=256&srs=EPSG:4326&query_layers=LANDSMAPS:V_PARCEL48&info_format=application/json&x=103&y=85`;
        console.log(url);

        const response_feat = await fetch(url);
        const parcelGeoJSON = await response_feat.json();
        console.log(parcelGeoJSON);

        var parcelLayer = L.geoJSON(parcelGeoJSON, {
            style: function (feature) {
                return {
                    color: '#ff7800',
                    weight: 2,
                    fillOpacity: 0.1
                };
            },
            onEachFeature: function (feature, layer) {
                // bind a popup showing the parcel_seq
                layer.bindPopup('Parcel seq: ' + feature.properties.parcel_seq);
            }
        }).addTo(map);

        // 5) Zoom the map to fit the polygon bounds
        map.fitBounds(parcelLayer.getBounds());

    }
    catch (error) {
        console.error('Error loading tambons:', error);
        const tambonSelect = document.getElementById('tambonSelect');
        tambonSelect.innerHTML = '<option selected disabled>Error loading tambons</option>';
    }

});

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

