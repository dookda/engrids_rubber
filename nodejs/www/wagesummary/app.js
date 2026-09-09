/* ── 2 วิธีคิดค่าจ้าง แยกอิสระจากกันโดยสิ้นเชิง (คนละ endpoint, คนละชุดข้อมูล, คนละ rate/summary/list ในหน้าเว็บ) ──
   v1: "คำนวณค่าจ้าง" ของเดิม (Rubr_total ข้อมูลดิบ ไม่มีโบนัส)
   v3: "คำนวณค่าจ้าง V3" (class_Area เฉพาะยางลงทะเบียน+พื้นที่กันออก มีโบนัสหลายคลาส)
   ทั้งสองฝั่งใช้โครงสร้างโค้ดร่วมกันได้ (ฟังก์ชัน generic รับ method เป็นพารามิเตอร์) แต่ผลคำนวณ/ข้อมูลไม่ปนกันเด็ดขาด */
const METHODS = {
    v1: {
        endpoint: '/rub/api/wage-summary-v1-all',
        hasBonus: false,
        rateIds: { ns4: 'ws_rate_ns4_v1', other: 'ws_rate_other_v1' },
        summaryElId: 'summaryCardsV1',
        listElId: 'wageListWrapV1',
        avatarBg: 'FDEBD0', avatarColor: 'a15c00'
    },
    v3: {
        endpoint: '/rub/api/wage-summary-v3-all',
        hasBonus: true,
        rateIds: { ns4: 'ws_rate_ns4_v3', other: 'ws_rate_other_v3', bonus: 'ws_rate_bonus_v3' },
        summaryElId: 'summaryCardsV3',
        listElId: 'wageListWrapV3',
        avatarBg: 'EDE7F6', avatarColor: '4527a0'
    }
};

const wageData = { v1: [], v3: [] };

const _openPanelIds = new Set();
document.addEventListener('shown.bs.collapse', (e) => { if (e.target?.id) _openPanelIds.add(e.target.id); });
document.addEventListener('hidden.bs.collapse', (e) => { if (e.target?.id) _openPanelIds.delete(e.target.id); });

function idHash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
}

