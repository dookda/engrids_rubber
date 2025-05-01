import { useState } from 'react'
import Map from './components/Map'
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min';
import { SelectType } from './components/SelectType';

function App() {
  const [selectedType, setSelectedType] = useState('rubber')

  const handleType = (property) => {
    console.log('Selected type:', property);
    setSelectedType(property.classtype)
    // fetch('http://localhost:3300/rub/api/update_landuse', {
    //   method: 'PUT',
    //   headers: {
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     sub_id: property.sub_id,
    //     classtype: property.classtype
    //   })
    // })
    //   .then(response => response.json())
    //   .then(async (data) => {
    //     if (data.success) {
    //       const id = property.id;
    //       // featureGroup.clearLayers();
    //       // await loadGeoData(id);
    //       console.log('Update successful');
    //     } else {
    //       alert('Update failed');
    //     }
    //   });
  }

  const handleClickFeature = (feature) => {
    console.log('Feature clicked:', feature);
    setSelectedType(feature.classtype)
  }

  return (
    <div className="container-fluid">
      <div className="row mt-3">
        <div className="col-md-9">
          <Map onClickFeature={handleClickFeature} />
        </div>
        <div className="col-md-3">
          <div className="card">
            <div className="card-header">
              <h5>Map Controls</h5>
            </div>
            <div className="card-body">
              <SelectType
                value={selectedType}
                onChangeType={handleType} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
