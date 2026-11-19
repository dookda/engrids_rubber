// โหมด "โครงการแก้ไข" (layerlist.kind = 'edit') — ใช้ในหน้า reclass / reclassdash
// โครงการแก้ไขใช้แค่ ยางพาราที่ลงทะเบียน + พื้นที่กันออกทั้งหมด
// ทุกอย่างที่ไม่ใช่ยาง/กันออก (ยางไม่ลงทะเบียน / ไม่ใช่ยาง / ยังไม่จำแนก) แสดงรวมเป็น "อื่นๆ" สีแดง
// เพราะโครงการแก้ไขสนใจแค่ ยางพาราลงทะเบียน + พื้นที่กันออก
// โครงการหลักไม่เปลี่ยนอะไร (ทุกฟังก์ชันคืนค่าเดิมเมื่อไม่ใช่โครงการแก้ไข)
(function () {
    const OTHER_COLOR = '#e53935';
    const OTHER_LABEL = 'อื่นๆ';
    const MAIN = [
        ['rubber', 'ยางพาราที่ลงทะเบียน'],
        ['ex_age_rubber', 'พื้นที่กันออก (ยางพาราต่างอายุ)'],
        ['ex_building', 'พื้นที่กันออก (สิ่งปลูกสร้าง)'],
        ['ex_pond', 'พื้นที่กันออก (บ่อน้ำ)'],
        ['ex_cr_area', 'พื้นที่กันออก (ถนนคอนกรีต)'],
        ['ex_ar_area', 'พื้นที่กันออก (ถนนลาดยาง)'],
        ['ex_other', 'พื้นที่กันออก (เพิ่มเติม)'],
    ];
    const isMain = (ct) => ct === 'rubber' || (typeof ct === 'string' && ct.startsWith('ex_'));

    const api = {
        active: false,
        MAIN,
        OTHER_COLOR,
        OTHER_LABEL,
        isMain,
        // ป้ายคลาส: โครงการแก้ไข + ไม่ใช่ยาง/กันออก (รวมยังไม่จำแนก) → "อื่นๆ"
        label: (ct, normal) => (api.active && !isMain(ct)) ? OTHER_LABEL : normal,
        // สีคลาส: โครงการแก้ไข + ไม่ใช่ยาง/กันออก (รวมยังไม่จำแนก) → แดง
        color: (ct, normal) => (api.active && !isMain(ct)) ? OTHER_COLOR : normal,
    };
    window.RU_EDIT = api;

    const tb = (new URLSearchParams(location.search).get('tb') || '').toLowerCase();
    window.RU_EDIT.ready = (async () => {
        if (!tb) return false;
        try {
            const list = await (await fetch('/rub/api/layerlist')).json();
            const row = Array.isArray(list) ? list.find(r => String(r.tb_name).toLowerCase() === tb) : null;
            api.active = row?.kind === 'edit';
        } catch (_) { api.active = false; }
        if (api.active) {
            document.documentElement.classList.add('ru-edit-project');
            const badge = document.createElement('div');
            badge.className = 'ru-edit-flag';
            badge.innerHTML = '<i class="bi bi-pencil-fill"></i> โครงการแก้ไข';
            badge.title = 'ใช้เฉพาะ ยางพาราที่ลงทะเบียน + พื้นที่กันออก — คลาสอื่นแสดงเป็น "อื่นๆ" สีแดง';
            const place = () => document.body.appendChild(badge);
            document.body ? place() : document.addEventListener('DOMContentLoaded', place);
        }
        return api.active;
    })();

    const style = document.createElement('style');
    style.textContent = `
        .ru-edit-flag{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:3000;
            background:linear-gradient(135deg,#fb8c00,#e65100);color:#fff;font-size:.78rem;font-weight:700;
            padding:4px 14px;border-radius:999px;box-shadow:0 2px 10px rgba(230,81,0,.35);pointer-events:none;
            font-family:"Noto Sans Thai",sans-serif}`;
    document.head.appendChild(style);
})();
