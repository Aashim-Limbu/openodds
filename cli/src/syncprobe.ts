// What is the wallet actually waiting on? Dump the live sync state instead of
// waiting for isSynced and guessing.
import * as Rx from 'rxjs';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { Buffer } from 'node:buffer';
import { PreviewConfig, DUST_FEE_OVERHEAD } from './config.ts';
import { seedFor } from './preview.ts';

const config = new PreviewConfig();
const seed = seedFor('demo');
const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hd.type !== 'seedOk') throw new Error('bad seed');
const d = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
if (d.type !== 'keysDerived') throw new Error('bad derive');
const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(d.keys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(d.keys[Roles.Dust]);
const ks = createKeystore(d.keys[Roles.NightExternal], getNetworkId());

const wallet = await WalletFacade.init({
  configuration: {
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: config.indexer, indexerWsUrl: config.indexerWS },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage() as never,
    costParameters: { additionalFeeOverhead: DUST_FEE_OVERHEAD, feeBlocksMargin: 5 },
  },
  shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(ks)),
  dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
});
await wallet.start(shieldedSecretKeys, dustSecretKey);

const t0 = Date.now();
const j = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x));
const describe = (o: any): string => (o?.state?.progress ? j(o.state.progress) : j(o));

wallet.state().pipe(Rx.throttleTime(10_000, undefined, { leading: true, trailing: true })).subscribe((s: any) => {
  const el = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[${el}s] isSynced=${s.isSynced}`);
  console.log(`  shielded  : ${describe(s.shielded)}`);
  console.log(`  unshielded: ${describe(s.unshielded)}`);
  console.log(`  dust      : ${describe(s.dust)}`);
  // The question that matters: does it see the money, and under which key?
  console.log(`  BAL unshielded: ${j(s.unshielded.balances)}  coins=${s.unshielded.availableCoins?.length ?? '?'}`);
  console.log(`  BAL shielded  : ${j(s.shielded.balances)}`);
  console.log(`  DUST balance  : ${s.dust.balance(new Date())}`);
});
setTimeout(() => process.exit(0), 900_000);
