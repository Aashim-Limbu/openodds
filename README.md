# OpenOdds

**Private parimutuel betting on Midnight. Everyone watches the odds; no one watches the
people.**

A sportsbook knows who you are, what you bet and how much. A public blockchain replaces
that with something worse: it tells *everyone*. OpenOdds keeps the part of a betting
market that has to be public — the pools, and therefore the odds — and hides the part
that never did: who is holding which position.

There is no bookmaker. Every market is **parimutuel**: bettors buy tickets on an
outcome, and whoever backed the winning outcome divides the whole pot in proportion to
their tickets. Nobody quotes a price, nobody takes the other side of your bet, and the
house cannot lose. Odds are simply what the pools currently imply.

The vocabulary used throughout this repo is defined in `CONTEXT.md`; architectural
decisions are recorded in `docs/adr/`.

## How a bet works

1. An **Oracle** creates an **Event** (one match) and its **Markets** — moneyline,
   spread, total. A Market is two **Outcomes** at one **Line**.
2. A **Bettor** puts **Tickets** on an Outcome. The stake arrives as a shielded coin,
   which carries no payer field, so the ledger records that money arrived and never
   from whom. The bet inserts a **Commitment** into one shared tree.
3. The **Pools** move. They are public, because pools *are* the odds — a market that
   hides them is not a market.
4. The **Oracle committee** writes one **Fact** for the Event: the score, in half-points.
   Three seats are sealed into the contract at deploy and an Event settles only when **two
   of them file the same score**; three seats that disagree leave it disputed, which refunds
   rather than guesses. That single Fact then settles every Market on the Event
   ([ADR 0001](docs/adr/0001-one-fact-per-event.md)).
5. The Bettor **Claims**. The claim proves that their Commitment is in the tree, burns a
   market-scoped **Nullifier** so it can never be claimed twice, derives its own result
   from the Fact in-circuit, and pays a fresh shielded output. No address, no name, and
   no link back to step 2.

Money is only ever in contract escrow or in a bettor's own wallet. There is no admin key
over escrow and no way for anyone — including us — to freeze or reverse a position
([ADR 0002](docs/adr/0002-permissionless-protocol-no-custody.md)).

## How it uses Midnight

Midnight keeps two ledgers, and a betting market needs both — that split is the whole
reason this contract can exist here and not on a transparent chain.

**The public ledger holds what a market must publish.** Pool totals, the line, the
event's score once the committee agrees, the commitment tree root, and the spent
nullifier set all live in on-chain state: `markets`, `events`, `pools`, `reports`, and a
`HistoricMerkleTree(12)` of commitments. Pools are public on purpose — pools *are* the
odds, and a market that hides them is not a market.

**The shielded ledger carries the money.** A stake arrives as a Zswap shielded coin, which
has no payer field, so the ledger records that a stake landed without recording whose it
was. A claim pays out to a fresh shielded output, unlinkable to the input that funded it.

**Private state holds what only the bettor knows.** The position secret never leaves the
browser; it is a witness. `placeBet` inserts `commitment = H(secret ‖ marketId ‖ outcome ‖
tickets)` and `claim` proves in-circuit that the commitment sits in the tree, burns a
market-scoped nullifier so it cannot be claimed twice, derives the payout from the public
score, and pays out — without ever disclosing which commitment was used. Person and
position are never on the ledger together.

Two Compact specifics worth naming, because both cost real time:

- The contract branches on witness-derived comparisons in `oracleSlot()`, which the
  information-flow checker rejects until each comparison is wrapped in `disclose()`. What
  is disclosed is only *which seat* is reporting, never the seat's secret.
- Committee seats authenticate by proving knowledge of a preimage rather than by signing,
  because Compact has no signature-verification circuit. The three seat hashes are sealed
  into the contract at deploy.

Resolution is computed **at claim time, not at resolve time**: one fact per event
(`homeScore`, `awayScore`, flags) settles every market on it, and each claim derives its
own win, push or refund from that fact in-circuit ([ADR 0001](docs/adr/0001-one-fact-per-event.md)).

## What works today

The whole path runs end to end in a browser against a local Midnight stack, verified by
hand: deploy → create event → create two markets → two bets → post score → claim, with
the payout landing in the wallet at exactly the pro-rata amount.

- **Contract** (`contract/`) — 6 circuits, one deploy holding many markets, 43 passing
  tests including the full resolution matrix, pro-rata flooring, voids, multi-market
  isolation, adversarial provers, and the committee's quorum and dispute paths.
