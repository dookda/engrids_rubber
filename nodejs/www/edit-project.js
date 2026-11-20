// โหมด "โครงการแก้ไข" (layerlist.kind = 'edit') — ใช้ในหน้า reclass / reclassdash
// คลาสที่ใช้ได้: ยางพาราที่ลงทะเบียน, พื้นที่กันออกทั้งหมด, ยางพาราที่ไม่ได้ลงทะเบียน, ไม่ใช่ยางพารา (สีเดิม)
// "อื่นๆ" (น้ำเงินเข้มลายทแยง) = ส่วนที่ยังไม่จำแนกจากไฟล์ที่นำเข้า — ถูกล็อก (หรือประเภทที่ไม่รู้จัก)
// "ยังไม่ได้คลาส" (ส้มอ่อน) = polygon ใหม่ที่ยังไม่ได้เลือกประเภท (ชิ้นที่เพิ่งตัด / หลังคืนแปลงเดิม) — แก้ได้
// เป้าหมายนับแค่ ยางพาราที่ลงทะเบียน + พื้นที่กันออก (ยางไม่ลงทะเบียน / ไม่ใช่ยาง / อื่นๆ / ยังไม่ได้คลาส ไม่นับ)
// โครงการหลักไม่เปลี่ยนอะไร (ทุกฟังก์ชันคืนค่าเดิมเมื่อไม่ใช่โครงการแก้ไข)
(function () {
    const OTHER_COLOR = '#0d47a1';
    const OTHER_LABEL = 'อื่นๆ';
    const PENDING_COLOR = '#ffcc80';
    const PENDING_LABEL = 'ยังไม่ได้คลาส';
    const MAIN = [
        ['rubber', 'ยางพาราที่ลงทะเบียน'],
        ['ex_age_rubber', 'พื้นที่กันออก (ยางพาราต่างอายุ)'],
        ['ex_building', 'พื้นที่กันออก (สิ่งปลูกสร้าง)'],
        ['ex_pond', 'พื้นที่กันออก (บ่อน้ำ)'],
        ['ex_cr_area', 'พื้นที่กันออก (ถนนคอนกรีต)'],
        ['ex_ar_area', 'พื้นที่กันออก (ถนนลาดยาง)'],
        ['ex_other', 'พื้นที่กันออก (เพิ่มเติม)'],
    ];
    // คลาสที่เลือกได้แต่ไม่นับเข้าเป้า
    const EXTRA = [
        ['not-rubber', 'ยางพาราที่ไม่ได้ลงทะเบียน'],
        ['Other', 'ไม่ใช่ยางพารา'],
    ];
    const isMain = (ct) => ct === 'rubber' || (typeof ct === 'string' && ct.startsWith('ex_'));
    const isKnown = (ct) => isMain(ct) || EXTRA.some(([c]) => c === ct);
    const isEmpty = (ct) => ct === null || ct === undefined || String(ct).trim() === '';
    // ยังไม่ได้คลาส = ประเภทว่างและไม่ล็อก
    const isPending = (ct, locked) => isEmpty(ct) && !locked;

    const api = {
        active: false,
        MAIN,
        EXTRA,
        OTHER_COLOR,
        OTHER_LABEL,
        PENDING_COLOR,
        PENDING_LABEL,
        isMain,
        isKnown,
        isPending,
        // ป้ายคลาส (โครงการแก้ไข): ว่าง+ไม่ล็อก → "ยังไม่ได้คลาส", ล็อก/ไม่รู้จัก → "อื่นๆ"
        label: (ct, normal, locked) => {
            if (!api.active || isKnown(ct)) return normal;
            return isPending(ct, locked) ? PENDING_LABEL : OTHER_LABEL;
        },
        // สีคลาส (โครงการแก้ไข): ยังไม่ได้คลาส = ส้มอ่อน, อื่นๆ = น้ำเงินเข้ม
        color: (ct, normal, locked) => {
            if (!api.active || isKnown(ct)) return normal;
            return isPending(ct, locked) ? PENDING_COLOR : OTHER_COLOR;
        },
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
            badge.title = 'เป้าหมายนับ ยางพาราที่ลงทะเบียน + พื้นที่กันออก — "อื่นๆ" (ยังไม่จำแนก) ถูกล็อก';
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
