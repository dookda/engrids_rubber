// ── Global state ──
let _panelUserDirty = false;
let _autoSavingUserRemark = false;
let _activeFilter = '';
let _activeTopoFilter = '';
let _panelCheckerDirty = false;
const _checkerDraft = {};   // { [sub_id]: { check_area, check_shape, remark } }
let _userRole = null;
let _workerStatusFilter = 'unchecked';
let _adminNavFilter = 'all';
let _idStatusCache = {};      // id -> 'none'|'pass'|'fail'|'unclassified' (refreshed by updateAdminStatusCounts)
let _idTopoStatusCache = {};  // id -> 'overlap'|'ok' (refreshed by updateTopologyStatusCounts)
let _highlightedLayers = [];
let _currentReviewId = null;
let _focusedLayer = null;      // { layer, originalStyle } — currently zoomed-to polygon
let _focusedSubId = null;

// ── Annotate image modal state (checker: capture + mark up a screenshot) ──
let _annotateBaseImage = null;   // HTMLImageElement currently loaded into the canvas
let _annotateStrokes = [];       // [{ color, width, points:[{x,y}] }]
let _annotateCurrentStroke = null;
let _annotateDrawing = false;
let _annotateColor = '#ff1744';
let _annotateBrushSize = 4;
let _annotateTexts = [];         // [{ text, x, y, color, fontSize }] — ลากย้ายตำแหน่งได้, ยาวเกินจะตัดบรรทัดอัตโนมัติ
let _annotateActions = [];       // ลำดับการสร้าง stroke/text ใหม่ ใช้สำหรับปุ่มย้อนกลับ
let _annotateDraggingText = null;
let _annotateDragOffset = { x: 0, y: 0 };
let _annotateTextSize = 26;      // ขนาดตัวอักษรปัจจุบัน ปรับได้จากแถบเลื่อน
const ANNOTATE_TEXT_PADDING = 6;
const ANNOTATE_TEXT_LINE_HEIGHT_RATIO = 1.25;

// Returns unique parent IDs filtered by current _workerStatusFilter (group-level status)
const _getWorkerNavIds = (allRows) => {
    const _isPass = r => r.check_area === 'ผ่าน' && r.check_shape === 'ผ่าน';
    const _isFail = r => r.check_area === 'ไม่ผ่าน' || r.check_shape === 'ไม่ผ่าน';
    const _isClassified = r => !!(r.classtype && String(r.classtype).trim());
    const grouped = {};
    allRows.forEach(r => {
        const key = String(r.id);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });
    // กลุ่มที่ยังไม่มีแปลงไหนจำแนกประเภทเลย ยังไม่ถือว่า "unchecked" (รอตรวจ)
    const getGroupStatus = rows => {
        if (rows.some(_isFail)) return 'fail';
        if (rows.every(_isPass)) return 'pass';
        if (!rows.some(_isClassified)) return 'unclassified';
        return 'unchecked';
    };
    return Object.keys(grouped).filter(id => {
        const status = getGroupStatus(grouped[id]);
        if (_workerStatusFilter === 'unchecked') return status === 'unchecked';
        if (_workerStatusFilter === 'pass') return status === 'pass';
        if (_workerStatusFilter === 'fail') return status === 'fail';
        return true;
    });
};

// เนื้อที่ "ขณะนี้คลาส" (shpsplit_sqm) หลังปัดเศษแบบ "largest remainder" ต่อแปลง (id)
// คำนวณครั้งเดียวตอนสร้างตาราง (#featureTable) แล้วใช้ร่วมกันทุกที่ที่ต้องรวมเนื้อที่คลาส
// เพื่อให้ผลรวมเท่ากับ "เนื้อที่ขณะนี้โฉนด" ที่ปัดเศษแล้วเป๊ะเสมอ (ดู build ที่ shpsplitRoundedById)
let _shpsplitRoundedById = {};

// เนื้อที่ "กันออก" (ex_*) ยังถือเป็นส่วนหนึ่งของแปลงยางเดิม ต้องรวมกับ "ยาง"
// เพื่อเทียบกับเป้าหมายยางพารา (rubr_sqm) — ไม่ใช่เทียบจากเนื้อที่ยางอย่างเดียว
const _sumRubberAndExcluded = (id) => {
    let rubberSqm = 0, exSqm = 0;
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const rows = $('#featureTable').DataTable().rows().data().toArray()
            .filter(r => String(r.id) === String(id));
        // กันแถวซ้ำ (sub_id ซ้ำกันจากข้อมูลที่ split ซ้อน) ไม่ให้บวกพื้นที่ซ้ำสองรอบ
        const seenSubIds = new Set();
        rows.forEach(r => {
            const key = `${r.id}::${r.sub_id}`;
            if (seenSubIds.has(key)) return;
            seenSubIds.add(key);
            const val = _shpsplitRoundedById[key] ?? Math.round(Number(r.shpsplit_sqm || 0));
            if (r.classtype === 'rubber') rubberSqm += val;
            else if (String(r.classtype || '').startsWith('ex_')) exSqm += val;
        });
    }
    return { rubberSqm, exSqm, total: rubberSqm + exSqm };
};

// ส่วนต่างเทียบกับเป้าหมาย — เขียว ±400 m² ถือว่าตรง, แดงถ้าเกิน (ใช้ร่วมกันทั้งตารางและแผงตรวจ)
const _areaDiffHtml = (cur, target) => {
    if (!target || target <= 0) return '';
    const diff = Math.round(cur - target);
    const sign = diff >= 0 ? '+' : '';
    const color = Math.abs(diff) <= 400 ? 'green' : 'red';
    return ` <small style="color:${color}">(${sign}${diff.toLocaleString('th-TH')})</small>`;
};

const _resetHighlights = () => {
    _highlightedLayers.forEach(({ layer, style }) => {
        try { layer.setStyle(style); } catch (_) { }
    });
    _highlightedLayers = [];
};

const _applyWorkerVisibility = () => {
    if (_userRole !== 'worker') return;
    document.querySelector('.checker-box')?.style.setProperty('display', 'none', 'important');
    // Hide the complex info panel (area cards, checker review, search nav)
    $('#featurePanelCollapse').closest('.card').hide();
    // Show the compact worker quick-access card instead
    $('#workerQuickCard').show();
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const dt = $('#featureTable').DataTable();
        dt.columns().every(function () {
            const title = this.header().textContent.trim();
            if (title === 'บันทึก' || title === 'ลบ') this.visible(false);
        });
        // Start with first parent ID so the list isn't overwhelmingly long
        const allRows = dt.rows().data().toArray();
        const firstId = allRows.length ? String(allRows[0].id) : null;
        buildWorkerPlotList(firstId);
        if (firstId) _currentReviewId = firstId;
    }
    $('.btn-filter-status[data-filter="none"]').html('⏳ รอตรวจ');
};

const _applyAdminVisibility = () => {
    if (_userRole !== 'admin') return;
    document.querySelector('.user-box')?.style.setProperty('display', 'none', 'important');
};

// Custom DataTable search filter for status buttons
$.fn.dataTable.ext.search.push(function (settings, data, dataIndex) {
    if (settings.nTable.id !== 'featureTable') return true;
    if (!_activeFilter && !_activeTopoFilter && _adminNavFilter === 'all') return true;
    try {
        const rowData = settings.aoData[dataIndex]._aData;
        if (!rowData) return true;
        const _isPass = r => r.check_area === 'ผ่าน' && r.check_shape === 'ผ่าน';
        const _isFail = r => r.check_area === 'ไม่ผ่าน' || r.check_shape === 'ไม่ผ่าน';
        const _isClassified = r => !!(r.classtype && String(r.classtype).trim());

        let matchesStatus = true;
        switch (_activeFilter) {
            // แปลงที่ยังไม่ได้จำแนกประเภท (classtype ว่าง) ยังไม่ต้องขึ้นในรายการ "ยังไม่ตรวจ"
            case 'none': matchesStatus = _isClassified(rowData) && !_isPass(rowData) && !_isFail(rowData); break;
            case 'pass': matchesStatus = _isPass(rowData); break;
            case 'fail': matchesStatus = _isFail(rowData); break;
            case 'remark': matchesStatus = !!(rowData.remark || rowData.user_remark); break;
            default: matchesStatus = true;
        }
        if (!matchesStatus) return false;

        // การ์ดสถานะ "ข้อมูลแปลง" (ยังไม่ตรวจ/ผ่าน/ไม่ผ่าน) นับ+กรองต่อ "id" (โฉนดรวม) ไม่ใช่ต่อแถวย่อย
        // เพื่อให้ตรงกับตัวเลขที่การ์ดแสดง — คลิกแล้วต้องเห็นแปลงย่อยทุกแถวของ id ที่ตรงเงื่อนไข
        if (_adminNavFilter !== 'all') {
            const idStatus = _idStatusCache[String(rowData.id)];
            if (idStatus !== _adminNavFilter) return false;
        }

        if (_activeTopoFilter) {
            const idTopoStatus = _idTopoStatusCache[String(rowData.id)];
            if (idTopoStatus !== _activeTopoFilter) return false;
        }
        return true;
    } catch (e) { return true; }
});

// Format remark text for popup: detect "1.xxx\n2.xxx" pattern → <ol>
function formatRemarkPopup(text) {
    if (!text || !text.trim()) return '<span class="text-muted">ไม่มีข้อมูล</span>';
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // Multi-line numbered list: every line starts with "1." "2." etc.
    if (lines.length >= 2 && lines.every(l => /^\d+\./.test(l))) {
        const items = lines.map(l => `<li>${esc(l.replace(/^\d+\.\s*/, ''))}</li>`).join('');
        return `<ol class="mb-0 ps-4">${items}</ol>`;
    }
    // Single line with embedded numbers: split on "N." boundaries
    if (lines.length === 1 && /\d+\./.test(text)) {
        const parts = text.split(/(?=\d+\.)/).map(s => s.trim()).filter(s => /^\d+\./.test(s));
        if (parts.length >= 2) {
            const items = parts.map(s => `<li>${esc(s.replace(/^\d+\.\s*/, ''))}</li>`).join('');
            return `<ol class="mb-0 ps-4">${items}</ol>`;
        }
    }
    return lines.map(l => esc(l)).join('<br>');
}

// เปิด modal แสดงข้อความ/รูปภาพแบบเต็ม — ใช้ร่วมกันทั้งตารางแอดมินและรายการแปลงฝั่ง worker
function _showNotePopup(text, images, title) {
    $('#notePopupTitle').html(title);
    let bodyHtml = text ? formatRemarkPopup(text) : '';
    if (images && images.length) {
        bodyHtml += `<div class="mt-2 text-center d-flex flex-wrap gap-2 justify-content-center">${images.map(img =>
            `<img src="${img}" class="note-popup-img" alt="ภาพประกอบ" title="คลิกเพื่อดูภาพขนาดเต็ม">`).join('')}</div>`;
    }
    $('#notePopupBody').html(bodyHtml || '<span class="text-muted">ไม่มีข้อมูล</span>');
    // Widen the modal when there's an image attached so the markup is actually visible
    $('#notePopupModal .modal-dialog').toggleClass('modal-md', !(images && images.length)).toggleClass('modal-xl', !!(images && images.length));
    const modal = new bootstrap.Modal(document.getElementById('notePopupModal'));
    modal.show();
}

// ── Annotate Image Modal — แคปภาพ + วาดมาร์คจุดที่ต้องแก้ (ใช้กับหมายเหตุของ checker) ──
function _annotateResetModal() {
    _annotateBaseImage = null;
    _annotateStrokes = [];
    _annotateTexts = [];
    _annotateActions = [];
    _annotateCurrentStroke = null;
    _annotateDraggingText = null;
    _annotateDrawing = false;
    _annotateTextSize = 26;
    $('#annotateFileInput').val('');
    $('#annotateTextSize').val(26);
    $('#annotateEditArea').hide();
    $('#annotateEmptyState').show();
}

// ความกว้างสูงสุดของข้อความก่อนจะตัดบรรทัด — กันไม่ให้ข้อความยาวล้นออกนอกภาพ
function _annotateTextMaxWidth(canvas) {
    return Math.max(120, Math.min(canvas.width - ANNOTATE_TEXT_PADDING * 4, canvas.width * 0.75));
}

// ตัดข้อความเป็นหลายบรรทัดให้พอดีกับ maxWidth (ตัดทีละตัวอักษร เผื่อภาษาไทยที่ไม่มีช่องว่างคั่นคำ)
function _annotateWrapLines(ctx, text, maxWidth) {
    const lines = [];
    let current = '';
    for (const ch of text) {
        const test = current + ch;
        if (current && ctx.measureText(test).width > maxWidth) {
            lines.push(current);
            current = ch;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}

// กรอบขนาดข้อความ (สำหรับวาดและทดสอบจุดที่คลิก/ลาก) —ยึดจุด (x,y) เป็นจุดกึ่งกลางของกรอบ
function _annotateTextBounds(ctx, t, canvas) {
    ctx.font = `bold ${t.fontSize}px sans-serif`;
    const maxWidth = _annotateTextMaxWidth(canvas);
    const lines = _annotateWrapLines(ctx, t.text, maxWidth);
    const lineHeight = t.fontSize * ANNOTATE_TEXT_LINE_HEIGHT_RATIO;
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    const height = lines.length * lineHeight;
    return {
        x: t.x - widest / 2 - ANNOTATE_TEXT_PADDING,
        y: t.y - height / 2 - ANNOTATE_TEXT_PADDING,
        width: widest + ANNOTATE_TEXT_PADDING * 2,
        height: height + ANNOTATE_TEXT_PADDING * 2,
        lines,
        lineHeight
    };
}

// หาข้อความบนสุดที่อยู่ตรงจุดที่คลิก (ไล่จากบนลงล่างเพื่อให้ของที่วางทับล่าสุดถูกเลือกก่อน)
function _annotateHitTestText(pt) {
    const canvas = document.getElementById('annotateCanvas');
    const ctx = canvas.getContext('2d');
    for (let i = _annotateTexts.length - 1; i >= 0; i--) {
        const b = _annotateTextBounds(ctx, _annotateTexts[i], canvas);
        if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) {
            return _annotateTexts[i];
        }
    }
    return null;
}

function _annotateRender() {
    const canvas = document.getElementById('annotateCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (_annotateBaseImage) ctx.drawImage(_annotateBaseImage, 0, 0, canvas.width, canvas.height);
    _annotateStrokes.forEach(s => {
        if (!s.points.length) return;
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (s.points.length < 2) {
            ctx.beginPath();
            ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
    });
    _annotateTexts.forEach(t => {
        ctx.font = `bold ${t.fontSize}px sans-serif`;
        ctx.fillStyle = t.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const b = _annotateTextBounds(ctx, t, canvas);
        const startY = t.y - b.lineHeight * (b.lines.length - 1) / 2;
        b.lines.forEach((line, i) => ctx.fillText(line, t.x, startY + i * b.lineHeight));
        if (t === _annotateDraggingText) {
            ctx.save();
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = '#2e7d32';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.restore();
        }
    });
}

function _annotateLoadImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
        const maxDim = 1600;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
            const scale = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
        }
        const canvas = document.getElementById('annotateCanvas');
        canvas.width = w;
        canvas.height = h;
        _annotateBaseImage = img;
        _annotateStrokes = [];
        $('#annotateEmptyState').hide();
        $('#annotateEditArea').show();
        _annotateRender();
    };
    img.src = dataUrl;
}

function _annotateGetCanvasPoint(evt) {
    const canvas = document.getElementById('annotateCanvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function _annotateHandlePastedFile(file) {
    if (!file || file.type.indexOf('image') === -1) return;
    const reader = new FileReader();
    reader.onload = (ev) => _annotateLoadImage(ev.target.result);
    reader.readAsDataURL(file);
}

// Open the modal from the checker remark box
$(document).on('click', '#btn-attach-remark-image', function () {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('annotateImageModal'));
    modal.show();
});

// ── Remark images (หลายรูป) — เก็บเป็น JSON array string ใน hidden field เดิม (#id-remark-image-url) ──
// รองรับข้อมูลเก่าที่เคยเก็บเป็น URL เดี่ยว (ไม่ใช่ JSON) ด้วย
function _parseRemarkImagesValue(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) { /* ข้อมูลเก่า: เป็น URL เดี่ยวธรรมดา ไม่ใช่ JSON */ }
    return [raw];
}
function _getRemarkImages() {
    return _parseRemarkImagesValue($('#id-remark-image-url').val());
}
function _renderRemarkImageThumbs(urls) {
    const list = $('#remark-image-thumb-list').empty();
    urls.forEach((url, idx) => {
        list.append(
            $('<div class="remark-image-thumb-item">').append(
                $('<img class="remark-image-thumb" alt="ภาพประกอบหมายเหตุ" title="คลิกเพื่อดูภาพขนาดเต็ม">').attr('src', url),
                $('<button type="button" class="remark-image-remove-btn" title="ลบภาพนี้"><i class="bi bi-x-lg"></i></button>').attr('data-idx', idx)
            )
        );
    });
    $('#remark-image-thumb-wrap').toggle(urls.length > 0);
}
function _setRemarkImages(urls) {
    $('#id-remark-image-url').val(urls.length ? JSON.stringify(urls) : '');
    _renderRemarkImageThumbs(urls);
}

// Remove one attached image from the current remark (cleared on next save)
$(document).on('click', '.remark-image-remove-btn', function () {
    if (!confirm('ลบภาพนี้ออกจากหมายเหตุ?')) return;
    const idx = parseInt($(this).attr('data-idx'), 10);
    const urls = _getRemarkImages();
    urls.splice(idx, 1);
    _setRemarkImages(urls);
});

// View images full-size in a lightbox overlay on the same page
function _openImageLightbox(url) {
    if (!url) return;
    $('#imageLightboxImg').attr('src', url);
    $('#imageLightbox').addClass('show');
}
function _closeImageLightbox() {
    $('#imageLightbox').removeClass('show');
    $('#imageLightboxImg').attr('src', '');
}
$(document).on('click', '.remark-image-thumb, .note-popup-img', function () {
    _openImageLightbox($(this).attr('src'));
});
$(document).on('click', '#imageLightboxClose', _closeImageLightbox);
$(document).on('click', '#imageLightbox', function (e) {
    if (e.target.id === 'imageLightbox') _closeImageLightbox();
});
$(document).on('keydown', function (e) {
    if (e.key === 'Escape' && $('#imageLightbox').hasClass('show')) _closeImageLightbox();
});

