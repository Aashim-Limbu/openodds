# Permissionless Protocol, no custody, Interface held separate

The obvious path for a betting product is a licensed Operator who holds customer funds
and KYCs Bettors, but that Operator would know exactly the thing this Protocol exists
to hide. We decided on 2026-08-12 that the Protocol is permissionless and custody-free:
Stakes sit in contract escrow or in a Bettor's own wallet and nowhere else, there is no
admin key over escrow, there is no KYC in the Protocol, and any frontend — ours
included — is a separately hosted Interface rather than part of it. The founder made
this call with the regulatory risk stated and accepted.

## Considered options

- **Custodial Operator with KYC.** Rejected: it reintroduces the exact party that can
  link Bettor to Position, which makes the privacy claim theatre.
- **Permissioned Bettor whitelist.** Rejected: same linkage problem, plus an admin key
  that must then be defended forever.

## Consequences

- We cannot freeze, reverse or claw back a Position. There is no lever to pull, by
  construction, and that is the point.
- Geo-gating, terms of service and any licence are decisions for whoever operates an
  Interface. They are out of Protocol scope.
- The answer to "an unauditable casino" is the per-Market Auditor view key plus the
  public settlement trail — selective disclosure to a named party rather than
  disclosure to everyone. The Auditor is designed language today, not deployed code.
- Rake and treasury parameters are sealed at deploy. Changing them means a new
  contract, not an admin transaction.
