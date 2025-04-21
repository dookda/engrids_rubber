import React, { useEffect, useState, useRef, use } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from "@mapbox/mapbox-gl-draw";
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

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch('http://localhost:3300/rub/api/getfeaturescollection')
                const apiData = await response.json();
                setFeatures(apiData.data.features);
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
                // draw_point: SnapPointMode,
                draw_polygon: SnapPolygonMode,
                draw_line_string: SnapLineMode,
                // direct_select: SnapDirectSelect,
            },
            displayControlsDefault: false,
            controls: {
                polygon: true,
                line_string: true,
                point: false,
                trash: true
            },
            styles: SnapModeDrawStyles,
            userProperties: true,
            snap: true,
            snapOptions: {
                snapPx: 15,
                snapToMidPoints: true,
                snapVertexPriorityDistance: 0.0025,
            },
        });

        drawRef.current = draw;
        mapRef.current.addControl(draw, 'top-right');

        if (features.length > 0) {
            features.map(feature => draw.add(feature));
        }

        mapRef.current.on('draw.create', (e) => console.log('draw.create', e));
        mapRef.current.on('draw.update', (e) => onRoundedArea(e));
        mapRef.current.on('draw.selectionchange', (e) => onFeatureClick(e));
        mapRef.current.on('click', (e) => onMapClick(e));

        return () => mapRef.current.remove();
    }, [features]);

    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.setStyle(mapStyle);
        }
    }, [mapStyle]);

    return (
        <>
            <div
                ref={mapContainer}
                style={{ width: '100%', height: '70vh' }}
            ></div>

        </>
    )
}
