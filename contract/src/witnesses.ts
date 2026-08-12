// OpenOdds witnesses: the private inputs the local machine supplies to circuits.
// Nothing here ever leaves the user's machine except what circuits disclose().

import type { Ledger } from "./managed/openodds/contract/index.js";
import type { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type OpenOddsPrivateState = {
  /** the secret behind every position this wallet holds */
  readonly secretKey: Uint8Array;
  /** which market the pending bet/claim refers to */
  readonly marketId: Uint8Array;
  /** side of the bet (0|1) */
  readonly outcome: bigint;
  /** size of the bet in tickets */
  readonly tickets: bigint;
  /** payout quotient q with q*W <= k*T < (q+1)*W, computed locally */
  readonly quotient: bigint;
  /** fresh shielded address to receive a payout */
  readonly payoutRecipient: Uint8Array;
  /** only set on the oracle's wallet */
  readonly oracleSecretKey: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  oracleSecretKey: Uint8Array = new Uint8Array(32),
): OpenOddsPrivateState => ({
  secretKey,
  marketId: new Uint8Array(32),
  outcome: 0n,
  tickets: 0n,
  quotient: 0n,
  payoutRecipient: new Uint8Array(32),
  oracleSecretKey,
});

/** floor(k*T/W) — the quotient the claim circuit verifies. */
export const payoutQuotientOf = (tickets: bigint, total: bigint, winning: bigint): bigint =>
  winning === 0n ? 0n : (tickets * total) / winning;

type WC = WitnessContext<Ledger, OpenOddsPrivateState>;

export const witnesses = {
  betSecret: ({ privateState }: WC): [OpenOddsPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],
  betMarketId: ({ privateState }: WC): [OpenOddsPrivateState, Uint8Array] => [
    privateState,
    privateState.marketId,
  ],
  betOutcome: ({ privateState }: WC): [OpenOddsPrivateState, bigint] => [
    privateState,
    privateState.outcome,
  ],
  betTickets: ({ privateState }: WC): [OpenOddsPrivateState, bigint] => [
    privateState,
    privateState.tickets,
  ],
  betPath: (
    { ledger, privateState }: WC,
    commitment: Uint8Array,
  ): [OpenOddsPrivateState, ReturnType<Ledger["commitments"]["findPathForLeaf"]>] => {
    const path = ledger.commitments.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error("no path for commitment: not in the tree");
    }
    return [privateState, path];
  },
  payoutQuotient: ({ privateState }: WC): [OpenOddsPrivateState, bigint] => [
    privateState,
    privateState.quotient,
  ],
  payoutRecipient: (
    { privateState }: WC,
  ): [OpenOddsPrivateState, { bytes: Uint8Array }] => [
    privateState,
    { bytes: privateState.payoutRecipient },
  ],
  oracleSecretKey: ({ privateState }: WC): [OpenOddsPrivateState, Uint8Array] => [
    privateState,
    privateState.oracleSecretKey,
  ],
};
