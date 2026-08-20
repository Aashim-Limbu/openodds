// Pure parimutuel math and settlement rules. Every rule here mirrors a circuit
// in openodds.compact — if the two ever disagree the UI is lying, so this file
// has a runnable self-check next to it (odds.check.ts, `npm run check`).
import { payoutQuotientOf } from '../../../contract/src/witnesses.ts';

export const MONEYLINE = 0;
export const SPREAD = 1;
export const TOTAL = 2;

export type EventStatusName = 'PENDING' | 'FINAL' | 'VOID' | 'DISPUTED';

/** What one committee seat has filed for an event, if anything. */
export interface SeatReport {
  filed: boolean;
  homeScore2: number;
  awayScore2: number;
}

export interface ChainEvent {
  id: string;
  /** scores in half-points, exactly as the ledger stores them */
  homeScore2: number;
  awayScore2: number;
  status: EventStatusName;
  /** always three, one per seat */
  reports: SeatReport[];
}

export interface ChainMarket {
  id: string;
  eventId: string;
  marketType: number;
  /** line in half-points: -6.5 => 13, O/U 41.5 => 83 */
  halfLine: number;
  favIsHome: boolean;
  pool0: bigint;
  pool1: bigint;
}

export interface Board {
  address: string;
  /** the three sealed committee key hashes */
  oracleKeyHashes: string[];
  events: ChainEvent[];
  markets: ChainMarket[];
  anonymitySet: number;
  claimed: number;
  treasury: bigint;
  at: number;
}

/** The Result of a market: 0 = outcome 0 won, 1 = outcome 1 won, 2 = push. */
export const resultOf = (m: ChainMarket, f: ChainEvent): 0 | 1 | 2 => {
  if (m.marketType === MONEYLINE) {
    if (f.homeScore2 > f.awayScore2) return 0;
    if (f.awayScore2 > f.homeScore2) return 1;
    return 2;
  }
  if (m.marketType === SPREAD) {
    const fav = m.favIsHome ? f.homeScore2 : f.awayScore2;
    const dogPlusLine = (m.favIsHome ? f.awayScore2 : f.homeScore2) + m.halfLine;
    if (fav > dogPlusLine) return 0;
    if (dogPlusLine > fav) return 1;
    return 2;
  }
  const sum = f.homeScore2 + f.awayScore2;
  if (sum > m.halfLine) return 0;
  if (m.halfLine > sum) return 1;
  return 2;
};

export type Settlement = 'PENDING' | 'WON' | 'LOST' | 'PUSH' | 'VOID';

export const settlementOf = (m: ChainMarket, f: ChainEvent | undefined, outcome: 0 | 1): Settlement => {
  // DISPUTED pays nothing until a seat voids it, so it reads as still open.
  if (!f || f.status === 'PENDING' || f.status === 'DISPUTED') return 'PENDING';
  if (f.status === 'VOID') return 'VOID';
  const result = resultOf(m, f);
  if (result === 2) return 'PUSH';
  return result === outcome ? 'WON' : 'LOST';
};

/**
 * Mirror of `claimableTickets`. Payout is in tickets: the whole pot pro-rata on
 * a win, stake back on push/void, nothing on a loss.
 */
export const claimableTickets = (
  m: ChainMarket,
  f: ChainEvent | undefined,
  outcome: 0 | 1,
  tickets: number,
): bigint => {
  const status = settlementOf(m, f, outcome);
  if (status === 'PENDING' || status === 'LOST') return 0n;
  if (status === 'PUSH' || status === 'VOID') return BigInt(tickets);
  const total = m.pool0 + m.pool1;
  const winning = outcome === 0 ? m.pool0 : m.pool1;
  return payoutQuotientOf(BigInt(tickets), total, winning);
};

/** Share of the pot sitting on one outcome — the parimutuel implied probability. */
export const impliedProb = (mine: bigint, total: bigint): number =>
  total === 0n ? 0 : Number(mine) / Number(total);

/** Decimal odds: what one ticket returns if the pool froze right now. */
export const decimalOdds = (mine: bigint, total: bigint): number =>
  mine === 0n ? Infinity : Number(total) / Number(mine);

/** Payout in tickets if you add `tickets` to `outcome` and the pool freezes there. */
export const previewPayout = (m: ChainMarket, outcome: 0 | 1, tickets: number): bigint => {
  if (tickets <= 0) return 0n;
  const k = BigInt(tickets);
  const total = m.pool0 + m.pool1 + k;
  const winning = (outcome === 0 ? m.pool0 : m.pool1) + k;
  return payoutQuotientOf(k, total, winning);
};

/** True when your tickets are the whole pool: bet and claim link trivially. */
export const isSoleBacker = (m: ChainMarket, outcome: 0 | 1, tickets: number): boolean =>
  (outcome === 0 ? m.pool0 : m.pool1) === BigInt(tickets);

// ---- labels -----------------------------------------------------------------

export interface EventNames {
  home: string;
  away: string;
}

const signed = (half: number) => {
  const v = half / 2;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
};

export const lineText = (halfLine: number) => String(halfLine / 2);

export const marketTitle = (m: ChainMarket, names?: EventNames): string => {
  if (m.marketType === MONEYLINE) return 'Moneyline';
  if (m.marketType === SPREAD) {
    const fav = names ? (m.favIsHome ? names.home : names.away) : m.favIsHome ? 'Home' : 'Away';
    return `Spread · ${fav} ${signed(-m.halfLine)}`;
  }
  return `Total · ${lineText(m.halfLine)}`;
};

export const outcomeText = (m: ChainMarket, outcome: 0 | 1, names?: EventNames): string => {
  const home = names?.home ?? 'Home';
  const away = names?.away ?? 'Away';
  if (m.marketType === MONEYLINE) return outcome === 0 ? home : away;
  if (m.marketType === SPREAD) {
    const fav = m.favIsHome ? home : away;
    const dog = m.favIsHome ? away : home;
    return outcome === 0 ? `${fav} ${signed(-m.halfLine)}` : `${dog} ${signed(m.halfLine)}`;
  }
  return outcome === 0 ? `Over ${lineText(m.halfLine)}` : `Under ${lineText(m.halfLine)}`;
};

export const scoreText = (f: ChainEvent) => `${f.homeScore2 / 2}–${f.awayScore2 / 2}`;

export const shortId = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;

// ---- number display ---------------------------------------------------------
// Counts and stakes are exact integers here — no token decimals, no rounding.
// Anything unknown or infinite renders as an em dash, never NaN.

export const fmtInt = (n: bigint | number) => n.toLocaleString('en-US');

export const fmtPct = (x: number) =>
  Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';

export const fmtOdds = (x: number) => (Number.isFinite(x) ? `×${x.toFixed(2)}` : '—');
