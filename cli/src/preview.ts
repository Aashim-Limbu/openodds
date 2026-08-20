// Phase 0 harness for the public preview testnet.
//
//   node src/preview.ts wallets        create/show the three demo wallets + faucet addresses
//   node src/preview.ts sync <role>    build a wallet, time the sync, register dust
//
// Roles: oracle (creates events/markets and posts facts), seeder (places the
// bets that give the demo slate real pools), demo (the pre-funded wallet the
// public app offers to anyone who arrives without one).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { unshieldedToken, shieldedToken } from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';

import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';

import { PreviewConfig, currentDir, type Config } from './config.ts';
import {
  buildWalletAndWaitForFunds,
  configureProviders,
  createPrivateState,
  deployOpenOdds,
  joinOpenOdds,
  patchPrivateState,
  pureCircuits,
} from './api.ts';

const rand32 = () => crypto.getRandomValues(new Uint8Array(32));

export const ROLES = ['oracle', 'seeder', 'demo'] as const;
export type Role = (typeof ROLES)[number];

const WALLETS_FILE = path.resolve(currentDir, '..', '.preview-wallets.json');

type Wallets = Record<string, string>;

const loadWallets = (): Wallets => {
  if (!fs.existsSync(WALLETS_FILE)) return {};
  return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8')) as Wallets;
};

const saveWallets = (w: Wallets) => fs.writeFileSync(WALLETS_FILE, `${JSON.stringify(w, null, 2)}\n`);

export const seedFor = (role: Role): string => {
  const wallets = loadWallets();
  if (!wallets[role]) {
    wallets[role] = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    saveWallets(wallets);
  }
  return wallets[role];
};

/**
 * The bech32m unshielded address the faucet wants — and, more to the point, the
 * one the wallet actually watches. The SDK derives it; do not hand-roll it. An
 * address is a hash of the public key, not the public key, and encoding the
 * latter produces a valid-looking address that nobody controls. Cost of
 * learning that: 15,000 tNIGHT and an afternoon.
 */
export const faucetAddress = (seed: string): string => {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('bad seed');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('bad derivation');
  hd.hdWallet.clear();
  const keystore = createKeystore(derived.keys[Roles.NightExternal], getNetworkId());
  return PublicKey.fromKeyStore(keystore).address;
};

/**
 * A cold wallet applies every index from genesis — measured at ~275/s shielded
 * and ~190/s dust against a chain 133k indices deep, so twelve minutes before
 * a first transaction. No judge waits that long. Every sub-wallet can
 * serialize its state and restore from it, so we sync once here and ship the
 * result; a restored wallet only applies the delta since the snapshot.
 */
export interface WalletSnapshot {
  role: string;
  network: string;
  takenAt: string;
  appliedIndex: string;
  shielded: string;
  unshielded: string;
  dust: string;
}

const snapshotPath = (role: string) =>
  path.resolve(currentDir, '..', 'snapshots', `${role}.preview.json`);

export const loadSnapshot = (role: string): WalletSnapshot | null => {
  const file = snapshotPath(role);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as WalletSnapshot) : null;
};

