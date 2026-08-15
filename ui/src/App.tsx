import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, MoonIcon, RefreshCwIcon, SunIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/toast';
import { BetSlip } from '@/components/bet-slip';
import { Board, type Slip } from '@/components/board';
import { OraclePanel } from '@/components/oracle-panel';
import { Positions } from '@/components/positions';
import { PrivacyPanel } from '@/components/privacy-panel';
import { WalletBar } from '@/components/wallet-bar';
import { TICKET_PRICE } from '@/lib/midnight';
import { fmtInt, shortId } from '@/lib/odds';
import { OpenOddsProvider, useOpenOdds } from '@/state/openodds';

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="10" className="fill-primary" />
      <path d="M12 2a10 10 0 0 1 0 20Z" className="fill-chart-2" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setDark((d) => !d)}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {shortId(text)}
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </button>
  );
}

function ChainStrip() {
  const { board, boardError, settings, refresh } = useOpenOdds();
  if (!settings.contract) return null;

  const pot = board ? board.markets.reduce((sum, m) => sum + m.pool0 + m.pool1, 0n) : 0n;

  return (
    <div className="border-b bg-muted/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          contract <Copyable text={settings.contract} />
        </span>
        <span className="tabular-nums">
          {fmtInt(pot * TICKET_PRICE)} NIGHT in open pools
        </span>
        <span className="tabular-nums">
          anonymity set {fmtInt(board?.anonymitySet ?? 0)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {boardError ? (
            <Badge variant="destructive">indexer unreachable</Badge>
          ) : (
            <span className="tabular-nums">
              updated {board ? new Date(board.at).toLocaleTimeString() : '—'}
            </span>
          )}
          <Button variant="ghost" size="icon" aria-label="Refresh markets" onClick={refresh}>
            <RefreshCwIcon />
          </Button>
        </span>
      </div>
    </div>
  );
}

function ActivityLog() {
  const { activity } = useOpenOdds();
  if (activity.length === 0) return null;
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3">
        {activity.slice(0, 4).map((entry) => (
          <div key={entry.id} className="flex gap-3 font-mono text-xs">
            <span className="tabular-nums text-muted-foreground">
              {new Date(entry.at).toLocaleTimeString()}
            </span>
            <span className={entry.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </footer>
  );
}

function Shell() {
  const { positions } = useOpenOdds();
  const [slip, setSlip] = useState<Slip | null>(null);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Mark />
          <div className="flex flex-col leading-none">
            <span className="font-semibold tracking-tight">OpenOdds</span>
            <span className="text-xs text-muted-foreground">
              everyone watches the odds · no one watches the people
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <WalletBar />
          </div>
        </div>
      </header>

      <ChainStrip />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Tabs defaultValue="markets">
          <TabsList>
            <TabsTrigger value="markets">Markets</TabsTrigger>
            <TabsTrigger value="positions">
              Positions
              {positions.length > 0 && (
                <Badge variant="secondary">{fmtInt(positions.length)}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="oracle">Oracle</TabsTrigger>
            <TabsTrigger value="privacy">Privacy</TabsTrigger>
          </TabsList>

          <TabsContent value="markets" className="pt-4">
            <Board onPick={setSlip} />
          </TabsContent>
          <TabsContent value="positions" className="pt-4">
            <Positions />
          </TabsContent>
          <TabsContent value="oracle" className="pt-4">
            <OraclePanel />
          </TabsContent>
          <TabsContent value="privacy" className="pt-4">
            <PrivacyPanel />
          </TabsContent>
        </Tabs>
      </main>

      <ActivityLog />
      <BetSlip slip={slip} onClose={() => setSlip(null)} />
      <Toaster />
    </div>
  );
}

export function App() {
  return (
    <OpenOddsProvider>
      <Shell />
    </OpenOddsProvider>
  );
}
