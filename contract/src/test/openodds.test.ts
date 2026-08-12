// Full resolution matrix plus the adversarial cases. Every market type is
// exercised on both line parities and all three outcomes (win / loss / push),
// because one posted score fact has to settle all of them correctly.

import { describe, it, expect } from "vitest";
import { pureCircuits, EventStatus } from "../managed/openodds/contract/index.js";
import { OpenOddsSimulator, TICKET_PRICE } from "./openodds-simulator.js";
import { createPrivateState, type OpenOddsPrivateState } from "../witnesses.js";

const bytes = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

const ORACLE_SK = bytes(0xaa);
const ORACLE_KH = pureCircuits.oracleKhOf(ORACLE_SK);

const EVENT = bytes(0xe0);
const MKT = bytes(0x10);

const oracle = (): OpenOddsPrivateState => createPrivateState(bytes(3), ORACLE_SK);
const alice = (): OpenOddsPrivateState => createPrivateState(bytes(1));
const bob = (): OpenOddsPrivateState => createPrivateState(bytes(2));

/** Market with one event, ready for bets. Oracle is the current user. */
const marketWith = (marketType: bigint, halfLine: bigint, favIsHome = true) => {
  const sim = new OpenOddsSimulator(oracle(), ORACLE_KH);
  sim.createEvent(EVENT);
  sim.createMarket({ marketId: MKT, eventId: EVENT, marketType, halfLine, favIsHome });
  return sim;
};

/** Alice takes `aSide`, Bob the other; returns their private states. */
const twoBettors = (
  sim: OpenOddsSimulator,
  aSide: bigint,
  aTickets: bigint,
  bTickets: bigint,
  marketId = MKT,
) => {
  sim.switchUser(alice());
  sim.placeBet(marketId, aSide, aTickets);
  const alicePS = sim.circuitContext.currentPrivateState;
  sim.switchUser(bob());
  sim.placeBet(marketId, aSide === 0n ? 1n : 0n, bTickets);
  const bobPS = sim.circuitContext.currentPrivateState;
  return { alicePS, bobPS };
};

const resolveAs = (sim: OpenOddsSimulator, h2: bigint, a2: bigint) => {
  sim.switchUser(oracle());
  sim.postScore(EVENT, h2, a2);
};

describe("market and event setup", () => {
  it("requires the oracle key", () => {
    const sim = new OpenOddsSimulator(oracle(), ORACLE_KH);
    sim.switchUser(alice()); // no oracle secret
    expect(() => sim.createEvent(EVENT)).toThrow(/not the oracle/);
  });

  it("rejects a market on an unknown event", () => {
    const sim = new OpenOddsSimulator(oracle(), ORACLE_KH);
    expect(() =>
      sim.createMarket({
        marketId: MKT,
        eventId: EVENT,
        marketType: 0n,
        halfLine: 0n,
        favIsHome: true,
      }),
    ).toThrow(/no such event/);
  });

  it("rejects duplicate events and markets", () => {
    const sim = marketWith(0n, 0n);
    expect(() => sim.createEvent(EVENT)).toThrow(/event exists/);
    expect(() =>
      sim.createMarket({
        marketId: MKT,
        eventId: EVENT,
        marketType: 0n,
        halfLine: 0n,
        favIsHome: true,
      }),
    ).toThrow(/market exists/);
  });

  it("rejects an unknown market type", () => {
    const sim = new OpenOddsSimulator(oracle(), ORACLE_KH);
    sim.createEvent(EVENT);
    expect(() =>
      sim.createMarket({
        marketId: MKT,
        eventId: EVENT,
        marketType: 3n,
        halfLine: 0n,
        favIsHome: true,
      }),
    ).toThrow(/bad market type/);
  });
});

describe("placeBet", () => {
  it("moves the public pools and hides the bettor", () => {
    const sim = marketWith(1n, 13n);
    twoBettors(sim, 0n, 3n, 7n);
    expect(sim.pool(MKT, 0n)).toBe(3n);
    expect(sim.pool(MKT, 1n)).toBe(7n);
    // the ledger holds commitments, never identities
    const c = pureCircuits.commitmentFor(bytes(1), MKT, 0n, 3n);
    expect(sim.getLedger().commitments.findPathForLeaf(c)).toBeDefined();
  });

  it("rejects bets on an unknown market", () => {
    const sim = marketWith(1n, 13n);
    sim.switchUser(alice());
    expect(() => sim.placeBet(bytes(0x99), 0n, 1n)).toThrow(/no such market/);
  });

  it("rejects bets after the event resolves", () => {
    const sim = marketWith(1n, 13n);
    twoBettors(sim, 0n, 3n, 7n);
    resolveAs(sim, 48n, 34n);
    sim.switchUser(alice());
    expect(() => sim.placeBet(MKT, 0n, 1n)).toThrow(/event already resolved/);
  });

  it("rejects a zero-ticket bet and a bad outcome", () => {
    const sim = marketWith(1n, 13n);
    sim.switchUser(alice());
    expect(() => sim.placeBet(MKT, 0n, 0n)).toThrow(/zero tickets/);
    expect(() => sim.placeBet(MKT, 2n, 1n)).toThrow(/bad outcome/);
  });
});

