// Initialize map and feature group
const map = L.map('map').setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const lddFeatureGroup = L.featureGroup();
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

// Add the custom tile layer
const longdoLayer = L.tileLayer('https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd', {
    attribution: '&copy; Longdo Map',
    tileSize: 256,
    maxZoom: 30,
    minZoom: 1
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

// const ldd_wms = L.tileLayer.wms("https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?", {
//     layers: 'LANDSMAPS:V_PARCEL48,LANDSMAPS:V_PARCEL47',
//     // viewparams: 'utmmap:563821624',
//     viewparams: 'utmmap:482941458',
//     format: 'image/png',
//     transparent: true,
//     maxZoom: 24,
//     zIndex: 6
// });

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
    "S2 gee": trueColorTile,
    "landsmaps": lddFeatureGroup.addTo(map),
    "Longdo Map": longdoLayer,
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


map.on('click', (e) => {
    console.log(e.latlng);

})
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
        color: isEqual ? '#00cc00' : '#FF7601',
        weight: 2,
        opacity: 0.9,
        fillColor: isEqual ? '#90ee90' : '#FFBF78',
        fillOpacity: 0.1
    };
};

const onEachFeature = (feature, layer) => {
    layer.bindPopup(`${feature.properties.id}`);

    layer.on('click', (e) => {
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

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});

// window.addEventListener('DOMContentLoaded', async () => {
//     try {
//         const provinces = [
//             { "code": "00", "name": "กรุณาเลือกจังหวัด" },
//             { "code": "81", "name": "กระบี่" },
//             { "code": "10", "name": "กรุงเทพมหานคร" },
//             { "code": "71", "name": "กาญจนบุรี" },
//             { "code": "46", "name": "กาฬสินธุ์" },
//             { "code": "62", "name": "กำแพงเพชร" },
//             { "code": "40", "name": "ขอนแก่น" },
//             { "code": "22", "name": "จันทบุรี" },
//             { "code": "24", "name": "ฉะเชิงเทรา" },
//             { "code": "20", "name": "ชลบุรี" },
//             { "code": "18", "name": "ชัยนาท" },
//             { "code": "36", "name": "ชัยภูมิ" },
//             { "code": "86", "name": "ชุมพร" },
//             { "code": "57", "name": "เชียงราย" },
//             { "code": "50", "name": "เชียงใหม่" },
//             { "code": "92", "name": "ตรัง" },
//             { "code": "23", "name": "ตราด" },
//             { "code": "63", "name": "ตาก" },
//             { "code": "26", "name": "นครนายก" },
//             { "code": "73", "name": "นครปฐม" },
//             { "code": "48", "name": "นครพนม" },
//             { "code": "30", "name": "นครราชสีมา" },
//             { "code": "80", "name": "นครศรีธรรมราช" },
//             { "code": "60", "name": "นครสวรรค์" },
//             { "code": "12", "name": "นนทบุรี" },
//             { "code": "96", "name": "นราธิวาส" },
//             { "code": "55", "name": "น่าน" },
//             { "code": "38", "name": "บึงกาฬ" },
//             { "code": "31", "name": "บุรีรัมย์" },
//             { "code": "13", "name": "ปทุมธานี" },
//             { "code": "77", "name": "ประจวบคีรีขันธ์" },
//             { "code": "25", "name": "ปราจีนบุรี" },
//             { "code": "94", "name": "ปัตตานี" },
//             { "code": "14", "name": "พระนครศรีอยุธยา" },
//             { "code": "56", "name": "พะเยา" },
//             { "code": "82", "name": "พังงา" },
//             { "code": "93", "name": "พัทลุง" },
//             { "code": "66", "name": "พิจิตร" },
//             { "code": "65", "name": "พิษณุโลก" },
//             { "code": "76", "name": "เพชรบุรี" },
//             { "code": "67", "name": "เพชรบูรณ์" },
//             { "code": "54", "name": "แพร่" },
//             { "code": "83", "name": "ภูเก็ต" },
//             { "code": "44", "name": "มหาสารคาม" },
//             { "code": "49", "name": "มุกดาหาร" },
//             { "code": "58", "name": "แม่ฮ่องสอน" },
//             { "code": "35", "name": "ยโสธร" },
//             { "code": "95", "name": "ยะลา" },
//             { "code": "45", "name": "ร้อยเอ็ด" },
//             { "code": "85", "name": "ระนอง" },
//             { "code": "21", "name": "ระยอง" },
//             { "code": "70", "name": "ราชบุรี" },
//             { "code": "16", "name": "ลพบุรี" },
//             { "code": "52", "name": "ลำปาง" },
//             { "code": "51", "name": "ลำพูน" },
//             { "code": "42", "name": "เลย" },
//             { "code": "33", "name": "ศรีสะเกษ" },
//             { "code": "47", "name": "สกลนคร" },
//             { "code": "90", "name": "สงขลา" },
//             { "code": "91", "name": "สตูล" },
//             { "code": "11", "name": "สมุทรปราการ" },
//             { "code": "75", "name": "สมุทรสงคราม" },
//             { "code": "74", "name": "สมุทรสาคร" },
//             { "code": "27", "name": "สระแก้ว" },
//             { "code": "19", "name": "สระบุรี" },
//             { "code": "17", "name": "สิงห์บุรี" },
//             { "code": "64", "name": "สุโขทัย" },
//             { "code": "72", "name": "สุพรรณบุรี" },
//             { "code": "84", "name": "สุราษฎร์ธานี" },
//             { "code": "32", "name": "สุรินทร์" },
//             { "code": "43", "name": "หนองคาย" },
//             { "code": "39", "name": "หนองบัวลำภู" },
//             { "code": "15", "name": "อ่างทอง" },
//             { "code": "37", "name": "อำนาจเจริญ" },
//             { "code": "41", "name": "อุดรธานี" },
//             { "code": "53", "name": "อุตรดิตถ์" },
//             { "code": "61", "name": "อุทัยธานี" },
//             { "code": "34", "name": "อุบลราชธานี" }
//         ];
//         const provinceSelect = document.getElementById('provinceSelect');

//         provinceSelect.innerHTML = '<option selected disabled>Select a province</option>';

//         provinces.forEach(province => {
//             const option = document.createElement('option');
//             option.value = province.code;
//             option.textContent = province.name;
//             provinceSelect.appendChild(option);
//         });
//     } catch (error) {
//         console.error('Error loading provinces:', error);
//         provinceSelect.innerHTML = '<option selected disabled>Error loading provinces</option>';
//     }
// });


// document.getElementById('provinceSelect').addEventListener('change', async function () {
//     const provinceId = this.value;
//     const amphoeSelect = document.getElementById('amphoeSelect');

//     if (!provinceId) {
//         amphoeSelect.disabled = true;
//         return;
//     }

//     try {
//         amphoeSelect.disabled = true;
//         amphoeSelect.innerHTML = '<option selected disabled>Loading amphoes...</option>';
//         amphoeSelect.innerHTML = '';
//         amphoeSelect.disabled = false;

//         amphoes.filter(amphoe => amphoe.pvcode === provinceId).forEach(amphoe => {
//             const option = document.createElement('option');
//             option.value = amphoe.amcode;
//             option.textContent = amphoe.amnamethai;
//             amphoeSelect.appendChild(option);
//         });
//     } catch (error) {
//         console.error('Error loading amphoes:', error);
//         amphoeSelect.innerHTML = '<option selected disabled>Error loading amphoes</option>';
//     }
// });

// async function openLdd() {
//     try {
//         const provinceId = document.getElementById('provinceSelect').value;
//         const amphoeId = document.getElementById('amphoeSelect').value;
//         const pacelNumber = document.getElementById('pacelNumber').value;
//         if (!provinceId || !amphoeId || !pacelNumber) {
//             alert('Please select province, amphoe and enter parcel number');
//             return;
//         }
//         const url = `https://landsmaps.dol.go.th/?province=${provinceId}&amphur=${amphoeId}&parcelnumber=${pacelNumber}`;
//         window.open(url, '_blank');
//     } catch (error) {
//         console.error('Error opening LDD:', error);
//     }
// }

// async function loadParcelData() {
//     try {
//         const urlText = document.getElementById('urlText').value;
//         console.log('Loading parcel data from URL:', urlText);

//         const parcelGeoJSON = JSON.parse(urlText);

//         if (!parcelGeoJSON || !parcelGeoJSON.features || parcelGeoJSON.features.length === 0) {
//             alert('No parcel data found for the given criteria.');
//             return;
//         }

//         lddFeatureGroup.clearLayers();
//         var parcelLayer = L.geoJSON(parcelGeoJSON, {
//             style: function (feature) {
//                 return {
//                     color: '#02afe3',
//                     weight: 2,
//                     fillOpacity: 0.1
//                 };
//             },
//             onEachFeature: function (feature, layer) {
//                 if (feature.properties && feature.properties.parcel_seq) {
//                     layer.bindPopup('Parcel seq: ' + feature.properties.parcel_seq);
//                 }
//             }
//         });

//         lddFeatureGroup.addLayer(parcelLayer);

//         if (parcelLayer.getBounds().isValid()) {
//             map.fitBounds(parcelLayer.getBounds());
//         } else {
//             console.warn('Invalid bounds for parcel layer');
//         }

//     } catch (error) {
//         console.error('Error loading parcel data:', error);
//     }
// }

// document.getElementById('searchButton').addEventListener('click', async function () {
//     const provinceId = document.getElementById('provinceSelect').value;
//     const amphoeId = document.getElementById('amphoeSelect').value;
//     const pacelNumber = document.getElementById('pacelNumber').value

//     if (!provinceId || !amphoeId) {
//         return;
//     }
//     try {
//         await openLdd(provinceId, amphoeId, pacelNumber);
//     }
//     catch (error) {
//         console.error('Error loading tambons:', error);
//         const tambonSelect = document.getElementById('tambonSelect');
//         tambonSelect.innerHTML = '<option selected disabled>Error loading tambons</option>';
//     }
// });

// document.getElementById('clearButton').addEventListener('click', function () {
//     const provinceSelect = document.getElementById('provinceSelect');
//     const amphoeSelect = document.getElementById('amphoeSelect');
//     const pacelNumber = document.getElementById('pacelNumber');

//     provinceSelect.value = '';
//     amphoeSelect.value = '';
//     pacelNumber.value = '';

//     lddFeatureGroup.clearLayers();
// });

// document.getElementById('loadParcelButton').addEventListener('click', async function () {
//     try {
//         await loadParcelData();
//     } catch (error) {
//         console.error('Error loading parcel data:', error);
//     }
// });

// document.getElementById('clearParcelButton').addEventListener('click', function () {
//     lddFeatureGroup.clearLayers();
//     document.getElementById('urlText').value = '';
// });
