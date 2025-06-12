// 1. JSON for province names
const provinces = [
    { "code": "00", "name": "กรุณาเลือกจังหวัด" },
    { "code": "81", "name": "กระบี่" },
    { "code": "10", "name": "กรุงเทพมหานคร" },
    { "code": "71", "name": "กาญจนบุรี" },
    { "code": "46", "name": "กาฬสินธุ์" },
    { "code": "62", "name": "กำแพงเพชร" },
    { "code": "40", "name": "ขอนแก่น" },
    { "code": "22", "name": "จันทบุรี" },
    { "code": "24", "name": "ฉะเชิงเทรา" },
    { "code": "20", "name": "ชลบุรี" },
    { "code": "18", "name": "ชัยนาท" },
    { "code": "36", "name": "ชัยภูมิ" },
    { "code": "86", "name": "ชุมพร" },
    { "code": "57", "name": "เชียงราย" },
    { "code": "50", "name": "เชียงใหม่" },
    { "code": "92", "name": "ตรัง" },
    { "code": "23", "name": "ตราด" },
    { "code": "63", "name": "ตาก" },
    { "code": "26", "name": "นครนายก" },
    { "code": "73", "name": "นครปฐม" },
    { "code": "48", "name": "นครพนม" },
    { "code": "30", "name": "นครราชสีมา" },
    { "code": "80", "name": "นครศรีธรรมราช" },
    { "code": "60", "name": "นครสวรรค์" },
    { "code": "12", "name": "นนทบุรี" },
    { "code": "96", "name": "นราธิวาส" },
    { "code": "55", "name": "น่าน" },
    { "code": "38", "name": "บึงกาฬ" },
    { "code": "31", "name": "บุรีรัมย์" },
    { "code": "13", "name": "ปทุมธานี" },
    { "code": "77", "name": "ประจวบคีรีขันธ์" },
    { "code": "25", "name": "ปราจีนบุรี" },
    { "code": "94", "name": "ปัตตานี" },
    { "code": "14", "name": "พระนครศรีอยุธยา" },
    { "code": "56", "name": "พะเยา" },
    { "code": "82", "name": "พังงา" },
    { "code": "93", "name": "พัทลุง" },
    { "code": "66", "name": "พิจิตร" },
    { "code": "65", "name": "พิษณุโลก" },
    { "code": "76", "name": "เพชรบุรี" },
    { "code": "67", "name": "เพชรบูรณ์" },
    { "code": "54", "name": "แพร่" },
    { "code": "83", "name": "ภูเก็ต" },
    { "code": "44", "name": "มหาสารคาม" },
    { "code": "49", "name": "มุกดาหาร" },
    { "code": "58", "name": "แม่ฮ่องสอน" },
    { "code": "35", "name": "ยโสธร" },
    { "code": "95", "name": "ยะลา" },
    { "code": "45", "name": "ร้อยเอ็ด" },
    { "code": "85", "name": "ระนอง" },
    { "code": "21", "name": "ระยอง" },
    { "code": "70", "name": "ราชบุรี" },
    { "code": "16", "name": "ลพบุรี" },
    { "code": "52", "name": "ลำปาง" },
    { "code": "51", "name": "ลำพูน" },
    { "code": "42", "name": "เลย" },
    { "code": "33", "name": "ศรีสะเกษ" },
    { "code": "47", "name": "สกลนคร" },
    { "code": "90", "name": "สงขลา" },
    { "code": "91", "name": "สตูล" },
    { "code": "11", "name": "สมุทรปราการ" },
    { "code": "75", "name": "สมุทรสงคราม" },
    { "code": "74", "name": "สมุทรสาคร" },
    { "code": "27", "name": "สระแก้ว" },
    { "code": "19", "name": "สระบุรี" },
    { "code": "17", "name": "สิงห์บุรี" },
    { "code": "64", "name": "สุโขทัย" },
    { "code": "72", "name": "สุพรรณบุรี" },
    { "code": "84", "name": "สุราษฎร์ธานี" },
    { "code": "32", "name": "สุรินทร์" },
    { "code": "43", "name": "หนองคาย" },
    { "code": "39", "name": "หนองบัวลำภู" },
    { "code": "15", "name": "อ่างทอง" },
    { "code": "37", "name": "อำนาจเจริญ" },
    { "code": "41", "name": "อุดรธานี" },
    { "code": "53", "name": "อุตรดิตถ์" },
    { "code": "61", "name": "อุทัยธานี" },
    { "code": "34", "name": "อุบลราชธานี" }
];

