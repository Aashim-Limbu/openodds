// Config, constants and the two lazy doors into the heavy half of the app.
//
// Nothing here imports the SDK. The wasm that decodes ledger state is 10 MB and
// the wallet stack is another 2.5 MB; both arrive behind loadLedger()/loadChain()
// so the shell paints first and a visitor who only reads the board never pays
// for the wallet at all.
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { Buffer } from 'buffer';

import type { Board } from './odds.ts';

export const OpenOddsPrivateStateId = 'openoddsPrivateState';

/** Fixed ticket price, mirrored from `ticketPrice()` in openodds.compact. */
export const TICKET_PRICE = 100n;
export const NATIVE_COLOR = new Uint8Array(32);

export interface ChainConfig {
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  networkId: string;
}

export const LOCAL_STACK: ChainConfig = {
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  networkId: 'undeployed',
};

/** Verified alive, CORS-open, v8.0.3 — but it sees your witnesses. See PrivacyPanel. */
export const HOSTED_PROOF_SERVER = 'https://proof-server.preview.midnight.network';

/** Public preview testnet. Every endpoint probed live: prover 8.0.3, rpc healthy, indexer on v3. */
export const PREVIEW_NET: ChainConfig = {
  indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  proofServer: HOSTED_PROOF_SERVER,
  networkId: 'preview',
};

/** A deployment declares which of these it is; see slate.json. */
export const NETWORKS: Record<string, ChainConfig> = {
  local: LOCAL_STACK,
  preview: PREVIEW_NET,
};

export const config: ChainConfig & { zkBaseUrl: string } = {
  ...LOCAL_STACK,
  zkBaseUrl: `${location.origin}/zk`,
};

export const applyConfig = (next: ChainConfig) => {
  Object.assign(config, next);
  setNetworkId(config.networkId as never);
};
setNetworkId(config.networkId as never);

/** Genesis wallet of the local standalone node — the only pre-funded seed there is. */
export const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Safety margin added on top of the estimated fee. The 5e17 we inherited from
 * the local-stack example is 0.5 DUST — fine for a genesis wallet with an
 * effectively infinite balance, fatal on a faucet-funded one, which holds about
 * 0.02 DUST and could not even pay to register its NIGHT for dust generation.
 */
export const DUST_FEE_OVERHEAD = 1_000_000_000_000_000n; // 0.001 DUST

export type Log = (msg: string) => void;

export const rand32 = () => crypto.getRandomValues(new Uint8Array(32));
export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
export const unhex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

// One wallet = strictly serial transactions. Concurrency here is not slow, it is
// broken: the private-state store is single-writer and the balancer trips
// "Custom error: 170". Every callTx in the app goes through this queue.
let tail: Promise<unknown> = Promise.resolve();
export const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
};

// ---- lazy halves ------------------------------------------------------------

/** Ledger decode + indexer reads (~10 MB wasm). Needed to show any odds. */
let ledgerModule: Promise<typeof import('./ledger.ts')> | null = null;
export const loadLedger = () => (ledgerModule ??= import('./ledger.ts'));

/** Wallet, proving and contract calls (~2.5 MB). Needed only to write. */
let chainModule: Promise<typeof import('./chain.ts')> | null = null;
export const loadChain = () => (chainModule ??= import('./chain.ts'));

export const readBoard = async (address: string): Promise<Board> =>
  (await loadLedger()).readBoard(address);

export const readLedgerState = async (address: string) =>
  (await loadLedger()).readLedgerState(address);

export const oracleKeyHashOf = async (secretKey: Uint8Array) =>
  (await loadLedger()).oracleKeyHashOf(secretKey);
