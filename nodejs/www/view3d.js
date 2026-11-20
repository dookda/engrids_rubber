// มุมมอง 3D (ใช้ร่วมกันหน้า reclass / reshape / reclassdash)
// ปุ่ม "3D" มุมล่างซ้ายของแผนที่ → เปิดหน้าต่างเต็มจอ: ภาพดาวเทียมความละเอียดสูงบนความสูงภูมิประเทศ (เอียง/หมุนได้)
// พร้อมแปลงที่แสดงอยู่บนแผนที่ 2D (สีตามคลาส) — ดูอย่างเดียว การแก้ไขยังทำในแผนที่ 2D เหมือนเดิม
// โหลด MapLibre เฉพาะตอนกดปุ่มครั้งแรก เพื่อไม่ให้หน้าเดิมช้าลง
(function () {
    const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    const MAX_FEATURES = 3000;

    // ── ดึงแปลงจากแผนที่ 2D ของแต่ละหน้า (ตัวแปร global ของ app.js แต่ละหน้า) ─────────
    function collectFromOpenLayers() {
        // หน้า reclass: vectorSource (EPSG:3857), สีจาก getColor()
        const fmt = new ol.format.GeoJSON();
        const features = vectorSource.getFeatures().map(f => {
            const gj = fmt.writeFeatureObject(f, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
            const ct = f.get('classtype');
            gj.properties = {
                _color: f.get('locked') ? '#0d47a1' : (typeof getColor === 'function' ? getColor(ct) : '#0ccbf0'),
                _label: f.get('locked') ? '🔒 อื่นๆ' : (f.get('sub_id') || ''),
            };
            return gj;
        });
        const v = map.getView();
        const [lng, lat] = ol.proj.toLonLat(v.getCenter());
        return { features, center: [lng, lat], zoom: v.getZoom() };
    }

    function collectFromLeaflet() {
        // หน้า reshape / reclassdash: featureGroup (Leaflet) — เอาเฉพาะที่อยู่ในกรอบแผนที่ตอนนี้
        const bounds = map.getBounds().pad(0.2);
        const out = [];
        const isDash = /\/reclassdash\//.test(location.pathname);
        const walk = (layer) => {
            if (out.length >= MAX_FEATURES) return;
            if (layer.eachLayer && !layer.feature) { layer.eachLayer(walk); return; }
            if (!layer.toGeoJSON || !layer.getBounds) return;
            try { if (!bounds.intersects(layer.getBounds())) return; } catch (_) { return; }
            const gj = layer.toGeoJSON();
            const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
            feats.forEach(f => {
                if (!f || !f.geometry || !/Polygon$/.test(f.geometry.type)) return;
                let color = '#0ccbf0';
                if (isDash && typeof getFeatureStyle === 'function') {
                    try {
                        const fc = String(getFeatureStyle({ properties: f.properties || {} }).fillColor || color);
                        // ลายทแยง (SVG pattern) ใช้ใน 3D ไม่ได้ → ใช้สีน้ำเงินเข้มของ "อื่นๆ" แทน
                        color = fc.startsWith('url(') ? '#0d47a1' : fc.slice(0, 7);
                    } catch (_) {}
                }
                out.push({ type: 'Feature', geometry: f.geometry, properties: { _color: color, _label: String(f.properties?.sub_id ?? f.properties?.id ?? '') } });
            });
        };
        featureGroup.eachLayer(walk);
        const c = map.getCenter();
        return { features: out, center: [c.lng, c.lat], zoom: map.getZoom() };
    }

    function collect() {
        if (typeof ol !== 'undefined' && typeof vectorSource !== 'undefined') return collectFromOpenLayers();
        if (typeof L !== 'undefined' && typeof featureGroup !== 'undefined') return collectFromLeaflet();
        return null;
    }

    // ── โหลด MapLibre ครั้งเดียว ─────────────────────────────────────────────
    let libPromise = null;
    function loadLib() {
        if (window.maplibregl) return Promise.resolve();
        if (libPromise) return libPromise;
        libPromise = new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = MAPLIBRE_CSS;
            document.head.appendChild(css);
            const s = document.createElement('script');
            s.src = MAPLIBRE_JS;
            s.onload = resolve;
            s.onerror = () => { libPromise = null; reject(new Error('โหลดไลบรารี 3D ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต')); };
            document.head.appendChild(s);
        });
        return libPromise;
    }

    // ── UI ───────────────────────────────────────────────────────────────────
    const CSS = `
    .v3d-btn{position:absolute;left:12px;bottom:28px;z-index:1000;display:flex;align-items:center;gap:6px;
        background:rgba(17,24,39,.85);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:10px;
        padding:7px 12px;font:700 13px "Noto Sans Thai",sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);
        backdrop-filter:blur(4px);transition:transform .15s,background .15s}
    .v3d-btn:hover{background:rgba(17,24,39,.95);transform:translateY(-1px)}
    .v3d-btn .bi{font-size:1.15rem}
    .v3d-overlay{position:fixed;inset:0;z-index:5000;background:#0b1220;display:flex;flex-direction:column}
    .v3d-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 14px;background:#111827;color:#e5e7eb;
        font:500 13px "Noto Sans Thai",sans-serif;border-bottom:1px solid #1f2937}
    .v3d-bar b{color:#fff;font-size:15px}
    .v3d-bar label{display:flex;align-items:center;gap:6px;margin:0}
    .v3d-bar input[type=range]{width:110px;accent-color:#38bdf8}
    .v3d-bar .v3d-spacer{flex:1}
    .v3d-bar button{background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer}
    .v3d-bar button:hover{background:#374151}
    .v3d-bar .v3d-close{background:#dc2626;border-color:#dc2626;color:#fff}
    .v3d-map{flex:1;position:relative}
    .v3d-hint{position:absolute;left:12px;bottom:12px;z-index:2;background:rgba(17,24,39,.8);color:#e5e7eb;
        font:12px "Noto Sans Thai",sans-serif;padding:6px 10px;border-radius:8px;pointer-events:none}
    .v3d-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e5e7eb;
        font:14px "Noto Sans Thai",sans-serif;z-index:3;background:#0b1220}`;

    function injectCss() {
        if (document.getElementById('v3d-css')) return;
        const st = document.createElement('style');
        st.id = 'v3d-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    let map3d = null;

    async function open3D() {
        const data = collect();
        if (!data) { alert('ไม่พบแผนที่ในหน้านี้'); return; }
        injectCss();
        const ov = document.createElement('div');
        ov.className = 'v3d-overlay';
        ov.innerHTML = `
            <div class="v3d-bar">
                <b><i class="bi bi-badge-3d"></i> มุมมอง 3D</b>
                <span>${data.features.length.toLocaleString()} แปลงในกรอบแผนที่</span>
                <label>ความสูงภูมิประเทศ <input type="range" id="v3dExag" min="1" max="4" step="0.5" value="1.5"><span id="v3dExagVal">×1.5</span></label>
                <label>ความเข้มแปลง <input type="range" id="v3dOpacity" min="0" max="0.8" step="0.05" value="0.3"></label>
                <label><input type="checkbox" id="v3dPlots" checked> แสดงแปลง</label>
                <span class="v3d-spacer"></span>
                <button id="v3dTop" title="มองจากด้านบน"><i class="bi bi-arrow-down-circle"></i> มุมบน</button>
                <button id="v3dTilt" title="เอียง 3D"><i class="bi bi-badge-3d"></i> เอียง</button>
                <button id="v3dSpin" title="หมุนรอบแปลง"><i class="bi bi-arrow-repeat"></i> หมุน</button>
                <button class="v3d-close" id="v3dClose"><i class="bi bi-x-lg"></i> ปิด</button>
            </div>
            <div class="v3d-map" id="v3dMap">
                <div class="v3d-loading" id="v3dLoading">กำลังโหลดมุมมอง 3D …</div>
                <div class="v3d-hint">ลากซ้าย = เลื่อน · คลิกขวาค้างแล้วลาก (หรือ Ctrl + ลาก) = หมุน/เอียง · ล้อเมาส์ = ซูม</div>
            </div>`;
        document.body.appendChild(ov);
        document.body.style.overflow = 'hidden';

        let spinning = false;
        const close = () => {
            spinning = false;
            if (map3d) { map3d.remove(); map3d = null; }
            ov.remove();
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        ov.querySelector('#v3dClose').onclick = close;

        try {
            await loadLib();
        } catch (err) {
            ov.querySelector('#v3dLoading').textContent = err.message;
            return;
        }

        const fc = { type: 'FeatureCollection', features: data.features };
        map3d = new maplibregl.Map({
            container: 'v3dMap',
            center: data.center,
            zoom: Math.min(Math.max((data.zoom || 15) - 0.5, 3), 19),
            pitch: 60,
            bearing: -20,
            maxPitch: 80,
            attributionControl: { compact: true },
            style: {
                version: 8,
                sources: {
                    // scale=2 = ภาพ 512px ต่อแผ่น (คมชัดเท่าระดับซูมถัดไป)
                    sat: {
                        type: 'raster', tileSize: 256, maxzoom: 19,
                        tiles: ['mt0', 'mt1', 'mt2', 'mt3'].map(s => `https://${s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&scale=2`),
                        attribution: '© Google',
                    },
                    dem: {
                        type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
                        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                        attribution: 'Terrain © Mapzen/AWS',
                    },
                    plots: { type: 'geojson', data: fc },
                },
                layers: [
                    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-contrast': 0.08, 'raster-saturation': 0.1 } },
                    { id: 'shade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#1e293b' } },
                    { id: 'plot-fill', type: 'fill', source: 'plots', paint: { 'fill-color': ['coalesce', ['get', '_color'], '#0ccbf0'], 'fill-opacity': 0.3 } },
                    { id: 'plot-line', type: 'line', source: 'plots', paint: { 'line-color': ['coalesce', ['get', '_color'], '#0ccbf0'], 'line-width': 2.5 } },
                    { id: 'plot-edge', type: 'line', source: 'plots', paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.8 } },
                ],
                terrain: { source: 'dem', exaggeration: 1.5 },
            },
        });
        map3d.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
        map3d.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
        map3d.addControl(new maplibregl.FullscreenControl(), 'top-right');

        map3d.on('load', () => {
            ov.querySelector('#v3dLoading')?.remove();
            try { map3d.setSky({ 'sky-color': '#7fb3e6', 'horizon-color': '#d6e7f5', 'fog-color': '#d6e7f5', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6 }); } catch (_) {}
            // เริ่มที่กรอบของแปลงที่ส่งมา (ถ้ามี)
            if (data.features.length) {
                const b = new maplibregl.LngLatBounds();
                data.features.forEach(f => {
                    const walk = (c) => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(walk));
                    walk(f.geometry.coordinates);
                });
                map3d.fitBounds(b, { padding: 80, pitch: 60, bearing: -20, maxZoom: 19, duration: 0 });
            }
        });

        const exag = ov.querySelector('#v3dExag');
        exag.oninput = () => {
            ov.querySelector('#v3dExagVal').textContent = `×${exag.value}`;
            map3d.setTerrain({ source: 'dem', exaggeration: Number(exag.value) });
        };
        ov.querySelector('#v3dOpacity').oninput = (e) => map3d.setPaintProperty('plot-fill', 'fill-opacity', Number(e.target.value));
        ov.querySelector('#v3dPlots').onchange = (e) => ['plot-fill', 'plot-line', 'plot-edge']
            .forEach(id => map3d.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none'));
        ov.querySelector('#v3dTop').onclick = () => map3d.easeTo({ pitch: 0, bearing: 0, duration: 800 });
        ov.querySelector('#v3dTilt').onclick = () => map3d.easeTo({ pitch: 65, bearing: map3d.getBearing() || -20, duration: 800 });
        const spinBtn = ov.querySelector('#v3dSpin');
        spinBtn.onclick = () => {
            spinning = !spinning;
            spinBtn.style.background = spinning ? '#0369a1' : '';
            const step = () => {
                if (!spinning || !map3d) return;
                map3d.easeTo({ bearing: map3d.getBearing() + 12, duration: 1000, easing: t => t });
                setTimeout(step, 1000);
            };
            step();
        };
        map3d.on('mousedown', () => { if (spinning) { spinning = false; spinBtn.style.background = ''; } });
    }

    // ── ปุ่ม 3D บนแผนที่ 2D ──────────────────────────────────────────────────
    function attachButton() {
        const container = document.getElementById('map');
        if (!container || container.querySelector('.v3d-btn')) return;
        injectCss();
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'v3d-btn';
        btn.title = 'เปิดมุมมอง 3D (ภาพดาวเทียม + ความสูงภูมิประเทศ)';
        btn.innerHTML = '<i class="bi bi-badge-3d"></i> 3D';
        // กันไม่ให้คลิกปุ่มทะลุไปเลือก/วาดบนแผนที่
        ['mousedown', 'pointerdown', 'dblclick', 'wheel', 'touchstart'].forEach(ev => btn.addEventListener(ev, e => e.stopPropagation()));
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open3D(); });
        container.appendChild(btn);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachButton);
    else attachButton();

    window.View3D = { open: open3D };
})();
