// Import CSS ของ Bootstrap
import 'bootstrap/dist/css/bootstrap.min.css';
// Import JavaScript ของ Bootstrap
import 'bootstrap/dist/js/bootstrap.bundle.min';

import Router from './router.js';

const routes = [
  { path: '/', component: 'home' },
  { path: '/about', component: 'about' },
  { path: '/products', component: 'products' },
  { path: '/map', component: 'map' },
];

new Router(routes);

// Import Leaflet CSS
import 'leaflet/dist/leaflet.css';
// Import Leaflet JS
import L from 'leaflet';

// แก้ไขปัญหา marker หายใน Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/marker-icon-2x.png',
  iconUrl: '/marker-icon.png',
  shadowUrl: '/marker-shadow.png',
});