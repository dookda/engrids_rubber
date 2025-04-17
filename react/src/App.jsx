import { useState } from 'react'
import { Map } from './components/Map'
import { InputPosition } from './components/InputPosition'

function App() {
  const [pos, setPos] = useState({ lat: 0, lng: 0 })

  const handlePosition = (e) => {
    setPos({ lat: e.lngLat.lat, lng: e.lngLat.lng })
  }

  const handleInput = (e) => {
    setPos({ ...pos, [e.target.name]: e.target.value })
  }

  return (
    <div className='container'>
      <div className="mt-5">
        <Map onMapClick={handlePosition} />
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
      </div>
    </div>
  )
}

export default App
