// หน้า reshape: ปุ่ม "แก้ไขคลาสเดิม" + กันคลาสหายจากปุ่ม "Classify แปลงที่นี้"
//
// ปุ่ม Classify เดิมเรียก /api/create_reclass_feature ซึ่ง "ลบคลาสทั้งหมดของแปลง" แล้วเริ่มเป็นแปลงเปล่า
// แปลงที่มีคลาสอยู่แล้ว (เช่น นำเข้าจากไฟล์ผ่านปุ่ม "แก้ไขคลาส") จึงต้อง:
//   • มีปุ่ม "แก้ไขคลาสเดิม" เปิดหน้า Reclass ต่อจากของเดิม โดยไม่ลบอะไร
//   • เตือนก่อนกด Classify ว่าคลาสเดิมจะถูกลบ
(function () {
    const idEl = document.getElementById('id');
    const tbEl = document.getElementById('tb');
    const classifyBtn = document.getElementById('classify');
    if (!idEl || !tbEl || !classifyBtn) return;

    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-success';
    btn.id = 'editExistingClass';
    btn.style.display = 'none';
    btn.innerHTML = '<i class="bi bi-palette"></i> แก้ไขคลาสเดิม';
    classifyBtn.insertAdjacentElement('afterend', btn);

    let status = null;          // สถานะคลาสของแปลงที่เลือกอยู่
    let lastKey = '';
    let reqSeq = 0;

    const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ID ถูกเติมจากหลายจุดใน app.js (คลิกแผนที่ / ค้นหา / ตาราง) โดยไม่ยิง event — จึงเช็คค่าเป็นระยะ
    async function refresh() {
        const id = idEl.value.trim();
        const tb = tbEl.value.trim();
        const key = `${tb}|${id}`;
        if (key === lastKey) return;
        lastKey = key;
        status = null;
        btn.style.display = 'none';
        if (!id || !tb) return;
        const seq = ++reqSeq;
        try {
            const r = await fetch(`/rub/api/reclass-status/${encodeURIComponent(tb)}/${encodeURIComponent(id)}`);
            const d = await r.json();
            if (seq !== reqSeq || !r.ok) return;   // ผู้ใช้เปลี่ยนแปลงไปแล้ว หรือ error
            status = d;
            if (d.classified > 0) {
                btn.style.display = '';
                btn.innerHTML = `<i class="bi bi-palette"></i> แก้ไขคลาสเดิม <span class="badge bg-success">${d.classified}</span>`;
                btn.title = `ยางลงทะเบียน ${fmt(d.rubber)} ไร่ · พื้นที่กันออก ${fmt(d.ex)} ไร่ — เปิดหน้า Reclass ต่อจากคลาสเดิม (ไม่ลบ)`;
            }
        } catch (_) { /* เงียบไว้ — ปุ่มเดิมยังใช้ได้ */ }
    }
    setInterval(refresh, 400);
    refresh();

    function reclassUrl() {
        const p = new URLSearchParams(location.search);
        const rubrSqm = document.getElementById('Rubr_Sqm')?.value || '';
        let url = `/rub/reclass/index.html?tb=${encodeURIComponent(tbEl.value)}&id=${encodeURIComponent(idEl.value)}&Rubr_Sqm=${encodeURIComponent(rubrSqm)}`;
        if (p.get('id_from') && p.get('id_to') && p.get('assignee')) {
            url += `&id_from=${p.get('id_from')}&id_to=${p.get('id_to')}&assignee=${encodeURIComponent(p.get('assignee'))}`;
        }
        return url;
    }

    btn.addEventListener('click', () => {
        if (!idEl.value) { alert('เลือกแปลงก่อน'); return; }
        window.location.href = reclassUrl();
    });

    // capture บน document → ทำงานก่อน handler ของปุ่ม Classify ใน app.js
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#classify')) return;
        if (!status || status.classified === 0) return;
        const ok = confirm(
            `แปลงนี้มีคลาสอยู่แล้ว ${status.classified} polygon ` +
            `(ยางลงทะเบียน ${fmt(status.rubber)} ไร่, พื้นที่กันออก ${fmt(status.ex)} ไร่)\n\n` +
            `“Classify แปลงที่นี้” จะลบคลาสเดิมทั้งหมดแล้วเริ่มใหม่จากแปลงเปล่า\n\n` +
            `OK = ลบคลาสเดิมแล้วเริ่มใหม่\nCancel = ยกเลิก (ใช้ปุ่ม “แก้ไขคลาสเดิม” เพื่อแก้ต่อจากของเดิม)`);
        if (!ok) { e.preventDefault(); e.stopImmediatePropagation(); }
        else lastKey = '';  // คลาสถูกล้างแล้ว ให้เช็คสถานะใหม่
    }, true);
})();
