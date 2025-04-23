export default () => `
  <div class="container mt-4">
    <h1 class="text-center mb-4">แผนที่ร้านอาหารไทย</h1>
    <div id="map" style="height: 500px; border-radius: 15px;"></div>
  </div>
`;

// ฟังก์ชันเริ่มต้นแผนที่
export const initMap = () => {
    const map = L.map('map').setView([13.745156, 100.534019], 13); // ตั้งค่าพิกัดเริ่มต้น (Bangkok)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // เพิ่ม Marker
    L.marker([13.745156, 100.534019])
        .addTo(map)
        .bindPopup('<b>ร้านอาหารไทยอร่อยๆ</b><br>เปิดบริการ 10:00 - 22:00 น.')
        .openPopup();
};