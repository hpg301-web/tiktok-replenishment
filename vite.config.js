import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: { rollupOptions: { input: { index: resolve('index.html'), us: resolve('us.html'), de: resolve('de.html') } } },
});
