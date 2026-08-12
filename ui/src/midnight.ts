// Browser port of openodds/cli/src/api.ts. Differences vs the node harness:
//   NodeZkConfigProvider(fsPath)  ->  FetchZkConfigProvider(httpBaseUrl)
//   ws WebSocket shim             ->  native browser WebSocket (nothing to do)
//   levelPrivateStateProvider     ->  UNCHANGED: `level@10` resolves to
//                                     browser-level (IndexedDB) via its `browser` field.
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken, shieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
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
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Rx from 'rxjs';
import { Buffer } from 'buffer';

import {
  Contract,
  ledger as readLedger,
  pureCircuits,
} from '../../contract/src/managed/openodds/contract/index.js';
import { witnesses, createPrivateState, type OpenOddsPrivateState } from '../../contract/src/witnesses.ts';

export { readLedger, pureCircuits, createPrivateState, shieldedToken };
export type { OpenOddsPrivateState };

export const OpenOddsPrivateStateId = 'openoddsPrivateState';

export const config = {
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  // swap for https://proof-server.preview.midnight.network to test the hosted one
  proofServer: 'http://127.0.0.1:6300',
  zkBaseUrl: `${location.origin}/zk`,
};
setNetworkId('undeployed');

export const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export const openoddsCompiledContract = CompiledContract.make('openodds', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // Type-level requirement only; nothing in midnight-js 4.1.1 ever reads it back
  // (grep: getCompiledAssetsPath has no consumers). The HTTP base url is what
  // actually matters and it lives on FetchZkConfigProvider below.
  CompiledContract.withCompiledFileAssets('/zk'),
);

export type Log = (msg: string) => void;

// ---- wallet (verbatim from the node harness; none of this is node-specific) ----

const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );
    const signature = signFn(cloned.signatureData(segment));
    for (const key of ['fallibleUnshieldedOffer', 'guaranteedUnshieldedOffer'] as const) {
      const offer = cloned[key];
      if (!offer) continue;
      cloned[key] = offer.addSignatures(
        offer.inputs.map((_: ledger.UtxoSpend, i: number) => offer.signatures.at(i) ?? signature),
      );
    }
    tx.intents.set(segment, cloned);
  }
};

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();
  return result.keys;
};

export const buildWallet = async (seed: string, log: Log): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  const conn = { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS };
  const relayURL = new URL(config.node.replace(/^http/, 'ws'));
  const provingServerUrl = new URL(config.proofServer);

  const wallet = await WalletFacade.init({
    configuration: {
      networkId: getNetworkId(),
      indexerClientConnection: conn,
      provingServerUrl,
      relayURL,
      txHistoryStorage: new NoOpTransactionHistoryStorage() as never,
      costParameters: { additionalFeeOverhead: 500_000_000_000_000_000n, feeBlocksMargin: 5 },
    },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  log('wallet started, syncing...');

  const synced = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const night = synced.unshielded.balances[unshieldedToken().raw] ?? 0n;
  log(`synced. NIGHT=${night} shielded=${synced.shielded.balances[shieldedToken().raw] ?? 0n}`);

  if (synced.dust.availableCoins.length === 0) {
    const utxos = synced.unshielded.availableCoins.filter(
      (c: any) => c.meta?.registeredForDustGeneration !== true,
    );
    if (utxos.length > 0) {
      log(`registering ${utxos.length} NIGHT utxo(s) for dust...`);
      const recipe = await wallet.registerNightUtxosForDustGeneration(
        utxos,
        unshieldedKeystore.getPublicKey(),
        (p) => unshieldedKeystore.signData(p),
      );
      await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    }
    log('waiting for dust...');
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(3_000),
        Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  log('dust available');
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const configureProviders = async (ctx: WalletContext) => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const walletAndMidnightProvider: WalletProvider & MidnightProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (p: Uint8Array) => ctx.unshieldedKeystore.signData(p);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx) => ctx.wallet.submitTransaction(tx) as any,
  };
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const zkConfigProvider = new FetchZkConfigProvider<string>(config.zkBaseUrl);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OpenOddsPrivateStateId>({
      privateStateStoreName: 'openodds-private-state',
      accountId,
      privateStoragePasswordProvider: () => `${Buffer.from(accountId, 'hex').toString('base64')}!`,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export type OpenOddsProviders = Awaited<ReturnType<typeof configureProviders>>;

export const deployMarket = (providers: OpenOddsProviders, oracleSk: Uint8Array, betSecret: Uint8Array) =>
  deployContract(providers as any, {
    compiledContract: openoddsCompiledContract,
    privateStateId: OpenOddsPrivateStateId,
    initialPrivateState: createPrivateState(betSecret, oracleSk),
    args: [pureCircuits.oracleKhOf(oracleSk)],
  } as any);

export const joinMarket = (providers: OpenOddsProviders, contractAddress: string) =>
  findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: openoddsCompiledContract,
    privateStateId: OpenOddsPrivateStateId,
  } as any);

export const patchPrivateState = async (
  providers: OpenOddsProviders,
  patch: Partial<OpenOddsPrivateState>,
) => {
  const current = await providers.privateStateProvider.get(OpenOddsPrivateStateId);
  if (current == null) throw new Error('no private state stored');
  await providers.privateStateProvider.set(OpenOddsPrivateStateId, { ...current, ...patch });
};

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Ledger read with no wallet and no proof server: indexer + compact-runtime only. */
export const readPools = async (contractAddress: string) => {
  const p = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const cs = await p.queryContractState(contractAddress);
  if (cs == null) throw new Error('no contract state at that address');
  const l = readLedger(cs.data) as any;
  return {
    events: [...l.events].map(([k, v]: any) => [hex(k).slice(0, 8), String(v.status), `${v.homeScore2}-${v.awayScore2}`]),
    markets: [...l.markets].map(([k]: any) => hex(k).slice(0, 8)),
    pools: [...l.pools].map(([k, v]: any) => [hex(k).slice(0, 8), String(v)]),
    treasuryFunded: l.treasuryFunded,
  };
};
