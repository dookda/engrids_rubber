import React, { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { SelectBasemap } from './SelectBasemap';

export const MapBox = ({ mapStyle }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);
    const [mapType, setMapType] = useState('streets')

    useEffect(() => {
        mapboxgl.accessToken = 'pk.eyJ1IjoiZG9va2RhIiwiYSI6ImNscTM3azN3OTA4dmEyaXF1bmg3cXRvbDUifQ.d1Ovd_n9PwJqc_MdGS66-A';
        mapRef.current = new mapboxgl.Map({
            container: mapContainer.current,
            projection: 'globe',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [0, 0],
            zoom: 2,
        });

        mapRef.current.addControl(new mapboxgl.NavigationControl());

        return () => {
            mapRef.current.remove();
        };
    }, []);

    const handleMapTypeChange = (e) => {
        setMapType(e.target.value);
        mapRef.current.setStyle(`${e.target.value}`);
    }

    return (

        <>
            <SelectBasemap
                value={mapType}
                onChange={handleMapTypeChange} />
            <div ref={mapContainer} style={{ width: '100%', height: '70vh' }} >MapBox</div>
        </>
    )
}