function _restoreOpenPanels() {
    _openPanelIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el || !el.classList.contains('collapse')) return;
        el.classList.add('show');
        document.querySelectorAll(`[data-bs-target="#${id}"]`).forEach((trig) => trig.setAttribute('aria-expanded', 'true'));
    });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNum(n, digits) {
    return (n || 0).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function avatarHtml(name, photo, bg, color) {
    return photo
        ? `<img src="${photo}" referrerpolicy="no-referrer" class="ws-avatar" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=${color}&rounded=true';">`
        : `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=${color}&rounded=true" class="ws-avatar">`;
}

function getRates(method) {
    const cfg = METHODS[method];
    return {
        ns4: parseFloat(document.getElementById(cfg.rateIds.ns4).value) || 0,
        other: parseFloat(document.getElementById(cfg.rateIds.other).value) || 0,
        bonus: cfg.hasBonus ? (parseFloat(document.getElementById(cfg.rateIds.bonus).value) || 0) : 0
    };
}

function payOf(group, rates) {
    const bonusPlots = group.bonus ? group.bonus.plot_count : 0;
    return group.ns4.area_rai * rates.ns4 + group.other.area_rai * rates.other + bonusPlots * rates.bonus;
}

function renderSummary(method, rates) {
    const cfg = METHODS[method];
    const data = wageData[method];
    const wrap = document.getElementById(cfg.summaryElId);
    let totalNs4Area = 0, totalOtherArea = 0, totalBonusPlots = 0, grandPay = 0;
    data.forEach(e => {
        totalNs4Area += e.ns4.area_rai;
        totalOtherArea += e.other.area_rai;
        if (e.bonus) totalBonusPlots += e.bonus.plot_count;
        grandPay += payOf(e, rates);
    });

    const cards = [
        { label: 'จำนวนคน', value: data.length.toLocaleString('th-TH'), icon: 'bi-people-fill', cls: 'ws-card-people' },
        { label: 'พื้นที่รวม', value: fmtNum(totalNs4Area + totalOtherArea, 2) + ' ไร่', icon: 'bi-map-fill', cls: 'ws-card-area' },
    ];
    if (cfg.hasBonus) {
        cards.push({ label: 'แปลงได้โบนัส', value: totalBonusPlots.toLocaleString('th-TH') + ' แปลง', icon: 'bi-layers-fill', cls: 'ws-card-bonus' });
    }
    cards.push({ label: 'ค่าจ้างรวม', value: fmtNum(grandPay, 2) + ' บาท', icon: 'bi-cash-stack', cls: 'ws-card-total' });

    wrap.innerHTML = cards.map(c => `
        <div class="col-6">
            <div class="ws-summary-card ${c.cls}">
                <i class="bi ${c.icon}"></i>
                <div class="ws-summary-value">${c.value}</div>
                <div class="ws-summary-label">${c.label}</div>
            </div>
        </div>
    `).join('');
}

function renderProjectRow(cfg, p, rates) {
    const pay = payOf(p, rates);
    return `
        <tr>
            <td>${esc(p.tb_name)}</td>
            <td class="text-center">${p.ns4.plot_count.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${fmtNum(p.ns4.area_rai, 2)} ไร่</small></td>
            <td class="text-center">${p.other.plot_count.toLocaleString('th-TH')} แปลง<br><small class="text-muted">${fmtNum(p.other.area_rai, 2)} ไร่</small></td>
            ${cfg.hasBonus ? `<td class="text-center">${p.bonus.plot_count.toLocaleString('th-TH')} แปลง</td>` : ''}
            <td class="text-end fw-bold">${fmtNum(pay, 2)} บาท</td>
        </tr>
    `;
}

function renderEditorCard(method, cfg, e, i, rates) {
    const collapseId = `wage_${method}_${idHash(e.editor)}`;
    const totalPay = payOf(e, rates);
    const metaParts = [`นส.4 ${fmtNum(e.ns4.area_rai, 2)} ไร่`, `อื่นๆ ${fmtNum(e.other.area_rai, 2)} ไร่`];
    if (cfg.hasBonus) metaParts.push(`โบนัส ${e.bonus.plot_count.toLocaleString('th-TH')} แปลง`);

    return `
        <div class="ws-editor-card">
            <div class="ws-editor-head" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                <div class="d-flex align-items-center gap-2">
                    <span class="ws-rank">${i + 1}</span>
                    ${avatarHtml(e.editor, e.photo, cfg.avatarBg, cfg.avatarColor)}
                    <div>
                        <div class="fw-bold">${esc(e.editor)}</div>
                        <div class="small text-muted">${metaParts.join(' &middot; ')}</div>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="ws-total-pay ws-total-pay-${method}">${fmtNum(totalPay, 2)} บาท</span>
                    <i class="bi bi-chevron-down"></i>
                </div>
            </div>
            <div class="collapse" id="${collapseId}">
                <div class="ws-editor-body">
                    <div class="table-responsive">
                        <table class="table table-sm table-hover align-middle mb-0 ws-project-table">
                            <thead>
                                <tr>
                                    <th>โปรเจค</th>
                                    <th class="text-center">นส.4</th>
                                    <th class="text-center">อื่นๆ</th>
                                    ${cfg.hasBonus ? '<th class="text-center">โบนัส</th>' : ''}
                                    <th class="text-end">ค่าจ้างรวม</th>
                                </tr>
                            </thead>
                            <tbody>${e.projects.map(p => renderProjectRow(cfg, p, rates)).join('')}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderWageList(method) {
    const cfg = METHODS[method];
    const rates = getRates(method);
    renderSummary(method, rates);

    const wrap = document.getElementById(cfg.listElId);
    const data = wageData[method];
    if (!data || data.length === 0) {
        wrap.innerHTML = `
            <div class="alert alert-secondary border-0 shadow-sm mb-0">
                <i class="bi bi-info-circle me-2"></i>ยังไม่มีข้อมูลที่มีผู้ทำงานในโปรเจคใดเลย
            </div>`;
        return;
    }

    const sorted = [...data].sort((a, b) => payOf(b, rates) - payOf(a, rates));
    wrap.innerHTML = sorted.map((e, i) => renderEditorCard(method, cfg, e, i, rates)).join('');
    _restoreOpenPanels();
}

async function loadMethod(method, isAuto) {
    const cfg = METHODS[method];
    try {
        const res = await fetch(cfg.endpoint);
        const result = await res.json();
        if (!result.success) throw new Error(result.error || 'load failed');
        wageData[method] = result.data || [];
        renderWageList(method);
    } catch (e) {
        console.error(`loadMethod(${method}) error:`, e);
        if (!isAuto) {
            document.getElementById(cfg.listElId).innerHTML =
                '<div class="alert alert-danger mb-0">โหลดข้อมูลไม่สำเร็จ</div>';
        }
    }
}

async function loadAll(isAuto) {
    await Promise.all([loadMethod('v1', isAuto), loadMethod('v3', isAuto)]);
    document.getElementById('lastUpdated').textContent =
        'อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

document.getElementById('btnRefreshNow').addEventListener('click', () => loadAll(false));
document.getElementById('btnCalcWageV1').addEventListener('click', () => renderWageList('v1'));
document.getElementById('btnCalcWageV3').addEventListener('click', () => renderWageList('v3'));

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
            this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=EDE7F6&color=4527a0&rounded=true`;
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

    await loadAll(false);
});
