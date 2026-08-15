import { useState } from 'react';
import { DownloadIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TxProgress } from '@/components/tx-progress';
import { MONEYLINE, SPREAD, TOTAL, marketTitle, scoreText, shortId } from '@/lib/odds';
import { download } from '@/lib/store';
import { useOpenOdds } from '@/state/openodds';

const TYPES = [
  { value: String(MONEYLINE), label: 'Moneyline' },
  { value: String(SPREAD), label: 'Spread' },
  { value: String(TOTAL), label: 'Total' },
];

export function OraclePanel() {
  const {
    board,
    slate,
    isOracle,
    settings,
    updateSettings,
    deploy,
    createEvent,
    createMarket,
    postScore,
    voidEvent,
    busy,
    wallet,
  } = useOpenOdds();

  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [league, setLeague] = useState('');
  const [kickoff, setKickoff] = useState('');

  const [marketEvent, setMarketEvent] = useState<string | null>(null);
  const [marketType, setMarketType] = useState(String(MONEYLINE));
  const [line, setLine] = useState('6.5');
  const [favIsHome, setFavIsHome] = useState('home');

  const [scoreEvent, setScoreEvent] = useState<string | null>(null);
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');

  const [error, setError] = useState<string | null>(null);

  const open = (board?.events ?? []).filter((e) => e.status === 'PENDING');
  const nameOf = (id: string) => {
    const meta = slate.events[id];
    return meta ? `${meta.home} vs ${meta.away}` : `Event ${shortId(id)}`;
  };

  const guard = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const halfLine = Math.round(Number(line) * 2);
  const lineNeeded = marketType !== String(MONEYLINE);

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <InfoIcon />
        <AlertTitle>This panel stands in for the oracle committee</AlertTitle>
        <AlertDescription>
          <p>
            In production, resolution is a 2-of-3 committee: three daemons on three different
            sports-data providers, each posting the score it observed, gated by key hash. One fact —
            (home, away) in half-points — settles every market on the event, because each claim
            derives its own outcome from that fact in-circuit. This panel posts that same fact by
            hand so the whole path is demonstrable today.
          </p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Deployment</CardTitle>
          <CardDescription>
            One contract holds every market. The oracle key is fixed at deploy and lives only in the
            deploying browser's private state.
          </CardDescription>
          <CardAction>
            {isOracle ? (
              <Badge>You hold the oracle key</Badge>
            ) : (
              <Badge variant="outline">Read-only</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="contract">Contract address</FieldLabel>
              <Input
                id="contract"
                value={settings.contract}
                placeholder="0200…"
                onChange={(e) => updateSettings({ contract: e.target.value.trim() })}
              />
              <FieldDescription>
                Paste an address to watch someone else's markets, or deploy your own below.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" disabled={!wallet || !!busy} onClick={guard(deploy)}>
            Deploy a new contract
          </Button>
          <Button
            variant="ghost"
            disabled={!settings.contract}
            onClick={() =>
              download('slate.json', { contract: settings.contract, events: slate.events })
            }
          >
            <DownloadIcon data-icon="inline-start" />
            Publish slate.json
          </Button>
        </CardFooter>
      </Card>

      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Oracle action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {busy && <TxProgress busy={busy} />}

      {isOracle && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New event</CardTitle>
              <CardDescription>
                Compact has no strings, so the chain stores a 32-byte id; the names live in this
                browser and in the published slate.json.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="home">Home</FieldLabel>
                    <Input id="home" value={home} onChange={(e) => setHome(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="away">Away</FieldLabel>
                    <Input id="away" value={away} onChange={(e) => setAway(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="league">League</FieldLabel>
                    <Input id="league" value={league} onChange={(e) => setLeague(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="kickoff">Kick-off</FieldLabel>
                    <Input
                      id="kickoff"
                      type="datetime-local"
                      value={kickoff}
                      onChange={(e) => setKickoff(e.target.value)}
                    />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button
                disabled={!home || !away || !!busy}
                onClick={guard(async () => {
                  await createEvent({ home, away, league: league || undefined, kickoff: kickoff || undefined });
                  setHome('');
                  setAway('');
                })}
              >
                Create event
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New market</CardTitle>
              <CardDescription>
                Lines are stored in half-points, so −6.5 is 13 and there is no float anywhere. Odd
                values can never push; even ones push on an exact landing.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel>Event</FieldLabel>
                  <Select value={marketEvent} onValueChange={(v) => setMarketEvent(v as string)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick an open event">
                        {(value) => (value ? nameOf(value as string) : 'Pick an open event')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {open.map((event) => (
                          <SelectItem key={event.id} value={event.id}>
                            {nameOf(event.id)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <ToggleGroup
                    variant="outline"
                    value={[marketType]}
                    onValueChange={(v) => v[0] && setMarketType(String(v[0]))}
                  >
                    {TYPES.map((t) => (
                      <ToggleGroupItem key={t.value} value={t.value}>
                        {t.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                {lineNeeded && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="line">
                        {marketType === String(SPREAD) ? 'Favourite by' : 'Total'}
                      </FieldLabel>
                      <Input
                        id="line"
                        type="number"
                        step={0.5}
                        value={line}
                        onChange={(e) => setLine(e.target.value)}
                      />
                      <FieldDescription>Stored as {halfLine} half-points.</FieldDescription>
                    </Field>
                    {marketType === String(SPREAD) && (
                      <Field>
                        <FieldLabel>Favourite</FieldLabel>
                        <ToggleGroup
                          variant="outline"
                          value={[favIsHome]}
                          onValueChange={(v) => v[0] && setFavIsHome(String(v[0]))}
                        >
                          <ToggleGroupItem value="home">Home</ToggleGroupItem>
                          <ToggleGroupItem value="away">Away</ToggleGroupItem>
                        </ToggleGroup>
                      </Field>
                    )}
                  </div>
                )}
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button
                disabled={!marketEvent || !!busy || (lineNeeded && !Number.isFinite(halfLine))}
                onClick={guard(async () => {
                  await createMarket({
                    eventId: marketEvent!,
                    marketType: Number(marketType),
                    halfLine: lineNeeded ? halfLine : 0,
                    favIsHome: favIsHome === 'home',
                  });
                })}
              >
                Create market
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Post the fact</CardTitle>
              <CardDescription>
                One transaction settles every market on the event. Nothing iterates: each claim
                derives its own result from this score.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel>Event</FieldLabel>
                  <Select value={scoreEvent} onValueChange={(v) => setScoreEvent(v as string)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick an open event">
                        {(value) => (value ? nameOf(value as string) : 'Pick an open event')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {open.map((event) => (
                          <SelectItem key={event.id} value={event.id}>
                            {nameOf(event.id)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="hs">Home score</FieldLabel>
                    <Input
                      id="hs"
                      type="number"
                      min={0}
                      value={homeScore}
                      onChange={(e) => setHomeScore(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="as">Away score</FieldLabel>
                    <Input
                      id="as"
                      type="number"
                      min={0}
                      value={awayScore}
                      onChange={(e) => setAwayScore(e.target.value)}
                    />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                disabled={!scoreEvent || !!busy}
                onClick={guard(() => postScore(scoreEvent!, Number(homeScore), Number(awayScore)))}
              >
                Post score
              </Button>
              <Button
                variant="outline"
                disabled={!scoreEvent || !!busy}
                onClick={guard(() => voidEvent(scoreEvent!))}
              >
                Void (postponed / abandoned)
              </Button>
            </CardFooter>
          </Card>
        </>
      )}

      {board && board.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ledger</CardTitle>
            <CardDescription>What the chain says right now.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {board.events.map((event) => (
              <div key={event.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span>{nameOf(event.id)}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {event.status === 'FINAL' ? scoreText(event) : event.status.toLowerCase()} ·{' '}
                  {board.markets.filter((m) => m.eventId === event.id).length} markets
                </span>
              </div>
            ))}
            {board.markets.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 border-t pt-2">
                {board.markets.map((market) => (
                  <div key={market.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {marketTitle(market, slate.events[market.eventId])}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {String(market.pool0)} / {String(market.pool1)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
