import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';

export const MapEdit = ({ onMapClick }) => {
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

        gmRef.current = new Geoman(map, gmOptions);
        let gm = gmRef.current;

        // Add your existing Geoman event handlers
        map.on('gm:create', (event) => {
            console.log('Feature created:', event);
        });

        map.on('gm:editend', (event) => {
            console.log('Feature edited:', event);
        });

        // New feature click handler
        const handleFeatureClick = (e) => {
            console.log('Feature clicked:', e);
            const features = map.queryRenderedFeatures(e.point, {
                layers: ['geojson-layer']
            });

            if (features.length > 0) {
                const clickedFeature = features[0];
                console.log('Clicked feature:', {
                    id: clickedFeature.id,
                    properties: clickedFeature.properties,
                    geometry: clickedFeature.geometry
                });

                // Add your custom click logic here
                alert(`Feature clicked! ID: ${clickedFeature.id}`);
            }
        };

        // Add hover effects
        const handleHover = () => {
            map.getCanvas().style.cursor = 'pointer';
        };

        const resetCursor = () => {
            map.getCanvas().style.cursor = '';
        };

        map.on('load', () => {
            map.once('idle', () => {
                fetch('http://localhost:3300/rub/api/getfeaturescollection')
                    .then(response => response.json())
                    .then(async (apiData) => {
                        try {
                            gm.features.importGeoJson(apiData.data);
                            // gm.features.forEach((feature) => {
                            //     console.log(feature);
                            // });

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

                        } catch (error) {
                            console.error('Feature interaction error:', error);
                        }
                    })
                    .catch(error => console.error('Error loading GeoJSON:', error));
            });
        });

        map.on('click', function (event) {
            map.gm.disableGlobalEditMode();
            const feature = gm.features.getFeatureByMouseEvent({
                event: event,
                sourceNames: ['gm_main']
            });

            if (feature) {
                console.log('Feature clicked:', feature);

                // feature.gm.enableMode('edit', 'change');
                map.gm.pm.enable({ featureId: feature.id });
            } else {
                console.log('No feature found at this location.');
            }
        });

        const gmEvents = [];
        const getGeoJson = (featureData) => {
            try {
                return JSON.stringify(featureData.getGeoJson(), null, 2);
            } catch (e) {
                return 'Can\'t retrieve GeoJSON';
            }
        };

        const handleEvent = (event) => {
            console.log('Event', event);
            gmEvents.push({
                id: event?.feature?.id ?? undefined,
                enabled: event?.enabled ?? undefined,
                timestamp: new Date().toLocaleTimeString(),
                type: event?.type,
                shape: event?.shape ?? undefined,
                geojson: event?.feature ? getGeoJson(event.feature) : undefined,
            });
        };

        map.once('gm:loaded', () => {
            console.log('Geoman loaded');
            map.on('gm:globaldrawmodetoggled', handleEvent);
            map.on('gm:globaleditmodetoggled', handleEvent);
            map.on('gm:create', handleEvent);
            map.on('gm:editstart', handleEvent);
            map.on('gm:editend', handleEvent);
        });

        return () => {
            // Cleanup event listeners
            map?.off('click', 'geojson-layer', handleFeatureClick);
            map?.off('mousemove', 'geojson-layer', handleHover);
            map?.off('mouseleave', 'geojson-layer', resetCursor);
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