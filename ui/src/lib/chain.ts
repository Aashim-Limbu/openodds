// The write half: wallet, providers, contract calls. Loaded on demand via
// midnight.loadChain(), because this is where the wallet SDK, the proof client
// and the ledger wasm live and the read-only board needs none of it.
//
// Ported from openodds/cli/src/api.ts; the only real differences vs the node
// harness:
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
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
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

import { Contract } from '../../../contract/src/managed/openodds/contract/index.js';
import {
  witnesses,
  createPrivateState,
  type OpenOddsPrivateState,
} from '../../../contract/src/witnesses.ts';
import { pureCircuits } from './ledger.ts';
import {
  NATIVE_COLOR,
  OpenOddsPrivateStateId,
  TICKET_PRICE,
  config,
  rand32,
  serial,
  unhex,
  type Log,
} from './midnight.ts';

export { createPrivateState };

export const openoddsCompiledContract = CompiledContract.make('openodds', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // Type-level requirement only; nothing in midnight-js 4.1.1 ever reads it back
  // (grep: getCompiledAssetsPath has no consumers). The HTTP base url is what
  // actually matters and it lives on FetchZkConfigProvider below.
  CompiledContract.withCompiledFileAssets('/zk'),
);

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

export interface Balances {
  night: bigint;
  shielded: bigint;
  dust: bigint;
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
  log('wallet started, syncing…');

  const synced = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const night = synced.unshielded.balances[unshieldedToken().raw] ?? 0n;
  log(`synced · NIGHT ${night} · shielded ${synced.shielded.balances[shieldedToken().raw] ?? 0n}`);

  if (synced.dust.availableCoins.length === 0) {
    const utxos = synced.unshielded.availableCoins.filter(
      (c: any) => c.meta?.registeredForDustGeneration !== true,
    );
    if (utxos.length > 0) {
      log(`registering ${utxos.length} NIGHT utxo(s) for dust…`);
      const recipe = await wallet.registerNightUtxosForDustGeneration(
        utxos,
        unshieldedKeystore.getPublicKey(),
        (p) => unshieldedKeystore.signData(p),
      );
      await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    }
    log('waiting for dust (fees)…');
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

/** Balance feed for the header. Returns an unsubscribe. */
export const watchBalances = (ctx: WalletContext, onBalances: (b: Balances) => void) => {
  const sub = ctx.wallet
    .state()
    .pipe(Rx.throttleTime(4_000, undefined, { leading: true, trailing: true }))
    .subscribe((s) =>
      onBalances({
        night: s.unshielded.balances[unshieldedToken().raw] ?? 0n,
        shielded: s.shielded.balances[shieldedToken().raw] ?? 0n,
        dust: s.dust.balance(new Date()),
      }),
    );
  return () => sub.unsubscribe();
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
  // The bound fetch is mandatory: the default reference is unbound, throws
  // "Illegal invocation", and surfaces as a bogus ZKConfigurationReadError.
  const zkConfigProvider = new FetchZkConfigProvider<string>(
    config.zkBaseUrl,
    globalThis.fetch.bind(globalThis),
  );
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

/**
 * Private state is scoped per contract address in this SDK — every get/set
 * throws until `setContractAddress` has been called. A first-time bettor also
 * has nothing stored, so seed a fresh secret, but never overwrite an existing
 * one: that record holds the oracle key of a contract you deployed.
 */
export const joinMarket = async (providers: OpenOddsProviders, contractAddress: string) => {
  providers.privateStateProvider.setContractAddress(contractAddress);
  const existing = await providers.privateStateProvider.get(OpenOddsPrivateStateId);
  return findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: openoddsCompiledContract,
    privateStateId: OpenOddsPrivateStateId,
    ...(existing ? {} : { initialPrivateState: createPrivateState(rand32()) }),
  } as any);
};

export const getOracleSecretKey = async (
  providers: OpenOddsProviders,
  address: string,
): Promise<Uint8Array | null> => {
  providers.privateStateProvider.setContractAddress(address);
  const current = await providers.privateStateProvider.get(OpenOddsPrivateStateId);
  const sk = current?.oracleSecretKey;
  return sk && sk.some(Boolean) ? sk : null;
};

export const patchPrivateState = async (
  providers: OpenOddsProviders,
  address: string,
  patch: Partial<OpenOddsPrivateState>,
) => {
  providers.privateStateProvider.setContractAddress(address);
  const current = await providers.privateStateProvider.get(OpenOddsPrivateStateId);
  if (current == null) throw new Error('no private state stored for this contract');
  await providers.privateStateProvider.set(OpenOddsPrivateStateId, { ...current, ...patch });
};

// ---- write path -------------------------------------------------------------

export interface Session {
  providers: OpenOddsProviders;
  contract: any;
  address: string;
  coinPk: string;
}

export interface TxResult {
  blockHeight?: number;
  txId?: string;
}

const txResult = (r: any): TxResult => ({
  blockHeight: Number(r?.public?.blockHeight ?? 0) || undefined,
  txId: r?.public?.txId,
});

export const oracleTx = {
  createEvent: (s: Session, eventId: Uint8Array) =>
    serial(async () => txResult(await s.contract.callTx.createEvent(eventId))),
  createMarket: (
    s: Session,
    marketId: Uint8Array,
    eventId: Uint8Array,
    marketType: number,
    halfLine: number,
    favIsHome: boolean,
  ) =>
    serial(async () =>
      txResult(
        await s.contract.callTx.createMarket(
          marketId,
          eventId,
          BigInt(marketType),
          BigInt(halfLine),
          favIsHome,
        ),
      ),
    ),
  postScore: (s: Session, eventId: Uint8Array, home2: number, away2: number) =>
    serial(async () =>
      txResult(await s.contract.callTx.postScore(eventId, BigInt(home2), BigInt(away2))),
    ),
  voidEvent: (s: Session, eventId: Uint8Array) =>
    serial(async () => txResult(await s.contract.callTx.voidEvent(eventId))),
};

export const placeBet = (
  s: Session,
  bet: { marketId: string; outcome: 0 | 1; tickets: number; secret: Uint8Array },
): Promise<TxResult> =>
  serial(async () => {
    const marketId = unhex(bet.marketId);
    await patchPrivateState(s.providers, s.address, {
      secretKey: bet.secret,
      marketId,
      outcome: BigInt(bet.outcome),
      tickets: BigInt(bet.tickets),
    });
    const coin = {
      nonce: rand32(),
      color: NATIVE_COLOR,
      value: BigInt(bet.tickets) * TICKET_PRICE,
    };
    return txResult(
      await s.contract.callTx.placeBet(coin, marketId, BigInt(bet.outcome), BigInt(bet.tickets)),
    );
  });

export const claimPosition = (
  s: Session,
  position: { marketId: string; outcome: 0 | 1; tickets: number; secret: Uint8Array },
  quotient: bigint,
): Promise<TxResult & { payoutTickets: bigint }> =>
  serial(async () => {
    // Re-join: `betPath` reads the commitment tree off the handle's cached ledger
    // state, and a handle built before your bet landed has no path for it.
    const fresh: any = await joinMarket(s.providers, s.address);
    await patchPrivateState(s.providers, s.address, {
      secretKey: position.secret,
      marketId: unhex(position.marketId),
      outcome: BigInt(position.outcome),
      tickets: BigInt(position.tickets),
      quotient,
      payoutRecipient: unhex(s.coinPk),
    });
    const r = await fresh.callTx.claim();
    return { ...txResult(r), payoutTickets: BigInt(r?.private?.result ?? 0n) };
  });
