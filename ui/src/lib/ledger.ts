// Read path: indexer query + ledger decode. Split out of midnight.ts because
// decoding contract state drags in the 10 MB ledger wasm — the app shell should
// paint before that lands, and the board fills in behind it.
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import {
  ledger as readLedger,
  pureCircuits,
} from '../../../contract/src/managed/openodds/contract/index.js';
import { config, hex } from './midnight.ts';
import type { Board, ChainEvent, ChainMarket } from './odds.ts';

export { readLedger, pureCircuits };

const STATUS = ['PENDING', 'FINAL', 'VOID', 'DISPUTED'] as const;

const EMPTY_REPORT = { filed: false, homeScore2: 0, awayScore2: 0 };

let publicProvider: ReturnType<typeof indexerPublicDataProvider> | null = null;
let providerFor = '';

export const publicData = () => {
  if (!publicProvider || providerFor !== config.indexer) {
    publicProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
    providerFor = config.indexer;
  }
  return publicProvider;
};

const poolAt = (l: any, marketId: Uint8Array, outcome: number): bigint => {
  const key = pureCircuits.poolKey(marketId, BigInt(outcome));
  return l.pools.member(key) ? BigInt(l.pools.lookup(key)) : 0n;
};

/** The raw ledger view, for callers that need the commitment tree (recovery). */
export const readLedgerState = async (address: string) => {
  const state = await publicData().queryContractState(address);
  if (state == null) throw new Error('no contract state at that address');
  return readLedger(state.data) as any;
};

export const readBoard = async (address: string): Promise<Board> => {
  const l = await readLedgerState(address);

  const reportsFor = (key: Uint8Array) => {
    if (!l.reports.member(key)) return [EMPTY_REPORT, EMPTY_REPORT, EMPTY_REPORT];
    const set = l.reports.lookup(key);
    return [set.r0, set.r1, set.r2].map((r: any) => ({
      filed: Boolean(r.filed),
      homeScore2: Number(r.h2),
      awayScore2: Number(r.a2),
    }));
  };

  const events: ChainEvent[] = [...l.events].map(([k, v]: any) => ({
    id: hex(k),
    homeScore2: Number(v.homeScore2),
    awayScore2: Number(v.awayScore2),
    status: STATUS[Number(v.status)] ?? 'PENDING',
    reports: reportsFor(k),
  }));

  const markets: ChainMarket[] = [...l.markets].map(([k, v]: any) => ({
    id: hex(k),
    eventId: hex(v.eventId),
    marketType: Number(v.marketType),
    halfLine: Number(v.halfLine),
    favIsHome: Boolean(v.favIsHome),
    pool0: poolAt(l, k, 0),
    pool1: poolAt(l, k, 1),
  }));

  return {
    address,
    oracleKeyHashes: [hex(l.oracleKeyHash0), hex(l.oracleKeyHash1), hex(l.oracleKeyHash2)],
    events,
    markets,
    // Leaves in the one shared commitment tree: the crowd every claim hides in.
    anonymitySet: Number(l.commitments.firstFree()),
    claimed: Number(l.nullifiers.size()),
    treasury: l.treasuryFunded ? BigInt(l.treasury.value) : 0n,
    at: Date.now(),
  };
};

export const oracleKeyHashOf = (secretKey: Uint8Array) => hex(pureCircuits.oracleKhOf(secretKey));
