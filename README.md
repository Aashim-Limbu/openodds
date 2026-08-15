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
4. The Oracle writes one **Fact** for the Event: the score, in half-points. That single
   Fact settles every Market on the Event ([ADR 0001](docs/adr/0001-one-fact-per-event.md)).
5. The Bettor **Claims**. The claim proves that their Commitment is in the tree, burns a
   market-scoped **Nullifier** so it can never be claimed twice, derives its own result
   from the Fact in-circuit, and pays a fresh shielded output. No address, no name, and
   no link back to step 2.

Money is only ever in contract escrow or in a bettor's own wallet. There is no admin key
over escrow and no way for anyone — including us — to freeze or reverse a position
([ADR 0002](docs/adr/0002-permissionless-protocol-no-custody.md)).

## What works today

The whole path runs end to end in a browser against a local Midnight stack, verified by
hand: deploy → create event → create two markets → two bets → post score → claim, with
the payout landing in the wallet at exactly the pro-rata amount.

- **Contract** (`contract/`) — 6 circuits, one deploy holding many markets, 34 passing
  tests including the full resolution matrix, pro-rata flooring, voids, multi-market
  isolation and adversarial provers.
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

- **The oracle committee.** The design is 2-of-3 daemons on three different sports-data
  providers. Today one key hash gates the Fact, and the Oracle panel holds it.
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
cd contract && npm test      # 34 tests: resolution matrix, flooring, voids, adversarial provers
cd ui && npm run check       # typecheck + the UI settlement math against the circuit's rules
cd ui && npm run build       # production build; copies the ZK artifacts into public/zk
```

`ui/src/lib/odds.check.ts` is the important one: it asserts that what the interface
tells a bettor they are owed matches what the claim circuit will actually pay,
including the exact quotient inequality the circuit verifies.

## Licence

Apache-2.0.
