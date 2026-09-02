const REFRESH_MS = 15000;
let refreshTimer = null;
let lastData = null;

// การ auto-refresh จะรื้อ HTML ทั้งหมดทิ้งแล้วสร้างใหม่ทุกครั้ง (renderWorkerList) ทำให้ panel ที่เปิดค้างไว้ปิดตัวเองกลับไปเป็นค่าเริ่มต้น
// เก็บ id ของ panel ที่ผู้ใช้เปิดไว้ตอนนี้ แล้ว "เปิดคืน" ให้หลัง render ใหม่ทุกครั้ง — ต้องใช้ id ที่คงที่ (hash จากชื่อ/tb_name)
// ไม่ใช้ index ในลิสต์ เพราะลำดับอาจสลับได้เมื่อข้อมูลเปลี่ยน (เรียงตามจำนวนที่ยังไม่แก้)
const _openPanelIds = new Set();
document.addEventListener('shown.bs.collapse', (e) => { if (e.target?.id) _openPanelIds.add(e.target.id); });
document.addEventListener('hidden.bs.collapse', (e) => { if (e.target?.id) _openPanelIds.delete(e.target.id); });

function idHash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
}

// เปิด panel กลับตาม _openPanelIds หลังสร้าง HTML ใหม่เสร็จ — ใส่ class โดยตรง (ไม่เรียก bootstrap show()) กันไม่ให้มี animation กระพริบทุกรอบ refresh
function _restoreOpenPanels() {
    _openPanelIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el || !el.classList.contains('collapse')) return;
        el.classList.add('show');
        document.querySelectorAll(`[data-bs-target="#${id}"]`).forEach((trig) => trig.setAttribute('aria-expanded', 'true'));
    });
}

