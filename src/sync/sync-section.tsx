import { useEffect, useState, type SubmitEvent } from 'react';

import { Section } from '../components/ui/section';
import { syncCopy } from '@/copy/sync';
import { SyncLog } from './sync-log';
import { Pairing } from './sync-pairing';
import { PeerRow } from './sync-peer';
import { useSettingsStore } from '@/stores/settings';
import { isUsable, useSyncStore } from '@/stores/sync';
import { cancelPairing, renameDevice } from '@/sync/sync';

/**
 * Sync with your other devices on the same Wi-Fi: the paired devices, pairing a new one, and the switch for
 * syncing by itself. The syncing itself runs for the whole app (see src/sync/sync-auto.ts). Only in the app.
 */
export function SyncSection({ active }: { active: boolean }) {
  return useSyncStore((s) => s.available) ? <SyncPanel active={active} /> : null;
}

function SyncPanel({ active }: { active: boolean }) {
  const autoSync = useSettingsStore((s) => s.prefs.autoSync);
  const setAutoSync = useSettingsStore((s) => s.setAutoSync);
  const status = useSyncStore((s) => s.status);
  const setStatus = useSyncStore((s) => s.setStatus);
  const usable = useSyncStore(isUsable);
  const listening = useSyncStore((s) => s.listening);
  const refresh = useSyncStore((s) => s.refresh);
  const notice = useSyncStore((s) => s.notice);
  const failWith = useSyncStore((s) => s.failWith);
  const dismiss = useSyncStore((s) => s.dismiss);
  const log = useSyncStore((s) => s.log);
  const syncing = useSyncStore((s) => s.syncing);
  const [pairing, setPairing] = useState<{ how: 'show' | 'enter'; hint?: string } | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // Any pairing ends when the Sync section goes away.
  useEffect(() => () => void cancelPairing().catch(() => {}), []);
  useEffect(() => {
    if (!active) {
      setNameDraft(null);
    }
  }, [active]);

  const startPairing = (how: 'show' | 'enter', hint?: string) => {
    dismiss();
    setPairing({ how, hint });
  };

  const onRename = async (e: SubmitEvent) => {
    e.preventDefault();
    if (nameDraft == null) {
      return;
    }
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
    <Section title={syncCopy.section.title} info={syncCopy.section.info}>
      {usable && (
        <div className="panel panel-pad stack-10">
          {nameDraft == null ? (
            <div className="row-between">
              <div>
                <div className="t-small secondary">{syncCopy.section.thisDevice}</div>
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
                {syncCopy.section.renameLabel}
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
                <div className="t-small secondary">{syncCopy.section.pairedDevices}</div>
                {peers.map((peer) => (
                  <PeerRow
                    key={peer.key}
                    peer={peer}
                    busy={busy}
                    onReconnect={
                      pairing == null
                        ? () => startPairing('enter', syncCopy.pairing.stepShowCodeOn(peer.name))
                        : undefined
                    }
                  />
                ))}
              </>
            ) : (
              <p className="t-small secondary">{syncCopy.section.noPeers}</p>
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
            <span className="t-default">{syncCopy.section.autoSwitch}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
            />
          </label>
          {peers.length > 0 && <p className="t-small secondary">{reachText(listening, autoSync)}</p>}
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
              <strong>{syncCopy.section.errorLead}</strong> {notice.text}
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
  if (auto) {
    return syncCopy.section.reachAuto;
  }
  return listening ? syncCopy.section.reachListening : syncCopy.section.reachClosed;
}
