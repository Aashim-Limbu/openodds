import { Buffer } from 'buffer';
import { useState } from 'react';
import {
  GENESIS_SEED,
  buildWallet,
  config,
  configureProviders,
  deployMarket,
  joinMarket,
  patchPrivateState,
  readPools,
  type OpenOddsProviders,
  type WalletContext,
} from './midnight.ts';

const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
const randId = () => rand32();
const NATIVE = new Uint8Array(32);

export function App() {
  const [lines, setLines] = useState<string[]>([]);
  const [seed, setSeed] = useState(GENESIS_SEED);
  const [address, setAddress] = useState('');
  const [marketId, setMarketId] = useState('');
  const [proofServer, setProofServer] = useState(config.proofServer);
  const [ctx, setCtx] = useState<WalletContext | null>(null);
  const [providers, setProviders] = useState<OpenOddsProviders | null>(null);
  const [busy, setBusy] = useState(false);

  const log = (m: string) => {
    console.log('[openodds]', m);
    setLines((l) => [...l, `${new Date().toISOString().slice(11, 19)} ${m}`]);
  };
  const run = (name: string, fn: () => Promise<void>) => async () => {
    setBusy(true);
    const t0 = Date.now();
    log(`-- ${name}`);
    try {
      await fn();
      log(`-- ${name} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e);
      log(`!! ${name} FAILED: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const detectLace = run('detect lace', async () => {
    const mn = (window as any).midnight;
    log(`window.midnight = ${mn ? Object.keys(mn).join(',') : 'undefined (no extension)'}`);
  });

  const checkZk = run('fetch zk artifacts', async () => {
    for (const p of ['keys/placeBet.prover', 'keys/placeBet.verifier', 'zkir/placeBet.bzkir']) {
      const r = await fetch(`${config.zkBaseUrl}/${p}`);
      log(`${p}: ${r.status} ${(await r.arrayBuffer()).byteLength} bytes`);
    }
  });

  const checkProofServer = run('proof server reachability', async () => {
    for (const url of ['http://127.0.0.1:6300', 'https://proof-server.preview.midnight.network']) {
      try {
        const r = await fetch(`${url}/health`);
        log(`${url} -> ${r.status} ${await r.text()}`);
      } catch (e) {
        log(`${url} -> ${(e as Error).message}`);
      }
    }
  });

  const doReadPools = run('read ledger', async () => {
    log(JSON.stringify(await readPools(address.trim())));
  });

  const connect = run('connect wallet', async () => {
    config.proofServer = proofServer.trim();
    log(`proof server: ${config.proofServer}`);
    const c = await buildWallet(seed.trim(), log);
    setCtx(c);
    const p = await configureProviders(c);
    setProviders(p);
    log(`coin pk ${p.walletProvider.getCoinPublicKey()}`);
  });

  const deploy = run('deploy + createEvent + createMarket', async () => {
    if (!providers) throw new Error('connect first');
    const d = await deployMarket(providers, new Uint8Array(32).fill(7), rand32());
    const addr = d.deployTxData.public.contractAddress;
    setAddress(addr);
    log(`deployed at ${addr}`);
    const eventId = randId();
    const mid = randId();
    setMarketId(Buffer.from(mid).toString('hex'));
    // same handle is fine here: strictly sequential, no coins involved
    await (d as any).callTx.createEvent(eventId);
    log('createEvent ok');
    await (d as any).callTx.createMarket(mid, eventId, 1n, 13n, true);
    log(`createMarket ok, marketId=${Buffer.from(mid).toString('hex').slice(0, 8)}`);
  });

  const bet = run('place bet', async () => {
    if (!providers) throw new Error('connect first');
    const mid = Uint8Array.from(Buffer.from(marketId.trim(), 'hex'));
    const contract = await joinMarket(providers, address.trim());
    await patchPrivateState(providers, {
      secretKey: rand32(),
      marketId: mid,
      outcome: 0n,
      tickets: 3n,
    });
    const res: any = await (contract as any).callTx.placeBet(
      { nonce: rand32(), color: NATIVE, value: 300n },
      mid,
      0n,
      3n,
    );
    log(`bet landed in block ${res.public?.blockHeight}`);
    log(JSON.stringify(await readPools(address.trim())));
  });

  // E3 in the browser: node failed concurrent txs on the LevelDB single-open lock.
  // IndexedDB has no such lock, so re-check whether the browser needs a tx queue too.
  const concurrent = run('two concurrent bets', async () => {
    if (!providers) throw new Error('connect first');
    const mid = Uint8Array.from(Buffer.from(marketId.trim(), 'hex'));
    const contract = await joinMarket(providers, address.trim());
    await patchPrivateState(providers, { secretKey: rand32(), marketId: mid, outcome: 0n, tickets: 1n });
    const one = () =>
      (contract as any).callTx.placeBet({ nonce: rand32(), color: NATIVE, value: 100n }, mid, 0n, 1n);
    const rs = await Promise.allSettled([one(), one()]);
    rs.forEach((r, i) =>
      log(
        r.status === 'fulfilled'
          ? `bet ${i}: OK block ${(r.value as any).public?.blockHeight}`
          : `bet ${i}: FAILED ${(r.reason as Error).message}`,
      ),
    );
  });

  const B = (p: { on: () => void; children: string; need?: boolean }) => (
    <button onClick={p.on} disabled={busy || p.need === false} style={{ marginRight: 6 }}>
      {p.children}
    </button>
  );

  return (
    <div style={{ fontFamily: 'monospace', padding: 16 }}>
      <h3>OpenOdds browser spike {busy ? '(busy…)' : ''}</h3>
      <div>
        seed <input value={seed} onChange={(e) => setSeed(e.target.value)} size={70} />
      </div>
      <div>
        addr <input value={address} onChange={(e) => setAddress(e.target.value)} size={70} />
      </div>
      <div>
        mkt <input value={marketId} onChange={(e) => setMarketId(e.target.value)} size={70} />
      </div>
      <div>
        prv <input value={proofServer} onChange={(e) => setProofServer(e.target.value)} size={70} />
        <button onClick={() => setProofServer('https://proof-server.preview.midnight.network')}>
          use hosted
        </button>
      </div>
      <p>
        <B on={detectLace}>1. detect Lace</B>
        <B on={checkZk}>2. fetch zk artifacts</B>
        <B on={checkProofServer}>3. proof servers</B>
        <B on={doReadPools} need={!!address}>4. read ledger</B>
      </p>
      <p>
        <B on={connect}>5. connect wallet</B>
        <B on={deploy} need={!!providers}>6. deploy + market</B>
        <B on={bet} need={!!providers && !!address && !!marketId}>7. place bet</B>
        <B on={concurrent} need={!!providers && !!address && !!marketId}>8. two concurrent bets</B>
      </p>
      <div>wallet: {ctx ? 'ready' : 'none'}</div>
      <pre style={{ background: '#eee', padding: 8, maxHeight: '55vh', overflow: 'auto' }}>
        {lines.join('\n')}
      </pre>
    </div>
  );
}
