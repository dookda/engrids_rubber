const products = [
  { name: "ต้มยำกุ้ง", price: 80 },
  { name: "ผัดไทย", price: 50 },
  { name: "แกงเขียวหวาน", price: 70 }
];

export default () => `
  <div class="container mt-5">
    <h1 class="text-center mb-4">เมนูอาหารไทย</h1>
    <div class="row">
      ${products.map(product => `
        <div class="col-md-4 mb-4">
          <div class="card">
            <div class="card-body">
              <h5 class="card-title">${product.name}</h5>
              <p class="card-text">ราคา: ${product.price} บาท</p>
              <button class="btn btn-primary" onclick="addToCart('${product.name}')">
                เพิ่มใส่ตะกร้า
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
`;