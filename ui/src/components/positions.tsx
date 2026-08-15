import { useState } from 'react';
import { DownloadIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TxProgress } from '@/components/tx-progress';
import { TICKET_PRICE } from '@/lib/midnight';
import {
  claimableTickets,
  fmtInt,
  marketTitle,
  outcomeText,
  settlementOf,
  shortId,
  type Settlement,
} from '@/lib/odds';
import { download, type Position } from '@/lib/store';
import { useOpenOdds } from '@/state/openodds';

const TONE: Record<Settlement, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  WON: 'default',
  PUSH: 'secondary',
  VOID: 'secondary',
  LOST: 'destructive',
};

const LABEL: Record<Settlement, string> = {
  PENDING: 'Open',
  WON: 'Won',
  PUSH: 'Push · stake back',
  VOID: 'Void · refund',
  LOST: 'Lost',
};

export function Positions() {
  const { positions, board, slate, claim, restorePositions, busy, wallet } = useOpenOdds();
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const onRestore = async () => {
    setError(null);
    try {
      await restorePositions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restoreButton = (
    <Button variant="outline" size="sm" disabled={!wallet || !!busy} onClick={() => void onRestore()}>
      <RotateCcwIcon data-icon="inline-start" />
      Restore from seed
    </Button>
  );

  const onClaim = async (position: Position) => {
    setError(null);
    setClaiming(position.id);
    try {
      await claim(position);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaiming(null);
    }
  };

  if (positions.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No positions on this contract</EmptyTitle>
          <EmptyDescription>
            The chain holds a commitment, not your name. Bets made on another device are not listed
            here until you rebuild them from your seed.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {restoreButton}
          {error && <p className="pt-2 text-sm text-destructive">{error}</p>}
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Your seed is the ticket</AlertTitle>
        <AlertDescription>
          <p>
            Each position's secret is derived from your wallet seed, so a wiped browser is
            recoverable: the scan re-derives the candidates and asks the commitment tree which ones
            were really placed. Lose the seed and the payout is unclaimable — nobody, including us,
            can reissue it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => download(`openodds-positions-${Date.now()}.json`, positions)}
            >
              <DownloadIcon data-icon="inline-start" />
              Back up positions
            </Button>
            {restoreButton}
          </div>
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Claim failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {busy && claiming && <TxProgress busy={busy} />}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Market</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="text-right">Tickets</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Payout</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((position) => {
            const market = board?.markets.find((m) => m.id === position.marketId);
            const event = market ? board?.events.find((e) => e.id === market.eventId) : undefined;
            const names = event ? slate.events[event.id] : undefined;
            const status: Settlement = market
              ? settlementOf(market, event, position.outcome)
              : 'PENDING';
            const owed = market ? claimableTickets(market, event, position.outcome, position.tickets) : 0n;
            const claimed = position.claim;

            return (
              <TableRow key={position.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {market ? marketTitle(market, names) : `Market ${shortId(position.marketId)}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {names ? `${names.home} vs ${names.away}` : shortId(position.marketId)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{market ? outcomeText(market, position.outcome, names) : position.outcome}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtInt(position.tickets)}
                </TableCell>
                <TableCell>
                  <Badge variant={TONE[status]}>{LABEL[status]}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {claimed
                    ? `${fmtInt(BigInt(claimed.payoutTickets) * TICKET_PRICE)} NIGHT`
                    : owed > 0n
                      ? `${fmtInt(owed * TICKET_PRICE)} NIGHT`
                      : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {claimed ? (
                    <span className="text-xs text-muted-foreground">
                      Claimed{claimed.blockHeight ? ` · block ${fmtInt(claimed.blockHeight)}` : ''}
                    </span>
                  ) : owed > 0n ? (
                    <Button
                      size="sm"
                      disabled={!wallet || !!busy}
                      onClick={() => void onClaim(position)}
                    >
                      Claim
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
