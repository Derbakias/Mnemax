// Sync with your other devices, for the whole app (not only the Settings screen): what the Sync section shows (the
// paired devices, the latest message, the log) and syncing with a device. When it listens and syncs by itself is
// worked out in src/sync/sync-auto.ts.

import { create } from 'zustand';

import {
  apiMismatch,
  failureCode,
  syncAvailable,
  syncStatus,
  syncWith,
  type SyncPeer,
  type SyncStatus,
} from '@/sync/sync';
import {
  AUTO_FAILURES_SHOWN,
  AUTO_PEER_FAILURES,
  MAX_LOG_LINES,
  RECONNECT_FAILURES,
  RESULT_SHOWN_MS,
} from '@/config/sync';
import { errorText, syncedText, type LogLine, type Notice, type PeerNote } from '@/sync/sync-messages';

/** What the screen is doing, which decides when sync may run. */
export interface SyncScreen {
  /** The Settings tab is showing: with Sync automatically off, the device listens only then. */
  settingsActive: boolean;
  /** A round is being played: no sync meanwhile, so it can't disturb the timing. */
  playing: boolean;
  /** The app is on screen (not in the background or minimised). */
  visible: boolean;
}

interface SyncState extends SyncScreen {
  /** In the app, where sync works (not a browser). */
  available: boolean;
  status: SyncStatus | null;
  setStatus: (status: SyncStatus) => void;
  /** Paired devices can connect to this one now. */
  listening: boolean;
  refresh: () => void;
  notice: Notice | null;
  inform: (text: string) => void;
  /** Shows the error, and notes it in the log unless `noteIt` is false (the Rust side notes its own). */
  failWith: (error: unknown, noteIt?: boolean) => void;
  /** Clears the message, and the one under a device. */
  dismiss: () => void;
  /** Every step of the latest pairing or sync, for the log. */
  log: { start: number; lines: LogLine[] };
  note: (text: string) => void;
  /**
   * Starts the log over: a new attempt. The message stays until the attempt brings its own, so nothing on the
   * page disappears and comes back (which made everything below it jump).
   */
  restart: (text: string) => void;
  /** The device being synced with. */
  syncing: string | null;
  /** How the latest sync with a device went, shown under that device. A good result goes away after a while. */
  peerNote: PeerNote | null;
  setPeerNote: (note: PeerNote | null) => void;
  /** Syncs with the device now, as asked (showing how it went, whatever happens). */
  syncWithPeer: (peer: SyncPeer) => Promise<void>;
  /** Syncs with the device: as asked, or by itself (`auto`, with `why` for the log). One sync at a time. */
  syncPeer: (peer: SyncPeer, auto: boolean, why?: string) => Promise<void>;
  setScreen: (screen: Partial<SyncScreen>) => void;
}

/** The status is loaded, and the Rust side matches this page. */
export const isUsable = (s: { status: SyncStatus | null }): boolean =>
  s.status != null && apiMismatch(s.status) == null;

// Clears a good result under a device after a while; a newer result replaces it.
let peerNoteTimer: ReturnType<typeof setTimeout> | undefined;

export const useSyncStore = create<SyncState>()((set, get) => ({
  available: syncAvailable(),
  status: null,
  listening: false,
  notice: null,
  log: { start: Date.now(), lines: [] },
  syncing: null,
  peerNote: null,
  settingsActive: false,
  playing: false,
  visible: true,
  setStatus: (status) => set({ status }),
  refresh: () => {
    if (!get().available) {
      return;
    }
    syncStatus().then(
      (next) => {
        set({ status: next });
        const mismatch = apiMismatch(next);
        if (mismatch) {
          get().failWith(mismatch);
        }
      },
      (error) => get().failWith(error),
    );
  },
  inform: (text) => set({ notice: { kind: 'info', text } }),
  failWith: (error, noteIt = true) => {
    const text = errorText(error);
    set({ notice: { kind: 'error', text } });
    if (noteIt) {
      get().note(`Failed: ${text}`);
    }
  },
  dismiss: () => {
    set({ notice: null });
    get().setPeerNote(null);
  },
  note: (text) =>
    set((s) => ({
      log: { ...s.log, lines: [...s.log.lines.slice(-(MAX_LOG_LINES - 1)), { at: Date.now(), text }] },
    })),
  restart: (text) => {
    const start = Date.now();
    set({ log: { start, lines: [{ at: start, text }] } });
  },
  setPeerNote: (peerNote) => {
    clearTimeout(peerNoteTimer);
    set({ peerNote });
    if (peerNote?.kind === 'info') {
      peerNoteTimer = setTimeout(() => set({ peerNote: null }), RESULT_SHOWN_MS);
    }
  },
  syncWithPeer: (peer) => get().syncPeer(peer, false),
  syncPeer: async (peer, auto, why = '') => {
    const { note, restart, failWith, setPeerNote, refresh } = get();
    if (get().syncing) {
      return;
    }
    set({ syncing: peer.key });
    const step = auto ? (text: string) => note(`[auto] ${text}`) : note;
    if (auto) {
      step(`${why}: syncing with ${peer.name}…`);
    } else {
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
      if (AUTO_FAILURES_SHOWN.includes(code)) {
        failWith(error, false);
      } else if (auto && !AUTO_PEER_FAILURES.includes(code)) {
        step(`Didn't sync: ${errorText(error)}`);
      } else {
        if (auto) {
          step(`Didn't sync: ${errorText(error)}`);
        }
        const reconnect = RECONNECT_FAILURES.includes(code);
        setPeerNote({ key: peer.key, kind: 'error', text: errorText(error), reconnect });
      }
    } finally {
      set({ syncing: null });
      // Whether it worked or not, the device's "last synced" or "can't reach it" changed.
      refresh();
    }
  },
  setScreen: (screen) => set(screen),
}));
