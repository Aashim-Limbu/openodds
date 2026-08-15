import { useEffect, useState } from 'react';
import { EyeOffIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TxProgress } from '@/components/tx-progress';
import { TICKET_PRICE } from '@/lib/midnight';
import {
  decimalOdds,
  fmtInt,
  fmtOdds,
  fmtPct,
  impliedProb,
  isSoleBacker,
  marketTitle,
  previewPayout,
  outcomeText,
} from '@/lib/odds';
import { useOpenOdds } from '@/state/openodds';
import type { Slip } from '@/components/board';

const QUICK = [1, 3, 5, 10];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={
          strong
            ? 'font-mono text-sm font-semibold tabular-nums'
            : 'font-mono text-sm tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}

export function BetSlip({ slip, onClose }: { slip: Slip | null; onClose: () => void }) {
  const { placeBet, busy, wallet, connect, connecting, slate, board } = useOpenOdds();
  const [tickets, setTickets] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTickets(1);
    setError(null);
  }, [slip?.market.id, slip?.outcome]);

  // Follow the live pools so the numbers move under an open slip.
  const market = slip ? (board?.markets.find((m) => m.id === slip.market.id) ?? slip.market) : null;
  const outcome = slip?.outcome ?? 0;
  const event = market ? board?.events.find((e) => e.id === market.eventId) : undefined;
  const names = event ? slate.events[event.id] : undefined;

  const stake = BigInt(Math.max(0, tickets)) * TICKET_PRICE;
  const payout = market ? previewPayout(market, outcome, tickets) : 0n;
  const profit = payout - BigInt(Math.max(0, tickets));
  const mine = market ? (outcome === 0 ? market.pool0 : market.pool1) : 0n;
  const total = market ? market.pool0 + market.pool1 : 0n;
  const alone = market ? isSoleBacker(market, outcome, tickets) || mine === 0n : false;

  const submit = async () => {
    if (!market) return;
    setError(null);
    try {
      await placeBet({ marketId: market.id, outcome, tickets });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet open={!!slip} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {market && (
          <>
            <SheetHeader>
              <SheetTitle>{outcomeText(market, outcome, names)}</SheetTitle>
              <SheetDescription>
                {marketTitle(market, names)}
                {names ? ` · ${names.home} vs ${names.away}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tickets">Tickets</FieldLabel>
                  <div className="flex items-center gap-2">
                    <ToggleGroup
                      variant="outline"
                      value={[String(tickets)]}
                      onValueChange={(value) => {
                        const picked = Number(value[0]);
                        if (picked) setTickets(picked);
                      }}
                    >
                      {QUICK.map((n) => (
                        <ToggleGroupItem key={n} value={String(n)}>
                          {n}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <Input
                      id="tickets"
                      type="number"
                      min={1}
                      className="w-24"
                      value={tickets}
                      onChange={(e) => setTickets(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    />
                  </div>
                  <FieldDescription>
                    One ticket costs {fmtInt(TICKET_PRICE)} NIGHT. The price is fixed in the
                    contract, so a pool is just a count of tickets.
                  </FieldDescription>
                </Field>
              </FieldGroup>

              <div className="flex flex-col divide-y">
                <Row label="Stake" value={`${fmtInt(stake)} NIGHT`} />
                <Row
                  label="This outcome after your bet"
                  value={`${fmtInt(mine + BigInt(tickets))} of ${fmtInt(total + BigInt(tickets))} tickets`}
                />
                <Row
                  label="Implied odds after your bet"
                  value={`${fmtOdds(decimalOdds(mine + BigInt(tickets), total + BigInt(tickets)))} · ${fmtPct(
                    impliedProb(mine + BigInt(tickets), total + BigInt(tickets)),
                  )}`}
                />
                <Row
                  label="Payout if the pool freezes here"
                  value={`${fmtInt(payout * TICKET_PRICE)} NIGHT`}
                  strong
                />
                <Row
                  label="Profit"
                  value={`${profit >= 0n ? '+' : '−'}${fmtInt((profit < 0n ? -profit : profit) * TICKET_PRICE)} NIGHT`}
                />
              </div>

              <Alert>
                <EyeOffIcon />
                <AlertTitle>What this bet reveals</AlertTitle>
                <AlertDescription>
                  <p>
                    Public: this pool, {tickets} ticket{tickets === 1 ? '' : 's'}, and the time it
                    lands. Private: that it was you — the stake arrives as a shielded coin with no
                    payer field, and your claim later proves membership of{' '}
                    {fmtInt(board?.anonymitySet ?? 0)} commitments without naming one.
                  </p>
                </AlertDescription>
              </Alert>

              {alone && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>You would be the only backer of this outcome</AlertTitle>
                  <AlertDescription>
                    Nobody else is holding tickets here, so the payout on settlement points straight
                    back at this bet. Wait for company, or split the stake across sizes.
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>Bet failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>

            <SheetFooter>
              {busy ? (
                <TxProgress busy={busy} />
              ) : wallet ? (
                <Button onClick={submit} disabled={tickets < 1}>
                  Place bet · {fmtInt(stake)} NIGHT
                </Button>
              ) : (
                <Button onClick={() => void connect()} disabled={connecting}>
                  {connecting ? 'Connecting…' : 'Connect wallet to bet'}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