/** Build a wallet from a snapshot when one exists, cold otherwise. */
const buildRestored = async (cfg: Config, seed: string, snap: WalletSnapshot) => {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('bad seed');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('bad derivation');
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const keystore = createKeystore(derived.keys[Roles.NightExternal], getNetworkId());

  const wallet = await WalletFacade.init({
    configuration: {
      networkId: getNetworkId(),
      indexerClientConnection: { indexerHttpUrl: cfg.indexer, indexerWsUrl: cfg.indexerWS },
      provingServerUrl: new URL(cfg.proofServer),
      relayURL: new URL(cfg.node.replace(/^http/, 'ws')),
      txHistoryStorage: new NoOpTransactionHistoryStorage() as never,
      costParameters: { additionalFeeOverhead: 500_000_000_000_000_000n, feeBlocksMargin: 5 },
    },
    shielded: (c) => ShieldedWallet(c).restore(snap.shielded),
    unshielded: (c) => UnshieldedWallet(c).restore(snap.unshielded),
    dust: (c) => DustWallet(c).restore(snap.dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore: keystore };
};

/** A deployment we control: the contract plus the seat secrets that can settle it. */
export interface Deployment {
  address: string;
  seats: string[];
  deployedAt: string;
}

const deploymentPath = () => path.resolve(currentDir, '..', 'deployments', 'preview.json');

export const loadDeployment = (): Deployment | null => {
  const f = deploymentPath();
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as Deployment) : null;
};

/** Restore from a snapshot when we have one; pay the cold cost when we do not. */
export const openWallet = async (role: Role) => {
  const snap = loadSnapshot(role);
  if (snap) {
    console.log(`  ${role}: restoring from snapshot (${snap.takenAt})`);
    return buildRestored(config, seedFor(role), snap);
  }
  console.log(`  ${role}: no snapshot — cold sync, this takes minutes`);
  return buildWalletAndWaitForFunds(config, seedFor(role));
};

const cmd = process.argv[2] ?? 'wallets';
const config = new PreviewConfig();

if (cmd === 'wallets') {
  console.log(`network: ${getNetworkId()}`);
  console.log(`faucet : https://midnight-tmnight-preview.nethermind.dev/\n`);
  for (const role of ROLES) {
    console.log(`${role.padEnd(7)} ${faucetAddress(seedFor(role))}`);
  }
  console.log(`\nseeds in ${WALLETS_FILE} (gitignored — the demo seed ships publicly, the oracle seed must not)`);
} else if (cmd === 'sync') {
  const role = (process.argv[3] ?? 'oracle') as Role;
  const seed = seedFor(role);
  console.log(`syncing ${role} on preview — this is the number that decides whether a judge will wait`);
  const t0 = Date.now();
  // A silent 12-minute wait is untestable. Tick the progress so the number is
  // observable rather than folklore.
  const ticker = setInterval(() => {
    process.stdout.write(`  …${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }, 15_000);
  const ctx = await buildWalletAndWaitForFunds(config, seed).finally(() => clearInterval(ticker));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log(`\nsynced in ${secs}s`);
  console.log(`  NIGHT (unshielded) ${state.unshielded.balances[unshieldedToken().raw] ?? 0n}`);
  console.log(`  NIGHT (shielded)   ${state.shielded.balances[shieldedToken().raw] ?? 0n}`);
  console.log(`  DUST               ${state.dust.balance(new Date())}`);
  process.exit(0);
} else if (cmd === 'snapshot') {
  // Sync once, cold, then freeze the state so nobody else has to.
  const role = (process.argv[3] ?? 'demo') as Role;
  const seed = seedFor(role);
  console.log(`cold-syncing ${role} to take a snapshot — this is the slow one, on purpose`);
  const t0 = Date.now();
  const ticker = setInterval(
    () => process.stdout.write(`  …${((Date.now() - t0) / 1000).toFixed(0)}s\n`),
    15_000,
  );
  const ctx = await buildWalletAndWaitForFunds(config, seed).finally(() => clearInterval(ticker));
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const snap: WalletSnapshot = {
    role,
    network: getNetworkId(),
    takenAt: new Date().toISOString(),
    appliedIndex: String((state.shielded as any)?.state?.progress?.appliedIndex ?? ''),
    shielded: await ctx.wallet.shielded.serializeState(),
    unshielded: await ctx.wallet.unshielded.serializeState(),
    dust: await ctx.wallet.dust.serializeState(),
  };
  fs.mkdirSync(path.dirname(snapshotPath(role)), { recursive: true });
  fs.writeFileSync(snapshotPath(role), `${JSON.stringify(snap, null, 2)}\n`);
  const kb = (fs.statSync(snapshotPath(role)).size / 1024).toFixed(1);
  console.log(`\nsnapshot written in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${snapshotPath(role)} (${kb} kB, index ${snap.appliedIndex})`);
  process.exit(0);
} else if (cmd === 'restore') {
  // The number that matters: how long a judge waits.
  const role = (process.argv[3] ?? 'demo') as Role;
  const snap = loadSnapshot(role);
  if (!snap) throw new Error(`no snapshot for ${role} — run: node src/preview.ts snapshot ${role}`);
  console.log(`restoring ${role} from a snapshot taken ${snap.takenAt} at index ${snap.appliedIndex}`);
  const t0 = Date.now();
  const ctx = await buildRestored(config, seedFor(role), snap);
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  console.log(`\nsynced in ${((Date.now() - t0) / 1000).toFixed(1)}s from snapshot`);
  console.log(`  NIGHT (unshielded) ${state.unshielded.balances[unshieldedToken().raw] ?? 0n}`);
  console.log(`  NIGHT (shielded)   ${state.shielded.balances[shieldedToken().raw] ?? 0n}`);
  console.log(`  DUST               ${state.dust.balance(new Date())}`);
  process.exit(0);
} else if (cmd === 'deploy') {
  const t0 = Date.now();
  const ctx = await openWallet('oracle');
  const providers = await configureProviders(ctx, config);
  // Three seats, generated here and kept here. In production each of these
  // lives on a separate daemon watching a different data provider.
  const seats = [rand32(), rand32(), rand32()];
  console.log('deploying with a 2-of-3 committee…');
  const deployed: any = await deployOpenOdds(
    providers,
    createPrivateState(rand32(), seats[0]),
    seats.map((sk) => pureCircuits.oracleKhOf(sk)),
  );
  const address = deployed.deployTxData.public.contractAddress as string;
  const record: Deployment = {
    address,
    seats: seats.map((sk) => Buffer.from(sk).toString('hex')),
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(deploymentPath()), { recursive: true });
  fs.writeFileSync(deploymentPath(), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\ndeployed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  address ${address}`);
  console.log(`  explorer https://preview.midnightexplorer.com/`);
  console.log(`  seats saved to ${deploymentPath()} (gitignored)`);
  process.exit(0);
} else if (cmd === 'slate') {
  // A board that is empty when a judge arrives is a board that failed. Seed a
  // real one: an event already settled so the whole lifecycle is visible on
  // arrival, and two open ones with pools deep enough that the odds mean
  // something. Every transaction is serial per wallet — this takes ~10 minutes.
  const dep = loadDeployment();
  if (!dep) throw new Error('nothing deployed — run: node src/preview.ts deploy');

  const EVENTS = [
    { home: 'Arsenal', away: 'Chelsea', league: 'Premier League', settle: [2, 1] as [number, number] },
    { home: 'Spurs', away: 'Aston Villa', league: 'Premier League', settle: null },
    { home: 'Liverpool', away: 'Everton', league: 'Premier League', settle: null },
  ];

  const oracleCtx = await openWallet('oracle');
  const oracleProviders = await configureProviders(oracleCtx, config);
  const contract: any = await joinOpenOdds(oracleProviders, dep.address);

  const meta: Record<string, { home: string; away: string; league: string }> = {};
  const created: { eventId: Uint8Array; markets: Uint8Array[]; settle: [number, number] | null }[] = [];

  for (const e of EVENTS) {
    const eventId = rand32();
    console.log(`\ncreating ${e.home} v ${e.away}`);
    await contract.callTx.createEvent(eventId);
    const moneyline = rand32();
    const spread = rand32();
    await contract.callTx.createMarket(moneyline, eventId, 0n, 0n, true);
    await contract.callTx.createMarket(spread, eventId, 1n, 3n, true); // favourite -1.5
    meta[Buffer.from(eventId).toString('hex')] = { home: e.home, away: e.away, league: e.league };
    created.push({ eventId, markets: [moneyline, spread], settle: e.settle });
  }

  // Bets from a separate wallet: the anonymity set should not be one person.
  const seederCtx = await openWallet('seeder');
  const seederProviders = await configureProviders(seederCtx, config);
  const seederContract: any = await joinOpenOdds(seederProviders, dep.address);
  const BETS: [number, number, number][] = [
    [0, 0, 3], [0, 1, 7], [1, 0, 5], [1, 1, 2], [2, 0, 4], [2, 1, 6],
  ];
  for (const [eventIdx, outcome, tickets] of BETS) {
    const marketId = created[eventIdx].markets[eventIdx === 0 ? 0 : 1];
    console.log(`  bet ${tickets} on outcome ${outcome}`);
    await patchPrivateState(seederProviders, {
      secretKey: rand32(),
      marketId,
      outcome: BigInt(outcome),
      tickets: BigInt(tickets),
    });
    await seederContract.callTx.placeBet(
      { nonce: rand32(), color: new Uint8Array(32), value: BigInt(tickets) * 100n },
      marketId,
      BigInt(outcome),
      BigInt(tickets),
    );
  }

  // Settle the first event with a real quorum: two seats, same score.
  for (const c of created) {
    if (!c.settle) continue;
    const [h, a] = c.settle;
    console.log(`\nsettling ${h}–${a} with two seats`);
    for (const seat of dep.seats.slice(0, 2)) {
      await patchPrivateState(oracleProviders, {
        oracleSecretKey: Uint8Array.from(Buffer.from(seat, 'hex')),
      });
      await contract.callTx.postScore(c.eventId, BigInt(h * 2), BigInt(a * 2));
    }
  }

  const out = path.resolve(currentDir, '..', '..', 'ui', 'public', 'slate.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify({ contract: dep.address, network: 'preview', events: meta }, null, 2)}\n`,
  );
  console.log(`\nslate published → ${out}`);
  process.exit(0);
} else if (cmd === 'publish-demo') {
  // Ship the demo seed and its snapshot as a static asset. The seed is public
  // on purpose: it is a shared testnet wallet, and publishing it is the whole
  // point — a visitor needs neither an extension nor a faucet detour.
  const snap = loadSnapshot('demo');
  if (!snap) throw new Error('no demo snapshot — run: node src/preview.ts snapshot demo');
  const out = path.resolve(currentDir, '..', '..', 'ui', 'public', 'demo-wallet.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      {
        seed: seedFor('demo'),
        snapshot: {
          shielded: snap.shielded,
          unshielded: snap.unshielded,
          dust: snap.dust,
          takenAt: snap.takenAt,
          appliedIndex: snap.appliedIndex,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`published → ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} kB)`);
  process.exit(0);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
