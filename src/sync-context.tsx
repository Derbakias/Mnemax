// Sync with the user's other devices, app-wide rather than only on the Settings screen: listening while the
// app is open, syncing by itself, and the state the Sync section shows (the paired devices, the latest message
// and the Details log).
//
// When this device listens (announces itself and takes connections from its paired devices):
// - only in the app (a browser can't), with at least one paired device;
// - on a phone, only while the app is on screen (Android puts it to sleep in the background anyway);
// - with Sync automatically on, whenever the app is open; with it off, only while the Settings tab is open.
//
// When it syncs by itself (Sync automatically on): when the app opens or comes back to the screen (so opening
// Mnemax on one device syncs it with any other that's open), after a round is played, and every few minutes.
// Never while a round is being played. A sync that finds nothing says nothing: only what needs the person
// shows (new rounds, a device that forgot this one, another version); everything goes in the Details log.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { useSettings } from '@/settings-context';
import { onRoundPlayed, onRoundsChanged } from '@/storage';
import {
  apiMismatch,
  failureCode,
  isPhone,
  saveReceived,
  startListening,
  stopListening,
  syncAvailable,
  syncStatus,
  syncWith,
  updateListeningRounds,
  type ListenEvent,
  type SyncPeer,
  type SyncResult,
  type SyncStatus,
} from '@/sync';

// TODO: move to a config
/** How often the app syncs by itself while it's open. */
const AUTO_SYNC_MS = 3 * 60 * 1000;
/** After the app opens or a round is played, how long to wait before syncing: the announcement goes out first. */
const AUTO_SYNC_DELAY_MS = 1500;
/** The Details log keeps this many steps, the latest. */
const MAX_LOG_LINES = 300;
/** Failures an automatic sync shows (the rest, like the other device not being open, only go in the log). */
const AUTO_FAILURES_SHOWN = ['unknownThere', 'otherVersion', 'storage', 'keyStore'];

/** A message under the Sync section: what happened, or what went wrong. */
export type Notice = { kind: 'info' | 'error'; text: string };

export interface LogLine {
  at: number;
  text: string;
}

interface SyncContextValue {
  /** In the app, where sync works (not a browser). */
  available: boolean;
  status: SyncStatus | null;
  setStatus: (status: SyncStatus) => void;
  /** The status is loaded, and the Rust side matches this page. */
  usable: boolean;
  /** Paired devices can reach this one now. */
  listening: boolean;
  refresh: () => void;
  notice: Notice | null;
  inform: (text: string) => void;
  /** Shows the error, and notes it in the log unless `noteIt` is false (the Rust side notes its own). */
  failWith: (error: unknown, noteIt?: boolean) => void;
  /** A device to offer forgetting on this side only: one that can't be reached, or no longer knows this one. */
  forgetHere: SyncPeer | null;
  offerForgetHere: (peer: SyncPeer | null) => void;
  /** Clears the message, and with it any offer that went with it. */
  dismiss: () => void;
  /** Every step of the latest pairing, sync or forgetting, for the Details view. */
  log: { start: number; lines: LogLine[] };
  note: (text: string) => void;
  /** Starts the log over (and clears the message): a new attempt. */
  restart: (text: string) => void;
  /** The device being synced with. */
  syncing: string | null;
  /** Syncs with the device now, as asked (showing how it went, whatever happens). */
  syncWithPeer: (peer: SyncPeer) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync outside SyncProvider');
  return value;
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** The app is on screen (not in the background or minimised). */
function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible');
}

/**
 * @param settingsActive The Settings tab is showing: with Sync automatically off, the device listens only then.
 * @param playing A round is being played: no automatic sync meanwhile, so it can't disturb the timing.
 */