$('#annotateImageModal').on('shown.bs.modal', function () {
    document.addEventListener('paste', _annotatePasteListener);
});
$('#annotateImageModal').on('hidden.bs.modal', function () {
    document.removeEventListener('paste', _annotatePasteListener);
    _annotateResetModal();
});

function _annotatePasteListener(e) {
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            _annotateHandlePastedFile(item.getAsFile());
            e.preventDefault();
            break;
        }
    }
}

$('#annotateFileInput').on('change', function (e) {
    _annotateHandlePastedFile(e.target.files[0]);
});

$(document).on('click', '.annotate-color', function () {
    $('.annotate-color').removeClass('active');
    $(this).addClass('active');
    _annotateColor = $(this).data('color');
});

$('#annotateBrushSize').on('input', function () {
    _annotateBrushSize = parseInt(this.value, 10);
});

$(document).on('pointerdown', '#annotateCanvas', function (e) {
    if (!_annotateBaseImage) return;
    const pt = _annotateGetCanvasPoint(e.originalEvent);
    const hitText = _annotateHitTestText(pt);
    if (hitText) {
        _annotateDraggingText = hitText;
        _annotateDragOffset = { x: pt.x - hitText.x, y: pt.y - hitText.y };
        this.style.cursor = 'grabbing';
        _annotateRender();
        return;
    }
    _annotateDrawing = true;
    _annotateCurrentStroke = { color: _annotateColor, width: _annotateBrushSize, points: [pt] };
    _annotateStrokes.push(_annotateCurrentStroke);
    _annotateActions.push({ type: 'stroke', ref: _annotateCurrentStroke });
});
$(document).on('pointermove', '#annotateCanvas', function (e) {
    const pt = _annotateGetCanvasPoint(e.originalEvent);
    if (_annotateDraggingText) {
        _annotateDraggingText.x = pt.x - _annotateDragOffset.x;
        _annotateDraggingText.y = pt.y - _annotateDragOffset.y;
        _annotateRender();
        return;
    }
    if (_annotateDrawing && _annotateCurrentStroke) {
        _annotateCurrentStroke.points.push(pt);
        _annotateRender();
        return;
    }
    // ไม่ได้ลากอยู่ — เปลี่ยนเคอร์เซอร์เป็นมือจับเมื่อชี้อยู่บนข้อความ เพื่อบอกว่าย้ายตำแหน่งได้
    this.style.cursor = _annotateHitTestText(pt) ? 'grab' : '';
});
$(document).on('pointerup pointerleave', '#annotateCanvas', function () {
    _annotateDrawing = false;
    _annotateCurrentStroke = null;
    if (_annotateDraggingText) {
        _annotateDraggingText = null;
        this.style.cursor = '';
        _annotateRender();
    }
});

// ดับเบิลคลิกที่ข้อความ: แก้ไขข้อความ (ปล่อยว่างเพื่อลบ)
$(document).on('dblclick', '#annotateCanvas', function (e) {
    const pt = _annotateGetCanvasPoint(e.originalEvent);
    const hitText = _annotateHitTestText(pt);
    if (!hitText) return;
    const next = prompt('แก้ไขข้อความ (เว้นว่างเพื่อลบ)', hitText.text);
    if (next === null) return;
    if (!next.trim()) {
        _annotateTexts.splice(_annotateTexts.indexOf(hitText), 1);
        const actionIdx = _annotateActions.findIndex(a => a.ref === hitText);
        if (actionIdx !== -1) _annotateActions.splice(actionIdx, 1);
    } else {
        hitText.text = next.trim();
        hitText.fontSize = _annotateTextSize; // ปรับขนาดตามแถบเลื่อนปัจจุบันไปด้วยตอนแก้ไข
    }
    _annotateRender();
});

$('#annotateTextSize').on('input', function () {
    _annotateTextSize = parseInt(this.value, 10);
});

$('#btn-annotate-add-text').on('click', function () {
    if (!_annotateBaseImage) { alert('กรุณาวางหรือเลือกรูปก่อน'); return; }
    const text = prompt('ข้อความที่ต้องการเพิ่ม (ลากย้ายตำแหน่งได้หลังเพิ่ม, ยาวเกินไปจะตัดบรรทัดอัตโนมัติ)');
    if (!text || !text.trim()) return;
    const canvas = document.getElementById('annotateCanvas');
    const newText = {
        text: text.trim(),
        x: canvas.width / 2,
        y: canvas.height / 2,
        color: _annotateColor,
        fontSize: _annotateTextSize
    };
    _annotateTexts.push(newText);
    _annotateActions.push({ type: 'text', ref: newText });
    _annotateRender();
});

$('#btn-annotate-undo').on('click', function () {
    const last = _annotateActions.pop();
    if (!last) return;
    if (last.type === 'stroke') _annotateStrokes.splice(_annotateStrokes.indexOf(last.ref), 1);
    else _annotateTexts.splice(_annotateTexts.indexOf(last.ref), 1);
    _annotateRender();
});
$('#btn-annotate-clear').on('click', function () {
    _annotateStrokes = [];
    _annotateTexts = [];
    _annotateActions = [];
    _annotateRender();
});
$('#btn-annotate-remove-image').on('click', function () {
    _annotateResetModal();
});

$('#btn-annotate-save').on('click', async function () {
    if (!_annotateBaseImage) { alert('กรุณาวางหรือเลือกรูปก่อน'); return; }
    const canvas = document.getElementById('annotateCanvas');
    const dataUrl = canvas.toDataURL('image/png');
    const btn = $(this);
    btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');
    try {
        const res = await fetch('/rub/api/upload_remark_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl })
        });
        const data = await res.json();
        if (data.success) {
            const urls = _getRemarkImages();
            urls.push(data.url);
            _setRemarkImages(urls);
            bootstrap.Modal.getInstance(document.getElementById('annotateImageModal'))?.hide();
        } else {
            alert('อัปโหลดรูปไม่สำเร็จ: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Upload remark image error:', err);
        alert('เกิดข้อผิดพลาดในการอัปโหลดรูป');
    } finally {
        btn.prop('disabled', false).html('<i class="bi bi-check-circle-fill me-1"></i> บันทึกรูป');
    }
});

// Initialize map and feature group
const map = L.map('map', { maxZoom: 22 }).setView([18.819620993471577, 100.8784385963758], 13);
const featureGroup = L.featureGroup();
const reshapeFeatureGroup = L.featureGroup();
const othersFeatureGroup = L.featureGroup(); // แปลงของเพื่อนร่วมโปรเจค (read-only background)
const pointRefFeatureGroup = L.featureGroup(); // จุดอ้างอิงเดิม (GPS) — แสดงคู่กับโพลิกอนที่ขึ้นรูปแล้ว เปิด/ปิดได้

// Custom Rubber Tree Icon
const rubberTreeIcon = L.icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 640">
            <defs>
                <filter id="p-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="12" />
                    <feOffset dx="0" dy="10" result="offsetblur" />
                    <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
                    <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <linearGradient id="p-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:#81c784" />
                    <stop offset="100%" style="stop-color:#2e7d32" />
                </linearGradient>
            </defs>
            <path fill="url(#p-grad)" filter="url(#p-shadow)" d="M256 640c-15 0-30-5-40-15C160 560 32 420 32 256 32 120 144 0 256 0s224 120 224 256c0 164-128 304-184 369-10 10-25 15-40 15z"/>
            <circle cx="256" cy="245" r="170" fill="white"/>
            <path fill="#2e7d32" d="M256 120c-40 0-80 35-80 110 0 60 80 110 80 110s80-50 80-110c0-75-40-110-80-110z"/>
            <path fill="#1b5e20" d="M256 150c-30 0-60 25-60 80 0 50 60 90 60 90s60-40 60-90c0-55-30-80-60-80z" opacity="0.6"/>
            <path fill="#5d4037" d="M236 320h40v40h-40z"/>
        </svg>
    `),
    iconSize: [28, 35],
    iconAnchor: [14, 35],
    popupAnchor: [0, -35]
});

// Configure base layer
const gmap_road = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_sat = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_terrain = L.tileLayer('https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const gmap_hybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 22,
    maxNativeZoom: 18,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 22,
    maxNativeZoom: 22
});

// Add the custom tile layer
const longdoLayer = L.tileLayer('https://ms.longdo.com/mmmap/img.php?zoom={z}&x={x}&y={y}&mode=dol_hd', {
    attribution: '&copy; Longdo Map',
    tileSize: 256,
    maxZoom: 22,
    maxNativeZoom: 18,
    minZoom: 1
});


const ndvi = L.tileLayer.wms("https://engrids.soc.cmu.ac.th/geoserver/gwc/service/wms?", {
    layers: 'rubber:rubber4326',
    format: 'image/png',
    transparent: true,
    maxZoom: 22,
    zIndex: 6
});

// shpall background layer — bbox-filtered per viewport, reloads on map move
const shpallLayer = L.featureGroup();
let _shpallActive = false;
let _shpallTimer = null;
const SHPALL_MIN_ZOOM = 13; // โหลด/แสดงเส้นขอบแปลงเฉพาะตอนซูมใกล้พอ ลดข้อมูลที่ต้องโหลดตอนซูมไกล
const SHPALL_LABEL_MIN_ZOOM = 17; // ตัวหนังสือป้ายแปลงขึ้นช้ากว่าเส้นขอบ ต้องซูมเข้าไปอีกถึงจะเห็น

function _shpallStyle() {
    return {
        color: '#0055ff', weight: 1.5, opacity: 0.65,
        fillColor: '#0055ff', fillOpacity: 0.10
    };
}

function _shpallRaiToSqm(rai) {
    const n = parseFloat(String(rai).replace(/,/g, ''));
    return isNaN(n) ? null : n * 1600;
}

function _shpallLabel(props) {
    const growRai = props.grow_rai;
    const landRai = props.land_rai;
    const growSqm = _shpallRaiToSqm(growRai);
    const landSqm = _shpallRaiToSqm(landRai);
    return `${props.farm_name || '-'}<br>` +
        `ยางพาราที่ลงทะเบียน: ${growRai || '-'} ไร่ (${growSqm !== null ? growSqm.toLocaleString('th-TH') : '-'} ตร.ม.)<br>` +
        `พื้นที่โฉนด: ${landRai || '-'} ไร่ (${landSqm !== null ? landSqm.toLocaleString('th-TH') : '-'} ตร.ม.)`;
}

async function loadShpallLayer() {
    if (!_shpallActive) return;
    if (map.getZoom() < SHPALL_MIN_ZOOM) {
        shpallLayer.clearLayers();
        return;
    }
    const tb = document.getElementById('tb').value || new URLSearchParams(window.location.search).get('tb') || 'shpall';
    try {
        const b = map.getBounds();
        const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
        const res = await fetch(`/rub/api/shpall/${tb}?bbox=${bbox}`);
        const data = await res.json();
        shpallLayer.clearLayers();
        if (data.success && data.features && data.features.length > 0) {
            L.geoJSON({ type: 'FeatureCollection', features: data.features }, {
                interactive: false, style: _shpallStyle,
                onEachFeature: (feature, layer) => {
                    layer.bindTooltip(_shpallLabel(feature.properties || {}), {
                        permanent: true, direction: 'center', className: 'shpall-tooltip'
                    });
                }
            }).addTo(shpallLayer);
            console.log(`shpall: แสดง ${data.features.length} แปลง`);
        }
    } catch (err) {
        console.error('shpall load error:', err);
    }
}

function _shpallDebounce() {
    if (!_shpallActive) return;
    clearTimeout(_shpallTimer);
    _shpallTimer = setTimeout(loadShpallLayer, 400);
}

function _shpallUpdateLabelZoomClass() {
    document.getElementById('map').classList.toggle('shpall-zoomed-in', map.getZoom() >= SHPALL_LABEL_MIN_ZOOM);
}
map.on('zoomend', _shpallUpdateLabelZoomClass);
_shpallUpdateLabelZoomClass();

shpallLayer.on('add', () => { _shpallActive = true; loadShpallLayer(); });
shpallLayer.on('remove', () => { _shpallActive = false; shpallLayer.clearLayers(); });
map.on('moveend zoomend', _shpallDebounce);

// toggle เปิด/ปิดเฉพาะตัวหนังสือป้ายแปลง (เดิม) โดยไม่กระทบเส้นขอบแปลง
const shpallLabelToggle = L.layerGroup();
shpallLabelToggle.on('add', () => document.getElementById('map').classList.add('shpall-labels-on'));
shpallLabelToggle.on('remove', () => document.getElementById('map').classList.remove('shpall-labels-on'));

const baseLayers = {
    "Google Road": gmap_road,
    "Google Satellite": gmap_sat.addTo(map),
    "Google Terrain": gmap_terrain,
    "Google Hybrid": gmap_hybrid,
    "Stadia Light": light
};

// othersFeatureGroup ต้องถูก addTo ก่อน featureGroup เพื่อให้แปลงตัวเองแสดงอยู่บนสุด
othersFeatureGroup.addTo(map);
const overlayMaps = {
    "แปลงยาง (reclass)": featureGroup.addTo(map),
    "แปลงยาง (reshape)": reshapeFeatureGroup,
    "จุดอ้างอิงเดิม (GPS)": pointRefFeatureGroup, // ปิดไว้เป็นค่าเริ่มต้น — ผู้ใช้เปิดดูเองตอนต้องการเทียบกับโพลิกอนที่วาด
    "แปลงยาง (เดิม)": shpallLayer,
    "ชื่อแปลง (เดิม)": shpallLabelToggle.addTo(map),
    "Longdo Map": longdoLayer.addTo(map)
};

L.control.layers(baseLayers, overlayMaps).addTo(map);

// Helper to find layer on map
const findLayerBySubId = (subId) => {
    let found = null;
    featureGroup.eachLayer(layer => {
        // Handle GeoJson group structure
        if (typeof layer.eachLayer === 'function') {
            layer.eachLayer(subLayer => {
                if (subLayer.feature && subLayer.feature.properties && subLayer.feature.properties.sub_id == subId) {
                    found = subLayer;
                }
            });
        } else if (layer.feature && layer.feature.properties && layer.feature.properties.sub_id == subId) {
            found = layer;
        }
    });
    return found;
};

// Helper function to focus on a specific plot (Map + Panel + Table)
const focusPlot = (rowData) => {
    if (!rowData) return;

    const dt = $('#featureTable').DataTable();
    const subId = rowData.sub_id;

    // 1. Map: Zoom and Open Popup
    if (rowData.geom) {
        try {
            const tempLayer = L.geoJSON(rowData.geom);
            const bounds = tempLayer.getBounds();
            if (bounds.isValid()) {
                // Use flyToBounds for a smoother, more noticeable transition
                map.flyToBounds(bounds, {
                    padding: [50, 50],
                    maxZoom: 22,
                    duration: 1.0
                });

                // Ensure map is properly sized
                setTimeout(() => map.invalidateSize(), 500);
            }
        } catch (e) {
            console.error('Zoom error:', e);
        }
    }

    // Restore previous focused polygon (re-apply group dashed if it's still a sibling)
    if (_focusedLayer) {
        try {
            const prevLayer = _focusedLayer.layer;
            const prevOrigStyle = _focusedLayer.originalStyle;
            const inGroup = _highlightedLayers.some(h => h.layer === prevLayer);
            if (inGroup) {
                prevLayer.setStyle({ color: '#FFD600', fillColor: prevOrigStyle.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
            } else {
                prevLayer.setStyle(prevOrigStyle);
            }
        } catch (_) { }
        _focusedLayer = null;
        _focusedSubId = null;
    }

    // 2. Info Panel: Populate data (admin: triggers group-highlight for all subs of same parent)
    showFeaturePanel({ properties: rowData });

    // Apply solid focused highlight ON TOP of group-highlight — must come after showFeaturePanel
    const layer = findLayerBySubId(subId);
    if (layer && typeof layer.setStyle === 'function') {
        const originalStyle = getFeatureStyle({ properties: rowData });
        _focusedLayer = { layer, originalStyle };
        _focusedSubId = subId;
        layer.setStyle({
            color: '#FFD600',
            fillColor: originalStyle.fillColor,
            weight: 6,
            opacity: 1,
            fillOpacity: 0.75,
            dashArray: null
        });
    }

    // 3. DataTable: Highlight selected row
    const rowNode = dt.row((idx, d) => String(d.sub_id) === String(subId)).node();
    if (rowNode) {
        $(rowNode).addClass('selected').siblings().removeClass('selected');
    }

    // 4. Worker quick list: show only this parent ID's items
    if (_userRole === 'worker') {
        buildWorkerPlotList(rowData.id);
        $('.worker-plot-item').removeClass('active');
        const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
        $item.addClass('active');
        $item[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _updateWorkerSelectedBanner(rowData);
    }
};

// ── Shared color/label maps for worker panel ──
const _workerColorMap = {
    'rubber': '#006d2c', 'not-rubber': '#9900ff', 'Other': '#ff0004',
    'ex_age_rubber': '#00c853', 'ex_building': '#ff00d4', 'ex_pond': '#00bcd4',
    'ex_cr_area': '#f9a825', 'ex_ar_area': '#00008b', 'ex_other': '#AACDDC'
};
const _workerLabelMap = {
    'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
    'Other': 'ไม่ใช่ยางพารา', 'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
    'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
    'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)', 'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
    'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
};

// Update the selected-plot banner in the worker quick panel
const _updateWorkerSelectedBanner = (rowData) => {
    const color = _workerColorMap[rowData.classtype] || '#90a4ae';
    const label = _workerLabelMap[rowData.classtype] || 'อื่นๆ';
    $('#worker-sel-dot').css('background', color);
    $('#worker-sel-subid').text(`#${rowData.sub_id}`);
    $('#worker-sel-id').text(`ID: ${rowData.id}`);
    $('#worker-sel-classtype').html(`<span style="color:${color}; font-weight:700;">${label}</span>`);
    $('#worker-sel-remark').val(rowData.user_remark || '');
    $('#worker-sel-save').data('subid', String(rowData.sub_id));
    $('#worker-selected-info').show();

    // Track current parent ID for prev/next navigation
    _currentReviewId = String(rowData.id || '');

    // Update nav counter (filtered by current status filter)
    if ($.fn.DataTable.isDataTable('#featureTable')) {
        const dt = $('#featureTable').DataTable();
        const uniqueIds = _getWorkerNavIds(dt.rows().data().toArray());
        const idx = uniqueIds.indexOf(_currentReviewId);
        $('#worker-nav-count').text(`${idx >= 0 ? idx + 1 : '-'} / ${uniqueIds.length}`);
    }
};

