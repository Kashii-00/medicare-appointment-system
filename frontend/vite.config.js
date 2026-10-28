import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { '/api': { target: env.BACKEND_URL || 'http://127.0.0.1:4000', changeOrigin: true } };
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: Number(process.env.PORT || 5173), strictPort: true, allowedHosts: ['terminal.local'], proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy }
  };
});
