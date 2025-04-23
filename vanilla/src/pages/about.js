export default () => `
  <div class="container mt-5">
    <h1>เกี่ยวกับเรา</h1>
    <button class="btn btn-info" data-bs-toggle="modal" data-bs-target="#exampleModal">
      ดูประวัติร้าน
    </button>

    <!-- Modal -->
    <div class="modal fade" id="exampleModal">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">ประวัติร้านอาหารไทย</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p>เปิดกิจการมาตั้งแต่ปี 1999...</p>
          </div>
        </div>
      </div>
    </div>
  </div>
`;