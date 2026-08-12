// OpenOdds witnesses: the private inputs the local machine supplies to circuits.
// Nothing here ever leaves the user's machine except what circuits disclose().

import { Ledger } from "./managed/openodds/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type QualifiedCoin = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
};

export type OpenOddsPrivateState = {
  readonly secretKey: Uint8Array;
  /** side of my bet (0|1) */
  readonly outcome: bigint;
  /** size of my bet in tickets */
  readonly tickets: bigint;
  /** claimed payout quotient q, with q*W <= k*T < (q+1)*W (computed locally) */
  readonly quotient: bigint;
  /** only set for the oracle's wallet */
  readonly oracleSecretKey: Uint8Array;
  /** treasury coin to pay my claim from, discovered off-chain via indexer */
  readonly treasuryCoin: QualifiedCoin;
  /** my fresh shielded payout address */
  readonly payoutRecipient: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  oracleSecretKey: Uint8Array = new Uint8Array(32),
): OpenOddsPrivateState => ({
  secretKey,
  outcome: 0n,
  tickets: 0n,
  quotient: 0n,
  oracleSecretKey,
  treasuryCoin: {
    nonce: new Uint8Array(32),
    color: new Uint8Array(32),
    value: 0n,
    mt_index: 0n,
  },
  payoutRecipient: new Uint8Array(32),
});

type WC = WitnessContext<Ledger, OpenOddsPrivateState>;

export const witnesses = {
  betSecret: ({ privateState }: WC): [OpenOddsPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
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
  treasuryCoin: ({ privateState }: WC): [OpenOddsPrivateState, QualifiedCoin] => [
    privateState,
    privateState.treasuryCoin,
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
