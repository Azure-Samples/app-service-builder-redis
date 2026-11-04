import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:' + (process.env.PORT || '8080'),
      '/health': 'http://127.0.0.1:' + (process.env.PORT || '8080'),
    },
  },
});
