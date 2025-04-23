import React, { useEffect, useState, useRef, use } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import * as turf from "@turf/turf";
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import {
    SnapPolygonMode,
    SnapPointMode,
    SnapLineMode,
    SnapModeDrawStyles,
    SnapDirectSelect,
} from 'mapbox-gl-draw-snap-mode';

export const MapBox = ({ mapStyle, onMapClick, onRoundedArea, onFeatureClick }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);
    const drawRef = useRef(null);
    const [features, setFeatures] = useState([]);
    const [bounds, setBounds] = useState(null);

    const calculateBounds = (features) => {
        if (!features || features.length === 0) return null;
        let bounds = new mapboxgl.LngLatBounds();
        features.forEach(feature => {
            var flatten = turf.flatten(feature.geometry);
            var geometry = flatten.features[0].geometry;
            switch (geometry.type) {
                case 'Polygon':
                    geometry.coordinates[0].forEach(coord => bounds.extend(coord));
                    break;
                case 'LineString':
                    geometry.coordinates.forEach(coord => bounds.extend(coord));
                    break;
                case 'Point':
                    bounds.extend(geometry.coordinates);
                    break;
            }
        });
        return bounds;
    };

    const customDrawStyles = [
        ...SnapModeDrawStyles.filter(style => style.id !== 'gl-draw-polygon-fill-inactive.hot'),
        {
            id: 'gl-draw-polygon-fill-inactive.hot',
            type: 'fill',
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static'], ['==', 'active', 'false']],
            paint: {
                'fill-color': ['case',
                    ['<', ['to-number', ['get', 'xls_sqm'], 0], 5000], '#FF0000',
                    ['<', ['to-number', ['get', 'xls_sqm'], 0], 10000], '#FFFF00',
                    ['<', ['to-number', ['get', 'xls_sqm'], 0], 20000], '#00FF00',
                    '#0000FF'
                ],
                'fill-opacity': 0.1
            }
        },
    ];

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch('http://localhost:3300/rub/api/getfeaturescollection')
                const apiData = await response.json();
                setFeatures(apiData.data.features);

                const calculatedBounds = calculateBounds(apiData.data.features);
                setBounds(calculatedBounds);

            } catch (error) {
                console.error('Error fetching data:', error);
            }
        }
        fetchData();
    }, []);

    useEffect(() => {
        mapboxgl.accessToken = 'pk.eyJ1IjoiZG9va2RhIiwiYSI6ImNscTM3azN3OTA4dmEyaXF1bmg3cXRvbDUifQ.d1Ovd_n9PwJqc_MdGS66-A';
        mapRef.current = new mapboxgl.Map({
            container: mapContainer.current,
            projection: 'globe',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [98.99267163885334, 18.7863951978161],
            zoom: 12,
        });

        mapRef.current.addControl(new mapboxgl.NavigationControl());

        const draw = new MapboxDraw({
            modes: {
                ...MapboxDraw.modes,
                draw_polygon: SnapPolygonMode,
                draw_line_string: SnapLineMode,
            },
            displayControlsDefault: false,
            controls: {
                polygon: false,
                line_string: false,
                point: false,
                trash: false
            },
            styles: customDrawStyles,
            userProperties: true,
            snap: true,
            snapOptions: {
                snapPx: 15,
                snapToMidPoints: true,
                snapVertexPriorityDistance: 0.0025
            },
        });

        mapRef.current.on('load', () => {
            if (features.length > 0) {
                draw.add({ type: 'FeatureCollection', features });
                console.log(draw.getAll());
            }
        });

        drawRef.current = draw;
        mapRef.current.addControl(draw, 'top-right');

        mapRef.current.on('draw.create', (e) => console.log('draw.create', e));
        mapRef.current.on('draw.update', (e) => onRoundedArea(e));
        mapRef.current.on('draw.selectionchange', (e) => onFeatureClick(e));
        mapRef.current.on('click', (e) => onMapClick(e));

        return () => mapRef.current.remove();
    }, [features]);

    useEffect(() => {
        if (mapStyle.startsWith('http')) {
            mapRef.current.setStyle({
                version: 8,
                sources: { 'osm': { type: 'raster', tiles: [mapStyle], tileSize: 256 } },
                layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
            });
        } else {
            mapRef.current.setStyle(mapStyle);
        }
    }, [mapStyle]);

    useEffect(() => {
        if (bounds && mapRef.current) {
            mapRef.current.fitBounds(bounds, {
                padding: 20,
                maxZoom: 15,
                duration: 1000
            });
        }
    }, [bounds]);

    return (
        <>
            <div className="card"
                ref={mapContainer}
                style={{ width: '100%', height: '70vh' }}
            ></div>
        </>
    )
}


