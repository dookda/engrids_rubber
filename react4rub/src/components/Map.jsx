import React, { use, useEffect, useRef, useState } from 'react';

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import * as turf from "@turf/turf";

const Map = () => {
    const mapContainer = useRef(null)
    const mapRef = useRef(null)

    const [features, setFeatures] = useState(null)
    const [area, setArea] = useState(null)

    const mapCenter = [13.7563, 100.5018]
    const mapZoom = 13

    const formatArea = (geojson) => {
        const area = turf.area(geojson);
        const diff = Math.abs(area - Number(geojson.properties.xls_sqm));

        if (diff > 100) {
            return `นท.เป้าหมาย: <br><span style="color: green;">${geojson.properties.xls_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²</span><br>
                นท.ปัจจุบัน: <br><span style="color:red; font-weight:900;">${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²</span>`;

        } else {
            return `นท.เป้าหมาย: <br><span style="color: green;">${geojson.properties.xls_sqm.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²</span><br>
                นท.ปัจจุบัน: <br><span style="color:green; font-weight:900;">${area.toLocaleString(undefined, { maximumFractionDigits: 0 })} m²</span>
                <p><button class="btn btn-primary" >บันทึก</button></p>`;
        }
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

        const parcel = L.featureGroup()

        const overlayMaps = {
            'แปลงยาง': parcel.addTo(mapRef.current)
        }

        L.control.layers(baseMaps, overlayMaps).addTo(mapRef.current)

        const handleFeature = (feature, layer) => {
            layer.on('click', (e) => {
                const geojsonFeature = e.target.toGeoJSON();
                const area = formatArea(geojsonFeature);
                info.update(area);
            });

            layer.on('dblclick', (e) => {
                const { properties } = e.target.feature;
                mapRef.current.pm.disableGlobalEditMode();
                layer.pm.enable();
            });

            layer.on('pm:editstart', (e) => {
                const geojsonFeature = e.target.toGeoJSON();
                const area = formatArea(geojsonFeature);
                info.update(area);
            });

            layer.on('pm:change pm:editstart', (e) => {
                const geojsonFeature = e.target.toGeoJSON();
                const area = formatArea(geojsonFeature);
                info.update(area);
            });
        }

        L.geoJSON(features, {
            style: getFeatureStyle,
            onEachFeature: handleFeature
        }).addTo(parcel)

        const bound = parcel.getBounds();
        bound.isValid() ? mapRef.current.fitBounds(bound, { padding: [20, 20] }) : mapRef.current.setView(mapCenter, mapZoom);

        mapRef.current.pm.addControls({
            position: 'topright',
            drawCircleMarker: false,
            drawCircle: false,
            drawMarker: false,
            drawPolyline: false,
            drawPolygon: false,
            drawRectangle: false,
            drawText: false,
            rotateMode: false,
            cutPolygon: false,
            editMode: false,
            dragMode: false,
            removalMode: false,
        });

        mapRef.current.on('pm:change', (e) => {
            console.log('pm:change', e);
            info.update(layer.feature.properties);
        });

        mapRef.current.on('click', (e) => {
            parcel.eachLayer((layer) => {
                if (layer.pm?.enabled()) {
                    layer.pm?.disable()
                }
            });
        });

        var info = L.control();

        info.onAdd = function (map) {
            this._div = L.DomUtil.create('div', 'info');
            this.update();
            return this._div;
        };

        info.update = function (area) {
            this._div.innerHTML = (area ? area : '<h4>คลิ๊กที่แปลงยาง</h4>');
        };

        info.addTo(mapRef.current);

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [features])

    useEffect(() => {
        fetch('http://localhost:3300/rub/api/getfeaturescollection')
            .then(response => response.json())
            .then(apiData => setFeatures(apiData.data))
    }, [])

    return (
        <div ref={mapContainer}
            style={{
                height: '70vh',
                width: '100%',
                minHeight: '400px'
            }}></div>
    )
}

export default Map