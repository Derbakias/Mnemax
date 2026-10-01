// Syncing by itself: with each device this one connects to, when the app opens or comes back on screen, after a
// round is played, and every few minutes, while `on` (see src/sync-context.tsx for when that is).

import { useCallback, useEffect, useRef } from 'react';

import { onRoundPlayed } from '@/storage';
import { syncStatus, type SyncPeer } from '@/sync';
import { errorText } from '@/sync-messages';

// TODO: move to a config
/** How often the app syncs by itself while it's open. */
const AUTO_SYNC_MS = 3 * 60 * 1000;
/** After the app opens or a round is played, a short wait before syncing, so the app isn't slowed down. */
const AUTO_SYNC_DELAY_MS = 1500;

export function useAutoSync(
  on: boolean,
  syncPeer: (peer: SyncPeer, auto: boolean, why: string) => Promise<void>,
  note: (text: string) => void,
) {
  const onRef = useRef(on);
  onRef.current = on;
  const running = useRef(false);
  /** Why to sync again once the sync going on now ends (a round finished meanwhile, say). */
  const again = useRef<string | null>(null);
  const syncAll = useCallback(
    async (why: string) => {
      if (!onRef.current) {
        return;
      }
      if (running.current) {
        again.current = why;
        return;
      }
      running.current = true;
      let reason: string | null = why;
      while (reason && onRef.current) {
        try {
          // The paired devices as they are now: one may have been paired or forgotten since.
          const { peers } = await syncStatus();
          for (const peer of peers.filter((p) => p.address != null)) {
            if (!onRef.current) {
              break;
            }
            await syncPeer(peer, true, reason);
          }
        } catch (error) {
          note(`[auto] Couldn't sync: ${errorText(error)}`);
        }
        reason = again.current;
        again.current = null;
      }
      running.current = false;
    },
    [syncPeer, note],
  );
  useEffect(() => {
    if (!on) {
      return;
    }
    const soon = setTimeout(() => void syncAll('Mnemax is open'), AUTO_SYNC_DELAY_MS);
    const every = setInterval(() => void syncAll('Syncing every few minutes'), AUTO_SYNC_MS);
    return () => {
      clearTimeout(soon);
      clearInterval(every);
    };
  }, [on, syncAll]);
  useEffect(() => {
    let later: ReturnType<typeof setTimeout> | undefined;
    const stopHearing = onRoundPlayed(() => {
      clearTimeout(later);
      later = setTimeout(() => void syncAll('A round was played'), AUTO_SYNC_DELAY_MS);
    });
    return () => {
      stopHearing();
      clearTimeout(later);
    };
  }, [syncAll]);
}
