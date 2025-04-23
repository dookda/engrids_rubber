class Router {
    constructor(routes) {
        this.routes = routes;
        this.init();
    }

    init() {
        // ตรวจสอบเมื่อ URL เปลี่ยน
        window.addEventListener('popstate', () => this.loadRoute());

        // ป้องกันการโหลดหน้าใหม่เมื่อคลิกลิงก์
        document.addEventListener('click', (e) => {
            if (e.target.matches('.nav-link')) {
                e.preventDefault();
                const path = e.target.getAttribute('data-path');
                history.pushState({}, '', path);
                this.loadRoute();
            }
        });

        this.loadRoute();
    }

    async loadRoute() {
        const path = window.location.pathname;
        const route = this.routes.find(r => r.path === path) || this.routes[0];

        // โหลดหน้าเว็บจากไฟล์ .js
        const page = await import(`./pages/${route.component}.js`);
        document.getElementById('app').innerHTML = page.default();

        if (route.component === 'map' && page.initMap) {
            page.initMap();
        }
    }
}

export default Router;