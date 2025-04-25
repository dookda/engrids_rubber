import React, { useEffect, useRef, useState } from 'react';

import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

const Map = () => {
    const mapContainer = useRef(null)
    const mapRef = useRef(null)

    const [features, setFeatures] = useState(null)

    const mapCenter = [13.7563, 100.5018] // Bangkok coordinates
    const mapZoom = 13

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
            // layer.bindPopup(feature.properties.shp_app_no)
            layer.on('click', (e) => {
                const { properties } = e.target.feature;
                mapRef.current.pm.disableGlobalEditMode();
                layer.pm.enable();
            });
        }

        L.geoJSON(features, {
            style: {
                color: '#ff0000',
                weight: 2,
                opacity: 1,
                fillColor: '#ff0000',
                fillOpacity: 0.2
            },
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
            drawRectangle: true,
            drawText: false,
            rotateMode: false,
            cutPolygon: false,
            editMode: false,
            dragMode: false,
            removalMode: false,
        });

        mapRef.current.on('click', (e) => {
            mapRef.current.pm.disableGlobalEditMode();
        });

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
            .then(apiData => {
                setFeatures(apiData.data)
            })
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