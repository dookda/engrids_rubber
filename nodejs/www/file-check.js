// ปุ่ม "ตรวจไฟล์" (หัวกลุ่ม "โครงการแก้ไขคลาส" หน้าแรก) — ตรวจไฟล์ที่แก้ใน QGIS เสร็จแล้ว ว่าแต่ละแปลงผ่านเกณฑ์ไหม
//   ① แปลงที่คลาสแล้ว: ยางพาราลงทะเบียน + พื้นที่กันออก เทียบ Rubr_total ต่างได้ไม่เกิน ±600 ตร.ม.
//   ② ขอบเขตแปลง (โฉนด): พื้นที่รูปแปลง เทียบ Deed_total ต่างได้ไม่เกิน ±100 ตร.ม.
// ใส่ไฟล์ใดไฟล์หนึ่งหรือทั้งสองก็ได้ — อ่านอย่างเดียว ไม่สร้างโครงการ ไม่บันทึกอะไร (API: POST /rub/api/file-check-600)
(function () {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sqm = (n) => (n > 0 ? '+' : '') + Number(n).toLocaleString('th-TH');
    const C = '#00796b'; // สีหลักของเครื่องมือตรวจ (แยกจากม่วงของ "แก้ไขคลาส")

    const STATUS = {
        pass: { label: 'ผ่าน', cls: 'pass', icon: 'bi-check-circle-fill' },
        near: { label: 'ผ่าน', cls: 'pass', icon: 'bi-check-circle-fill' },
        short: { label: 'ขาด', cls: 'fail', icon: 'bi-arrow-down-circle-fill' },
        over: { label: 'เกิน', cls: 'fail', icon: 'bi-arrow-up-circle-fill' },
        notarget: { label: 'ไม่มีเป้า', cls: 'none', icon: 'bi-question-circle-fill' },
    };

    // 2 การตรวจ ใช้หน้าผลลัพธ์เดียวกัน ต่างกันที่คอลัมน์/เกณฑ์
    const MODES = {
        rubber: {
            tab: 'ยาง+กันออก ±600', icon: 'bi-tree', summary: 'summary', tolKey: 'tolerance_sqm',
            status: 'status', diff: 'diff_sqm', notes: 'notes', targetCol: 'Rubr_total',
            cols: [['ยางลงทะเบียน', 'rubber_rai'], ['กันออก', 'ex_rai'], ['รวม (ไร่)', 'sum_rai', true], ['เป้า Rubr_total', 'target_rai']],
            rows: (d) => d.plots.filter(p => p.status),
        },
        deed: {
            tab: 'แปลงโฉนด ±100', icon: 'bi-bounding-box', summary: 'deed_summary', tolKey: 'deed_tolerance_sqm',
            status: 'deed_status', diff: 'deed_diff_sqm', notes: 'deed_notes', targetCol: 'Deed_total',
            cols: [['ขอบเขตแปลง (ไร่)', 'boundary_rai', true], ['เป้า Deed_total', 'deed_target_rai']],
            rows: (d) => d.plots.filter(p => p.deed_status && p.deed_status !== 'noboundary'),
        },
    };

    const CSS = `
    .fck-modal .modal-content{border:0;border-radius:18px}
    .fck-pick{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:768px){.fck-pick{grid-template-columns:1fr}}
    .fck-drop{position:relative;display:block;border:2px dashed #9fd3cb;border-radius:16px;padding:18px 14px;text-align:center;cursor:pointer;background:#f3faf9;transition:.15s;margin:0}
    .fck-drop:hover,.fck-drop.over{background:#e0f2f1;border-color:${C}}
    .fck-drop.has{border-style:solid;border-color:#43a047;background:#f1f8f1}
    .fck-drop .fck-no{position:absolute;top:10px;left:12px;width:24px;height:24px;border-radius:50%;background:${C};color:#fff;font-weight:700;font-size:.8rem;display:flex;align-items:center;justify-content:center}
    .fck-drop .fck-crit{position:absolute;top:10px;right:12px;font-size:.7rem;font-weight:700;padding:1px 8px;border-radius:999px;background:#e0f2f1;color:${C}}
    .fck-drop .fck-ico{font-size:2rem;color:${C}}
    .fck-drop.has .fck-ico{color:#43a047}
    .fck-drop b{display:block;margin-top:2px}
    .fck-drop .fck-fname{font-size:.8rem;color:#2e7d32;word-break:break-all;margin-top:4px}
    .fck-drop .fck-clear{position:absolute;top:30px;right:8px}
    .fck-hint{font-size:.78rem;color:#666;margin-top:12px;line-height:1.7;background:#fafafa;border-radius:10px;padding:8px 12px}
    .fck-tabs{display:flex;gap:6px;margin-bottom:12px;border-bottom:2px solid #e0f2f1}
    .fck-tab{border:0;background:none;padding:8px 14px;font-weight:600;color:#777;border-bottom:3px solid transparent;margin-bottom:-2px}
    .fck-tab.on{color:${C};border-bottom-color:${C}}
    .fck-tab .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:6px;vertical-align:1px}
    .fck-verdict{display:flex;align-items:center;gap:14px;border-radius:14px;padding:12px 16px;margin-bottom:12px}
    .fck-verdict i{font-size:2.2rem}
    .fck-verdict.ok{background:#e8f5e9;color:#1b5e20}
    .fck-verdict.bad{background:#fdecea;color:#b71c1c}
    .fck-verdict.warn{background:#fff8e1;color:#8d6e00}
    .fck-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
    .fck-stat{border-radius:12px;padding:8px 10px;background:#f6f6f6;cursor:pointer;border:2px solid transparent;transition:.12s;text-align:left}
    .fck-stat:hover{filter:brightness(.97)}
    .fck-stat.on{border-color:#333}
    .fck-stat b{display:block;font-size:1.35rem;line-height:1.2}
    .fck-stat small{color:#555}
    .fck-stat.pass{background:#e8f5e9}.fck-stat.fail{background:#fdecea}.fck-stat.all{background:#e0f2f1}
    .fck-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
    .fck-table-wrap{max-height:48vh;overflow:auto;border:1px solid #eee;border-radius:10px}
    .fck-table{font-size:.8rem;margin:0}
    .fck-table thead th{position:sticky;top:0;background:#fafafa;z-index:1;white-space:nowrap;vertical-align:bottom}
    .fck-table td{vertical-align:middle}
    .fck-table tr.fail td{background:#fff7f6}
    .fck-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:.72rem;font-weight:600;white-space:nowrap}
    .fck-badge.pass{background:#e8f5e9;color:#2e7d32}
    .fck-badge.fail{background:#fdecea;color:#c62828}.fck-badge.none{background:#eceff1;color:#546e7a}
    .fck-gauge{position:relative;width:130px;height:10px;border-radius:5px;background:#fbe3e1;margin:3px 0 1px}
    .fck-gauge .zone{position:absolute;left:25%;width:50%;top:0;bottom:0;background:#c8e6c9}
    .fck-gauge .mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#888}
    .fck-gauge .dot{position:absolute;top:-3px;width:6px;height:16px;border-radius:3px;margin-left:-3px;box-shadow:0 0 0 1.5px #fff}
    .fck-diff{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
    .fck-notes{margin:0;padding-left:16px;color:#6d4c41;font-size:.72rem}
    .fck-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}`;

    const HTML = `
    <div class="modal fade fck-modal" id="fckModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl modal-dialog-scrollable">
        <div class="modal-content shadow-lg">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-bold"><i class="bi bi-clipboard-check me-2" style="color:${C}"></i>ตรวจไฟล์ — เช็กความถูกต้องหลังแก้ไขเสร็จ</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body" id="fckBody"></div>
          <div class="modal-footer border-0 pt-0" id="fckFoot"></div>
        </div>
      </div>
    </div>`;

    let modal = null, result = null, mode = 'rubber', filter = 'all', query = '';
    const picked = { classified: null, boundary: null };

    function ensureDom() {
        if (document.getElementById('fckModal')) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        document.body.insertAdjacentHTML('beforeend', HTML);
        modal = new bootstrap.Modal(document.getElementById('fckModal'));
    }

    // ── เลือกไฟล์ ──────────────────────────────────────────────────────────
    function dropZone(kind, no, title, crit, desc) {
        const f = picked[kind];
        return `
            <label class="fck-drop ${f ? 'has' : ''}" data-kind="${kind}">
                <span class="fck-no">${no}</span>
                <span class="fck-crit">${crit}</span>
                ${f ? `<button type="button" class="btn btn-sm btn-link text-danger fck-clear" data-kind="${kind}" title="เอาออก"><i class="bi bi-x-circle"></i></button>` : ''}
                <i class="bi ${f ? 'bi-file-earmark-check' : 'bi-file-earmark-arrow-up'} fck-ico"></i>
                <b>${title}</b>
                <span class="text-muted small">${desc}</span>
                ${f ? `<div class="fck-fname">${esc(f.name)}</div>` : '<div class="small text-muted mt-1">ลากไฟล์มาวาง หรือคลิกเลือก (.zip / .geojson)</div>'}
                <input type="file" accept=".zip,.geojson,.json" hidden>
            </label>`;
    }

    function renderPick(error) {
        result = null;
        document.getElementById('fckBody').innerHTML = `
            ${error ? `<div class="alert alert-danger py-2"><i class="bi bi-x-circle me-1"></i>${esc(error)}</div>` : ''}
            <div class="small text-muted mb-2">ใส่ไฟล์ใดไฟล์หนึ่ง หรือทั้งสองไฟล์ก็ได้ — ตรวจอย่างเดียว ไม่สร้างโครงการ ไม่บันทึกอะไรลงระบบ แก้ใน QGIS แล้วตรวจซ้ำได้เรื่อยๆ</div>
            <div class="fck-pick">
                ${dropZone('classified', 1, 'แปลงที่คลาสแล้ว', '±600 ตร.ม.', 'ยางลงทะเบียน + กันออก เทียบ <b>Rubr_total</b>')}
                ${dropZone('boundary', 2, 'ขอบเขตแปลง (โฉนด)', '±100 ตร.ม.', 'พื้นที่รูปแปลง เทียบ <b>Deed_total</b>')}
            </div>
            <div class="fck-hint">
                <div><i class="bi bi-rulers me-1"></i>พื้นที่คิดจาก<b>รูป polygon จริง</b> (UTM) ไม่ใช้ค่าพื้นที่ในตาราง</div>
                <div><i class="bi bi-scissors me-1"></i>ใส่ทั้ง 2 ไฟล์ — คลาสส่วนที่ล้นขอบเขตแปลงจะถูกตัดออกก่อนคิด ±600 (เหมือนตอนนำเข้าจริง)</div>
                <div><i class="bi bi-layers me-1"></i>ยางที่ทับพื้นที่กันออกจะถูกหักออก และ polygon ที่ซ้อนกันเองนับครั้งเดียว</div>
                <div><i class="bi bi-link-45deg me-1"></i>จัดกลุ่มเป็นแปลงด้วย <b>Regis_No + No_Plot + Deed_ID</b></div>
            </div>`;
        document.getElementById('fckFoot').innerHTML = `
            <button class="btn btn-light ms-auto" data-bs-dismiss="modal">ปิด</button>
            <button class="btn text-white px-4" id="fckRun" style="background:${C}" ${picked.classified || picked.boundary ? '' : 'disabled'}><i class="bi bi-clipboard-check me-1"></i>ตรวจไฟล์</button>`;

        document.querySelectorAll('#fckBody .fck-drop').forEach(drop => {
            const kind = drop.dataset.kind;
            const input = drop.querySelector('input[type=file]');
            const set = (file) => { if (file) { picked[kind] = file; renderPick(); } };
            input.addEventListener('change', () => set(input.files[0]));
            ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
            ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
            drop.addEventListener('drop', e => set(e.dataTransfer.files[0]));
        });
        document.querySelectorAll('#fckBody .fck-clear').forEach(b => b.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            picked[b.dataset.kind] = null;
            renderPick();
        }));
        document.getElementById('fckRun').addEventListener('click', run);
    }

    const failCount = (s) => s ? s.short + s.over : 0;

    async function run() {
        const names = [picked.classified?.name, picked.boundary?.name].filter(Boolean).map(esc).join(' + ');
        document.getElementById('fckBody').innerHTML = `<div class="text-center py-5"><div class="spinner-border" style="color:${C}"></div><div class="mt-2 text-muted">กำลังตรวจ ${names} ...</div></div>`;
        document.getElementById('fckFoot').innerHTML = '';
        try {
            const fd = new FormData();
            if (picked.classified) fd.append('classified', picked.classified);
            if (picked.boundary) fd.append('boundary', picked.boundary);
            const r = await fetch('/rub/api/file-check-600', { method: 'POST', body: fd });
            const d = await r.json().catch(() => ({ error: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r.status})` }));
            if (!r.ok) throw new Error(d.error || r.statusText);
            result = d;
            // เปิดแท็บที่มีแปลงไม่ผ่านก่อน
            mode = !d.summary ? 'deed' : !d.deed_summary ? 'rubber'
                : (!failCount(d.summary) && failCount(d.deed_summary)) ? 'deed' : 'rubber';
            setMode(mode);
        } catch (err) {
            renderPick(err.message === 'Failed to fetch' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ หรือไฟล์ถูกแก้หลังเลือก — เลือกไฟล์ใหม่แล้วลองอีกครั้ง' : err.message);
        }
    }

    function setMode(m) {
        mode = m;
        filter = failCount(result[MODES[m].summary]) ? 'fail' : 'all';
        query = '';
        renderResult();
    }

    // ── ผลตรวจ ─────────────────────────────────────────────────────────────
    function gauge(diff, tol) {
        if (diff === null || diff === undefined) return '';
        const pos = 50 + Math.max(-1, Math.min(1, diff / (tol * 2))) * 50; // แถบเขียวกลาง = ±tol, ขอบ = ±2×tol
        const color = Math.abs(diff) <= tol ? '#2e7d32' : '#c62828';
        return `<div class="fck-gauge" title="${sqm(diff)} ตร.ม. (แถบเขียว = ±${tol})"><div class="zone"></div><div class="mid"></div><div class="dot" style="left:${pos}%;background:${color}"></div></div>`;
    }

    function visibleRows() {
        const M = MODES[mode], q = query.trim().toLowerCase();
        return M.rows(result).filter(p => {
            const st = p[M.status];
            const ok = filter === 'all' ? true
                : filter === 'fail' ? (st === 'short' || st === 'over')
                : (st === 'pass' || st === 'near');
            return ok && (!q || [p.regis_no, p.no_plot, p.deed_id, p.full_nam].some(v => String(v ?? '').toLowerCase().includes(q)));
        });
    }

    function renderResult() {
        const d = result, M = MODES[mode], s = d[M.summary], tol = d[M.tolKey];
        const fail = failCount(s), pass = s.pass + (s.near || 0);
        const tabs = d.summary && d.deed_summary ? `<div class="fck-tabs">${Object.entries(MODES).map(([k, m]) => {
            const f = failCount(d[m.summary]);
            return `<button type="button" class="fck-tab ${k === mode ? 'on' : ''}" data-m="${k}"><i class="bi ${m.icon} me-1"></i>${m.tab}<span class="dot" style="background:${f ? '#e53935' : '#43a047'}" title="${f ? `ไม่ผ่าน ${f} แปลง` : 'ผ่านทั้งหมด'}"></span></button>`;
        }).join('')}</div>` : '';
        const verdict = fail
            ? `<div class="fck-verdict bad"><i class="bi bi-x-octagon-fill"></i><div><div class="fw-bold">ยังไม่ผ่าน — ${fail} จาก ${s.plots} แปลง เกินเกณฑ์ ±${tol} ตร.ม.</div><div class="small">ขาด ${s.short} แปลง · เกิน ${s.over} แปลง — แก้ใน QGIS แล้วกด “ตรวจไฟล์ใหม่”</div></div></div>`
            : s.notarget
            ? `<div class="fck-verdict warn"><i class="bi bi-exclamation-triangle-fill"></i><div><div class="fw-bold">ผ่านทุกแปลงที่มีเป้า แต่ ${s.notarget} แปลงไม่มี ${M.targetCol}</div><div class="small">ตรวจคอลัมน์ ${M.targetCol} ของแปลงเหล่านั้น</div></div></div>`
            : `<div class="fck-verdict ok"><i class="bi bi-patch-check-fill"></i><div><div class="fw-bold">ผ่านเกณฑ์ ±${tol} ตร.ม. ครบทั้ง ${s.plots} แปลง</div><div class="small">ไฟล์พร้อมใช้งาน</div></div></div>`;
        const stat = (key, cls, n, label) => `<button type="button" class="fck-stat ${cls} ${filter === key ? 'on' : ''}" data-f="${key}"><b>${n}</b><small>${label}</small></button>`;
        const unknown = mode === 'rubber' ? Object.entries(d.unknownClasses || {}) : [];
        const missing = mode === 'rubber' ? d.missingColumns : [];

        document.getElementById('fckBody').innerHTML = `
            <div class="small text-muted mb-2">
                ${d.files.classified ? `<span class="badge bg-secondary">1</span> ${esc(d.files.classified)} (${d.polygons} polygon) &nbsp;` : ''}
                ${d.files.boundary ? `<span class="badge bg-secondary">2</span> ${esc(d.files.boundary)} (${d.boundary_polygons} polygon)` : ''}
            </div>
            ${tabs}
            ${verdict}
            <div class="fck-stats">
                ${stat('all', 'all', s.plots, 'แปลงทั้งหมด')}
                ${stat('pass', 'pass', pass, 'ผ่าน')}
                ${stat('fail', 'fail', fail, `ไม่ผ่าน (ขาด ${s.short} / เกิน ${s.over})`)}
            </div>
            ${mode === 'deed' && s.noboundary ? `<div class="alert alert-info py-2 small mb-2"><i class="bi bi-info-circle me-1"></i>${s.noboundary} แปลงในไฟล์ ① ไม่มีรูปขอบเขตในไฟล์ ② — ไม่ได้ตรวจ ±100</div>` : ''}
            ${missing.length ? `<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-exclamation-triangle me-1"></i>ไม่พบคอลัมน์: ${missing.map(esc).join(', ')}</div>` : ''}
            ${unknown.length ? `<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-question-circle me-1"></i>Classtype ที่ไม่รู้จัก (ไม่นับเข้าเป้า): ${unknown.map(([k, n]) => `<b>${esc(k)}</b> (${n})`).join(', ')}</div>` : ''}
            <div class="fck-tools">
                <div class="input-group input-group-sm" style="max-width:300px">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input id="fckQ" class="form-control" placeholder="ค้นหาเลขทะเบียน / ชื่อ / โฉนด" value="${esc(query)}">
                </div>
                <span class="small text-muted" id="fckCount"></span>
                <button class="btn btn-sm btn-outline-secondary ms-auto" id="fckCsv"><i class="bi bi-download me-1"></i>ดาวน์โหลดผล (CSV)</button>
            </div>
            <div class="fck-table-wrap">
                <table class="table table-sm table-hover fck-table">
                    <thead><tr>
                        <th>#</th><th>สถานะ</th><th>เลขทะเบียน / แปลง</th><th>ชื่อ</th>
                        ${M.cols.map(([h]) => `<th class="fck-num">${h}</th>`).join('')}
                        <th>ส่วนต่าง (ตร.ม.)</th><th>ข้อสังเกต</th>
                    </tr></thead>
                    <tbody id="fckRows"></tbody>
                </table>
            </div>`;
        document.getElementById('fckFoot').innerHTML = `
            <button class="btn btn-light me-auto" data-bs-dismiss="modal">ปิด</button>
            <button class="btn text-white px-4" id="fckAgain" style="background:${C}"><i class="bi bi-arrow-repeat me-1"></i>ตรวจไฟล์ใหม่</button>`;

        document.querySelectorAll('#fckBody .fck-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
        document.querySelectorAll('#fckBody .fck-stat').forEach(b => b.addEventListener('click', () => {
            filter = b.dataset.f;
            document.querySelectorAll('#fckBody .fck-stat').forEach(x => x.classList.toggle('on', x === b));
            renderRows();
        }));
        document.getElementById('fckQ').addEventListener('input', (e) => { query = e.target.value; renderRows(); });
        document.getElementById('fckCsv').addEventListener('click', downloadCsv);
        // ไฟล์ที่แก้ใน QGIS แล้วบันทึกทับ ต้องเลือกใหม่ (เบราว์เซอร์อ่านไฟล์เดิมที่เปลี่ยนไปแล้วไม่ได้)
        document.getElementById('fckAgain').addEventListener('click', () => { picked.classified = picked.boundary = null; renderPick(); });
        renderRows();
    }

    function renderRows() {
        const M = MODES[mode], rows = visibleRows(), tol = result[M.tolKey], ncol = 6 + M.cols.length;
        document.getElementById('fckCount').textContent = `แสดง ${rows.length} จาก ${M.rows(result).length} แปลง`;
        document.getElementById('fckRows').innerHTML = rows.length ? rows.map((p, i) => {
            const st = STATUS[p[M.status]], diff = p[M.diff], notes = p[M.notes] || [];
            return `
            <tr class="${st.cls === 'fail' ? 'fail' : ''}">
                <td class="text-muted">${i + 1}</td>
                <td><span class="fck-badge ${st.cls}"><i class="bi ${st.icon}"></i>${st.label}</span></td>
                <td class="text-nowrap">${esc(p.regis_no || '-')} <small class="text-muted">/ ${esc(p.no_plot ?? '-')}</small><div class="text-muted" style="font-size:.68rem">โฉนด ${esc(p.deed_id || '-')}${mode === 'rubber' ? ` · ${p.polygons} polygon` : ''}</div></td>
                <td>${esc(p.full_nam || '-')}</td>
                ${M.cols.map(([, k, bold]) => `<td class="fck-num ${bold ? 'fw-semibold' : ''}">${fmt(p[k])}</td>`).join('')}
                <td>${diff === null || diff === undefined ? '<span class="text-muted">-</span>' : `
                    <span class="fck-diff ${Math.abs(diff) <= tol ? 'text-success' : 'text-danger'}">${sqm(diff)}</span>
                    ${gauge(diff, tol)}
                    ${Math.abs(diff) > tol ? `<div style="font-size:.68rem" class="text-danger">${diff < 0 ? 'ต้องเพิ่ม' : 'ต้องลด'} อย่างน้อย ${(Math.abs(diff) - tol).toLocaleString('th-TH')} ตร.ม.</div>` : ''}`}</td>
                <td>${notes.length ? `<ul class="fck-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '<span class="text-muted">-</span>'}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="${ncol}" class="text-center text-muted py-4">ไม่มีแปลงในตัวกรองนี้</td></tr>`;
    }

    function downloadCsv() {
        const M = MODES[mode];
        const head = ['สถานะ', 'Regis_No', 'No_Plot', 'Deed_ID', 'ชื่อ', ...M.cols.map(([h]) => h), 'ส่วนต่าง (ตร.ม.)', 'ข้อสังเกต'];
        const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const r2 = (n) => n === null || n === undefined ? '' : (Math.round(n * 100) / 100).toFixed(2);
        const lines = [head.map(cell).join(',')].concat(visibleRows().map(p => [
            STATUS[p[M.status]].label, p.regis_no, p.no_plot, p.deed_id, p.full_nam,
            ...M.cols.map(([, k]) => r2(p[k])), p[M.diff] ?? '', (p[M.notes] || []).join(' | '),
        ].map(cell).join(',')));
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const src = result.files.classified || result.files.boundary || 'file';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ตรวจ${mode === 'deed' ? 'โฉนด100' : '600'}_${src.replace(/\.[^.]+$/, '')}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    window.openFileCheck = function () {
        ensureDom();
        if (!result) renderPick();
        modal.show();
    };

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filecheck-btn')) return;
        e.preventDefault();
        window.openFileCheck();
    });
})();
