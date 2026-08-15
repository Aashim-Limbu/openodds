// Everything the browser has to remember. Positions are cached here for speed
// and for their labels, but they are not the only copy: secrets are derived
// from the wallet seed (see recovery.ts), so the same seed rebuilds them from
// the commitment tree on a fresh device.
import { LOCAL_STACK, type ChainConfig } from './midnight.ts';

const KEY = 'openodds:v1';

export interface Position {
  id: string;
  contract: string;
  /** coin public key that placed it — switching seeds must not show foreign bets */
  wallet: string;
  marketId: string;
  outcome: 0 | 1;
  tickets: number;
  secretHex: string;
  /** derivation slot for this market — see recovery.nextFreeIndex */
  index?: number;
  placedAt: number;
  blockHeight?: number;
  claim?: { at: number; payoutTickets: string; blockHeight?: number };
}

export interface EventMeta {
  home: string;
  away: string;
  league?: string;
  kickoff?: string;
}

/** Names are off-chain by necessity: Compact has no strings. */
export interface Slate {
  contract?: string;
  events: Record<string, EventMeta>;
}

export interface Settings extends ChainConfig {
  seed: string;
  contract: string;
}

export interface Persisted {
  settings: Settings;
  positions: Position[];
  slate: Slate;
}

export const DEFAULT_SETTINGS: Settings = {
  ...LOCAL_STACK,
  seed: '0000000000000000000000000000000000000000000000000000000000000001',
  contract: '',
};

const EMPTY: Persisted = { settings: DEFAULT_SETTINGS, positions: [], slate: { events: {} } };

export const load = (): Persisted => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      positions: parsed.positions ?? [],
      slate: { events: {}, ...parsed.slate },
    };
  } catch {
    return EMPTY;
  }
};

export const save = (state: Persisted) => localStorage.setItem(KEY, JSON.stringify(state));

/**
 * A published slate (public/slate.json) makes a deployment shareable: contract
 * address plus the human names for its event ids. Absent, the UI falls back to
 * short hex ids and still works.
 */
export const fetchPublishedSlate = async (): Promise<Slate | null> => {
  try {
    const r = await fetch('/slate.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as Slate;
    return { contract: j.contract, events: j.events ?? {} };
  } catch {
    return null;
  }
};

export const download = (filename: string, data: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const newId = () => crypto.randomUUID();
