import { EyeIcon, EyeOffIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HOSTED_PROOF_SERVER } from '@/lib/midnight';
import { fmtInt } from '@/lib/odds';
import { useOpenOdds } from '@/state/openodds';

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PrivacyPanel() {
  const { board, settings } = useOpenOdds();
  const hosted = settings.proofServer.startsWith(HOSTED_PROOF_SERVER);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Everyone can watch the odds. No one can watch the people.</CardTitle>
          <CardDescription>
            Live anonymity set: {fmtInt(board?.anonymitySet ?? 0)} commitments across every market on
            this contract · {fmtInt(board?.claimed ?? 0)} nullifiers burned.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <EyeIcon className="size-4" />
              Public, by design
            </h3>
            <List
              items={[
                'Every pool and its ticket count — the pools are the odds, so they cannot be hidden and still be a market.',
                'The pool, size and timing of each bet, as a change in the public counters.',
                'The oracle fact: one (home, away) score per event, in half-points.',
                'Every payout amount, as a visible delta on the contract treasury.',
              ]}
            />
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <EyeOffIcon className="size-4" />
              Private
            </h3>
            <List
              items={[
                'Who bet. Stakes arrive as shielded Zswap coins, which carry no payer field.',
                'Which position is yours. A bet inserts a commitment into one shared tree; nothing links it to an address.',
                'Which commitment a claim spends. The claim proves membership of a historic root and burns a market-scoped nullifier.',
                'Where a payout goes: a fresh shielded output you nominate at claim time.',
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What still leaks</CardTitle>
          <CardDescription>
            Stated plainly, because a privacy claim you cannot audit is worth nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <List
            items={[
              'A unique ticket count links bet to claim. If you are the only holder of 7 tickets in a pool, the payout identifies the bet. The slip warns you when you would be the only backer of an outcome.',
              'A small pool is a small crowd. The anonymity set is shared across all markets on the contract, which helps, but an early bet in a quiet market hides behind few people.',
              'Timing correlates. Bets and claims are timestamped by the block they land in; a determined observer with network-level visibility can narrow candidates.',
              'Claiming reveals the outcome and the amount by construction — a payout is a public treasury delta.',
              'Funding and withdrawing shielded balance still touches the outside world. Privacy of the position is not privacy of the wallet.',
              'Position secrets are derived from your wallet seed so they survive a lost device — which also means anyone who learns the seed can run the same scan and enumerate every bet you made. The seed is already the money; treat it as the whole secret.',
            ]}
          />
        </CardContent>
      </Card>

      <Alert variant={hosted ? 'destructive' : 'default'}>
        <TriangleAlertIcon />
        <AlertTitle>
          {hosted ? 'You are proving on a hosted server' : 'Proving happens on ' + settings.proofServer}
        </AlertTitle>
        <AlertDescription>
          <p>
            The proof server receives the witnesses: your position secret, your outcome and your stake.
            A hosted prover therefore sits inside the trust boundary and knows exactly what the chain
            does not. It is the zero-install path and it works, but it is not the private path — run
            your own proof server (the address is editable in Wallet &amp; network) whenever the
            privacy claim matters to you.
          </p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Not built yet</CardTitle>
          <CardDescription>Designed, and not yet true of this deployment.</CardDescription>
        </CardHeader>
        <CardContent>
          <List
            items={[
              'Three independent daemons. The 2-of-3 committee is in the contract and enforced by it, but all three seats currently run from one browser — the contract cannot tell whether the seats are really independent, and today they are not.',
              'The per-market designated auditor view key — the answer to "unauditable casino" — is designed but not in this deployment.',
              'Rake and treasury sweep: winners currently take the whole pot, and the contract charges nothing.',
              'Batch claim, house seeding, cash-out and parlays. Live betting is structurally blocked by a 25-30s transaction cycle.',
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
