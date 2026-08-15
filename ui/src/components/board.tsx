import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  decimalOdds,
  fmtInt,
  fmtOdds,
  fmtPct,
  impliedProb,
  marketTitle,
  outcomeText,
  scoreText,
  shortId,
  type ChainEvent,
  type ChainMarket,
  type EventNames,
} from '@/lib/odds';
import type { EventMeta } from '@/lib/store';
import { useOpenOdds } from '@/state/openodds';

export interface Slip {
  market: ChainMarket;
  outcome: 0 | 1;
}

const namesOf = (meta: EventMeta | undefined, event: ChainEvent): EventNames =>
  meta ? { home: meta.home, away: meta.away } : { home: 'Home', away: `Away (${shortId(event.id)})` };

function EventStatus({ event }: { event: ChainEvent }) {
  if (event.status === 'VOID') return <Badge variant="destructive">Void · refunds</Badge>;
  if (event.status === 'FINAL') return <Badge variant="secondary">Final {scoreText(event)}</Badge>;
  return <Badge>Open</Badge>;
}

function PoolBar({ market }: { market: ChainMarket }) {
  const total = market.pool0 + market.pool1;
  // An empty pot has no split to show — a half-and-half bar would read as even money.
  if (total === 0n) return <div className="h-1 rounded-full bg-muted" />;
  const share = Number(market.pool0) / Number(total);
  return (
    <div
      className="flex h-1 overflow-hidden rounded-full bg-muted"
      aria-label={`pool split ${fmtPct(share)} to ${outcomeText(market, 0)}`}
    >
      <div className="bg-primary" style={{ width: `${share * 100}%` }} />
      <div className="flex-1 bg-chart-2" />
    </div>
  );
}

function OutcomeButton({
  market,
  outcome,
  names,
  open,
  onPick,
}: {
  market: ChainMarket;
  outcome: 0 | 1;
  names: EventNames;
  open: boolean;
  onPick: (slip: Slip) => void;
}) {
  const mine = outcome === 0 ? market.pool0 : market.pool1;
  const total = market.pool0 + market.pool1;
  return (
    <Button
      variant="outline"
      className="h-auto flex-col items-start gap-1 px-3 py-2.5 text-left"
      disabled={!open}
      onClick={() => onPick({ market, outcome })}
    >
      <span className="w-full truncate text-sm font-medium">{outcomeText(market, outcome, names)}</span>
      <span className="flex w-full items-baseline justify-between font-mono text-xs tabular-nums text-muted-foreground">
        <span>{fmtOdds(decimalOdds(mine, total))}</span>
        <span>
          {fmtPct(impliedProb(mine, total))} · {fmtInt(mine)}
        </span>
      </span>
    </Button>
  );
}

function MarketRow({
  market,
  event,
  names,
  onPick,
}: {
  market: ChainMarket;
  event: ChainEvent;
  names: EventNames;
  onPick: (slip: Slip) => void;
}) {
  const total = market.pool0 + market.pool1;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{marketTitle(market, names)}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {fmtInt(total)} tickets in the pot
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <OutcomeButton
          market={market}
          outcome={0}
          names={names}
          open={event.status === 'PENDING'}
          onPick={onPick}
        />
        <OutcomeButton
          market={market}
          outcome={1}
          names={names}
          open={event.status === 'PENDING'}
          onPick={onPick}
        />
      </div>
      <PoolBar market={market} />
    </div>
  );
}

export function Board({ onPick }: { onPick: (slip: Slip) => void }) {
  const { board, boardError, slate, settings } = useOpenOdds();

  if (!settings.contract.trim()) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No contract yet</EmptyTitle>
          <EmptyDescription>
            Deploy one from the Oracle tab, or paste an existing address into Settings to watch its
            odds. Reading the markets needs no wallet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (boardError && !board) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Cannot read the markets</EmptyTitle>
          <EmptyDescription>{boardError}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!board) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (board.events.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No events on this contract</EmptyTitle>
          <EmptyDescription>
            The oracle has not created any yet. In production a market-factory daemon pulls the
            slate from an odds feed; the Oracle tab stands in for it here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {board.events.map((event) => {
        const meta = slate.events[event.id];
        const names = namesOf(meta, event);
        const markets = board.markets.filter((m) => m.eventId === event.id);
        return (
          <Card key={event.id}>
            <CardHeader>
              <CardDescription>
                {[meta?.league, meta?.kickoff].filter(Boolean).join(' · ') || 'Unlabelled event'}
              </CardDescription>
              <CardTitle>
                {meta ? `${meta.home} vs ${meta.away}` : `Event ${shortId(event.id)}`}
              </CardTitle>
              <CardAction>
                <EventStatus event={event} />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {markets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No markets on this event yet.
                </p>
              ) : (
                markets.map((market) => (
                  <MarketRow
                    key={market.id}
                    market={market}
                    event={event}
                    names={names}
                    onPick={onPick}
                  />
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