// One score fact, every market type, both line parities.
// Final 24-17 => homeScore2 48, awayScore2 34, margin 7, total 41.
describe("resolution matrix (final 24-17)", () => {
  const H = 48n;
  const A = 34n;

  const cases: Array<{
    name: string;
    marketType: bigint;
    halfLine: bigint;
    favIsHome?: boolean;
    /** 0 = outcome0 wins, 1 = outcome1 wins, 2 = push */
    expect: 0n | 1n | 2n;
  }> = [
    // moneyline
    { name: "moneyline: home wins", marketType: 0n, halfLine: 0n, expect: 0n },
    // spread, favourite home, margin 7
    { name: "spread -6.5: favourite covers", marketType: 1n, halfLine: 13n, expect: 0n },
    { name: "spread -7.5: favourite fails", marketType: 1n, halfLine: 15n, expect: 1n },
    { name: "spread -7.0: exact landing pushes", marketType: 1n, halfLine: 14n, expect: 2n },
    // spread with the away side laying the points: away lost by 7
    { name: "spread away -3.5: underdog covers", marketType: 1n, halfLine: 7n, favIsHome: false, expect: 1n },
    // total, sum 41
    { name: "total 40.5: over", marketType: 2n, halfLine: 81n, expect: 0n },
    { name: "total 41.5: under", marketType: 2n, halfLine: 83n, expect: 1n },
    { name: "total 41.0: exact landing pushes", marketType: 2n, halfLine: 82n, expect: 2n },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const sim = marketWith(c.marketType, c.halfLine, c.favIsHome ?? true);
      // 5 tickets each side: winner takes the whole 10-ticket pot
      const { alicePS, bobPS } = twoBettors(sim, 0n, 5n, 5n);
      resolveAs(sim, H, A);

      sim.switchUser(alicePS);
      const aPayout = sim.claim();
      sim.switchUser(bobPS);
      const bPayout = sim.claim();

      if (c.expect === 0n) {
        expect(aPayout).toBe(10n); // whole pot
        expect(bPayout).toBe(0n);
      } else if (c.expect === 1n) {
        expect(aPayout).toBe(0n);
        expect(bPayout).toBe(10n);
      } else {
        expect(aPayout).toBe(5n); // stake back
        expect(bPayout).toBe(5n);
      }
      // conservation: a push returns exactly the stakes, a win pays the pot
      expect(aPayout + bPayout).toBe(10n);
    });
  }

  it("moneyline draw pushes both sides", () => {
    const sim = marketWith(0n, 0n);
    const { alicePS, bobPS } = twoBettors(sim, 0n, 5n, 5n);
    resolveAs(sim, 40n, 40n);
    sim.switchUser(alicePS);
    expect(sim.claim()).toBe(5n);
    sim.switchUser(bobPS);
    expect(sim.claim()).toBe(5n);
  });
});

describe("pro-rata payouts", () => {
  it("splits the pot in proportion to stake", () => {
    const sim = marketWith(1n, 13n);
    // alice 3 on the favourite, bob 7 against; favourite covers
    const { alicePS, bobPS } = twoBettors(sim, 0n, 3n, 7n);
    resolveAs(sim, 48n, 34n);
    sim.switchUser(alicePS);
    expect(sim.claim()).toBe(10n); // 3/3 of a 10-ticket pot
    sim.switchUser(bobPS);
    expect(sim.claim()).toBe(0n);
  });

  it("floors the quotient and leaves dust in the treasury", () => {
    const sim = marketWith(1n, 13n);
    sim.switchUser(alice());
    sim.placeBet(MKT, 0n, 3n);
    const alicePS = sim.circuitContext.currentPrivateState;
    sim.switchUser(bob());
    sim.placeBet(MKT, 0n, 4n); // both on the winning side
    const bobPS = sim.circuitContext.currentPrivateState;
    const carol = createPrivateState(bytes(4));
    sim.switchUser(carol);
    sim.placeBet(MKT, 1n, 3n);
    const carolPS = sim.circuitContext.currentPrivateState;
    resolveAs(sim, 48n, 34n);

    // pot 10, winning pool 7. alice floor(3*10/7)=4, bob floor(4*10/7)=5.
    sim.switchUser(alicePS);
    expect(sim.claim()).toBe(4n);
    sim.switchUser(bobPS);
    expect(sim.claim()).toBe(5n);
    sim.switchUser(carolPS);
    expect(sim.claim()).toBe(0n);
    // 9 of 10 tickets paid out; the rounding dust stays escrowed
  });
});