// Update only the area info cards (left + right) without rebuilding the checker box
const _updateAreaCards = (rowData) => {
    if (!rowData) return;

    const labelMapFull = {
        'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
        'Other': 'ไม่ใช่ยางพารา', 'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
        'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
        'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)',
        'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
        'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
    };
    const colorMapFull = {
        'rubber': '#006d2c', 'not-rubber': '#9900ff', 'Other': '#ff0004',
        'ex_age_rubber': '#00ff0d', 'ex_building': '#ff00d4', 'ex_pond': '#00fff2',
        'ex_cr_area': '#ffff00', 'ex_ar_area': '#00008b', 'ex_other': '#AACDDC'
    };
    const rdLabel = labelMapFull[rowData.classtype] || 'อื่นๆ';
    const rdColor = colorMapFull[rowData.classtype] || '#6c757d';

    // Left card: deed data
    $('#target-land-sqm').text(Number(rowData.deed_sqm || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }));
    $('#curr-land-sqm').text(Number(rowData.current_sqm || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }));

    // Right card: current area (รวมยาง + กันออกของ ID เดียวกัน เมื่อเป็นแถวยาง)
    if (rowData.classtype === 'rubber') {
        const { rubberSqm, exSqm, total } = _sumRubberAndExcluded(rowData.id);
        $('#curr-area-sqm').text(total.toLocaleString('th-TH', { maximumFractionDigits: 0 }));
        if (exSqm > 0) {
            $('#rubber-current-label').text('เนื้อที่ขณะนี้ (รวมกันออก):');
            $('#rubber-excluded-note').text(`${rubberSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ยาง + ${exSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กันออก`).show();
        } else {
            $('#rubber-current-label').text('เนื้อที่ขณะนี้:');
            $('#rubber-excluded-note').hide();
        }
    } else {
        const roundedVal = _shpsplitRoundedById[`${rowData.id}::${rowData.sub_id}`] ?? Math.round(Number(rowData.shpsplit_sqm || 0));
        $('#curr-area-sqm').text(roundedVal.toLocaleString('th-TH', { maximumFractionDigits: 0 }));
        $('#rubber-current-label').text('เนื้อที่ขณะนี้:');
        $('#rubber-excluded-note').hide();
    }

    // Classtype badge
    $('#display-classtype').html(`<span class="classtype-badge w-100 text-center" style="background:${rdColor}15; color:#000; border:1px solid ${rdColor}40; font-weight: 500;">${rdLabel}</span>`);

    // Rubber card layout
    $('#rubber-target-row, #rubber-current-row').removeClass('d-none');
    if (rowData.classtype === 'rubber') {
        $('#rubber-card-label').html(`<i class="bi bi-tree-fill"></i> ข้อมูล${rdLabel}`);
        $('#rubber-card-target-label').text('เนื้อที่เป้าหมายยางพารา:');
        $('#target-rubber-sqm').text(Number(rowData.rubr_sqm || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }));
        $('#target-rubber-sqm').next('small').show();
    } else {
        $('#rubber-card-label').html(`<i class="bi bi-tag-fill"></i> ${rdLabel}`);
        $('#rubber-target-row').addClass('d-none');
    }
};

// Build compact scrollable plot list for workers (called after DataTable init + auth)
// filterId: if provided, only show sub-plots belonging to that parent ID
const buildWorkerPlotList = (filterId = null) => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    const allRows = dt.rows().data().toArray();
    if (!allRows.length) {
        $('#workerPlotList').html('<div class="text-muted small text-center py-3"><i class="bi bi-inbox"></i> ไม่พบแปลง</div>');
        return;
    }
    const _wIsPass = r => r.check_area === 'ผ่าน' && r.check_shape === 'ผ่าน';
    const _wIsFail = r => r.check_area === 'ไม่ผ่าน' || r.check_shape === 'ไม่ผ่าน';
    const _wIsClassified = r => !!(r.classtype && String(r.classtype).trim());

    // Group ALL rows by parent ID first
    const allGrouped = {};
    allRows.forEach(row => {
        const key = String(row.id);
        if (!allGrouped[key]) allGrouped[key] = [];
        allGrouped[key].push(row);
    });

    // Compute group-level status: fail > unchecked > pass
    // กลุ่มที่ยังไม่มีแปลงไหนจำแนกประเภทเลย ยังไม่ถือว่า "unchecked" (รอตรวจ)
    const getGroupStatus = rows => {
        if (rows.some(_wIsFail)) return 'fail';
        if (rows.every(_wIsPass)) return 'pass';
        if (!rows.some(_wIsClassified)) return 'unclassified';
        return 'unchecked';
    };

    // Count filter badges by group (ID) status
    const allGroupIds = Object.keys(allGrouped);
    const cntUnchecked = allGroupIds.filter(id => getGroupStatus(allGrouped[id]) === 'unchecked').length;
    const cntPass      = allGroupIds.filter(id => getGroupStatus(allGrouped[id]) === 'pass').length;
    const cntFail      = allGroupIds.filter(id => getGroupStatus(allGrouped[id]) === 'fail').length;
    $('#wfc-unchecked').text(cntUnchecked);
    $('#wfc-pass').text(cntPass);
    $('#wfc-fail').text(cntFail);

    // Apply ID search filter from input
    const idSearch = ($('#worker-id-search').val() || '').trim();

    // Filter which ID groups to show (filter at group level, not sub-plot level)
    const displayGroupIds = allGroupIds.filter(id => {
        if (filterId && id !== String(filterId)) return false;
        if (idSearch && !id.includes(idSearch)) return false;
        const status = getGroupStatus(allGrouped[id]);
        if (_workerStatusFilter === 'unchecked') return status === 'unchecked';
        if (_workerStatusFilter === 'pass') return status === 'pass';
        if (_workerStatusFilter === 'fail') return status === 'fail';
        return true;
    });

    // Build single item HTML
    const buildItem = row => {
        const color = _workerColorMap[row.classtype] || '#90a4ae';
        const label = _workerLabelMap[row.classtype] || 'อื่นๆ';
        const ca = row.check_area || '';
        const cs = row.check_shape || '';
        let verdictHtml;
        if (ca === 'ผ่าน' && cs === 'ผ่าน') {
            verdictHtml = `<span class="worker-verdict-badge worker-verdict-pass"><i class="bi bi-check-circle-fill"></i> ผ่าน</span>`;
        } else if (ca === 'ไม่ผ่าน' || cs === 'ไม่ผ่าน') {
            verdictHtml = `<span class="worker-verdict-badge worker-verdict-fail"><i class="bi bi-x-circle-fill"></i> ไม่ผ่าน</span>`;
        } else if (!_wIsClassified(row)) {
            verdictHtml = `<span class="worker-verdict-badge worker-verdict-unclassified"><i class="bi bi-dash-circle"></i> ยังไม่จำแนกประเภท</span>`;
        } else {
            verdictHtml = `<span class="worker-verdict-badge worker-verdict-pending"><i class="bi bi-hourglass-split"></i> รอตรวจ</span>`;
        }
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const noteTag = row.user_remark ? `<span style="font-size:0.65rem;color:#1d4ed8;"><i class="bi bi-chat-dots-fill"></i></span>` : '';
        const topoTag = row.topology_status === 'overlap'
            ? `<span style="font-size:0.65rem;color:#991b1b;" title="ซ้อนทับกับแปลงอื่น"><i class="bi bi-exclamation-octagon-fill"></i></span>`
            : '';
        const notePreview = row.user_remark
            ? `<div class="worker-plot-note"><i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${esc(row.user_remark.substring(0, 20))}${row.user_remark.length > 20 ? '…' : ''}</div>`
            : '';
        // หมายเหตุผู้เช็ก — สิ่งที่ต้องแก้ไขสำหรับแปลงนี้ แสดงเป็นแถบปุ่มกดดู แทนการพิมพ์ข้อความยาวๆ inline (อ่านไม่ได้ถ้ายาวเกิน)
        // ต้องแสดงแม้ผู้เช็กแนบ "แค่รูป" โดยไม่ได้พิมพ์ข้อความเลยก็ตาม (ไม่ใช่เช็คแค่ row.remark เพียวๆ)
        const checkerImages = _parseRemarkImagesValue(row.remark_image);
        const hasCheckerNote = !!(row.remark || checkerImages.length);
        const checkerNoteBanner = hasCheckerNote
            ? `<div class="worker-plot-checker-note">
                <div class="worker-plot-checker-note-label"><i class="bi bi-exclamation-circle-fill"></i> ผู้เช็คแจ้ง</div>
                <div class="worker-plot-checker-note-actions">
                    ${row.remark ? `<button type="button" class="btn-checker-note-view" data-subid="${row.sub_id}" data-kind="text"><i class="bi bi-chat-square-text-fill"></i> ดูข้อความ</button>` : ''}
                    ${checkerImages.length ? `<button type="button" class="btn-checker-note-view" data-subid="${row.sub_id}" data-kind="img"><i class="bi bi-camera-fill"></i> ดูรูปภาพ (${checkerImages.length})</button>` : ''}
                </div>
            </div>`
            : '';
        return `<div class="worker-plot-item" data-subid="${row.sub_id}" data-id="${row.id}">
            <div class="worker-plot-row">
                <div class="worker-class-dot" style="background:${color};"></div>
                <div class="worker-plot-info">
                    <div class="worker-plot-ids"><span class="text-primary fw-bold">#${row.sub_id}</span> ${noteTag} ${topoTag}</div>
                    <div class="worker-plot-class">${label}</div>
                    ${notePreview}
                </div>
                <div class="ms-auto ps-2">${verdictHtml}</div>
            </div>
            ${checkerNoteBanner}
        </div>`;
    };

    // Build group header badge
    const getGroupBadge = status => {
        if (status === 'pass')         return `<span class="worker-group-badge worker-group-badge-pass"><i class="bi bi-check-circle-fill"></i> ผ่าน</span>`;
        if (status === 'fail')         return `<span class="worker-group-badge worker-group-badge-fail"><i class="bi bi-x-circle-fill"></i> ไม่ผ่าน</span>`;
        if (status === 'unclassified') return `<span class="worker-group-badge worker-group-badge-unclassified"><i class="bi bi-dash-circle"></i> ยังไม่จำแนกประเภท</span>`;
        return `<span class="worker-group-badge worker-group-badge-pending"><i class="bi bi-hourglass-split"></i> รอตรวจ</span>`;
    };

    // Build grouped HTML — show ALL sub-plots in each matched ID group
    const html = displayGroupIds.map(id => {
        const rows = allGrouped[id];
        const groupStatus = getGroupStatus(rows);
        return `<div class="worker-id-group">
            <div class="worker-id-group-header">
                <span><i class="bi bi-folder2-open me-1"></i>ID: ${id} <span class="worker-group-count">(${rows.length} แปลง)</span></span>
                ${getGroupBadge(groupStatus)}
            </div>
            ${rows.map(buildItem).join('')}
        </div>`;
    }).join('');

    const emptyMsg = _workerStatusFilter === 'unchecked'
        ? '<div class="text-muted small text-center py-3"><i class="bi bi-check2-all text-success"></i> ตรวจครบแล้ว!</div>'
        : _workerStatusFilter === 'pass'
        ? '<div class="text-muted small text-center py-3"><i class="bi bi-inbox"></i> ยังไม่มี ID ที่ผ่านครบ</div>'
        : _workerStatusFilter === 'fail'
        ? '<div class="text-muted small text-center py-3"><i class="bi bi-emoji-smile text-success"></i> ไม่มีรายการไม่ผ่าน!</div>'
        : '<div class="text-muted small text-center py-3">ไม่พบแปลง</div>';

    $('#workerPlotList').html(html || emptyMsg);

    // Update nav counter: filtered unique IDs based on current status filter
    const uniqueIds = _getWorkerNavIds(allRows);
    const countId = filterId || _currentReviewId;
    if (countId) {
        const idx = uniqueIds.indexOf(String(countId));
        $('#worker-nav-count').text(`${idx >= 0 ? idx + 1 : '-'} / ${uniqueIds.length}`);
    } else {
        $('#worker-nav-count').text(`- / ${uniqueIds.length}`);
    }
    $('#workerNavBar').css('display', 'flex');
};

// Auto-save user remark before navigating away (prevents text disappearing)
const autoSaveUserRemark = async () => {
    const subId = $('#panel-sub-id').val();
    const tb = $('#tb').val();
    if (!subId || !_panelUserDirty || _autoSavingUserRemark) return;

    const userRemark = $('#panel-user-remark').val();
    const displayName = document.getElementById('display-name')?.textContent || '';

    _autoSavingUserRemark = true;
    try {
        const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: userRemark })
        });
        const data = await res.json();
        if (data.success) {
            const updatedTs = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();
            const dt = $('#featureTable').DataTable();
            const tableRow = dt.row((idx, d) => d.sub_id == subId);
            if (tableRow.any()) {
                const rowData = tableRow.data();
                rowData.user_remark = userRemark;
                rowData.user_remark_ts = updatedTs;
                tableRow.data(rowData).draw(false);
            }
            _panelUserDirty = false;
            $('#user-dirty-badge').hide();
        }
    } catch (e) {
        console.error('Auto-save user remark error:', e);
    } finally {
        _autoSavingUserRemark = false;
    }
};

// ── Admin status helpers ──
const getIdStatus = (allRows, id) => {
    const subs = allRows.filter(r => String(r.id) === String(id));
    if (!subs.length) return 'none';
    const hasFail = subs.some(r => r.check_area === 'ไม่ผ่าน' || r.check_shape === 'ไม่ผ่าน');
    if (hasFail) return 'fail';
    const allPass = subs.every(r => r.check_area === 'ผ่าน' && r.check_shape === 'ผ่าน');
    if (allPass) return 'pass';
    // ยังไม่มีแปลงไหนในกลุ่มนี้ถูกจำแนกประเภทเลย ยังไม่ต้องขึ้นใน "ยังไม่ตรวจ"
    const hasClassified = subs.some(r => r.classtype && String(r.classtype).trim());
    if (!hasClassified) return 'unclassified';
    return 'none';
};

const updateAdminStatusCounts = () => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const allRows = $('#featureTable').DataTable().rows().data().toArray();
    const uniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    let cntNone = 0, cntPass = 0, cntFail = 0;
    _idStatusCache = {};
    uniqueIds.forEach(id => {
        const s = getIdStatus(allRows, id);
        _idStatusCache[id] = s;
        if (s === 'none') cntNone++;
        else if (s === 'pass') cntPass++;
        else if (s === 'fail') cntFail++;
    });
    $('#asc-none').text(cntNone);
    $('#asc-pass').text(cntPass);
    $('#asc-fail').text(cntFail);
    updateTopologyStatusCounts();
};

// นับ+cache ตาม "id" (โฉนดรวม) — ถ้ามีแปลงย่อยใดในกลุ่มซ้อนทับ ให้ทั้งกลุ่มนับเป็น "ซ้อนทับ"
// เพื่อให้ตัวเลขตรงกับการ์ดสถานะแถวบน (ยังไม่ตรวจ/ผ่าน/ไม่ผ่าน) ที่นับต่อ id เหมือนกัน
const getIdTopologyStatus = (allRows, id) => {
    const subs = allRows.filter(r => String(r.id) === String(id));
    return subs.some(r => (r.topology_status || 'ok') === 'overlap') ? 'overlap' : 'ok';
};

const updateTopologyStatusCounts = () => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const allRows = $('#featureTable').DataTable().rows().data().toArray();
    const uniqueIds = [...new Set(allRows.map(r => String(r.id)))];
    let cntOverlap = 0, cntOk = 0;
    _idTopoStatusCache = {};
    uniqueIds.forEach(id => {
        const s = getIdTopologyStatus(allRows, id);
        _idTopoStatusCache[id] = s;
        if (s === 'overlap') cntOverlap++;
        else cntOk++;
    });
    $('#tsc-overlap').text(cntOverlap);
    $('#tsc-ok').text(cntOk);
};

// Helper to navigate between plots (Prev/Next) — by unique parent ID
const navigatePlots = async (direction) => {
    if (_panelUserDirty) await autoSaveUserRemark();

    const dt = $('#featureTable').DataTable();
    const allRows = dt.rows({ search: 'applied' }).data().toArray();
    const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];

    // Apply nav filter: worker uses _workerStatusFilter, admin uses _adminNavFilter
    const uniqueIds = _userRole === 'worker'
        ? _getWorkerNavIds(allRows)
        : (_adminNavFilter !== 'all'
            ? allUniqueIds.filter(id => getIdStatus(allRows, id) === _adminNavFilter)
            : allUniqueIds);

    const currentIdIdx = _currentReviewId
        ? uniqueIds.indexOf(String(_currentReviewId))
        : -1;

    const nextIdx = currentIdIdx + direction;
    if (nextIdx >= 0 && nextIdx < uniqueIds.length) {
        const nextId = uniqueIds[nextIdx];
        const firstRow = allRows.find(r => String(r.id) === nextId);
        if (firstRow) {
            _currentReviewId = null;
            focusPlot(firstRow);
        }
    }
};


