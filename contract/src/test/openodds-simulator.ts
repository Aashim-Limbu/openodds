// In-memory testbed for the OpenOdds contract — no node, prover, or network.
// Pattern from midnightntwrk/example-bboard.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from "../managed/openodds/contract/index.js";
import {
  type OpenOddsPrivateState,
  createPrivateState,
  payoutQuotientOf,
  witnesses,
} from "../witnesses.js";

export const TICKET_PRICE = 100n;

export type MarketSpec = {
  marketId: Uint8Array;
  eventId: Uint8Array;
  /** 0 moneyline, 1 spread, 2 total */
  marketType: bigint;
  /** line in half-points */
  halfLine: bigint;
  favIsHome: boolean;
};

export class OpenOddsSimulator {
  readonly contract: Contract<OpenOddsPrivateState>;
  circuitContext: CircuitContext<OpenOddsPrivateState>;

  constructor(initial: OpenOddsPrivateState, oracleKeyHash: Uint8Array) {
    this.contract = new Contract<OpenOddsPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(initial, "0".repeat(64)),
        oracleKeyHash,
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  switchUser(ps: OpenOddsPrivateState) {
    this.circuitContext = { ...this.circuitContext, currentPrivateState: ps };
  }

  patchUser(patch: Partial<OpenOddsPrivateState>) {
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: { ...this.circuitContext.currentPrivateState, ...patch },
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** tickets staked on a market outcome */
  pool(marketId: Uint8Array, outcome: bigint): bigint {
    const l = this.getLedger();
    const k = pureCircuits.poolKey(marketId, outcome);
    return l.pools.member(k) ? l.pools.lookup(k) : 0n;
  }

  // ---- oracle / creator ----

  createEvent(eventId: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.createEvent(
      this.circuitContext,
      eventId,
    ).context;
    return this.getLedger();
  }

  createMarket(m: MarketSpec): Ledger {
    this.circuitContext = this.contract.impureCircuits.createMarket(
      this.circuitContext,
      m.marketId,
      m.eventId,
      m.marketType,
      m.halfLine,
      m.favIsHome,
    ).context;
    return this.getLedger();
  }

  postScore(eventId: Uint8Array, h2: bigint, a2: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.postScore(
      this.circuitContext,
      eventId,
      h2,
      a2,
    ).context;
    return this.getLedger();
  }

  voidEvent(eventId: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.voidEvent(
      this.circuitContext,
      eventId,
    ).context;
    return this.getLedger();
  }

  // ---- bettor ----

  placeBet(marketId: Uint8Array, outcome: bigint, tickets: bigint): Ledger {
    // witnesses must agree with the bet being placed
    this.patchUser({ marketId, outcome, tickets });
    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);
    const coin = {
      nonce,
      color: new Uint8Array(32), // nativeToken()
      value: tickets * TICKET_PRICE,
    };
    this.circuitContext = this.contract.impureCircuits.placeBet(
      this.circuitContext,
      coin,
      marketId,
      outcome,
      tickets,
    ).context;
    return this.getLedger();
  }

  /**
   * Claim as the current user. Computes the honest quotient from the live pools
   * unless `quotient` is given — tests pass a wrong one to exercise the check.
   */
  claim(quotient?: bigint): bigint {
    const ps = this.circuitContext.currentPrivateState;
    const poolA = this.pool(ps.marketId, 0n);
    const poolB = this.pool(ps.marketId, 1n);
    const total = poolA + poolB;
    const winning = ps.outcome === 0n ? poolA : poolB;
    this.patchUser({
      quotient: quotient ?? payoutQuotientOf(ps.tickets, total, winning),
      payoutRecipient: new Uint8Array(32).fill(0x77),
    });
    const r = this.contract.impureCircuits.claim(this.circuitContext);
    this.circuitContext = r.context;
    return r.result;
  }
}

export { createPrivateState, payoutQuotientOf, pureCircuits };
