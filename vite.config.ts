import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Build multi-entrées : le popup (HTML), le service worker et le worker de
 * conversion. Les noms de sortie sont stables car le manifest et le code les
 * référencent en dur (`background.js`, `worker.js`).
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
