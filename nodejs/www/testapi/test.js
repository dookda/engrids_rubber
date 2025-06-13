document.getElementById("run-code").addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
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

            // get page URL
            const pageUrl = window.location.href;
            // Check if the URL contains 'landsmaps.dol.go.th'
            if (!pageUrl.includes('landsmaps.dol.go.th')) {
                console.error('This script should only be run on landsmaps.dol.go.th');
                alert('This script should only be run on landsmaps.dol.go.th :)');
                return;
            }

            // 2. Sample amphoe data
            var amphur = sessionStorage.getItem('amphur');
            const data = amphur ? JSON.parse(amphur).result : null;

            var userinfo = sessionStorage.getItem('userinfo');
            const API_TOKEN = userinfo ? JSON.parse(userinfo).access_token : null;

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
            heading.textContent = '📍 เอาจริงละนะ';
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

            // add input for parcel number
            const parcelLabel = document.createElement('label');
            parcelLabel.textContent = 'เลขที่แปลงที่ดิน: ';
            parcelLabel.htmlFor = 'parcelInput';
            const parcelInput = document.createElement('input');
            parcelInput.id = 'parcelInput';
            parcelInput.type = 'text';
            parcelInput.placeholder = 'กรุณากรอกเลขที่แปลงที่ดิน';
            parcelInput.style.margin = '0 10px 10px 10px';
            container.appendChild(parcelLabel);
            container.appendChild(parcelInput);

            // add button 
            const searchButton = document.createElement('button');
            searchButton.textContent = '🔍 ค้นหาแปลงที่ดิน';
            searchButton.id = 'searchButton';
            searchButton.style.margin = '0 0 10px 10px';
            container.appendChild(searchButton);

            searchButton.addEventListener('click', async () => {
                const selectedPv = pvSelect.value;
                const selectedAm = amSelect.value;
                const parcelNumber = parcelInput.value.trim();
                if (!selectedPv || selectedPv === '00') {
                    console.log('กรุณาเลือกจังหวัด');
                    return;
                }
                if (!selectedAm) {
                    console.log('กรุณาเลือกอำเภอ');
                    return;
                }
                if (!parcelNumber) {
                    console.log('กรุณากรอกเลขที่แปลงที่ดิน');
                    return;
                }

                if (selectedPv && selectedAm) {
                    const amphoe = data.find(d => d.pvcode === selectedPv && d.amcode === selectedAm);
                    if (amphoe) {
                        console.log(`Selected Province: ${provinces.find(p => p.code === selectedPv).name}`);
                        console.log(`Selected Amphoe: ${amphoe.amnamethai}`);
                        // Call the API with the selected province and amphoe
                        try {
                            await getPacelByPacelNumber(selectedPv, selectedAm, parcelNumber); // Replace '123456' with actual parcel number
                            console.log('API call successful');
                        } catch (error) {
                            console.error('Error fetching parcel data:', error);
                        }
                    } else {
                        console.log('ไม่พบข้อมูลอำเภอที่เลือก');
                    }
                } else {
                    console.log('กรุณาเลือกจังหวัดและอำเภอ');
                }
            });

            const instructions = document.createElement('p');
            container.appendChild(instructions)
            const divTxt = document.createElement('div');
            divTxt.id = 'copyDiv';
            divTxt.style.cursor = 'pointer';
            divTxt.style.padding = '10px';
            divTxt.style.background = '#f9f9f9';
            divTxt.style.border = '1px solid #ddd';

            // Add it to the body
            container.appendChild(divTxt)

            // Define the copy function
            function copyTextFromDiv() {
                const text = document.getElementById("copyDiv").innerText;
                navigator.clipboard.writeText(text)
                    .then(() => alert("Copied to clipboard!"))
                    .catch(err => alert("Failed to copy"));
            }

            async function getPacelByPacelNumber(province, amphur, parcelnumber) {
                divTxt.innerText = "";
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
                if (!parcelInfo) {
                    console.log('ไม่พบข้อมูลแปลงที่ดิน');
                    return;
                }
                console.log('ข้อมูลแปลงที่ดิน:', parcelInfo);

                const geoParams = new URLSearchParams({
                    viewparams: `utmmap:${parcelInfo.utm1}${parcelInfo.utm2}${parcelInfo.utm3}`,
                    service: 'WMS',
                    version: '1.1.1',
                    request: 'GetFeatureInfo',
                    layers: 'LANDSMAPS:V_PARCEL47,LANDSMAPS:V_PARCEL48',
                    bbox: `${parcelInfo.parcellon},${parcelInfo.parcellat},${(Number(parcelInfo.parcellon) + 0.000001).toFixed(6)},${(Number(parcelInfo.parcellat) + 0.000001).toFixed(6)}`,
                    width: '256',
                    height: '256',
                    srs: 'EPSG:4326',
                    query_layers: 'LANDSMAPS:V_PARCEL47,LANDSMAPS:V_PARCEL48',
                    info_format: 'application/json',
                    x: '128',
                    y: '128'
                });
                const url = `https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?${geoParams}`;
                console.log(url)

                divTxt.innerText = url;
                divTxt.onclick = copyTextFromDiv;
            }

        }
    });
});
