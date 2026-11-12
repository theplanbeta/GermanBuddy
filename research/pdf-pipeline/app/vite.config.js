import { defineConfig } from 'vite';
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
export default defineConfig({
  root: __dirname,
  server: { headers, port: 5181, strictPort: true },
  preview: { headers, port: 5182, strictPort: true },
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, rollupOptions: { input: { gate: __dirname + '/gate.html', index: __dirname + '/index.html', ocr: __dirname + '/ocr.html' } } },
  publicDir: false,
  optimizeDeps: { exclude: ['@llamaindex/liteparse-wasm'] },
});
