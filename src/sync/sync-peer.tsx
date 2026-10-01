import { useEffect, useRef, useState } from 'react';

import { DATE_LOCALE } from '@/config/stats';
import { FORGET_CONFIRM_MS } from '@/config/sync';
import { useSync } from '@/stores/sync-context';
import { forgetDevice, type SyncPeer } from '@/sync/sync';

/**
 * One paired device: its name, when it was paired and last synced, Sync (only on the device that connects) and
 * Forget, and under it how the latest sync with it went. `busy`: something else is going on, so no Sync now.
 */
export function PeerRow({ peer, busy, onReconnect }: { peer: SyncPeer; busy: boolean; onReconnect?: () => void }) {
  const { setStatus, inform, failWith, syncing, syncWithPeer, peerNote } = useSync();
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onForget = async () => {
    clearTimeout(timer.current);
    if (!confirming) {
      setConfirming(true);
      timer.current = setTimeout(() => setConfirming(false), FORGET_CONFIRM_MS);
      return;
    }
    setConfirming(false);
    try {
      setStatus(await forgetDevice(peer.key));
      inform(`Forgot ${peer.name} on this device. On ${peer.name}, tap Forget too.`);
    } catch (error) {
      failWith(error);
    }
  };

  const note = peerNote?.key === peer.key ? peerNote : null;
  return (
    <div className="sync-peer">
      <div className="row-between">
        <div>
          <div className="t-default">{peer.name}</div>
          <div className="t-small secondary">Paired {day(peer.pairedAt)}</div>
          <PeerState peer={peer} />
        </div>
        <div className="sync-peer-actions">
          {/* Only the device that connects can start a sync; the other one waits for it. */}
          {peer.address != null && (
            <button
              type="button"
              className="outline-button accent sync-small-button"
              disabled={busy}
              onClick={() => void syncWithPeer(peer)}
            >
              {syncing === peer.key ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <button
            type="button"
            className={confirming ? 'text-button t-small bad' : 'text-button t-small secondary'}
            disabled={syncing != null}
            onClick={onForget}
          >
            {confirming ? 'Tap again' : 'Forget'}
          </button>
        </div>
      </div>
      {note && (
        <p
          className={note.kind === 'error' ? 't-small sync-error' : 't-small secondary'}
          role={note.kind === 'error' ? 'alert' : 'status'}
        >
          {note.text}
        </p>
      )}
      {note?.reconnect && onReconnect && (
        <button type="button" className="text-button t-small sync-link" onClick={onReconnect}>
          Reconnect
        </button>
      )}
    </div>
  );
}

/** When it last synced. */
function PeerState({ peer }: { peer: SyncPeer }) {
  let text = peer.lastSyncAt == null ? 'Not synced yet' : `Last synced ${when(peer.lastSyncAt)}`;
  // The device that showed the code doesn't start syncs (it has no Sync button): the other one does.
  if (peer.address == null && peer.lastSyncAt == null) {
    text += '. It connects to this device by itself.';
  }
  return <div className="t-small secondary">{text}</div>;
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(DATE_LOCALE, { dateStyle: 'medium' });
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(DATE_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}
