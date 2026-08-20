// One store for the whole app: persisted settings/positions/slate, the wallet
// session, the polled board, and every write path. Components stay dumb.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from '@/components/ui/toast';
import * as chain from '../lib/midnight.ts';
// Type-only: the write half is fetched at connect time, never at page load.
import type * as Chain from '../lib/chain.ts';
import type { Board } from '../lib/odds.ts';
import { claimableTickets } from '../lib/odds.ts';
import { deriveSecret, masterFromSeed, nextFreeIndex, scanPositions } from '../lib/recovery.ts';
import {
  DEFAULT_SETTINGS,
  fetchDemoWallet,
  fetchPublishedSlate,
  load,
  newId,
  save,
  type EventMeta,
  type Persisted,
  type Position,
  type Settings,
  type Slate,
} from '../lib/store.ts';

export interface WalletInfo {
  coinPk: string;
  night: bigint;
  shielded: bigint;
  dust: bigint;
}

export interface Entry {
  id: string;
  at: number;
  kind: 'info' | 'ok' | 'error';
  text: string;
}

export interface Busy {
  label: string;
  startedAt: number;
}

/** Measured on the local stack: proving 0.7–7.6s, submission ~16s dominates. */
export const TX_SECONDS = 30;

export interface OpenOddsApi {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  slate: Slate;
  positions: Position[];

  board: Board | null;
  boardError: string | null;
  refresh: () => void;

  wallet: WalletInfo | null;
  connecting: boolean;
  connectError: string | null;
  connectLog: string[];
  connect: () => Promise<void>;
  /** the published pre-funded wallet, if this deployment ships one */
  demoWallet: { seed: string; takenAt?: string } | null;
  useDemoWallet: () => void;

  isOracle: boolean;
  busy: Busy | null;
  activity: Entry[];

  deploy: () => Promise<void>;
  createEvent: (meta: EventMeta) => Promise<void>;
  createMarket: (input: {
    eventId: string;
    marketType: number;
    halfLine: number;
    favIsHome: boolean;
  }) => Promise<void>;
  postScore: (eventId: string, home: number, away: number) => Promise<void>;
  voidEvent: (eventId: string) => Promise<void>;
  placeBet: (input: { marketId: string; outcome: 0 | 1; tickets: number }) => Promise<void>;
  claim: (position: Position) => Promise<void>;
  restorePositions: () => Promise<void>;
  forgetPosition: (id: string) => void;
}

const Ctx = createContext<OpenOddsApi | null>(null);

export const useOpenOdds = (): OpenOddsApi => {
  const api = useContext(Ctx);
  if (!api) throw new Error('useOpenOdds outside OpenOddsProvider');
  return api;
};

const message = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
};

