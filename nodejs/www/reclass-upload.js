// ปุ่ม "แก้ไขคลาส" (หน้าแรก) — สร้างโครงการใหม่จากไฟล์ที่แก้ใน QGIS เพื่อใช้ปรับแก้ข้อมูล (ไม่แตะโครงการเดิม)
// นำเข้า 2 ไฟล์: ① ขอบเขตแปลง (จำเป็น)  ② แปลงที่คลาสแล้ว (ไม่บังคับ)
// ขั้นตอน: 1) ตั้งชื่อ + เลือกไฟล์ → 2) ตรวจสอบรายแปลง → 3) สร้างโครงการ + ดูผลลัพธ์
// เมื่อสร้างแล้ว โครงการจะขึ้นในรายการหน้าแรก ใช้ ปรับรูปแปลง / Reclass / Dashboard ได้ตามปกติ
(function () {
    const CLASSES = {
        'rubber': ['ยางพาราที่ลงทะเบียน', 'ยางลงทะเบียน', '#006d2c'],
        'ex_age_rubber': ['พื้นที่กันออก (ยางพาราต่างอายุ)', 'ยางต่างอายุ', '#00ff0d'],
        'ex_building': ['พื้นที่กันออก (สิ่งปลูกสร้าง)', 'สิ่งปลูกสร้าง', '#ff00d4'],
        'ex_pond': ['พื้นที่กันออก (บ่อน้ำ)', 'บ่อน้ำ', '#00fff2'],
        'ex_cr_area': ['พื้นที่กันออก (ถนนคอนกรีต)', 'ถนนคอนกรีต', '#ffff00'],
        'ex_ar_area': ['พื้นที่กันออก (ถนนลาดยาง)', 'ถนนลาดยาง', '#00008b'],
        'ex_other': ['พื้นที่กันออก (เพิ่มเติม)', 'กันออกเพิ่มเติม', '#AACDDC'],
        'not-rubber': ['ยางพาราที่ไม่ได้ลงทะเบียน', 'ยางไม่ลงทะเบียน', '#9900ff'],
        'Other': ['ไม่ใช่ยางพารา', 'ไม่ใช่ยาง', '#ff0004'],
    };
    const LEGEND = ['rubber', 'ex_age_rubber', 'ex_building', 'ex_pond', 'ex_cr_area', 'ex_ar_area', 'ex_other'];
    const meta = (c) => CLASSES[c] || ['อื่นๆ', 'อื่นๆ', '#e53935'];
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const fmt = (n) => (n === null || n === undefined || isNaN(n)) ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sw = (c) => `<span class="rcu-sw" style="background:${meta(c)[2]}"></span>`;
    const COLS_BOUNDARY = ['Farmer_ID', 'Regis_No', 'No_Plot', 'Title_name', 'F_name', 'L_name', 'Full_nam', 'Address', 'Sub_Dis', 'District', 'Province', 'F_Status', 'Deed_ID', 'Deed_Type', 'Rubr_Rai', 'Rubr_Ngan', 'Rubr_sqwa', 'Rubr_total', 'Deed_Rai', 'Deed_Ngan', 'Deed_sqwa', 'Deed_total', 'Para_Age', 'X', 'Y'];
    const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

    const CSS = `
    .rcu-modal .modal-content{border:0;border-radius:18px}
    .rcu-steps{display:flex;gap:6px;margin-bottom:16px}
    .rcu-steps div{flex:1;text-align:center;font-size:.8rem;padding:6px 4px;border-radius:999px;background:#f1f1f1;color:#888}
    .rcu-steps div.on{background:#6a1b9a;color:#fff}
    .rcu-steps div.done{background:#e8d5f0;color:#6a1b9a}
    .rcu-name{background:#fbf7fd;border-radius:14px;padding:12px 14px;margin-bottom:12px}
    .rcu-pick{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:768px){.rcu-pick{grid-template-columns:1fr}}
    .rcu-drop{position:relative;display:block;border:2px dashed #c9a6dc;border-radius:16px;padding:18px 14px;text-align:center;cursor:pointer;background:#fbf7fd;transition:.15s;margin:0}
    .rcu-drop:hover,.rcu-drop.over{background:#f3e5f5;border-color:#6a1b9a}
    .rcu-drop.has{border-style:solid;border-color:#43a047;background:#f1f8f1}
    .rcu-drop .rcu-no{position:absolute;top:10px;left:12px;width:24px;height:24px;border-radius:50%;background:#6a1b9a;color:#fff;font-weight:700;font-size:.8rem;display:flex;align-items:center;justify-content:center}
    .rcu-drop .rcu-req{position:absolute;top:10px;right:12px;font-size:.68rem;padding:1px 8px;border-radius:999px;background:#fdecea;color:#c62828}
    .rcu-drop .rcu-req.opt{background:#eee;color:#777}
    .rcu-drop.has .rcu-req{display:none}
    .rcu-drop .rcu-ico{font-size:2rem;color:#6a1b9a}
    .rcu-drop.has .rcu-ico{color:#43a047}
    .rcu-drop b{display:block;margin-top:2px}
    .rcu-drop .rcu-fname{font-size:.8rem;color:#2e7d32;word-break:break-all;margin-top:4px}
    .rcu-drop .rcu-clear{position:absolute;top:6px;right:8px}
    .rcu-cols{font-size:.68rem;color:#888;margin-top:8px;line-height:1.5;text-align:left}
    .rcu-cols code{font-size:.66rem;padding:0 2px}
    .rcu-hint{font-size:.78rem;color:#666;margin-top:12px;line-height:1.7;background:#fafafa;border-radius:10px;padding:8px 12px}
    .rcu-sw{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.3);margin-right:4px;vertical-align:-1px;flex-shrink:0}
    .rcu-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.76rem;color:#555;background:#fafafa;border-radius:10px;padding:8px 10px;margin-bottom:10px}
    .rcu-legend span{display:inline-flex;align-items:center}
    .rcu-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
    .rcu-stat{border-radius:12px;padding:8px 10px;background:#f6f6f6}
    .rcu-stat b{display:block;font-size:1.35rem;line-height:1.2}
    .rcu-stat small{color:#666}
    .rcu-stat.new{background:#e3f2fd}.rcu-stat.cls{background:#f3e5f5}.rcu-stat.ok{background:#e8f5e9}.rcu-stat.skip{background:#fdecea}
    .rcu-table-wrap{max-height:46vh;overflow:auto;border:1px solid #eee;border-radius:10px}
    .rcu-table{font-size:.8rem;margin:0}
    .rcu-table thead th{position:sticky;top:0;background:#fafafa;z-index:1;white-space:nowrap;vertical-align:bottom}
    .rcu-table td{vertical-align:middle}
    .rcu-chips{display:flex;flex-wrap:wrap;gap:3px}
    .rcu-chip{display:inline-flex;align-items:center;border:1px solid #e5e5e5;border-radius:999px;padding:1px 8px;white-space:nowrap;background:#fff}
    .rcu-target{white-space:nowrap;font-variant-numeric:tabular-nums}
    .rcu-target .ok{color:#2e7d32;font-weight:600}.rcu-target .low{color:#c62828;font-weight:600}
    .rcu-done{text-align:center;padding:16px 8px 8px}
    .rcu-done i.big{font-size:3rem;color:#43a047}
    @media (max-width:768px){.rcu-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

    const HTML = `
    <div class="modal fade rcu-modal" id="rcuModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-xl modal-dialog-scrollable">
        <div class="modal-content shadow-lg">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-bold"><i class="bi bi-palette me-2" style="color:#6a1b9a"></i>แก้ไขคลาส — สร้างโครงการใหม่จากไฟล์</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="rcu-steps"><div data-s="1">1. ตั้งชื่อ + เลือกไฟล์</div><div data-s="2">2. ตรวจสอบ</div><div data-s="3">3. สร้างโครงการแล้ว</div></div>
            <div id="rcuBody"></div>
          </div>
          <div class="modal-footer border-0 pt-0" id="rcuFoot"></div>
        </div>
      </div>
    </div>`;

    let name = '', preview = null, modal = null, created = false;
    const picked = { boundary: null, classified: null };
    const nq = () => encodeURIComponent(name);

    function suggestName() {
        const d = new Date();
        return `edit_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }

    function ensureDom() {
        if (document.getElementById('rcuModal')) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        document.body.insertAdjacentHTML('beforeend', HTML);
        const el = document.getElementById('rcuModal');
        modal = new bootstrap.Modal(el);
        // สร้างโครงการแล้ว → ปิดหน้าต่างแล้วโหลดหน้าแรกใหม่ให้เห็นโครงการใหม่ในรายการ
        el.addEventListener('hidden.bs.modal', () => { if (created) location.reload(); });
    }

    function setStep(n) {
        document.querySelectorAll('#rcuModal .rcu-steps div').forEach(d => {
            const s = Number(d.dataset.s);
            d.className = s === n ? 'on' : s < n ? 'done' : '';
        });
    }

    const legendHtml = () => `<div class="rcu-legend">${LEGEND.map(c => `<span>${sw(c)}${esc(meta(c)[0])}</span>`).join('')}<span>${sw(null)}อื่นๆ (ไม่นับเป็นยางลงทะเบียน)</span></div>`;

    // เกณฑ์เดียวกับระบบเดิม (reclass / reclassdash): ยางพารา ±600 ตร.ม. = ±0.375 ไร่
    const TOL_RAI = 600 / 1600;
    const onTarget = (sum, target) => target !== null && target !== undefined && Math.abs(sum - target) <= TOL_RAI;
    const targetCell = (sum, target) => {
        if (target === null || target === undefined) return `<span class="rcu-target">${fmt(sum)}</span>`;
        const ok = onTarget(sum, target);
        const diff = sum - target;
        const msg = ok ? '<i class="bi bi-check-circle"></i> ตรงเป้า (±600 ตร.ม.)' : diff < 0 ? `ขาด ${fmt(-diff)} ไร่` : `เกิน ${fmt(diff)} ไร่`;
        return `<span class="rcu-target"><span class="${ok ? 'ok' : 'low'}">${fmt(sum)}</span> / ${fmt(target)}
                <div style="font-size:.68rem" class="${ok ? 'text-success' : 'text-danger'}">${msg}</div></span>`;
    };

    // ── Step 1: ตั้งชื่อโครงการ + เลือกไฟล์ ─────────────────────────────────
    function dropZone(kind, no, title, desc, cols, required) {
        const f = picked[kind];
        return `
            <label class="rcu-drop ${f ? 'has' : ''}" data-kind="${kind}">
                <span class="rcu-no">${no}</span>
                <span class="rcu-req ${required ? '' : 'opt'}">${required ? 'จำเป็น' : 'ไม่บังคับ'}</span>
                ${f ? `<button type="button" class="btn btn-sm btn-link text-danger rcu-clear" data-kind="${kind}" title="เอาออก"><i class="bi bi-x-circle"></i></button>` : ''}
                <i class="bi ${f ? 'bi-file-earmark-check' : 'bi-file-earmark-arrow-up'} rcu-ico"></i>
                <b>${title}</b>
                <span class="text-muted small">${desc}</span>
                ${f ? `<div class="rcu-fname">${esc(f.name)}</div>` : '<div class="small text-muted mt-1">ลากไฟล์มาวาง หรือคลิกเลือก (.zip / .geojson)</div>'}
                <div class="rcu-cols">${cols.map(c => `<code>${c}</code>`).join(' ')}</div>
                <input type="file" accept=".zip,.geojson,.json" hidden>
            </label>`;
    }

    function nameError(v) {
        if (!v) return 'กรุณาตั้งชื่อโครงการ';
        if (!NAME_RE.test(v)) return 'ใช้ได้เฉพาะ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร ไม่เกิน 40 ตัว';
        return null;
    }

    function updateCheckBtn() {
        const btn = document.getElementById('rcuCheck');
        if (btn) btn.disabled = !!nameError(name) || !picked.boundary;
    }

    function renderPick(error) {
        setStep(1);
        preview = null;
        const nErr = name ? nameError(name) : null;
        document.getElementById('rcuBody').innerHTML = `
            ${error ? `<div class="alert alert-danger py-2"><i class="bi bi-x-circle me-1"></i>${esc(error)}</div>` : ''}
            <div class="rcu-name">
                <label class="fw-semibold mb-1" for="rcuName"><i class="bi bi-folder-plus me-1" style="color:#6a1b9a"></i>ชื่อโครงการใหม่</label>
                <input id="rcuName" class="form-control ${nErr ? 'is-invalid' : ''}" style="max-width:360px" value="${esc(name)}" placeholder="เช่น nwt_edit_01" autocomplete="off">
                <div class="invalid-feedback" id="rcuNameErr">${esc(nErr || '')}</div>
                <div class="form-text">ใช้ a-z 0-9 _ (ภาษาอังกฤษตัวเล็ก) — สร้างเป็นโครงการใหม่แยกต่างหาก ไม่รวมกับโครงการเดิม</div>
            </div>
            <div class="rcu-pick">
                ${dropZone('boundary', 1, 'ขอบเขตแปลง', 'รูปแปลงโฉนด — ใช้สร้างแปลงในโครงการใหม่', COLS_BOUNDARY, true)}
                ${dropZone('classified', 2, 'แปลงที่คลาสแล้ว', 'ยางลงทะเบียน + พื้นที่กันออก', ['Classtype', 'Class_Area', ...COLS_BOUNDARY], false)}
            </div>
            <div class="rcu-hint">
                <div><i class="bi bi-link-45deg me-1"></i>คลาสจับคู่กับแปลงด้วย <b>Regis_No + No_Plot + Deed_ID</b> (ถ้าไม่ตรงจะดูว่าอยู่ในขอบเขตแปลงไหน)</div>
                <div><i class="bi bi-scissors me-1"></i>คลาสถูกตัดไม่ให้เกินขอบเขตแปลง ส่วนที่เหลือในขอบเขตจะเป็น “อื่นๆ” (ไม่นับเป็นยาง) ถ้าเป็นยางหรือกันออก ไปคลาสเพิ่มในหน้า Reclass ได้</div>
                <div><i class="bi bi-bullseye me-1"></i>เป้าหมาย = <b>Rubr_total</b> เทียบกับ ยางพาราลงทะเบียน + พื้นที่กันออก · Class_Area คำนวณจากรูปแปลงจริง</div>
            </div>`;
        document.getElementById('rcuFoot').innerHTML = `
            <button class="btn btn-light ms-auto" data-bs-dismiss="modal">ปิด</button>
            <button class="btn text-white px-4" id="rcuCheck" style="background:#6a1b9a"><i class="bi bi-search me-1"></i>ตรวจสอบ</button>`;
        updateCheckBtn();

        const input = document.getElementById('rcuName');
        input.addEventListener('input', () => {
            name = input.value.trim().toLowerCase();
            const err = nameError(name);
            input.classList.toggle('is-invalid', !!err);
            document.getElementById('rcuNameErr').textContent = err || '';
            updateCheckBtn();
        });
        document.querySelectorAll('#rcuBody .rcu-drop').forEach(drop => {
            const kind = drop.dataset.kind;
            const fileInput = drop.querySelector('input[type=file]');
            const set = (file) => { if (file) { picked[kind] = file; renderPick(); } };
            fileInput.addEventListener('change', () => set(fileInput.files[0]));
            ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
            ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
            drop.addEventListener('drop', e => set(e.dataTransfer.files[0]));
        });
        document.querySelectorAll('#rcuBody .rcu-clear').forEach(b => b.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            picked[b.dataset.kind] = null;
            renderPick();
        }));
        document.getElementById('rcuCheck').addEventListener('click', sendPreview);
    }

    async function sendPreview() {
        const names = [picked.boundary?.name, picked.classified?.name].filter(Boolean).map(esc).join(' + ');
        document.getElementById('rcuBody').innerHTML = `<div class="text-center py-5"><div class="spinner-border" style="color:#6a1b9a"></div><div class="mt-2 text-muted">กำลังอ่าน ${names} ...</div></div>`;
        document.getElementById('rcuFoot').innerHTML = '';
        try {
            const fd = new FormData();
            fd.append('newProject', '1');
            fd.append('boundary', picked.boundary);
            if (picked.classified) fd.append('classified', picked.classified);
            const r = await fetch(`/rub/api/reclass-upload/${nq()}/preview`, { method: 'POST', body: fd });
            const d = await r.json().catch(() => ({ error: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r.status})` }));
            if (!r.ok) throw new Error(d.error || r.statusText);
            preview = d;
            renderPreview();
        } catch (err) {
            renderPick(err.message === 'Failed to fetch' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (Failed to fetch) — ลองใหม่อีกครั้ง' : err.message);
        }
    }

    // ── Step 2: ตรวจสอบ ──────────────────────────────────────────────────────
    const chips = (list) => {
        if (!list || !list.length) return '<span class="text-muted small">ยังไม่มีคลาส (ทั้งแปลง = อื่นๆ)</span>';
        // ยาง + กันออกทุกประเภทของแปลงเดียวกันอยู่ในแถวเดียว
        const sum = {};
        list.forEach(x => { sum[x.c] = sum[x.c] || { n: 0, a: 0 }; sum[x.c].n++; sum[x.c].a += x.a; });
        return `<div class="rcu-chips">${Object.keys(sum).sort((a, b) => (a !== 'rubber') - (b !== 'rubber') || a.localeCompare(b)).map(c =>
            `<span class="rcu-chip" title="${esc(meta(c)[0])}">${sw(c)}${esc(meta(c)[1])}${sum[c].n > 1 ? ` ×${sum[c].n}` : ''}&nbsp;<b>${fmt(sum[c].a)}</b></span>`).join('')}</div>`;
    };

    function renderPreview() {
        setStep(2);
        const p = preview;
        const plots = p.plots;
        const withClass = plots.filter(x => x.new && x.new.length).length;
        const reached = plots.filter(x => onTarget(x.new_sum, x.target)).length;
        const unknown = Object.entries(p.unknownClasses || {});

        document.getElementById('rcuBody').innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2 small flex-wrap gap-1">
                <span>
                    <span class="me-3"><i class="bi bi-folder-plus me-1" style="color:#6a1b9a"></i>โครงการใหม่ <b>${esc(name)}</b></span>
                    <span class="text-muted me-3"><span class="badge bg-secondary">1</span> ${esc(p.files.boundary)}</span>
                    ${p.files.classified ? `<span class="text-muted"><span class="badge bg-secondary">2</span> ${esc(p.files.classified)}</span>` : ''}
                </span>
                <a href="#" id="rcuRepick"><i class="bi bi-arrow-left me-1"></i>แก้ชื่อ / เปลี่ยนไฟล์</a>
            </div>
            <div class="rcu-stats">
                <div class="rcu-stat new"><b>${plots.length}</b><small>แปลงที่จะสร้าง</small></div>
                <div class="rcu-stat cls"><b>${withClass}</b><small>แปลงที่มีคลาส (${p.counts.classified} polygon)</small></div>
                <div class="rcu-stat ok"><b>${reached}/${plots.length}</b><small>ตรงเป้า ±600 ตร.ม. (ยาง+กันออก)</small></div>
                <div class="rcu-stat skip"><b>${p.unmatched.length}</b><small>polygon ที่ข้าม</small></div>
            </div>
            ${(p.warnings || []).map(w => `<div class="alert alert-info py-2 small mb-2"><i class="bi bi-info-circle me-1"></i>${esc(w)}</div>`).join('')}
            ${p.missingColumns.length ? `<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-exclamation-triangle me-1"></i>ไฟล์แปลงที่คลาสแล้ว ไม่พบคอลัมน์: ${p.missingColumns.map(esc).join(', ')}</div>` : ''}
            ${unknown.length ? `<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-question-circle me-1"></i>Classtype ที่ไม่รู้จัก: ${unknown.map(([k, n]) => `<b>${esc(k)}</b> (${n})`).join(', ')} — จะเป็น “อื่นๆ” ไปเลือกประเภทในหน้า Reclass ได้</div>` : ''}
            ${p.unmatched.length ? `<details class="small mb-2"><summary class="text-danger">ดู polygon ที่ข้าม (${p.unmatched.length})</summary>
                <ul class="mb-0">${p.unmatched.slice(0, 200).map(u => `<li>${esc(u.file)} แถว ${u.row} · ${esc(u.regis_no || '-')} แปลง ${esc(u.no_plot ?? '-')}${u.classtype ? ` · ${esc(u.classtype)}` : ''} — ${esc(u.reason)}</li>`).join('')}</ul></details>` : ''}
            ${legendHtml()}
            ${p.files.classified ? `<div class="form-check small mb-2">
                <input class="form-check-input" type="checkbox" id="rcuCut" ${p.cut === false ? '' : 'checked'}>
                <label class="form-check-label" for="rcuCut">ตัดพื้นที่กันออกออกจากยางพาราของแปลงเดียวกันอัตโนมัติ (กรณีวาดทับไว้)</label>
            </div>` : ''}
            <div class="rcu-table-wrap">
                <table class="table table-sm table-hover rcu-table">
                    <thead><tr>
                        <th><input type="checkbox" class="form-check-input" id="rcuAll" checked></th>
                        <th>#</th><th>เลขทะเบียน / แปลง</th><th>ชื่อ</th>
                        <th class="text-end">ขอบเขตแปลง (ไร่)</th>
                        <th>คลาส (ไร่)</th>
                        <th>ยาง+กันออก / เป้าหมาย<br><small class="text-muted fw-normal">Rubr_total</small></th>
                    </tr></thead>
                    <tbody>${plots.map((x, i) => `
                        <tr>
                            <td><input type="checkbox" class="form-check-input rcu-row" value="${x.id}" checked></td>
                            <td class="text-muted">${i + 1}</td>
                            <td class="text-nowrap">${esc(x.regis_no || '-')} <small class="text-muted">/ ${esc(x.no_plot ?? '-')}</small><div class="text-muted" style="font-size:.68rem">โฉนด ${esc(x.deed_id || '-')}</div></td>
                            <td>${esc(x.full_nam || '-')}</td>
                            <td class="text-end">${fmt(x.boundary?.new_rai)}</td>
                            <td>${chips(x.new)}${x.cut_rai > 0.005 ? `<div class="text-muted" style="font-size:.68rem"><i class="bi bi-scissors"></i> ตัดส่วนเกินขอบเขต ${fmt(x.cut_rai)}</div>` : ''}</td>
                            <td>${targetCell(x.new_sum, x.target)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;

        document.getElementById('rcuRepick').addEventListener('click', (e) => { e.preventDefault(); renderPick(); });
        document.getElementById('rcuCut')?.addEventListener('change', (e) => { preview.cut = e.target.checked; });
        const all = document.getElementById('rcuAll');
        all.addEventListener('change', () => { document.querySelectorAll('.rcu-row').forEach(c => c.checked = all.checked); updateFoot(); });
        document.querySelectorAll('.rcu-row').forEach(c => c.addEventListener('change', updateFoot));
        updateFoot();
    }

    const pickedIds = () => [...document.querySelectorAll('.rcu-row:checked')].map(c => Number(c.value));

    function updateFoot() {
        const n = pickedIds().length;
        document.getElementById('rcuFoot').innerHTML = `
            <button class="btn btn-light ms-auto" data-bs-dismiss="modal">ยกเลิก</button>
            <button class="btn text-white px-4" id="rcuCommit" style="background:#6a1b9a" ${n ? '' : 'disabled'}>
                <i class="bi bi-folder-plus me-1"></i>สร้างโครงการ “${esc(name)}” (${n} แปลง)</button>`;
        document.getElementById('rcuCommit').addEventListener('click', commit);
    }

    // ── Step 3: สร้างโครงการ + ผลลัพธ์ ────────────────────────────────────────
    async function commit() {
        const ids = pickedIds();
        const btn = document.getElementById('rcuCommit');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังสร้างโครงการ...';
        try {
            const r = await fetch(`/rub/api/reclass-upload/${nq()}/commit`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: preview.token, ids, cut: preview.cut !== false }),
            });
            const d = await r.json().catch(() => ({ error: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${r.status})` }));
            if (!r.ok) throw new Error(d.error || r.statusText);
            created = true;
            setStep(3);
            picked.boundary = picked.classified = null;
            const res = d.results || [];
            const unclassifiedPlots = res.filter(x => x.unclassified > 0.005).length;
            document.getElementById('rcuBody').innerHTML = `
                <div class="rcu-done">
                    <i class="bi bi-check-circle-fill big"></i>
                    <h5 class="mt-2">สร้างโครงการ “${esc(d.projectName)}” แล้ว — ${d.newPlots} แปลง</h5>
                    <div class="small">
                        ${d.polygons ? `<div><i class="bi bi-palette me-1"></i>นำเข้าคลาส ${d.polygons} polygon (ตัดตามขอบเขตแปลงแล้ว)</div>` : ''}
                        ${d.cutRubber ? `<div><i class="bi bi-scissors me-1"></i>ตัดพื้นที่กันออกออกจากยางพารา ${d.cutRubber} polygon</div>` : ''}
                        ${unclassifiedPlots ? `<div><i class="bi bi-plus-square-dotted me-1"></i>${unclassifiedPlots} แปลงมีพื้นที่ “อื่นๆ” (ไม่นับเป็นยาง) — ถ้าเป็นยางหรือกันออก ไปคลาสเพิ่มได้ในหน้า Reclass</div>` : ''}
                        <div class="mt-1"><i class="bi bi-bullseye me-1"></i>ยาง+กันออก ตรงเป้าหมาย (±600 ตร.ม.) ${d.target.reached}/${d.target.total} แปลง</div>
                    </div>
                </div>
                <div class="fw-semibold small mb-1"><i class="bi bi-table me-1"></i>ผลลัพธ์รายแปลง (ไร่)</div>
                <div class="rcu-table-wrap">
                    <table class="table table-sm table-hover rcu-table">
                        <thead><tr>
                            <th>ID</th><th>เลขทะเบียน / แปลง</th><th>ชื่อ</th><th class="text-end">ขอบเขตแปลง</th>
                            <th class="text-end">${sw('rubber')}ยางลงทะเบียน</th><th class="text-end">${sw('ex_other')}พื้นที่กันออก</th>
                            <th class="text-end">${sw(null)}อื่นๆ</th><th>ยาง+กันออก / เป้าหมาย</th><th></th>
                        </tr></thead>
                        <tbody>${res.map(x => `
                            <tr>
                                <td>${x.id}</td>
                                <td class="text-nowrap">${esc(x.regis_no || '-')} <small class="text-muted">/ ${esc(x.no_plot ?? '-')}</small></td>
                                <td>${esc(x.full_nam || '-')}</td>
                                <td class="text-end">${fmt(x.deed_rai)}</td>
                                <td class="text-end">${fmt(x.rubber)}</td>
                                <td class="text-end">${fmt(x.ex)}</td>
                                <td class="text-end ${x.unclassified > 0.005 ? 'text-warning fw-semibold' : 'text-muted'}">${fmt(x.unclassified)}</td>
                                <td>${targetCell(x.rubber + x.ex, x.target)}</td>
                                <td><a class="btn btn-sm btn-outline-secondary py-0" target="_blank" title="เปิดแก้คลาสในหน้า Reclass"
                                       href="/rub/reclass/index.html?tb=${encodeURIComponent(d.tb)}&id=${x.id}&Rubr_Sqm=${encodeURIComponent(x.rubr_sqm || 0)}"><i class="bi bi-pencil-square"></i></a></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="small text-muted mt-1">กด <i class="bi bi-pencil-square"></i> เพื่อแก้/เพิ่มคลาสของแปลงนั้นในหน้า Reclass · โครงการใหม่จะขึ้นในรายการหน้าแรกเมื่อปิดหน้าต่างนี้</div>`;
            document.getElementById('rcuFoot').innerHTML = `
                <button class="btn btn-light me-auto" data-bs-dismiss="modal">ปิด</button>
                <a class="btn text-white" style="background:#6a1b9a" href="/rub/reclassdash/index.html?tb=${encodeURIComponent(d.tb)}">
                    <i class="bi bi-bar-chart-line me-1"></i>เปิด Dashboard Reclass ของ “${esc(d.projectName)}”</a>`;
        } catch (err) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-folder-plus me-1"></i>ลองอีกครั้ง';
            alert(err.message);
        }
    }

    window.openReclassUpload = async function () {
        ensureDom();
        try {
            const { user } = await (await fetch('/rub/auth/me')).json();
            if (!user) { alert('กรุณา Login ก่อนครับ'); return; }
        } catch (_) { /* ให้ backend ตรวจซ้ำตอนบันทึก */ }
        created = false;
        if (!name) name = suggestName();
        renderPick();
        modal.show();
    };

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.reclassup-btn')) return;
        e.preventDefault();
        window.openReclassUpload();
    });
})();
