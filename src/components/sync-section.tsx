import { useEffect, useState, type SubmitEvent } from 'react';

import { Section } from './section';
import { SyncLog } from './sync-log';
import { Pairing } from './sync-pairing';
import { PeerRow } from './sync-peer';
import { useSettings } from '@/settings-context';
import { useSync } from '@/sync-context';
import { cancelPairing, renameDevice } from '@/sync';

/**
 * Sync with your other devices on the same Wi-Fi: the paired devices, pairing a new one, and the switch for
 * syncing by itself. The syncing itself runs for the whole app (see src/sync-context.tsx). Only in the app.
 */
export function SyncSection({ active }: { active: boolean }) {
  return useSync().available ? <SyncPanel active={active} /> : null;
}

function SyncPanel({ active }: { active: boolean }) {
  const { prefs, setAutoSync } = useSettings();
  const { status, setStatus, usable, listening, refresh, notice, failWith, dismiss, log, syncing } = useSync();
  const [pairing, setPairing] = useState<{ how: 'show' | 'enter'; hint?: string } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // Any pairing ends when the Sync section goes away.
  useEffect(() => () => void cancelPairing().catch(() => {}), []);
  useEffect(() => {
    if (!active) setNameDraft(null);
  }, [active]);

  const startPairing = (how: 'show' | 'enter', hint?: string) => {
    dismiss();
    setPairing({ how, hint });
  };

  const onRename = async (e: SubmitEvent) => {
    e.preventDefault();
    if (nameDraft == null) return;
    try {
      setStatus(await renameDevice(nameDraft));
      setNameDraft(null);
    } catch (error) {
      failWith(error);
    }
  };

  const peers = status?.peers ?? [];
  const busy = syncing != null || pairing != null;

  return (
    <Section
      title="Sync"
      info={
        <>
          <p>
            Swap rounds with your other devices on the same Wi-Fi: each gets the rounds the other is missing. Sync only
            adds rounds; it never changes or deletes them, and it never touches your settings.
          </p>
          <p>
            To connect two devices, tap <strong>Show a code</strong> on one (a computer is best, as it stays on) and{' '}
            <strong>Enter a code</strong> on the other, then scan the QR code or type the address and code. A code works
            once, for one minute.
          </p>
          <p>
            After that, the second device connects to the first by itself whenever Mnemax is open on both: when it
            opens, after each round, and every few minutes. On a phone, only while Mnemax is on the screen.
          </p>
          <p>
            If a device's address changes (after the router restarts, say), Sync can't reach it: tap{' '}
            <strong>Reconnect</strong> under the message and connect them again. Your rounds stay.
          </p>
          <p>
            <strong>Forget</strong> stops a device syncing with this one. Do it on both devices. Check this list now and
            then: a device you don't recognise has your rounds, so forget it.
          </p>
          <p>
            The first time, Windows asks whether Mnemax may use the network. Allow it on private networks only, not
            public ones, so nobody on a café or office Wi-Fi can reach it.
          </p>
        </>
      }
    >
      {usable && (
        <div className="panel panel-pad stack-10">
          {nameDraft == null ? (
            <div className="row-between">
              <div>
                <div className="t-small secondary">This device</div>
                <div className="t-default">{status?.name}</div>
              </div>
              <button
                type="button"
                className="text-button t-small secondary"
                onClick={() => setNameDraft(status?.name ?? '')}
              >
                Rename
              </button>
            </div>
          ) : (
            <form className="sync-form" onSubmit={onRename}>
              <label className="t-small secondary" htmlFor="sync-name">
                This device's name (paired devices see it after your next sync with them)
              </label>
              <div className="sync-form-row">
                <input
                  id="sync-name"
                  className="text-field"
                  value={nameDraft}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                />
                <button type="submit" className="outline-button accent sync-small-button">
                  Save
                </button>
              </div>
            </form>
          )}

          <div className="stack-8">
            {peers.length > 0 ? (
              <>
                <div className="t-small secondary">Paired devices</div>
                {peers.map((peer) => (
                  <PeerRow
                    key={peer.key}
                    peer={peer}
                    busy={busy}
                    onReconnect={
                      pairing == null
                        ? () => startPairing('enter', `On ${peer.name}, open Sync and tap Show a code.`)
                        : undefined
                    }
                  />
                ))}
              </>
            ) : (
              <p className="t-small secondary">No paired devices. Connect a device to sync with it.</p>
            )}
          </div>

          {pairing == null ? (
            <div className="data-row">
              <button
                type="button"
                className="outline-button accent"
                disabled={busy}
                onClick={() => startPairing('show')}
              >
                Show a code
              </button>
              <button
                type="button"
                className="outline-button accent"
                disabled={busy}
                onClick={() => startPairing('enter')}
              >
                Enter a code
              </button>
            </div>
          ) : (
            <Pairing how={pairing.how} hint={pairing.hint} active={active} onEnd={() => setPairing(null)} />
          )}

          <label className="row-between switch-row">
            <span className="t-default">Sync automatically</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={prefs.autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
            />
          </label>
          {peers.length > 0 && <p className="t-small secondary">{reachText(listening, prefs.autoSync)}</p>}
        </div>
      )}
      {!usable && status == null && notice?.kind === 'error' && (
        <button
          type="button"
          className="outline-button accent"
          onClick={() => {
            dismiss();
            refresh();
          }}
        >
          Try again
        </button>
      )}
      {notice && (
        <div className="sync-notice">
          {notice.kind === 'error' ? (
            <p className="t-small sync-error" role="alert">
              <strong>Error:</strong> {notice.text}
            </p>
          ) : (
            <p className="t-small secondary" role="status">
              {notice.text}
            </p>
          )}
          <button
            type="button"
            className="text-button secondary sync-dismiss"
            aria-label={notice.kind === 'error' ? 'Dismiss error' : 'Dismiss message'}
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Always there (not only after a first attempt), so it appearing can't push things down. */}
      {(usable || log.lines.length > 0) && <SyncLog start={log.start} lines={log.lines} deviceName={status?.name} />}
    </Section>
  );
}

/** Whether paired devices can sync with this one now. */
function reachText(listening: boolean, auto: boolean): string {
  if (auto) return 'Syncs by itself while Mnemax is open on both devices.';
  return listening ? 'Paired devices can sync with this one while Settings is open.' : 'Open Settings on both to sync.';
}
