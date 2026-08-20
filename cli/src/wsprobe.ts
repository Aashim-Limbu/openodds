import { WebSocket } from 'ws';
const url = process.argv[2] ?? 'wss://rpc.preview.midnight.network';
const t0 = Date.now();
const ws = new WebSocket(url);
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
ws.on('open', () => {
  console.log(`${el()} open`);
  ws.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'system_chain', params: [] }));
});
ws.on('message', (d) => console.log(`${el()} msg ${String(d).slice(0, 120)}`));
ws.on('close', (c, r) => { console.log(`${el()} close ${c} ${String(r)}`); process.exit(0); });
ws.on('error', (e) => { console.log(`${el()} error ${e.message}`); process.exit(1); });
setTimeout(() => { console.log(`${el()} still open — healthy`); process.exit(0); }, 12000);
