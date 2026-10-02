// When sync runs by itself, for the whole app: waiting for paired devices to connect, and syncing by itself.
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
//
// It watches the sync store, the settings and whether the app is on screen, and starts or stops only when the
// answer to "listen?" or "sync by itself?" changes.

import { onRoundPlayed, onRoundsChanged } from '@/lib/storage';
import { AUTO_SYNC_DELAY_MS, AUTO_SYNC_MS } from '@/config/sync';
import { syncCopy } from '@/copy/sync';
import { useSettingsStore } from '@/stores/settings';
import { isUsable, useSyncStore } from '@/stores/sync';
import {
  isPhone,
  saveReceived,
  startListening,
  stopListening,
  syncStatus,
  updateListeningRounds,
  type ListenEvent,
  type SyncStatus,
} from '@/sync/sync';
import { errorText, syncedText } from '@/sync/sync-messages';

/** Everything that decides whether sync runs. */
export interface SyncInputs {
  available: boolean;
  status: SyncStatus | null;
  settingsReady: boolean;
  autoSync: boolean;
  phone: boolean;
  visible: boolean;
  playing: boolean;
  settingsActive: boolean;
}

/** Whether this device should wait for its devices to connect (`listen`) and sync with them by itself (`auto`). */
export function syncPlan(now: SyncInputs): { listen: boolean; auto: boolean } {
  const awake = !now.phone || now.visible;
  const ready = now.available && isUsable(now) && now.settingsReady && awake;
  // Devices that connect to this one, and devices this one connects to.
  const waitsFor = now.status?.peers.some((p) => p.address == null) ?? false;
  const connectsTo = now.status?.peers.some((p) => p.address != null) ?? false;
  return {
    listen: ready && waitsFor && !now.playing && (now.autoSync || now.settingsActive),
    auto: ready && connectsTo && now.autoSync && !now.playing,
  };
}

/** Starts watching, once, when the app starts (only in the app). Returns how to stop everything (for tests). */
export function startSyncDriver(): () => void {
  let listen = false;
  let auto = false;
  let stopListen: (() => void) | null = null;
  let stopAuto: (() => void) | null = null;

  const update = () => {
    const { available, status, visible, playing, settingsActive } = useSyncStore.getState();
    const { prefs, ready } = useSettingsStore.getState();
    const next = syncPlan({
      available,
      status,
      settingsReady: ready,
      autoSync: prefs.autoSync,
      phone: isPhone(),
      visible,
      playing,
      settingsActive,
    });
    // Remembered before starting or stopping anything: stopping changes the store, which calls this again, and
    // that call must find nothing left to do.
    const listenChanged = next.listen !== listen;
    const autoChanged = next.auto !== auto;
    listen = next.listen;
    auto = next.auto;
    if (listenChanged) {
      stopListen?.();
      stopListen = listen ? startListen() : null;
    }
    if (autoChanged) {
      stopAuto?.();
      stopAuto = auto ? startAuto() : null;
    }
  };

  /** Why to sync again once the sync going on now ends (a round finished meanwhile, say). */
  let again: string | null = null;
  let running = false;
  const syncAll = async (why: string) => {
    if (!auto) {
      return;
    }
    if (running) {
      again = why;
      return;
    }
    running = true;
    let reason: string | null = why;
    while (reason && auto) {
      try {
        // The paired devices as they are now: one may have been paired or forgotten since.
        const { peers } = await syncStatus();
        for (const peer of peers.filter((p) => p.address != null)) {
          if (!auto) {
            break;
          }
          await useSyncStore.getState().syncPeer(peer, true, reason);
        }
      } catch (error) {
        useSyncStore.getState().note(`[auto] Couldn't sync: ${errorText(error)}`);
      }
      reason = again;
      again = null;
    }
    running = false;
  };

  /** Syncs soon, then every few minutes; returns how to stop. */
  const startAuto = () => {
    const soon = setTimeout(() => void syncAll('Mnemax is open'), AUTO_SYNC_DELAY_MS);
    const every = setInterval(() => void syncAll('Syncing every few minutes'), AUTO_SYNC_MS);
    return () => {
      clearTimeout(soon);
      clearInterval(every);
    };
  };

  // After a round is played, a sync a moment later (it does nothing while syncing by itself is off).
  let later: ReturnType<typeof setTimeout> | undefined;
  const stopHearingRounds = onRoundPlayed(() => {
    clearTimeout(later);
    later = setTimeout(() => void syncAll('A round was played'), AUTO_SYNC_DELAY_MS);
  });

  const onVisibility = () => useSyncStore.getState().setScreen({ visible: document.visibilityState === 'visible' });
  onVisibility();
  document.addEventListener('visibilitychange', onVisibility);
  const stopWatchingSync = useSyncStore.subscribe(update);
  const stopWatchingSettings = useSettingsStore.subscribe(update);
  update();

  return () => {
    stopWatchingSync();
    stopWatchingSettings();
    document.removeEventListener('visibilitychange', onVisibility);
    stopHearingRounds();
    clearTimeout(later);
    listen = false;
    auto = false;
    stopListen?.();
    stopAuto?.();
  };
}

// Starting and stopping one after the other, in order: a stop still on its way mustn't end a later start.
let listenQueue: Promise<unknown> = Promise.resolve();
const queue = (step: () => Promise<unknown>) => {
  listenQueue = listenQueue.then(step, step);
};

// While listening: hands a device that syncs with this one the rounds as they are now.
let stopHearing: (() => void) | null = null;
function setListening(on: boolean) {
  useSyncStore.setState({ listening: on });
  stopHearing?.();
  stopHearing = null;
  if (on) {
    stopHearing = onRoundsChanged(
      () =>
        void updateListeningRounds().catch((error) =>
          useSyncStore.getState().note(`Couldn't hand the new rounds to the listener: ${errorText(error)}`),
        ),
    );
  }
}

/** Starts waiting for paired devices to connect; returns how to stop. */
function startListen(): () => void {
  // Turns false when stopped: a start that finishes after that must not say it's listening.
  let wanted = true;
  queue(async () => {
    if (!wanted) {
      return;
    }
    try {
      await startListening(onListen);
      if (wanted) {
        setListening(true);
      }
    } catch (error) {
      useSyncStore.getState().note(`Couldn't start listening: ${errorText(error)}`);
    }
  });
  return () => {
    wanted = false;
    setListening(false);
    queue(() => stopListening().catch(() => {}));
  };
}

function onListen(event: ListenEvent) {
  const { note, failWith, setPeerNote, refresh } = useSyncStore.getState();
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
      (error) => failWith(syncCopy.messages.saveFailed(event.peer.name, errorText(error))),
    );
    refresh();
  }
}
