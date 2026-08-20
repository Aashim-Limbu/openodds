// OpenOdds spike harness API: wallet build, providers, deploy + circuit wrappers.
// Wallet/provider plumbing adapted from midnightntwrk/example-counter counter-cli.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
// moved out of unshielded-wallet in the v1.2.0 SDK set
// spike harness has no use for tx history; NoOp avoids the schema plumbing
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { type Config, contractConfig } from './config.ts';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';

import { Contract, ledger as readLedger, pureCircuits } from '../../contract/src/managed/openodds/contract/index.js';
import { witnesses, createPrivateState, type OpenOddsPrivateState } from '../../contract/src/witnesses.ts';

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export const OpenOddsPrivateStateId = 'openoddsPrivateState';
export { readLedger, pureCircuits, createPrivateState };
export type { OpenOddsPrivateState };

export const openoddsCompiledContract = CompiledContract.make('openodds', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// ---- timing instrumentation --------------------------------------------
export type PhaseTiming = { prove?: number; balance?: number; submit?: number };
export const timings = new Map<string, PhaseTiming>();
let phase = 'init';
export const setPhase = (p: string) => {
  phase = p;
  if (!timings.has(p)) timings.set(p, {});
};
const record = (key: keyof PhaseTiming, ms: number) => {
  const t = timings.get(phase) ?? {};
  t[key] = (t[key] ?? 0) + ms;
  timings.set(phase, t);
};
const timed = async <T>(key: keyof PhaseTiming, fn: () => Promise<T>): Promise<T> => {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    record(key, Date.now() - t0);
  }
};

// ---- wallet ------------------------------------------------------------

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    // Work around wallet SDK bug: signRecipe hardcodes 'pre-proof' which fails
    // for proven intents. Clone with the correct marker and sign manually.
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );
    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      return timed('balance', async () => {
        const recipe = await ctx.wallet.balanceUnboundTransaction(
          tx,
          { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
          { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
        );
        const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }
        const finalized = await ctx.wallet.finalizeRecipe(recipe);
        if (process.env.DEBUG_TX) {
          const show = (m: Map<any, bigint>) =>
            JSON.stringify([...m].map(([k, v]) => [typeof k === 'object' ? `${k.tag}:${String(k.raw).slice(0, 8)}` : k, String(v)]));
          console.log(`  [debug] balancing tx present: ${recipe.balancingTransaction != null}`);
          try {
            console.log(`  [debug] imbalances seg0: ${show((finalized as any).imbalances(0))}`);
            console.log(`  [debug] imbalances seg1: ${show((finalized as any).imbalances(1))}`);
          } catch (e) {
            console.log(`  [debug] imbalances unavailable: ${(e as Error).message}`);
          }
          const g = (finalized as any).guaranteedOffer;
          console.log(`  [debug] guaranteedOffer inputs=${g?.inputs?.length} outputs=${g?.outputs?.length}`);
        }
        return finalized;
      });
    },
    submitTx(tx) {
      return timed('submit', () => ctx.wallet.submitTransaction(tx)) as any;
    },
  };
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(3_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  txHistoryStorage: new NoOpTransactionHistoryStorage() as never,
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: {
    // undeployed network needs the full testkit default; lower values fail
    // node-side with BalanceCheckOverspend (error 138) — see example-bboard README
    additionalFeeOverhead: 500_000_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

/** Register unshielded NIGHT UTXOs for dust generation (fee token). */
const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (state.dust.availableCoins.length > 0) {
    console.log(`  dust already available: ${state.dust.balance(new Date())}`);
    return;
  }
  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length > 0) {
    console.log(`  registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation...`);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  }
  console.log('  waiting for dust to generate...');
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(3_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n),
    ),
  );
};

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  const synced = await waitForSync(wallet);
  const unshieldedBalance = synced.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  wallet synced. unshielded NIGHT: ${unshieldedBalance}`);
  console.log(`  shielded balances: ${JSON.stringify(synced.shielded.balances, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
  if (unshieldedBalance === 0n) {
    console.log('  waiting for funds...');
    await waitForFunds(wallet);
  }
  await registerForDustGeneration(wallet, unshieldedKeystore);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const configureProviders = async (ctx: WalletContext, config: Config) => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<string>(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  const baseProofProvider = httpClientProofProvider(config.proofServer, zkConfigProvider);
  // Wrap the proof provider to record proving time per phase.
  const proofProvider = {
    proveTx: (tx: any, opts?: any) => timed('prove', () => baseProofProvider.proveTx(tx, opts)),
  } as typeof baseProofProvider;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OpenOddsPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider,
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export type OpenOddsProviders = Awaited<ReturnType<typeof configureProviders>>;

/** Seals the three committee seats. Quorum is 2-of-3; see openodds.compact. */
export const deployOpenOdds = async (
  providers: OpenOddsProviders,
  initialPrivateState: OpenOddsPrivateState,
  oracleKeyHashes: readonly Uint8Array[],
) => {
  if (oracleKeyHashes.length !== 3) throw new Error('the committee has exactly three seats');
  const deployed = await deployContract(providers as any, {
    compiledContract: openoddsCompiledContract,
    privateStateId: OpenOddsPrivateStateId,
    initialPrivateState,
    args: [...oracleKeyHashes],
  } as any);
  return deployed;
};

/** Re-acquire a deployed contract handle: forces a fresh
 *  queryZSwapAndContractState, so coin-spending circuits prove against the
 *  CURRENT zswap tree (a handle reused across calls keeps a stale one). */
export const joinOpenOdds = async (providers: OpenOddsProviders, contractAddress: string) => {
  return await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: openoddsCompiledContract,
    privateStateId: OpenOddsPrivateStateId,
  } as any);
};

/** Patch the stored private state before a circuit call (witness inputs). */
export const patchPrivateState = async (
  providers: OpenOddsProviders,
  patch: Partial<OpenOddsPrivateState>,
): Promise<OpenOddsPrivateState> => {
  const current = await providers.privateStateProvider.get(OpenOddsPrivateStateId);
  if (current == null) throw new Error('no private state stored');
  const next = { ...current, ...patch };
  await providers.privateStateProvider.set(OpenOddsPrivateStateId, next);
  return next;
};
