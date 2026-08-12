// E1/E3 spike runner: deploy OpenOdds on the live standalone stack, run the
// bet -> resolve -> claim round trip, print timings. Scripted, no menu.
//
// Usage:  node src/spike.ts e1     (default)
//         node src/spike.ts e3
import crypto from 'node:crypto';
import * as Rx from 'rxjs';
import { shieldedToken } from '@midnight-ntwrk/ledger-v8';
import { GENESIS_SEED, StandaloneConfig } from './config.ts';
import {
  buildWalletAndWaitForFunds,
  configureProviders,
  createPrivateState,
  deployOpenOdds,
  joinOpenOdds,
  type OpenOddsProviders,
  OpenOddsPrivateStateId,
  patchPrivateState,
  pureCircuits,
  readLedger,
  setPhase,
  timings,
  type WalletContext,
} from './api.ts';

const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
const NATIVE_COLOR = new Uint8Array(32); // shielded native token
const makeCoin = (value: bigint) => ({ nonce: rand32(), color: NATIVE_COLOR, value });
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const wall = new Map<string, number>();
const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  setPhase(name);
  console.log(`\n== ${name} ==`);
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    wall.set(name, Date.now() - t0);
    console.log(`== ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
};

const shieldedBalance = async (ctx: WalletContext): Promise<bigint> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.shielded.balances[shieldedToken().raw] ?? 0n;
};

const printTimings = () => {
  console.log('\n---- timing table (seconds) ----');
  console.log('phase      wall    prove   balance  submit');
  for (const [name, ms] of wall) {
    const t = timings.get(name) ?? {};
    const f = (x?: number) => (x === undefined ? '   -' : (x / 1000).toFixed(1).padStart(6));
    console.log(`${name.padEnd(10)} ${(ms / 1000).toFixed(1).padStart(6)} ${f(t.prove)} ${f(t.balance)} ${f(t.submit)}`);
  }
};

const setup = async () => {
  const config = new StandaloneConfig();
  console.log('== wallet ==');
  const ctx = await buildWalletAndWaitForFunds(config, GENESIS_SEED);
  const providers = await configureProviders(ctx, config);
  return { config, ctx, providers };
};

const deployMarket = async (providers: OpenOddsProviders, oracleSk: Uint8Array, betSecret: Uint8Array) => {
  const oracleKeyHash = pureCircuits.oracleKhOf(oracleSk);
  const contract = await deployOpenOdds(providers, createPrivateState(betSecret, oracleSk), {
    oracleKeyHash,
    marketType: 1n, // spread
    halfLine: 13n, // -6.5
    favIsHome: true,
  });
  const address = contract.deployTxData.public.contractAddress;
  console.log(`contract address: ${address}`);
  return { contract, address };
};

const dumpLedger = async (providers: OpenOddsProviders, address: string) => {
  const cs = await providers.publicDataProvider.queryContractState(address);
  if (cs == null) throw new Error('no contract state');
  const l = readLedger(cs.data) as any;
  console.log(
    `ledger: status=${l.status} poolA=${l.poolA} poolB=${l.poolB}` +
      (typeof l.treasury === 'object'
        ? ` treasury={value:${l.treasury.value}, mt_index:${l.treasury.mt_index}, nonce:${hex(l.treasury.nonce).slice(0, 16)}...}`
        : ''),
  );
  return l;
};

// ---------------- E1 ----------------
const runE1 = async () => {
  const { ctx, providers } = await setup();
  const oracleSk = new Uint8Array(32).fill(7);
  const s1 = rand32();
  const s2 = rand32();

  const bal0 = await shieldedBalance(ctx);
  console.log(`shielded native balance at start: ${bal0}`);

  const { contract, address } = await phase('deploy', () => deployMarket(providers, oracleSk, s1));

  // bet 1: outcome 0 (favorite covers), 3 tickets => 300
  const coin1 = makeCoin(300n);
  await phase('bet1', async () => {
    await patchPrivateState(providers, { secretKey: s1, outcome: 0n, tickets: 3n });
    await contract.callTx.placeBet(coin1, 0n, 3n);
  });
  await dumpLedger(providers, address);

  // bet 2: same wallet, distinct secret, outcome 1, 7 tickets => 700
  const coin2 = makeCoin(700n);
  await phase('bet2', async () => {
    await patchPrivateState(providers, { secretKey: s2, outcome: 1n, tickets: 7n });
    await contract.callTx.placeBet(coin2, 1n, 7n);
  });
  await dumpLedger(providers, address);

  // resolve: 48-34, favorite (home) covers -6.5
  await phase('resolve', async () => {
    await contract.callTx.postScore(48n, 34n);
  });
  const l = await dumpLedger(providers, address);

  // treasury coin discovery
  const zswapAndState = await providers.publicDataProvider.queryZSwapAndContractState(address);
  const zswapChainState = zswapAndState?.[0];
  console.log(`contract zswap chain state firstFree: ${zswapChainState?.firstFree}`);

  const balBeforeClaim = await shieldedBalance(ctx);
  console.log(`shielded balance before claim: ${balBeforeClaim} (delta so far ${balBeforeClaim - bal0})`);

  // claim bet 1: q = floor(k*T/W) = floor(3*10/3) = 10 => 1000
  const payoutRecipient = Buffer.from(providers.walletProvider.getCoinPublicKey(), 'hex');
  console.log(`payout recipient pk bytes: ${payoutRecipient.length}`);
  // settle a couple of blocks, then re-acquire the handle so the claim's
  // spend proof is built against the CURRENT zswap tree (stale-cache => 138)
  await new Promise((r) => setTimeout(r, 15_000));
  const freshContract = await joinOpenOdds(providers, address);
  try {
    await phase('claim', async () => {
      // treasury is a merged ledger coin now — the circuit reads it itself
      await patchPrivateState(providers, {
        secretKey: s1,
        outcome: 0n,
        tickets: 3n,
        quotient: 10n,
        payoutRecipient: new Uint8Array(payoutRecipient),
      });
      const res = await freshContract.callTx.claim();
      console.log(`claim payout tickets: ${(res as any).private?.result ?? '(see tx)'}`);
    });
  } catch (e) {
    console.error(`CLAIM FAILED: ${(e as Error).message}`);
    printTimings();
    process.exit(1);
  }

  // wait for the wallet to see the payout output
  const balAfter = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.throttleTime(2_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.shielded.balances[shieldedToken().raw] ?? 0n),
      Rx.filter((b) => b > balBeforeClaim),
      Rx.timeout({ first: 120_000 }),
    ),
  ).catch(async () => shieldedBalance(ctx));
  console.log(`shielded balance after claim: ${balAfter} (claim delta ${balAfter - balBeforeClaim})`);
  await dumpLedger(providers, address);

  printTimings();
  process.exit(0);
};

// ---------------- E3 ----------------
const runE3 = async () => {
  const { config, ctx, providers } = await setup();
  const oracleSk = new Uint8Array(32).fill(7);
  const s1 = rand32();

  // (b) block interval from the indexer
  const gql = async (query: string) => {
    const res = await fetch(config.indexer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return (await res.json()) as any;
  };
  const b1 = (await gql('{ block { height timestamp } }')).data.block;
  await new Promise((r) => setTimeout(r, 30_000));
  const b2 = (await gql('{ block { height timestamp } }')).data.block;
  console.log(`block sample 1: ${JSON.stringify(b1)}`);
  console.log(`block sample 2: ${JSON.stringify(b2)}`);
  const dt = new Date(b2.timestamp).getTime() - new Date(b1.timestamp).getTime();
  console.log(`block interval: ${(dt / (b2.height - b1.height) / 1000).toFixed(2)}s over ${b2.height - b1.height} blocks`);

  // (a) same-block contention: two placeBets fired concurrently from one wallet
  const { contract } = await phase('deploy-e3', () => deployMarket(providers, oracleSk, s1));
  await patchPrivateState(providers, { secretKey: s1, outcome: 0n, tickets: 1n });
  setPhase('contention');
  const results = await Promise.allSettled([
    contract.callTx.placeBet(makeCoin(100n), 0n, 1n),
    contract.callTx.placeBet(makeCoin(100n), 0n, 1n),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`concurrent bet ${i}: OK block ${(r.value as any).public.blockHeight}`);
    } else {
      console.log(`concurrent bet ${i}: FAILED: ${(r.reason as Error).message}`);
    }
  });
  process.exit(0);
};

const mode = process.argv[2] ?? 'e1';
process.on('unhandledRejection', (e) => {
  console.error('unhandled rejection:', e);
  process.exit(1);
});
if (mode === 'e3') await runE3();
else await runE1();
