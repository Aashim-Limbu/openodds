import { useState } from 'react';
import { WalletIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { HOSTED_PROOF_SERVER } from '@/lib/midnight';
import { fmtInt, shortId } from '@/lib/odds';
import { useOpenOdds } from '@/state/openodds';

const ENDPOINTS = [
  { key: 'indexer', label: 'Indexer (HTTP)' },
  { key: 'indexerWS', label: 'Indexer (WS)' },
  { key: 'node', label: 'Node' },
  { key: 'proofServer', label: 'Proof server' },
  { key: 'networkId', label: 'Network id' },
] as const;

export function WalletBar() {
  const { wallet, connect, connecting, connectError, connectLog, settings, updateSettings } =
    useOpenOdds();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={wallet ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        <WalletIcon data-icon="inline-start" />
        {wallet ? (
          <span className="font-mono tabular-nums">{fmtInt(wallet.shielded)} NIGHT</span>
        ) : (
          'Connect wallet'
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Wallet &amp; network</DialogTitle>
            <DialogDescription>
              An embedded seed wallet, in this tab. No extension: the Lace connector package is
              types-only today and still expects a local proof server, so a stranger could not use
              this app with it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
            {wallet && (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Shielded</span>
                  <span className="font-mono text-sm tabular-nums">{fmtInt(wallet.shielded)} NIGHT</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Unshielded</span>
                  <span className="font-mono text-sm tabular-nums">{fmtInt(wallet.night)} NIGHT</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Dust (fees)</span>
                  <Badge variant={wallet.dust > 0n ? 'secondary' : 'destructive'}>
                    {wallet.dust > 0n ? 'funded' : 'none'}
                  </Badge>
                </div>
                <Separator />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Coin public key</span>
                  <span className="font-mono text-xs">{shortId(wallet.coinPk)}</span>
                </div>
              </div>
            )}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="seed">Wallet seed</FieldLabel>
                <Input
                  id="seed"
                  className="font-mono"
                  value={settings.seed}
                  onChange={(e) => updateSettings({ seed: e.target.value.trim() })}
                />
                <FieldDescription>
                  The default is the local standalone node's genesis seed — the only pre-funded one
                  there is. A fresh seed has no NIGHT, so it cannot pay fees until someone funds it.
                </FieldDescription>
              </Field>

              {ENDPOINTS.map(({ key, label }) => (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{label}</FieldLabel>
                  <Input
                    id={key}
                    className="font-mono text-xs"
                    value={settings[key]}
                    onChange={(e) => updateSettings({ [key]: e.target.value.trim() })}
                  />
                  {key === 'proofServer' && (
                    <FieldDescription>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateSettings({ proofServer: HOSTED_PROOF_SERVER })}
                      >
                        Use the hosted proof server
                      </Button>
                      <span className="block pt-2">
                        Hosted proving needs no Docker, but the server sees your witnesses. See the
                        Privacy tab.
                      </span>
                    </FieldDescription>
                  )}
                </Field>
              ))}
            </FieldGroup>

            {connectLog.length > 0 && (
              <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {connectLog.join('\n')}
              </pre>
            )}

            {connectError && (
              <Alert variant="destructive">
                <AlertTitle>Could not connect</AlertTitle>
                <AlertDescription>{connectError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => void connect()} disabled={connecting}>
              {connecting && <Spinner data-icon="inline-start" />}
              {connecting ? 'Connecting…' : wallet ? 'Reconnect' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
