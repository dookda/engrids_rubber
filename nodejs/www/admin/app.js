/* ================================================================
   Admin App  –  Two-step project workflow
   1) "สร้าง Project" → create empty table (no upload)
   2) "เพิ่มข้อมูล"   → upload shapefile (polygon / point) to existing table
   3) "มอบหมายงาน"  → assign ID ranges to team members
================================================================ */

const ROLE_LABELS = { admin: 'Admin', worker: 'Worker' };
const ROLE_COLORS = { admin: 'danger', worker: 'success' };

/* ── Initialise logged-in users list with role management ── */
const initUser = async () => {
    try {
        const response = await fetch(`/rub/api/users`);
        const result = await response.json();

        const usersDiv = document.getElementById('usersList');
        usersDiv.innerHTML = '';

        result.forEach(item => {
            const panel = document.createElement('div');
            panel.className = 'alert alert-success d-flex align-items-center justify-content-between mb-2 py-2';

            const leftDiv = document.createElement('div');
            leftDiv.className = 'd-flex align-items-center gap-2';

            const img = document.createElement('img');
            img.className = 'rounded-circle';
            img.style = 'width: 32px; height: 32px; object-fit: cover; flex-shrink: 0;';
            img.referrerPolicy = "no-referrer";
            img.src = item.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
            img.onerror = function() {
                this.onerror = null;
                this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
            };

            const infoDiv = document.createElement('div');
            infoDiv.innerHTML = `
                <div class="fw-bold" style="font-size:0.85rem;">${item.display_name}</div>
                <div class="text-muted" style="font-size:0.72rem;">${item.email || ''}</div>
            `;

            leftDiv.appendChild(img);
            leftDiv.appendChild(infoDiv);

            const roleSelect = document.createElement('select');
            roleSelect.className = `form-select form-select-sm role-select`;
            roleSelect.style = 'width: auto; font-size: 0.75rem;';
            roleSelect.dataset.userId = item.id;
            ['worker', 'admin'].forEach(r => {
                const opt = document.createElement('option');
                opt.value = r;
                opt.textContent = ROLE_LABELS[r];
                if (item.role === r) opt.selected = true;
                roleSelect.appendChild(opt);
            });
            roleSelect.addEventListener('change', async function() {
                const newRole = this.value;
                try {
                    const res = await fetch(`/rub/api/users/${item.id}/role`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role: newRole })
                    });
                    const data = await res.json();
                    if (!data.success) { alert('เปลี่ยน role ไม่สำเร็จ'); this.value = item.role; }
                    else item.role = newRole;
                } catch (e) { alert('เกิดข้อผิดพลาด'); this.value = item.role; }
            });

            panel.appendChild(leftDiv);
            panel.appendChild(roleSelect);
            usersDiv.appendChild(panel);
        });
    } catch (error) {
        console.error('Error initializing users:', error);
    }
};

/* ── Highcharts bar for feature counts ── */
const showChart = async (tb, div) => {
    try {
        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'Classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('chart_' + div, {
            chart: { type: 'bar', height: 150, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { type: 'category' },
            yAxis: { min: 0, title: { text: 'จำนวน (แปลง)', style: { fontFamily: 'Noto Sans Thai' } } },
            series: [{ name: 'Counts', data: chartData, dataLabels: { enabled: true, format: '{y}' } }],
            tooltip: { pointFormat: '<b>{point.y}</b> แปลง' },
            credits: { enabled: false },
            legend: { enabled: false }
        });
    } catch (error) {
        console.error('Error showing chart:', error);
    }
};

const existingLayerNames = new Set();

/* ── Render the layer list ── */
const initApp = async () => {
    try {
        const response = await fetch('/rub/api/layerlist');
        const result = await response.json();
        existingLayerNames.clear();
        result.forEach(item => existingLayerNames.add(item.tb_name.toLowerCase()));

        const layerList = document.getElementById('layerList');
        layerList.innerHTML = '';

        const promises = result.map(async (item, index) => {
            const { tb_name } = item;
            const wrapper = document.createElement('div');
            wrapper.innerHTML = `
                <div class="alert alert-dismissible alert-info mb-3">
                    <strong id="layerTitle_${tb_name.toLowerCase()}" style="font-size: 1.1rem;">${index + 1}. Layer: ${tb_name}</strong>
                    <button class="btn btn-link btn-sm p-0 ms-2 renameBtn" data-tb="${tb_name}" title="แก้ไขชื่อโปรเจค" style="color:#555;">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <div class="layer-actions mt-2">
                        <button class="btn btn-add-data layer-btn addDataBtn" data-tb="${tb_name}">
                            <i class="bi bi-upload me-1"></i>เพิ่มข้อมูล
                        </button>
                        <button class="btn btn-secondary layer-btn reshape" data-tb="${tb_name}">
                            ปรับรูปแปลง
                        </button>
                        <button class="btn btn-secondary layer-btn dashboard" data-tb="${tb_name}">
                            Dashboard
                        </button>
                        <button class="btn btn-assign layer-btn assignBtn" data-tb="${tb_name}" title="มอบหมายงาน">
                            <i class="bi bi-people-fill me-1"></i>มอบหมายงาน
                        </button>
                        <div class="dropdown d-inline-block mt-1">
                            <button class="btn btn-success dropdown-toggle layer-btn" type="button" id="dropdownMenuButton${tb_name}" data-bs-toggle="dropdown" aria-expanded="false">
                                <i class="bi bi-download me-1"></i>Download ข้อมูล
                            </button>
                            <ul class="dropdown-menu premium-dropdown-menu" aria-labelledby="dropdownMenuButton${tb_name}">
                                <li>
                                    <a class="dropdown-item download_all" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #e91e63 !important; background: #fce4ec !important;"><i class="bi bi-download"></i></div>
                                        <span class="fw-bold">Download ทั้งหมด</span>
                                    </a>
                                </li>
                                <li><hr class="dropdown-divider"></li>
                                <li>
                                    <a class="dropdown-item reshape_download" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper"><i class="bi bi-file-earmark-text"></i></div>
                                        <span>Download แปลงโฉนดของยางพารา</span>
                                    </a>
                                </li>
                                <li>
                                    <a class="dropdown-item classify_download" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper"><i class="bi bi-file-earmark-check"></i></div>
                                        <span>Download reclassify (LU)</span>
                                    </a>
                                </li>
                                <li><hr class="dropdown-divider"></li>
                                <li>
                                    <a class="dropdown-item classify_download_rubber" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #0288d1 !important; background: #e1f5fe !important;"><i class="bi bi-cloud-arrow-down"></i></div>
                                        <span>Download Reclassify (ยางลงทะเบียน)</span>
                                    </a>
                                </li>
                                <li>
                                    <a class="dropdown-item classify_download_all_rubber" href="javascript:void(0);" data-tb="${tb_name}">
                                        <div class="icon-wrapper" style="color: #6a1b9a !important; background: #f3e5f5 !important;"><i class="bi bi-cloud-download"></i></div>
                                        <span>Download Reclassify (ยางลงทะเบียน+พื้นที่กันออกทั้งหมด)</span>
                                    </a>
                                </li>
                            </ul>
                        </div>
                        <button class="btn btn-payment layer-btn payBtn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้าง">
                            <i class="bi bi-calculator-fill me-1"></i>คำนวณค่าจ้าง
                        </button>
                        <button class="btn btn-payment-v2 layer-btn payV2Btn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้าง V2 (จาก class_Area)">
                            <i class="bi bi-calculator-fill me-1"></i>คำนวณค่าจ้าง V2
                        </button>
                        <button class="btn btn-payment-v3 layer-btn payV3Btn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้าง V3 (ยางลงทะเบียน+พื้นที่กันออกทั้งหมด)">
                            <i class="bi bi-calculator-fill me-1"></i>คำนวณค่าจ้าง V3
                        </button>
                        <button class="btn btn-checker-pay layer-btn checkerPayBtn mt-1" data-tb="${tb_name}" title="คำนวณค่าจ้างคนตรวจ">
                            <i class="bi bi-shield-check me-1"></i>ค่าคนตรวจ
                        </button>
                        <button class="btn btn-danger layer-btn deleteBtn mt-1" data-tb="${tb_name}" title="ลบ layer">
                            <i class="bi bi-trash3-fill"></i>
                        </button>
                    </div>
                    <!-- Mini assignment strip -->
                    <div class="assignment-strip mt-2" id="strip_${tb_name}"></div>
                    <div class="mt-2 border" id="chart_${tb_name}"></div>
                </div>`;
            layerList.appendChild(wrapper);
            await showChart(tb_name, tb_name);
            await loadAssignmentStrip(tb_name);
        });

        await Promise.all(promises);

        /* ── rename display name ── */
        document.querySelectorAll('.renameBtn').forEach(btn => {
            btn.addEventListener('click', async function () {
                const currentName = this.getAttribute('data-tb');
                const newName = prompt(`แก้ไขชื่อโปรเจค "${currentName}"\n(พิมพ์ตัวพิมพ์ใหญ่/เล็กได้ตามต้องการ เช่น PLK หรือ Plk)`, currentName);
                if (!newName || newName === currentName) return;
                if (newName.toLowerCase() !== currentName.toLowerCase()) {
                    alert('ไม่สามารถเปลี่ยนชื่อตัวอักษรได้ เปลี่ยนได้เฉพาะตัวพิมพ์ใหญ่/เล็กเท่านั้น');
                    return;
                }
                try {
                    const res = await fetch(`/rub/api/layerlist/${currentName}/displayname`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ display_name: newName })
                    });
                    const data = await res.json();
                    if (data.success) {
                        const titleEl = document.getElementById(`layerTitle_${currentName.toLowerCase()}`);
                        if (titleEl) titleEl.textContent = titleEl.textContent.replace(currentName, newName);
                        this.setAttribute('data-tb', newName);
                        alert(`เปลี่ยนชื่อเป็น "${newName}" สำเร็จ`);
                        await initApp();
                    } else {
                        alert('เกิดข้อผิดพลาด: ' + (data.error || 'unknown'));
                    }
                } catch (err) {
                    alert('เกิดข้อผิดพลาด: ' + err.message);
                }
            });
        });

        /* ── เพิ่มข้อมูล per-row button ── */
        document.querySelectorAll('.addDataBtn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tb = this.getAttribute('data-tb');
                openAddDataModal(tb);
            });
        });

        /* ── มอบหมายงาน per-row button ── */
        document.querySelectorAll('.assignBtn').forEach(btn => {
            btn.addEventListener('click', function () {
                const tb = this.getAttribute('data-tb');
                openAssignModal(tb);
            });
        });

        /* ── ปรับรูปแปลง ── */
        document.querySelectorAll('.reshape').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (document.getElementById('chkLogin').value === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');
                window.location.href = `./../reshape/index.html?tb=${tb}`;
            });
        });

        /* ── Dashboard ── */
        document.querySelectorAll('.dashboard').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                window.location.href = `./../reclassdash/index.html?tb=${tb}`;
            });
        });

        /* ── Download ทั้งหมด ── */
        document.querySelectorAll('.download_all').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        });

        /* ── Download แปลงยาง ── */
        document.querySelectorAll('.reshape_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/${tb}`, `pacel_yang_${tb}.geojson`);
            });
        });

        /* ── Download reclassify ── */
        document.querySelectorAll('.classify_download').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}`, `v_reclass_LU_${tb}.geojson`);
            });
        });

        /* ── Download reclassify (ลงทะเบียน) ── */
        document.querySelectorAll('.classify_download_rubber').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber`, `v_reclass_rubber_${tb}.geojson`);
            });
        });

        /* ── Download reclassify (ลงทะเบียน+พื้นที่กันออกทั้งหมด) ── */
        document.querySelectorAll('.classify_download_all_rubber').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                downloadFile(`/rub/api/download/reshape/v_reclass_${tb}?type=rubber_and_ex`, `v_reclass_rubber_ex_${tb}.geojson`);
            });
        });

        /* ── คำนวณค่าจ้าง ── */
        document.querySelectorAll('.payBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openPaymentModal(tb);
            });
        });

        /* ── คำนวณค่าจ้าง V2 (class_Area) ── */
        document.querySelectorAll('.payV2Btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openPaymentModalV2(tb);
            });
        });

        /* ── คำนวณค่าจ้าง V3 (ยางลงทะเบียน+พื้นที่กันออกทั้งหมด) ── */
        document.querySelectorAll('.payV3Btn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openPaymentModalV3(tb);
            });
        });

        /* ── คำนวณค่าคนตรวจ ── */
        document.querySelectorAll('.checkerPayBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const tb = this.getAttribute('data-tb');
                openCheckerPaymentModal(tb);
            });
        });

        /* ── ลบ layer ── */
        document.querySelectorAll('.deleteBtn').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (document.getElementById('chkLogin').value === 'false') {
                    alert('กรุณา Login ก่อนครับ');
                    return;
                }
                const tb = this.getAttribute('data-tb');
                if (!confirm(`ยืนยันลบ "${tb}" ใช่หรือไม่?`)) return;

                fetch(`/rub/api/layerlist/${tb}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                })
                    .then(res => res.json())
                    .then(result => {
                        if (result.success) {
                            alert(`ลบ ${tb} เรียบร้อย`);
                            initApp();
                        } else {
                            alert('เกิดข้อผิดพลาด');
                        }
                    })
                    .catch(err => console.error('Delete failed:', err));
            });
        });

    } catch (error) {
        console.error('Error initializing app:', error);
    }
};

/* ── Helper: trigger file download ── */
const downloadFile = (url, filename) => {
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(res.statusText);
            return res.blob();
        })
        .then(blob => {
            const link = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = link;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(link);
        })
        .catch(err => console.error('Download failed:', err));
};

/* ═════════════════════════════════════════════════════════════
   MODAL 1 – สร้าง Project (create empty table, no upload)
═════════════════════════════════════════════════════════════ */

let createProjectModal = null;

document.getElementById('createProjectBtn').addEventListener('click', () => {
    if (!createProjectModal) {
        createProjectModal = new bootstrap.Modal(document.getElementById('createProjectModal'));
    }
    // reset form
    const cpProv = document.getElementById('cp_province');
    const cpPers = document.getElementById('cp_person');
    const cpRem = document.getElementById('cp_remark');
    if (cpProv) { cpProv.value = ''; cpProv.classList.remove('is-invalid'); }
    if (cpPers) cpPers.value = '';
    if (cpRem) cpRem.value = '';
    document.getElementById('tableNamePreview').style.display = 'none';
    const errEl = document.getElementById('cp_name_error');
    if (errEl) errEl.style.display = 'none';
    createProjectModal.show();
});

/* Live preview of table name */
['cp_province', 'cp_person'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', updateTableNamePreview);
    }
});

function updateTableNamePreview() {
    const provEl = document.getElementById('cp_province');
    const persEl = document.getElementById('cp_person');

    const province = provEl ? provEl.value.trim().replace(/\s+/g, '_') : '';
    const person = persEl ? persEl.value.trim().replace(/\s+/g, '_') : '';
    const preview = document.getElementById('tableNamePreview');
    const nameEl = document.getElementById('previewTableName');
    const errorEl = document.getElementById('cp_name_error');

    if (province) {
        const tb_name = person ? `${province}_${person}` : `${province}`;
        nameEl.textContent = tb_name;
        preview.style.display = 'block';

        if (errorEl) {
            if (existingLayerNames.has(tb_name.toLowerCase())) {
                errorEl.textContent = `ชื่อ "${tb_name.toUpperCase()}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น`;
                errorEl.style.display = 'block';
                document.getElementById('cp_province').classList.add('is-invalid');
            } else {
                errorEl.style.display = 'none';
                document.getElementById('cp_province').classList.remove('is-invalid');
            }
        }
    } else {
        preview.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
        document.getElementById('cp_province').classList.remove('is-invalid');
    }
}

document.getElementById('btnCreateProject').addEventListener('click', async () => {
    const provEl = document.getElementById('cp_province');
    const persEl = document.getElementById('cp_person');
    const remEl = document.getElementById('cp_remark');

    const province = provEl ? provEl.value.trim().replace(/\s+/g, '_') : '';
    const person = persEl ? persEl.value.trim().replace(/\s+/g, '_') : '';
    const remark = remEl ? remEl.value.trim() : '';

    const errorEl = document.getElementById('cp_name_error');
    const cpInput = document.getElementById('cp_province');

    if (!province) {
        if (errorEl) { errorEl.textContent = 'กรุณากรอกชื่อ table'; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
        return;
    }

    const tb_name = person ? `${province}_${person}` : `${province}`;

    if (existingLayerNames.has(tb_name.toLowerCase())) {
        if (errorEl) { errorEl.textContent = `ชื่อ "${tb_name.toUpperCase()}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น`; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
        return;
    }

    const btn = document.getElementById('btnCreateProject');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังสร้าง...';

    try {
        const res = await fetch('/rub/api/create-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tb_name, remark })
        });
        const data = await res.json();

        if (data.success) {
            createProjectModal.hide();
            initApp();
        } else {
            if (errorEl) { errorEl.textContent = data.error || 'เกิดข้อผิดพลาด'; errorEl.style.display = 'block'; }
            cpInput.classList.add('is-invalid');
        }
    } catch (err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        cpInput.classList.add('is-invalid');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>สร้าง Project';
    }
});

/* ═════════════════════════════════════════════════════════════
   MODAL 2 – เพิ่มข้อมูล (upload shapefile to existing table)
═════════════════════════════════════════════════════════════ */

let addDataModal = null;
let selectedZipFiles = [];

function openAddDataModal(tb_name) {
    if (!addDataModal) {
        addDataModal = new bootstrap.Modal(document.getElementById('addDataModal'));
    }
    // reset
    document.getElementById('ad_tb_name').value = tb_name;
    document.getElementById('ad_geom_type').value = '';
    document.getElementById('ad_shpFile').value = '';
    document.getElementById('fileNameDisplay').style.display = 'none';
    document.getElementById('fileNameDisplay').textContent = '';
    document.getElementById('fileNameDisplay').innerHTML = '';
    document.getElementById('ad_uploadProgress').style.display = 'none';
    document.getElementById('ad_progressBar').style.width = '0%';
    selectedZipFiles = [];
    // clear geom type selection
    document.querySelectorAll('.geom-type-card').forEach(c => c.classList.remove('selected'));

    addDataModal.show();
}

/* Geometry type card selection */
document.querySelectorAll('.geom-type-card').forEach(card => {
    card.addEventListener('click', function () {
        document.querySelectorAll('.geom-type-card').forEach(c => c.classList.remove('selected'));
        this.classList.add('selected');
        document.getElementById('ad_geom_type').value = this.getAttribute('data-value');
    });
});

/* Upload zone – drag & drop */
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('ad_shpFile');

uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        setSelectedFiles(e.dataTransfer.files);
    }
});

fileInput.addEventListener('change', function () {
    if (this.files.length > 0) {
        setSelectedFiles(this.files);
    }
});

function setSelectedFiles(files) {
    for (let i = 0; i < files.length; i++) {
        selectedZipFiles.push(files[i]);
    }
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const display = document.getElementById('fileNameDisplay');
    if (selectedZipFiles.length === 0) {
        display.style.display = 'none';
        display.innerHTML = '';
        fileInput.value = '';
        return;
    }

    display.style.display = 'flex';
    display.innerHTML = '';

    selectedZipFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'd-flex justify-content-between align-items-center w-100 p-2 border rounded border-secondary bg-white shadow-sm';
        item.innerHTML = `
            <span><i class="bi bi-file-earmark-zip me-1 text-primary"></i>${file.name}</span>
            <i class="bi bi-x-circle-fill text-danger btn-remove-file ms-3" style="cursor:pointer;" title="ลบไฟล์" data-index="${index}"></i>
        `;
        display.appendChild(item);
    });

    display.querySelectorAll('.btn-remove-file').forEach(btn => {
        btn.addEventListener('click', function () {
            const idx = parseInt(this.getAttribute('data-index'));
            selectedZipFiles.splice(idx, 1);
            renderSelectedFiles();
        });
    });
}

