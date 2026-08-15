import { useEffect, useState } from 'react';

import { Progress, ProgressLabel } from '@/components/ui/progress';
import { HOSTED_PROOF_SERVER } from '@/lib/midnight';
import { TX_SECONDS, useOpenOdds, type Busy } from '@/state/openodds';

/**
 * Honest narration: midnight-js gives no phase callbacks, so this shows real
 * elapsed time against a measured expectation instead of inventing steps.
 */
export function TxProgress({ busy }: { busy: Busy }) {
  const { settings } = useOpenOdds();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [busy.startedAt]);

  const elapsed = (now - busy.startedAt) / 1000;
  const hosted = settings.proofServer.startsWith(HOSTED_PROOF_SERVER);
  const expected = hosted ? TX_SECONDS + 38 : TX_SECONDS;

  return (
    <div className="flex w-full flex-col gap-2">
      <Progress value={Math.min(96, (elapsed / expected) * 100)}>
        <ProgressLabel>{busy.label}</ProgressLabel>
        <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
          {elapsed.toFixed(0)}s
        </span>
      </Progress>
      <p className="text-xs text-muted-foreground">
        Proving, then balancing, then two blocks of settlement — about {expected}s.
        {hosted
          ? ' The hosted prover re-uploads a 19.5 MB proving key on every call, which is most of that time.'
          : ' The proof itself is the fast part; submission dominates.'}
      </p>
    </div>
  );
}
