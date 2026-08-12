import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // 读取 server/.env 中的 PORT，保持前后端端口同步
  const serverEnv = loadEnv(mode, join(__dirname, '..', 'server'), 'PORT');
  const backendPort = serverEnv.PORT || 9097;
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
