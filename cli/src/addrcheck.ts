// Does the wallet watch the address we gave the faucet?
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { Buffer } from 'node:buffer';
import { seedFor, faucetAddress } from './preview.ts';

setNetworkId('preview');
const seed = seedFor('demo');
const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hd.type !== 'seedOk') throw new Error('bad seed');
const d = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
if (d.type !== 'keysDerived') throw new Error('bad derive');
const ks = createKeystore(d.keys[Roles.NightExternal], getNetworkId());

console.log('what we sent to the faucet :', faucetAddress(seed));
const pk = PublicKey.fromKeyStore(ks);
console.log('PublicKey.fromKeyStore     :', JSON.stringify(pk, (_, v) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 200));
for (const k of ['toString', 'asString', 'toBech32m', 'address', 'toHex']) {
  try {
    const v = (pk as any)[k];
    if (typeof v === 'function') console.log(`  pk.${k}() ->`, String(v.call(pk)).slice(0, 90));
  } catch (e) { console.log(`  pk.${k}() threw`, (e as Error).message.slice(0, 60)); }
}
console.log('keystore.getPublicKey()    :', String(ks.getPublicKey()).slice(0, 90));
