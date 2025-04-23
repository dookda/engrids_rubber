import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: './index.html',
                // เพิ่มหน้าอื่นๆ ถ้ามี HTML แยก
            }
        }
    },
    publicDir: 'public'
});