// Sync with your other devices, for the whole app (not only the Settings screen): waiting for devices to
// connect, syncing by itself, and what the Sync section shows (the paired devices, the latest message, the log).
//
// Each pair of devices has one that waits (it showed the code) and one that connects (it scanned or typed it).
//
// This device waits for connections only:
// - in the app (a browser can't), and if a paired device connects to this one;
// - on a phone, only while the app is on screen (phones put apps to sleep in the background anyway);
// - with Sync automatically on, whenever the app is open; with it off, only while the Settings tab is open;
// - never while a round is being played, so saving rounds from another device can't disturb its timing.
//
// It connects to its devices by itself (Sync automatically on) when the app opens or comes back on screen,
// after a round is played, and every few minutes. Never while a round is being played. A sync that brings
// nothing new says nothing; everything goes in the log.

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
import { useAutoSync } from '@/sync-auto';
import { onRoundsChanged } from '@/storage';
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
  type SyncStatus,
} from '@/sync';
import { errorText, syncedText, useSyncMessages, type LogLine, type Notice, type PeerNote } from '@/sync-messages';

/** Failures an automatic sync shows. The rest (like the other device not being open) only go in the log. */
const AUTO_FAILURES_SHOWN = ['storage', 'keyStore'];
/** Failures where pairing again may help: its address changed, or it forgot this device. */
const RECONNECT_FAILURES = ['unreachable', 'refused'];
/**
 * Failures an automatic sync shows under the device: trying again won't help, the person has to do something (pair
 * again, or update the app). Other ones, like the device not being open, only go in the log.
 */
const AUTO_PEER_FAILURES = ['refused'];
/** How long a sync result stays under its device. An error stays until the next try. */
const RESULT_SHOWN_MS = 30_000;

interface SyncContextValue {
  /** In the app, where sync works (not a browser). */
  available: boolean;
  status: SyncStatus | null;
  setStatus: (status: SyncStatus) => void;
  /** The status is loaded, and the Rust side matches this page. */
  usable: boolean;
  /** Paired devices can connect to this one now. */
  listening: boolean;
  refresh: () => void;
  notice: Notice | null;
  inform: (text: string) => void;
  /** Shows the error, and notes it in the log unless `noteIt` is false (the Rust side notes its own). */
  failWith: (error: unknown, noteIt?: boolean) => void;
  dismiss: () => void;
  /** Every step of the latest pairing or sync, for the log. */
  log: { start: number; lines: LogLine[] };
  note: (text: string) => void;
  /** Starts the log over (and clears the message): a new attempt. */
  restart: (text: string) => void;
  /** The device being synced with. */
  syncing: string | null;
  /** How the latest sync with a device went, shown under that device. */
  peerNote: PeerNote | null;
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
  const { notice, log, note, restart, inform, failWith, dismiss } = useSyncMessages();
  const [listening, setListening] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [peerNote, setPeerNote] = useState<PeerNote | null>(null);
  const forget = useCallback(() => {
    dismiss();
    setPeerNote(null);
  }, [dismiss]);
  const syncingRef = useRef<string | null>(null);
  useEffect(() => {
    if (peerNote?.kind !== 'info') return;
    const timer = setTimeout(() => setPeerNote(null), RESULT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [peerNote]);

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
  // Devices that connect to this one, and devices this one connects to.
  const waitsFor = status?.peers.some((p) => p.address == null) ?? false;
  const connectsTo = status?.peers.some((p) => p.address != null) ?? false;
  const visible = usePageVisible();
  const awake = !isPhone() || visible;
  const ready = available && usable && prefsReady && awake;
  const shouldListen = ready && waitsFor && !playing && (prefs.autoSync || settingsActive);

  const onListen = useCallback(
    (event: ListenEvent) => {
      if (event.kind === 'step') {
        note(`[listening] ${event.text}`);
      } else if (event.kind === 'synced') {
        saveReceived(event.rounds).then(
          (result) => {
            note(`[listening] Saved ${result.added} new, skipped ${result.skipped} broken.`);
            // Broken rounds come again with every sync, so they alone aren't worth a message each time.
            if (result.added > 0) {
              setPeerNote({ key: event.peer.key, kind: 'info', text: syncedText(result) });
            }
          },
          (error) => failWith(`Couldn't save the rounds from ${event.peer.name}: ${errorText(error)}`),
        );
        refresh();
      }
    },
    [note, failWith, refresh],
  );
  const onListenRef = useRef(onListen);
  onListenRef.current = onListen;

  // Starting and stopping one after the other, in order: a stop still on its way mustn't end a later start.
  const listenQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!shouldListen) return;
    // Turns false when this effect ends: a start that finishes after that must not say it's listening.
    let wanted = true;
    const queue = (step: () => Promise<unknown>) => {
      listenQueue.current = listenQueue.current.then(step, step);
    };
    queue(async () => {
      if (!wanted) return;
      try {
        await startListening((event) => onListenRef.current(event));
        if (wanted) setListening(true);
      } catch (error) {
        note(`Couldn't start listening: ${errorText(error)}`);
      }
    });
    return () => {
      wanted = false;
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
      else {
        // Tapping Sync again clears the last result, so the one showing is always from this sync.
        setPeerNote(null);
        restart(`Syncing with ${peer.name}…`);
      }
      try {
        const result = await syncWith(peer.key, step);
        step(`Saved ${result.added} new, skipped ${result.skipped} broken.`);
        // Broken rounds come again with every sync, so an automatic one doesn't mention them each time.
        if (!auto || result.added > 0) {
          setPeerNote({ key: peer.key, kind: 'info', text: syncedText(result) });
        }
      } catch (error) {
        const code = failureCode(error) ?? '';
        // A problem with this device itself (its key store, its storage) shows for the whole section.
        if (AUTO_FAILURES_SHOWN.includes(code)) failWith(error, false);
        else if (auto && !AUTO_PEER_FAILURES.includes(code)) step(`Didn't sync: ${errorText(error)}`);
        else {
          if (auto) step(`Didn't sync: ${errorText(error)}`);
          const reconnect = RECONNECT_FAILURES.includes(code);
          setPeerNote({ key: peer.key, kind: 'error', text: errorText(error), reconnect });
        }
      } finally {
        syncingRef.current = null;
        setSyncing(null);
        // Whether it worked or not, the device's "last synced" or "can't reach it" changed.
        refresh();
      }
    },
    [note, restart, failWith, refresh],
  );

  const syncWithPeer = useCallback((peer: SyncPeer) => syncPeer(peer, false), [syncPeer]);

  // Syncing by itself.
  useAutoSync(ready && connectsTo && prefs.autoSync && !playing, syncPeer, note);

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
      dismiss: forget,
      log,
      note,
      restart,
      syncing,
      peerNote,
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
      forget,
      log,
      note,
      restart,
      syncing,
      peerNote,
      syncWithPeer,
    ],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
