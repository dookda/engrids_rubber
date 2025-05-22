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

document.getElementById('dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    window.location.href = './../reclassdash/index.html?tb=' + tb;
});

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/rub/api/ldd_getprovince');
        const provinces = await response.json();
        const provinceSelect = document.getElementById('provinceSelect');

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

async function loadParcelData(provinceId, amphoeId, pacelNumber) {
    try {
        const response = await fetch(`/rub/api/ldd_getpacelbypacelnumber/${provinceId}/${amphoeId}/${pacelNumber}`);
        const parcelGeoJSON = await response.json();

        console.log(parcelGeoJSON);
        if (!parcelGeoJSON || !parcelGeoJSON.features || parcelGeoJSON.features.length === 0) {
            alert('No parcel data found for the given criteria.');
            return;
        }
        // Clear existing layers
        featureGroup.clearLayers();

        // Create the GeoJSON layer
        var parcelLayer = L.geoJSON(parcelGeoJSON, {
            style: function (feature) {
                return {
                    color: '#ff7800',
                    weight: 2,
                    fillOpacity: 0.1
                };
            },
            onEachFeature: function (feature, layer) {
                if (feature.properties && feature.properties.parcel_seq) {
                    layer.bindPopup('Parcel seq: ' + feature.properties.parcel_seq);
                }
            }
        });

        featureGroup.addLayer(parcelLayer);

        if (parcelLayer.getBounds().isValid()) {
            map.fitBounds(parcelLayer.getBounds());
        } else {
            console.warn('Invalid bounds for parcel layer');
        }

        return parcelLayer;

    } catch (error) {
        console.error('Error loading parcel data:', error);
    }
}

document.getElementById('searchButton').addEventListener('click', async function () {
    const provinceId = document.getElementById('provinceSelect').value;
    const amphoeId = document.getElementById('amphoeSelect').value;
    const pacelNumber = document.getElementById('pacelNumber').value

    if (!provinceId || !amphoeId) {
        return;
    }
    try {
        await loadParcelData(provinceId, amphoeId, pacelNumber);
    }
    catch (error) {
        console.error('Error loading tambons:', error);
        const tambonSelect = document.getElementById('tambonSelect');
        tambonSelect.innerHTML = '<option selected disabled>Error loading tambons</option>';
    }
});

document.getElementById('clearButton').addEventListener('click', function () {
    const provinceSelect = document.getElementById('provinceSelect');
    const amphoeSelect = document.getElementById('amphoeSelect');
    const pacelNumber = document.getElementById('pacelNumber');

    provinceSelect.value = '';
    amphoeSelect.value = '';
    pacelNumber.value = '';

    // Clear the map
    featureGroup.clearLayers();
    // document.getElementById()
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

            // await initApp();

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

