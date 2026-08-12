// Test simulator for the OpenOdds spike contract. Pattern from example-bboard.
// Runs circuits against an in-memory ledger — no node, prover, or network.

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
} from "../managed/openodds/contract/index.js";
import {
  type OpenOddsPrivateState,
  createPrivateState,
  witnesses,
} from "../witnesses.js";

export type MarketParams = {
  oracleKeyHash: Uint8Array;
  marketType: bigint; // 0 moneyline, 1 spread, 2 total
  halfLine: bigint;
  favIsHome: boolean;
};

export class OpenOddsSimulator {
  readonly contract: Contract<OpenOddsPrivateState>;
  circuitContext: CircuitContext<OpenOddsPrivateState>;

  constructor(initial: OpenOddsPrivateState, params: MarketParams) {
    this.contract = new Contract<OpenOddsPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(initial, "0".repeat(64)),
        params.oracleKeyHash,
        params.marketType,
        params.halfLine,
        params.favIsHome,
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
      currentPrivateState: {
        ...this.circuitContext.currentPrivateState,
        ...patch,
      },
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  placeBet(outcome: bigint, tickets: bigint): Ledger {
    // witnesses must agree with the bet being placed
    this.patchUser({ outcome, tickets });
    this.circuitContext = this.contract.impureCircuits.placeBet(
      this.circuitContext,
      outcome,
      tickets,
    ).context;
    return this.getLedger();
  }

  postScore(h2: bigint, a2: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.postScore(
      this.circuitContext,
      h2,
      a2,
    ).context;
    return this.getLedger();
  }

  voidMarket(): Ledger {
    this.circuitContext = this.contract.impureCircuits.voidMarket(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  claim(): bigint {
    const r = this.contract.impureCircuits.claim(this.circuitContext);
    this.circuitContext = r.context;
    return r.result;
  }
}

export { createPrivateState };
