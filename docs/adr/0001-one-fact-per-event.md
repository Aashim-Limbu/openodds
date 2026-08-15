# One Fact per Event, and Results derived at Claim time

A transaction takes 19–32 seconds and one wallet must submit strictly serially, so an
Oracle that wrote a Result per Market would need one transaction per Market and could
not keep up with a full slate. We decided that an Oracle writes exactly one Fact per
Event — `(homeScore2, awayScore2, status)` in half-points — and that every Market
derives its own Result from that Fact inside the claim circuit, at Claim time.

## Considered options

- **A Resolve transaction per Market.** Rejected: N Markets on an Event means N serial
  transactions at 20–30s each, and a Market whose transaction has not landed yet is
  unclaimable while its siblings are settled.
- **Iterate the Markets of an Event at resolve time.** Rejected: Compact has no
  in-circuit iteration, recursion or `while`, so the loop cannot exist at all.

## Consequences

- One Oracle transaction settles every Market on an Event. One dispute surface covers
  them too, because there is one Fact to dispute.
- A Result is never stored. Nothing on the ledger says "this Market was won by outcome
  0" — the ledger holds the Fact, and each Claim proves its own Result. Reading a
  Market's Result off-chain means re-implementing the derivation, which is why the
  frontend keeps a self-check that compares its version against the circuit.
- Every Market type lives in the claim circuit. Adding a fourth type is a contract
  change and a redeploy, not a data change.
- All Markets on an Event resolve at the same instant. We cannot settle the moneyline
  early and leave a total open.