function fmtTs(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function avatarHtml(name, photo) {
    return photo
        ? `<img src="${photo}" referrerpolicy="no-referrer" class="wk-avatar" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E9F5EC&color=2e7d32&rounded=true';">`
        : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E9F5EC&color=2e7d32&rounded=true" class="wk-avatar">`;
}

function renderSummary(summary) {
    const wrap = document.getElementById('summaryCards');
    const cards = [
        { label: 'รายการที่ต้องแก้ไขทั้งหมด', value: summary.total_items, icon: 'bi-exclamation-triangle-fill', cls: 'wk-card-total' },
        { label: 'ยังไม่ได้แก้ไข', value: summary.total_not_fixed, icon: 'bi-hourglass-split', cls: 'wk-card-notfixed' },
        { label: 'แก้ไขแล้ว รอตรวจซ้ำ', value: summary.total_fixed_pending_review, icon: 'bi-arrow-repeat', cls: 'wk-card-pending' },
        { label: 'จำนวนคนที่เกี่ยวข้อง', value: summary.editor_count, icon: 'bi-people-fill', cls: 'wk-card-people' },
    ];
    wrap.innerHTML = cards.map(c => `
        <div class="col-6 col-md-3">
            <div class="wk-summary-card ${c.cls}">
                <i class="bi ${c.icon}"></i>
                <div class="wk-summary-value">${(c.value || 0).toLocaleString('th-TH')}</div>
                <div class="wk-summary-label">${c.label}</div>
            </div>
        </div>
    `).join('');
}

function renderItemRow(item, tb) {
    const statusBadge = item.fixed_pending_review
        ? `<span class="badge wk-badge-pending"><i class="bi bi-arrow-repeat me-1"></i>แก้แล้ว รอตรวจซ้ำ</span>`
        : `<span class="badge wk-badge-notfixed"><i class="bi bi-hourglass-split me-1"></i>ยังไม่ได้แก้ไข</span>`;

    const checkBadges = [
        item.check_area === 'ไม่ผ่าน' ? `<span class="badge wk-badge-fail me-1">ตรวจสอบโฉนดไม่ผ่าน</span>` : '',
        item.check_shape === 'ไม่ผ่าน' ? `<span class="badge wk-badge-fail me-1">ตรวจสอบการจำแนกประเภทไม่ผ่าน</span>` : ''
    ].join('');

    return `
        <tr>
            <td>${esc(item.id)}${item.sub_id ? `<div class="small text-muted">sub: ${esc(item.sub_id)}</div>` : ''}</td>
            <td>${esc(item.farm_name) || '<span class="text-muted">-</span>'}</td>
            <td>${checkBadges}</td>
            <td>${item.remark ? esc(item.remark) : '<span class="text-muted">-</span>'}</td>
            <td class="small text-muted">${esc(item.reviewer) || '-'}<br>${fmtTs(item.review_ts)}</td>
            <td>${statusBadge}</td>
        </tr>
    `;
}

function renderProjectBlock(editorKey, proj) {
    const collapseId = `proj_${idHash(editorKey + '|' + proj.tb_name)}`;
    return `
        <div class="wk-project-block">
            <div class="wk-project-head" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-folder-fill text-warning"></i>
                    <strong>${esc(proj.tb_name)}</strong>
                    ${proj.not_fixed ? `<span class="badge wk-badge-notfixed">${proj.not_fixed} ยังไม่แก้</span>` : ''}
                    ${proj.fixed_pending_review ? `<span class="badge wk-badge-pending">${proj.fixed_pending_review} รอตรวจซ้ำ</span>` : ''}
                </div>
                <div class="d-flex align-items-center gap-2">
                    <a href="../reclassdash/index.html?tb=${encodeURIComponent(proj.tb_name)}&filter=fail"
                       class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation();">
                        <i class="bi bi-box-arrow-up-right me-1"></i>ไปดู/แก้ไข
                    </a>
                    <i class="bi bi-chevron-down"></i>
                </div>
            </div>
            <div class="collapse" id="${collapseId}">
                <div class="table-responsive">
                    <table class="table table-sm table-hover align-middle mb-0 wk-item-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>เจ้าของแปลง</th>
                                <th>สถานะตรวจ</th>
                                <th>หมายเหตุแอดมิน</th>
                                <th>ผู้ตรวจ / เมื่อ</th>
                                <th>สถานะแก้ไข</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${proj.items.map(it => renderItemRow(it, proj.tb_name)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderWorkerCard(worker) {
    const editorKey = worker.editor;
    const collapseId = `worker_${idHash(editorKey)}`;
    return `
        <div class="wk-worker-card">
            <div class="wk-worker-head" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <div class="d-flex align-items-center gap-2">
                    ${avatarHtml(worker.editor, worker.photo)}
                    <div>
                        <div class="fw-bold">${esc(worker.editor)}</div>
                        <div class="small text-muted">${worker.projects.length} โปรเจคที่มีงานต้องแก้ไข</div>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    ${worker.total_not_fixed ? `<span class="badge wk-badge-notfixed">${worker.total_not_fixed} ยังไม่แก้</span>` : ''}
                    ${worker.total_fixed_pending_review ? `<span class="badge wk-badge-pending">${worker.total_fixed_pending_review} รอตรวจซ้ำ</span>` : ''}
                    <i class="bi bi-chevron-down"></i>
                </div>
            </div>
            <div class="collapse" id="${collapseId}">
                <div class="wk-worker-body">
                    ${worker.projects.map((p) => renderProjectBlock(editorKey, p)).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderWorkerList(data) {
    const wrap = document.getElementById('workerListWrap');
    if (!data || data.length === 0) {
        wrap.innerHTML = `
            <div class="alert alert-success border-0 shadow-sm">
                <i class="bi bi-check-circle-fill me-2"></i>ไม่มีแปลงที่ต้องแก้ไขในตอนนี้ ทุกคนผ่านหมดแล้ว 🎉
            </div>`;
        return;
    }
    wrap.innerHTML = data.map((w) => renderWorkerCard(w)).join('');
    _restoreOpenPanels();
}

async function loadNeedsFixAll(isAuto) {
    try {
        const res = await fetch('/rub/api/needs-fix-all');
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'load failed');
        lastData = result;
        renderSummary(result.summary || {});
        renderWorkerList(result.data || []);
        document.getElementById('lastUpdated').textContent =
            'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        console.error('loadNeedsFixAll error:', e);
        if (!isAuto) {
            document.getElementById('workerListWrap').innerHTML =
                '<div class="alert alert-danger">โหลดข้อมูลไม่สำเร็จ</div>';
        }
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        if (!document.getElementById('autoRefreshToggle').checked) return;
        loadNeedsFixAll(true);
    }, REFRESH_MS);
}

function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

document.getElementById('btnRefreshNow').addEventListener('click', () => loadNeedsFixAll(false));

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();

        if (!user) {
            alert('กรุณา Login ก่อนเข้าใช้งานหน้านี้');
            window.location.href = '/rub/index.html';
            return;
        }

        document.getElementById('chkLogin').value = 'true';
        document.getElementById('google-login-link').style.display = 'none';
        document.getElementById('profile-section').style.display = 'flex';
        const profileImg = document.getElementById('profile-image');
        profileImg.referrerPolicy = "no-referrer";
        profileImg.src = user.photo;
        profileImg.onerror = function () {
            this.onerror = null;
            this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=E9F5EC&color=2e7d32&rounded=true`;
        };
        document.getElementById('display-name').textContent = user.displayName;

        document.getElementById('logout-link').addEventListener('click', async (e) => {
            e.preventDefault();
            try { await fetch('/rub/auth/logout'); window.location.reload(); }
            catch (err) { console.error('Logout failed:', err); }
        });
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }

    await loadNeedsFixAll(false);
    startAutoRefresh();
});