const showFeaturePanel = (feature, layer) => {
    const props = feature.properties;

    // Basic Info
    $('#display-id-num').text(props.id || '-');
    $('#display-id').text(`ID: ${props.id || '-'}`);
    $('#id').val(props.id || '');
    $('#display-farmer-id').text(props.id_farmer || '-');
    $('#display-farmer-name').html(`<i class="bi bi-person-fill"></i> ${props.farm_name || '-'}`);
    $('#panel-sub-id').val(props.sub_id || '');
    $('#display-regis-no').text(props.regis_no || '-');
    $('#display-age').text(props.age ? `${Number(props.age).toFixed(0)} ปี` : '-');
    $('#display-deed-id').text(props.deed_id || '-');

    // Area land
    const targetLandSqm = Number(props.deed_sqm || 0);
    const currLandSqm = Number(props.current_sqm || 0); // Sqm_Deed (mapped in loadGeoData)
    $('#target-land-sqm').text(targetLandSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 }));
    $('#curr-land-sqm').text(currLandSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 }));

    // Area rubber (Reclass)
    const targetRubberSqm = Number(props.rubr_sqm || 0);
    const currAreaSqm = _shpsplitRoundedById[`${props.id}::${props.sub_id}`] ?? Math.round(Number(props.shpsplit_sqm || 0)); // shpsplit_sqm
    // เมื่อเป็นแถวยาง ให้นับรวมกับพื้นที่กันออก (ex_*) ของ ID เดียวกันด้วย
    const rubberAgg = props.classtype === 'rubber' ? _sumRubberAndExcluded(props.id) : null;
    $('#curr-area-sqm').text((rubberAgg ? rubberAgg.total : currAreaSqm).toLocaleString('th-TH', { maximumFractionDigits: 0 }));

    // Classtype Label & Color
    const labelMap = {
        'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
        'Other': 'ไม่ใช่ยางพารา', 'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
        'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
        'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)',
        'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
        'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
    };
    const colorMap = {
        'rubber': '#006d2c', 'not-rubber': '#9900ff', 'Other': '#ff0004',
        'ex_age_rubber': '#00ff0d', 'ex_building': '#ff00d4', 'ex_pond': '#00fff2',
        'ex_cr_area': '#ffff00', 'ex_ar_area': '#00008b',
        'ex_other': '#AACDDC'
    };
    const label = labelMap[props.classtype] || 'อื่นๆ';
    const color = colorMap[props.classtype] || '#6c757d';

    if (props.classtype !== 'rubber' && props.classtype) {
        $('#display-other-type').text(label).removeClass('outline-muted');
        // If it's something excluded, we might want a different style but let's keep it simple
    } else {
        $('#display-other-type').text('N/A').addClass('outline-muted');
    }

    // Classtype Badge
    $('#display-classtype').html(`<span class="classtype-badge w-100 text-center" style="background:${color}15; color:#000; border:1px solid ${color}40; font-weight: 500;">${label}</span>`);

    // Update Rubber Card Layout based on class
    // Show/hide right card rows based on classtype
    $('#rubber-target-row, #rubber-current-row').removeClass('d-none');

    const isRubber = (props.classtype === 'rubber');
    if (isRubber) {
        $('#rubber-card-label').html(`<i class="bi bi-tree-fill"></i> ข้อมูล${label}`);
        $('#rubber-card-target-label').text('เนื้อที่เป้าหมายยางพารา:');
        $('#target-rubber-sqm').text(targetRubberSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 }));
        $('#target-rubber-sqm').next('small').show();
        if (rubberAgg && rubberAgg.exSqm > 0) {
            $('#rubber-current-label').text('เนื้อที่ขณะนี้ (รวมกันออก):');
            $('#rubber-excluded-note').text(`${rubberAgg.rubberSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ยาง + ${rubberAgg.exSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กันออก`).show();
        } else {
            $('#rubber-current-label').text('เนื้อที่ขณะนี้:');
            $('#rubber-excluded-note').hide();
        }
    } else {
        $('#rubber-card-label').html(`<i class="bi bi-tag-fill"></i> ${label}`);
        $('#rubber-target-row').addClass('d-none');
        $('#rubber-excluded-note').hide();
    }

    // ── User remark ──
    $('#panel-user-remark').val(props.user_remark || '');
    _panelUserDirty = false;
    $('#user-dirty-badge').hide();

    // ── Checker: ID-grouped review panel ──
    if (_userRole !== 'worker') {
        const parentId = String(props.id || '');
        if (parentId && parentId !== _currentReviewId) {
            _currentReviewId = parentId;
            _resetHighlights();

            const dt = $('#featureTable').DataTable();
            const allSubs = dt.rows().data().toArray().filter(r => String(r.id) === parentId);

            // Highlight all sub_ids of this parent ID (no auto-zoom when clicking polygon on map)
            allSubs.forEach(r => {
                const lyr = findLayerBySubId(r.sub_id);
                if (lyr && typeof lyr.setStyle === 'function') {
                    const orig = getFeatureStyle({ properties: r });
                    _highlightedLayers.push({ layer: lyr, style: orig });
                    // Yellow dashed border for group highlight (all subs of same parent ID)
                    lyr.setStyle({ color: '#FFD600', fillColor: orig.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
                }
            });

            // Build sub_id rows
            const labelMap = {
                'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
                'Other': 'ไม่ใช่ยางพารา', 'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
                'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
                'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)',
                'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
                'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
            };
            const colorMap = {
                'rubber': '#006d2c', 'not-rubber': '#9900ff', 'Other': '#ff0004',
                'ex_age_rubber': '#00c853', 'ex_building': '#ff00d4', 'ex_pond': '#00bcd4',
                'ex_cr_area': '#f9a825', 'ex_ar_area': '#00008b', 'ex_other': '#AACDDC'
            };

            const mkOpts = (val) => ['', 'ผ่าน', 'ไม่ผ่าน'].map(v =>
                `<option value="${v}" ${val === v ? 'selected' : ''}>${v === '' ? '-- เลือก --' : v === 'ผ่าน' ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}</option>`
            ).join('');

            // Deed-level check_area — one value for entire deed
            const deedCa = allSubs.find(r => r.check_area)?.check_area || '';

            // เนื้อที่ขณะนี้ (โฉนด + ยางพารารวมกันออก) แสดงประกอบการตรวจสอบโฉนด
            const deedTargetSqm = Number(allSubs[0]?.deed_sqm || 0);
            const deedCurrentSqm = Number(allSubs[0]?.current_sqm || 0);
            const rubrTargetSqm = Number(allSubs[0]?.rubr_sqm || 0);
            const { rubberSqm, exSqm, total: rubrCurrentSqm } = _sumRubberAndExcluded(parentId);
            const hasRubber = allSubs.some(r => r.classtype === 'rubber') || rubrTargetSqm > 0;
            const rubberLabel = exSqm > 0 ? 'ยางพาราลงทะเบียน + พื้นที่กันออก' : 'ยางพาราลงทะเบียน';

            const areaRecapHtml = `
                <div class="check-section area-recap-section mb-2">
                    <div class="check-section-title">เนื้อที่ขณะนี้ (ประกอบการตรวจสอบ)</div>
                    <div class="area-recap-row">
                        <span class="area-recap-label"><i class="bi bi-geo-alt-fill"></i> โฉนด</span>
                        <span class="area-num">${deedCurrentSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} m²${_areaDiffHtml(deedCurrentSqm, deedTargetSqm)}</span>
                    </div>
                    <div class="area-recap-target">เป้าหมาย: ${deedTargetSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} m²</div>
                    ${hasRubber ? `
                    <div class="area-recap-row mt-2">
                        <span class="area-recap-label"><i class="bi bi-tree-fill"></i> ${rubberLabel}</span>
                        <span class="area-num">${rubrCurrentSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} m²${_areaDiffHtml(rubrCurrentSqm, rubrTargetSqm)}</span>
                    </div>
                    <div class="area-recap-target">เป้าหมาย: ${rubrTargetSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} m²${exSqm > 0 ? ` <span class="area-recap-breakdown">(${rubberSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} ยาง + ${exSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กันออก)</span>` : ''}</div>
                    ` : ''}
                </div>
            `;

            // Per-sub check_shape rows
            const shapeRowsHtml = allSubs.map(r => {
                const label = labelMap[r.classtype] || r.classtype || '?';
                const color = colorMap[r.classtype] || '#666';
                const cs = r.check_shape || '';
                const rowClass = cs === 'ผ่าน' ? 'is-pass' : cs === 'ไม่ผ่าน' ? 'is-fail' : '';
                return `<div class="sub-review-row ${rowClass}" data-subid="${r.sub_id}">
                    <div class="sub-row-header">
                        <span class="sub-id-tag">#${r.sub_id}</span>
                        <span class="sub-class-pill" style="background:${color}18;color:${color};border:1px solid ${color}40;">${label}</span>
                    </div>
                    <select class="form-select form-select-sm sub-check-shape mt-1">${mkOpts(cs)}</select>
                </div>`;
            }).join('');

            $('#id-sub-list').html(allSubs.length ? `
                ${areaRecapHtml}
                <div class="check-section mb-2">
                    <div class="check-section-title">ตรวจสอบโฉนด</div>
                    <select class="form-select deed-check-area">${mkOpts(deedCa)}</select>
                </div>
                <div class="check-section">
                    <div class="check-section-title">ตรวจสอบประเภท</div>
                    <div class="shape-sub-list">${shapeRowsHtml}</div>
                </div>
            ` : '<div class="text-muted small text-center py-2">ไม่พบ sub_id</div>');


            // Last saved info
            const lastReviewer = allSubs.find(r => r.reviewer)?.reviewer || null;
            const lastTs = allSubs.map(r => r.review_ts).filter(Boolean).sort().reverse()[0] || null;
            if (lastReviewer || lastTs) {
                $('#id-reviewer-name').text(lastReviewer || '-');
                if (lastTs) {
                    const d = new Date(lastTs);
                    $('#id-review-time').text(d.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');
                } else {
                    $('#id-review-time').text('');
                }
            } else {
                $('#id-reviewer-name').text('ยังไม่มีการบันทึก');
                $('#id-review-time').text('');
            }

            // Keep remark from clicked sub (shared field)
            $('#id-checker-remark').val(props.remark || '');

            // Keep attached remark image previews in sync (shared field, like remark text)
            _setRemarkImages(_parseRemarkImagesValue(props.remark_image));

            $('#id-batch-actions').css('display', 'flex');
            $('#id-remark-section').show();
            $('#btn-save-id-review').show();
        }
    }

    // ── User: "บันทึกล่าสุด" footer ──
    if (props.user_remark) {
        $('#panel-user-info').show();
        $('#panel-user-name').text('-');
        if (props.user_remark_ts) {
            const d = new Date(props.user_remark_ts);
            $('#panel-user-time').text(d.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');
        } else {
            $('#panel-user-time').text('');
        }
    } else {
        $('#panel-user-info').show();
        $('#panel-user-name').text('ยังไม่มีการบันทึก');
        $('#panel-user-time').text('');
    }

    // ── Status summary badge ──
    const ca = props.check_area || '';
    const cs = props.check_shape || '';
    let statusHtml = '';
    if (!ca && !cs) {
        statusHtml = '<span class="badge bg-secondary" style="font-size:0.7rem;">⏳ ยังไม่ตรวจ</span>';
    } else if (ca === 'ผ่าน' && cs === 'ผ่าน') {
        statusHtml = '<span class="badge bg-success" style="font-size:0.7rem;">✅ ผ่านทั้งหมด</span>';
    } else if (ca === 'ไม่ผ่าน' || cs === 'ไม่ผ่าน') {
        statusHtml = '<span class="badge bg-danger" style="font-size:0.7rem;">❌ มีไม่ผ่าน</span>';
    } else {
        statusHtml = '<span class="badge bg-secondary" style="font-size:0.7rem;">⏳ ยังไม่ตรวจ</span>';
    }
    // status summary badge removed (replaced by per-ID panel)

    // ✅ Navigation Update (Counter)
    try {
        const dt = $('#featureTable').DataTable();
        const allRows = dt.rows({ search: 'applied' }).data().toArray();
        const allUniqueIds = [...new Set(allRows.map(r => String(r.id)))];
        const uniqueIds = (_userRole !== 'worker' && _adminNavFilter !== 'all')
            ? allUniqueIds.filter(id => getIdStatus(allRows, id) === _adminNavFilter)
            : allUniqueIds;
        const currentIdIdx = uniqueIds.indexOf(String(props.id));
        if (currentIdIdx !== -1) {
            $('#plot-nav-count').text(`${currentIdIdx + 1} / ${uniqueIds.length}`);
        } else {
            $('#plot-nav-count').text(`- / ${uniqueIds.length}`);
        }
    } catch (e) {
        console.warn('DataTable not ready for counter');
    }
}

const getFeatureStyle = (feature) => {
    const color = feature.properties.classtype === 'rubber'
        ? '#006d2c'
        : feature.properties.classtype === 'Other'
            ? '#ff0004ff'
            : feature.properties.classtype === 'not-rubber'
                ? '#9900ffff'
                : feature.properties.classtype === 'ex_age_rubber'
                    ? '#00ff0dff'
                    : feature.properties.classtype === 'ex_building'
                        ? '#ff00d4ff'
                        : feature.properties.classtype === 'ex_pond'
                            ? '#00fff2ff'
                            : feature.properties.classtype === 'ex_cr_area'
                                ? '#ffff00ff'
                                : feature.properties.classtype === 'ex_ar_area'
                                    ? '#00008bff'
                                    : feature.properties.classtype === 'ex_other'
                                        ? '#AACDDCff'
                                        : '#fdae61';
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.5
    };
};


const onEachFeature = (feature, layer) => {
    layer.on('click', () => {
        // Restore previous focused polygon style
        if (_focusedLayer) {
            try { _focusedLayer.layer.setStyle(_focusedLayer.originalStyle); } catch (_) { }
            _focusedLayer = null;
            _focusedSubId = null;
        }

        _currentReviewId = null;

        // Use full rowData from DataTable so deed_sqm / current_sqm / rubr_sqm are populated
        const _clickedSubId = feature.properties.sub_id;
        let _fullFeature = feature;
        if ($.fn.DataTable.isDataTable('#featureTable')) {
            const _dtRow = $('#featureTable').DataTable().rows().data().toArray()
                .find(r => String(r.sub_id) === String(_clickedSubId));
            if (_dtRow) _fullFeature = { properties: _dtRow };
        }
        showFeaturePanel(_fullFeature, layer);
        selectedLayer = layer;

        // Highlight the matching sub-review-row in checker box
        $('#id-sub-list .sub-review-row').removeClass('active-sub');
        const $activeSubRow = $(`#id-sub-list .sub-review-row[data-subid="${_clickedSubId}"]`);
        $activeSubRow.addClass('active-sub');
        $activeSubRow[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Highlight clicked polygon with bright border + stronger fill
        if (typeof layer.setStyle === 'function') {
            const originalStyle = getFeatureStyle(feature);
            _focusedLayer = { layer, originalStyle };
            _focusedSubId = feature.properties.sub_id;
            layer.setStyle({
                color: '#FFD600',
                fillColor: originalStyle.fillColor,
                weight: 5,
                opacity: 1,
                fillOpacity: 0.75,
                dashArray: null
            });
        }

        // Sync worker quick list: filter to this ID, highlight item, load banner
        if (_userRole === 'worker') {
            const subId = feature.properties.sub_id;
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === String(subId));
            if (rowData) {
                buildWorkerPlotList(rowData.id);
                $('.worker-plot-item').removeClass('active');
                const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
                $item.addClass('active');
                $item[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                _updateWorkerSelectedBanner(rowData);
            }
        }
    });
};

const loadGeoData = async () => {
    try {
        const tb = document.getElementById('tb').value;
        const response = await fetch(`/rub/api/getreclassfeatures/${tb}`);
        const result = await response.json();

        if (!result.success || !result.data) {
            console.error('API error:', result.error || 'No data returned');
            alert('ไม่สามารถโหลดข้อมูลได้: ' + (result.error || 'ไม่พบข้อมูล'));
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const id_from = parseInt(urlParams.get('id_from'));
        const id_to = parseInt(urlParams.get('id_to'));
        const assignee = urlParams.get('assignee');

        let data = result.data;
        if (!isNaN(id_from) && !isNaN(id_to)) {
            data = result.data.filter(item => item.id >= id_from && item.id <= id_to);
            console.log(`Filtering for ${assignee}: IDs ${id_from} - ${id_to}. Found ${data.length} records.`);

            const infoEl = document.getElementById('assignmentInfo');
            if (infoEl && assignee) {
                infoEl.innerHTML = `
                    <div class="card border-0 shadow-sm" style="border-radius: 15px; background: linear-gradient(135deg, #66bb6a, #2e7d32); color: white;">
                        <div class="card-body p-3">
                            <div class="d-flex align-items-center">
                                <i class="bi bi-person-circle fs-4 me-2"></i>
                                <div>
                                    <div class="small opacity-75">ผู้รับผิดชอบ</div>
                                    <div class="fw-bold fs-5">${assignee}</div>
                                    <div class="small mt-1 px-2 py-1 bg-white bg-opacity-25 rounded-pill d-inline-block">ID: ${id_from} - ${id_to}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // แสดงแปลงของเพื่อนร่วมโปรเจค (นอก range ของตัวเอง) — ใช้สี classtype จริง + ขอบ dashed แดงเพื่อแยกแยะ
        othersFeatureGroup.clearLayers();
        if (!isNaN(id_from) && !isNaN(id_to)) {
            const othersData = result.data.filter(item => item.id < id_from || item.id > id_to);
            othersData.forEach(item => {
                let geom = null;
                try { geom = JSON.parse(item.geom); } catch (_) {}
                if (!geom) return;
                const classStyle = getFeatureStyle({ properties: { classtype: item.classtype } });
                L.geoJson({ type: 'Feature', geometry: geom, properties: { id: item.id, classtype: item.classtype } }, {
                    interactive: false,
                    style: {
                        fillColor: classStyle.fillColor,
                        fillOpacity: 0.35,
                        color: '#FF2D55',
                        weight: 2,
                        opacity: 0.9
                    }
                }).addTo(othersFeatureGroup);
            });
        }

        const tableData = data.map(item => ({
            id: item.id,
            sub_id: item.sub_id,
            refinal: item.refinal,
            geom: JSON.parse(item.geom),
            geom_point: item.geom_point ? JSON.parse(item.geom_point) : null, // จุดอ้างอิงเดิม (GPS) จากแปลงหลัก
            id_farmer: item.farmer_id || '',
            regis_no: item['Regis_No'] || '',
            farm_name: item.farm_name || '',
            f_name: item['F_name'] || '',
            l_name: item['L_name'] || '',
            age: item['Para_Age'] || '',
            deed_id: item['Deed_ID'] || '',
            deed_sqm: item['Deed_Sqm'] || 0,
            deed_total: item['Deed_Area'] || 0,
            rubr_sqm: item['Rubr_Sqm'] || 0,
            rubr_total: item['class_Area'] || 0,
            current_sqm: item['Sqm_Deed'] || item.shpsplit_sqm || 0,
            current_rai: item['Sqm_Deed'] ? item['Sqm_Deed'] / 1600 : (item.shpsplit_sqm / 1600 || 0),
            shpsplit_sqm: item.shpsplit_sqm,
            class_Area: item.class_Area,
            classtype: item.classtype,
            check_area: item.check_area || '',
            check_shape: item.check_shape || '',
            remark: item.remark || '',
            remark_image: item.remark_image || '',
            reviewer: item.reviewer || '',
            user_remark: item.user_remark || '',

            user_remark_ts: item.user_remark_ts || '',
            review_ts: item.review_ts || '',
            topology_status: item.topology_status || '',
            topology_detail: item.topology_detail || null
        }));

        // ปัดเศษเนื้อที่ต่อคลาส (shpsplit_sqm) ด้วยวิธี "largest remainder" ต่อแปลง (id) เดียวกัน
        // เพื่อให้ผลรวมเนื้อที่ของทุกคลาสในแปลงนั้นเท่ากับ "เนื้อที่ขณะนี้โฉนด" ที่ปัดเศษแล้วเป๊ะ
        // (ปัดแยกแต่ละแถวอิสระจากกันแล้วบวก จะคลาดเคลื่อน ±1 ตร.ม. ได้ตามหลัก apportionment)
        const shpsplitRoundedById = {};
        const idRowsForRounding = {};
        tableData.forEach(r => {
            (idRowsForRounding[r.id] || (idRowsForRounding[r.id] = [])).push(r);
        });
        Object.keys(idRowsForRounding).forEach(id => {
            const rows = idRowsForRounding[id];
            const currentSqms = rows.map(r => Number(r.current_sqm || 0));
            const sameDeedForAll = rows.length > 1 && currentSqms.every(v => Math.abs(v - currentSqms[0]) < 0.5);

            if (!sameDeedForAll) {
                rows.forEach(r => { shpsplitRoundedById[`${r.id}::${r.sub_id}`] = Math.round(Number(r.shpsplit_sqm || 0)); });
                return;
            }

            const deedTotal = Math.round(currentSqms[0]);
            const raws = rows.map(r => Number(r.shpsplit_sqm || 0));
            const floors = raws.map(v => Math.floor(v));
            const sumFloors = floors.reduce((a, b) => a + b, 0);
            const remainder = Math.max(0, Math.min(deedTotal - sumFloors, rows.length));
            const byFracDesc = raws.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
            const rounded = [...floors];
            for (let k = 0; k < remainder; k++) rounded[byFracDesc[k].i] += 1;
            rows.forEach((r, idx) => { shpsplitRoundedById[`${r.id}::${r.sub_id}`] = rounded[idx]; });
        });
        _shpsplitRoundedById = shpsplitRoundedById;

        // รวมเนื้อที่ "ยางพารา" + "กันออกทุกชนิด (ex_*)" ต่อ ID เดียวกัน
        // เพราะพื้นที่กันออก (เช่น ถนน, บ่อน้ำ, สิ่งปลูกสร้าง) ยังถือเป็นส่วนหนึ่งของ
        // แปลงยางเดิม ต้องนับรวมเข้าเป้าหมายยางพารา ไม่ใช่หักออกไปเฉยๆ
        const idAreaAgg = {};
        const _seenIdAreaSubIds = new Set(); // กันแถวซ้ำ (sub_id ซ้ำ) ไม่ให้บวกพื้นที่ซ้ำสองรอบ
        tableData.forEach(r => {
            const key = `${r.id}::${r.sub_id}`;
            if (_seenIdAreaSubIds.has(key)) return;
            _seenIdAreaSubIds.add(key);
            const agg = idAreaAgg[r.id] || (idAreaAgg[r.id] = { rubberSqm: 0, exSqm: 0 });
            const val = shpsplitRoundedById[key] ?? Math.round(Number(r.shpsplit_sqm || 0));
            if (r.classtype === 'rubber') agg.rubberSqm += val;
            else if (String(r.classtype || '').startsWith('ex_')) agg.exSqm += val;
        });

        const dataTable = $('#featureTable').DataTable({
            data: tableData,
            scrollX: true,
            initComplete: function () { _applyWorkerVisibility(); _applyAdminVisibility(); updateAdminStatusCounts(); },
            columns: [
                {
                    data: null,
                    title: 'Zoom',
                    orderable: false,
                    render: (data, type, row) => {
                        const _geojson = JSON.stringify(row.geom);
                        const urlParams = new URLSearchParams(window.location.search);
                        const id_from = urlParams.get('id_from');
                        const id_to = urlParams.get('id_to');
                        const assignee = urlParams.get('assignee');

                        let reclassUrl = `./../reclass/index.html?tb=${document.getElementById('tb').value}&id=${row.id}&Rubr_Sqm=${row.rubr_sqm}`;
                        if (id_from && id_to && assignee) {
                            reclassUrl += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
                        }

                        return `<a class="btn btn-success btn-sm map-btn"
                                    data-refid="${row.id}"
                                    data-subid="${row.sub_id}"
                                    data-geojson='${_geojson}'
                                    href="#"><i class="bi bi-zoom-in"></i> ซูม</a>
                                <a class="btn btn-warning btn-sm mt-1" 
                                    href="${reclassUrl}"
                                    ><i class="bi bi-pencil-square"></i> แก้ไข</a>`
                    }
                },
                { data: 'id', title: 'ID' },
                { data: 'id_farmer', title: 'เลขทะเบียนเกษตรกร' },
                { data: 'regis_no', title: 'เลขที่ทะเบียน (Regis_No)' },
                {
                    data: 'farm_name',
                    title: 'ชื่อเกษตรกร',
                    render: (data) => data ? `<span title="${data}">${data}</span>` : '<span class="text-muted">-</span>'
                },
                {
                    data: 'age',
                    title: 'อายุ (ปี)',
                    render: (data) => data ? `<b>${Number(data).toFixed(0)}</b>` : '<span class="text-muted">-</span>'
                },
                { data: 'deed_id', title: 'เลขโฉนด' },
                {
                    data: 'deed_sqm',
                    title: 'เนื้อที่เป้าหมายโฉนด (m²)',
                    render: (data) => {
                        const val = Number(data);
                        if (val === 0) return `<span class="area-num area-target">0 <small style="color:gray">(ยาง)</small></span>`;
                        return `<span class="area-num area-target">${val.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`;
                    }
                },
                {
                    data: 'current_sqm',
                    title: 'เนื้อที่ขณะนี้โฉนด (m²)',
                    render: (data, type, row) => {
                        const cur = Number(data || 0);
                        const deedSqm = Number(row.deed_sqm || 0);
                        const rubrSqm = Number(row.rubr_sqm || 0);
                        const target = deedSqm > 0 ? deedSqm : rubrSqm;
                        return `<span class="area-num">${cur.toLocaleString('th-TH', { maximumFractionDigits: 0 })}${_areaDiffHtml(cur, target)}</span>`;
                    }
                },
                {
                    data: 'rubr_sqm',
                    title: 'เนื้อที่เป้าหมายยางพารา (m²)',
                    render: (data, type, row) => {
                        if (row.classtype !== 'rubber') return `<span class="text-muted">-</span>`;
                        return `<span class="area-num area-yang">${Number(data).toLocaleString('th-TH', { maximumFractionDigits: 0 })}</span>`;
                    }
                },
                {
                    data: 'shpsplit_sqm',
                    title: 'เนื้อที่ขณะนี้คลาส (m²)',
                    render: (data, type, row) => {
                        const roundedVal = shpsplitRoundedById[`${row.id}::${row.sub_id}`] ?? Math.round(Number(data || 0));
                        const valStr = roundedVal.toLocaleString('th-TH', { maximumFractionDigits: 0 });
                        const agg = idAreaAgg[row.id] || { rubberSqm: 0, exSqm: 0 };

                        if (row.classtype === 'rubber') {
                            const total = agg.rubberSqm + agg.exSqm;
                            const totalStr = total.toLocaleString('th-TH', { maximumFractionDigits: 0 });
                            const rubrSqm = Number(row.rubr_sqm || 0);
                            const diffHtml = _areaDiffHtml(total, rubrSqm);
                            const breakdownHtml = agg.exSqm > 0
                                ? `<div class="text-muted" style="font-size:0.68rem; line-height:1.2;">${valStr} ยาง + ${agg.exSqm.toLocaleString('th-TH', { maximumFractionDigits: 0 })} กันออก</div>`
                                : '';
                            return `<span class="area-num">${totalStr}${diffHtml}</span>${breakdownHtml}`;
                        }

                        if (String(row.classtype || '').startsWith('ex_')) {
                            return `<span class="area-num">${valStr}</span>
                                <div style="font-size:0.68rem; line-height:1.2; color:#166534;">
                                    <i class="bi bi-check-circle-fill"></i> รวมในเป้าหมายยางแล้ว
                                </div>`;
                        }

                        return `<span class="area-num">${valStr}</span>`;
                    }
                },
                {
                    data: 'classtype',
                    title: 'ประเภท',
                    render: (data) => {
                        const labelMap = {
                            'rubber': 'ยางพาราที่ลงทะเบียน', 'not-rubber': 'ยางพาราที่ไม่ได้ลงทะเบียน',
                            'Other': 'ไม่ใช่ยางพารา', 'ex_age_rubber': 'พื้นที่กันออก (ยางพาราต่างอายุ)',
                            'ex_building': 'พื้นที่กันออก (สิ่งปลูกสร้าง)', 'ex_pond': 'พื้นที่กันออก (บ่อน้ำ)',
                            'ex_cr_area': 'พื้นที่กันออก (ถนนคอนกรีต)',
                            'ex_ar_area': 'พื้นที่กันออก (ถนนลาดยาง)',
                            'ex_other': 'พื้นที่กันออก (เพิ่มเติม)'
                        };
                        const colorMap = {
                            'rubber': '#006d2c', 'not-rubber': '#9900ff', 'Other': '#ff0004',
                            'ex_age_rubber': '#00ff0d', 'ex_building': '#ff00d4', 'ex_pond': '#00fff2',
                            'ex_cr_area': '#ffff00', 'ex_ar_area': '#00008b',
                            'ex_other': '#AACDDC'
                        };
                        const label = labelMap[data] || 'อื่นๆ';
                        const c = colorMap[data] || '#90a4ae';
                        return `<span class="classtype-badge" style="background:${c}15;color:#000;border:1px solid ${c}40; font-weight: 500;">${label}</span>`;
                    }
                },
                {
                    data: 'check_area',
                    title: 'ตรวจสอบโฉนด',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'type' || type === 'filter') return data || '';
                        if (_userRole === 'worker') {
                            if (data === 'ผ่าน') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#d1fae5;color:#065f46;font-size:0.82rem;font-weight:700;border:1.5px solid #6ee7b7;white-space:nowrap;"><i class="bi bi-check-circle-fill"></i> ผ่าน</span>`;
                            if (data === 'ไม่ผ่าน') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:0.82rem;font-weight:700;border:1.5px solid #fca5a5;white-space:nowrap;"><i class="bi bi-x-circle-fill"></i> ไม่ผ่าน</span>`;
                            if (!row.classtype) return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:0.82rem;font-weight:700;border:1.5px solid #cbd5e1;white-space:nowrap;"><i class="bi bi-dash-circle"></i> ยังไม่จำแนกประเภท</span>`;
                            return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#fffbeb;color:#b45309;font-size:0.82rem;font-weight:700;border:1.5px solid #fde68a;white-space:nowrap;"><i class="bi bi-hourglass-split"></i> รอตรวจ</span>`;
                        }
                        const passSelected = data === 'ผ่าน' ? 'selected' : '';
                        const failSelected = data === 'ไม่ผ่าน' ? 'selected' : '';
                        return `<select class="form-select form-select-sm review-check-area" data-subid="${row.sub_id}">
                                    <option value="">-- เลือก --</option>
                                    <option value="ผ่าน" ${passSelected}>✅ ผ่าน</option>
                                    <option value="ไม่ผ่าน" ${failSelected}>❌ ไม่ผ่าน</option>
                                </select>`;
                    }
                },
                {
                    data: 'check_shape',
                    title: 'ตรวจสอบการจำเเนกประเภท',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'type' || type === 'filter') return data || '';
                        if (_userRole === 'worker') {
                            if (data === 'ผ่าน') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#d1fae5;color:#065f46;font-size:0.82rem;font-weight:700;border:1.5px solid #6ee7b7;white-space:nowrap;"><i class="bi bi-check-circle-fill"></i> ผ่าน</span>`;
                            if (data === 'ไม่ผ่าน') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:0.82rem;font-weight:700;border:1.5px solid #fca5a5;white-space:nowrap;"><i class="bi bi-x-circle-fill"></i> ไม่ผ่าน</span>`;
                            if (!row.classtype) return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:0.82rem;font-weight:700;border:1.5px solid #cbd5e1;white-space:nowrap;"><i class="bi bi-dash-circle"></i> ยังไม่จำแนกประเภท</span>`;
                            return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#fffbeb;color:#b45309;font-size:0.82rem;font-weight:700;border:1.5px solid #fde68a;white-space:nowrap;"><i class="bi bi-hourglass-split"></i> รอตรวจ</span>`;
                        }
                        const passSelected = data === 'ผ่าน' ? 'selected' : '';
                        const failSelected = data === 'ไม่ผ่าน' ? 'selected' : '';
                        return `<select class="form-select form-select-sm review-check-shape" data-subid="${row.sub_id}">
                                    <option value="">-- เลือก --</option>
                                    <option value="ผ่าน" ${passSelected}>✅ ผ่าน</option>
                                    <option value="ไม่ผ่าน" ${failSelected}>❌ ไม่ผ่าน</option>
                                </select>`;
                    }
                },
                {
                    data: 'topology_status',
                    title: 'ซ้อนทับ',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'type' || type === 'filter') return data || '';
                        const detail = row.topology_detail || [];
                        const esc = s => String(s).replace(/"/g, '&quot;');
                        const pill = (bg, color, border, icon, label, subid, tip) => {
                            const tag = subid ? 'button' : 'span';
                            const cls = subid ? 'topo-goto' : '';
                            const subidAttr = subid ? `data-subid="${esc(subid)}"` : '';
                            const style = `display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:${bg};color:${color};font-size:0.82rem;font-weight:700;border:1.5px solid ${border};white-space:nowrap;${subid ? 'cursor:pointer;' : ''}`;
                            return `<${tag} class="${cls}" ${subidAttr} title="${esc(tip)}" style="${style}"><i class="bi ${icon}"></i> ${label}</${tag}>`;
                        };
                        if (data === 'overlap') {
                            const names = detail.filter(d => d.type === 'overlap').map(d => `${d.id} (${d.overlap_sqm} ตร.ม.)`).join(', ');
                            return pill('#fee2e2', '#991b1b', '#fca5a5', 'bi-exclamation-octagon-fill', 'ซ้อนทับ', detail[0]?.sub_id, names || 'ซ้อนทับกับแปลงอื่น');
                        }
                        if (data === 'ok') {
                            return pill('#d1fae5', '#065f46', '#6ee7b7', 'bi-check-circle-fill', 'ปกติ', null, 'ไม่พบปัญหาซ้อนทับ');
                        }
                        return pill('#f1f5f9', '#64748b', '#cbd5e1', 'bi-dash-circle', 'ยังไม่เช็ค', null, 'ยังไม่เคยเช็ค topology');
                    }
                },
                {
                    data: 'remark',
                    title: 'หมายเหตุผู้เช็ค',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'filter' || type === 'type') return data || '';
                        const hasImg = !!row.remark_image;
                        const hasData = !!(data && data.trim()) || hasImg;
                        const imgIcon = hasImg ? ' <i class="bi bi-camera-fill"></i>' : '';
                        const eyeBtn = hasData
                            ? `<button class="btn btn-outline-secondary btn-note-popup" type="button"
                                data-subid="${row.sub_id}" data-type="checker" title="ดูข้อมูลเต็ม">
                                <i class="bi bi-eye"></i>${imgIcon}</button>`
                            : '';
                        if (_userRole === 'worker') {
                            if (hasData) {
                                return `<button class="btn btn-note-popup"
                                    data-subid="${row.sub_id}" data-type="checker"
                                    title="${(data || '').replace(/"/g, '&quot;')}"
                                    style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#f0fdf4;color:#166534;font-size:0.82rem;font-weight:600;border:1.5px solid #86efac;white-space:nowrap;cursor:pointer;">
                                    <i class="bi bi-eye-fill"></i> ดูหมายเหตุ${imgIcon}
                                </button>`;
                            }
                            return `<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:999px;background:#f1f5f9;color:#94a3b8;font-size:0.82rem;border:1.5px solid #e2e8f0;white-space:nowrap;">
                                <i class="bi bi-dash-circle"></i> -
                            </span>`;
                        }
                        return `<div class="input-group input-group-sm" style="min-width:180px;">
                            <input type="text" class="form-control form-control-sm review-remark"
                                data-subid="${row.sub_id}"
                                value="${(data || '').replace(/"/g, '&quot;')}"
                                placeholder="พิมพ์หมายเหตุ...">
                            ${eyeBtn}
                        </div>`;
                    }
                },
                {
                    data: 'user_remark',
                    title: 'หมายเหตุผู้ใช้',
                    width: '260px',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'filter' || type === 'type') return data || '';
                        let dateStr = '';
                        if (row.user_remark_ts) {
                            const date = new Date(row.user_remark_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 user-remark-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        const hasData = !!(data && data.trim());
                        const eyeBtn = hasData
                            ? `<button class="btn btn-outline-secondary btn-note-popup" type="button"
                                data-subid="${row.sub_id}" data-type="user" title="ดูข้อมูลเต็ม">
                                <i class="bi bi-eye"></i></button>`
                            : '';
                        return `<div style="min-width: 260px;">
                            <div class="input-group input-group-sm">
                                <input type="text" class="form-control user-remark"
                                    data-subid="${row.sub_id}"
                                    value="${(data || '').replace(/"/g, '&quot;')}"
                                    placeholder="แก้ไขแล้ว / รายละเอียด...">
                                <button class="btn btn-outline-primary btn-save-user-remark" type="button" data-subid="${row.sub_id}" title="บันทึกหมายเหตุผู้ใช้">
                                    <i class="bi bi-floppy"></i>
                                </button>
                                ${eyeBtn}
                                <button class="btn btn-outline-danger btn-clear-user-remark" type="button" data-subid="${row.sub_id}" title="ลบหมายเหตุผู้ใช้" ${!data && !row.user_remark_ts ? 'style="display:none;"' : ''}>
                                    <i class="bi bi-trash3-fill"></i>
                                </button>
                            </div>
                            ${dateStr}
                        </div>`;
                    }
                },
                {
                    data: 'reviewer',
                    title: 'ผู้ตรวจสอบ',
                    width: '280px',
                    render: (data, type, row) => {
                        if (type === 'sort' || type === 'filter' || type === 'type') {
                            return data || '';
                        }

                        let dateStr = '';
                        if (row.review_ts) {
                            const date = new Date(row.review_ts);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 reviewer-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }
                        if (_userRole === 'worker') {
                            return `<div>${data ? `<span>${data}</span>` : '<span class="text-muted">-</span>'}${dateStr}</div>`;
                        }
                        return `
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="reviewer-input-container" style="flex-grow: 1;">
                                <input type="text" class="form-control form-control-sm review-reviewer"
                                    data-subid="${row.sub_id}"
                                    value="${data || ''}"
                                    readonly
                                    placeholder="ชื่อผู้ตรวจ...">
                                ${dateStr}
                            </div>
                        </div>`;
                    }
                },
                {
                    data: null,
                    title: 'บันทึก',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-save-review" data-subid="${row.sub_id}">
                                    <i class="bi bi-floppy"></i> บันทึก
                                </button>`;
                    }
                },
                {
                    data: null,
                    title: 'ลบ',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-delete-row" data-subid="${row.sub_id}" data-parentid="${row.id}" title="ลบแถวนี้">
                                    <i class="bi bi-trash3-fill"></i>
                                </button>`;
                    }
                },
                {
                    data: null,
                    title: 'ประวัติ',
                    orderable: false,
                    render: (data, type, row) => {
                        return `<button class="btn btn-sm btn-outline-info btn-review-history" data-id="${row.id}" title="ดูประวัติการตรวจสอบ">
                                    <i class="bi bi-clock-history"></i>
                                </button>`;
                    }
                },
            ],
            pageLength: 10,
            order: [[1, 'asc']],
            select: true,
            destroy: true,
            createdRow: function (row, data) {
                if (data.check_area === 'ผ่าน' && data.check_shape === 'ผ่าน') {
                    $(row).addClass('row-checked-pass');
                } else if (data.check_area === 'ไม่ผ่าน' || data.check_shape === 'ไม่ผ่าน') {
                    $(row).addClass('row-checked-fail');
                }
            }
        });

        // ── Filter status buttons (check_area/check_shape ผ่าน/ไม่ผ่าน) ──
        $(document).off('click.filterBtn').on('click.filterBtn', '.btn-filter-status[data-filter]', function () {
            const clickedFilter = $(this).data('filter') || '';
            _activeFilter = clickedFilter;
            $('.btn-filter-status[data-filter]').removeClass('active');
            $(this).addClass('active');
            dataTable.draw();
        });

        // ── Filter topology buttons (ซ้อนทับ/ปกติ) — independent axis from _activeFilter ──
        $(document).off('click.filterTopoBtn').on('click.filterTopoBtn', '.btn-filter-status[data-topofilter]', function () {
            _activeTopoFilter = $(this).data('topofilter') || '';
            $('.btn-filter-status[data-topofilter]').removeClass('active');
            $(this).addClass('active');
            $('#topologyStatusBar .admin-status-card').removeClass('active');
            if (_activeTopoFilter) $(`#topologyStatusBar .admin-status-card[data-topostatus="${_activeTopoFilter}"]`).addClass('active');
            _refreshNavCounterForFilter();
        });

        // ── Topology badge click → zoom/focus the first conflicting neighbor plot ──
        $('#featureTable tbody').on('click', '.topo-goto', function (e) {
            e.stopPropagation();
            const subId = $(this).data('subid');
            const dt = $('#featureTable').DataTable();
            const neighborRow = dt.rows().data().toArray().find(r => String(r.sub_id) === String(subId));
            if (neighborRow) focusPlot(neighborRow);
        });

        // ── Dirty tracking for user remark textarea ──
        $('#panel-user-remark').off('input.dirty').on('input.dirty', function () {
            _panelUserDirty = true;
            $('#user-dirty-badge').show();
        });

        // ── Batch pass / fail all sub_ids of current ID ──
        $('#btn-batch-pass, #btn-batch-fail').on('click', function () {
            const val = $(this).is('#btn-batch-pass') ? 'ผ่าน' : 'ไม่ผ่าน';
            $('#id-sub-list .deed-check-area').val(val);
            $('#id-sub-list .sub-review-row').each(function () {
                $(this).find('.sub-check-shape').val(val);
                $(this).removeClass('is-pass is-fail');
                $(this).addClass(val === 'ผ่าน' ? 'is-pass' : 'is-fail');
            });
        });

        // ── Click sub_id row → zoom to polygon + update area cards ──
        $('#id-sub-list').on('click', '.sub-review-row', function (e) {
            if ($(e.target).is('select')) return;
            const subId = String($(this).data('subid'));
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
            if (!rowData) return;

            // Restore previous focused polygon (re-apply group dashed if still a sibling)
            if (_focusedLayer) {
                try {
                    const prevLayer = _focusedLayer.layer;
                    const prevOrigStyle = _focusedLayer.originalStyle;
                    const inGroup = _highlightedLayers.some(h => h.layer === prevLayer);
                    if (inGroup) {
                        prevLayer.setStyle({ color: '#FFD600', fillColor: prevOrigStyle.fillColor, weight: 3, opacity: 1, fillOpacity: 0.45, dashArray: '5,3' });
                    } else {
                        prevLayer.setStyle(prevOrigStyle);
                    }
                } catch (_) { }
                _focusedLayer = null;
                _focusedSubId = null;
            }

            // Zoom to this polygon
            if (rowData.geom) {
                try {
                    const b = L.geoJSON(rowData.geom).getBounds();
                    if (b.isValid()) map.flyToBounds(b, { padding: [50, 50], maxZoom: 22, duration: 0.6 });
                } catch (_) { }
            }

            // Apply solid focused highlight and track it
            const lyr = findLayerBySubId(subId);
            if (lyr && typeof lyr.setStyle === 'function') {
                const origStyle = getFeatureStyle({ properties: rowData });
                _focusedLayer = { layer: lyr, originalStyle: origStyle };
                _focusedSubId = subId;
                lyr.setStyle({ color: '#FF6600', fillColor: origStyle.fillColor, weight: 6, opacity: 1, fillOpacity: 0.75, dashArray: null });
            }

            // Update area info cards to reflect this sub_id's classtype + area
            _updateAreaCards(rowData);

            // Mark active row
            $('#id-sub-list .sub-review-row').removeClass('active-sub');
            $(this).addClass('active-sub');
        });

        // ── Update row highlight when check_shape changes ──
        $('#id-sub-list').on('change', '.sub-check-shape', function () {
            const row = $(this).closest('.sub-review-row');
            const cs = $(this).val();
            row.removeClass('is-pass is-fail');
            if (cs === 'ผ่าน') row.addClass('is-pass');
            else if (cs === 'ไม่ผ่าน') row.addClass('is-fail');
        });

        // ── Save all sub_ids of current ID ──
        $('#btn-save-id-review').on('click', async function () {
            const tb = $('#tb').val();
            const remark = $('#id-checker-remark').val();
            const remarkImage = $('#id-remark-image-url').val() || null;
            const displayName = document.getElementById('display-name')?.textContent || '';
            const rows = $('#id-sub-list .sub-review-row');
            if (!rows.length) { alert('กรุณาเลือกแปลงก่อน'); return; }

            // Deed-level check_area shared across all sub_ids
            const deedCheckArea = $('#id-sub-list .deed-check-area').val();

            const btn = $(this);
            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');

            const saves = [];
            rows.each(function () {
                const subId = $(this).data('subid');
                const checkArea = deedCheckArea;
                const checkShape = $(this).find('.sub-check-shape').val();
                saves.push(fetch(`/rub/api/update_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sub_id: subId, check_area: checkArea, check_shape: checkShape, remark, remark_image: remarkImage, reviewer: displayName })
                }).then(r => r.json()).then(data => ({ subId, checkArea, checkShape, data })));
            });

            try {
                const results = await Promise.all(saves);
                const dataTable = $('#featureTable').DataTable();
                let allOk = true;

                // For rejected sub_ids, also clear user_remark
                const clearSaves = [];
                results.forEach(({ subId, checkArea, checkShape, data }) => {
                    if (!data.success) { allOk = false; return; }
                    const isRejected = checkArea === 'ไม่ผ่าน' || checkShape === 'ไม่ผ่าน';
                    if (isRejected) {
                        clearSaves.push(
                            fetch(`/rub/api/update_user_remark/${tb}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sub_id: subId, user_remark: '' })
                            }).then(r => r.json()).then(() => subId).catch(() => subId)
                        );
                    }
                });
                if (clearSaves.length) await Promise.all(clearSaves);

                results.forEach(({ subId, checkArea, checkShape, data }) => {
                    if (!data.success) return;
                    const isRejected = checkArea === 'ไม่ผ่าน' || checkShape === 'ไม่ผ่าน';
                    const tableRow = dataTable.row((idx, d) => String(d.sub_id) === String(subId));
                    if (tableRow.any()) {
                        const rd = tableRow.data();
                        rd.check_area = checkArea; rd.check_shape = checkShape;
                        rd.remark = remark; rd.remark_image = remarkImage; rd.reviewer = displayName;
                        rd.review_ts = data.data?.[0]?.review_ts || new Date().toISOString();
                        if (isRejected) {
                            rd.user_remark = '';
                            rd.user_remark_ts = '';
                                                    }
                        tableRow.data(rd).draw(false);
                        const node = tableRow.node();
                        if (node) {
                            $(node).removeClass('row-checked-pass row-checked-fail');
                            if (checkArea === 'ผ่าน' && checkShape === 'ผ่าน') $(node).addClass('row-checked-pass');
                            else if (isRejected) $(node).addClass('row-checked-fail');
                        }
                    }
                });

                // Update saved-by footer
                const now = new Date();
                $('#id-reviewer-name').text(displayName || '-');
                $('#id-review-time').text(now.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.');
                // id-reviewer-info always visible

                updateAdminStatusCounts();
                buildWorkerPlotList(_currentReviewId);
                btn.html('<i class="bi bi-check-circle-fill"></i> บันทึกแล้ว').removeClass('btn-success').addClass('btn-primary');
                setTimeout(() => btn.html('<i class="bi bi-floppy-fill me-1"></i> บันทึกผลการตรวจ').removeClass('btn-primary').addClass('btn-success').prop('disabled', false), 2000);

                if (!allOk) alert('บางรายการบันทึกไม่สำเร็จ');
            } catch (err) {
                console.error('Save ID review error:', err);
                alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
                btn.prop('disabled', false).html('<i class="bi bi-floppy-fill me-1"></i> บันทึกผลการตรวจ');
            }
        });

        // Panel Save User Remark Button Handler
        $('#panel-btn-save-user').on('click', async function () {
            const subId = $('#panel-sub-id').val();
            const tb = $('#tb').val();
            if (!subId) { alert('กรุณาเลือกข้อมูลก่อน'); return; }

            const btn = $(this);
            const userRemark = $('#panel-user-remark').val();
            const displayName = document.getElementById('display-name')?.textContent || '';

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');

            try {
                const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        user_remark: userRemark
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-circle-fill"></i> เรียบร้อย');
                    _panelUserDirty = false;
                    $('#user-dirty-badge').hide();

                    const dataTable = $('#featureTable').DataTable();
                    const tableRow = dataTable.row((idx, d) => d.sub_id == subId);

                    if (tableRow.any()) {
                        const rowData = tableRow.data();
                        rowData.user_remark = userRemark;
                                                rowData.user_remark_ts = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();
                        tableRow.data(rowData).draw(false);
                        // Re-populate panel but preserve dirty=false
                        showFeaturePanel({ properties: rowData });
                    }

                    setTimeout(() => {
                        btn.html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้');
                }
            } catch (err) {
                console.error('User Remark Save Error:', err);
                alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
                btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุผู้ใช้');
            }
        });



        // Panel Clear User Remark Button Handler
        $('#panel-btn-clear-user').on('click', function () {
            const subId = $('#panel-sub-id').val();
            if (!subId) { alert('กรุณาเลือกข้อมูลก่อน'); return; }
            if (confirm('ยืนยันลบหมายเหตุผู้ใช้ ใช่หรือไม่?')) {
                $('#panel-user-remark').val('');
                $('#panel-btn-save-user').click();
            }
        });

        // Sync Table Selection to Panel (auto-save user remark if dirty before switching)
        $('#featureTable tbody').on('click', 'tr', async function () {
            if (_panelUserDirty) await autoSaveUserRemark();
            const data = $('#featureTable').DataTable().row(this).data();
            if (data) {
                // Reset ID cache so new click always refreshes the panel
                _currentReviewId = null;
                showFeaturePanel({ properties: data });
            }
        });

        // แก้ปัญหาตารางไม่ตรงช่องเมื่อวาดเสร็จ
        setTimeout(() => {
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust().draw();
            }
        }, 500);

        // แก้ปัญหาเวลาขยายลากจอ
        let resizeDebounce;
        $(window).on('resize', function () {
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust();
            }
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(() => map.invalidateSize(), 200);
        });


        // ✅ Search Panel Plot
        $('#btn-panel-search').on('click', function () {
            const val = $('#search-plot-id').val().trim();
            if (!val) return;

            const dt = $('#featureTable').DataTable();
            // Try specific ID search
            let foundData = dt.rows().data().toArray().find(r => r.id == val || r.sub_id == val || r.id_farmer == val);

            if (foundData) {
                const layer = findLayerBySubId(foundData.sub_id);
                if (layer) {
                    if (typeof layer.getBounds === 'function' && layer.getBounds().isValid()) {
                        map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                    } else if (typeof layer.getLatLng === 'function') {
                        map.setView(layer.getLatLng(), 19);
                    }
                    showFeaturePanel({ properties: foundData });
                }
            } else {
                // Generic search
                dt.search(val).draw();
                const firstResult = dt.rows({ search: 'applied' }).data()[0];
                if (firstResult) {
                    const layer = findLayerBySubId(firstResult.sub_id);
                    if (layer) {
                        if (typeof layer.getBounds === 'function' && layer.getBounds().isValid()) {
                            map.fitBounds(layer.getBounds(), { padding: [50, 50] });
                        } else if (typeof layer.getLatLng === 'function') {
                            map.setView(layer.getLatLng(), 19);
                        }
                        showFeaturePanel({ properties: firstResult });
                    }
                    // Highlight first result
                    const rowNode = dt.row((idx, d) => d.sub_id == firstResult.sub_id).node();
                    if (rowNode) {
                        rowNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        $(rowNode).addClass('selected').siblings().removeClass('selected');
                    }
                } else {
                    alert('ไม่พบข้อมูลแปลงที่ระบุ');
                }
            }
        });

        $('#search-plot-id').on('keypress', function (e) {
            if (e.which == 13) $('#btn-panel-search').click();
        });

        // ✅ Prev/Next Buttons
        $('#btn-plot-prev').on('click', () => navigatePlots(-1));
        $('#btn-plot-next').on('click', () => navigatePlots(1));
        $('#plot-nav-count').css('cursor', 'pointer').on('click', () => {
            if (!_currentReviewId) return;
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.id) === String(_currentReviewId));
            if (rowData) { _currentReviewId = null; focusPlot(rowData); }
        });

        const updateMap = () => {
            featureGroup.clearLayers(); // Clear existing layers
            pointRefFeatureGroup.clearLayers();
            const visibleRows = dataTable.rows({ search: 'applied' }).data().toArray();

            // แต่ละแปลงหลัก (id) อาจมีหลาย sub_id (จากการ split) แต่มีจุดอ้างอิงเดิมจุดเดียว — กันซ้ำ
            const seenRefIds = new Set();
            visibleRows.forEach(row => {
                if (row.geom_point && row.geom_point.type === 'Point' && !seenRefIds.has(row.id)) {
                    seenRefIds.add(row.id);
                    const [refLng, refLat] = row.geom_point.coordinates;
                    // วงฮาโลสีเหลืองช่วยให้เห็นจุดชัดบนพื้นหลังทุกสี ก่อนวางไอคอนต้นยางทับ
                    L.circleMarker([refLat, refLng], {
                        radius: 10,
                        color: '#ffeb3b',
                        weight: 2,
                        opacity: 0.95,
                        fillColor: '#ffeb3b',
                        fillOpacity: 0.3,
                        interactive: false
                    }).addTo(pointRefFeatureGroup);
                    L.marker([refLat, refLng], {
                        icon: rubberTreeIcon,
                        opacity: 0.9,
                        interactive: false,
                        keyboard: false
                    }).addTo(pointRefFeatureGroup);
                }
            });

            visibleRows.forEach(row => {
                const geojson = {
                    type: 'Feature',
                    geometry: row.geom,
                    properties: {
                        id: row.id,
                        sub_id: row.sub_id,
                        refinal: row.refinal,
                        id_farmer: row.id_farmer,
                        shpsplit_sqm: row.shpsplit_sqm,
                        classtype: row.classtype,
                        check_area: row.check_area,
                        check_shape: row.check_shape,
                        remark: row.remark,
                        user_remark: row.user_remark,
                        reviewer: row.reviewer,
                        review_ts: row.review_ts,
                        user_remark_ts: row.user_remark_ts
                    }
                };

                L.geoJson(geojson, {
                    style: getFeatureStyle,
                    onEachFeature: onEachFeature,
                    pointToLayer: function (feature, latlng) {
                        return L.marker(latlng, { icon: rubberTreeIcon });
                    }
                }).addTo(featureGroup);
            });
        };

        updateMap();

        $('#featureTable tbody').on('click', '.map-btn', function (e) {
            e.stopPropagation();
            const subId = String($(this).data('subid'));
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
            if (rowData) {
                _currentReviewId = null;
                focusPlot(rowData);
                // Mark the clicked sub_id as active in the checker box
                $('#id-sub-list .sub-review-row').removeClass('active-sub');
                const $activeRow = $(`#id-sub-list .sub-review-row[data-subid="${subId}"]`);
                $activeRow.addClass('active-sub');
                $activeRow[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        dataTable.rows().every(function () {
            const rowData = this.data();
            $(this.node()).attr('id', `row_${rowData.id}`);
        });

        // Review history button handler
        $('#featureTable tbody').on('click', '.btn-review-history', async function (e) {
            e.stopPropagation();
            const id = $(this).data('id');
            const tb = document.getElementById('tb').value;

            document.getElementById('history-plot-id').textContent = id;
            const body = document.getElementById('history-modal-body');
            body.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> กำลังโหลด...</div>';

            const modal = new bootstrap.Modal(document.getElementById('reviewHistoryModal'));
            modal.show();

            const reasonLabels = {
                'restore': '🔄 คืนค่าแปลง',
                'reshape': '✏️ ปรับรูปแปลง',
                'manual_clear': '🗑️ ล้างข้อมูล',
                'update_landuse': '🏷️ อัปเดตประเภท',
                'update_geometry': '📐 อัปเดตรูปทรง',
                'split': '✂️ ตัดแบ่งแปลง',
                'unsplit': '🔗 ยกเลิกการตัด — คืนเป็นแปลงเดิม'
            };

            try {
                const res = await fetch(`/rub/api/review_history/${tb}/${id}`);
                const data = await res.json();

                if (!data.success || data.data.length === 0) {
                    body.innerHTML = `<div class="text-center py-5 text-muted">
                        <i class="bi bi-inbox fs-2"></i>
                        <div class="mt-2">ไม่มีประวัติการตรวจสอบสำหรับแปลง ID: ${id}</div>
                        <div class="small mt-1">ประวัติจะถูกบันทึกเมื่อมีการปรับรูปแปลงหรือรีเซตข้อมูล</div>
                    </div>`;
                    return;
                }

                const rows = data.data.map(h => {
                    const resetTs = h.reset_ts ? new Date(h.reset_ts).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + 'น.' : '-';
                    const reviewTs = h.review_ts ? new Date(h.review_ts).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + 'น.' : '-';
                    const caClass = h.check_area === 'ผ่าน' ? 'text-success fw-bold' : h.check_area === 'ไม่ผ่าน' ? 'text-danger fw-bold' : 'text-muted';
                    const csClass = h.check_shape === 'ผ่าน' ? 'text-success fw-bold' : h.check_shape === 'ไม่ผ่าน' ? 'text-danger fw-bold' : 'text-muted';
                    const reason = reasonLabels[h.reset_reason] || (h.reset_reason || '-');
                    return `<tr>
                        <td class="small text-muted text-nowrap">${resetTs}</td>
                        <td><span class="badge bg-secondary">${reason}</span></td>
                        <td class="small">${h.sub_id || '-'}</td>
                        <td class="${caClass}">${h.check_area || '<span class="text-muted">-</span>'}</td>
                        <td class="${csClass}">${h.check_shape || '<span class="text-muted">-</span>'}</td>
                        <td class="small">${h.remark
                            ? `<span class="history-remark-cell"
                                    data-remark="${h.remark.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"
                                    title="คลิกเพื่อดูทั้งหมด">
                                    <span class="history-remark-preview">${h.remark.replace(/</g, '&lt;')}</span>
                                    <i class="bi bi-arrows-angle-expand history-remark-icon"></i>
                               </span>`
                            : '<span class="text-muted">-</span>'}</td>
                        <td class="small text-center">${h.remark_image
                            ? _parseRemarkImagesValue(h.remark_image).map(u => `<img src="${u}" class="history-image-thumb" alt="ภาพประกอบ" title="คลิกเพื่อดูภาพขนาดเต็ม">`).join('')
                            : '<span class="text-muted">-</span>'}</td>
                        <td class="small">${h.reviewer || '<span class="text-muted">-</span>'}</td>
                        <td class="small text-muted text-nowrap">${reviewTs}</td>
                    </tr>`;
                }).join('');

                body.innerHTML = `
                    <div class="table-responsive">
                        <table class="table table-sm table-striped table-bordered align-middle">
                            <thead class="table-info">
                                <tr>
                                    <th>รีเซตเมื่อ</th>
                                    <th>สาเหตุ</th>
                                    <th>Sub ID</th>
                                    <th>ตรวจโฉนด</th>
                                    <th>ตรวจประเภท</th>
                                    <th>หมายเหตุ</th>
                                    <th>ภาพ</th>
                                    <th>ผู้ตรวจ</th>
                                    <th>เวลาตรวจ</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                    <div class="text-muted small mt-1"><i class="bi bi-info-circle"></i> แสดงล่าสุดก่อน · ${data.data.length} รายการ</div>`;
            } catch (err) {
                body.innerHTML = `<div class="text-danger p-3">โหลดไม่ได้: ${err.message}</div>`;
            }
        });

        // History remark cell → popup (delegated on the modal body)
        document.getElementById('history-modal-body').addEventListener('click', function (e) {
            const imgEl = e.target.closest('.history-image-thumb');
            if (imgEl) {
                _openImageLightbox(imgEl.getAttribute('src'));
                return;
            }
            const cell = e.target.closest('.history-remark-cell');
            if (!cell) return;
            const raw = cell.getAttribute('data-remark')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<');
            document.getElementById('notePopupTitle').innerHTML =
                '<i class="bi bi-chat-text me-1"></i>หมายเหตุ — ประวัติการตรวจสอบ';
            document.getElementById('notePopupBody').innerHTML = formatRemarkPopup(raw);
            $('#notePopupModal .modal-dialog').addClass('modal-md').removeClass('modal-xl');
            // raise z-index so popup sits above the history modal
            const noteEl = document.getElementById('notePopupModal');
            noteEl.style.zIndex = 1065;
            const noteModal = bootstrap.Modal.getOrCreateInstance(noteEl);
            noteModal.show();
        });

        // Note popup handler — show full remark text formatted in modal
        $('#featureTable tbody').on('click', '.btn-note-popup', function () {
            const subId = $(this).data('subid');
            const type = $(this).data('type');
            const dt = $('#featureTable').DataTable();
            const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === String(subId));
            if (!rowData) return;
            const text = type === 'checker' ? rowData.remark : rowData.user_remark;
            const images = type === 'checker' ? _parseRemarkImagesValue(rowData.remark_image) : [];
            const title = type === 'checker' ? '<i class="bi bi-shield-check me-1"></i>หมายเหตุผู้เช็ค' : '<i class="bi bi-chat-dots-fill me-1"></i>หมายเหตุผู้ใช้';
            _showNotePopup(text, images, title);
        });

        // Save user remark handler
        $('#featureTable tbody').on('click', '.btn-save-user-remark', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const userRemark = row.find('.user-remark').val();
            const tb = document.getElementById('tb').value;

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

            try {
                const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        user_remark: userRemark
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-lg"></i>').removeClass('btn-outline-primary').addClass('btn-success');

                    const updatedTs = data.data && data.data[0] ? data.data[0].user_remark_ts : new Date().toISOString();
                    const displayName = document.getElementById('display-name')?.textContent || '';

                    const dataTable = $('#featureTable').DataTable();
                    const rowData = dataTable.row(row).data();
                    rowData.user_remark = userRemark;
                    rowData.user_remark_ts = updatedTs;
                    if (displayName)                     dataTable.row(row).data(rowData);

                    let dateStr = '';
                    if (updatedTs) {
                        const date = new Date(updatedTs);
                        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                        dateStr = `<div class="text-muted mt-1 user-remark-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                    }
                    const cellDiv = btn.closest('div').parent();
                    cellDiv.find('.user-remark-time').remove();
                    cellDiv.append(dateStr);

                    if (updatedTs) {
                        cellDiv.find('.btn-clear-user-remark').show();
                    } else {
                        cellDiv.find('.btn-clear-user-remark').hide();
                    }

                    // Sync side panel if this row is currently shown
                    const panelSubId = $('#panel-sub-id').val();
                    if (String(panelSubId) === String(subId)) {
                        $('#panel-user-remark').val(userRemark);
                        if (updatedTs) {
                            const d2 = new Date(updatedTs);
                            const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            $('#panel-user-time').text(d2.toLocaleString('th-TH', opts) + ' น.');
                            $('#panel-user-info').show();
                        }
                        if (displayName) $('#panel-user-name').text(displayName);
                        _panelUserDirty = false;
                        $('#user-dirty-badge').hide();
                    }

                    setTimeout(() => {
                        btn.html('<i class="bi bi-floppy"></i>').removeClass('btn-success').addClass('btn-outline-primary').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.html('<i class="bi bi-floppy"></i>').prop('disabled', false);
                }
            } catch (err) {
                console.error('Save user remark error:', err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.html('<i class="bi bi-floppy"></i>').prop('disabled', false);
            }
        });

        // Clear user remark handler
        $('#featureTable tbody').on('click', '.btn-clear-user-remark', function () {
            const btn = $(this);
            const row = btn.closest('tr');
            if (confirm('ยืนยันลบหมายเหตุผู้ใช้ ใช่หรือไม่?')) {
                row.find('.user-remark').val('');
                row.find('.btn-save-user-remark').click();
            }
        });

        // Save review handler
        $('#featureTable tbody').on('click', '.btn-save-review', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const row = btn.closest('tr');
            const checkArea = row.find('.review-check-area').val();
            const checkShape = row.find('.review-check-shape').val();
            const remark = row.find('.review-remark').val();
            const userRemark = row.find('.user-remark').val();
            const reviewerInput = row.find('.review-reviewer').val();
            const tb = document.getElementById('tb').value;

            // Get reviewer name from profile
            const displayName = document.getElementById('display-name')?.textContent || '';


            // Determine if review-related fields have changed
            const dataTable = $('#featureTable').DataTable();
            const rowData = dataTable.row(row).data();

            const currentReviewer = rowData.reviewer || '';
            const originalCheckArea = rowData.check_area || '';
            const originalCheckShape = rowData.check_shape || '';
            const originalRemark = rowData.remark || '';

            const isReviewChanged = (checkArea !== originalCheckArea) ||
                (checkShape !== originalCheckShape) ||
                (remark !== originalRemark);

            // If login name is available, always use it and update UI
            let reviewerToSave = reviewerInput;
            if (displayName) {
                reviewerToSave = displayName;
                row.find('.review-reviewer').val(displayName);
            }

            // Fallback to current if still no name
            if (!reviewerToSave) {
                reviewerToSave = currentReviewer;
            }

            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

            try {
                const res = await fetch(`/rub/api/update_review/${tb}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sub_id: subId,
                        check_area: checkArea,
                        check_shape: checkShape,
                        remark: remark,
                        user_remark: userRemark,
                        reviewer: reviewerToSave
                    })
                });

                const data = await res.json();
                if (data.success) {
                    btn.html('<i class="bi bi-check-lg"></i> สำเร็จ').addClass('btn-review-saved');
                    const updatedTs = data.data && data.data[0] ? data.data[0].review_ts : new Date().toISOString();

                    // If rejected → clear user_remark so worker must write a fresh note
                    const isRejected = checkArea === 'ไม่ผ่าน' || checkShape === 'ไม่ผ่าน';
                    if (isRejected) {
                        try {
                            await fetch(`/rub/api/update_user_remark/${tb}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sub_id: subId, user_remark: '' })
                            });
                        } catch (_) { }
                    }

                    // Update reviewer input and timestamp in the row
                    if (reviewerToSave) {
                        let dateStr = '';
                        if (updatedTs) {
                            const date = new Date(updatedTs);
                            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
                            dateStr = `<div class="text-muted mt-1 reviewer-time" style="font-size: 0.75rem;"><i class="bi bi-clock"></i> ${date.toLocaleDateString('th-TH', options)}น.</div>`;
                        }

                        const container = row.find('.reviewer-input-container');
                        if (container.length) {
                            container.find('.review-reviewer').val(reviewerToSave);
                            container.find('.reviewer-time').remove();
                            container.append(dateStr);
                        }
                    }

                    // Update internal DataTable data
                    rowData.check_area = checkArea;
                    rowData.check_shape = checkShape;
                    rowData.remark = remark;
                    rowData.reviewer = reviewerToSave;
                    rowData.review_ts = updatedTs;
                    if (isRejected) {
                        rowData.user_remark = '';
                        rowData.user_remark_ts = '';
                        // Clear the input in the table row visually
                        row.find('.user-remark').val('');
                        row.find('.user-remark-time').remove();
                        row.find('.btn-clear-user-remark').hide();
                    } else {
                        rowData.user_remark = userRemark;
                    }
                    dataTable.row(row).data(rowData);

                    // Update row color based on new check status
                    $(row).removeClass('row-checked-pass row-checked-fail');
                    if (checkArea === 'ผ่าน' && checkShape === 'ผ่าน') $(row).addClass('row-checked-pass');
                    else if (isRejected) $(row).addClass('row-checked-fail');

                    // Sync panel if this row is shown
                    const panelSubId = $('#panel-sub-id').val();
                    if (String(panelSubId) === String(subId)) {
                        showFeaturePanel({ properties: rowData });
                    }

                    updateAdminStatusCounts();
                    buildWorkerPlotList(_currentReviewId);

                    setTimeout(() => {
                        btn.html('<i class="bi bi-floppy"></i> บันทึก').removeClass('btn-review-saved').prop('disabled', false);
                    }, 2000);
                } else {
                    alert('บันทึกไม่สำเร็จ: ' + (data.error || 'Unknown error'));
                    btn.html('<i class="bi bi-floppy"></i> บันทึก').prop('disabled', false);
                }
            } catch (err) {
                console.error('Save review error:', err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.html('<i class="bi bi-floppy"></i> บันทึก').prop('disabled', false);
            }
        });

        // Delete row handler
        $('#featureTable tbody').on('click', '.btn-delete-row', async function () {
            const btn = $(this);
            const subId = btn.data('subid');
            const tb = document.getElementById('tb').value;
            if (!confirm(`ยืนยันลบรายการ sub_id: ${subId} ใช่หรือไม่?`)) return;
            btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');
            try {
                const res = await fetch(`/rub/api/delete_reclass_feature/${tb}/${subId}`, {
                    method: 'DELETE'
                });
                const result = await res.json();
                if (result.success) {
                    const row = btn.closest('tr');
                    dataTable.row(row).remove().draw();
                    updateAdminStatusCounts();
                    buildWorkerPlotList(_currentReviewId);
                } else {
                    alert('ลบไม่สำเร็จ: ' + (result.error || 'Unknown error'));
                    btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>');
                }
            } catch (err) {
                alert('เกิดข้อผิดพลาด: ' + err.message);
                btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>');
            }
        });


    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load spatial data');
    }
};

const legend = L.control({ position: 'bottomright' });

legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'legend'),
        categories = ['rubber', 'not-rubber', 'Other', 'ex_age_rubber', 'ex_building', 'ex_pond', 'ex_cr_area', 'ex_ar_area', 'ex_other'],
        labels = [
            'ยางพาราที่ลงทะเบียน',
            'ยางพาราที่ไม่ได้ลงทะเบียน',
            'ไม่ใช่ยางพารา',
            'พื้นที่กันออก (ยางพาราต่างอายุ)',
            'พื้นที่กันออก (สิ่งปลูกสร้าง)',
            'พื้นที่กันออก (บ่อน้ำ)',
            'พื้นที่กันออก (ถนนคอนกรีต)',
            'พื้นที่กันออก (ถนนลาดยาง)',
            'พื้นที่กันออก (เพิ่มเติม)',
            'ขอบเขต Reshape'
        ];

    // Add Reshape legend item first
    div.innerHTML += `<i style="background:#2196F3; width:14px; height:14px; display:inline-block; margin-right:6px; opacity:0.8; border:1px solid #1565C0"></i> ขอบเขต Reshape<br>`;


    for (let i = 0; i < categories.length; i++) {
        const dummy = { properties: { classtype: categories[i] } },
            style = getFeatureStyle(dummy);

        div.innerHTML +=
            `<i style="background:${style.fillColor}; width:14px; height:14px; display:inline-block; margin-right:6px;"></i> ${labels[i]}<br>`;
    }
    return div;
};


legend.addTo(map);

document.getElementById('reshape').addEventListener('click', (e) => {
    e.preventDefault();
    const tb = document.getElementById('tb').value;
    const urlParams = new URLSearchParams(window.location.search);
    const id_from = urlParams.get('id_from');
    const id_to = urlParams.get('id_to');
    const assignee = urlParams.get('assignee');

    let url = `./../reshape/index.html?tb=${tb}`;
    if (id_from && id_to) {
        url += `&id_from=${id_from}&id_to=${id_to}&assignee=${encodeURIComponent(assignee)}`;
    }
    window.location.href = url;
});


/* ══════════════════════════════════════════════════════════
   Task Assignment Progress Card
══════════════════════════════════════════════════════════ */
async function loadTaskProgress(tb, currentUser) {
    const card = document.getElementById('taskProgressCard');
    const listEl = document.getElementById('taskProgressList');
    if (!card || !listEl) return;

    try {
        const res = await fetch(`/rub/api/task-progress/${tb}`);
        const { data } = await res.json();

        if (!data || data.length === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = '';

        const palette = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4', '#FF5722', '#795548'];
        const colorMap = {};
        let ci = 0;
        data.forEach(d => {
            if (!colorMap[d.assignee_name]) { colorMap[d.assignee_name] = palette[ci++ % palette.length]; }
        });

        // Filter to show only current user's progress if specified
        // If user has no assigned tasks, fall back to showing all (admin/supervisor view)
        let displayData = data;
        let isPersonalView = false;
        if (currentUser) {
            const myData = data.filter(d =>
                d.assignee_name.toLowerCase().includes(currentUser.toLowerCase())
            );
            if (myData.length > 0) {
                displayData = myData;
                isPersonalView = true;
            }
            // else: currentUser has no assignments → show all (fall through)
        }

        let overallHtml = '';
        if ((!currentUser || !isPersonalView) && data.length > 0) {
            const totalDone = data.reduce((acc, item) => acc + (item.done || 0), 0);
            const totalTotal = data.reduce((acc, item) => acc + (item.total || 0), 0);
            const totalPct = totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0;

            overallHtml = `
                <div class="tp-overall mb-3 p-3 shadow-sm" style="border-radius: 12px; background: linear-gradient(135deg, #f1f8e9, #ffffff); border: 1px solid #c8e6c9;">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <div class="fw-bold" style="color: #2e7d32;"><i class="bi bi-people-fill me-2"></i>ความคืบหน้าภาพรวม</div>
                        <div class="fw-bold" style="color: #2e7d32;">${totalPct}%</div>
                    </div>
                    <div class="progress" style="height: 10px; border-radius: 10px; background-color: rgba(76, 175, 80, 0.1);">
                        <div class="progress-bar" role="progressbar" style="width: ${totalPct}%; background: linear-gradient(90deg, #66bb6a, #43a047); border-radius: 10px;" 
                             aria-valuenow="${totalPct}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="text-muted small mt-2" style="font-size: 0.75rem;">
                        ทำเสร็จแล้ว <b>${totalDone}</b> จากทั้งหมด <b>${totalTotal}</b> แปลงในโครงการนี้
                    </div>
                </div>
            `;
        }

        listEl.innerHTML = overallHtml + displayData.map(d => {
            const c = colorMap[d.assignee_name];
            const pct = d.pct || 0;
            const isMe = currentUser && d.assignee_name.toLowerCase().includes(currentUser.toLowerCase());
            const meBadge = isMe ? `<span class="tp-me-badge">คุณ</span>` : '';

            let tsStr = '';
            if (d.last_ts) {
                const dt = new Date(d.last_ts);
                tsStr = `<div class="tp-ts"><i class="bi bi-clock"></i> ${dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}น.</div>`;
            }

            let editorStr = '';
            if (d.last_editor) {
                editorStr = `<div class="tp-editor"><i class="bi bi-pencil-fill"></i> แก้ล่าสุดโดย <b>${d.last_editor}</b></div>`;
            }

            return `
            <div class="tp-block ${isMe ? 'tp-block-me' : ''}" style="--tp-color:${c};">
                <div class="tp-header">
                    ${d.assignee_photo ? `<img src="${d.assignee_photo}" class="tp-avatar" onerror="this.style.display='none'">` : `<div class="tp-avatar-placeholder" style="background:${c};">${d.assignee_name.charAt(0).toUpperCase()}</div>`}
                    <div class="tp-info">
                        <div class="tp-name">${d.assignee_name} ${meBadge}</div>
                        <div class="tp-range" style="color:${c};">ID ${d.id_from} – ${d.id_to} <span class="tp-total">(${d.total} รายการ)</span></div>
                    </div>
                    <div class="tp-pct" style="color:${c};">${pct}%</div>
                </div>
                <div class="tp-bar-bg">
                    <div class="tp-bar-fill" style="width:${pct}%; background:${c};"></div>
                </div>
                <div class="tp-sub">
                    <span class="tp-done-count">${d.done}/<b>${d.total}</b> แปลงเสร็จแล้ว</span>
                    ${editorStr}
                    ${tsStr}
                </div>
                ${d.note ? `<div class="tp-note"><i class="bi bi-info-circle"></i> ${d.note}</div>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error('loadTaskProgress error:', e);
    }
}







document.addEventListener('DOMContentLoaded', async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tb = urlParams.get('tb');
        if (!tb || tb === 'undefined') {
            alert('พื้นที่ไม่ถูกต้อง');
            window.location.href = './../index.html';
        }

        document.getElementById('tb').value = tb;
        await loadGeoData();
        if (featureGroup.getLayers().length > 0) {
            map.fitBounds(featureGroup.getBounds());
        }

        // Invalidate map size so it fills its container
        setTimeout(() => {
            map.invalidateSize();
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                $('#featureTable').DataTable().columns.adjust();
            }
        }, 200);


        // Load reshape polygon data as overlay layer
        try {
            const reshapeRes = await fetch('/rub/api/getreshapefeatures/' + tb);
            const reshapeResult = await reshapeRes.json();
            if (reshapeResult.success && reshapeResult.data) {
                reshapeFeatureGroup.clearLayers();
                reshapeResult.data.forEach(item => {
                    if (!item.geom) return;
                    const geom = JSON.parse(item.geom);
                    const geojson = {
                        type: 'Feature',
                        geometry: geom,
                        properties: {
                            id: item.id,
                            Farmer_ID: item['Farmer_ID'],
                            deed_sqm: item['Deed_Sqm'] || 0,
                            sqm_deed: item['Sqm_Deed'] || 0
                        }
                    };
                    L.geoJson(geojson, {
                        style: () => ({
                            fillColor: '#2196F3',
                            weight: 2,
                            opacity: 0.8,
                            color: '#1565C0',
                            dashArray: '5,5',
                            fillOpacity: 0.12
                        }),
                        onEachFeature: (feature, layer) => {
                            layer.bindPopup(`<b>Reshape</b><br>ID: ${feature.properties.id}<br>เลขลงทะเบียนเกษตรกร: ${feature.properties['Farmer_ID']}`);
                        }
                    }).addTo(reshapeFeatureGroup);
                });
            }
        } catch (reshapeErr) {
            console.error('Error loading reshape data:', reshapeErr);
        }

        const response = await fetch('/rub/api/countsfeatures/' + tb);
        const data = await response.json();

        const chartData = [
            { name: 'จำนวนทั้งหมด', y: parseInt(data.total), color: '#7cb5ec' },
            { name: 'ปรับแก้เนื้อที่แล้ว', y: parseInt(data.reshp), color: '#434348' },
            { name: 'Classified แล้ว', y: parseInt(data.reclass), color: '#90ed7d' }
        ];

        Highcharts.chart('container', {
            chart: { type: 'bar', height: 150, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { type: 'category', },
            yAxis: { min: 0, title: { text: 'จำนวน (แปลง)', style: { fontFamily: 'Noto Sans Thai' } } },
            series: [{
                name: 'Counts',
                data: chartData,
                dataLabels: { enabled: true, format: '{y}' }
            }],
            tooltip: { pointFormat: '<b>{point.y}</b> แปลง' },
            credits: { enabled: false },
            legend: { enabled: false }
        });

        const raiFetch = await fetch('/rub/api/countsrai/reclass_' + tb);
        const raiData = await raiFetch.json();

        // ── Load task assignment progress ──
        const view = urlParams.get('view');
        const assignee = urlParams.get('assignee');
        const loginUser = document.getElementById('display-name')?.textContent || '';
        const currentUser = (view === 'all') ? null : (assignee || loginUser);
        await loadTaskProgress(tb, currentUser);

        // จัดกลุ่มประเภทต่างๆ ก่อนแสดงผล เพื่อป้องกันแถวซ้ำกัน (เช่น มี "ไม่ระบุ" หลายอัน)
        const groupedData = {};
        raiData.forEach(r => {
            let cat = 'ไม่ระบุ';
            if (r.classtype === 'rubber') cat = 'ยางพาราที่ลงทะเบียน';
            else if (r.classtype === 'not-rubber') cat = 'ยางพาราที่ไม่ได้ลงทะเบียน';
            else if (r.classtype === 'Other') cat = 'ไม่ใช่ยางพารา';
            else if (r.classtype === 'ex_age_rubber') cat = 'พื้นที่กันออก (ยางพาราต่างอายุ)';
            else if (r.classtype === 'ex_building') cat = 'พื้นที่กันออก (สิ่งปลูกสร้าง)';
            else if (r.classtype === 'ex_pond') cat = 'พื้นที่กันออก (บ่อน้ำ)';
            else if (r.classtype === 'ex_cr_area') cat = 'พื้นที่กันออก (ถนนคอนกรีต)';
            else if (r.classtype === 'ex_ar_area') cat = 'พื้นที่กันออก (ถนนลาดยาง)';
            else if (r.classtype === 'ex_other') cat = 'พื้นที่กันออก (เพิ่มเติม)';

            groupedData[cat] = (groupedData[cat] || 0) + parseFloat(r.area_rai);
        });

        const categories = Object.keys(groupedData);
        const dataRai = Object.values(groupedData).map(val => Number(val.toFixed(2)));

        // คำนวณความสูงให้สมดุลกับจำนวนแท่งกราฟ (ขั้นต่ำ 150px)
        const dynamicHeight = Math.max(150, categories.length * 45 + 50);

        Highcharts.chart('count-rai', {
            chart: { type: 'bar', height: dynamicHeight, style: { fontFamily: 'Noto Sans Thai' } },
            title: { text: null },
            xAxis: { categories: categories, },
            yAxis: { min: 0, title: { text: 'เนื้อที่ (ไร่)' } },
            tooltip: { pointFormat: '<b>{point.y:.2f} ไร่</b>' },
            series: [{
                name: 'Area',
                data: dataRai,
                color: '#29b6f6',
                dataLabels: { enabled: true, format: '{y}' }
            }],
            credits: { enabled: false },
            legend: { enabled: false }
        });

    } catch (err) {
        console.error('Error fetching data:', err);
    }
});



// ── Worker quick panel: delete (clear) remark for selected plot ──
$(document).on('click', '#worker-sel-delete', async function () {
    const subId = String($('#worker-sel-save').data('subid'));
    const tb = $('#tb').val();
    if (!subId || subId === 'undefined') return;
    if (!confirm('ลบหมายเหตุสำหรับแปลงนี้?')) return;

    const displayName = document.getElementById('display-name')?.textContent || '';
    const btn = $(this);
    btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i>');

    try {
        const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: '' })
        });
        const data = await res.json();
        if (data.success) {
            $('#worker-sel-remark').val('');
            // Update DataTable row
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                const dt = $('#featureTable').DataTable();
                const tableRow = dt.row((idx, d) => String(d.sub_id) === subId);
                if (tableRow.any()) {
                    const rd = tableRow.data();
                    rd.user_remark = ''; rd.user_remark_ts = '';
                    tableRow.data(rd).draw(false);
                }
            }
            // Remove note preview from worker list item
            $(`.worker-plot-item[data-subid="${subId}"] .worker-plot-note`).remove();
        }
    } catch (e) { console.error(e); }
    finally { btn.prop('disabled', false).html('<i class="bi bi-trash3-fill"></i>'); }
});

// ── Worker quick panel: prev / next ID navigation ──
$(document).on('click', '#btn-worker-prev', () => navigatePlots(-1));
$(document).on('click', '#btn-worker-next', () => navigatePlots(1));

// ── Status cards ("ข้อมูลแปลง" panel) — ทุกการ์ดกรองตาราง+อัปเดต nav counter แบบเดียวกัน
// คลิกแล้วไฮไลต์เหลือง เเสดงเฉพาะแปลง (ทุกแถวย่อย) ของ id ที่ตรงสถานะที่คลิก คลิกซ้ำ = ล้างตัวกรอง
const _refreshNavCounterForFilter = () => {
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    dt.draw();
    const allRows = dt.rows({ search: 'applied' }).data().toArray();
    const filteredIds = [...new Set(allRows.map(r => String(r.id)))];
    const currentIdx = _currentReviewId ? filteredIds.indexOf(String(_currentReviewId)) : -1;
    $('#plot-nav-count').text(`${currentIdx >= 0 ? currentIdx + 1 : '-'} / ${filteredIds.length}`);
};

// ── Admin status filter cards ──
$(document).on('click', '#adminStatusBar .admin-status-card', function () {
    const clickedStatus = $(this).data('status');
    // Toggle: click active button again → clear filter
    if (_adminNavFilter === clickedStatus) {
        _adminNavFilter = 'all';
        $('#adminStatusBar .admin-status-card').removeClass('active');
    } else {
        _adminNavFilter = clickedStatus;
        $('#adminStatusBar .admin-status-card').removeClass('active');
        $(this).addClass('active');
    }
    _refreshNavCounterForFilter();
});

// ── Topology status cards — act as shortcuts for the topology filter buttons ──
$(document).on('click', '#topologyStatusBar .admin-status-card', function () {
    const clickedStatus = $(this).data('topostatus');
    _activeTopoFilter = (_activeTopoFilter === clickedStatus) ? '' : clickedStatus;
    $('#topologyStatusBar .admin-status-card').removeClass('active');
    $('.btn-filter-status[data-topofilter]').removeClass('active');
    if (_activeTopoFilter) {
        $(this).addClass('active');
        $(`.btn-filter-status[data-topofilter="${_activeTopoFilter}"]`).addClass('active');
    } else {
        $('.btn-filter-status[data-topofilter=""]').addClass('active');
    }
    _refreshNavCounterForFilter();
});

// ── Worker status filter tabs ──
$(document).on('click', '#workerStatusFilter .worker-status-card', function () {
    const clickedFilter = $(this).data('filter');
    // Toggle: click active button again → clear filter
    if (_workerStatusFilter === clickedFilter) {
        _workerStatusFilter = 'all';
        $('#workerStatusFilter .worker-status-card').removeClass('active');
    } else {
        _workerStatusFilter = clickedFilter;
        $('#workerStatusFilter .worker-status-card').removeClass('active');
        $(this).addClass('active');
    }
    buildWorkerPlotList(_currentReviewId || null);
});

// ── Worker ID search input ──
$(document).on('input', '#worker-id-search', function () {
    const searchVal = $(this).val().trim();
    // ค้นหาข้ามทุก ID เมื่อพิมพ์, กลับ ID ปัจจุบันเมื่อล้าง
    buildWorkerPlotList(searchVal ? null : (_currentReviewId || null));
});

// ── Worker quick panel: ปุ่ม "ดูข้อความ" / "ดูรูปภาพ" ในแถบหมายเหตุผู้เช็ก ──
$(document).on('click', '.btn-checker-note-view', function (e) {
    e.stopPropagation();
    const subId = String($(this).data('subid'));
    const kind = $(this).data('kind');
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
    if (!rowData) return;
    if (kind === 'img') {
        _showNotePopup('', _parseRemarkImagesValue(rowData.remark_image), '<i class="bi bi-camera-fill me-1"></i>รูปภาพจากผู้เช็ค');
    } else {
        _showNotePopup(rowData.remark, [], '<i class="bi bi-shield-check me-1"></i>หมายเหตุผู้เช็ค');
    }
});

// ── Worker quick panel: click plot item → zoom + highlight + load banner ──
$(document).on('click', '.worker-plot-item', function () {
    const subId = String($(this).data('subid'));
    if (!$.fn.DataTable.isDataTable('#featureTable')) return;
    const dt = $('#featureTable').DataTable();
    const rowData = dt.rows().data().toArray().find(r => String(r.sub_id) === subId);
    if (!rowData) return;
    _currentReviewId = String(rowData.id);
    focusPlot(rowData);
});

// ── Worker quick panel: save remark for currently selected plot ──
$(document).on('click', '#worker-sel-save', async function () {
    const subId = String($(this).data('subid'));
    const tb = $('#tb').val();
    if (!subId || subId === 'undefined') { alert('กรุณาเลือกแปลงก่อน'); return; }
    const remark = $('#worker-sel-remark').val();
    const displayName = document.getElementById('display-name')?.textContent || '';
    const btn = $(this);
    btn.prop('disabled', true).html('<i class="bi bi-hourglass-split"></i> กำลังบันทึก...');
    try {
        const res = await fetch(`/rub/api/update_user_remark/${tb}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sub_id: subId, user_remark: remark })
        });
        const data = await res.json();
        if (data.success) {
            const updatedTs = data.data?.[0]?.user_remark_ts || new Date().toISOString();
            // Update DataTable row
            if ($.fn.DataTable.isDataTable('#featureTable')) {
                const dt = $('#featureTable').DataTable();
                const tableRow = dt.row((idx, d) => String(d.sub_id) === subId);
                if (tableRow.any()) {
                    const rd = tableRow.data();
                    rd.user_remark = remark; rd.user_remark_ts = updatedTs;
                    tableRow.data(rd).draw(false);
                }
            }
            // Update note preview in the worker list item
            const $item = $(`.worker-plot-item[data-subid="${subId}"]`);
            const $noteDiv = $item.find('.worker-plot-note');
            const preview = remark ? remark.substring(0, 25) + (remark.length > 25 ? '…' : '') : '';
            if (preview && $noteDiv.length) {
                $noteDiv.html(`<i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${preview}`);
            } else if (preview) {
                $item.find('.worker-plot-info').append(
                    `<div class="worker-plot-note"><i class="bi bi-chat-dots-fill" style="font-size:0.65rem;"></i> ${preview}</div>`
                );
            } else {
                $noteDiv.remove();
            }
            btn.html('<i class="bi bi-check-circle-fill"></i> บันทึกแล้ว!');
            setTimeout(() => btn.html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ').prop('disabled', false), 2000);
        } else {
            alert('บันทึกไม่สำเร็จ'); btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ');
        }
    } catch (e) {
        console.error(e);
        btn.prop('disabled', false).html('<i class="bi bi-send-fill me-1"></i> บันทึกหมายเหตุ');
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/rub/auth/me');
        const { user } = await res.json();
        // console.log(user);

        if (user) {
            // Show profile section
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

            _userRole = user.role || 'worker';
            _applyWorkerVisibility();
            _applyAdminVisibility();

            // Force update counts now that role is known (fixes race condition with DataTable init)
            updateAdminStatusCounts();
            buildWorkerPlotList(_currentReviewId || null);

            // Re-load progress with correct user identity after login
            const urlParams = new URLSearchParams(window.location.search);
            const tb = urlParams.get('tb');
            const view = urlParams.get('view');
            const assignee = urlParams.get('assignee');
            if (tb) {
                // If view=all, show everyone's progress. Otherwise prioritize assignee then own name.
                const currentUser = (view === 'all') ? null : (assignee || user.displayName);
                await loadTaskProgress(tb, currentUser);
            }

            // Logout handler
            document.getElementById('logout-link').addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch('/rub/auth/logout');
                    window.location.reload();
                } catch (err) {
                    console.error('Logout failed:', err);
                }
            });
        }
    } catch (err) {
        console.error('Failed to fetch user:', err);
    }
});

