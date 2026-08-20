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
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { unshieldedToken, shieldedToken } from '@midnight-ntwrk/ledger-v8';
import * as Rx from 'rxjs';

import { PreviewConfig, currentDir } from './config.ts';
import { buildWalletAndWaitForFunds } from './api.ts';

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

/** The bech32m unshielded address the faucet wants. */
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
  const hex = keystore.getPublicKey() as unknown as string;
  return String(UnshieldedAddress.codec.encode(getNetworkId(), new UnshieldedAddress(Uint8Array.from(Buffer.from(hex, 'hex')))));
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
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