- **2-of-3 oracle committee** — three seat hashes sealed at deploy, quorum on two matching
  scores, `DISPUTED` on a three-way disagreement, and a void path out of it. A seat proves
  itself by knowing a preimage, because this platform has no signature-verification
  circuits. The board shows the vote in progress: *"1 of 3 seats reported"*.
- **Frontend** (`ui/`) — markets board with live pools and implied odds, bet slip with
  payout preview and privacy warnings, positions with claim, an oracle panel, and a
  privacy disclosure page. Reading the board needs no wallet at all.
- **Wallet** — an embedded seed wallet in the page. No extension: the Lace connector
  package is types-only today and still expects a local proof server, so a stranger
  could not use the app with it.
- **Recovery** — position secrets are derived from the wallet seed, so a wiped browser
  is recoverable. Verified by deleting all local state, restoring from the seed and
  successfully claiming the recovered position.

Measured in-browser on the local stack: a bet takes 29–31 s, a claim 24–27 s, an oracle
transaction 16–22 s. Block interval is 6.00 s and transaction submission dominates —
proving itself is 0.7–7.6 s. First page load is 196 kB gzipped; the ledger wasm and the
wallet stack load only when they are needed.

## What is not built

Stated plainly, because a claim you cannot audit is worth nothing:

- **The three daemons.** The committee is in the contract and enforced by it, but all
  three seats currently live in one browser, so the independence the design assumes is not
  yet real. Separating them onto three machines with three data providers is next.
- **The market factory.** A person creates the slate; the daemon that pulls it from an
  odds feed does not exist yet.
- **Rake.** Winners take the whole pot. The contract charges nothing.
- **The Auditor view key.** Designed, and the answer to "an unauditable casino", but not
  in this contract.
- **Batch claim, cash-out, parlays.** Live betting is structurally blocked: a 25–30 s
  transaction cycle cannot price an in-play market.

## What leaks

- Your pool, your ticket count and the time your bet landed are public. A **unique**
  ticket count links your bet to your claim — the slip warns you when you would be the
  only backer of an outcome.
- A small pool is a small crowd. The anonymity set is shared across every market on the
  contract, which helps, but an early bet in a quiet market hides behind few people.
- Claiming reveals the result and the amount by construction: a payout is a visible
  treasury delta.
- **The proof server sees your witnesses** — your position secret, your outcome and your
  stake. Hosted proving is the zero-install path and it works, but it is not the private
  path. Run your own proof server when the privacy claim matters to you.
- Seed-derived secrets survive a lost device, which also means the seed alone
  enumerates every bet you made.

## Layout

```
contract/   the Compact contract, its witnesses, and the test suite
ui/         the frontend (Vite, React, Tailwind, shadcn/ui)
cli/        node harness used for the spikes and live timing measurements
stack/      docker compose for a local node, indexer and proof server
```

## Run it

Requires Docker, Node 22+, and the Compact toolchain (0.31.1) to rebuild the contract.

```bash
# 1. local chain, indexer and proof server
docker compose -f stack/standalone.yml up -d

# 2. contract: compile and test
cd contract && npm install && npm run compact && npm test

# 3. frontend
cd ../ui && npm install && npm run dev     # http://localhost:5173
```

Then, in the app: open **Wallet & network** and connect (the default seed is the local
node's genesis wallet, the only pre-funded one), go to **Oracle**, deploy a contract,
create an event and a market, and bet on it from **Markets**.

To point the app at a chain you did not start yourself, paste a contract address into
the Oracle tab, or open the app with `?c=<address>`.

## Tests and checks

```bash
cd contract && npm test      # 43 tests: resolution matrix, flooring, voids, quorum, disputes, adversarial provers
cd ui && npm run check       # typecheck + the UI settlement math against the circuit's rules
cd ui && npm run build       # production build; copies the ZK artifacts into public/zk
```

`ui/src/lib/odds.check.ts` is the important one: it asserts that what the interface
tells a bettor they are owed matches what the claim circuit will actually pay,
including the exact quotient inequality the circuit verifies.

## Licence and attribution

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE).

Built on [Midnight](https://midnight.network) with the Compact language and the
`@midnight-ntwrk` SDK family. The privacy model leans on Midnight's Zswap shielded
tokens and its dual-ledger design; the local development stack is Midnight's own
published node, indexer and proof server images.
