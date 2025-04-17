import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const Map = ({ onMapClick }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);
    const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_TOKEN;

    useEffect(() => {
        if (!mapContainer.current) return;

        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
            center: [98.98575367848636, 18.78652392003516],
            zoom: 13,
            pitch: 45,
            bearing: -17.6,
            antialias: true
        });

        mapRef.current = map;

        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        map.on('load', () => {
            map.setProjection({ type: 'globe' });
        });

        map.on('click', (e) => onMapClick(e));

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []);

    return (
        <div
            className="card"
            ref={mapContainer}
            style={{
                width: '100%',
                height: '50vh',
                position: 'relative' // Added for better positioning
            }}
        />
    );
};