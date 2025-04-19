import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';

export const Map = ({ onMapClick }) => {
    const mapContainer = useRef(null);
    const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_TOKEN;
    const gmRef = useRef(null);

    const gmOptions = {
        settings: {
            controlsPosition: 'top-right',
            throttlingDelay: 10
        },
        controls: {
            helper: {
                snapping: { uiEnabled: true, active: true },
                measurements: { uiEnabled: true, active: false },
                zoom_to_features: { uiEnabled: false, active: false },
                shape_markers: { uiEnabled: false, active: false },
                click_to_edit: { uiEnabled: true, active: true },
            },
            draw: {
                polygon: { title: 'Draw Polygon', icon: 'custom-polygon-icon', uiEnabled: true, active: false, options: [{ type: 'toggle', name: 'snap', label: 'Snap to Vertices', value: true }] },
                line: { title: 'Draw Line', uiEnabled: false, active: false },
                marker: { title: 'Draw Marker', uiEnabled: false, active: false },
                circle: { title: 'Draw Circle', uiEnabled: false, active: false },
                circle_marker: { title: 'Draw Circle Marker', uiEnabled: false, active: false },
                text_marker: { title: 'Draw Text Marker', uiEnabled: false, active: false },
                rectangle: { title: 'Draw Rectangle', uiEnabled: false, active: false },
                freehand: { title: 'Draw Freehand', uiEnabled: false, active: false },
            },
            edit: {
                change: { title: 'Change', uiEnabled: true, active: false },
                drag: { title: 'Drag', uiEnabled: false, active: false },
                rotate: { title: 'Rotate', uiEnabled: false, active: false },
                scale: { title: 'Scale', uiEnabled: false, active: false },
                cut: { title: 'Cut', uiEnabled: false, active: false },
                delete: { title: 'Delete', uiEnabled: false, active: false },
                combine: { title: 'Combine', uiEnabled: false, active: false },
                uncombine: { title: 'Uncombine', uiEnabled: false, active: false },
            }
        },
    };

    useEffect(() => {
        if (!mapContainer.current) return;
        let map = new maplibregl.Map({
            container: mapContainer.current,
            style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
            center: [98.995, 18.795],
            zoom: 12,
            pitch: 0,
            bearing: -17.6,
            antialias: true
        });

        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        map.on('load', () => {
            map.setProjection({ type: 'globe' });

            map.addSource('geojson-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });

            map.addLayer({
                id: 'geojson-layer', type: 'fill', source: 'geojson-source',
                paint: { 'fill-color': '#088', 'fill-opacity': 0.4 }, interactive: true
            });

            map.addLayer({
                id: 'geojson-outline', type: 'line', source: 'geojson-source',
                paint: { 'line-color': '#f00', 'line-width': 2 }
            });
            // console.log('Layers:', map.getStyle().layers);
        });

        gmRef.current = new Geoman(map, gmOptions);
        let gm = gmRef.current;

        const handleEvent = (event) => {
            if (event.type === 'gm:create' || event.type === 'gm:editend') {
                gm.disableDraw();
            }
        };

        map.once('idle', () => {
            fetch('http://localhost:3300/rub/api/getfeaturescollection')
                .then(response => response.json())
                .then(apiData => {
                    gm.features.importGeoJson(apiData.data, 'geojson-source');
                    const bounds = new maplibregl.LngLatBounds();
                    apiData.data.features.forEach(feature => {
                        const geometry = feature.geometry;
                        switch (geometry.type) {
                            case 'Point':
                                bounds.extend(geometry.coordinates);
                                break;
                            case 'LineString':
                                geometry.coordinates.forEach(coord => bounds.extend(coord));
                                break;
                            case 'Polygon':
                                geometry.coordinates.flat().forEach(coord => bounds.extend(coord));
                                break;
                            case 'MultiPolygon':
                                geometry.coordinates.flat(2).forEach(coord => bounds.extend(coord));
                                break;
                            default:
                                console.warn(`Unsupported geometry type: ${geometry.type}`);
                        }
                    });

                    if (!bounds.isEmpty()) {
                        map.fitBounds(bounds, {
                            padding: 30,
                            duration: 1000,
                            maxZoom: 16
                        });
                    }
                })
                .catch(error => console.error('Error loading GeoJSON:', error));
        });

        map.once('gm:loaded', () => {
            map.on('gm:create', handleEvent);
            map.on('gm:editend', handleEvent);
        });

        map.on('click', async (e) => {
            onMapClick(e);
            gm.disableGlobalEditMode();
        });

        return () => {
            map?.remove();
        };
    }, []);

    return (
        <div
            className="card"
            ref={mapContainer}
            style={{
                width: '100%',
                height: '70vh',
                position: 'relative'
            }}
        />
    );
};