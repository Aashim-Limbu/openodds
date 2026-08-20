# Sprint to submission

Wave 1 of the AKINDO Midnight Buildathon opened 2026-08-18 and closes
**2026-09-02**. This file is the handover: what is true, what is next, and the
traps that already cost an afternoon. Delete it once we have submitted.

The glossary is `CONTEXT.md`; decisions are in `docs/adr/`; what the product is
and is not is in `README.md`. This file is only the plan.

## Where we are

Done and verified:

- **Contract**: 6 circuits, one deploy holds many markets, **2-of-3 oracle
  committee** with quorum, dispute and void paths. 43 passing tests.
- **Frontend**: markets board, bet slip, positions, claims, oracle panel,
  privacy disclosure. Read path needs no wallet. Entry bundle 196 kB gzipped.
- **Whole path proven end to end in a browser** — against the **local** stack:
  deploy → event → markets → bets → score → claim, paying the exact pro-rata pot.
- **Seed-derived positions** with a restore-from-seed scan, proven by wiping
  local state and claiming the recovered position.
- **Preview wallets funded**, verified on chain by block scan:

  | role | address | holds |
  |---|---|---|
  | demo | `mn_addr_preview1jfxypx9jdzjstc3n4lep3sckd4gsw43fw9la0zjjs56jcvx4h8uqqsctu9` | 5000 tNIGHT |
  | oracle | `mn_addr_preview137zj49qfetlhm47zp6dsp54khvhwnfv6gvhx3htgzfsxmtah0wysxyyq2t` | 5000 tNIGHT |
  | seeder | `mn_addr_preview1hdayrjlv8qdz7puey2q05kk57ac803vp2wdc2syq927gzung9ucqhx5ue8` | 5000 tNIGHT |

  Seeds are in `cli/.preview-wallets.json`, gitignored. The demo seed is meant
  to be published; the oracle seed is not.

**Nothing is deployed to preview yet.** That is the whole of Phase 0 below, and
until it is done there is no submission.

## Phase 0 — the demo path (half a day)

Run in order from `cli/`:

```bash
node --experimental-strip-types src/preview.ts snapshot demo    # ~7 min, one time
node --experimental-strip-types src/preview.ts snapshot oracle  # ~7 min, one time
node --experimental-strip-types src/preview.ts restore demo     # the number that matters
node --experimental-strip-types src/preview.ts deploy           # committee contract → preview
node --experimental-strip-types src/preview.ts slate            # ~10 min of serial transactions
node --experimental-strip-types src/preview.ts publish-demo     # → ui/public/demo-wallet.json
```

`slate` writes `ui/public/slate.json` with the contract, the network and the
human names. `deploy` saves the three seat secrets to `cli/deployments/preview.json`
— gitignored, and the only thing that can settle a market.

**Unverified assumption, and everything rests on it:** that `restore()` skips
the chain scan and a restored wallet is ready in seconds. If it is not, the
demo wallet cannot work and the fallback is a local-stack demo plus video,
which historically scores badly.

## Phase 1 — make it reachable (1 day)

1. Static deploy to a public URL. `npm run build` already copies the ZK
   artifacts into `public/zk`; largest single file is 19 MB, under every host's
   per-file cap.
2. Walk it as a stranger: cold browser, demo wallet, place a bet, claim. On a
   phone as well as a laptop.
3. Translate SDK errors (`Custom error: 138` means nothing to a bettor), show
   transaction ids with explorer links, validate the contract-address field.

## Phase 2 — make it a product (3–4 days)

4. Market factory daemon pulling a real slate from an odds feed, so the board is
   not hand-made.
5. Three seats onto three machines. The committee is enforced by the contract
   but all three seats run from one browser, so the independence the design
   assumes is not yet real. This is the most honest remaining gap.
6. Rake — the only revenue capture point, and it does not exist.
7. Bind names to the chain: `eventId = hash(home, away, league, kickoff)`, so an
   interface cannot relabel a market. Cheap, and closes a real integrity hole.
8. CI running `npm test` and `npm run check` on push.

## Phase 3 — submission (2 days)

9. Demo video. The 2:40 shot list is already written in
   `../research/prediction-market-design.md`, including which waits are
   narration slots rather than dead air.
10. AKINDO fields, every one of them, plus a wave comment as a structured
    checklist with explorer links. Judges read that first.
11. **Flip the repo to public.** It is private, and a private repo on the
    submission form is an instant fail.

## Cut order if time runs out

Rake first, then the market factory becomes a cron on a laptop, then the three
seats stay on one machine and the README says so plainly. Phases 0, 1 and 3 are
not cuttable — a submission without a live URL scores zero regardless of what
the contract does.

## Traps already paid for

- **An address is a hash of the public key, not the public key.** Use
  `PublicKey.fromKeyStore(keystore).address`. Hand-rolling the bech32m encoding
  produced valid-looking addresses nobody watches and lost 15,000 tNIGHT, then
  looked exactly like a broken faucet, a slow sync and a token-key mismatch in
  turn. Verify funding by scanning blocks for the address, never by trusting a
  faucet's success message.
- **The faucet's reported transaction hash does not match the on-chain hash.**
  Looking it up on the indexer always returns nothing. This is not a failure.
- **The faucet needs a captcha token**, so `POST /api/drips` only works from the
  page. A sponsor-funding service cannot lean on it.
- **`additionalFeeOverhead` must be small on a faucet-funded wallet.** The 5e17
  (0.5 DUST) we inherited from the local-stack example makes the dust
  registration fee unpayable for a wallet holding ~0.02 DUST, which blocks the
  bootstrap step entirely. Now a shared `DUST_FEE_OVERHEAD` at 0.001 DUST.
- **Cold wallet sync is ~6.5 minutes** on preview (~133k indices). Anything much
  longer means the wallet is stuck in `waiting for funds`, not syncing.
- `pkill -f` on a pattern that appears in the shell's own command line kills the
  shell. Node processes report `comm` as `MainThread`, not `node`.
- Compact rejects branching on a witness-derived comparison. `oracleSlot()`
  needs `disclose()` on each comparison.
- Private state is scoped per contract: call `setContractAddress` first, and
  never pass `initialPrivateState` on join unless nothing is stored, or joining
  wipes the oracle key.
