import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const Map = () => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);


    const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_TOKEN;

    useEffect(() => {
        if (!mapContainer.current) return;

        const map = new maplibregl.Map({
            style: `https://api.maptiler.com/maps/basic-v2/style.json?key=${MAPTILER_KEY}`,
            center: [100, 18],
            zoom: 15.5,
            pitch: 45,
            bearing: -17.6,
            container: mapContainer.current,
            canvasContextAttributes: { antialias: true }
        });

        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
            }
        };
    }, []);

    return (
        <div className="card"
            ref={mapContainer}
            style={{
                width: '100%',
                height: '50vh'
            }}
        />
    );
};