export function OpenOddsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(() => load());
  const [board, setBoard] = useState<Board | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectLog, setConnectLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [activity, setActivity] = useState<Entry[]>([]);
  /** hashes of the seats this browser holds, for matching against the board */
  const [oracleKh, setOracleKh] = useState<string[]>([]);
  const [demo, setDemo] = useState<Awaited<ReturnType<typeof fetchDemoWallet>>>(null);

  const session = useRef<Chain.Session | null>(null);
  /** Set once the write half of the app has been fetched (on connect). */
  const chainMod = useRef<typeof Chain | null>(null);
  const stopBalances = useRef<(() => void) | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  const note = useCallback((kind: Entry['kind'], text: string) => {
    setActivity((prev) => [{ id: newId(), at: Date.now(), kind, text }, ...prev].slice(0, 60));
  }, []);

  // ---- persistence ----------------------------------------------------------
  useEffect(() => {
    save(state);
  }, [state]);

  useEffect(() => {
    chain.applyConfig(state.settings);
  }, [
    state.settings.indexer,
    state.settings.indexerWS,
    state.settings.node,
    state.settings.proofServer,
    state.settings.networkId,
  ]);

  useEffect(() => {
    void fetchDemoWallet().then(setDemo);
  }, []);

  // A published slate plus ?c=<address> is all a visitor needs to see the board.
  useEffect(() => {
    void (async () => {
      const published = await fetchPublishedSlate();
      const fromUrl = new URLSearchParams(location.search).get('c');
      if (!published && !fromUrl) return;
      // A published deployment says which chain it lives on; adopt it unless the
      // visitor has already pointed the app somewhere themselves.
      const preset = published?.network ? chain.NETWORKS[published.network] : undefined;
      setState((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          ...(preset && prev.settings.contract === '' ? preset : {}),
          contract: fromUrl ?? prev.settings.contract ?? published?.contract ?? '',
        },
        slate: {
          contract: published?.contract ?? prev.slate.contract,
          // local edits win: you may be running your own slate over a published one
          events: { ...(published?.events ?? {}), ...prev.slate.events },
        },
      }));
    })();
  }, []);

  // ---- board polling --------------------------------------------------------
  const address = state.settings.contract.trim();
  useEffect(() => {
    if (!address) {
      setBoard(null);
      setBoardError(null);
      return;
    }
    let live = true;
    const read = async () => {
      try {
        const next = await chain.readBoard(address);
        if (!live) return;
        setBoard(next);
        setBoardError(null);
      } catch (e) {
        if (!live) return;
        setBoardError(message(e));
      }
    };
    void read();
    // 6.00s block interval measured on the local node; 5s keeps odds ~current.
    const id = setInterval(read, 5_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [address, refreshKey]);

  // ---- wallet ---------------------------------------------------------------
  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    setConnectLog([]);
    try {
      chain.applyConfig(state.settings);
      const log = (m: string) => setConnectLog((prev) => [...prev, m]);
      log('loading the wallet stack…');
      const mod = await chain.loadChain();
      chainMod.current = mod;

      // The snapshot only fits the wallet it was taken from.
      const seed = state.settings.seed.trim();
      const snapshot = demo && demo.seed === seed ? demo.snapshot : null;
      const ctx = await mod.buildWallet(seed, log, snapshot);
      const providers = await mod.configureProviders(ctx);
      const coinPk = providers.walletProvider.getCoinPublicKey();

      const contract = address ? await mod.joinMarket(providers, address) : null;
      session.current = { providers, contract, address, coinPk };

      setOracleKh(
        await Promise.all(state.settings.oracleSeats.map((sk) => chain.oracleKeyHashOf(chain.unhex(sk)))),
      );

      stopBalances.current?.();
      stopBalances.current = mod.watchBalances(ctx, (b) => setWallet({ coinPk, ...b }));
      note('ok', 'wallet connected');
    } catch (e) {
      console.error(e);
      setConnectError(message(e));
      note('error', `connect failed: ${message(e)}`);
    } finally {
      setConnecting(false);
    }
  }, [address, demo, note, state.settings]);

  useEffect(() => () => stopBalances.current?.(), []);

  // Joining a different contract after connecting must rebuild the handle.
  useEffect(() => {
    const s = session.current;
    const mod = chainMod.current;
    if (!s || !mod || s.address === address) return;
    void (async () => {
      try {
        s.contract = address ? await mod.joinMarket(s.providers, address) : null;
        s.address = address;
        setOracleKh(
          await Promise.all(
            state.settings.oracleSeats.map((sk) => chain.oracleKeyHashOf(chain.unhex(sk))),
          ),
        );
      } catch (e) {
        note('error', `could not join ${address}: ${message(e)}`);
      }
    })();
  }, [address, note, state.settings.oracleSeats]);

  // ---- writes ---------------------------------------------------------------
  const need = () => {
    const s = session.current;
    const mod = chainMod.current;
    if (!s || !mod) throw new Error('connect a wallet first');
    if (!s.contract) throw new Error('no contract joined — deploy one or paste an address');
    return { s, mod };
  };

  // Every write goes through here: one place for the busy flag, the activity
  // log and the toast, so a transaction that finishes while you are on another
  // tab still tells you how it went.
  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      setBusy({ label, startedAt: Date.now() });
      note('info', `${label}…`);
      const toastId = toast.add({
        title: label,
        description: 'proving, then submitting…',
        type: 'loading',
        timeout: 0,
      });
      const t0 = Date.now();
      try {
        const out = await fn();
        const took = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
        note('ok', `${label} · ${took}`);
        toast.update(toastId, { title: label, description: `confirmed in ${took}`, type: 'success', timeout: 6000 });
        refresh();
        return out;
      } catch (e) {
        console.error(e);
        note('error', `${label} failed: ${message(e)}`);
        toast.update(toastId, { title: `${label} failed`, description: message(e), type: 'error', timeout: 12000 });
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [note, refresh],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const deploy = useCallback(async () => {
    const s = session.current;
    const mod = chainMod.current;
    if (!s || !mod) throw new Error('connect a wallet first');
    await run('deploy contract', async () => {
      // Three seats sealed at deploy. Running all three from one browser is the
      // demo; in production each secret lives on a separate daemon.
      const seats = [chain.rand32(), chain.rand32(), chain.rand32()];
      const deployed: any = await mod.deployMarket(s.providers, seats, chain.rand32());
      const addr = deployed.deployTxData.public.contractAddress as string;
      s.contract = deployed;
      s.address = addr;
      setOracleKh(await Promise.all(seats.map((sk) => chain.oracleKeyHashOf(sk))));
      setState((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          contract: addr,
          oracleSeats: seats.map((sk) => chain.hex(sk)),
        },
        slate: { ...prev.slate, contract: addr },
      }));
    });
  }, [run]);

  const createEvent = useCallback(
    async (meta: EventMeta) => {
      const { s, mod } = need();
      const eventId = chain.rand32();
      await run(`create event ${meta.home} v ${meta.away}`, () => mod.oracleTx.createEvent(s, eventId));
      setState((prev) => ({
        ...prev,
        slate: { ...prev.slate, events: { ...prev.slate.events, [chain.hex(eventId)]: meta } },
      }));
    },
    [run],
  );

  const createMarket = useCallback(
    async (input: { eventId: string; marketType: number; halfLine: number; favIsHome: boolean }) => {
      const { s, mod } = need();
      await run('create market', () =>
        mod.oracleTx.createMarket(
          s,
          chain.rand32(),
          chain.unhex(input.eventId),
          input.marketType,
          input.halfLine,
          input.favIsHome,
        ),
      );
    },
    [run],
  );

  const postScore = useCallback(
    async (eventId: string, home: number, away: number) => {
      const { s, mod } = need();
      const seats = state.settings.oracleSeats;
      if (seats.length < 2) throw new Error('need at least two committee seats to reach quorum');
      // Quorum is 2-of-3: two seats must file the same score, so this is two
      // transactions. Scores are half-points, same encoding as the lines.
      for (const [index, seat] of seats.slice(0, 2).entries()) {
        await run(`seat ${index + 1} files ${home}–${away}`, () =>
          mod.oracleTx.postScore(s, chain.unhex(seat), chain.unhex(eventId), home * 2, away * 2),
        );
      }
    },
    [run, state.settings.oracleSeats],
  );

  const voidEvent = useCallback(
    async (eventId: string) => {
      const { s, mod } = need();
      const seat = state.settings.oracleSeats[0];
      if (!seat) throw new Error('no committee seat held');
      await run('void event', () => mod.oracleTx.voidEvent(s, chain.unhex(seat), chain.unhex(eventId)));
    },
    [run],
  );

  const placeBet = useCallback(
    async (input: { marketId: string; outcome: 0 | 1; tickets: number }) => {
      const { s, mod } = need();
      // Seed-derived, not random: a wiped browser can rebuild this position.
      // The index is checked against the tree first — reusing one would reuse
      // the nullifier and make the second bet unclaimable.
      const master = await masterFromSeed(state.settings.seed.trim());
      const ledger = await chain.readLedgerState(s.address);
      const index = await nextFreeIndex(ledger, master, input.marketId);
      const secret = await deriveSecret(master, input.marketId, index);

      const result = await run('place bet', () => mod.placeBet(s, { ...input, secret }));
      const position: Position = {
        id: newId(),
        contract: s.address,
        wallet: s.coinPk,
        marketId: input.marketId,
        outcome: input.outcome,
        tickets: input.tickets,
        secretHex: chain.hex(secret),
        index,
        placedAt: Date.now(),
        blockHeight: result.blockHeight,
      };
      setState((prev) => ({ ...prev, positions: [position, ...prev.positions] }));
    },
    [run, state.settings.seed],
  );

  /**
   * Rebuild positions from the seed. Everything needed is public: the tree says
   * which commitments exist, the nullifier set says which were already paid.
   */
  const restorePositions = useCallback(async () => {
    const s = session.current;
    if (!s) throw new Error('connect a wallet first');
    if (!board) throw new Error('no board loaded');
    await run('restore positions from seed', async () => {
      const master = await masterFromSeed(state.settings.seed.trim());
      const ledger = await chain.readLedgerState(s.address);
      const found = await scanPositions(
        ledger,
        master,
        board.markets.map((m) => m.id),
      );
      setState((prev) => {
        const known = new Set(
          prev.positions.filter((p) => p.contract === s.address).map((p) => p.secretHex),
        );
        const added = found
          .filter((f) => !known.has(f.secretHex))
          .map<Position>((f) => {
            const market = board.markets.find((m) => m.id === f.marketId);
            const fact = market && board.events.find((e) => e.id === market.eventId);
            // Pools freeze once the event resolves, so what it was owed is what it was paid.
            const owed = market ? claimableTickets(market, fact, f.outcome, f.tickets) : 0n;
            return {
              id: newId(),
              contract: s.address,
              wallet: s.coinPk,
              marketId: f.marketId,
              outcome: f.outcome,
              tickets: f.tickets,
              secretHex: f.secretHex,
              index: f.index,
              placedAt: 0, // unknown: recovered, not observed
              ...(f.claimed
                ? { claim: { at: 0, payoutTickets: String(owed) } }
                : {}),
            };
          });
        return { ...prev, positions: [...added, ...prev.positions] };
      });
      note('ok', `recovered ${found.length} position(s) from the tree`);
    });
  }, [board, note, run, state.settings.seed]);

  const claim = useCallback(
    async (position: Position) => {
      const { s, mod } = need();
      const market = board?.markets.find((m) => m.id === position.marketId);
      if (!market) throw new Error('market not on this board');
      const fact = board?.events.find((e) => e.id === market.eventId);
      const quotient = claimableTickets(market, fact, position.outcome, position.tickets);
      const result = await run('claim', () =>
        mod.claimPosition(
          s,
          {
            marketId: position.marketId,
            outcome: position.outcome,
            tickets: position.tickets,
            secret: chain.unhex(position.secretHex),
          },
          quotient,
        ),
      );
      setState((prev) => ({
        ...prev,
        positions: prev.positions.map((p) =>
          p.id === position.id
            ? {
                ...p,
                claim: {
                  at: Date.now(),
                  payoutTickets: String(result.payoutTickets),
                  blockHeight: result.blockHeight,
                },
              }
            : p,
        ),
      }));
    },
    [board, run],
  );

  const forgetPosition = useCallback((id: string) => {
    setState((prev) => ({ ...prev, positions: prev.positions.filter((p) => p.id !== id) }));
  }, []);

  const positions = useMemo(
    () =>
      state.positions.filter(
        (p) => p.contract === address && (!wallet || p.wallet === wallet.coinPk),
      ),
    [state.positions, address, wallet],
  );

  const api: OpenOddsApi = {
    settings: state.settings,
    updateSettings,
    slate: state.slate,
    positions,
    board,
    boardError,
    refresh,
    wallet,
    connecting,
    connectError,
    connectLog,
    connect,
    demoWallet: demo ? { seed: demo.seed, takenAt: demo.snapshot.takenAt } : null,
    useDemoWallet: () => {
      if (demo) updateSettings({ seed: demo.seed });
    },
    // we hold a seat if any of our seat hashes is sealed into this contract
    isOracle: !!board && board.oracleKeyHashes.some((h) => oracleKh.includes(h)),
    busy,
    activity,
    deploy,
    createEvent,
    createMarket,
    postScore,
    voidEvent,
    placeBet,
    claim,
    restorePositions,
    forgetPosition,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export { DEFAULT_SETTINGS };
