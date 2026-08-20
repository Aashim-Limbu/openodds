// Live-chain runner for the multi-market contract.
//   node src/spike.ts e1     full slate: 2 markets on 1 event, bets, resolve, claims
//   node src/spike.ts e3     block interval + same-wallet contention
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
  patchPrivateState,
  pureCircuits,
  readLedger,
  setPhase,
  timings,
  type WalletContext,
} from './api.ts';

const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
const b = (fill: number) => new Uint8Array(32).fill(fill);
const NATIVE = new Uint8Array(32);
const TICKET_PRICE = 100n;
const coinFor = (tickets: bigint) => ({ nonce: rand32(), color: NATIVE, value: tickets * TICKET_PRICE });

const ORACLE_SK = b(7);
// The spike drives all three seats itself; quorum still needs two of them.
const SEAT_SKS = [ORACLE_SK, b(8), b(9)];
// Random ids on purpose: a 32-byte id above the BLS scalar modulus used to
// break commitmentFor, and fixed low-byte ids hid it.
const EVENT = rand32();
const MKT_SPREAD = rand32();
const MKT_TOTAL = rand32();

const wall = new Map<string, number>();
const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  setPhase(name);
  const t0 = Date.now();
  console.log(`\n== ${name} ==`);
  try {
    return await fn();
  } finally {
    wall.set(name, Date.now() - t0);
    console.log(`== ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
};

const printTimings = () => {
  console.log('\n---- timings (seconds) ----');
  console.log('phase          wall   prove balance  submit');
  for (const [name, ms] of wall) {
    const t = timings.get(name) ?? {};
    const f = (x?: number) => (x === undefined ? '     -' : (x / 1000).toFixed(1).padStart(6));
    console.log(`${name.padEnd(14)}${(ms / 1000).toFixed(1).padStart(6)}${f(t.prove)}${f(t.balance)}${f(t.submit)}`);
  }
};

const shieldedBalance = async (ctx: WalletContext): Promise<bigint> => {
  const s = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
  return s.shielded.balances[shieldedToken().raw] ?? 0n;
};

const setup = async () => {
  const config = new StandaloneConfig();
  console.log('== wallet ==');
  const ctx = await buildWalletAndWaitForFunds(config, GENESIS_SEED);
  const providers = await configureProviders(ctx, config);
  return { config, ctx, providers };
};

const dumpPools = async (providers: OpenOddsProviders, address: string, label: string) => {
  const cs = await providers.publicDataProvider.queryContractState(address);
  if (cs == null) throw new Error('no contract state');
  const l = readLedger(cs.data) as any;
  const pool = (m: Uint8Array, o: bigint) => {
    const k = pureCircuits.poolKey(m, o);
    return l.pools.member(k) ? l.pools.lookup(k) : 0n;
  };
  console.log(
    `${label}: spread ${pool(MKT_SPREAD, 0n)}/${pool(MKT_SPREAD, 1n)}` +
      `  total ${pool(MKT_TOTAL, 0n)}/${pool(MKT_TOTAL, 1n)}` +
      `  treasury ${l.treasury?.value ?? 0} funded=${l.treasuryFunded}`,
  );
  return l;
};

const runE1 = async () => {
  const { ctx, providers } = await setup();
  const alice = rand32();
  const bal0 = await shieldedBalance(ctx);
  console.log(`shielded balance at start: ${bal0}`);

  const contract = await phase('deploy', () =>
    deployOpenOdds(providers, createPrivateState(alice, ORACLE_SK), SEAT_SKS.map((sk) => pureCircuits.oracleKhOf(sk))),
  );
  const address = contract.deployTxData.public.contractAddress;
  console.log(`contract: ${address}`);

  // A slate: one event, two markets derived from the same future score fact.
  await phase('createEvent', () => contract.callTx.createEvent(EVENT).then(() => undefined));
  await phase('createMarket:spread', () =>
    contract.callTx.createMarket(MKT_SPREAD, EVENT, 1n, 13n, true).then(() => undefined),
  );
  await phase('createMarket:total', () =>
    contract.callTx.createMarket(MKT_TOTAL, EVENT, 2n, 83n, true).then(() => undefined),
  );

  // Alice backs the favourite on the spread and the under on the total.
  await phase('bet:spread', async () => {
    await patchPrivateState(providers, { secretKey: alice, marketId: MKT_SPREAD, outcome: 0n, tickets: 3n });
    await contract.callTx.placeBet(coinFor(3n), MKT_SPREAD, 0n, 3n);
  });
  const bob = rand32();
  await phase('bet:spread:other', async () => {
    await patchPrivateState(providers, { secretKey: bob, marketId: MKT_SPREAD, outcome: 1n, tickets: 7n });
    await contract.callTx.placeBet(coinFor(7n), MKT_SPREAD, 1n, 7n);
  });
  await dumpPools(providers, address, 'after spread bets');

  // ONE fact settles the whole slate.
  await phase('postScore:seat0', () => contract.callTx.postScore(EVENT, 48n, 34n).then(() => undefined));
  await phase('postScore:seat1', async () => {
    await patchPrivateState(providers, { oracleSecretKey: SEAT_SKS[1] });
    await contract.callTx.postScore(EVENT, 48n, 34n);
  });
  await dumpPools(providers, address, 'after resolve');

  const before = await shieldedBalance(ctx);
  const recipient = new Uint8Array(Buffer.from(providers.walletProvider.getCoinPublicKey(), 'hex'));
  await new Promise((r) => setTimeout(r, 12_000)); // let the tree settle
  const fresh = await joinOpenOdds(providers, address);

  await phase('claim:winner', async () => {
    // favourite covered: alice takes the whole 10-ticket pot
    await patchPrivateState(providers, {
      secretKey: alice,
      marketId: MKT_SPREAD,
      outcome: 0n,
      tickets: 3n,
      quotient: 10n,
      payoutRecipient: recipient,
    });
    const r = await fresh.callTx.claim();
    console.log(`payout tickets: ${(r as any).private?.result ?? '(see tx)'}`);
  });

  const after = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.throttleTime(2_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.shielded.balances[shieldedToken().raw] ?? 0n),
      Rx.filter((x) => x > before),
      Rx.timeout({ first: 120_000 }),
    ),
  ).catch(async () => shieldedBalance(ctx));
  console.log(`claim delta: ${after - before} (expected ${10n * TICKET_PRICE})`);
  await dumpPools(providers, address, 'after claim');

  printTimings();
  process.exit(0);
};

const runE3 = async () => {
  const { config, providers } = await setup();
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
  const dt = new Date(b2.timestamp).getTime() - new Date(b1.timestamp).getTime();
  console.log(`block interval: ${(dt / (b2.height - b1.height) / 1000).toFixed(2)}s over ${b2.height - b1.height} blocks`);

  const sk = rand32();
  const contract = await phase('deploy-e3', () =>
    deployOpenOdds(providers, createPrivateState(sk, ORACLE_SK), SEAT_SKS.map((sk) => pureCircuits.oracleKhOf(sk))),
  );
  await contract.callTx.createEvent(EVENT);
  await contract.callTx.createMarket(MKT_SPREAD, EVENT, 1n, 13n, true);
  await patchPrivateState(providers, { secretKey: sk, marketId: MKT_SPREAD, outcome: 0n, tickets: 1n });

  setPhase('contention');
  const results = await Promise.allSettled([
    contract.callTx.placeBet(coinFor(1n), MKT_SPREAD, 0n, 1n),
    contract.callTx.placeBet(coinFor(1n), MKT_SPREAD, 0n, 1n),
  ]);
  results.forEach((r, i) =>
    console.log(
      r.status === 'fulfilled'
        ? `concurrent bet ${i}: OK block ${(r.value as any).public.blockHeight}`
        : `concurrent bet ${i}: FAILED: ${(r.reason as Error).message.split('\n')[0]}`,
    ),
  );
  process.exit(0);
};

process.on('unhandledRejection', (e) => {
  console.error('unhandled rejection:', e);
  process.exit(1);
});
if ((process.argv[2] ?? 'e1') === 'e3') await runE3();
else await runE1();