export function SyncProvider({
  settingsActive,
  playing,
  children,
}: {
  settingsActive: boolean;
  playing: boolean;
  children: ReactNode;
}) {
  const available = syncAvailable();
  const { prefs, ready: prefsReady } = useSettings();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [forgetHere, setForgetHere] = useState<SyncPeer | null>(null);
  const [log, setLog] = useState<{ start: number; lines: LogLine[] }>({ start: Date.now(), lines: [] });
  const [listening, setListening] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const syncingRef = useRef<string | null>(null);

  const note = useCallback((text: string) => {
    setLog((l) => ({ ...l, lines: [...l.lines.slice(-(MAX_LOG_LINES - 1)), { at: Date.now(), text }] }));
  }, []);
  const restart = useCallback((text: string) => {
    const start = Date.now();
    setLog({ start, lines: [{ at: start, text }] });
    setNotice(null);
    setForgetHere(null);
  }, []);
  const inform = useCallback((text: string) => setNotice({ kind: 'info', text }), []);
  const failWith = useCallback(
    (error: unknown, noteIt = true) => {
      const text = errorText(error);
      setNotice({ kind: 'error', text });
      if (noteIt) note(`Failed: ${text}`);
    },
    [note],
  );
  const dismiss = useCallback(() => {
    setNotice(null);
    setForgetHere(null);
  }, []);

  const refresh = useCallback(() => {
    if (!available) return;
    syncStatus().then((next) => {
      setStatus(next);
      const mismatch = apiMismatch(next);
      if (mismatch) failWith(mismatch);
    }, failWith);
  }, [available, failWith]);
  useEffect(refresh, [refresh]);

  const usable = status != null && apiMismatch(status) == null;
  const hasPeers = (status?.peers.length ?? 0) > 0;
  const visible = usePageVisible();
  const awake = !isPhone() || visible;
  const shouldListen = available && usable && prefsReady && hasPeers && awake && (prefs.autoSync || settingsActive);

  const onListen = useCallback(
    (event: ListenEvent) => {
      if (event.kind === 'step') {
        note(`[listening] ${event.text}`);
      } else if (event.kind === 'synced') {
        saveReceived(event.rounds).then(
          (result) => {
            note(`[listening] Saved ${result.added} new, skipped ${result.skipped} broken.`);
            if (result.added > 0 || result.skipped > 0) inform(syncedText(event.peer.name, result));
          },
          (error) => failWith(`Couldn't save the rounds from ${event.peer.name}: ${errorText(error)}`),
        );
        refresh();
      } else if (event.kind === 'unpaired') {
        inform(`${event.name} unpaired this device, so it's removed here too.`);
        refresh();
      } else {
        failWith(event.message, false);
      }
    },
    [note, inform, failWith, refresh],
  );
  const onListenRef = useRef(onListen);
  onListenRef.current = onListen;

  // Starting and stopping one after the other, in order: a stop still on its way mustn't end a later start.
  const listenQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!shouldListen) return;
    const queue = (step: () => Promise<unknown>) => {
      listenQueue.current = listenQueue.current.then(step, step);
    };
    queue(async () => {
      try {
        await startListening((event) => onListenRef.current(event));
        setListening(true);
      } catch (error) {
        note(`Couldn't start listening: ${errorText(error)}`);
      }
    });
    return () => {
      setListening(false);
      queue(() => stopListening().catch(() => {}));
    };
  }, [shouldListen, note]);

  // A device that syncs with this one gets the rounds as they are now.
  useEffect(() => {
    if (!listening) return;
    return onRoundsChanged(
      () =>
        void updateListeningRounds().catch((error) =>
          note(`Couldn't hand the new rounds to the listener: ${errorText(error)}`),
        ),
    );
  }, [listening, note]);

  const syncPeer = useCallback(
    async (peer: SyncPeer, auto: boolean, why = '') => {
      if (syncingRef.current) return;
      syncingRef.current = peer.key;
      setSyncing(peer.key);
      const step = auto ? (text: string) => note(`[auto] ${text}`) : note;
      if (auto) step(`${why}: syncing with ${peer.name}…`);
      else restart(`Syncing with ${peer.name}…`);
      try {
        const result = await syncWith(peer.key, step, auto);
        if (result == null) {
          inform(`${peer.name} had unpaired this device, so it's removed here too. Pair them again to sync.`);
        } else {
          step(`Saved ${result.added} new, skipped ${result.skipped} broken.`);
          if (!auto || result.added > 0 || result.skipped > 0) inform(syncedText(peer.name, result));
        }
        refresh();
      } catch (error) {
        const code = failureCode(error);
        if (auto && !AUTO_FAILURES_SHOWN.includes(code ?? '')) {
          step(`Didn't sync: ${errorText(error)}`);
          return;
        }
        failWith(
          code === 'notFound'
            ? `Couldn't find ${peer.name}. Open Mnemax on it, on the same Wi-Fi, and try again.`
            : error,
          false,
        );
        if (code === 'unknownThere') setForgetHere(peer);
      } finally {
        syncingRef.current = null;
        setSyncing(null);
      }
    },
    [note, restart, inform, failWith, refresh],
  );

  const syncWithPeer = useCallback((peer: SyncPeer) => syncPeer(peer, false), [syncPeer]);

  // Syncing by itself.
  const autoOn = shouldListen && prefs.autoSync && !playing;
  const autoOnRef = useRef(autoOn);
  autoOnRef.current = autoOn;
  const autoRunning = useRef(false);
  const autoSyncAll = useCallback(
    async (why: string) => {
      if (!autoOnRef.current || autoRunning.current) return;
      autoRunning.current = true;
      try {
        // The paired devices as they are now: one may have been paired or forgotten since.
        const { peers } = await syncStatus();
        for (const peer of peers) {
          if (!autoOnRef.current) break;
          await syncPeer(peer, true, why);
        }
      } catch (error) {
        note(`[auto] Couldn't sync: ${errorText(error)}`);
      } finally {
        autoRunning.current = false;
      }
    },
    [syncPeer, note],
  );
  useEffect(() => {
    if (!autoOn) return;
    const soon = setTimeout(() => void autoSyncAll('Mnemax is open'), AUTO_SYNC_DELAY_MS);
    const every = setInterval(() => void autoSyncAll('Syncing every few minutes'), AUTO_SYNC_MS);
    return () => {
      clearTimeout(soon);
      clearInterval(every);
    };
  }, [autoOn, autoSyncAll]);
  useEffect(
    () => onRoundPlayed(() => void setTimeout(() => void autoSyncAll('A round was played'), AUTO_SYNC_DELAY_MS)),
    [autoSyncAll],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      available,
      status,
      setStatus,
      usable,
      listening,
      refresh,
      notice,
      inform,
      failWith,
      forgetHere,
      offerForgetHere: setForgetHere,
      dismiss,
      log,
      note,
      restart,
      syncing,
      syncWithPeer,
    }),
    [
      available,
      status,
      usable,
      listening,
      refresh,
      notice,
      inform,
      failWith,
      forgetHere,
      dismiss,
      log,
      note,
      restart,
      syncing,
      syncWithPeer,
    ],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function syncedText(name: string, { added, skipped }: SyncResult): string {
  const got = added > 0 ? `${added} new round${added === 1 ? '' : 's'} here` : 'nothing new here';
  const broken = skipped > 0 ? ` Skipped ${skipped} broken round${skipped === 1 ? '' : 's'}.` : '';
  return `Synced with ${name}: ${got}.${broken}`;
}

export function errorText(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error) return error.message;
  // A failed sync command: see SyncFailure.
  if (typeof error === 'object' && error != null && 'message' in error) return String(error.message);
  return 'Something went wrong.';
}
