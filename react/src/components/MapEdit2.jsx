import React, { useRef, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';

// import './MapComponent.css';

const MapEdit2 = () => {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const [selectedFeature, setSelectedFeature] = useState(null);

    useEffect(() => {
        if (map.current) return; // Initialize map only once

        // Initialize MapLibre map
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://api.maptiler.com/maps/streets/style.json?key=YOUR_MAPTILER_KEY', // Replace with your MapTiler key
            center: [0, 0],
            zoom: 2,
        });

        // Add navigation controls
        map.current.addControl(new maplibregl.NavigationControl());

        // Initialize Geoman for drawing and editing
        map.current.pm.addControls({
            position: 'topleft',
            drawCircle: false,
            drawMarker: true,
            drawPolygon: true,
            drawPolyline: true,
            editMode: false, // Disable edit mode by default
            dragMode: false,
            cutPolygon: false,
            removalMode: false,
        });

        // Disable editing globally by default
        map.current.pm.setGlobalOptions({ disableEdit: true });

        // Handle map click to select features
        map.current.on('click', (e) => {
            const features = map.current.queryRenderedFeatures(e.point, {
                layers: ['pm-layer'], // Geoman's default layer for drawn features
            });

            if (features.length > 0) {
                const feature = features[0];
                setSelectedFeature(feature);

                // Enable editing for the selected feature
                map.current.pm.enableLayerEdit(feature);
            } else {
                // Deselect and disable editing if clicking outside a feature
                setSelectedFeature(null);
                map.current.pm.disableGlobalEditMode();
            }
        });

        // Handle feature creation to add IDs (optional, for easier tracking)
        map.current.on('pm:create', (e) => {
            const feature = e.layer;
            feature.set('id', `feature-${Date.now()}`); // Assign unique ID
        });

        // Clean up on unmount
        return () => map.current.remove();
    }, []);

    return (
        <div className="map-container" ref={mapContainer} style={{ width: '100%', height: '100vh' }} />
    );
};

export default MapEdit2;