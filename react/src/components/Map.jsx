import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';

export const Map = ({ onMapClick }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);
    const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_TOKEN;
    const gmRef = useRef(null);

    useEffect(() => {
        if (!mapContainer.current) return;
        let map = mapRef.current
        map = new maplibregl.Map({
            container: mapContainer.current,
            style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
            center: [98.98575367848636, 18.78652392003516],
            zoom: 13,
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
                id: 'geojson-layer',
                type: 'fill',
                source: 'geojson-source',
                paint: {
                    'fill-color': '#088',
                    'fill-opacity': 0.4
                }
            });
        });

        const fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "collectedProperties": [
                            {
                                "shape": "line"
                            }
                        ],
                        "shape": "polygon",
                        "_gmid": "feature-3"
                    },
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [
                            [
                                [
                                    [
                                        98.99280368458221,
                                        18.787788680291285
                                    ],
                                    [
                                        98.9882624649066,
                                        18.797847787453335
                                    ],
                                    [
                                        98.99809237985426,
                                        18.798071929629202
                                    ],
                                    [
                                        99.00009912971143,
                                        18.789127139900202
                                    ],
                                    [
                                        98.99280368458221,
                                        18.787788680291285
                                    ]
                                ]
                            ]
                        ]
                    },
                },
                {
                    "type": "Feature",
                    "properties": {
                        "collectedProperties": [
                            {
                                "shape": "line"
                            }
                        ],
                        "shape": "polygon",
                        "_gmid": "feature-7"
                    },
                    "geometry": {
                        "type": "MultiPolygon",
                        "coordinates": [
                            [
                                [
                                    [
                                        99.00327206408622,
                                        18.80303701221004
                                    ],
                                    [
                                        98.99797697312482,
                                        18.80997082204837
                                    ],
                                    [
                                        99.00880002159397,
                                        18.814754925971016
                                    ],
                                    [
                                        99.0097815085154,
                                        18.80269024574227
                                    ],
                                    [
                                        99.00327206408622,
                                        18.80303701221004
                                    ]
                                ]
                            ]
                        ]
                    },
                }
            ]
        }

        const gmOptions = {
            settings: {
                controlsPosition: 'top-right',
                throttlingDelay: 10
            },
            controls: {
                helper: {
                    snapping: { uiEnabled: true, active: true, },
                    measurements: { uiEnabled: true, active: false },
                    zoom_to_features: { uiEnabled: false, active: false },
                    shape_markers: { uiEnabled: false, active: false },
                },
                draw: {
                    polygon: {
                        title: 'Draw Polygon',
                        icon: 'custom-polygon-icon',
                        uiEnabled: true,
                        active: false,
                        options: [
                            {
                                type: 'toggle',
                                name: 'snap',
                                label: 'Snap to Vertices',
                                value: true
                            }
                        ]
                    },
                    line: { title: 'Draw Line', uiEnabled: false, active: false },
                    marker: { title: 'Draw Marker', uiEnabled: false, active: false },
                    circle: { title: 'Draw Circle', uiEnabled: false, active: false },
                    circle_marker: { title: 'Draw Circle Marker', uiEnabled: false, active: false },
                    text_marker: { title: 'Draw Text Marker', uiEnabled: false, active: false },
                    rectangle: { title: 'Draw Rectangle', uiEnabled: false, active: false },
                    freehand: { title: 'Draw Freehand', uiEnabled: false, active: false },
                },
                edit: {
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

        gmRef.current = new Geoman(map, gmOptions);
        let gm = gmRef.current;
        const features = gm.features

        const handleEvent = (event) => {
            console.log('Event:', event.type);
            if (event.type === 'gm:create' || event.type === 'gm:editend') {
                console.log('Created', features.exportGeoJson());
                gm.disableDraw();
            }
        };

        map.once('idle', () => {
            gm.features.importGeoJson(fc, 'geojson-source');
        });

        map.once('gm:loaded', () => {
            map.on('gm:create', handleEvent);
            map.on('gm:editend', handleEvent);
        });

        map.on('click', (e) => {
            onMapClick(e);
            gm.disableGlobalEditMode();
        });

        return () => {
            map?.remove();
            map = null;
        };
    }, []);

    return (
        <div
            className="card"
            ref={mapContainer}
            style={{
                width: '100%',
                height: '70vh',
                position: 'relative' // Added for better positioning
            }}
        />
    );
};