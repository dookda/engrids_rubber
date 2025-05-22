var meanDict = ndviImage.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi,
    scale: 10
}).getInfo();
print('Mean NDVI:', meanDict.NDVI);

