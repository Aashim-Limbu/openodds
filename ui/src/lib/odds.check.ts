// Self-check for the settlement math the UI shows. Run: `npm run check`.
// The UI must agree with openodds.compact on every cell, or it is lying to
// bettors about what they are owed.
import assert from 'node:assert/strict';
import {
  MONEYLINE,
  SPREAD,
  TOTAL,
  claimableTickets,
  isSoleBacker,
  resultOf,
  previewPayout,
  settlementOf,
  outcomeText,
  type ChainEvent,
  type ChainMarket,
} from './odds.ts';

const market = (over: Partial<ChainMarket> = {}): ChainMarket => ({
  id: 'aa',
  eventId: 'bb',
  marketType: MONEYLINE,
  halfLine: 0,
  favIsHome: true,
  pool0: 0n,
  pool1: 0n,
  ...over,
});

const noReport = { filed: false, homeScore2: 0, awayScore2: 0 };

const fact = (homeScore2: number, awayScore2: number, status: ChainEvent['status'] = 'FINAL'): ChainEvent => ({
  id: 'bb',
  homeScore2,
  awayScore2,
  status,
  reports: [noReport, noReport, noReport],
});

// ---- resultOf mirrors the circuit -----------------------------------------
assert.equal(resultOf(market(), fact(48, 34)), 0, 'moneyline: home');
assert.equal(resultOf(market(), fact(34, 48)), 1, 'moneyline: away');
assert.equal(resultOf(market(), fact(40, 40)), 2, 'moneyline: draw pushes');

// fav -6.5 (halfLine 13, odd => can never push)
const spread = market({ marketType: SPREAD, halfLine: 13, favIsHome: true });
assert.equal(resultOf(spread, fact(48, 34)), 0, 'spread: fav covers 48 > 34+13');
assert.equal(resultOf(spread, fact(48, 36)), 1, 'spread: dog covers 36+13 > 48');
// fav -6 (halfLine 12, even => exact landing pushes)
const spreadEven = market({ marketType: SPREAD, halfLine: 12, favIsHome: true });
assert.equal(resultOf(spreadEven, fact(48, 36)), 2, 'spread: exact landing pushes');
// away favourite reads the fact the other way round
const spreadAway = market({ marketType: SPREAD, halfLine: 13, favIsHome: false });
assert.equal(resultOf(spreadAway, fact(34, 48)), 0, 'spread: away fav covers');

const total = market({ marketType: TOTAL, halfLine: 83 });
assert.equal(resultOf(total, fact(48, 36)), 0, 'total: over');
assert.equal(resultOf(total, fact(40, 34)), 1, 'total: under');
assert.equal(resultOf(market({ marketType: TOTAL, halfLine: 82 }), fact(48, 34)), 2, 'total: lands, pushes');

// ---- settlement + payout ----------------------------------------------------
const pot = market({ pool0: 3n, pool1: 7n });
assert.equal(settlementOf(pot, fact(48, 34), 0), 'WON');
assert.equal(settlementOf(pot, fact(48, 34), 1), 'LOST');
assert.equal(settlementOf(pot, fact(40, 40), 1), 'PUSH');
assert.equal(settlementOf(pot, fact(48, 34, 'VOID'), 1), 'VOID');
assert.equal(settlementOf(pot, fact(0, 0, 'PENDING'), 0), 'PENDING');
assert.equal(settlementOf(pot, undefined, 0), 'PENDING');

assert.equal(claimableTickets(pot, fact(48, 34), 0, 3), 10n, 'winner takes the whole 10-ticket pot');
assert.equal(claimableTickets(pot, fact(48, 34), 1, 7), 0n, 'loser gets nothing');
assert.equal(claimableTickets(pot, fact(40, 40), 1, 7), 7n, 'push returns the stake');
assert.equal(claimableTickets(pot, fact(48, 34, 'VOID'), 1, 7), 7n, 'void refunds');
assert.equal(claimableTickets(pot, fact(0, 0, 'PENDING'), 0, 3), 0n, 'nothing claimable before resolution');
// pro-rata floors, and the floor is what the circuit checks
assert.equal(claimableTickets(market({ pool0: 4n, pool1: 6n }), fact(48, 34), 0, 1), 2n, 'floor(1*10/4)');
assert.equal(claimableTickets(market({ pool0: 3n, pool1: 4n }), fact(48, 34), 0, 1), 2n, 'floor(1*7/3)');

// The exact inequality the claim circuit asserts: q*W <= k*T < (q+1)*W.
for (let w = 1; w <= 40; w++) {
  for (let l = 0; l <= 40; l += 3) {
    for (let k = 1; k <= w; k++) {
      const m = market({ pool0: BigInt(w), pool1: BigInt(l) });
      const q = claimableTickets(m, fact(48, 34), 0, k);
      const kT = BigInt(k) * BigInt(w + l);
      const qW = q * BigInt(w);
      assert.ok(qW <= kT, `quotient too big for w=${w} l=${l} k=${k}`);
      assert.ok(kT < qW + BigInt(w), `quotient too small for w=${w} l=${l} k=${k}`);
    }
  }
}

// A winner can never be paid more than the pot holds.
for (let w = 1; w <= 20; w++) {
  for (let l = 0; l <= 20; l++) {
    const m = market({ pool0: BigInt(w), pool1: BigInt(l) });
    let paid = 0n;
    for (let k = 0; k < w; k++) paid += claimableTickets(m, fact(48, 34), 0, 1);
    assert.ok(paid <= BigInt(w + l), `overpay at w=${w} l=${l}`);
  }
}

// ---- bet preview ------------------------------------------------------------
assert.equal(previewPayout(market(), 0, 3), 3n, 'first bet in an empty market: stake back at best');
assert.equal(previewPayout(market({ pool1: 7n }), 0, 3), 10n, 'sole backer takes the pot');
assert.equal(previewPayout(market({ pool0: 3n, pool1: 7n }), 0, 3), 6n, 'floor(3*13/6): joining an outcome dilutes it');
assert.equal(previewPayout(market(), 0, 0), 0n, 'no tickets, no payout');

assert.ok(isSoleBacker(market({ pool0: 3n }), 0, 3), 'your tickets are the whole pool');
assert.ok(!isSoleBacker(market({ pool0: 5n }), 0, 3), 'someone else is on this outcome');

// ---- labels -----------------------------------------------------------------
const names = { home: 'Arsenal', away: 'Chelsea' };
assert.equal(outcomeText(spread, 0, names), 'Arsenal −6.5');
assert.equal(outcomeText(spread, 1, names), 'Chelsea +6.5');
assert.equal(outcomeText(total, 0, names), 'Over 41.5');
assert.equal(outcomeText(market(), 1, names), 'Chelsea');

console.log('odds.ts self-check: all assertions passed');