describe("claim integrity", () => {
  const resolved = () => {
    const sim = marketWith(1n, 13n);
    const users = twoBettors(sim, 0n, 3n, 7n);
    resolveAs(sim, 48n, 34n);
    return { sim, ...users };
  };

  it("rejects a claim before the event resolves", () => {
    const sim = marketWith(1n, 13n);
    const { alicePS } = twoBettors(sim, 0n, 3n, 7n);
    sim.switchUser(alicePS);
    expect(() => sim.claim()).toThrow(/event not resolved/);
  });

  it("rejects a quotient that is too large", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser(alicePS);
    expect(() => sim.claim(11n)).toThrow(/quotient too big/);
  });

  it("rejects a quotient that is too small", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser(alicePS);
    expect(() => sim.claim(9n)).toThrow(/quotient too small/);
  });

  it("burns the nullifier: no double claim", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser(alicePS);
    sim.claim();
    expect(() => sim.claim()).toThrow(/already claimed/);
  });

  it("burns the nullifier even for a loser", () => {
    const { sim, bobPS } = resolved();
    sim.switchUser(bobPS);
    expect(sim.claim()).toBe(0n);
    expect(() => sim.claim()).toThrow(/already claimed/);
  });

  it("rejects a position that was never placed", () => {
    const { sim } = resolved();
    const mallory = { ...createPrivateState(bytes(9)), marketId: MKT, outcome: 0n, tickets: 3n };
    sim.switchUser(mallory);
    expect(() => sim.claim()).toThrow(); // no path: not in the tree
  });

  it("rejects a claim that lies about its own stake", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, tickets: 7n }); // really bet 3
    expect(() => sim.claim()).toThrow();
  });

  it("rejects a claim that lies about its side", () => {
    const { sim, alicePS } = resolved();
    sim.switchUser({ ...alicePS, outcome: 1n }); // really bet 0
    expect(() => sim.claim()).toThrow();
  });
});

describe("multi-market isolation", () => {
  const MKT2 = bytes(0x20);
  const EVENT2 = bytes(0xe1);

  it("keeps pools separate and settles both from their own events", () => {
    const sim = marketWith(1n, 13n); // MKT: spread -6.5 on EVENT
    sim.createEvent(EVENT2);
    sim.createMarket({
      marketId: MKT2,
      eventId: EVENT2,
      marketType: 2n,
      halfLine: 83n, // total 41.5
      favIsHome: true,
    });

    sim.switchUser(alice());
    sim.placeBet(MKT, 0n, 4n);
    const aOnMkt1 = sim.circuitContext.currentPrivateState;
    sim.placeBet(MKT2, 1n, 6n); // same secret, different market
    const aOnMkt2 = sim.circuitContext.currentPrivateState;
    sim.switchUser(bob());
    sim.placeBet(MKT, 1n, 4n);
    sim.placeBet(MKT2, 0n, 6n);

    expect(sim.pool(MKT, 0n)).toBe(4n);
    expect(sim.pool(MKT2, 1n)).toBe(6n);

    // resolve only the first event; the second market must stay unclaimable
    resolveAs(sim, 48n, 34n);
    sim.switchUser(aOnMkt2);
    expect(() => sim.claim()).toThrow(/event not resolved/);

    sim.switchUser(aOnMkt1);
    expect(sim.claim()).toBe(8n); // favourite covers, whole 8-ticket pot

    // now settle the second: 24-17 => total 41 < 41.5 => under (outcome 1) wins
    sim.switchUser(oracle());
    sim.postScore(EVENT2, 48n, 34n);
    sim.switchUser(aOnMkt2);
    expect(sim.claim()).toBe(12n);
  });

  it("one secret can hold positions in many markets (nullifier is market-scoped)", () => {
    const n1 = pureCircuits.nullifierFor(bytes(1), MKT);
    const n2 = pureCircuits.nullifierFor(bytes(1), MKT2);
    expect(n1).not.toEqual(n2);
  });
});

describe("void and refunds", () => {
  it("refunds every position when the event is voided", () => {
    const sim = marketWith(1n, 13n);
    const { alicePS, bobPS } = twoBettors(sim, 0n, 3n, 7n);
    sim.switchUser(oracle());
    sim.voidEvent(EVENT);
    expect(sim.getLedger().events.lookup(EVENT).status).toBe(EventStatus.VOID);
    sim.switchUser(alicePS);
    expect(sim.claim()).toBe(3n);
    sim.switchUser(bobPS);
    expect(sim.claim()).toBe(7n);
  });

  it("cannot void or re-score a resolved event", () => {
    const sim = marketWith(1n, 13n);
    twoBettors(sim, 0n, 3n, 7n);
    resolveAs(sim, 48n, 34n);
    sim.switchUser(oracle());
    expect(() => sim.voidEvent(EVENT)).toThrow(/already resolved/);
    expect(() => sim.postScore(EVENT, 1n, 0n)).toThrow(/already resolved/);
  });
});

describe("stake accounting", () => {
  it("binds the escrowed coin to tickets * price", () => {
    // the simulator always funds tickets*price; assert the contract's own view
    const sim = marketWith(1n, 13n);
    sim.switchUser(alice());
    sim.placeBet(MKT, 0n, 3n);
    expect(sim.getLedger().treasury.value).toBe(3n * TICKET_PRICE);
    sim.switchUser(bob());
    sim.placeBet(MKT, 1n, 7n);
    expect(sim.getLedger().treasury.value).toBe(10n * TICKET_PRICE);
    expect(sim.getLedger().treasuryFunded).toBe(true);
  });
});
