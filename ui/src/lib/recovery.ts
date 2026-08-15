// Position secrets are derived from the wallet seed, not drawn at random, so a
// lost browser is recoverable: the same seed regenerates the same commitments,
// and the commitment tree says which of them were really placed.
//
//   master   = SHA-256(seed ‖ "openodds:positions:v1")
//   secret_i = SHA-256(master ‖ marketId ‖ i)
//
// Nothing derived here ever leaves the device — the chain only ever sees
// commitmentFor(secret_i, market, outcome, tickets).
import { hex, loadLedger, unhex } from './midnight.ts';

const DOMAIN = new TextEncoder().encode('openodds:positions:v1');

const sha256 = async (...parts: Uint8Array[]): Promise<Uint8Array> => {
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    buf.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
};

const indexBytes = (index: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, index);
  return b;
};

export const masterFromSeed = (seedHex: string) => sha256(unhex(seedHex), DOMAIN);

export const deriveSecret = (master: Uint8Array, marketId: string, index: number) =>
  sha256(master, unhex(marketId), indexBytes(index));

export interface FoundPosition {
  marketId: string;
  outcome: 0 | 1;
  tickets: number;
  secretHex: string;
  index: number;
  claimed: boolean;
}

/**
 * How far a scan looks. A bet is found by re-deriving its secret and trying
 * every (outcome, ticket count) it could have been — the commitment binds all
 * three, so there is no cheaper question to ask the tree.
 */
export const SCAN = { maxIndex: 7, maxTickets: 64 };

type PureCircuits = Awaited<ReturnType<typeof loadLedger>>['pureCircuits'];

const probe = (
  pc: PureCircuits,
  ledger: any,
  secret: Uint8Array,
  marketId: string,
  index: number,
): FoundPosition | null => {
  const mid = unhex(marketId);
  for (const outcome of [0, 1] as const) {
    for (let tickets = 1; tickets <= SCAN.maxTickets; tickets++) {
      const commitment = pc.commitmentFor(secret, mid, BigInt(outcome), BigInt(tickets));
      if (ledger.commitments.findPathForLeaf(commitment) !== undefined) {
        return {
          marketId,
          outcome,
          tickets,
          secretHex: hex(secret),
          index,
          // market-scoped nullifier: burned means this position was already paid
          claimed: ledger.nullifiers.member(pc.nullifierFor(secret, mid)),
        };
      }
    }
  }
  return null;
};

/**
 * The next unused index for a market. Guards the one hazard of deterministic
 * secrets: reusing an index reuses a nullifier, and the second bet could never
 * be claimed.
 */
export const nextFreeIndex = async (
  ledger: any,
  master: Uint8Array,
  marketId: string,
): Promise<number> => {
  const { pureCircuits } = await loadLedger();
  for (let index = 0; index <= SCAN.maxIndex; index++) {
    const secret = await deriveSecret(master, marketId, index);
    if (probe(pureCircuits, ledger, secret, marketId, index) === null) return index;
  }
  throw new Error(`no free position slot left on this market (max ${SCAN.maxIndex + 1})`);
};

/** Re-derive and check every candidate position across the given markets. */
export const scanPositions = async (
  ledger: any,
  master: Uint8Array,
  marketIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<FoundPosition[]> => {
  const { pureCircuits } = await loadLedger();
  const found: FoundPosition[] = [];
  let done = 0;
  for (const marketId of marketIds) {
    for (let index = 0; index <= SCAN.maxIndex; index++) {
      const secret = await deriveSecret(master, marketId, index);
      const hit = probe(pureCircuits, ledger, secret, marketId, index);
      if (hit) found.push(hit);
    }
    onProgress?.(++done, marketIds.length);
  }
  return found;
};