/* Upload button */
document.getElementById('btnAddData').addEventListener('click', async () => {
    const tb_name = document.getElementById('ad_tb_name').value.trim();
    const geom_type = document.getElementById('ad_geom_type').value;

    if (!geom_type) { alert('กรุณาเลือกประเภทข้อมูล (Polygon / Point)'); return; }
    if (selectedZipFiles.length === 0) { alert('กรุณาเลือกไฟล์ ZIP อย่างน้อย 1 ไฟล์'); return; }

    document.getElementById('ad_uploadProgress').style.display = 'block';

    const btn = document.getElementById('btnAddData');
    btn.disabled = true;

    let totalRecords = 0;
    let hasError = false;

    for (let i = 0; i < selectedZipFiles.length; i++) {
        const file = selectedZipFiles[i];
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>กำลังอัปโหลดไฟล์ ${i + 1} / ${selectedZipFiles.length}...`;

        document.getElementById('ad_progressBar').style.width = '0%';
        document.getElementById('ad_progressText').textContent = `กำลังอัปโหลด ${file.name} (ไฟล์ ${i + 1}/${selectedZipFiles.length})...`;

        const success = await new Promise((resolve) => {
            const formData = new FormData();
            formData.append('shpFile', file);
            formData.append('tb_name', tb_name);
            formData.append('geom_type', geom_type);

            const xhr = new XMLHttpRequest();
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    document.getElementById('ad_progressBar').style.width = pct + '%';
                    document.getElementById('ad_progressText').textContent = `อัปโหลด ${file.name} ${pct}%`;
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && result.success) {
                        totalRecords += result.recordCount || 0;
                        resolve(true);
                    } else {
                        alert(`เกิดข้อผิดพลาดกับไฟล์ ${file.name}: ${result.error || 'Unknown error'}`);
                        resolve(false);
                    }
                } catch (parseErr) {
                    alert(`เกิดข้อผิดพลาดในการประมวลผลไฟล์ ${file.name}`);
                    resolve(false);
                }
            });

            xhr.addEventListener('error', () => {
                alert(`เกิดข้อผิดพลาดในการส่งข้อมูลไฟล์ ${file.name} (Network Error)`);
                resolve(false);
            });

            xhr.open('POST', '/rub/api/upload-shapefile-to-table', true);
            xhr.send(formData);
        });

        if (!success) {
            hasError = true;
            break;
        }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-upload me-1"></i>อัปโหลดข้อมูล';

    if (!hasError) {
        document.getElementById('ad_progressBar').style.width = '100%';
        document.getElementById('ad_progressText').textContent = 'อัปโหลดเสร็จแล้ว!';
        setTimeout(() => {
            document.getElementById('ad_uploadProgress').style.display = 'none';
            alert(`อัปโหลดสำเร็จ! ทั้งหมด ${totalRecords} records (${geom_type})`);
            addDataModal.hide();
            initApp();
        }, 600);
    } else {
        document.getElementById('ad_uploadProgress').style.display = 'none';
    }
});


/* ═════════════════════════════════════════════════════════════
   MODAL 3 – มอบหมายงาน (Task Assignment)
═════════════════════════════════════════════════════════════ */

let assignModal = null;
let currentAssignTb = null;
let allUsers = [];

/* ── โหลด users ไว้ใน cache ── */
async function loadUsersCache() {
    try {
        const res = await fetch('/rub/api/users');
        allUsers = await res.json();
    } catch (e) {
        allUsers = [];
    }
}

/* ── เปิด Modal ── */
async function openAssignModal(tb_name) {
    currentAssignTb = tb_name;
    if (!assignModal) {
        assignModal = new bootstrap.Modal(document.getElementById('assignModal'));
    }

    // set badge
    document.getElementById('assignModalTbBadge').textContent = tb_name;
    document.getElementById('assign_tb_name').value = tb_name;

    // reset form
    resetAssignForm();

    // render user picker
    renderAssigneePicker(null);

    // load existing assignments
    await renderAssignmentList(tb_name);

    assignModal.show();
}

/* ── Render assignee picker จาก users table (ใช้ email เป็นตัวระบุ) ── */
function renderAssigneePicker(selectedEmail) {
    const picker = document.getElementById('assigneePicker');
    picker.innerHTML = '';

    if (allUsers.length === 0) {
        picker.innerHTML = '<small class="text-muted">ยังไม่มีผู้ใช้ login เข้าระบบ</small>';
        return;
    }

    allUsers.forEach(u => {
        const chip = document.createElement('div');
        chip.className = 'assignee-chip';
        if (selectedEmail && u.email === selectedEmail) chip.classList.add('selected');
        chip.dataset.email = u.email || '';
        chip.dataset.userId = u.id;
        const avatarSrc = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name)}&background=E9F5EC&color=2e7d32&rounded=true`;
        chip.innerHTML = `
            <img src="${avatarSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name)}&background=E9F5EC&color=2e7d32&rounded=true'">
            <div style="line-height:1.2; text-align:center;">
                <div style="font-size:0.78rem; font-weight:600;">${u.display_name}</div>
                <div style="font-size:0.65rem; color:#6a8c6a;">${u.email || ''}</div>
            </div>
        `;
        chip.addEventListener('click', () => {
            document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            document.getElementById('assign_name').value = u.display_name;
            document.getElementById('assign_email').value = u.email || '';
            document.getElementById('assign_user_id').value = u.id;
            document.getElementById('assign_photo').value = u.photo || '';
        });
        picker.appendChild(chip);
    });
}

/* ── Reset form ── */
function resetAssignForm() {
    document.getElementById('assign_id').value = '';
    document.getElementById('assign_name').value = '';
    document.getElementById('assign_email').value = '';
    document.getElementById('assign_user_id').value = '';
    document.getElementById('assign_photo').value = '';
    document.getElementById('assign_id_from').value = '';
    document.getElementById('assign_id_to').value = '';
    document.getElementById('assign_note').value = '';
    document.getElementById('assign_email_input').value = '';
    document.getElementById('emailLookupResult').innerHTML = '';
    document.getElementById('assignFormTitle').innerHTML = '<i class="bi bi-plus-circle me-1"></i>เพิ่มการมอบหมายงานใหม่';
    document.getElementById('btnCancelAssignEdit').style.display = 'none';
    document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
}

/* ── ฟังก์ชัน: เลือก assignee จาก email (ทั้ง lookup และ manual) ── */
function selectAssigneeByEmail(email) {
    const resultEl = document.getElementById('emailLookupResult');
    if (!email) { resultEl.innerHTML = ''; return; }

    // ค้นหาใน allUsers ก่อน
    const found = allUsers.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    if (found) {
        // มีใน DB → เลือก chip + fill hidden fields
        document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
        const chip = document.querySelector(`.assignee-chip[data-email="${found.email}"]`);
        if (chip) chip.classList.add('selected');

        document.getElementById('assign_name').value = found.display_name;
        document.getElementById('assign_email').value = found.email;
        document.getElementById('assign_user_id').value = found.id;
        document.getElementById('assign_photo').value = found.photo || '';

        resultEl.innerHTML = `
            <span class="text-success">
                <i class="bi bi-check-circle-fill me-1"></i>พบในระบบ: <strong>${found.display_name}</strong>
            </span>`;
    } else {
        // ยังไม่เคย Login → ใช้อีเมลเป็นชื่อ (จะ link ตอน Login ครั้งแรก)
        document.querySelectorAll('.assignee-chip').forEach(c => c.classList.remove('selected'));
        const namePart = email.split('@')[0];
        document.getElementById('assign_name').value = namePart;
        document.getElementById('assign_email').value = email;
        document.getElementById('assign_user_id').value = '';
        document.getElementById('assign_photo').value = '';

        resultEl.innerHTML = `
            <span class="text-warning">
                <i class="bi bi-exclamation-circle-fill me-1"></i>ยังไม่เคย Login — จะใช้ชื่อ <strong>${namePart}</strong> และ link อัตโนมัติเมื่อ Login ครั้งแรก
            </span>`;
    }
}

/* ── Event: กดปุ่ม Lookup ── */
document.getElementById('btnLookupEmail').addEventListener('click', () => {
    const email = document.getElementById('assign_email_input').value.trim();
    if (!email) { document.getElementById('emailLookupResult').innerHTML = '<span class="text-danger">กรุณากรอกอีเมล</span>'; return; }
    selectAssigneeByEmail(email);
});

/* ── Event: กด Enter ในช่อง email ── */
document.getElementById('assign_email_input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const email = e.target.value.trim();
        if (email) selectAssigneeByEmail(email);
    }
});

/* ── แสดงรายการ assignments ── */
async function renderAssignmentList(tb_name) {
    const listEl = document.getElementById('assignmentList');
    listEl.innerHTML = '<div class="text-muted text-center py-2"><span class="spinner-border spinner-border-sm"></span></div>';

    try {
        const res = await fetch(`/rub/api/task-assignments/${tb_name}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            listEl.innerHTML = `<div class="assign-empty">
                <i class="bi bi-inbox" style="font-size:2rem; color:#a5d6a7;"></i>
                <div class="mt-1">ยังไม่มีการมอบหมายงาน</div>
            </div>`;
            return;
        }

        // Sort by id_from
        data.sort((a, b) => a.id_from - b.id_from);

        listEl.innerHTML = '';

        // Visualise ID range bar
        const maxId = Math.max(...data.map(d => d.id_to));

        // Color palette
        const palette = [
            '#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
            '#F44336', '#00BCD4', '#FF5722', '#795548'
        ];

        // Group by assignee to assign consistent color
        const colorMap = {};
        let colorIdx = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) {
                colorMap[d.assignee_name] = palette[colorIdx % palette.length];
                colorIdx++;
            }
        });

        // Render header summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'assign-summary mb-3';

        // ID range visualization
        const vizDiv = document.createElement('div');
        vizDiv.className = 'assign-range-viz mb-3';
        vizDiv.innerHTML = `<div class="assign-range-label">ภาพรวม ID Range</div>`;

        const rangeBar = document.createElement('div');
        rangeBar.className = 'assign-range-bar';

        data.forEach(d => {
            const pct_start = ((d.id_from - 1) / maxId) * 100;
            const pct_width = ((d.id_to - d.id_from + 1) / maxId) * 100;
            const seg = document.createElement('div');
            seg.className = 'assign-range-seg';
            seg.style.left = `${pct_start}%`;
            seg.style.width = `${pct_width}%`;
            seg.style.background = colorMap[d.assignee_name];
            seg.title = `${d.assignee_name}: ID ${d.id_from}–${d.id_to}`;
            rangeBar.appendChild(seg);
        });
        vizDiv.appendChild(rangeBar);

        // Range labels
        const labelRow = document.createElement('div');
        labelRow.className = 'assign-range-labels';
        data.forEach(d => {
            const lbl = document.createElement('span');
            lbl.className = 'assign-range-tick';
            lbl.style.left = `${((d.id_from - 1) / maxId) * 100}%`;
            lbl.textContent = d.id_from;
            labelRow.appendChild(lbl);
        });
        // Last id label
        const lastLbl = document.createElement('span');
        lastLbl.className = 'assign-range-tick';
        lastLbl.style.left = '100%';
        lastLbl.style.transform = 'translateX(-100%)';
        lastLbl.textContent = maxId;
        labelRow.appendChild(lastLbl);
        vizDiv.appendChild(labelRow);

        listEl.appendChild(vizDiv);

        // Render each row
        const rowsDiv = document.createElement('div');
        rowsDiv.className = 'assign-rows';

        data.forEach(d => {
            const color = colorMap[d.assignee_name];
            const row = document.createElement('div');
            row.className = 'assign-row';
            row.innerHTML = `
                <div class="assign-row-color" style="background:${color};"></div>
                <div class="assign-row-avatar">
                    ${d.assignee_photo
                    ? `<img src="${d.assignee_photo}" referrerpolicy="no-referrer" class="assign-avatar" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true'">`
                    : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(d.assignee_name)}&background=E9F5EC&color=2e7d32&rounded=true" class="assign-avatar">`
                }
                </div>
                <div class="assign-row-info">
                    <div class="assign-row-name">${d.assignee_name}</div>
                    <div class="assign-row-range">
                        <span class="assign-badge" style="background:${color};">ID ${d.id_from} – ${d.id_to}</span>
                        <span class="assign-count">(${d.id_to - d.id_from + 1} รายการ)</span>
                        ${d.note ? `<span class="assign-note-text">• ${d.note}</span>` : ''}
                    </div>
                </div>
                <div class="assign-row-actions">
                    <button class="btn btn-sm btn-outline-primary assign-edit-btn" data-id="${d.id}" title="แก้ไข">
                        <i class="bi bi-pencil-fill"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger assign-del-btn" data-id="${d.id}" title="ลบ">
                        <i class="bi bi-trash3-fill"></i>
                    </button>
                </div>
            `;
            rowsDiv.appendChild(row);
        });

        listEl.appendChild(rowsDiv);

        // Edit button handler
        listEl.querySelectorAll('.assign-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const rowId = btn.getAttribute('data-id');
                const d = data.find(x => x.id == rowId);
                if (!d) return;

                document.getElementById('assign_id').value = d.id;
                document.getElementById('assign_name').value = d.assignee_name;
                document.getElementById('assign_email').value = d.assignee_email || '';
                document.getElementById('assign_user_id').value = d.user_id || '';
                document.getElementById('assign_photo').value = d.assignee_photo || '';
                document.getElementById('assign_id_from').value = d.id_from;
                document.getElementById('assign_id_to').value = d.id_to;
                document.getElementById('assign_note').value = d.note || '';
                document.getElementById('assignFormTitle').innerHTML =
                    '<i class="bi bi-pencil-fill me-1"></i>แก้ไขการมอบหมายงาน';
                document.getElementById('btnCancelAssignEdit').style.display = 'inline-flex';

                // Highlight chip by email
                renderAssigneePicker(d.assignee_email || null);

                // Scroll to form
                document.getElementById('assignFormCard').scrollIntoView({ behavior: 'smooth' });
            });
        });

        // Delete button handler
        listEl.querySelectorAll('.assign-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const rowId = btn.getAttribute('data-id');
                const d = data.find(x => x.id == rowId);
                if (!d) return;
                if (!confirm(`ลบการมอบหมาย "${d.assignee_name} (ID ${d.id_from}–${d.id_to})" ใช่หรือไม่?`)) return;

                try {
                    const res = await fetch(`/rub/api/task-assignments/${rowId}`, { method: 'DELETE' });
                    const result = await res.json();
                    if (result.success) {
                        await renderAssignmentList(tb_name);
                        await loadAssignmentStrip(tb_name);
                    } else {
                        alert(`เกิดข้อผิดพลาด: ${result.error}`);
                    }
                } catch (err) {
                    alert(`เกิดข้อผิดพลาด: ${err.message}`);
                }
            });
        });

    } catch (err) {
        listEl.innerHTML = `<div class="text-danger">โหลดข้อมูลไม่ได้: ${err.message}</div>`;
    }
}

/* ── Save assignment ── */
document.getElementById('btnSaveAssign').addEventListener('click', async () => {
    const assignId = document.getElementById('assign_id').value;
    const tb_name = document.getElementById('assign_tb_name').value;
    const name = document.getElementById('assign_name').value.trim();
    const email = document.getElementById('assign_email').value.trim();
    const userId = document.getElementById('assign_user_id').value.trim();
    const photo = document.getElementById('assign_photo').value.trim();
    const id_from = document.getElementById('assign_id_from').value;
    const id_to = document.getElementById('assign_id_to').value;
    const note = document.getElementById('assign_note').value.trim();

    // ถ้ายังไม่ได้เลือก → ลองดึงจากช่องพิมพ์อีเมลก่อน save
    if (!email) {
        const typedEmail = document.getElementById('assign_email_input').value.trim();
        if (typedEmail) { selectAssigneeByEmail(typedEmail); }
    }
    const finalName = document.getElementById('assign_name').value.trim();
    const finalEmail = document.getElementById('assign_email').value.trim();
    if (!finalName || !finalEmail) { alert('กรุณาเลือกผู้รับผิดชอบ หรือพิมพ์อีเมลแล้วกดค้นหา'); return; }
    if (!id_from || !id_to) { alert('กรุณากรอก ID เริ่มต้น และ ID สิ้นสุด'); return; }
    if (parseInt(id_from) > parseInt(id_to)) { alert('ID เริ่มต้นต้องไม่มากกว่า ID สิ้นสุด'); return; }

    const btn = document.getElementById('btnSaveAssign');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>กำลังบันทึก...';

    try {
        let res;
        const finalUserId = document.getElementById('assign_user_id').value.trim();
        const finalPhoto = document.getElementById('assign_photo').value.trim();
        const payload = { assignee_name: finalName, assignee_email: finalEmail, assignee_photo: finalPhoto,
                          user_id: finalUserId || null, id_from, id_to, note };
        if (assignId) {
            res = await fetch(`/rub/api/task-assignments/${assignId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch(`/rub/api/task-assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tb_name, ...payload })
            });
        }
        const result = await res.json();
        if (result.success) {
            resetAssignForm();
            renderAssigneePicker(null);
            await renderAssignmentList(tb_name);
            await loadAssignmentStrip(tb_name);
        } else {
            alert(`เกิดข้อผิดพลาด: ${result.error}`);
        }
    } catch (err) {
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle me-1"></i>บันทึก';
    }
});

/* ── Cancel edit ── */
document.getElementById('btnCancelAssignEdit').addEventListener('click', () => {
    resetAssignForm();
    renderAssigneePicker(null);
});

/* ── Mini assignment strip inside layer card (with progress) ── */
async function loadAssignmentStrip(tb_name) {
    const stripEl = document.getElementById(`strip_${tb_name}`);
    if (!stripEl) return;

    try {
        const res = await fetch(`/rub/api/task-progress/${tb_name}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            stripEl.innerHTML = '';
            return;
        }

        const palette = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#FF5722', '#795548'];
        const colorMap = {};
        let ci = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) { colorMap[d.assignee_name] = palette[ci++ % palette.length]; }
        });

        stripEl.innerHTML = data.map(d => {
            const c = colorMap[d.assignee_name];
            const pct = d.pct || 0;
            let tsStr = '';
            if (d.last_ts) {
                const dt = new Date(d.last_ts);
                tsStr = `<span class="strip-ts"> · ${dt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}น.</span>`;
            }
            return `
            <div class="strip-progress-block" style="border-color:${c}33;">
                <div class="strip-progress-header">
                    <span class="strip-dot" style="background:${c};"></span>
                    <span class="strip-progress-name" style="color:${c};">${d.assignee_name}</span>
                    <span class="strip-id-range">ID ${d.id_from}–${d.id_to}</span>
                    <span class="strip-pct" style="color:${c};">${pct}%</span>
                    ${tsStr}
                </div>
                <div class="strip-bar-bg">
                    <div class="strip-bar-fill" style="width:${pct}%; background:${c};"></div>
                </div>
                <div class="strip-progress-sub">${d.done}/${d.total} แปลง
                    ${d.last_editor ? `· แก้ล่าสุดโดย <b>${d.last_editor}</b>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        stripEl.innerHTML = '';
    }
}


/* ═════════════════════════════════════════════════════════════
   MODAL 4 – ภาพรวมทีมงานทุกโปรเจค (Global Team Overview)
═════════════════════════════════════════════════════════════ */

let teamOverviewModal = null;
let teamOverviewData = [];