// 2. Sample amphoe data
var amphur = sessionStorage.getItem('amphur');
const data = amphur ? JSON.parse(amphur).result : null;

// 3. Create UI elements
const container = document.createElement('div');
container.style.padding = '15px';
container.style.borderBottom = '2px solid #ccc';
container.style.backgroundColor = '#f0f0f0';
container.style.position = 'relative';
container.style.zIndex = '9999';
container.style.fontFamily = 'Arial, sans-serif';

// 3. Add heading
const heading = document.createElement('h3');
heading.textContent = '📍 Select Province and Amphoe';
heading.style.margin = '0 0 10px 0';
container.appendChild(heading);

const pvLabel = document.createElement('label');
pvLabel.textContent = 'จังหวัด: ';
pvLabel.htmlFor = 'pvSelect';
container.appendChild(pvLabel);

const pvSelect = document.createElement('select');
pvSelect.id = 'pvSelect';
pvSelect.style.margin = '0 20px 10px 10px';
container.appendChild(pvSelect);

const amLabel = document.createElement('label');
amLabel.textContent = 'อำเภอ: ';
amLabel.htmlFor = 'amSelect';
container.appendChild(amLabel);

const amSelect = document.createElement('select');
amSelect.id = 'amSelect';
amSelect.style.margin = '0 0 10px 10px';
container.appendChild(amSelect);

// Insert at top of body
document.body.insertBefore(container, document.body.firstChild);

// Populate provinces
provinces.forEach(prov => {
    const opt = document.createElement('option');
    opt.value = prov.code;
    opt.textContent = prov.name;
    pvSelect.appendChild(opt);
});

// Event: province change updates amphoes
pvSelect.addEventListener('change', () => {
    const selectedPv = pvSelect.value;
    amSelect.innerHTML = '<option value="">-- เลือกอำเภอ --</option>';
    data.filter(d => d.pvcode === selectedPv).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.amcode;
        opt.textContent = d.amnamethai;
        amSelect.appendChild(opt);
    });
});

// amSelect.addEventListener('change', () => {
//     const selectedPv = pvSelect.value;
//     const selectedAm = amSelect.value;
//     if (selectedPv && selectedAm) {
//         const amphoe = data.find(d => d.pvcode === selectedPv && d.amcode === selectedAm);
//         // console.log(`Selected Province: ${provinces.find(p => p.code === selectedPv).code}`);
//         console.log(`Selected Amphoe: ${amphoe ? amphoe.pvcode : 'ไม่พบข้อมูล'}`);
//         console.log(`Selected Amphoe: ${amphoe ? amphoe.amcode : 'ไม่พบข้อมูล'}`);
//     }
//     else {
//         console.log('กรุณาเลือกจังหวัดและอำเภอ');
//     }
// });

async function getPacelByPacelNumber(province, amphur, parcelnumber) {
    const parcelRes = await fetch(
        `https://landsmaps.dol.go.th/apiService/LandsMaps/GetParcelByParcelNo/${province}/${amphur}/${parcelnumber}`,
        {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Accept': 'application/json'
            }
        }
    );

    if (!parcelRes.ok) throw new Error(`Parcel API failed with status ${parcelRes.status}`);

    const parcelJson = await parcelRes.json();
    const parcelInfo = parcelJson?.result?.[0];
}



