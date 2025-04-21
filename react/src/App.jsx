import { useState } from 'react'
import { InputPosition } from './components/InputPosition'
import { MapBox } from './components/MapBox'

import { SelectBasemap } from './components/SelectBasemap';

import * as turf from "@turf/turf";

function App() {
  const [pos, setPos] = useState({ lat: 0, lng: 0 })
  const [mapType, setMapType] = useState('mapbox://styles/mapbox/streets-v12')
  const [roundedArea, setRoundedArea] = useState('');
  const [featId, setFeatId] = useState('');

  const handlePosition = (e) => {
    setPos({ lat: e.lngLat.lat, lng: e.lngLat.lng })
  }

  const handleInput = (e) => {
    setPos({ ...pos, [e.target.name]: e.target.value })
  }

  const handleMapTypeChange = (e) => {
    setMapType(e.target.value);
  }

  const handleRoundedArea = (e) => {
    if (e.features.length > 0) {
      const data = e.features[0].geometry;
      const polygon = turf.flatten(data);
      const area = turf.area(polygon);
      setRoundedArea(Math.round(area * 100) / 100);
    } else {
      setRoundedArea('');
    }
  }

  const handleFeatureClick = (e) => {
    if (e.features.length > 0) {
      const data = e.features[0].geometry;
      const polygon = turf.flatten(data);
      const area = turf.area(polygon);
      setRoundedArea(Math.round(area * 100) / 100);
      const feature = e.features[0];
      setFeatId(feature.id);
    } else {
      setFeatId('');
      setRoundedArea('');
    }
  }

  return (
    <div className='container'>
      <div className="mt-5">
        <SelectBasemap
          value={mapType}
          onChange={handleMapTypeChange} />
        <MapBox
          mapStyle={mapType}
          onMapClick={handlePosition}
          onRoundedArea={handleRoundedArea}
          onFeatureClick={handleFeatureClick}
        />
        <div className="row">
          <div className="col">
            <h5>Latitude</h5>
            <InputPosition
              type="number"
              name="lat"
              value={pos.lat}
              onChange={handleInput}
            />
          </div>
          <div className="col">
            <h5>Longitude</h5>
            <InputPosition
              type="number"
              name="lng"
              value={pos.lng}
              onChange={handleInput}
            />
          </div>
        </div>
        <input type="text" value={roundedArea} readOnly />
        <input type="text" value={featId} readOnly />
      </div>
    </div>
  )
}

export default App
