import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'site',
  plugins: [react()],
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./site/index.html', import.meta.url)),
        stories: fileURLToPath(new URL('./site/360/index.html', import.meta.url)),
      },
    },
  },
});
