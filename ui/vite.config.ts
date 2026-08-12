import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'node:fs';
import path from 'node:path';

// __dirname is shimmed by vite when it bundles this config.
const zkDir = path.resolve(__dirname, '..', 'contract', 'src', 'managed', 'openodds');

// Serve the compiled ZK artifacts at /zk/{keys,zkir}/<circuit>.<ext> so
// FetchZkConfigProvider('http://localhost:5173/zk') can GET them.
// ponytail: dev-server only. For a deployed build, copy the dir into public/.
const zkAssets = () => ({
  name: 'openodds-zk-assets',
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use('/zk', (req: any, res: any, next: any) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (rel.includes('..')) return next();
      const file = path.join(zkDir, rel);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader('content-type', 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    // abstract-level extends events.EventEmitter; the wallet SDK + compact-runtime
    // want Buffer/process. One plugin instead of hand-aliasing the long tail.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    zkAssets(),
  ],
  resolve: {
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
