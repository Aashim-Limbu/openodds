import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum MarketStatus { OPEN = 0, RESOLVED = 1, VOID = 2 }

export type Witnesses<PS> = {
  betSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  treasuryCoin(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { nonce: Uint8Array,
                                                                             color: Uint8Array,
                                                                             value: bigint,
                                                                             mt_index: bigint
                                                                           }];
  payoutRecipient(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { bytes: Uint8Array
                                                                              }];
  betOutcome(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  betTickets(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  betPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
          commitment_0: Uint8Array): [PS, { leaf: Uint8Array,
                                            path: { sibling: { field: bigint },
                                                    goes_left: boolean
                                                  }[]
                                          }];
  payoutQuotient(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  oracleSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidMarket(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type ProvableCircuits<PS> = {
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidMarket(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type PureCircuits = {
  ticketPrice(): bigint;
  commitmentFor(sk_0: Uint8Array, outcome_0: bigint, tickets_0: bigint): Uint8Array;
  nullifierFor(sk_0: Uint8Array): Uint8Array;
  oracleKhOf(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  ticketPrice(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  commitmentFor(context: __compactRuntime.CircuitContext<PS>,
                sk_0: Uint8Array,
                outcome_0: bigint,
                tickets_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  nullifierFor(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  oracleKhOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidMarket(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type Ledger = {
  readonly oracleKeyHash: Uint8Array;
  readonly marketType: bigint;
  readonly halfLine: bigint;
  readonly favIsHome: boolean;
  readonly poolA: bigint;
  readonly poolB: bigint;
  readonly status: MarketStatus;
  readonly homeScore2: bigint;
  readonly awayScore2: bigint;
  commitments: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initOracleKeyHash_0: Uint8Array,
               initMarketType_0: bigint,
               initHalfLine_0: bigint,
               initFavIsHome_0: boolean): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
