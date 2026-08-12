// E2 spike tests: the claim circuit's four risky pieces, including an
// adversarial prover supplying wrong payout quotients.

import { describe, it, expect } from "vitest";
import { pureCircuits, MarketStatus } from "../managed/openodds/contract/index.js";
import { OpenOddsSimulator } from "./openodds-simulator.js";
import { createPrivateState, type OpenOddsPrivateState } from "../witnesses.js";

const bytes = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

const ORACLE_SK = bytes(0xaa);
const ORACLE_KH = pureCircuits.oracleKhOf(ORACLE_SK);

const alice = (): OpenOddsPrivateState => createPrivateState(bytes(1));
const bob = (): OpenOddsPrivateState => createPrivateState(bytes(2));
const oracle = (): OpenOddsPrivateState =>
  createPrivateState(bytes(3), ORACLE_SK);

// spread market, favorite -6.5 (13 half-points), favorite is home
const spreadMarket = (halfLine = 13n) =>
  new OpenOddsSimulator(alice(), {
    oracleKeyHash: ORACLE_KH,
    marketType: 1n,
    halfLine,
    favIsHome: true,
  });

// Standard scenario: Alice 3 tickets on favorite (0), Bob 7 on dog (1).
// Final 24-17 => favScore2 48 vs dog+line 47 => favorite covers.
// Alice: k=3, T=10, W=3 => q = floor(3*10/3) = 10.
const runScenario = (sim: OpenOddsSimulator) => {
  sim.switchUser(alice());
  sim.placeBet(0n, 3n);
  const alicePS = sim.circuitContext.currentPrivateState;
  sim.switchUser(bob());
  sim.placeBet(1n, 7n);
  const bobPS = sim.circuitContext.currentPrivateState;
  return { alicePS, bobPS };
};

describe("placeBet", () => {
  it("updates public pools and stores commitments", () => {
    const sim = spreadMarket();
    runScenario(sim);
    const l = sim.getLedger();
    expect(l.poolA).toBe(3n);
    expect(l.poolB).toBe(7n);
    expect(l.commitments.firstFree()).toBe(2n);
    // nothing about identity on the ledger: only commitments
    const c = pureCircuits.commitmentFor(bytes(1), 0n, 3n);
    expect(l.commitments.findPathForLeaf(c)).toBeDefined();
  });

  it("rejects bets after resolution", () => {
    const sim = spreadMarket();
    runScenario(sim);
    sim.switchUser(oracle());
    sim.postScore(48n, 34n);
    sim.switchUser(alice());
    expect(() => sim.placeBet(0n, 1n)).toThrow(/market closed/);
  });
});

describe("postScore", () => {
  it("rejects a non-oracle caller", () => {
    const sim = spreadMarket();
    sim.switchUser(alice()); // alice's oracleSecretKey is zeros
    expect(() => sim.postScore(48n, 34n)).toThrow(/not the oracle/);
  });

  it("stores the fact and flips status", () => {
    const sim = spreadMarket();
    sim.switchUser(oracle());
    const l = sim.postScore(48n, 34n);
    expect(l.status).toBe(MarketStatus.RESOLVED);
    expect(l.homeScore2).toBe(48n);
    expect(l.awayScore2).toBe(34n);
  });
});