document.getElementById('btnTeamOverview').addEventListener('click', () => {
    if (!teamOverviewModal) {
        teamOverviewModal = new bootstrap.Modal(document.getElementById('teamOverviewModal'));
    }
    document.getElementById('teamOverviewWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    teamOverviewModal.show();

    fetch('/rub/api/worker-summary-all')
        .then(r => r.json())
        .then(({ data }) => {
            teamOverviewData = data || [];
            renderTeamOverview();
        })
        .catch(() => {
            document.getElementById('teamOverviewWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
});

/* ── Shared helper: render one area cell (ไร่ + ตร.ม.) ── */
function areaCell(a, countLabel) {
    if (!a || a.total_sqm === 0) return '<span class="text-muted small">—</span>';
    const sqm = Math.round(a.total_sqm).toLocaleString('th-TH');
    return `<div class="area-cnt">${countLabel}</div>
            <div class="pay-area-badge">${fmtRai(a.total_sqm)}</div>
            <div class="pay-area-sub">${sqm} ตร.ม.</div>`;
}

function renderTeamOverview() {
    const rate   = parseFloat(document.getElementById('team_rate_rai').value) || 0;
    const basis  = document.getElementById('team_basis').value;
    const data   = teamOverviewData;
    const wrap   = document.getElementById('teamOverviewWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>ยังไม่มีข้อมูลการทำงานในระบบ
        </div>`;
        return;
    }

    const palette = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#F44336','#00BCD4','#FF5722','#795548'];
    const basisLabel = { reshape: 'โฉนด', reclass_all: 'Reclass ทั้งหมด', reclass_rubber: 'ยางพารา Rubber' };

    const cards = data.map((worker, wi) => {
        const color  = palette[wi % palette.length];
        const basisA = worker[basis] || {};
        const totalPay = (basisA.area_rai_decimal || 0) * rate;
        const avatar = worker.photo
            ? `<img src="${worker.photo}" class="pay-avatar" referrerpolicy="no-referrer"
                onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(worker.editor)}&background=E9F5EC&color=2e7d32&rounded=true'">`
            : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(worker.editor)}&background=E9F5EC&color=2e7d32&rounded=true" class="pay-avatar">`;

        const projectRows = worker.projects.map(p => {
            const pBasis = p[basis] || {};
            const pPay = (pBasis.area_rai_decimal || 0) * rate;
            const reshapeCnt  = `${(p.reshape.farmer_count||0)} แปลง`;
            const reclassCnt  = `${(p.reclass_all.sub_plot_count||0)} รายการ /${(p.reclass_all.farmer_count||0)} แปลง`;
            const rubberCnt   = `${(p.reclass_rubber.sub_plot_count||0)} รายการ /${(p.reclass_rubber.farmer_count||0)} แปลง`;
            return `<tr class="team-project-row">
                <td><span class="team-project-badge"><i class="bi bi-table me-1"></i>${p.tb_name}</span></td>
                <td class="text-center ${basis==='reshape'?'area-col-selected':''}">${areaCell(p.reshape, reshapeCnt)}</td>
                <td class="text-center ${basis==='reclass_all'?'area-col-selected':''}">${areaCell(p.reclass_all, reclassCnt)}</td>
                <td class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">${areaCell(p.reclass_rubber, rubberCnt)}</td>
                <td class="text-end fw-bold" style="color:${color};">${pPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            </tr>`;
        }).join('');

        const wReshapeCnt  = `${(worker.reshape.farmer_count||0)} แปลง`;
        const wReclassCnt  = `${(worker.reclass_all.sub_plot_count||0)} รายการ`;
        const wRubberCnt   = `${(worker.reclass_rubber.sub_plot_count||0)} รายการ`;

        return `
        <div class="team-worker-card mb-3" style="border-color:${color}44;">
            <div class="team-worker-header" data-bs-toggle="collapse" data-bs-target="#worker_${wi}" style="cursor:pointer;">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    ${avatar}
                    <div class="team-worker-dot" style="background:${color};"></div>
                    <span class="team-worker-name" style="color:${color};">${worker.editor}</span>
                    <span class="team-worker-meta">${worker.projects.length} โปรเจค</span>
                    <span class="ms-auto d-flex align-items-center gap-3 flex-wrap">
                        <span class="area-summary-group">
                            <span class="area-summary-label">โฉนด</span>
                            <span class="area-summary-val ${basis==='reshape'?'area-selected-text':''}">${fmtRai(worker.reshape.total_sqm||0)} · ${Math.round(worker.reshape.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="area-summary-group">
                            <span class="area-summary-label">Reclass</span>
                            <span class="area-summary-val ${basis==='reclass_all'?'area-selected-text':''}">${fmtRai(worker.reclass_all.total_sqm||0)} · ${Math.round(worker.reclass_all.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="area-summary-group">
                            <span class="area-summary-label">Rubber</span>
                            <span class="area-summary-val ${basis==='reclass_rubber'?'area-selected-text':''}">${fmtRai(worker.reclass_rubber.total_sqm||0)} · ${Math.round(worker.reclass_rubber.total_sqm||0).toLocaleString()}ตร.ม.</span>
                        </span>
                        <span class="team-pay-total" style="color:${color};">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span>
                        <i class="bi bi-chevron-down team-chevron"></i>
                    </span>
                </div>
            </div>
            <div class="collapse show" id="worker_${wi}">
                <div class="team-project-table-wrap table-responsive">
                    <table class="table table-sm payment-table mb-0">
                        <thead>
                            <tr>
                                <th>โปรเจค</th>
                                <th class="text-center ${basis==='reshape'?'area-col-selected':''}">🏡 โฉนด Reshape<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-center ${basis==='reclass_all'?'area-col-selected':''}">📋 Reclass ทั้งหมด<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-center ${basis==='reclass_rubber'?'area-col-selected':''}">🌿 ยางพารา Rubber<br><small class="fw-normal text-muted">แปลง / ไร่ / ตร.ม.</small></th>
                                <th class="text-end">ค่าจ้าง<br><small class="fw-normal text-muted">(จาก ${basisLabel[basis]})</small></th>
                            </tr>
                        </thead>
                        <tbody>${projectRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }).join('');

    // Grand total per basis
    const grandSqm = data.reduce((s,w) => s + ((w[basis]||{}).total_sqm||0), 0);
    const grandPay = (grandSqm / 1600) * rate;

    wrap.innerHTML = `
        ${cards}
        <div class="team-grand-total">
            <span class="fw-bold">รวมทั้งระบบ (${basisLabel[basis]})</span>
            <span class="pay-area-badge ms-3">${fmtRai(grandSqm)}</span>
            <span class="pay-area-sub ms-1">${Math.round(grandSqm).toLocaleString()} ตร.ม.</span>
            <span class="team-pay-total ms-3">${grandPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span>
        </div>`;
}

function fmtRai(sqm) {
    return (parseFloat(sqm) / 1600).toFixed(2) + ' ไร่';
}

document.getElementById('btnCalcTeam').addEventListener('click', renderTeamOverview);

document.getElementById('btnPrintTeam').addEventListener('click', () => {
    const rate = document.getElementById('team_rate_rai').value;
    const bodyHtml = document.getElementById('teamOverviewWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ภาพรวมทีมงาน – ทุกโปรเจค</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family:"Noto Sans Thai",sans-serif; padding:20px; }
  .pay-avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;}
  .pay-area-badge{font-size:0.85rem;font-weight:600;color:#2e7d32;}
  .pay-area-sub{font-size:0.72rem;color:#78909c;}
  .team-worker-card{border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:12px;}
  .team-worker-header{margin-bottom:8px;}
  .team-worker-name{font-weight:700;font-size:1rem;}
  .team-worker-meta{font-size:0.8rem;color:#78909c;}
  .team-pay-total{font-weight:700;font-size:0.95rem;}
  .team-project-badge{background:#f5f5f5;padding:2px 8px;border-radius:6px;font-size:0.82rem;}
  .team-grand-total{background:#e8f5e9;border-radius:10px;padding:12px 16px;font-size:1rem;margin-top:16px;}
  .team-worker-dot,.team-chevron{display:none;}
  @media print{button,.btn{display:none!important;}}
</style>
</head>
<body>
<h4 style="color:#4a7c59">ภาพรวมทีมงาน – ทุกโปรเจค</h4>
<p class="text-muted mb-3">อัตราค่าจ้าง: <strong>${rate} บาท/ไร่</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH',{day:'2-digit',month:'long',year:'numeric'})}</p>
${bodyHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 5 – คำนวณค่าจ้างรายโปรเจค (Payment per Layer)
═════════════════════════════════════════════════════════════ */

let paymentModal = null;
let paymentWorkerData = [];
let paymentDeedTypes = [];
let paymentDetails = [];

function openPaymentModal(tb_name) {
    if (!paymentModal) {
        paymentModal = new bootstrap.Modal(document.getElementById('paymentModal'));
    }
    document.getElementById('paymentModalTbBadge').textContent = tb_name;
    document.getElementById('paymentTableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    paymentModal.show();

    fetch(`/rub/api/worker-summary/${tb_name}`)
        .then(r => r.json())
        .then(({ data, deed_types, details }) => {
            paymentWorkerData = data || [];
            paymentDeedTypes  = deed_types || [];
            paymentDetails    = details || [];
            populatePayDeedTypeSelect();
            renderPaymentTable();
        })
        .catch(() => {
            document.getElementById('paymentTableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

function populatePayDeedTypeSelect() {
    const sel = document.getElementById('pay_deed_type');
    sel.innerHTML = '<option value="all">ทั้งหมด</option>' +
        paymentDeedTypes.map(t => `<option value="${t}">${t}</option>`).join('');
    sel.value = 'all';
}

/* ── สรุปรายแปลง: ไอดีไหนเป็นประเภทเอกสารอะไร (filterable by deed type + search) ── */
function filterPayDetails(selected, searchTerm) {
    const term = (searchTerm || '').trim().toLowerCase();
    return paymentDetails.filter(d => {
        if (selected !== 'all' && d.deed_type !== selected) return false;
        if (!term) return true;
        return String(d.id).toLowerCase().includes(term) ||
               String(d.editor).toLowerCase().includes(term) ||
               String(d.deed_type).toLowerCase().includes(term);
    });
}

/* รวมยอด rows ตาม key (deed_type หรือ editor) → [{ key, plot_count, total_rai }] เรียงไร่มาก→น้อย */
function groupPayDetails(rows, key) {
    const map = {};
    rows.forEach(d => {
        const k = d[key];
        if (!map[k]) map[k] = { key: k, plot_count: 0, total_rai: 0 };
        map[k].plot_count += 1;
        map[k].total_rai += d.total_rai;
    });
    return Object.values(map).sort((a, b) => b.total_rai - a.total_rai);
}

/* บาง table มี ID เป็นพันรายการ — ถ้าแสดงทีละ chip จะยาวเกินไปและทำให้ DOM หนัก
   จึงอัดรายชื่อ ID ให้เป็นช่วงต่อเนื่อง เช่น [12,13,14,20] → "12-14, 20" สั้นกระชับไม่ว่าจะมีกี่ ID */
function compressIdRanges(ids) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    if (sorted.length === 0) return '';
    const ranges = [];
    let start = sorted[0], prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const v = sorted[i];
        if (v === prev + 1) { prev = v; continue; }
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = v; prev = v;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    return ranges.join(', ');
}

/* ปุ่ม "ดูทั้งหมด/หุบ" สำหรับเซลล์ ID ที่ตรวจซึ่งมีรายการยาวเกินไป */
function toggleIdCell(btn) {
    const cell = btn.closest('.pay-id-cell');
    const expanded = cell.classList.toggle('expanded');
    btn.textContent = expanded ? 'หุบ' : 'ดูทั้งหมด';
}

/* แต่ละกลุ่ม (ประเภทเอกสาร หรือ ผู้ทำงาน) → การ์ดสรุป + ช่วง ID แบบอัดให้สั้น (รองรับ ID เป็นพันรายการ) */
function buildGroupCardsHtml(rows, groupKey, rate, idPrefix) {
    const groups = groupPayDetails(rows, groupKey);
    if (groups.length === 0) {
        return `<div class="text-center text-muted py-3">ไม่มีข้อมูล</div>`;
    }
    return groups.map((g, i) => {
        const items = rows.filter(d => d[groupKey] === g.key);
        const pay = g.total_rai * rate;
        const collapseId = `${idPrefix}_${i}`;
        const titleHtml = groupKey === 'deed_type'
            ? `<span class="badge bg-light text-dark border">${g.key}</span>`
            : `<span class="fw-bold">${g.key}</span>`;

        let bodyHtml;
        if (groupKey === 'deed_type') {
            const ids = items.map(d => d.id);
            const idText = compressIdRanges(ids);
            const isLong = ids.length > 10;
            bodyHtml = isLong
                ? `<div class="pay-id-cell">
                        <div class="pay-id-clamp"><div class="pay-id-range">ID: ${idText}</div></div>
                        <button type="button" class="pay-id-toggle-btn" onclick="toggleIdCell(this)">ดูทั้งหมด</button>
                   </div>`
                : `<div class="pay-id-range">ID: ${idText}</div>`;
        } else {
            const byType = {};
            items.forEach(d => (byType[d.deed_type] = byType[d.deed_type] || []).push(d.id));
            bodyHtml = Object.entries(byType).map(([type, ids]) => {
                const idText = compressIdRanges(ids);
                const isLong = ids.length > 10;
                const countHtml = `<span class="text-muted small">(${ids.length.toLocaleString('th-TH')} แปลง)</span>`;
                if (!isLong) {
                    return `
                    <div class="pay-id-subline">
                        <span class="badge bg-light text-dark border me-1">${type}</span>
                        <span class="pay-id-range">${idText}</span>
                        ${countHtml}
                    </div>`;
                }
                return `
                <div class="pay-id-subline pay-id-cell">
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="badge bg-light text-dark border">${type}</span>
                        ${countHtml}
                        <button type="button" class="pay-id-toggle-btn" onclick="toggleIdCell(this)">ดูทั้งหมด</button>
                    </div>
                    <div class="pay-id-clamp"><span class="pay-id-range">ID: ${idText}</span></div>
                </div>`;
            }).join('');
        }

        return `
        <div class="pay-group-item border rounded mb-2">
            <button class="btn w-100 text-start d-flex justify-content-between align-items-center flex-wrap gap-1 py-2 px-3"
                type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false">
                <span><i class="bi bi-chevron-down pay-group-chevron me-2"></i>${titleHtml}</span>
                <span class="small text-muted">
                    ${g.plot_count.toLocaleString('th-TH')} แปลง &nbsp;·&nbsp; ${g.total_rai.toFixed(2)} ไร่ &nbsp;·&nbsp;
                    <span class="fw-bold pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span>
                </span>
            </button>
            <div class="collapse" id="${collapseId}">
                <div class="px-3 pb-2 pt-1 pay-id-chip-wrap">${bodyHtml}</div>
            </div>
        </div>`;
    }).join('');
}

function renderPayDetailBody() {
    const selected = document.getElementById('pay_deed_type').value || 'all';
    const rate = parseFloat(document.getElementById('pay_rate_rai').value) || 0;
    const searchEl = document.getElementById('pay_detail_search');
    const term = searchEl ? searchEl.value : '';
    const rows = filterPayDetails(selected, term);

    const byType = document.getElementById('payDetailByType');
    if (byType) byType.innerHTML = buildGroupCardsHtml(rows, 'deed_type', rate, 'payTypeGrp');

    const byWorker = document.getElementById('payDetailByWorker');
    if (byWorker) byWorker.innerHTML = buildGroupCardsHtml(rows, 'editor', rate, 'payWorkerGrp');

    const countEl = document.getElementById('payDetailCount');
    if (countEl) countEl.textContent = `${rows.length.toLocaleString('th-TH')} แปลง`;
}

function buildPayDetailSectionHtml() {
    return `
    <div class="mt-4">
        <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <h6 class="fw-bold mb-0"><i class="bi bi-list-check me-1"></i>สรุปรายแปลง: ไอดี &amp; ประเภทเอกสาร
                <span class="badge bg-secondary ms-1" id="payDetailCount"></span>
            </h6>
            <input type="text" id="pay_detail_search" class="form-control form-control-sm" style="max-width:240px;" placeholder="ค้นหา ID แปลง / ผู้ทำงาน...">
        </div>

        <div class="row g-3">
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header py-2 fw-bold"><i class="bi bi-collection me-1"></i>แต่ละประเภทเอกสารมี ID อะไรบ้าง</div>
                    <div class="card-body" style="max-height:340px;overflow:auto;" id="payDetailByType"></div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header py-2 fw-bold"><i class="bi bi-person-badge me-1"></i>แต่ละผู้ทำงานมี ID &amp; ประเภทอะไรบ้าง</div>
                    <div class="card-body" style="max-height:340px;overflow:auto;" id="payDetailByWorker"></div>
                </div>
            </div>
        </div>
    </div>`;
}

function wirePayDetailSection() {
    renderPayDetailBody();
    const searchEl = document.getElementById('pay_detail_search');
    if (searchEl) searchEl.addEventListener('input', renderPayDetailBody);
}

/* ตารางคำนวณค่าจ้าง: คิดจากยางพาราลงทะเบียน (ข้อมูลดิบ Rubr_total) เท่านั้น
   เลือกได้ว่าจะคิดทุกประเภทเอกสาร (แสดงแยกคอลัมน์) หรือเฉพาะประเภทเดียวจากดรอปดาวน์ */
function renderPaymentTable() {
    const rate     = parseFloat(document.getElementById('pay_rate_rai').value) || 0;
    const selected = document.getElementById('pay_deed_type').value || 'all';
    const data      = paymentWorkerData;
    const deedTypes = paymentDeedTypes;
    const wrap      = document.getElementById('paymentTableWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลยางพาราลงทะเบียน (Rubr_total) ที่มีผู้ทำงานใน table นี้
        </div>`;
        return;
    }

    const avatarOf = (r) => r.photo
        ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=2e7d32&rounded=true'">`
        : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=2e7d32&rounded=true" class="pay-avatar">`;

    if (selected !== 'all') {
        // ── คิดเฉพาะประเภทเอกสารที่เลือก ──
        const rows = data
            .map(r => ({ r, d: r.by_deed_type[selected] }))
            .filter(({ d }) => d && d.total_rai > 0)
            .map(({ r, d }, idx) => {
                const pay = d.total_rai * rate;
                return `<tr>
                    <td class="text-center align-middle">${idx + 1}</td>
                    <td class="align-middle">
                        <div class="d-flex align-items-center gap-2">
                            ${avatarOf(r)}
                            <span class="fw-bold">${r.editor}</span>
                        </div>
                    </td>
                    <td class="text-center align-middle">${(d.plot_count||0).toLocaleString('th-TH')} แปลง</td>
                    <td class="text-end fw-bold align-middle">${d.total_rai.toFixed(2)} ไร่</td>
                    <td class="text-end fw-bold align-middle pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                </tr>`;
            }).join('');

        const totalPlot = data.reduce((s, r) => s + ((r.by_deed_type[selected]||{}).plot_count || 0), 0);
        const totalRai  = data.reduce((s, r) => s + ((r.by_deed_type[selected]||{}).total_rai || 0), 0);
        const totalPay  = totalRai * rate;

        wrap.innerHTML = `
        <div class="table-responsive">
            <table class="table table-hover payment-table">
                <thead>
                    <tr>
                        <th class="text-center align-middle" style="width:40px">#</th>
                        <th class="align-middle">ชื่อผู้ทำงาน</th>
                        <th class="text-center align-middle">แปลง</th>
                        <th class="text-end align-middle">เนื้อที่<br><small class="fw-normal text-muted">ไร่ (Rubr_total) — ${selected}</small></th>
                        <th class="text-end align-middle">ค่าจ้าง</th>
                    </tr>
                </thead>
                <tbody>${rows || `<tr><td colspan="5" class="text-center text-muted py-3">ไม่มีข้อมูลประเภท "${selected}"</td></tr>`}</tbody>
                <tfoot>
                    <tr class="payment-total-row">
                        <td colspan="2" class="fw-bold align-middle">รวมทั้งหมด</td>
                        <td class="text-center fw-bold align-middle">${totalPlot.toLocaleString('th-TH')} แปลง</td>
                        <td class="text-end fw-bold align-middle">${totalRai.toFixed(2)} ไร่</td>
                        <td class="text-end fw-bold align-middle pay-total-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        ${buildPayDetailSectionHtml()}`;
        wirePayDetailSection();
        return;
    }

    // ── คิดทุกประเภทเอกสาร แยกแสดงผลเป็นคอลัมน์ ──
    const deedTypeCol = (type) => `<th class="text-end">${type}<br><small class="fw-normal text-muted">ไร่</small></th>`;

    const rows = data.map((r, i) => {
        const deedTypeCells = deedTypes.map(type => {
            const d = r.by_deed_type[type];
            return `<td class="text-end">${d ? d.total_rai.toFixed(2) : '—'}</td>`;
        }).join('');

        const pay = (r.total_rai || 0) * rate;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatarOf(r)}
                    <span class="fw-bold">${r.editor}</span>
                </div>
            </td>
            <td class="text-center align-middle">${(r.plot_count||0).toLocaleString('th-TH')} แปลง</td>
            ${deedTypeCells}
            <td class="text-end fw-bold align-middle">${(r.total_rai||0).toFixed(2)} ไร่</td>
            <td class="text-end fw-bold align-middle pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
        </tr>`;
    }).join('');

    // Totals
    const totalPlot = data.reduce((s, r) => s + (r.plot_count || 0), 0);
    const totalRai  = data.reduce((s, r) => s + (r.total_rai || 0), 0);
    const totalPay  = totalRai * rate;
    const deedTypeTotalCells = deedTypes.map(type => {
        const sum = data.reduce((s, r) => s + ((r.by_deed_type[type]||{}).total_rai || 0), 0);
        return `<td class="text-end">${sum.toFixed(2)}</td>`;
    }).join('');

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead>
                <tr>
                    <th class="text-center align-middle" style="width:40px">#</th>
                    <th class="align-middle">ชื่อผู้ทำงาน</th>
                    <th class="text-center align-middle">แปลง</th>
                    ${deedTypes.map(deedTypeCol).join('')}
                    <th class="text-end align-middle">รวมเนื้อที่<br><small class="fw-normal text-muted">ไร่ (Rubr_total)</small></th>
                    <th class="text-end align-middle">ค่าจ้าง</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="2" class="fw-bold align-middle">รวมทั้งหมด</td>
                    <td class="text-center fw-bold align-middle">${totalPlot.toLocaleString('th-TH')} แปลง</td>
                    ${deedTypeTotalCells}
                    <td class="text-end fw-bold align-middle">${totalRai.toFixed(2)} ไร่</td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                </tr>
            </tfoot>
        </table>
    </div>
    ${buildPayDetailSectionHtml()}`;
    wirePayDetailSection();
}

document.getElementById('btnCalcPay').addEventListener('click', renderPaymentTable);
document.getElementById('pay_deed_type').addEventListener('change', renderPaymentTable);

document.getElementById('btnPrintPayment').addEventListener('click', () => {
    const tb = document.getElementById('paymentModalTbBadge').textContent;
    const rate = document.getElementById('pay_rate_rai').value;
    const tableHtml = document.getElementById('paymentTableWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้าง – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-area-badge { font-size:0.85rem; }
  .pay-area-sub { font-size:0.72rem; color:#78909c; }
  .pay-amount { color:#2e7d32; }
  .pay-total-amount { color:#1b5e20; font-size:1.1rem; }
  .payment-total-row { background:#e8f5e9; }
  .collapse { display:block !important; }
  .pay-id-clamp { max-height:none !important; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#4a7c59">สรุปค่าจ้างทีมงาน – ${tb}</h4>
<p class="text-muted mb-3">อัตราค่าจ้าง: <strong>${rate} บาท/ไร่</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 5B – คำนวณค่าจ้าง V2 (คิดจาก class_Area ในตาราง reclass)

   เงื่อนไข (ต่อ id หนึ่ง ๆ ในตาราง reclass) — 3 กลุ่มตายตัว:
   - คลาสเดียว + เป็นยางพารา + โฉนด "นส.4"   → กลุ่ม นส.4     (ค่าเริ่มต้น 0.5 บาท/ไร่)
   - คลาสเดียว + เป็นยางพารา + โฉนดอื่น       → กลุ่ม อื่นๆ    (ค่าเริ่มต้น 1 บาท/ไร่)
   - ตั้งแต่ 2 คลาสขึ้นไป                     → กลุ่ม หลายคลาส (ค่าเริ่มต้น 1.5 บาท/ไร่)
   - คลาสเดียวแต่ไม่ใช่ยางพารา                → ไม่คิดค่าจ้าง แสดงเป็นคำเตือนแยกไว้

   ผลลัพธ์แสดงเป็นตารางแถวเดียวต่อคน สรุปยอดที่แต่ละคนได้รับตรง ๆ
═════════════════════════════════════════════════════════════ */

let paymentModalV2 = null;
let paymentV2WorkerData = [];
let paymentV2Warnings = [];
let paymentV2Tb = '';

function openPaymentModalV2(tb_name) {
    if (!paymentModalV2) {
        const modalEl = document.getElementById('paymentModalV2');
        paymentModalV2 = new bootstrap.Modal(modalEl);
        modalEl.addEventListener('hidden.bs.modal', closePayv2Preview);
        const bodyEl = modalEl.querySelector('.modal-body');
        if (bodyEl) bodyEl.addEventListener('scroll', closePayv2Preview);
    }
    paymentV2Tb = tb_name;
    document.getElementById('paymentModalV2TbBadge').textContent = tb_name;
    document.getElementById('paymentV2TableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    document.getElementById('paymentV2WarnWrap').innerHTML = '';
    paymentModalV2.show();

    fetch(`/rub/api/worker-summary-v2/${tb_name}`)
        .then(r => r.json())
        .then(({ data, warnings }) => {
            paymentV2WorkerData = data || [];
            paymentV2Warnings   = warnings || [];
            renderPaymentTableV2();
            renderWarningsV2();
        })
        .catch(() => {
            document.getElementById('paymentV2TableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

/* ไอดีแต่ละอันเป็นชิปกดได้ — กดแล้วเด้งภาพย่อรูปทรงแปลง+สีคลาสขึ้นมาเป็น popover เล็ก ๆ ตรงจุดที่กด
   (ไม่เปลี่ยนหน้า) ใช้เช็คว่าการจำแนกคลาสของ id นั้นถูกต้องหรือไม่
   จำกัดจำนวนที่ render กันหน้าเว็บหนักถ้ากลุ่มไหนมีเป็นพันแปลง และห่อด้วยกล่อง scroll กันแถวยาวเกิน */
function payV2IdChips(ids, tb) {
    const CHIP_LIMIT = 200;
    const shown = ids.slice(0, CHIP_LIMIT);
    const chips = shown.map(id =>
        `<span class="payv2-id-chip" onclick="showParcelPreview(event,'${tb}',${id})" title="ดูรูปแปลง/คลาส id ${id} เพื่อตรวจสอบ">${id}</span>`
    ).join('');
    const more = ids.length > CHIP_LIMIT
        ? `<span class="text-muted small ms-1">และอีก ${(ids.length - CHIP_LIMIT).toLocaleString('th-TH')} แปลง</span>`
        : '';
    return `<div class="payv2-id-scroll"><div class="payv2-id-chip-wrap">${chips}${more}</div></div>`;
}

/* ═════ Parcel preview popover — ภาพย่อรูปทรงแปลง + สีคลาส เด้งขึ้นตรงจุดที่กดไอดี ไม่เปลี่ยนหน้า ═════
   สีอ้างอิงจาก CLASS_COLORS ในหน้า reclass (nodejs/www/reclass/app.js) ให้สีตรงกัน */
const PAYV2_CLASS_COLORS = {
    'rubber': '#006d2c', 'Other': '#ff0004', 'not-rubber': '#9900ff',
    'ex_age_rubber': '#00ff0d', 'ex_building': '#ff00d4', 'ex_pond': '#00fff2',
    'ex_cr_area': '#ffff00', 'ex_ar_area': '#00008b', 'ex_other': '#AACDDC'
};
const PAYV2_DEFAULT_COLOR = '#fdae61';
const payv2ClassColor = (ct) => PAYV2_CLASS_COLORS[ct] || PAYV2_DEFAULT_COLOR;

/* คลาสที่ V3 นับเข้าฐานคิดเงิน (ยางพาราลงทะเบียน + พื้นที่กันออกทุกชนิด) — ใช้ตรงกับ PAYV3_ELIGIBLE_CLASSES ฝั่ง api.js
   เอามาแบ่ง "2 ฝั่ง" ในป๊อปอัพดูรูปแปลง (renderParcelPreviewLayers) ให้เห็นชัดว่าพื้นที่รวมทุกคลาส vs พื้นที่ที่ใช้คิดเงินจริงต่างกันเท่าไหร่ */
const PAYV2_ELIGIBLE_CLASSES = ['rubber', 'ex_age_rubber', 'ex_building', 'ex_pond', 'ex_cr_area', 'ex_ar_area', 'ex_other'];
const isPayv2Eligible = (ct) => PAYV2_ELIGIBLE_CLASSES.includes((ct || '').trim().toLowerCase());

/* ป้ายภาษาไทย — ใช้ชื่อเดียวกับตัวเลือกประเภทในหน้า reclass (nodejs/www/reclass/index.html) */
const PAYV2_CLASS_LABELS = {
    'rubber': 'ยางพาราที่ลงทะเบียน',
    'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
    'Other': 'ไม่ใช่ยางพารา',
    'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
    'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)',
    'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
    'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)',
    'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
    'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
};
const payv2ClassLabel = (ct) => PAYV2_CLASS_LABELS[ct] || ct || 'ไม่ระบุ';

let payv2PreviewEl = null;
let payv2PreviewBackdropEl = null;
let payv2PreviewMap = null;
let payv2PreviewLayerGroup = null;
let payv2PreviewCache = {};
let payv2PreviewKey = null;
let payv2PreviewReqSeq = 0;

/* map ตัวเดียวใช้ซ้ำทุกครั้งที่เปิด popover (ไม่สร้างใหม่ทุกคลิก) — เบากว่าและกัน Leaflet container ชนกัน
   ฐานภาพเป็น Google Satellite แบบเดียวกับที่ใช้ในหน้า reclass (nodejs/www/reclass/app.js) */
function ensurePayv2PreviewEl() {
    if (payv2PreviewEl) return payv2PreviewEl;

    // backdrop เป็นแค่ฉากหลังหรี่จอ ไม่ดักคลิก (pointer-events:none ใน CSS) เพราะปิดตอนคลิกนอกป๊อปอัพ
    // ใช้ document click listener เดิมอยู่แล้ว (ต้องปล่อยให้คลิก id chip อื่นทะลุไปเปลี่ยนแปลงที่แสดงได้)
    const backdrop = document.createElement('div');
    backdrop.className = 'payv2-preview-backdrop d-none';
    document.body.appendChild(backdrop);
    payv2PreviewBackdropEl = backdrop;

    const el = document.createElement('div');
    el.className = 'payv2-preview-popover d-none';
    el.innerHTML = `
        <div class="payv2-preview-header">
            <span class="payv2-preview-title"></span>
            <button type="button" class="payv2-preview-close" onclick="closePayv2Preview()">&times;</button>
        </div>
        <div class="payv2-preview-map"></div>
        <div class="payv2-preview-info"></div>`;
    el.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(el);
    payv2PreviewEl = el;

    payv2PreviewMap = L.map(el.querySelector('.payv2-preview-map'), {
        attributionControl: false,
        scrollWheelZoom: false
    }).setView([13.7563, 100.5018], 5);
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 21
    }).addTo(payv2PreviewMap);
    payv2PreviewLayerGroup = L.layerGroup().addTo(payv2PreviewMap);

    return el;
}

function closePayv2Preview() {
    if (payv2PreviewEl) payv2PreviewEl.classList.add('d-none');
    if (payv2PreviewBackdropEl) payv2PreviewBackdropEl.classList.add('d-none');
    payv2PreviewKey = null;
}

document.addEventListener('click', (e) => {
    if (payv2PreviewEl && !payv2PreviewEl.classList.contains('d-none') && !e.target.closest('.payv2-id-chip')) {
        closePayv2Preview();
    }
});

/* ═════ ป๊อปอัพ "ดูรายการไอดี" — กดปุ่มเล็ก ๆ ข้างตัวเลขแปลงในตารางสรุปหลัก (นส.4 / อื่นๆ / โบนัสหลายคลาส)
   เพื่อดูว่ากลุ่มนั้นมี id ไหนบ้าง โดยไม่ต้องกดขยาย "รายละเอียด" ทั้งแถว ═════ */
let payv2IdListEl = null;

function ensurePayv2IdListEl() {
    if (payv2IdListEl) return payv2IdListEl;
    const el = document.createElement('div');
    el.className = 'payv2-idlist-popover d-none';
    el.innerHTML = `
        <div class="payv2-idlist-header">
            <span class="payv2-idlist-title"></span>
            <button type="button" class="payv2-idlist-close" onclick="closePayv2IdList()">&times;</button>
        </div>
        <div class="payv2-idlist-body"></div>
        <div class="payv2-idlist-footer d-none"></div>`;
    el.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(el);
    payv2IdListEl = el;
    return el;
}

function closePayv2IdList() {
    if (payv2IdListEl) payv2IdListEl.classList.add('d-none');
}

document.addEventListener('click', (e) => {
    if (payv2IdListEl && !payv2IdListEl.classList.contains('d-none') && !e.target.closest('.payv2-count-link')) {
        closePayv2IdList();
    }
});

const PAYV2_GROUP_LABELS = { ns4: 'นส.4', other: 'อื่นๆ', bonus: 'โบนัสหลายคลาส' };

function showPayv2GroupIds(evt, workerIdx, group) {
    evt.stopPropagation();
    const worker = paymentV2WorkerData[workerIdx];
    const g = worker && worker[group];
    const ids = (g && g.ids) || [];
    const el = ensurePayv2IdListEl();

    const rect = evt.currentTarget.getBoundingClientRect();
    const popW = 260;
    const left = Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - popW - 12);
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    el.classList.remove('d-none');
    el.querySelector('.payv2-idlist-title').textContent =
        `${PAYV2_GROUP_LABELS[group] || group} — ${ids.length.toLocaleString('th-TH')} แปลง`;
    el.querySelector('.payv2-idlist-body').innerHTML = ids.length
        ? payV2IdChips(ids, paymentV2Tb)
        : `<div class="text-muted small py-1">ไม่มีแปลง</div>`;

    // กลุ่ม "โบนัสหลายคลาส" คิดแบบคงที่ต่อแปลง (ไม่ใช่ตามไร่) จึงรวมยอดเงินทั้งหมดให้ดูตรงนี้ได้เลย
    // อยู่ใน footer แยกจาก body ที่เลื่อนได้ กันยอดรวมเลื่อนหายไปตอนมีหลายแปลง
    const footerEl = el.querySelector('.payv2-idlist-footer');
    if (group === 'bonus' && ids.length > 0) {
        const rateBonus = parseFloat(document.getElementById('payv2_rate_bonus').value) || 0;
        const total = ids.length * rateBonus;
        footerEl.innerHTML = `${ids.length.toLocaleString('th-TH')} แปลง &times; ${rateBonus.toLocaleString('th-TH')} บาท/แปลง =
            <span class="fw-bold">${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>`;
        footerEl.classList.remove('d-none');
    } else {
        footerEl.classList.add('d-none');
        footerEl.innerHTML = '';
    }
}

/* กดไอดีเดิมซ้ำ = ปิด, กดไอดีอื่น = ย้าย popover ไปแสดงที่ไอดีนั้นแทน */
async function showParcelPreview(evt, tb, id) {
    evt.stopPropagation();
    closePayv2IdList(); // ปิดป๊อปอัพ "รายการไอดี" (ถ้าเปิดอยู่) กันซ้อนทับรูปแปลงที่กำลังจะเปิด
    const key = `${tb}:${id}`;
    const el = ensurePayv2PreviewEl();

    if (payv2PreviewKey === key && !el.classList.contains('d-none')) {
        closePayv2Preview();
        return;
    }
    payv2PreviewKey = key;

    // ปักตำแหน่งไว้กลางจอเสมอ (กำหนดใน CSS .payv2-preview-popover) ไม่อิงจุดที่กด
    // กันไม่ให้ป๊อปอัพไปบังแถวตารางที่กำลังดูอยู่ ไม่ว่าจะกดไอดีจากตรงไหนของหน้า
    el.classList.remove('d-none');
    if (payv2PreviewBackdropEl) payv2PreviewBackdropEl.classList.remove('d-none');
    el.querySelector('.payv2-preview-title').textContent = `แปลง id ${id}`;
    payv2PreviewMap.invalidateSize(); // popover เพิ่งเปลี่ยนจาก d-none เป็นแสดงผล ต้องบอก Leaflet คำนวณขนาด container ใหม่
    payv2PreviewLayerGroup.clearLayers();
    const infoEl = el.querySelector('.payv2-preview-info');
    infoEl.innerHTML = `<div class="text-center text-muted py-2"><div class="spinner-border spinner-border-sm"></div></div>`;

    const seq = ++payv2PreviewReqSeq;
    try {
        let data = payv2PreviewCache[key];
        if (!data) {
            const r = await fetch(`/rub/api/parcel-preview/${tb}/${id}`);
            data = await r.json();
            payv2PreviewCache[key] = data;
        }
        if (seq !== payv2PreviewReqSeq || payv2PreviewKey !== key) return; // ผู้ใช้กดไอดีอื่นไปแล้วระหว่างรอโหลด
        if (!data.success) throw new Error(data.error || 'โหลดไม่สำเร็จ');
        if (data.deed_type) el.querySelector('.payv2-preview-title').textContent = `แปลง id ${id} · ${data.deed_type}`;
        infoEl.innerHTML = renderParcelPreviewLayers(data);
    } catch (err) {
        if (seq !== payv2PreviewReqSeq || payv2PreviewKey !== key) return;
        infoEl.innerHTML = `<div class="text-danger small py-2">โหลดรูปแปลงไม่สำเร็จ</div>`;
    }
}

/* วาดขอบแปลงเดิม (เส้นประเทา) + คลาสที่จำแนกไว้ (สีตาม classtype) ทับบนภาพถ่ายดาวเทียม แล้ว fit ขอบเขตให้พอดี
   คืน HTML ของ legend + ตารางรายละเอียดคลาส (ใส่ใต้แผนที่) */
function renderParcelPreviewLayers(data) {
    const { parcel, classes } = data;
    if (!parcel && (!classes || classes.length === 0)) {
        return `<div class="text-muted small py-2">ไม่พบข้อมูลรูปแปลง</div>`;
    }

    const bounds = [];
    if (parcel) {
        const gj = L.geoJSON(parcel, {
            style: { color: '#eeeeee', weight: 2, dashArray: '4,3', fillOpacity: 0 }
        }).addTo(payv2PreviewLayerGroup);
        if (gj.getBounds().isValid()) bounds.push(gj.getBounds());
    }
    (classes || []).forEach(c => {
        if (!c.geom) return;
        const color = payv2ClassColor(c.classtype);
        const gj = L.geoJSON(c.geom, {
            style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.5 }
        }).addTo(payv2PreviewLayerGroup);
        if (gj.getBounds().isValid()) bounds.push(gj.getBounds());
    });

    if (bounds.length > 0) {
        let combined = bounds[0];
        bounds.slice(1).forEach(b => { combined = combined.extend(b); });
        payv2PreviewMap.fitBounds(combined, { padding: [16, 16], maxZoom: 20 });
    }

    // ตร.ม. เอาจาก class_area_sqm (shpsplit_sqm ดิบ) ตรงๆ ไม่ใช่ ไร่×1600 — เพราะ class_area_rai
    // ถูกปัดเป็นไร่ 2 ตำแหน่งแล้ว คูณกลับจะเพี้ยนได้หลาย ตร.ม. เทียบกับตัวเลขในหน้า reclassdash
    const fmtSqm = (n) => Math.round(n || 0).toLocaleString('th-TH');
    const rows = (classes || []).map(c => {
        const eligible = isPayv2Eligible(c.classtype);
        return `
        <tr class="${eligible ? 'payv2-preview-row-eligible' : ''}">
            <td class="text-muted">${c.sub_id || '-'}</td>
            <td><span class="payv2-legend-dot" style="background:${payv2ClassColor(c.classtype)}"></span>${payv2ClassLabel(c.classtype)}${eligible ? ' <i class="bi bi-check-circle-fill text-success" title="นับเป็นพื้นที่คิดเงิน"></i>' : ''}</td>
            <td class="text-end">${(c.class_area_rai || 0).toFixed(2)} ไร่ (${fmtSqm(c.class_area_sqm)} ตร.ม.)</td>
        </tr>`;
    }).join('');
    if (!rows) return `<div class="text-muted small py-2">ยังไม่ได้จำแนกคลาส</div>`;

    // แบ่งยอดรวมเป็น 2 ฝั่ง: (1) เนื้อที่รวมทุกคลาสในแปลง (2) เฉพาะคลาสที่นับเป็นพื้นที่คิดเงิน
    // (ยางพาราลงทะเบียน + พื้นที่กันออกทุกชนิด — ดู isPayv2Eligible) ตัดยางไม่ลงทะเบียน/ไม่ใช่ยางออก
    const totalArea = (classes || []).reduce((s, c) => s + (c.class_area_rai || 0), 0);
    const totalSqm = (classes || []).reduce((s, c) => s + (c.class_area_sqm || 0), 0);
    const eligibleClasses = (classes || []).filter(c => isPayv2Eligible(c.classtype));
    const eligibleArea = eligibleClasses.reduce((s, c) => s + (c.class_area_rai || 0), 0);
    const eligibleSqm = eligibleClasses.reduce((s, c) => s + (c.class_area_sqm || 0), 0);
    return `
        <table class="table table-sm mb-0 mt-1 payv2-preview-table">
            <tbody>${rows}</tbody>
            <tfoot>
                <tr>
                    <td colspan="2">เนื้อที่รวมทุกคลาส</td>
                    <td class="text-end">${totalArea.toFixed(2)} ไร่ (${fmtSqm(totalSqm)} ตร.ม.)</td>
                </tr>
                <tr class="fw-bold payv2-preview-row-eligible">
                    <td colspan="2"><i class="bi bi-check-circle-fill text-success me-1"></i>ยางลงทะเบียน + พื้นที่กันออก (ใช้คิดเงิน)</td>
                    <td class="text-end">${eligibleArea.toFixed(2)} ไร่ (${fmtSqm(eligibleSqm)} ตร.ม.)</td>
                </tr>
            </tfoot>
        </table>`;
}

/* จำนวนการ์ดที่ render ให้เห็นตั้งแต่แรกต่อคนงานหนึ่งคน — กันหน้าเว็บหนักถ้าคนงานคนเดียวทำเป็นร้อยเป็นพันแปลง
   ที่เหลือกดปุ่ม "แสดงเพิ่ม" ทีละชุด หรือ "แสดงทั้งหมด" ครั้งเดียว หรือพิมพ์ค้นหา/กดตัวกรองหลายคลาส
   ระบบจะดึงออกมาให้ครบอัตโนมัติ (ดู applyPayv2PlotFilter) */
const PAYV2_PLOT_BATCH = 10;

/* การ์ดเดียวต่อ "แปลง" (id) หนึ่งแปลง — 1 id ปรากฏแค่ครั้งเดียวเสมอ ไม่ซ้ำ และเขียนสูตรคำนวณ (ไร่ × เรท + โบนัส = รวม)
   ไว้ในบรรทัดเดียวกันแบบอ่านจบในตัวเอง ไม่ต้องเทียบข้ามคอลัมน์ กันงงเวลาการ์ดถูกตัด/เลื่อนจอแคบ ๆ
   data-search ใช้ให้ filterPayv2Plots() ค้นหาได้ — แปลงหลายคลาสมีเส้นขอบซ้ายสีเหลืองให้เห็นชัดตาโดยไม่ต้องอ่านตัวหนังสือ
   hidden=true คือการ์ดที่ยังไม่ถึงคิวแสดง (เกินโควตาชุดแรก) จะถูกซ่อนด้วย class batch-hidden ไว้ก่อน */
function payV2PlotDetailCard(plot, badgeClass, deedLabel, rateNs4, rateOther, rateBonus, tb, hidden, displayIndex) {
    const rate = plot.is_ns4 ? rateNs4 : rateOther;
    const areaPay = plot.area_rai * rate;
    const bonusPay = plot.is_multi ? rateBonus : 0;
    const totalPay = areaPay + bonusPay;
    const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // data-search รวมประเภทโฉนด + ไอดี + เลขทะเบียน + คำว่า "หลายคลาส"/"multi" ไว้ในช่องเดียว เพื่อให้พิมพ์ค้นหาคำไหนก็เจอ
    const searchText = `${deedLabel} ${plot.id} ${plot.regis_no || ''}${plot.is_multi ? ' หลายคลาส multi' : ''}`.toLowerCase();
    const cls = ['payv2-plot-card'];
    if (plot.is_multi) cls.push('is-multi');
    if (hidden) cls.push('batch-hidden');
    return `
    <div class="${cls.join(' ')}" data-search="${searchText}" data-multi="${plot.is_multi ? '1' : '0'}"
        data-deed="${deedLabel}" data-total="${totalPay}" data-bonus="${bonusPay}">
        <div class="payv2-plot-head">
            <span class="payv2-plot-index">${displayIndex}</span>
            ${payV2IdChips([plot.id], tb)}
            <span class="badge ${badgeClass}">${deedLabel}</span>
            ${plot.is_multi ? `<span class="badge bg-warning text-dark">หลายคลาส (${plot.class_count} คลาส)</span>` : ''}
        </div>
        ${plot.regis_no ? `<div class="payv2-plot-regis"><i class="bi bi-person-vcard me-1"></i>เลขทะเบียน ${plot.regis_no}</div>` : ''}
        <div class="payv2-plot-calc">
            ${plot.area_rai.toFixed(2)} ${plot.is_multi ? 'ไร่รวม' : 'ไร่ยาง'} &times; ${rate.toLocaleString('th-TH')} บาท/ไร่ = ${fmt(areaPay)} บาท${plot.is_multi ? ` <span class="payv2-bonus-chip">+ โบนัส ${fmt(bonusPay)} บาท</span>` : ''}
        </div>
        <div class="payv2-plot-total">รวม <span class="pay-amount fw-bold">${fmt(totalPay)}</span> บาท</div>
        <div class="payv2-plot-thumb-wrap">
            <div class="payv2-plot-thumb" data-tb="${tb}" data-id="${plot.id}"></div>
            <div class="payv2-plot-thumb-loading"><div class="spinner-border spinner-border-sm text-muted"></div></div>
        </div>
    </div>`;
}

/* รายละเอียดของคนงานหนึ่งคน: การ์ดแบบ 1 ใบต่อ 1 แปลง (id) เรียงตาม นส.4 ก่อน แล้วตามด้วยประเภทโฉนดอื่นๆ
   ทุกแปลงปรากฏแค่ครั้งเดียว พร้อมสูตรคำนวณและยอดรวมที่ได้จริงต่อแปลงในการ์ดเดียวกัน มีช่องค้นหาประเภทโฉนด/ไอดี
   อยู่ด้านบน (มีประโยชน์มากเมื่อคนงานคนหนึ่งทำหลายประเภทโฉนดปนกันจนรายการยาว) — และแสดงแค่ชุดแรกก่อนถ้ารายการยาวมาก
   พร้อมปุ่ม "แสดงเพิ่ม" ให้ทยอยโหลดทีละชุด กันหน้าเว็บหนักเวลาคนงานคนเดียวมีเป็นร้อยเป็นพันแปลง */
function buildPayV2DetailHtml(worker, rateNs4, rateOther, rateBonus, tb, idx) {
    const plots = worker.plots || [];
    const plotById = {};
    plots.forEach(p => { plotById[p.id] = p; });

    const entries = [];
    const deedTypesSeen = [];
    if (worker.ns4.plot_count > 0) deedTypesSeen.push('นส.4');
    worker.ns4.ids.forEach(id => {
        const p = plotById[id];
        if (p) entries.push({ p, badgeClass: 'bg-success', deedLabel: 'นส.4' });
    });
    Object.entries(worker.other.by_deed_type).forEach(([dt, d]) => {
        deedTypesSeen.push(dt);
        d.ids.forEach(id => {
            const p = plotById[id];
            if (p) entries.push({ p, badgeClass: 'bg-info text-dark', deedLabel: dt });
        });
    });

    if (entries.length === 0) {
        return `<div class="text-center text-muted py-2">ไม่มีรายการที่คิดค่าจ้างได้</div>`;
    }

    const cards = entries.map((e, i) =>
        payV2PlotDetailCard(e.p, e.badgeClass, e.deedLabel, rateNs4, rateOther, rateBonus, tb, i >= PAYV2_PLOT_BATCH, i + 1)
    );

    // ยอดรวมเริ่มต้น (ก่อนกรอง) — ให้เห็นสรุปทันทีที่เปิดรายละเอียด ไม่ต้องกดกรองก่อนถึงจะเห็นยอด
    // ค่านวณจากสูตรเดียวกับที่การ์ดแต่ละใบใช้ (payV2PlotDetailCard) ให้ตรงกันเป๊ะ
    const fmt2 = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const grandTotal = entries.reduce((sum, e) => {
        const rate = e.p.is_ns4 ? rateNs4 : rateOther;
        const bonusPay = e.p.is_multi ? rateBonus : 0;
        return sum + (e.p.area_rai * rate) + bonusPay;
    }, 0);
    const multiBonusTotal = worker.bonus.plot_count * rateBonus;
    const summaryBannerHtml = `<i class="bi bi-cash-coin me-1"></i>
        รวมทั้งหมด ${entries.length.toLocaleString('th-TH')} แปลง = <span class="fw-bold">${fmt2(grandTotal)} บาท</span>
        <span class="payv2-summary-sep">|</span>
        หลายคลาส ${worker.bonus.plot_count.toLocaleString('th-TH')} แปลง (โบนัส <span class="fw-bold">${fmt2(multiBonusTotal)} บาท</span>)`;

    // แสดงเรทที่ใช้คิดของแต่ละกลุ่มไว้ให้เห็นชัด ๆ ว่ายอดรวมข้างบนคิดมาจากเรทเท่าไหร่ (ไม่เปลี่ยนตามตัวกรอง เพราะเรทคงที่ตลอดทั้งคนงาน)
    const rateLegendHtml = `<i class="bi bi-calculator me-1"></i>เรทที่ใช้คิด:
        <b>นส.4</b> ${rateNs4.toLocaleString('th-TH')} บาท/ไร่ &nbsp;&middot;&nbsp;
        <b>อื่นๆ</b> ${rateOther.toLocaleString('th-TH')} บาท/ไร่ &nbsp;&middot;&nbsp;
        <b>โบนัสหลายคลาส</b> ${rateBonus.toLocaleString('th-TH')} บาท/แปลง`;

    // นับแปลงหลายคลาส แยกตามประเภทโฉนด ให้เมนู "หลายคลาสเท่านั้น" เลือกกรองเจาะจงประเภทโฉนดได้เหมือนกัน
    const multiByDeed = {};
    entries.forEach(e => {
        if (e.p.is_multi) multiByDeed[e.deedLabel] = (multiByDeed[e.deedLabel] || 0) + 1;
    });
    const multiTotal = Object.values(multiByDeed).reduce((a, b) => a + b, 0);
    const multiDeedItems = deedTypesSeen
        .filter(dt => (multiByDeed[dt] || 0) > 0)
        .map(dt => `<li><a class="dropdown-item payv2-multi-deed-item" href="#" data-deed="${dt}" onclick="selectPayv2MultiDeed(event, this)">
            ${dt} <span class="badge bg-light text-dark ms-1">${multiByDeed[dt].toLocaleString('th-TH')}</span>
        </a></li>`)
        .join('');

    // นับแปลงคลาสเดียว (= ยางพาราลงทะเบียนล้วน ดู payV2PlotDetailCard) แยกตามประเภทโฉนด ให้เมนู "คลาสยางพาราลงทะเบียนเท่านั้น"
    // เลือกกรองเจาะจงประเภทโฉนดได้ ไม่ใช่กรองรวมทุกประเภทอย่างเดียว
    const pureRubberByDeed = {};
    entries.forEach(e => {
        if (!e.p.is_multi) pureRubberByDeed[e.deedLabel] = (pureRubberByDeed[e.deedLabel] || 0) + 1;
    });
    const pureRubberTotal = Object.values(pureRubberByDeed).reduce((a, b) => a + b, 0);
    const rubberDeedItems = deedTypesSeen
        .filter(dt => (pureRubberByDeed[dt] || 0) > 0)
        .map(dt => `<li><a class="dropdown-item payv2-rubber-deed-item" href="#" data-deed="${dt}" onclick="selectPayv2RubberDeed(event, this)">
            ${dt} <span class="badge bg-light text-dark ms-1">${pureRubberByDeed[dt].toLocaleString('th-TH')}</span>
        </a></li>`)
        .join('');

    const datalistId = `payv2_deedtypes_${idx}`;
    const options = deedTypesSeen.map(dt => `<option value="${dt}">`).join('');
    const remaining = entries.length - PAYV2_PLOT_BATCH;
    const loadMoreBar = remaining > 0
        ? `<div class="payv2-loadmore-bar">
                <button type="button" class="btn btn-sm btn-outline-secondary payv2-loadmore-btn" onclick="payv2LoadMorePlots(this)">
                    <i class="bi bi-chevron-down me-1"></i>แสดงเพิ่ม ${Math.min(PAYV2_PLOT_BATCH, remaining).toLocaleString('th-TH')} รายการ (เหลืออีก ${remaining.toLocaleString('th-TH')})
                </button>
                <button type="button" class="btn btn-sm btn-link payv2-loadall-btn" onclick="payv2LoadAllPlots(this)">
                    แสดงทั้งหมด (${entries.length.toLocaleString('th-TH')} แปลง)
                </button>
           </div>`
        : '';

    return `
    <div class="payv2-plot-detail-wrap">
        <div class="payv2-plot-search-bar">
            <i class="bi bi-search text-muted"></i>
            <input type="text" class="form-control form-control-sm payv2-plot-search"
                placeholder="ค้นหาประเภทโฉนด / ไอดีแปลง / พิมพ์ &quot;หลายคลาส&quot;..." list="${datalistId}" oninput="filterPayv2Plots(this)">
            <datalist id="${datalistId}">${options}</datalist>
            <div class="btn-group payv2-multi-dropdown">
                <button type="button" class="btn btn-sm btn-outline-warning payv2-multi-toggle dropdown-toggle" data-deed=""
                    data-bs-toggle="dropdown" aria-expanded="false"
                    title="แสดงเฉพาะแปลงที่มีหลายคลาส (ได้โบนัส) เลือกแยกตามประเภทโฉนดได้">
                    <i class="bi bi-layers"></i> <span class="payv2-multi-toggle-label">หลายคลาสเท่านั้น</span>
                </button>
                <ul class="dropdown-menu payv2-multi-dropdown-menu">
                    <li><a class="dropdown-item payv2-multi-clear-item" href="#" onclick="selectPayv2MultiDeed(event, this)">
                        <i class="bi bi-x-circle me-1"></i>ไม่กรอง (ปิด)
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item payv2-multi-deed-item" href="#" data-deed="" onclick="selectPayv2MultiDeed(event, this)">
                        ทั้งหมด (ทุกประเภทโฉนด) <span class="badge bg-light text-dark ms-1">${multiTotal.toLocaleString('th-TH')}</span>
                    </a></li>
                    ${multiDeedItems}
                </ul>
            </div>
            <div class="btn-group payv2-rubber-dropdown">
                <button type="button" class="btn btn-sm btn-outline-success payv2-rubber-toggle dropdown-toggle" data-deed=""
                    data-bs-toggle="dropdown" aria-expanded="false"
                    title="แสดงเฉพาะแปลงคลาสเดียวที่เป็นยางพาราลงทะเบียนล้วน (ไม่ปนคลาสอื่น) เลือกแยกตามประเภทโฉนดได้">
                    <i class="bi bi-tree"></i> <span class="payv2-rubber-toggle-label">คลาสยางพาราลงทะเบียนเท่านั้น</span>
                </button>
                <ul class="dropdown-menu payv2-rubber-dropdown-menu">
                    <li><a class="dropdown-item payv2-rubber-clear-item" href="#" onclick="selectPayv2RubberDeed(event, this)">
                        <i class="bi bi-x-circle me-1"></i>ไม่กรอง (ปิด)
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item payv2-rubber-deed-item" href="#" data-deed="" onclick="selectPayv2RubberDeed(event, this)">
                        ทั้งหมด (ทุกประเภทโฉนด) <span class="badge bg-light text-dark ms-1">${pureRubberTotal.toLocaleString('th-TH')}</span>
                    </a></li>
                    ${rubberDeedItems}
                </ul>
            </div>
            ${worker.bonus.plot_count > 0 ? `
            <button type="button" class="btn btn-sm btn-outline-success" onclick="showPayv2BonusFullscreen(event)"
                title="ดูแปลงที่ได้โบนัสหลายคลาสแบบเต็มหน้าจอ พร้อมรูปและยอดรวม">
                <i class="bi bi-cash-coin"></i> สรุปโบนัส (${worker.bonus.plot_count.toLocaleString('th-TH')})
            </button>` : ''}
            <span class="payv2-plot-count-badge">${entries.length.toLocaleString('th-TH')} แปลง</span>
            <button type="button" class="btn btn-sm btn-outline-secondary payv2-fullscreen-toggle" onclick="togglePayv2Fullscreen(this)"
                title="ขยายเต็มหน้าจอ">
                <i class="bi bi-arrows-fullscreen"></i>
            </button>
        </div>
        <div class="payv2-rate-legend">${rateLegendHtml}</div>
        <div class="payv2-summary-banner">${summaryBannerHtml}</div>
        <div class="payv2-plot-list">${cards.join('')}</div>
        <div class="payv2-plot-empty d-none text-center text-muted py-2">ไม่พบแปลงที่ตรงกับคำค้นหา</div>
        ${loadMoreBar}
    </div>`;
}

/* กดปุ่ม "แสดงเพิ่ม" — เปิดการ์ดชุดถัดไปทีละ PAYV2_PLOT_BATCH ใบ */
function payv2LoadMorePlots(btn) {
    const wrap = btn.closest('.payv2-plot-detail-wrap');
    if (!wrap) return;
    const hiddenCards = wrap.querySelectorAll('.payv2-plot-card.batch-hidden');
    let revealed = 0;
    hiddenCards.forEach(card => {
        if (revealed >= PAYV2_PLOT_BATCH) return;
        card.classList.remove('batch-hidden');
        revealed++;
    });
    payv2RefreshLoadMoreBar(wrap);
    payv2LoadVisibleThumbs(wrap);
}

/* กดปุ่ม "แสดงทั้งหมด" — เปิดการ์ดที่เหลือทุกใบทีเดียว ไม่ต้องกด "แสดงเพิ่ม" หลายรอบ */
function payv2LoadAllPlots(btn) {
    const wrap = btn.closest('.payv2-plot-detail-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.payv2-plot-card.batch-hidden').forEach(c => c.classList.remove('batch-hidden'));
    payv2RefreshLoadMoreBar(wrap);
    payv2LoadVisibleThumbs(wrap);
}

/* อัปเดตข้อความปุ่ม/ซ่อนแถบ "แสดงเพิ่ม | แสดงทั้งหมด" เมื่อไม่มีการ์ดที่ซ่อนไว้เหลือแล้ว */
function payv2RefreshLoadMoreBar(wrap) {
    const bar = wrap.querySelector('.payv2-loadmore-bar');
    if (!bar) return;
    const remaining = wrap.querySelectorAll('.payv2-plot-card.batch-hidden').length;
    if (remaining <= 0) {
        bar.remove();
        return;
    }
    const moreBtn = bar.querySelector('.payv2-loadmore-btn');
    const allBtn = bar.querySelector('.payv2-loadall-btn');
    const totalCount = wrap.querySelectorAll('.payv2-plot-card').length;
    if (moreBtn) {
        moreBtn.innerHTML = `<i class="bi bi-chevron-down me-1"></i>แสดงเพิ่ม ${Math.min(PAYV2_PLOT_BATCH, remaining).toLocaleString('th-TH')} รายการ (เหลืออีก ${remaining.toLocaleString('th-TH')})`;
    }
    if (allBtn) {
        allBtn.textContent = `แสดงทั้งหมด (${totalCount.toLocaleString('th-TH')} แปลง)`;
    }
}

/* กรองการ์ดแปลงในกล่องรายละเอียดของคนงานคนเดียว — พิมพ์ค้นหา (ประเภทโฉนด/ไอดี/"หลายคลาส")
   และ/หรือ กดปุ่ม "หลายคลาสเท่านั้น" เพื่อกรองเฉพาะแปลงที่ได้โบนัสหลายคลาส
   และ/หรือ กดปุ่ม "คลาสยางพาราลงทะเบียนเท่านั้น" เพื่อกรองเฉพาะแปลงคลาสเดียวที่เป็นยางพาราลงทะเบียนล้วน (ตรงข้ามกับหลายคลาส
   เพราะทุกแปลงที่แสดงในลิสต์นี้ต้องมีคลาสยางพาราลงทะเบียนอยู่แล้วเป็นเงื่อนไขจากฝั่ง backend — ดู hasRubber ใน api.js —
   ดังนั้นแปลงคลาสเดียวในลิสต์นี้คือแปลงยางพาราลงทะเบียนล้วนเสมอ) ทุกตัวกรองใช้ร่วมกันได้ (AND) */
function filterPayv2Plots(inputEl) {
    applyPayv2PlotFilter(inputEl.closest('.payv2-plot-detail-wrap'));
}

/* ตัวกรองหลายคลาส และตัวกรองยางพาราลงทะเบียน (คลาสเดียว) กันคนละขั้วกันเสมอ — แปลงคลาสเดียวเป็นยางพารา
   ล้วนไม่มีทางเป็นแปลงหลายคลาสได้พร้อมกัน เปิดฝั่งหนึ่งแล้วปิดอีกฝั่งอัตโนมัติ (ดู clearPayv2MultiFilter/clearPayv2RubberFilter)
   กันงงเวลาผลลัพธ์ว่างเปล่าโดยไม่รู้สาเหตุ ทั้งสองฝั่งออกแบบเหมือนกัน: ปุ่มเป็น dropdown เลือก "ทั้งหมด" (ทุกประเภทโฉนด)
   หรือเจาะจงประเภทโฉนด (นส.4 / โฉนดอื่นๆ ที่มีในลิสต์นี้) ได้ พร้อมตัวเลขจำนวนแปลงกำกับแต่ละตัวเลือก */

/* ปิดตัวกรอง "หลายคลาสเท่านั้น" กลับสู่สถานะเริ่มต้น — ใช้ทั้งตอนกดเมนู "ไม่กรอง (ปิด)" และตอนเปิดตัวกรองยางพาราลงทะเบียนซึ่งกันคนละขั้วกัน */
function clearPayv2MultiFilter(wrap) {
    const dropdown = wrap.querySelector('.payv2-multi-dropdown');
    if (!dropdown) return;
    const toggleBtn = dropdown.querySelector('.payv2-multi-toggle');
    const label = toggleBtn.querySelector('.payv2-multi-toggle-label');
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.dataset.deed = '';
    label.textContent = 'หลายคลาสเท่านั้น';
    dropdown.querySelectorAll('.payv2-multi-deed-item').forEach(i => i.classList.remove('active'));
}

/* เปิดตัวกรอง "หลายคลาสเท่านั้น" แบบเจาะจง deed (หรือ '' = ทั้งหมด) — เรียกตรงได้จาก showPayv2BonusFullscreen
   โดยไม่ต้องผ่าน event ของเมนู */
function activatePayv2MultiFilter(wrap, deed) {
    const dropdown = wrap.querySelector('.payv2-multi-dropdown');
    if (!dropdown) return;
    const toggleBtn = dropdown.querySelector('.payv2-multi-toggle');
    const label = toggleBtn.querySelector('.payv2-multi-toggle-label');
    dropdown.querySelectorAll('.payv2-multi-deed-item').forEach(i => {
        i.classList.toggle('active', (i.dataset.deed || '') === (deed || ''));
    });
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
    toggleBtn.dataset.deed = deed || '';
    label.textContent = deed ? `หลายคลาส: ${deed}` : 'หลายคลาส: ทั้งหมด';
    clearPayv2RubberFilter(wrap);
    applyPayv2PlotFilter(wrap);
}

/* กดเลือกรายการในเมนู "หลายคลาสเท่านั้น" */
function selectPayv2MultiDeed(evt, el) {
    evt.preventDefault();
    if (el.classList.contains('disabled')) return;
    const wrap = el.closest('.payv2-plot-detail-wrap');

    if (el.classList.contains('payv2-multi-clear-item')) {
        clearPayv2MultiFilter(wrap);
        applyPayv2PlotFilter(wrap);
        return;
    }

    activatePayv2MultiFilter(wrap, el.dataset.deed || '');
}

/* ปิดตัวกรอง "คลาสยางพาราลงทะเบียนเท่านั้น" กลับสู่สถานะเริ่มต้น — ใช้ทั้งตอนกดเมนู "ไม่กรอง (ปิด)"
   และตอนเปิดตัวกรองหลายคลาสซึ่งกันคนละขั้วกัน */
function clearPayv2RubberFilter(wrap) {
    const dropdown = wrap.querySelector('.payv2-rubber-dropdown');
    if (!dropdown) return;
    const toggleBtn = dropdown.querySelector('.payv2-rubber-toggle');
    const label = toggleBtn.querySelector('.payv2-rubber-toggle-label');
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', 'false');
    toggleBtn.dataset.deed = '';
    label.textContent = 'คลาสยางพาราลงทะเบียนเท่านั้น';
    dropdown.querySelectorAll('.payv2-rubber-deed-item').forEach(i => i.classList.remove('active'));
}

/* กดเลือกรายการในเมนู "คลาสยางพาราลงทะเบียนเท่านั้น" — เลือก "ทั้งหมด" กรองทุกประเภทโฉนดที่เป็นคลาสเดียว (ยางพาราล้วน)
   หรือเลือกประเภทโฉนดเจาะจง (เช่น "นส.4" หรือ "ส.ป.ก.4-01ข") กรองเฉพาะประเภทนั้น ปุ่มหลักแสดงชื่อประเภทที่เลือกไว้เสมอ
   ให้รู้ว่ากำลังกรองอะไรอยู่โดยไม่ต้องเปิดเมนูซ้ำ */
function selectPayv2RubberDeed(evt, el) {
    evt.preventDefault();
    if (el.classList.contains('disabled')) return;
    const wrap = el.closest('.payv2-plot-detail-wrap');
    const dropdown = el.closest('.payv2-rubber-dropdown');

    if (el.classList.contains('payv2-rubber-clear-item')) {
        clearPayv2RubberFilter(wrap);
        applyPayv2PlotFilter(wrap);
        return;
    }

    const toggleBtn = dropdown.querySelector('.payv2-rubber-toggle');
    const label = toggleBtn.querySelector('.payv2-rubber-toggle-label');
    const deed = el.dataset.deed || '';

    dropdown.querySelectorAll('.payv2-rubber-deed-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-pressed', 'true');
    toggleBtn.dataset.deed = deed;
    label.textContent = deed ? `ยางพาราลงทะเบียน: ${deed}` : 'ยางพาราลงทะเบียน: ทั้งหมด';

    clearPayv2MultiFilter(wrap);

    applyPayv2PlotFilter(wrap);
}

function applyPayv2PlotFilter(wrap) {
    if (!wrap) return;
    const input = wrap.querySelector('.payv2-plot-search');
    const multiBtn = wrap.querySelector('.payv2-multi-toggle');
    const rubberBtn = wrap.querySelector('.payv2-rubber-toggle');
    const q = input ? input.value.trim().toLowerCase() : '';
    const multiOnly = multiBtn ? multiBtn.classList.contains('active') : false;
    const multiDeed = multiBtn ? (multiBtn.dataset.deed || '') : '';
    const rubberOnly = rubberBtn ? rubberBtn.classList.contains('active') : false;
    const rubberDeed = rubberBtn ? (rubberBtn.dataset.deed || '') : '';
    const searching = !!q || multiOnly || rubberOnly;
    const loadMoreBar = wrap.querySelector('.payv2-loadmore-bar');

    // กำลังค้นหา/กรองอยู่ — เปิดการ์ดที่ยังไม่ถึงคิว "แสดงเพิ่ม" ออกมาทั้งหมดก่อน กันเคสที่ตรงคำค้นหาแต่ยังไม่ถูกโหลดออกมา
    if (searching) {
        wrap.querySelectorAll('.payv2-plot-card.batch-hidden').forEach(c => c.classList.remove('batch-hidden'));
        if (loadMoreBar) loadMoreBar.classList.add('d-none');
    } else if (loadMoreBar) {
        loadMoreBar.classList.remove('d-none');
    }

    const emptyMsg = wrap.querySelector('.payv2-plot-empty');
    let visibleCount = 0;
    let grandTotal = 0;
    let multiCount = 0;
    let multiBonusTotal = 0;
    wrap.querySelectorAll('.payv2-plot-card').forEach(card => {
        const textMatch = !q || card.dataset.search.includes(q);
        const multiMatch = !multiOnly || (card.dataset.multi === '1' && (!multiDeed || card.dataset.deed === multiDeed));
        const rubberMatch = !rubberOnly || (card.dataset.multi === '0' && (!rubberDeed || card.dataset.deed === rubberDeed));
        const match = textMatch && multiMatch && rubberMatch;
        card.classList.toggle('d-none', !match);
        if (match) {
            visibleCount++;
            grandTotal += parseFloat(card.dataset.total) || 0;
            if (card.dataset.multi === '1') {
                multiCount++;
                multiBonusTotal += parseFloat(card.dataset.bonus) || 0;
            }
        }
    });
    if (emptyMsg) emptyMsg.classList.toggle('d-none', visibleCount !== 0);

    // แถบสรุปยอด — รวมค่าจ้างของการ์ดที่มองเห็นอยู่ทั้งหมด (รวมไร่×เรท+โบนัส) และแยกยอดโบนัสหลายคลาสให้ดูด้วย
    // อัปเดตตามตัวกรอง/คำค้นหาปัจจุบันเสมอ ไม่ใช่แค่ตอนเปิด "หลายคลาสเท่านั้น"
    const fmt2 = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const banner = wrap.querySelector('.payv2-summary-banner');
    if (banner) {
        if (visibleCount > 0) {
            banner.innerHTML = `<i class="bi bi-cash-coin me-1"></i>
                รวมทั้งหมด ${visibleCount.toLocaleString('th-TH')} แปลง = <span class="fw-bold">${fmt2(grandTotal)} บาท</span>
                <span class="payv2-summary-sep">|</span>
                หลายคลาส ${multiCount.toLocaleString('th-TH')} แปลง (โบนัส <span class="fw-bold">${fmt2(multiBonusTotal)} บาท</span>)`;
            banner.classList.remove('d-none');
        } else {
            banner.classList.add('d-none');
        }
    }

    payv2LoadVisibleThumbs(wrap);
}

/* ปุ่ม "สรุปโบนัส" — เปิดกล่องรายการแปลงเป็นเต็มจอ + เปิดกรอง "หลายคลาสเท่านั้น" พร้อมกันในคลิกเดียว
   ได้ผลลัพธ์เป็นกริดรูปแปลงเต็มจอที่กรองเหลือเฉพาะแปลงที่ได้โบนัส พร้อมยอดรวมด้านบน (payv2-summary-banner) */
function showPayv2BonusFullscreen(evt) {
    evt.stopPropagation();
    const wrap = evt.currentTarget.closest('.payv2-plot-detail-wrap');
    if (!wrap) return;

    const fsBtn = wrap.querySelector('.payv2-fullscreen-toggle');
    if (fsBtn && !wrap.classList.contains('payv2-fullscreen')) togglePayv2Fullscreen(fsBtn);

    const multiBtn = wrap.querySelector('.payv2-multi-toggle');
    if (multiBtn && !multiBtn.classList.contains('active')) activatePayv2MultiFilter(wrap, '');
}

/* ปุ่มขยายเต็มหน้าจอ — สลับ class ให้กล่องรายการแปลงคลุมทั้งวิวพอร์ต ช่วยตรวจสอบรายการยาว ๆ ได้ง่ายขึ้น
   โดยไม่ต้องเปิดหน้าต่างใหม่ กด ESC หรือกดปุ่มซ้ำเพื่อย่อกลับ — ตอนขยายเต็มจอจะโชว์รูปแปลงของทุกการ์ดที่มองเห็นทันที
   โดยไม่ต้องกดไอดีทีละอัน (ดู payv2LoadVisibleThumbs) */
function togglePayv2Fullscreen(btn) {
    const wrap = btn.closest('.payv2-plot-detail-wrap');
    if (!wrap) return;
    const isFullscreen = wrap.classList.toggle('payv2-fullscreen');
    document.body.classList.toggle('payv2-fullscreen-lock', isFullscreen);
    const icon = btn.querySelector('i');
    if (icon) icon.className = isFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
    btn.title = isFullscreen ? 'ย่อกลับ' : 'ขยายเต็มหน้าจอ';

    if (isFullscreen) {
        const onKeydown = (ev) => {
            if (ev.key === 'Escape') togglePayv2Fullscreen(btn);
        };
        wrap._payv2EscHandler = onKeydown;
        document.addEventListener('keydown', onKeydown);
        // รอเฟรมถัดไปให้ browser คำนวณ layout ของกล่องเต็มจอเสร็จก่อน ค่อยสร้างแผนที่ย่อ (กันขนาด container เพี้ยน)
        requestAnimationFrame(() => payv2LoadVisibleThumbs(wrap));
    } else if (wrap._payv2EscHandler) {
        document.removeEventListener('keydown', wrap._payv2EscHandler);
        wrap._payv2EscHandler = null;
    }
}

/* ปุ่มขยายเต็มหน้าจอของตาราง "แปลงที่ไม่มีคลาสยางพาราลงทะเบียนเลย" — เหมือน togglePayv2Fullscreen
   แต่ทำงานกับกล่อง .payv2-warn-wrap (ตารางแจ้งเตือนด้านล่างค่าจ้าง) แยกต่างหาก เผื่อมีแปลงแจ้งเตือนเยอะ */
function togglePayv2WarnFullscreen(btn) {
    const wrap = btn.closest('.payv2-warn-wrap');
    if (!wrap) return;
    const isFullscreen = wrap.classList.toggle('payv2-fullscreen');
    document.body.classList.toggle('payv2-fullscreen-lock', isFullscreen);
    const icon = btn.querySelector('i');
    if (icon) icon.className = isFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen';
    btn.title = isFullscreen ? 'ย่อกลับ' : 'ขยายเต็มหน้าจอ';

    if (isFullscreen) {
        const onKeydown = (ev) => {
            if (ev.key === 'Escape') togglePayv2WarnFullscreen(btn);
        };
        wrap._payv2EscHandler = onKeydown;
        document.addEventListener('keydown', onKeydown);
    } else if (wrap._payv2EscHandler) {
        document.removeEventListener('keydown', wrap._payv2EscHandler);
        wrap._payv2EscHandler = null;
    }
}

/* ═════ รูปย่อแปลงแบบโชว์อัตโนมัติในการ์ด (เฉพาะตอนขยายเต็มจอ) — ใช้ API/สีเดียวกับ showParcelPreview
   แต่สร้างแผนที่ Leaflet แยกต่อการ์ด (เล็ก, ปิดการโต้ตอบ) และโหลดเฉพาะการ์ดที่มองเห็นอยู่จริงเพื่อไม่ให้หน้าเว็บหนัก ═════ */
const payv2ThumbMaps = {}; // key `${tb}:${id}` -> { map, layerGroup, bounds }

function ensurePayv2ThumbMap(container, key) {
    if (payv2ThumbMaps[key]) return payv2ThumbMaps[key];
    const map = L.map(container, {
        attributionControl: false, zoomControl: false, scrollWheelZoom: false,
        dragging: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false
    }).setView([13.7563, 100.5018], 5);
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'], maxZoom: 21
    }).addTo(map);
    const layerGroup = L.layerGroup().addTo(map);
    const entry = { map, layerGroup, bounds: null };
    payv2ThumbMaps[key] = entry;
    return entry;
}

async function loadPayv2Thumb(thumbEl) {
    const wrapEl = thumbEl.closest('.payv2-plot-thumb-wrap');
    const tb = thumbEl.dataset.tb, id = thumbEl.dataset.id;
    const key = `${tb}:${id}`;
    const entry = ensurePayv2ThumbMap(thumbEl, key);
    entry.map.invalidateSize();

    if (thumbEl.dataset.loaded === '1') {
        if (entry.bounds) entry.map.fitBounds(entry.bounds, { padding: [8, 8], maxZoom: 20 });
        if (wrapEl) wrapEl.classList.add('loaded');
        return;
    }
    if (thumbEl.dataset.loading === '1') return;
    thumbEl.dataset.loading = '1';

    try {
        let data = payv2PreviewCache[key];
        if (!data) {
            const r = await fetch(`/rub/api/parcel-preview/${tb}/${id}`);
            data = await r.json();
            payv2PreviewCache[key] = data;
        }
        if (!data.success) throw new Error(data.error || 'โหลดไม่สำเร็จ');
        entry.layerGroup.clearLayers();
        const bounds = [];
        if (data.parcel) {
            const gj = L.geoJSON(data.parcel, { style: { color: '#eeeeee', weight: 2, dashArray: '4,3', fillOpacity: 0 } }).addTo(entry.layerGroup);
            if (gj.getBounds().isValid()) bounds.push(gj.getBounds());
        }
        (data.classes || []).forEach(c => {
            if (!c.geom) return;
            const color = payv2ClassColor(c.classtype);
            const gj = L.geoJSON(c.geom, { style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.5 } }).addTo(entry.layerGroup);
            if (gj.getBounds().isValid()) bounds.push(gj.getBounds());
        });
        if (bounds.length > 0) {
            let combined = bounds[0];
            bounds.slice(1).forEach(b => { combined = combined.extend(b); });
            entry.bounds = combined;
            entry.map.fitBounds(combined, { padding: [8, 8], maxZoom: 20 });
        }
        thumbEl.dataset.loaded = '1';
    } catch (err) {
        thumbEl.title = 'โหลดรูปแปลงไม่สำเร็จ';
    } finally {
        thumbEl.dataset.loading = '0';
        if (wrapEl) wrapEl.classList.add('loaded');
    }
}

/* หาการ์ดที่มองเห็นอยู่จริง (ไม่ถูกซ่อนด้วยตัวกรอง/batch-hidden) ในกล่องที่กำลังขยายเต็มจอ แล้วสั่งโหลดรูปย่อทีละใบ */
function payv2LoadVisibleThumbs(wrap) {
    if (!wrap || !wrap.classList.contains('payv2-fullscreen')) return;
    wrap.querySelectorAll('.payv2-plot-card').forEach(card => {
        if (card.classList.contains('d-none') || card.classList.contains('batch-hidden')) return;
        const thumb = card.querySelector('.payv2-plot-thumb');
        if (thumb) loadPayv2Thumb(thumb);
    });
}

/* เรียกตอน renderPaymentTableV2() สร้างตารางใหม่ทั้งหมด (เช่น เปลี่ยนเรท) — เคลียร์แผนที่ย่อเก่าที่ค้างอยู่ใน memory
   เพราะ container เดิมถูกทิ้งไปพร้อม innerHTML แล้ว ไม่เคลียร์ก็จะรั่วและยังโหลด tile ต่อทั้งที่มองไม่เห็น */
function payv2DestroyAllThumbMaps() {
    Object.values(payv2ThumbMaps).forEach(entry => {
        try { entry.map.remove(); } catch (e) { /* container อาจถูกลบไปแล้ว */ }
    });
    Object.keys(payv2ThumbMaps).forEach(k => delete payv2ThumbMaps[k]);
}

function togglePayV2Detail(i) {
    const row = document.getElementById(`payv2_detail_${i}`);
    const icon = document.getElementById(`payv2_detail_icon_${i}`);
    if (!row) return;
    row.classList.toggle('d-none');
    if (icon) icon.classList.toggle('bi-chevron-down');
    if (icon) icon.classList.toggle('bi-chevron-up');
}

/* ตารางสรุปแบบแถวเดียวต่อคน: นส.4 / อื่นๆ / หลายคลาส / รวม — อ่านง่าย สรุปยอดที่แต่ละคนได้ตรง ๆ
   กดปุ่ม "รายละเอียด" เพื่อดูไอดีแปลงที่ทำ และประเภทโฉนดทุกประเภทที่อยู่ในกลุ่ม "อื่นๆ" */
function renderPaymentTableV2() {
    payv2DestroyAllThumbMaps(); // ตารางเดิมกำลังจะถูกทิ้งทั้งหมด เคลียร์แผนที่ย่อเก่าก่อนกันรั่ว/โหลด tile ค้าง
    const rateNs4   = parseFloat(document.getElementById('payv2_rate_ns4').value) || 0;
    const rateOther = parseFloat(document.getElementById('payv2_rate_other').value) || 0;
    const rateBonus = parseFloat(document.getElementById('payv2_rate_bonus').value) || 0;
    const wrap = document.getElementById('paymentV2TableWrap');
    const data = paymentV2WorkerData;

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลจำแนกพื้นที่ (class_Area) ที่มีผู้ทำงานใน table นี้
        </div>`;
        return;
    }

    const avatarOf = (r) => r.photo
        ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=00695c&rounded=true'">`
        : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=E9F5EC&color=00695c&rounded=true" class="pay-avatar">`;

    let gNs4Plot = 0, gNs4Area = 0, gNs4Pay = 0;
    let gOtherPlot = 0, gOtherArea = 0, gOtherPay = 0;
    let gBonusPlot = 0, gBonusPay = 0;
    let grandPay = 0;

    const rows = data.map((worker, i) => {
        const ns4Pay   = worker.ns4.area_rai   * rateNs4;
        const otherPay = worker.other.area_rai * rateOther;
        const bonusPay = worker.bonus.plot_count * rateBonus;
        const totalPay = ns4Pay + otherPay + bonusPay;

        gNs4Plot += worker.ns4.plot_count;     gNs4Area += worker.ns4.area_rai;     gNs4Pay += ns4Pay;
        gOtherPlot += worker.other.plot_count; gOtherArea += worker.other.area_rai; gOtherPay += otherPay;
        gBonusPlot += worker.bonus.plot_count; gBonusPay += bonusPay;
        grandPay += totalPay;

        // ตัวเลขจำนวนแปลงเองเป็นตัวกดดูรายการไอดี (ขีดเส้นใต้จุด ๆ) แทนปุ่มไอคอนแยก กันรกตา — ถ้าไม่มีแปลงเลยก็เป็นแค่ตัวเลขเฉย ๆ กดไม่ได้
        const countCell = (count, group, unit) => count > 0
            ? `<span class="payv2-count-link" onclick="showPayv2GroupIds(event, ${i}, '${group}')" title="ดูรายการไอดี">${count.toLocaleString('th-TH')}${unit ? ' ' + unit : ''}</span>`
            : `${count.toLocaleString('th-TH')}${unit ? ' ' + unit : ''}`;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatarOf(worker)}
                    <span class="fw-bold">${worker.editor}</span>
                </div>
            </td>
            <td class="text-center align-middle">${countCell(worker.ns4.plot_count, 'ns4', 'แปลง')}<br><small class="text-muted">${worker.ns4.area_rai.toFixed(2)} ไร่</small></td>
            <td class="text-end align-middle">${ns4Pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">${countCell(worker.other.plot_count, 'other', 'แปลง')}<br><small class="text-muted">${worker.other.area_rai.toFixed(2)} ไร่</small></td>
            <td class="text-end align-middle">${otherPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">${countCell(worker.bonus.plot_count, 'bonus')}<br><small class="text-muted">แปลง</small></td>
            <td class="text-end align-middle">${bonusPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-end align-middle fw-bold pay-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="payv2_detail_btn_${i}" onclick="togglePayV2Detail(${i})" title="ดูไอดีที่ทำ / ทุกประเภทโฉนด">
                    <i class="bi bi-chevron-down" id="payv2_detail_icon_${i}"></i>
                </button>
            </td>
        </tr>
        <tr id="payv2_detail_${i}" class="d-none payv2-detail-row">
            <td colspan="10">${buildPayV2DetailHtml(worker, rateNs4, rateOther, rateBonus, paymentV2Tb, i)}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead>
                <tr>
                    <th class="text-center align-middle" style="width:40px">#</th>
                    <th class="align-middle">ชื่อผู้ทำงาน</th>
                    <th class="text-center align-middle">นส.4<br><small class="fw-normal text-muted">แปลง / ไร่</small></th>
                    <th class="text-end align-middle">ค่าจ้าง นส.4</th>
                    <th class="text-center align-middle">อื่นๆ<br><small class="fw-normal text-muted">แปลง / ไร่</small></th>
                    <th class="text-end align-middle">ค่าจ้าง อื่นๆ</th>
                    <th class="text-center align-middle">โบนัสหลายคลาส<br><small class="fw-normal text-muted">แปลง</small></th>
                    <th class="text-end align-middle">ค่าจ้าง โบนัส</th>
                    <th class="text-end align-middle">รวมค่าจ้าง</th>
                    <th class="text-center align-middle" style="width:60px">รายละเอียด</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="2" class="fw-bold align-middle">รวมทั้งหมด</td>
                    <td class="text-center fw-bold align-middle">${gNs4Plot.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${gNs4Area.toFixed(2)} ไร่</small></td>
                    <td class="text-end fw-bold align-middle">${gNs4Pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-center fw-bold align-middle">${gOtherPlot.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${gOtherArea.toFixed(2)} ไร่</small></td>
                    <td class="text-end fw-bold align-middle">${gOtherPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-center fw-bold align-middle">${gBonusPlot.toLocaleString('th-TH')}<br><small class="text-muted">แปลง</small></td>
                    <td class="text-end fw-bold align-middle">${gBonusPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${grandPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

function renderWarningsV2() {
    const wrap = document.getElementById('paymentV2WarnWrap');
    if (!paymentV2Warnings || paymentV2Warnings.length === 0) {
        wrap.innerHTML = '';
        return;
    }
    const ids = paymentV2Warnings.map(w => w.id);
    const idText = compressIdRanges(ids);
    const rows = paymentV2Warnings.map(w => `
        <tr>
            <td><span class="payv2-id-chip" onclick="showParcelPreview(event,'${paymentV2Tb}',${w.id})" title="ดูรูปแปลง/คลาส id ${w.id} เพื่อตรวจสอบ">${w.id}</span></td>
            <td>${payv2ClassLabel(w.classtype)}</td>
            <td>${w.deed_type}</td>
            <td>${w.editor}</td>
        </tr>`).join('');

    wrap.innerHTML = `
        <div class="alert alert-warning mb-0 payv2-warn-wrap">
            <div class="fw-bold mb-1 d-flex align-items-start justify-content-between gap-2">
                <span><i class="bi bi-exclamation-triangle-fill me-1"></i>
                พบ ${paymentV2Warnings.length.toLocaleString('th-TH')} แปลง (id: ${idText}) ที่ไม่มีคลาสยางพาราลงทะเบียนเลย (ไม่มีฐานไร่ยางให้คิดเรท) — ไม่ถูกนับในค่าจ้างข้างต้น กรุณาตรวจสอบ</span>
                <button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0 payv2-warn-fullscreen-toggle" onclick="togglePayv2WarnFullscreen(this)" title="ขยายเต็มหน้าจอ">
                    <i class="bi bi-arrows-fullscreen"></i>
                </button>
            </div>
            <div class="table-responsive payv2-warn-table-wrap" style="max-height:220px;overflow:auto;">
                <table class="table table-sm table-bordered mb-0 bg-white">
                    <thead><tr><th>ID</th><th>ประเภทคลาส</th><th>ประเภทโฉนด</th><th>ผู้ทำงาน</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

document.getElementById('btnCalcPayV2').addEventListener('click', renderPaymentTableV2);

document.getElementById('btnPrintPaymentV2').addEventListener('click', () => {
    const tb = document.getElementById('paymentModalV2TbBadge').textContent;
    const tableHtml = document.getElementById('paymentV2TableWrap').innerHTML;
    const warnHtml = document.getElementById('paymentV2WarnWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้าง V2 – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-amount { color:#00695c; }
  .pay-total-amount { color:#004d40; font-size:1.1rem; }
  .payment-total-row { background:#e0f2f1; }
  .pay-id-range { font-family: "Consolas", "SFMono-Regular", monospace; font-size:0.8rem; color:#2e7d32; word-break: break-all; }
  .payv2-detail-row.d-none { display: table-row !important; }
  .pay-id-cell .pay-id-clamp { max-height: none !important; }
  .payv2-id-scroll { max-height: none !important; overflow: visible !important; }
  .payv2-id-chip-wrap { display:flex; flex-wrap:wrap; gap:4px; }
  .payv2-id-chip { font-family:"Consolas","SFMono-Regular",monospace; font-size:0.72rem; background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; border-radius:5px; padding:1px 6px; text-decoration:none; }
  .payv2-plot-list { display:flex; flex-direction:column; gap:6px; max-height:none !important; overflow:visible !important; }
  .payv2-plot-card { display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px; background:#fff; border:1px solid #d3ede9; border-radius:8px; padding:8px 12px; font-size:0.82rem; }
  .payv2-plot-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .payv2-plot-calc { color:#37474f; flex:1 1 240px; line-height:1.7; }
  .payv2-plot-total { margin-left:auto; white-space:nowrap; color:#00695c; }
  .payv2-plot-card.is-multi { border-left:4px solid #f9a825; background:#fffbeb; }
  .payv2-bonus-chip { display:inline-block; font-size:0.74rem; background:#fff3cd; color:#8a6100; border:1px solid #ffe08a; border-radius:10px; padding:1px 8px; margin-left:2px; }
  .payv2-plot-search-bar { display:none !important; }
  .payv2-plot-card.d-none, .payv2-plot-card.batch-hidden { display:flex !important; }
  .payv2-plot-empty { display:none !important; }
  .payv2-loadmore-bar { display:none !important; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#00695c">สรุปค่าจ้างทีมงาน V2 (class_Area) – ${tb}</h4>
<p class="text-muted mb-3">วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<div class="mt-3">${warnHtml}</div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 5C – คำนวณค่าจ้าง V3 (เฉพาะยางพาราลงทะเบียน + พื้นที่กันออกทั้งหมด)

   ต่างจาก V2 ตรงที่ฐานพื้นที่คิดเงินไม่ได้ขึ้นกับว่าแปลงมีคลาสเดียวหรือหลายคลาส —
   ทุกแปลงนับเฉพาะพื้นที่คลาส 'rubber' (ยางพาราลงทะเบียน) และคลาสพื้นที่กันออกทุกชนิด (ex_*) เท่านั้น
   ตัด 'not-rubber' (ยางพาราไม่ลงทะเบียน) และ 'Other' (ไม่ใช่ยางพารา) ออกจากฐานคิดเงินเสมอ
   ส่วนโบนัสหลายคลาส/อัตรา นส.4-อื่นๆ/หน้าตาตาราง ใช้ pattern เดียวกับ V2 (ดู MODAL 5B ด้านบน)
   และใช้ popover ดูรูปแปลง/ตัวกรอง/thumbnail ชุดเดียวกับ V2 ร่วมกัน (payv2* ยูทิลิตี้ generic ไม่ผูกกับเวอร์ชัน)
═════════════════════════════════════════════════════════════ */

let paymentModalV3 = null;
let paymentV3WorkerData = [];
let paymentV3Warnings = [];
let paymentV3Tb = '';

function openPaymentModalV3(tb_name) {
    if (!paymentModalV3) {
        const modalEl = document.getElementById('paymentModalV3');
        paymentModalV3 = new bootstrap.Modal(modalEl);
        modalEl.addEventListener('hidden.bs.modal', closePayv2Preview);
        const bodyEl = modalEl.querySelector('.modal-body');
        if (bodyEl) bodyEl.addEventListener('scroll', closePayv2Preview);
    }
    paymentV3Tb = tb_name;
    document.getElementById('paymentModalV3TbBadge').textContent = tb_name;
    document.getElementById('paymentV3TableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    document.getElementById('paymentV3WarnWrap').innerHTML = '';
    paymentModalV3.show();

    fetch(`/rub/api/worker-summary-v3/${tb_name}`)
        .then(r => r.json())
        .then(({ data, warnings }) => {
            paymentV3WorkerData = data || [];
            paymentV3Warnings   = warnings || [];
            renderPaymentTableV3();
            renderWarningsV3();
        })
        .catch(() => {
            document.getElementById('paymentV3TableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

/* เหมือน showPayv2GroupIds แต่อ่านจาก paymentV3WorkerData/payv3_rate_bonus — ใช้กล่องป๊อปอัพรายการไอดี (ensurePayv2IdListEl)
   และชิปไอดี (payV2IdChips) ร่วมกับ V2 เพราะเป็นยูทิลิตี้ generic รับ tb เป็นพารามิเตอร์อยู่แล้ว */
function showPayv3GroupIds(evt, workerIdx, group) {
    evt.stopPropagation();
    const worker = paymentV3WorkerData[workerIdx];
    const g = worker && worker[group];
    const ids = (g && g.ids) || [];
    const el = ensurePayv2IdListEl();

    const rect = evt.currentTarget.getBoundingClientRect();
    const popW = 260;
    const left = Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - popW - 12);
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    el.classList.remove('d-none');
    el.querySelector('.payv2-idlist-title').textContent =
        `${PAYV2_GROUP_LABELS[group] || group} — ${ids.length.toLocaleString('th-TH')} แปลง`;
    el.querySelector('.payv2-idlist-body').innerHTML = ids.length
        ? payV2IdChips(ids, paymentV3Tb)
        : `<div class="text-muted small py-1">ไม่มีแปลง</div>`;

    const footerEl = el.querySelector('.payv2-idlist-footer');
    if (group === 'bonus' && ids.length > 0) {
        const rateBonus = parseFloat(document.getElementById('payv3_rate_bonus').value) || 0;
        const total = ids.length * rateBonus;
        footerEl.innerHTML = `${ids.length.toLocaleString('th-TH')} แปลง &times; ${rateBonus.toLocaleString('th-TH')} บาท/แปลง =
            <span class="fw-bold">${total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>`;
        footerEl.classList.remove('d-none');
    } else {
        footerEl.classList.add('d-none');
        footerEl.innerHTML = '';
    }
}

/* เหมือน buildPayV2DetailHtml ทุกประการ (ใช้การ์ดแปลง/ตัวกรอง/ปุ่มขยายเต็มจอชุดเดียวกัน เพราะ payV2PlotDetailCard และ
   ฟังก์ชันตัวกรองทั้งหมดเป็น generic รับพารามิเตอร์/ใช้ closest() ไม่ผูกกับเวอร์ชัน) ต่างกันแค่ datalist id ต้องแยก
   prefix เป็น payv3_ กันชนกับของ V2 เวลาทั้งสองตารางถูก render ค้างอยู่ใน DOM พร้อมกัน (คนละ modal) */
function buildPayV3DetailHtml(worker, rateNs4, rateOther, rateBonus, tb, idx) {
    const plots = worker.plots || [];
    const plotById = {};
    plots.forEach(p => { plotById[p.id] = p; });

    const entries = [];
    const deedTypesSeen = [];
    if (worker.ns4.plot_count > 0) deedTypesSeen.push('นส.4');
    worker.ns4.ids.forEach(id => {
        const p = plotById[id];
        if (p) entries.push({ p, badgeClass: 'bg-success', deedLabel: 'นส.4' });
    });
    Object.entries(worker.other.by_deed_type).forEach(([dt, d]) => {
        deedTypesSeen.push(dt);
        d.ids.forEach(id => {
            const p = plotById[id];
            if (p) entries.push({ p, badgeClass: 'bg-info text-dark', deedLabel: dt });
        });
    });

    if (entries.length === 0) {
        return `<div class="text-center text-muted py-2">ไม่มีรายการที่คิดค่าจ้างได้</div>`;
    }

    const cards = entries.map((e, i) =>
        payV2PlotDetailCard(e.p, e.badgeClass, e.deedLabel, rateNs4, rateOther, rateBonus, tb, i >= PAYV2_PLOT_BATCH, i + 1)
    );

    const fmt2 = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const grandTotal = entries.reduce((sum, e) => {
        const rate = e.p.is_ns4 ? rateNs4 : rateOther;
        const bonusPay = e.p.is_multi ? rateBonus : 0;
        return sum + (e.p.area_rai * rate) + bonusPay;
    }, 0);
    const multiBonusTotal = worker.bonus.plot_count * rateBonus;
    const summaryBannerHtml = `<i class="bi bi-cash-coin me-1"></i>
        รวมทั้งหมด ${entries.length.toLocaleString('th-TH')} แปลง = <span class="fw-bold">${fmt2(grandTotal)} บาท</span>
        <span class="payv2-summary-sep">|</span>
        หลายคลาส ${worker.bonus.plot_count.toLocaleString('th-TH')} แปลง (โบนัส <span class="fw-bold">${fmt2(multiBonusTotal)} บาท</span>)`;

    const rateLegendHtml = `<i class="bi bi-calculator me-1"></i>เรทที่ใช้คิด:
        <b>นส.4</b> ${rateNs4.toLocaleString('th-TH')} บาท/ไร่ &nbsp;&middot;&nbsp;
        <b>อื่นๆ</b> ${rateOther.toLocaleString('th-TH')} บาท/ไร่ &nbsp;&middot;&nbsp;
        <b>โบนัสหลายคลาส</b> ${rateBonus.toLocaleString('th-TH')} บาท/แปลง`;

    const multiByDeed = {};
    entries.forEach(e => {
        if (e.p.is_multi) multiByDeed[e.deedLabel] = (multiByDeed[e.deedLabel] || 0) + 1;
    });
    const multiTotal = Object.values(multiByDeed).reduce((a, b) => a + b, 0);
    const multiDeedItems = deedTypesSeen
        .filter(dt => (multiByDeed[dt] || 0) > 0)
        .map(dt => `<li><a class="dropdown-item payv2-multi-deed-item" href="#" data-deed="${dt}" onclick="selectPayv2MultiDeed(event, this)">
            ${dt} <span class="badge bg-light text-dark ms-1">${multiByDeed[dt].toLocaleString('th-TH')}</span>
        </a></li>`)
        .join('');

    const pureRubberByDeed = {};
    entries.forEach(e => {
        if (!e.p.is_multi) pureRubberByDeed[e.deedLabel] = (pureRubberByDeed[e.deedLabel] || 0) + 1;
    });
    const pureRubberTotal = Object.values(pureRubberByDeed).reduce((a, b) => a + b, 0);
    const rubberDeedItems = deedTypesSeen
        .filter(dt => (pureRubberByDeed[dt] || 0) > 0)
        .map(dt => `<li><a class="dropdown-item payv2-rubber-deed-item" href="#" data-deed="${dt}" onclick="selectPayv2RubberDeed(event, this)">
            ${dt} <span class="badge bg-light text-dark ms-1">${pureRubberByDeed[dt].toLocaleString('th-TH')}</span>
        </a></li>`)
        .join('');

    const datalistId = `payv3_deedtypes_${idx}`;
    const options = deedTypesSeen.map(dt => `<option value="${dt}">`).join('');
    const remaining = entries.length - PAYV2_PLOT_BATCH;
    const loadMoreBar = remaining > 0
        ? `<div class="payv2-loadmore-bar">
                <button type="button" class="btn btn-sm btn-outline-secondary payv2-loadmore-btn" onclick="payv2LoadMorePlots(this)">
                    <i class="bi bi-chevron-down me-1"></i>แสดงเพิ่ม ${Math.min(PAYV2_PLOT_BATCH, remaining).toLocaleString('th-TH')} รายการ (เหลืออีก ${remaining.toLocaleString('th-TH')})
                </button>
                <button type="button" class="btn btn-sm btn-link payv2-loadall-btn" onclick="payv2LoadAllPlots(this)">
                    แสดงทั้งหมด (${entries.length.toLocaleString('th-TH')} แปลง)
                </button>
           </div>`
        : '';

    return `
    <div class="payv2-plot-detail-wrap">
        <div class="payv2-plot-search-bar">
            <i class="bi bi-search text-muted"></i>
            <input type="text" class="form-control form-control-sm payv2-plot-search"
                placeholder="ค้นหาประเภทโฉนด / ไอดีแปลง / พิมพ์ &quot;หลายคลาส&quot;..." list="${datalistId}" oninput="filterPayv2Plots(this)">
            <datalist id="${datalistId}">${options}</datalist>
            <div class="btn-group payv2-multi-dropdown">
                <button type="button" class="btn btn-sm btn-outline-warning payv2-multi-toggle dropdown-toggle" data-deed=""
                    data-bs-toggle="dropdown" aria-expanded="false"
                    title="แสดงเฉพาะแปลงที่มีหลายคลาส (ได้โบนัส) เลือกแยกตามประเภทโฉนดได้">
                    <i class="bi bi-layers"></i> <span class="payv2-multi-toggle-label">หลายคลาสเท่านั้น</span>
                </button>
                <ul class="dropdown-menu payv2-multi-dropdown-menu">
                    <li><a class="dropdown-item payv2-multi-clear-item" href="#" onclick="selectPayv2MultiDeed(event, this)">
                        <i class="bi bi-x-circle me-1"></i>ไม่กรอง (ปิด)
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item payv2-multi-deed-item" href="#" data-deed="" onclick="selectPayv2MultiDeed(event, this)">
                        ทั้งหมด (ทุกประเภทโฉนด) <span class="badge bg-light text-dark ms-1">${multiTotal.toLocaleString('th-TH')}</span>
                    </a></li>
                    ${multiDeedItems}
                </ul>
            </div>
            <div class="btn-group payv2-rubber-dropdown">
                <button type="button" class="btn btn-sm btn-outline-success payv2-rubber-toggle dropdown-toggle" data-deed=""
                    data-bs-toggle="dropdown" aria-expanded="false"
                    title="แสดงเฉพาะแปลงคลาสเดียวที่เป็นยางพาราลงทะเบียนล้วน (ไม่ปนคลาสอื่น) เลือกแยกตามประเภทโฉนดได้">
                    <i class="bi bi-tree"></i> <span class="payv2-rubber-toggle-label">คลาสยางพาราลงทะเบียนเท่านั้น</span>
                </button>
                <ul class="dropdown-menu payv2-rubber-dropdown-menu">
                    <li><a class="dropdown-item payv2-rubber-clear-item" href="#" onclick="selectPayv2RubberDeed(event, this)">
                        <i class="bi bi-x-circle me-1"></i>ไม่กรอง (ปิด)
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item payv2-rubber-deed-item" href="#" data-deed="" onclick="selectPayv2RubberDeed(event, this)">
                        ทั้งหมด (ทุกประเภทโฉนด) <span class="badge bg-light text-dark ms-1">${pureRubberTotal.toLocaleString('th-TH')}</span>
                    </a></li>
                    ${rubberDeedItems}
                </ul>
            </div>
            ${worker.bonus.plot_count > 0 ? `
            <button type="button" class="btn btn-sm btn-outline-success" onclick="showPayv2BonusFullscreen(event)"
                title="ดูแปลงที่ได้โบนัสหลายคลาสแบบเต็มหน้าจอ พร้อมรูปและยอดรวม">
                <i class="bi bi-cash-coin"></i> สรุปโบนัส (${worker.bonus.plot_count.toLocaleString('th-TH')})
            </button>` : ''}
            <span class="payv2-plot-count-badge">${entries.length.toLocaleString('th-TH')} แปลง</span>
            <button type="button" class="btn btn-sm btn-outline-secondary payv2-fullscreen-toggle" onclick="togglePayv2Fullscreen(this)"
                title="ขยายเต็มหน้าจอ">
                <i class="bi bi-arrows-fullscreen"></i>
            </button>
        </div>
        <div class="payv2-rate-legend">${rateLegendHtml}</div>
        <div class="payv2-summary-banner">${summaryBannerHtml}</div>
        <div class="payv2-plot-list">${cards.join('')}</div>
        <div class="payv2-plot-empty d-none text-center text-muted py-2">ไม่พบแปลงที่ตรงกับคำค้นหา</div>
        ${loadMoreBar}
    </div>`;
}

function togglePayV3Detail(i) {
    const row = document.getElementById(`payv3_detail_${i}`);
    const icon = document.getElementById(`payv3_detail_icon_${i}`);
    if (!row) return;
    row.classList.toggle('d-none');
    if (icon) icon.classList.toggle('bi-chevron-down');
    if (icon) icon.classList.toggle('bi-chevron-up');
}

/* เหมือน renderPaymentTableV2 ทุกประการ ต่างกันแค่แหล่งข้อมูล/id ของธาตุ DOM ที่ผูกกับ V3 */
function renderPaymentTableV3() {
    payv2DestroyAllThumbMaps();
    const rateNs4   = parseFloat(document.getElementById('payv3_rate_ns4').value) || 0;
    const rateOther = parseFloat(document.getElementById('payv3_rate_other').value) || 0;
    const rateBonus = parseFloat(document.getElementById('payv3_rate_bonus').value) || 0;
    const wrap = document.getElementById('paymentV3TableWrap');
    const data = paymentV3WorkerData;

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลจำแนกพื้นที่ (class_Area) ที่มีผู้ทำงานใน table นี้
        </div>`;
        return;
    }

    const avatarOf = (r) => r.photo
        ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
            onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=EDE7F6&color=4527a0&rounded=true'">`
        : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.editor)}&background=EDE7F6&color=4527a0&rounded=true" class="pay-avatar">`;

    let gNs4Plot = 0, gNs4Area = 0, gNs4Pay = 0;
    let gOtherPlot = 0, gOtherArea = 0, gOtherPay = 0;
    let gBonusPlot = 0, gBonusPay = 0;
    let grandPay = 0;

    const rows = data.map((worker, i) => {
        const ns4Pay   = worker.ns4.area_rai   * rateNs4;
        const otherPay = worker.other.area_rai * rateOther;
        const bonusPay = worker.bonus.plot_count * rateBonus;
        const totalPay = ns4Pay + otherPay + bonusPay;

        gNs4Plot += worker.ns4.plot_count;     gNs4Area += worker.ns4.area_rai;     gNs4Pay += ns4Pay;
        gOtherPlot += worker.other.plot_count; gOtherArea += worker.other.area_rai; gOtherPay += otherPay;
        gBonusPlot += worker.bonus.plot_count; gBonusPay += bonusPay;
        grandPay += totalPay;

        const countCell = (count, group, unit) => count > 0
            ? `<span class="payv2-count-link" onclick="showPayv3GroupIds(event, ${i}, '${group}')" title="ดูรายการไอดี">${count.toLocaleString('th-TH')}${unit ? ' ' + unit : ''}</span>`
            : `${count.toLocaleString('th-TH')}${unit ? ' ' + unit : ''}`;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatarOf(worker)}
                    <span class="fw-bold">${worker.editor}</span>
                </div>
            </td>
            <td class="text-center align-middle">${countCell(worker.ns4.plot_count, 'ns4', 'แปลง')}<br><small class="text-muted">${worker.ns4.area_rai.toFixed(2)} ไร่</small></td>
            <td class="text-end align-middle">${ns4Pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">${countCell(worker.other.plot_count, 'other', 'แปลง')}<br><small class="text-muted">${worker.other.area_rai.toFixed(2)} ไร่</small></td>
            <td class="text-end align-middle">${otherPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">${countCell(worker.bonus.plot_count, 'bonus')}<br><small class="text-muted">แปลง</small></td>
            <td class="text-end align-middle">${bonusPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-end align-middle fw-bold pay-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
            <td class="text-center align-middle">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="payv3_detail_btn_${i}" onclick="togglePayV3Detail(${i})" title="ดูไอดีที่ทำ / ทุกประเภทโฉนด">
                    <i class="bi bi-chevron-down" id="payv3_detail_icon_${i}"></i>
                </button>
            </td>
        </tr>
        <tr id="payv3_detail_${i}" class="d-none payv2-detail-row">
            <td colspan="10">${buildPayV3DetailHtml(worker, rateNs4, rateOther, rateBonus, paymentV3Tb, i)}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead>
                <tr>
                    <th class="text-center align-middle" style="width:40px">#</th>
                    <th class="align-middle">ชื่อผู้ทำงาน</th>
                    <th class="text-center align-middle">นส.4<br><small class="fw-normal text-muted">แปลง / ไร่</small></th>
                    <th class="text-end align-middle">ค่าจ้าง นส.4</th>
                    <th class="text-center align-middle">อื่นๆ<br><small class="fw-normal text-muted">แปลง / ไร่</small></th>
                    <th class="text-end align-middle">ค่าจ้าง อื่นๆ</th>
                    <th class="text-center align-middle">โบนัสหลายคลาส<br><small class="fw-normal text-muted">แปลง</small></th>
                    <th class="text-end align-middle">ค่าจ้าง โบนัส</th>
                    <th class="text-end align-middle">รวมค่าจ้าง</th>
                    <th class="text-center align-middle" style="width:60px">รายละเอียด</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="2" class="fw-bold align-middle">รวมทั้งหมด</td>
                    <td class="text-center fw-bold align-middle">${gNs4Plot.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${gNs4Area.toFixed(2)} ไร่</small></td>
                    <td class="text-end fw-bold align-middle">${gNs4Pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-center fw-bold align-middle">${gOtherPlot.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${gOtherArea.toFixed(2)} ไร่</small></td>
                    <td class="text-end fw-bold align-middle">${gOtherPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-center fw-bold align-middle">${gBonusPlot.toLocaleString('th-TH')}<br><small class="text-muted">แปลง</small></td>
                    <td class="text-end fw-bold align-middle">${gBonusPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${grandPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

function renderWarningsV3() {
    const wrap = document.getElementById('paymentV3WarnWrap');
    if (!paymentV3Warnings || paymentV3Warnings.length === 0) {
        wrap.innerHTML = '';
        return;
    }
    const ids = paymentV3Warnings.map(w => w.id);
    const idText = compressIdRanges(ids);
    const rows = paymentV3Warnings.map(w => `
        <tr>
            <td><span class="payv2-id-chip" onclick="showParcelPreview(event,'${paymentV3Tb}',${w.id})" title="ดูรูปแปลง/คลาส id ${w.id} เพื่อตรวจสอบ">${w.id}</span></td>
            <td>${payv2ClassLabel(w.classtype)}</td>
            <td>${w.deed_type}</td>
            <td>${w.editor}</td>
        </tr>`).join('');

    wrap.innerHTML = `
        <div class="alert alert-warning mb-0 payv2-warn-wrap">
            <div class="fw-bold mb-1 d-flex align-items-start justify-content-between gap-2">
                <span><i class="bi bi-exclamation-triangle-fill me-1"></i>
                พบ ${paymentV3Warnings.length.toLocaleString('th-TH')} แปลง (id: ${idText}) ที่ไม่มีคลาสยางพาราลงทะเบียนหรือพื้นที่กันออกเลย (ไม่มีฐานไร่ให้คิดเรท) — ไม่ถูกนับในค่าจ้างข้างต้น กรุณาตรวจสอบ</span>
                <button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0 payv2-warn-fullscreen-toggle" onclick="togglePayv2WarnFullscreen(this)" title="ขยายเต็มหน้าจอ">
                    <i class="bi bi-arrows-fullscreen"></i>
                </button>
            </div>
            <div class="table-responsive payv2-warn-table-wrap" style="max-height:220px;overflow:auto;">
                <table class="table table-sm table-bordered mb-0 bg-white">
                    <thead><tr><th>ID</th><th>ประเภทคลาส</th><th>ประเภทโฉนด</th><th>ผู้ทำงาน</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

document.getElementById('btnCalcPayV3').addEventListener('click', renderPaymentTableV3);

document.getElementById('btnPrintPaymentV3').addEventListener('click', () => {
    const tb = document.getElementById('paymentModalV3TbBadge').textContent;
    const tableHtml = document.getElementById('paymentV3TableWrap').innerHTML;
    const warnHtml = document.getElementById('paymentV3WarnWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้าง V3 – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-amount { color:#4527a0; }
  .pay-total-amount { color:#311b92; font-size:1.1rem; }
  .payment-total-row { background:#ede7f6; }
  .pay-id-range { font-family: "Consolas", "SFMono-Regular", monospace; font-size:0.8rem; color:#2e7d32; word-break: break-all; }
  .payv2-detail-row.d-none { display: table-row !important; }
  .pay-id-cell .pay-id-clamp { max-height: none !important; }
  .payv2-id-scroll { max-height: none !important; overflow: visible !important; }
  .payv2-id-chip-wrap { display:flex; flex-wrap:wrap; gap:4px; }
  .payv2-id-chip { font-family:"Consolas","SFMono-Regular",monospace; font-size:0.72rem; background:#e8f5e9; color:#2e7d32; border:1px solid #a5d6a7; border-radius:5px; padding:1px 6px; text-decoration:none; }
  .payv2-plot-list { display:flex; flex-direction:column; gap:6px; max-height:none !important; overflow:visible !important; }
  .payv2-plot-card { display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px; background:#fff; border:1px solid #d1c4e9; border-radius:8px; padding:8px 12px; font-size:0.82rem; }
  .payv2-plot-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .payv2-plot-calc { color:#37474f; flex:1 1 240px; line-height:1.7; }
  .payv2-plot-total { margin-left:auto; white-space:nowrap; color:#4527a0; }
  .payv2-plot-card.is-multi { border-left:4px solid #f9a825; background:#fffbeb; }
  .payv2-bonus-chip { display:inline-block; font-size:0.74rem; background:#fff3cd; color:#8a6100; border:1px solid #ffe08a; border-radius:10px; padding:1px 8px; margin-left:2px; }
  .payv2-plot-search-bar { display:none !important; }
  .payv2-plot-card.d-none, .payv2-plot-card.batch-hidden { display:flex !important; }
  .payv2-plot-empty { display:none !important; }
  .payv2-loadmore-bar { display:none !important; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#4527a0">สรุปค่าจ้างทีมงาน V3 (class_Area) – ${tb}</h4>
<p class="text-muted mb-3">วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<div class="mt-3">${warnHtml}</div>
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ═════════════════════════════════════════════════════════════
   MODAL 6 – คำนวณค่าจ้างคนตรวจ (Checker Payment per Layer)
═════════════════════════════════════════════════════════════ */

let checkerPaymentModal = null;
let checkerWorkerData = [];

function openCheckerPaymentModal(tb_name) {
    if (!checkerPaymentModal) {
        checkerPaymentModal = new bootstrap.Modal(document.getElementById('checkerPaymentModal'));
    }
    document.getElementById('checkerPayModalTbBadge').textContent = tb_name;
    document.getElementById('checkerPayTableWrap').innerHTML = `
        <div class="text-center text-muted py-4">
            <div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดข้อมูล...
        </div>`;
    checkerPaymentModal.show();

    fetch(`/rub/api/checker-summary/${tb_name}`)
        .then(r => r.json())
        .then(({ data }) => {
            checkerWorkerData = data || [];
            renderCheckerPaymentTable();
        })
        .catch(() => {
            document.getElementById('checkerPayTableWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        });
}

function renderCheckerPaymentTable() {
    const rate = parseFloat(document.getElementById('chk_rate_rai').value) || 0;
    const unit = document.getElementById('chk_unit').value;
    const data = checkerWorkerData;
    const wrap = document.getElementById('checkerPayTableWrap');

    if (!data || data.length === 0) {
        wrap.innerHTML = `<div class="alert alert-warning">
            <i class="bi bi-exclamation-triangle me-2"></i>
            ยังไม่มีข้อมูลการตรวจใน table นี้
        </div>`;
        return;
    }

    const unitLabels = {
        plot:    'บาท/แปลง (ID)',
        subplot: 'บาท/รายการ (sub_id)'
    };

    const rows = data.map((r, i) => {
        let pay = 0;
        if (unit === 'plot')    pay = (r.farmer_count   || 0) * rate;
        if (unit === 'subplot') pay = (r.sub_plot_count || 0) * rate;

        const avatar = r.photo
            ? `<img src="${r.photo}" class="pay-avatar" referrerpolicy="no-referrer"
                onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.reviewer)}&background=e1f5fe&color=0277bd&rounded=true'">`
            : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(r.reviewer)}&background=e1f5fe&color=0277bd&rounded=true" class="pay-avatar">`;

        return `<tr>
            <td class="text-center align-middle">${i + 1}</td>
            <td class="align-middle">
                <div class="d-flex align-items-center gap-2">
                    ${avatar}
                    <span class="fw-bold">${r.reviewer}</span>
                </div>
            </td>
            <td class="align-middle${(r.ids || []).length > 10 ? ' pay-id-cell' : ''}">
                ${(() => {
                    const idText = compressIdRanges(r.ids || []);
                    const isLong = (r.ids || []).length > 10;
                    const idHtml = isLong
                        ? `<div class="pay-id-clamp"><div class="pay-id-range">ID: ${idText}</div></div>`
                        : `<div class="pay-id-range">ID: ${idText}</div>`;
                    return `${idHtml}
                        <div class="text-muted small">(${(r.farmer_count || 0).toLocaleString()} แปลง)
                        ${isLong ? '<button type="button" class="pay-id-toggle-btn ms-1" onclick="toggleIdCell(this)">ดูทั้งหมด</button>' : ''}
                        </div>`;
                })()}
            </td>
            <td class="text-end fw-bold align-middle pay-amount">${pay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
        </tr>`;
    }).join('');

    const totalSubplot = data.reduce((s, r) => s + (r.sub_plot_count || 0), 0);
    const totalPlot     = data.reduce((s, r) => s + (r.farmer_count   || 0), 0);

    let totalPay = 0;
    if (unit === 'plot')    totalPay = totalPlot    * rate;
    if (unit === 'subplot') totalPay = totalSubplot * rate;

    wrap.innerHTML = `
    <div class="table-responsive">
        <table class="table table-hover payment-table">
            <thead style="background:#e1f5fe !important;">
                <tr>
                    <th class="text-center align-middle" style="width:36px">#</th>
                    <th class="align-middle">ชื่อผู้ตรวจ</th>
                    <th class="align-middle">ID ที่ตรวจ</th>
                    <th class="text-end align-middle">ค่าตรวจ<br><small class="fw-normal text-muted">${unitLabels[unit]}</small></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="payment-total-row">
                    <td colspan="3" class="fw-bold align-middle">รวมทั้งหมด
                        <span class="ms-2 text-muted fw-normal small">${totalSubplot.toLocaleString()} รายการ / ${totalPlot.toLocaleString()} แปลง</span>
                    </td>
                    <td class="text-end fw-bold align-middle pay-total-amount">${totalPay.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</td>
                </tr>
            </tfoot>
        </table>
    </div>`;
}

document.getElementById('btnCalcChecker').addEventListener('click', renderCheckerPaymentTable);

document.getElementById('btnPrintChecker').addEventListener('click', () => {
    const tb   = document.getElementById('checkerPayModalTbBadge').textContent;
    const rate = document.getElementById('chk_rate_rai').value;
    const unit = document.getElementById('chk_unit').options[document.getElementById('chk_unit').selectedIndex].text;
    const tableHtml = document.getElementById('checkerPayTableWrap').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>สรุปค่าจ้างคนตรวจ – ${tb}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css">
<style>
  body { font-family: "Noto Sans Thai", sans-serif; padding: 20px; }
  .pay-avatar { width:28px; height:28px; border-radius:50%; object-fit:cover; }
  .pay-area-badge { font-size:0.85rem; font-weight:600; color:#01579b; }
  .pay-area-sub { font-size:0.72rem; color:#78909c; }
  .pay-amount { color:#01579b; }
  .pay-total-amount { color:#006064; font-size:1.1rem; }
  .payment-total-row { background:#e1f5fe !important; }
  .pay-id-clamp { max-height:none !important; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<h4 style="color:#01579b">สรุปค่าจ้างคนตรวจ – ${tb}</h4>
<p class="text-muted mb-3">อัตราค่าตรวจ: <strong>${rate} ${unit}</strong> &nbsp;|&nbsp; วันที่พิมพ์: ${new Date().toLocaleDateString('th-TH', {day:'2-digit',month:'long',year:'numeric'})}</p>
${tableHtml}
<script>window.onload=()=>window.print();<\/script>
</body></html>`);
    win.document.close();
});

/* ── Bootstrap DOMContentLoaded: auth check → role guard → init ── */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        if (!user) {
            alert('กรุณา Login ก่อนเข้าใช้งานหน้า Admin');
            window.location.href = '/rub/index.html';
            return;
        }

        if (user.role !== 'admin') {
            alert(`คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (Role: ${user.role || 'worker'})\nหน้านี้สำหรับ Admin เท่านั้น`);
            window.location.href = '/rub/index.html';
            return;
        }

        document.getElementById('chkLogin').value = 'true';
        document.getElementById('google-login-link').style.display = 'none';
        document.getElementById('profile-section').style.display = 'flex';
        const profileImg = document.getElementById('profile-image');
        profileImg.referrerPolicy = "no-referrer";
        profileImg.src = user.photo;
        profileImg.onerror = function() {
            this.onerror = null;
            this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=E9F5EC&color=2e7d32&rounded=true`;
        };
        document.getElementById('display-name').textContent = user.displayName;

        document.getElementById('logout-link').addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/rub/auth/logout');
                window.location.href = '/rub/index.html';
            } catch (err) {
                console.error('Logout failed:', err);
            }
        });

        await loadUsersCache();
        await initApp();
        await initUser();
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});