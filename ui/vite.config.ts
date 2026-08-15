import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'node:fs';
import path from 'node:path';

// __dirname is shimmed by vite when it bundles this config.
const zkDir = path.resolve(__dirname, '..', 'contract', 'src', 'managed', 'openodds');

// Serve the compiled ZK artifacts at /zk/{keys,zkir}/<circuit>.<ext> so
// FetchZkConfigProvider('http://localhost:5173/zk') can GET them.
// ponytail: dev/preview server only. For a static deploy:
//   cp -r ../contract/src/managed/openodds/{keys,zkir} public/zk/
const serveZk = (req: any, res: any, next: any) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (rel.includes('..')) return next();
  const file = path.join(zkDir, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
  res.setHeader('content-type', 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
};
const zkAssets = () => ({
  name: 'openodds-zk-assets',
  // NB: must not *return* middlewares.use(...) — connect's app is a function and
  // vite would mistake it for a post hook and call it with no args.
  configureServer(s: any) {
    s.middlewares.use('/zk', serveZk);
  },
  configurePreviewServer(s: any) {
    s.middlewares.use('/zk', serveZk);
  },
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    // abstract-level extends events.EventEmitter; the wallet SDK + compact-runtime
    // want Buffer/process. One plugin instead of hand-aliasing the long tail.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    zkAssets(),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    // one wasm instance only: the managed contract resolves compact-runtime from
    // ../contract, everything else from ui/node_modules. Two copies => broken instanceof.
    dedupe: [
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/zkir-v2',
      '@midnight-ntwrk/midnight-js-types',
      'rxjs',
    ],
  },
  optimizeDeps: {
    // wasm-pack "bundler" output cannot go through esbuild prebundling
    exclude: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/zkir-v2',
    ],
    // ...but their CJS-only leaf deps still must be prebundled, or the browser
    // hits "does not provide an export named 'default'".
    include: ['object-inspect', 'buffer'],
    esbuildOptions: { target: 'esnext' },
  },
  build: { target: 'esnext' },
  server: {
    port: 5173,
    // the managed contract artifacts live outside ui/
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
});
