import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Section } from './section';
import { onRoundsChanged } from '@/storage';
import {
  answerPairing,
  cancelPairing,
  forgetDevice,
  joinPairing,
  renameDevice,
  saveReceived,
  startListening,
  startPairing,
  stopListening,
  syncAvailable,
  syncStatus,
  syncWith,
  updateListeningRounds,
  type ListenEvent,
  type PairEvent,
  type SyncPeer,
  type SyncResult,
  type SyncStatus,
} from '@/sync';

/** How long "Tap again to forget" waits for the second tap. */
const FORGET_CONFIRM_MS = 3000;

type Pairing =
  /** This device waits, showing the code (null until it has one). */
  | { step: 'showing'; code: string | null }
  | { step: 'entering' }
  /** Looking for the device showing the typed code. */
  | { step: 'finding' }
  /** Both devices show the other's name and the check number; `answered` once this person said yes. */
  | { step: 'check'; name: string; check: string; answered: boolean };

/**
 * Sync with the user's other devices on the same Wi-Fi. This device can only be reached while the section is
 * open, and it closes when the Settings tab is left. Only in the app: a browser can't do it.
 */
export function SyncSection({ active }: { active: boolean }) {
  return syncAvailable() ? <SyncPanel active={active} /> : null;
}

function SyncPanel({ active }: { active: boolean }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** The device being synced with. */
  const [syncing, setSyncing] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState('');
  const [forgetKey, setForgetKey] = useState<string | null>(null);
  const forgetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(() => {
    syncStatus().then(setStatus, (error) => setMessage(errorText(error)));
  }, []);
  useEffect(refresh, [refresh]);

  const close = useCallback(() => {
    setOpen(false);
    setPairing(null);
    setNameDraft(null);
    void stopListening().catch(() => {});
    void cancelPairing().catch(() => {});
  }, []);

  // Leaving the Settings tab (or the screen going away) stops listening and any pairing.
  useEffect(() => {
    if (!active) close();
  }, [active, close]);
  useEffect(() => () => clearTimeout(forgetTimer.current), []);
  useEffect(
    () => () => {
      void stopListening().catch(() => {});
      void cancelPairing().catch(() => {});
    },
    [],
  );

  // While open, a device that syncs with this one gets the rounds as they are now.
  useEffect(() => {
    if (!open) return;
    return onRoundsChanged(() => void updateListeningRounds().catch(() => {}));
  }, [open]);

  const onListen = useCallback(
    (event: ListenEvent) => {
      if (event.kind === 'synced') {
        saveReceived(event.rounds).then(
          (result) => setMessage(syncedText(event.peer.name, result)),
          (error) => setMessage(errorText(error)),
        );
        refresh();
      } else if (event.kind === 'failed') {
        setMessage(event.message);
      } else {
        setOpen(false);
        setPairing(null);
        setMessage('Sync closed after 10 minutes. Open it again to keep syncing.');
      }
    },
    [refresh],
  );

  const onPair = useCallback(
    (event: PairEvent) => {
      if (event.kind === 'check') {
        setPairing({ step: 'check', name: event.name, check: event.check, answered: false });
      } else if (event.kind === 'paired') {
        setPairing(null);
        setMessage(`Paired with ${event.peer.name}. Tap Sync to swap rounds.`);
        refresh();
      } else {
        setPairing(null);
        setMessage(event.message);
      }
    },
    [refresh],
  );

  const onOpen = async () => {
    setMessage(null);
    try {
      await startListening(onListen);
      setOpen(true);
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  const onShowCode = async () => {
    setMessage(null);
    setPairing({ step: 'showing', code: null });
    try {
      const code = await startPairing(onPair);
      setPairing((p) => (p?.step === 'showing' ? { step: 'showing', code } : p));
    } catch (error) {
      setPairing(null);
      setMessage(errorText(error));
    }
  };

  const onEnterCode = () => {
    setMessage(null);
    setCodeDraft('');
    setPairing({ step: 'entering' });
  };

  const onSubmitCode = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setPairing({ step: 'finding' });
    try {
      await joinPairing(codeDraft, onPair);
    } catch (error) {
      setPairing({ step: 'entering' });
      setMessage(errorText(error));
    }
  };

  const onAnswer = (accept: boolean) => {
    void answerPairing(accept).catch(() => {});
    // A no ends the pairing on both devices; the message comes with the event that follows.
    setPairing((p) => (p?.step === 'check' && accept ? { ...p, answered: true } : p));
  };

  const onCancelPairing = () => {
    void cancelPairing().catch(() => {});
    setPairing(null);
  };

  const onSync = async (peer: SyncPeer) => {
    setMessage(null);
    setSyncing(peer.key);
    try {
      setMessage(syncedText(peer.name, await syncWith(peer.key)));
      refresh();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSyncing(null);
    }
  };

  const onForget = async (peer: SyncPeer) => {
    clearTimeout(forgetTimer.current);
    if (forgetKey !== peer.key) {
      setForgetKey(peer.key);
      forgetTimer.current = setTimeout(() => setForgetKey(null), FORGET_CONFIRM_MS);
      return;
    }
    setForgetKey(null);
    try {
      setStatus(await forgetDevice(peer.key));
      setMessage(`Forgot ${peer.name}. It can't sync with this device until they're paired again.`);
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    if (nameDraft == null) return;
    try {
      setStatus(await renameDevice(nameDraft));
      setNameDraft(null);
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  return (
    <Section
      title="Sync"
      info={
        <>
          <p>
            Swap rounds with your other devices on the same Wi-Fi: each gets the rounds the other is missing. Sync only
            adds rounds; it never changes or deletes them.
          </p>
          <p>
            A device only syncs with the devices it was paired with. To pair two, tap <strong>Show a code</strong> on
            one and <strong>Enter a code</strong> on the other, then check both show the same number.
          </p>
          <p>A device can only be reached while its Sync section is open, on the Settings tab.</p>
        </>
      }>
      {!open ? (
        <div className="data-row">
          <button type="button" className="outline-button accent" disabled={status == null} onClick={onOpen}>
            Open sync
          </button>
        </div>
      ) : (
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
                onClick={() => setNameDraft(status?.name ?? '')}>
                Rename
              </button>
            </div>
          ) : (
            <form className="sync-form" onSubmit={onRename}>
              <label className="t-small secondary" htmlFor="sync-name">
                This device's name
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
            <div className="t-small secondary">Paired devices</div>
            {status?.peers.length ? (
              status.peers.map((peer) => (
                <div key={peer.key} className="row-between">
                  <div>
                    <div className="t-default">{peer.name}</div>
                    <div className="t-small secondary">{lastSyncText(peer)}</div>
                  </div>
                  <div className="sync-peer-actions">
                    <button
                      type="button"
                      className="outline-button accent sync-small-button"
                      disabled={syncing != null || pairing != null}
                      onClick={() => onSync(peer)}>
                      {syncing === peer.key ? 'Syncing…' : 'Sync'}
                    </button>
                    <button
                      type="button"
                      className={forgetKey === peer.key ? 'text-button t-small bad' : 'text-button t-small secondary'}
                      disabled={syncing != null}
                      onClick={() => onForget(peer)}>
                      {forgetKey === peer.key ? 'Tap again' : 'Forget'}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="t-small secondary">None yet. Pair a device to sync with it.</p>
            )}
          </div>

          {pairing == null && (
            <div className="data-row">
              <button type="button" className="outline-button accent" disabled={syncing != null} onClick={onShowCode}>
                Show a code
              </button>
              <button type="button" className="outline-button accent" disabled={syncing != null} onClick={onEnterCode}>
                Enter a code
              </button>
            </div>
          )}
          {pairing != null && (
            <PairingStep
              pairing={pairing}
              codeDraft={codeDraft}
              onCodeChange={setCodeDraft}
              onSubmitCode={onSubmitCode}
              onAnswer={onAnswer}
              onCancel={onCancelPairing}
            />
          )}

          <button type="button" className="text-button t-small secondary sync-close" onClick={close}>
            Close sync
          </button>
        </div>
      )}
      {message && (
        <p className="t-small secondary" role="status">
          {message}
        </p>
      )}
    </Section>
  );
}

function PairingStep({
  pairing,
  codeDraft,
  onCodeChange,
  onSubmitCode,
  onAnswer,
  onCancel,
}: {
  pairing: Pairing;
  codeDraft: string;
  onCodeChange: (code: string) => void;
  onSubmitCode: (e: FormEvent) => void;
  onAnswer: (accept: boolean) => void;
  onCancel: () => void;
}) {
  const cancel = (
    <button type="button" className="text-button t-small secondary" onClick={onCancel}>
      Cancel
    </button>
  );

  switch (pairing.step) {
    case 'showing':
      return (
        <div className="card sync-pairing">
          <p className="t-small secondary">On your other device, open Sync, tap Enter a code and type:</p>
          <p className="sync-code" aria-live="polite">
            {pairing.code ?? '…'}
          </p>
          <p className="t-small secondary">The code works once, for 2 minutes.</p>
          {cancel}
        </div>
      );
    case 'entering':
      return (
        <form className="card sync-pairing" onSubmit={onSubmitCode}>
          <label className="t-small secondary" htmlFor="sync-code">
            The code on your other device (open Sync there and tap Show a code)
          </label>
          <div className="sync-form-row">
            <input
              id="sync-code"
              className="text-field sync-code-field"
              value={codeDraft}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="00-000-000"
              autoFocus
              onChange={(e) => onCodeChange(e.target.value)}
            />
            <button
              type="submit"
              className="outline-button accent sync-small-button"
              disabled={codeDraft.replace(/\D/g, '').length !== 8}>
              Pair
            </button>
          </div>
          {cancel}
        </form>
      );
    case 'finding':
      return (
        <div className="card sync-pairing">
          <p className="t-small secondary">Looking for the other device…</p>
          {cancel}
        </div>
      );
    case 'check':
      return (
        <div className="card sync-pairing">
          <p className="t-default">Pair with {pairing.name}?</p>
          <p className="t-small secondary">Only if both screens show this number:</p>
          <p className="sync-code">{pairing.check}</p>
          {pairing.answered ? (
            <p className="t-small secondary">Waiting for the other device…</p>
          ) : (
            <div className="data-row">
              <button type="button" className="outline-button accent" onClick={() => onAnswer(true)}>
                Pair
              </button>
              <button type="button" className="outline-button danger" onClick={() => onAnswer(false)}>
                Don't pair
              </button>
            </div>
          )}
        </div>
      );
  }
}

function syncedText(name: string, { added, skipped }: SyncResult): string {
  const got = added > 0 ? `${added} new round${added === 1 ? '' : 's'} here` : 'nothing new here';
  const broken = skipped > 0 ? ` Skipped ${skipped} broken round${skipped === 1 ? '' : 's'}.` : '';
  return `Synced with ${name}: ${got}.${broken}`;
}

function lastSyncText(peer: SyncPeer): string {
  if (peer.lastSyncAt == null) return 'Not synced yet';
  const when = new Date(peer.lastSyncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `Last synced ${when}`;
}

function errorText(error: unknown): string {
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
