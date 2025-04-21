import React from 'react'

export const SelectBasemap = ({ value, onChange }) => {
    const baseMaps = {
        streets: 'mapbox://styles/mapbox/streets-v12',
        standard: 'mapbox://styles/mapbox/standard',
        satellite: 'mapbox://styles/mapbox/satellite-v9',
        light: 'mapbox://styles/mapbox/light-v11',
        dark: 'mapbox://styles/mapbox/dark-v11',
        outdoors: 'mapbox://styles/mapbox/outdoors-v12'
    };

    return (
        <select
            className="form-select mb-3"
            onChange={onChange}
            value={value}>
            {Object.keys(baseMaps).map((key) => (
                <option key={key} value={baseMaps[key]}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                </option>
            ))}
        </select>
    )
}
