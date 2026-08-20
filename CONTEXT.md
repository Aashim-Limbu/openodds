# OpenOdds

Private parimutuel betting. The pools and the odds are public; the people holding
positions are not. This file is the glossary — the words we use and the ones we
refuse to use. It is not a spec.

## The model

**Parimutuel**:
A market with no fixed price: everyone backing the winning outcome divides the pot in
proportion to their tickets. Nobody quotes odds and nobody takes the other side.
_Avoid_: tote, pool betting, book, fixed odds

**Protocol**:
The contract and the daemons that write to it. It holds no custody and has no admin
key over escrow.
_Avoid_: platform, backend, system

**Interface**:
A hosted frontend onto the Protocol. Ours is one of them, not part of it.
_Avoid_: the app, the site, the product, the platform

## Events and markets

**Event**:
One scheduled contest between a home side and an away side. It is the unit an Oracle
reports on, and one Event can carry many Markets.
_Avoid_: game, match, fixture, contest

**Market**:
Two mutually exclusive Outcomes on one Event at one Line. Moneyline, spread and total
are Market types, not separate concepts.
_Avoid_: bet type, book, line, product

**Outcome**:
One of the two things you can back in a Market — home or away, favourite or underdog,
over or under.
_Avoid_: side, selection, pick, leg, runner

**Line**:
The handicap or threshold a Market is judged against, expressed in Half-points.
_Avoid_: handicap, number, price, odds

**Half-point**:
The unit for every Line and every score: 2 means one point, so 13 means 6.5. An odd
value can never Push.
_Avoid_: decimal, float, points

**Slate**:
The Events and Markets an Operator publishes for a period, together with the human
names for them. Names are never on chain.
_Avoid_: card, schedule, fixtures, board

## Money

**Ticket**:
The fixed unit of stake. A Pool is a count of Tickets, never an amount of money.
_Avoid_: unit, share, chip, lot

**Stake**:
What a Bettor pays to open a Position: Tickets multiplied by the ticket price.
_Avoid_: wager, amount, deposit

**Pool**:
The Tickets backing one Outcome of one Market.
_Avoid_: side, book, liquidity, order book

**Pot**:
Both Pools of a Market together — the money the winners divide.
_Avoid_: prize, total pool, purse

**Odds**:
What a Pool implies about a Payout right now, quoted as a multiple of the Stake. Odds
move as Tickets arrive and are final only when the Market Resolves.
_Avoid_: price, line, probability

**Bet**:
The act of opening a Position. It is a verb.
_Avoid_: using "bet" for the Position itself

**Position**:
One Bettor's claim on a Pot: a Market, an Outcome, a Ticket count and a secret. The
chain holds its Commitment, never its owner.
_Avoid_: bet, wager, ticket, slip, order

**Payout**:
What a Position is owed once its Market Resolves. It is gross, not profit.
_Avoid_: winnings, return, profit

## Resolution

**Fact**:
The one score an Oracle writes for an Event, in Half-points. Every Market on that Event
Resolves from this single Fact.
_Avoid_: result, score report, feed, outcome

**Resolve**:
To make a Market's Result determinate, by writing the Event's Fact.
_Avoid_: settle, grade, close, finalise

**Result**:
Which Outcome won a Market, or Push. It belongs to the Market, is derived from the
Fact, and is never stored.
_Avoid_: outcome, winner, verdict

**Settlement**:
How one Position stands: Open, Won, Lost, Push or Void. A Market has a Result; a
Position has a Settlement. Markets Resolve — Positions never "settle".
_Avoid_: status, grade, result, outcome

**Push**:
A Result where neither Outcome wins and every Stake returns. A drawn scoreline can
cause a Push, but a draw is a scoreline and a Push is a Result.
_Avoid_: draw, tie, void, refund, no action

**Void**:
An Event that will never produce a Fact, so every Position on it refunds.
_Avoid_: cancelled, abandoned, push, refund

**Claim**:
The act of proving a Position and taking its Payout. A Position can be claimed once.
_Avoid_: withdraw, redeem, cash out, settle

## Privacy

**Bettor**:
The person holding a Position. The Protocol never learns who they are.
_Avoid_: user, punter, customer, player, account

**Shielded**:
Money that carries no payer. A Shielded stake says how much arrived, never from whom.
_Avoid_: private, anonymous, hidden

**Commitment**:
The public fingerprint of a Position. It proves the Position exists and reveals
nothing about it.
_Avoid_: hash, leaf, note, receipt

**Nullifier**:
The public marker that a Position has been claimed. It stops a second Claim without
naming the first.
_Avoid_: spend tag, receipt, seal

**Anonymity set**:
Every Commitment on the contract — the crowd a Claim hides in. It is shared across all
Markets, so a quiet Market still borrows the crowd of a busy one.
_Avoid_: crowd, pool, mixer, ring

**Witness**:
A private input to a proof: the Position secret, the Outcome, the Ticket count. Whoever
computes the proof sees the Witness.
_Avoid_: private input, secret, private state

**Oracle**:
The committee permitted to write Facts. It reports scores and can do nothing else — it
cannot touch escrow or a Position.
_Avoid_: admin, owner, operator, referee

**Seat**:
One of the three places on the Oracle committee, held by whoever knows that seat's
secret. A Seat files at most one score per Event.
_Avoid_: key, signer, node, validator

**Quorum**:
Two Seats filing the same score. Nothing settles without it.
_Avoid_: consensus, majority, agreement

**Dispute**:
The state of an Event whose three Seats all filed different scores. It pays nobody; a
Seat then Voids it and every Position refunds.
_Avoid_: conflict, disagreement, error

**Operator**:
Whoever runs an Interface and publishes a Slate.
_Avoid_: house, bookmaker, admin, us

**Auditor**:
A named party who may be shown the Positions of a Market under a view key. Public sees
Odds, the Auditor sees everything, the crowd sees nothing.
_Avoid_: regulator, compliance, admin