describe("claim: WIN path with witness-quotient division", () => {
  const resolved = () => {
    const sim = spreadMarket();
    const users = runScenario(sim);
    sim.switchUser(oracle());
    sim.postScore(48n, 34n); // favorite covers by exactly half a point
    return { sim, ...users };
  };

  it("pays the winner the correct pro-rata quotient", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, quotient: 10n });
    expect(sim.claim()).toBe(10n);
    expect(sim.getLedger().nullifiers.size()).toBe(1n);
  });

  it("rejects a too-large quotient from an adversarial prover", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, quotient: 11n });
    expect(() => sim.claim()).toThrow(/quotient too big/);
  });

  it("rejects a too-small quotient from an adversarial prover", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, quotient: 9n });
    expect(() => sim.claim()).toThrow(/quotient too small/);
  });

  it("burns the nullifier: no double claim", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, quotient: 10n });
    sim.claim();
    expect(() => sim.claim()).toThrow(/already claimed/);
  });

  it("pays a loser nothing but still burns their nullifier", () => {
    const { sim, bobPS } = resolved();
    sim.switchUser({ ...bobPS, quotient: 0n });
    expect(sim.claim()).toBe(0n);
    expect(() => sim.claim()).toThrow(/already claimed/);
  });

  it("rejects a claim whose commitment was never placed", () => {
    const { sim } = resolved();
    // mallory never bet; her witness invents a position
    const mallory = { ...createPrivateState(bytes(9)), outcome: 0n, tickets: 3n, quotient: 10n };
    sim.switchUser(mallory);
    expect(() => sim.claim()).toThrow(); // findPathForLeaf fails: not in tree
  });

  it("rejects a claim lying about its own bet parameters", () => {
    const { sim, alicePS } = resolved();
    // alice bet 3 tickets; claims 7 — commitment won't be in the tree
    sim.switchUser({ ...alicePS, tickets: 7n, quotient: 23n });
    expect(() => sim.claim()).toThrow();
  });
});

describe("claim: PUSH path", () => {
  it("refunds stake exactly when the spread lands on an even line", () => {
    // -7.0 line (14 half-points), final 24-17 => margin exactly 7 => push
    const sim = spreadMarket(14n);
    const { alicePS, bobPS } = runScenario(sim);
    sim.switchUser(oracle());
    sim.postScore(48n, 34n);
    sim.switchUser({ ...alicePS, quotient: 0n });
    expect(sim.claim()).toBe(3n); // stake back
    sim.switchUser({ ...bobPS, quotient: 0n });
    expect(sim.claim()).toBe(7n); // both sides pushed
  });
});

describe("claim: VOID path", () => {
  it("refunds stake when the oracle voids the market", () => {
    const sim = spreadMarket();
    const { alicePS } = runScenario(sim);
    sim.switchUser(oracle());
    sim.voidMarket();
    sim.switchUser({ ...alicePS, quotient: 0n });
    expect(sim.claim()).toBe(3n);
  });
});

describe("resolution math: totals and moneyline", () => {
  it("total: over wins when sum clears the line", () => {
    // O/U 41.5 => halfLine 83; final 24-17 => sum2 82 => UNDER wins
    const sim = new OpenOddsSimulator(alice(), {
      oracleKeyHash: ORACLE_KH,
      marketType: 2n,
      halfLine: 83n,
      favIsHome: true,
    });
    sim.switchUser(alice());
    sim.placeBet(1n, 5n); // alice takes under
    const alicePS = sim.circuitContext.currentPrivateState;
    sim.switchUser(bob());
    sim.placeBet(0n, 5n); // bob takes over
    sim.switchUser(oracle());
    sim.postScore(48n, 34n);
    // alice: k=5, T=10, W=5 => q=10
    sim.switchUser({ ...alicePS, quotient: 10n });
    expect(sim.claim()).toBe(10n);
  });

  it("moneyline: home win pays home backers", () => {
    const sim = new OpenOddsSimulator(alice(), {
      oracleKeyHash: ORACLE_KH,
      marketType: 0n,
      halfLine: 0n,
      favIsHome: true,
    });
    sim.switchUser(alice());
    sim.placeBet(0n, 2n);
    const alicePS = sim.circuitContext.currentPrivateState;
    sim.switchUser(bob());
    sim.placeBet(1n, 8n);
    sim.switchUser(oracle());
    sim.postScore(48n, 34n);
    // k=2, T=10, W=2 => q=10
    sim.switchUser({ ...alicePS, quotient: 10n });
    expect(sim.claim()).toBe(10n);
  });
});
