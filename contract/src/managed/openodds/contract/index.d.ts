import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum EventStatus { PENDING = 0, FINAL = 1, VOID = 2 }

export type MarketParams = { eventId: Uint8Array;
                             marketType: bigint;
                             halfLine: bigint;
                             favIsHome: boolean;
                             exists: boolean
                           };

export type EventFact = { homeScore2: bigint;
                          awayScore2: bigint;
                          status: EventStatus;
                          exists: boolean
                        };

export type Witnesses<PS> = {
  betSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  betMarketId(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  betOutcome(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  betTickets(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  betPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
          commitment_0: Uint8Array): [PS, { leaf: Uint8Array,
                                            path: { sibling: { field: bigint },
                                                    goes_left: boolean
                                                  }[]
                                          }];
  payoutQuotient(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  payoutRecipient(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { bytes: Uint8Array
                                                                              }];
  oracleSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  createEvent(context: __compactRuntime.CircuitContext<PS>,
              eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createMarket(context: __compactRuntime.CircuitContext<PS>,
               marketId_0: Uint8Array,
               eventId_0: Uint8Array,
               marketType_0: bigint,
               halfLine_0: bigint,
               favIsHome_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            eventId_0: Uint8Array,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidEvent(context: __compactRuntime.CircuitContext<PS>, eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           marketId_0: Uint8Array,
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type ProvableCircuits<PS> = {
  createEvent(context: __compactRuntime.CircuitContext<PS>,
              eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createMarket(context: __compactRuntime.CircuitContext<PS>,
               marketId_0: Uint8Array,
               eventId_0: Uint8Array,
               marketType_0: bigint,
               halfLine_0: bigint,
               favIsHome_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            eventId_0: Uint8Array,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidEvent(context: __compactRuntime.CircuitContext<PS>, eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           marketId_0: Uint8Array,
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type PureCircuits = {
  ticketPrice(): bigint;
  commitmentFor(sk_0: Uint8Array,
                marketId_0: Uint8Array,
                outcome_0: bigint,
                tickets_0: bigint): Uint8Array;
  nullifierFor(sk_0: Uint8Array, marketId_0: Uint8Array): Uint8Array;
  oracleKhOf(sk_0: Uint8Array): Uint8Array;
  poolKey(marketId_0: Uint8Array, outcome_0: bigint): Uint8Array;
}

export type Circuits<PS> = {
  ticketPrice(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  commitmentFor(context: __compactRuntime.CircuitContext<PS>,
                sk_0: Uint8Array,
                marketId_0: Uint8Array,
                outcome_0: bigint,
                tickets_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  nullifierFor(context: __compactRuntime.CircuitContext<PS>,
               sk_0: Uint8Array,
               marketId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  oracleKhOf(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  poolKey(context: __compactRuntime.CircuitContext<PS>,
          marketId_0: Uint8Array,
          outcome_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  createEvent(context: __compactRuntime.CircuitContext<PS>,
              eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createMarket(context: __compactRuntime.CircuitContext<PS>,
               marketId_0: Uint8Array,
               eventId_0: Uint8Array,
               marketType_0: bigint,
               halfLine_0: bigint,
               favIsHome_0: boolean): __compactRuntime.CircuitResults<PS, []>;
  postScore(context: __compactRuntime.CircuitContext<PS>,
            eventId_0: Uint8Array,
            h2_0: bigint,
            a2_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  voidEvent(context: __compactRuntime.CircuitContext<PS>, eventId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  placeBet(context: __compactRuntime.CircuitContext<PS>,
           coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
           marketId_0: Uint8Array,
           outcome_0: bigint,
           tickets_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  claim(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type Ledger = {
  readonly oracleKeyHash: Uint8Array;
  markets: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): MarketParams;
    [Symbol.iterator](): Iterator<[Uint8Array, MarketParams]>
  };
  events: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): EventFact;
    [Symbol.iterator](): Iterator<[Uint8Array, EventFact]>
  };
  pools: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
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
  readonly treasury: { nonce: Uint8Array,
                       color: Uint8Array,
                       value: bigint,
                       mt_index: bigint
                     };
  readonly treasuryFunded: boolean;
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
               initOracleKeyHash_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
