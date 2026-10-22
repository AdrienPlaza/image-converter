import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Multi-entry build: the popup (HTML), the service worker and the
 * conversion worker. Output names are stable because the manifest and code
 * reference them directly (`background.js`, `worker.js`).
 */
export default defineConfig({
  root,
  build: {
    target: 'chrome127',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/background.ts', import.meta.url)),
        worker: fileURLToPath(new URL('./src/core/worker.ts', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
