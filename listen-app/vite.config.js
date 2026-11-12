import { defineConfig } from 'vite';

// These two headers make the page "cross-origin isolated", which lets the
// voice engine use several CPU cores at once (much faster on most devices).
// Any web host used later must send the same headers for the same speed-up;
// without them everything still works, just on one core.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // Vite's dependency pre-bundling breaks onnxruntime-web's own worker setup.
  optimizeDeps: { exclude: ['kokoro-js', '@huggingface/transformers', 'onnxruntime-web'] },
});
