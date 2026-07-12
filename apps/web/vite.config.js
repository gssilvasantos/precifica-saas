import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Proxy /api para o backend NestJS em dev — evita configurar CORS explícito
// e mantém o mesmo caminho relativo /api usado em produção atrás de um
// mesmo domínio/reverse proxy.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            '/uploads': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
