document.getElementById("run-code").addEventListener("click", async () => {
    Swal.close();
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            const pageUrl = window.location.href;
            // Check if the URL contains 'landsmaps.dol.go.th'
            if (!pageUrl.includes('landsmaps.dol.go.th')) {
                console.error('This script should only be run on landsmaps.dol.go.th');
                alert('This script should only be run on landsmaps.dol.go.th :)');
                return;
            }

            const urlParams = new URLSearchParams(window.location.search);
            const province = urlParams.get('province');
            const amphur = urlParams.get('amphur');
            const parcelnumber = urlParams.get('parcelnumber');
            if (!province || !amphur || !parcelnumber) {
                console.error('Missing province or amphoe or parcelNumber');
                alert('Missing province or amphoe or parcelNumber');
                return;
            }

            var userinfo = sessionStorage.getItem('userinfo');
            const API_TOKEN = userinfo ? JSON.parse(userinfo).access_token : null;

            // clear div if it exists
            const existingDiv = document.getElementById('copyDiv');
            if (existingDiv) {
                existingDiv.remove();
            }
            // Create a container for the message

            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.bottom = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.backgroundColor = '#f0f0f0';
            container.style.zIndex = '9999';
            container.style.textAlign = 'center';
            container.style.padding = '3px';
            container.style.borderTop = '1px solid #ccc';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '14px';
            container.style.color = '#333';

            document.body.insertBefore(container, document.body.firstChild);

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

                fetch(url)
                    .then(response => {
                        if (!response.ok) throw new Error(`GeoServer API failed with status ${response.status}`);
                        return response.json();
                    })
                    .then(data => {
                        // console.log('GeoServer data:', data);
                        // write to file
                        // divTxt.innerText = JSON.stringify(data);
                        // divTxt.onclick = copyTextFromDiv;

                        Swal.fire({ title: JSON.stringify(data) });
                    })
                    .catch(error => {
                        console.error('Error fetching GeoServer data:', error);
                        divTxt.innerText += `\nเกิดข้อผิดพลาดในการดึงข้อมูล GeoServer: ${error.message}`;
                    });
            }
            getPacelByPacelNumber(province, amphur, parcelnumber)
        }
    });
});
