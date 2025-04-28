import React, { use, useEffect, useRef, useState } from 'react';
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import * as turf from "@turf/turf";

const Map = () => {
    const mapContainer = useRef(null)
    const mapRef = useRef(null)
    const parcelRef = useRef(L.featureGroup());
    const infoRef = useRef(L.control());
    const [currentFeature, setCurrentFeature] = useState(null);
    const [updateFeature, setUpdateFeature] = useState(null);
    const [id, setId] = useState(null);
    const [selectedPolygon, setSelectedPolygon] = useState(null);
    const [selectedLine, setSelectedLine] = useState(null);

    const mapCenter = [13.7563, 100.5018]
    const mapZoom = 13

    const formatArea = (geojson) => {
        try {
            const area = turf.area(geojson);
            const diff = Math.abs(area - Number(geojson.properties.xls_sqm));
            if (diff > 100) {
                return `id: ${geojson.properties.id}<br>
                นท.เป้าหมาย: <br><span style="color: green;">${geojson.properties.xls_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²</span><br>
                นท.ปัจจุบัน: <br><span style="color:red; font-weight:900;">${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²</span>`;

            } else {
                return `id: ${geojson.properties.id}<br>
                นท.เป้าหมาย: <br><span style="color: green;">${geojson.properties.xls_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²</span><br>
                นท.ปัจจุบัน: <br><span style="color:green; font-weight:900;">${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²</span>`;
            }
        } catch (error) {
            console.error('Error formatting area:', error);
            return 'Error calculating area';
        }
    }

    const getFeatureStyle = (feature) => {
        try {
            const id = feature.properties.id;
            const xls = Number(feature.properties.xls_sqm);
            const shp = Number(feature.properties.shparea_sqm);
            const isEqual = Math.abs(xls - shp) <= 100;

            return {
                color: isEqual ? '#00cc00' : '#ca0020',
                weight: 2,
                opacity: 0.7,
                fillColor: isEqual ? '#90ee90' : '#f4a582',
                fillOpacity: 0.1
            };
        } catch (error) {
            console.error('Error getting feature style:', error);
        }
    };

    const handleFeature = (feature, layer) => {

        layer.on('click', (e) => {
            const geojsonFeature = e.target.toGeoJSON();
            const area = formatArea(geojsonFeature);
            infoRef.current.update(area);
            setId(geojsonFeature.properties.id);
            setSelectedPolygon(geojsonFeature);
        });

        layer.on('dblclick', (e) => {
            const { properties } = e.target.feature;
            mapRef.current.pm.disableGlobalEditMode();
            layer.pm.enable();
        });

        layer.on('pm:editstart', (e) => {
            const geojsonFeature = e.target.toGeoJSON();
            const area = formatArea(geojsonFeature);
            infoRef.current.update(area);
        });

        layer.on('pm:change', (e) => {
            const geojsonFeature = e.target.toGeoJSON();
            const area = formatArea(geojsonFeature);
            infoRef.current.update(area);
        });

        layer.on('pm:update', (e) => {
            const geojsonFeature = e.target.toGeoJSON();
            setCurrentFeature(geojsonFeature);
        });
    }

    useEffect(() => {
        mapRef.current = L.map(mapContainer.current, {
            center: mapCenter,
            zoom: mapZoom
        })

        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        })

        const googleRoad = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20, minZoom: 1, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] }, {
            attribution: '&copy; <a href="https://www.google.com/maps">Google</a> contributors'
        })

        const googleSatellite = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, minZoom: 1, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] }, {
            attribution: '&copy; <a href="https://www.google.com/maps">Google</a> contributors'
        })

        const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20, minZoom: 1, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] }, {
            attribution: '&copy; <a href="https://www.google.com/maps">Google</a> contributors'
        })

        const googleTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', { maxZoom: 20, minZoom: 1, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'] }, {
            attribution: '&copy; <a href="https://www.google.com/maps">Google</a> contributors'
        })

        const baseMaps = {
            'OpenStreetMap': osm,
            'Google Road': googleRoad,
            'Google Satellite': googleSatellite.addTo(mapRef.current),
            'Google Hybrid': googleHybrid,
            'Google Terrain': googleTerrain
        }

        const overlayMaps = {
            'แปลงยาง': parcelRef.current.addTo(mapRef.current)
        }

        L.control.layers(baseMaps, overlayMaps).addTo(mapRef.current)

        mapRef.current.pm.addControls({
            position: 'topright',
            drawCircleMarker: false,
            drawCircle: false,
            drawMarker: false,
            drawPolyline: true,
            drawPolygon: false,
            drawRectangle: false,
            drawText: false,
            rotateMode: false,
            cutPolygon: false,
            editMode: false,
            dragMode: false,
            removalMode: false,
        });


        mapRef.current.on('pm:drawstart', (e) => {
            parcelRef.current.eachLayer((layer) => {
                if (layer.pm?.enabled()) {
                    layer.pm?.disable()
                }
            });
        });

        mapRef.current.on('pm:create', (e) => {
            console.log('pm:change', e.layer.toGeoJSON());
            setSelectedLine(e.layer.toGeoJSON());

            console.log(selectedLine);
            console.log(selectedPolygon);


        });

        mapRef.current.on('click', (e) => {
            parcelRef.current.eachLayer((layer) => {
                if (layer.pm?.enabled()) {
                    layer.pm?.disable()
                }
            });
            setId(null);
        });




        // clearbutton 
        const saveButton = L.control({ position: 'topright' });
        saveButton.onAdd = function (map) {
            const button = L.DomUtil.create('button', 'btn-clear');
            button.innerHTML = 'clear';

            button.onclick = () => {
                parcelRef.current.eachLayer((layer) => {
                    if (layer.pm?.enabled()) {
                        layer.pm?.disable()
                    }
                });
                setId(null);
            };

            return button;
        };
        saveButton.addTo(mapRef.current);

        infoRef.current.onAdd = function (map) {
            this._div = L.DomUtil.create('div', 'info');
            this.update();
            return this._div;
        };

        infoRef.current.update = function (area) {
            this._div.innerHTML = (area ? area : 'คลิ๊กที่แปลงยาง');
        };
        infoRef.current.addTo(mapRef.current);

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [])

    useEffect(() => {
        console.log('selectedLine', selectedLine);
        console.log('selectedPolygon', selectedPolygon);

        if (!selectedPolygon) {
            console.log('เลือก polygon ก่อน');
            return;
        }
        if (!selectedLine) {
            console.log('สร้าง line ที่จะใช้แบ่ง polygon ก่อน');
            return;
        }
        if (selectedLine && selectedPolygon) {

            const srid = 32647;
            const data = {
                polygon_fc: selectedPolygon,
                line_fc: selectedLine,
                srid: srid,
            }

            fetch('http://localhost:3300/rub/api/split', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            }).then(response => response.json())
                .then(async (data) => {
                    console.log(data);

                    if (data.success) {
                        parcelRef.current.clearLayers();
                        L.geoJSON(data.data, {
                            style: getFeatureStyle,
                            onEachFeature: handleFeature
                        }).addTo(parcelRef.current);
                    } else {
                        alert('Split failed');
                    }
                })
        }
    }, [selectedLine, selectedPolygon])

    useEffect(() => {
        if (!currentFeature) {
            console.log('No feature to save');
            return;
        }

        fetch('http://localhost:3300/rub/api/updatefeatures', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features: [currentFeature] })
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const result = await response.json();

                alert(`Updated features ID: ${result.updated} เรียบร้อย`);
                setUpdateFeature(currentFeature);
                setCurrentFeature(null);
            })
            .catch((error) => {
                console.error('Error saving feature:', error);
            })
    }, [currentFeature])

    useEffect(() => {
        fetch('http://localhost:3300/rub/api/getfeaturescollection')
            .then((response) => response.json())
            .then((dataApi) => {
                parcelRef.current.clearLayers();
                L.geoJSON(dataApi.data, {
                    style: getFeatureStyle,
                    onEachFeature: handleFeature
                }).addTo(parcelRef.current);
            })
            .catch((error) => {
                console.error('Error fetching features:', error);
            });
    }, [updateFeature])

    useEffect(() => {
        fetch('http://localhost:3300/rub/api/getfeaturescollection')
            .then((response) => response.json())
            .then((dataApi) => {
                parcelRef.current.clearLayers();
                L.geoJSON(dataApi.data, {
                    style: getFeatureStyle,
                    onEachFeature: handleFeature
                }).addTo(parcelRef.current);
                const bound = parcelRef.current.getBounds();
                bound.isValid() ? mapRef.current.fitBounds(bound, { padding: [20, 20] }) : mapRef.current.setView(mapCenter, mapZoom);
            })
            .catch((error) => {
                console.error('Error fetching features:', error);
            });
    }, [])

    return (
        <>
            <div ref={mapContainer}
                style={{
                    height: '70vh',
                    width: '100%',
                    minHeight: '400px'
                }}></div>
        </>
    )
}

export default Map