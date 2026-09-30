import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Section } from './section';
import { useSettings } from '@/settings-context';
import { errorText, useSync, type LogLine } from '@/sync-context';
import {
  answerPairing,
  canScan,
  cancelPairing,
  cancelScan,
  codeFromQr,
  forgetDevice,
  forgetDeviceHere,
  joinPairing,
  renameDevice,
  scanQr,
  startPairing,
  type PairEvent,
  type Qr,
  type ShownCode,
  type SyncPeer,
} from '@/sync';

/** How long "Tap again to forget" waits for the second tap. */
const FORGET_CONFIRM_MS = 3000;

type Pairing =
  /** This device waits, showing the code (null until it has one) until `expiresAt`. */
  | { step: 'showing'; shown: ShownCode | null; expiresAt: number; expired: boolean }
  | { step: 'entering' }
  /** The camera is open (phones), looking for the other device's QR code. */
  | { step: 'scanning' }
  /** Looking for the device showing the code. */
  | { step: 'finding' }
  /** Both devices show the other's name and the check number; `answered` once this person said yes. */
  | { step: 'check'; name: string; check: string; answered: boolean };

/**
 * Sync with the user's other devices on the same Wi-Fi: the paired devices, pairing a new one, and the
 * automatic sync switch. The syncing itself runs app-wide (see src/sync-context.tsx). Only in the app: a browser
 * can't do it.
 */
export function SyncSection({ active }: { active: boolean }) {
  return useSync().available ? <SyncPanel active={active} /> : null;
}

function SyncPanel({ active }: { active: boolean }) {
  const { prefs, setAutoSync } = useSettings();
  const {
    status,
    setStatus,
    usable,
    listening,
    refresh,
    notice,
    inform,
    failWith,
    forgetHere,
    offerForgetHere,
    dismiss,
    log,
    note,
    restart,
    syncing,
    syncWithPeer,
  } = useSync();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  /** The device being forgotten. */
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState('');
  const [forgetKey, setForgetKey] = useState<string | null>(null);
  const forgetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scanning = pairing?.step === 'scanning';
  const scanningRef = useRef(false);
  scanningRef.current = scanning;

  // Leaving the Settings tab (or the screen going away) ends any pairing.
  const endPairing = useCallback(() => {
    if (scanningRef.current) void cancelScan().catch(() => {});
    setPairing(null);
    setNameDraft(null);
    void cancelPairing().catch(() => {});
  }, []);
  useEffect(() => {
    if (!active) endPairing();
  }, [active, endPairing]);
  useEffect(() => endPairing, [endPairing]);
  useEffect(() => () => clearTimeout(forgetTimer.current), []);

  const onPair = useCallback(
    (event: PairEvent) => {
      if (event.kind === 'step') {
        note(event.text);
      } else if (event.kind === 'check') {
        setPairing({ step: 'check', name: event.name, check: event.check, answered: false });
      } else if (event.kind === 'paired') {
        setPairing(null);
        inform(`Paired with ${event.peer.name}. Tap Sync to swap rounds.`);
        refresh();
      } else if (event.kind === 'expired') {
        setPairing((p) => (p?.step === 'showing' ? { ...p, expired: true } : p));
      } else {
        setPairing(null);
        failWith(event.message, false);
      }
    },
    [refresh, note, inform, failWith],
  );

  const onShowCode = async () => {
    restart('Making a pairing code…');
    setPairing({ step: 'showing', shown: null, expiresAt: 0, expired: false });
    try {
      const shown = await startPairing(onPair);
      const expiresAt = Date.now() + shown.seconds * 1000;
      setPairing((p) => (p?.step === 'showing' ? { step: 'showing', shown, expiresAt, expired: false } : p));
    } catch (error) {
      setPairing(null);
      failWith(error);
    }
  };

  const onEnterCode = () => {
    dismiss();
    setCodeDraft('');
    setPairing({ step: 'entering' });
  };

  const join = async (code: string, how: string) => {
    restart(`Pairing with the code ${how}…`);
    setPairing({ step: 'finding' });
    try {
      await joinPairing(code, onPair);
    } catch (error) {
      setPairing({ step: 'entering' });
      failWith(error);
    }
  };

  const onSubmitCode = (e: FormEvent) => {
    e.preventDefault();
    void join(codeDraft, 'typed in');
  };

  const onScan = async () => {
    restart('Opening the camera…');
    setPairing({ step: 'scanning' });
    try {
      const text = await scanQr();
      if (text == null) {
        note('Scan cancelled.');
        setPairing((p) => (p?.step === 'scanning' ? { step: 'entering' } : p));
        return;
      }
      const code = codeFromQr(text);
      if (code == null) {
        setPairing({ step: 'entering' });
        note(`Scanned a QR code that isn't a Mnemax pairing code (${text.length} characters).`);
        failWith("That QR code isn't a Mnemax pairing code. Scan the one your other device shows under Show a code.");
        return;
      }
      await join(code, 'from the QR code');
    } catch (error) {
      setPairing({ step: 'entering' });
      failWith(`Couldn't scan: ${errorText(error)}`);
    }
  };

  const onAnswer = (accept: boolean) => {
    void answerPairing(accept).catch(() => {});
    // A no ends the pairing on both devices; the message comes with the event that follows.
    setPairing((p) => (p?.step === 'check' && accept ? { ...p, answered: true } : p));
  };

  const onCancelPairing = () => {
    note('Cancelled on this device.');
    void cancelPairing().catch(() => {});
    setPairing(null);
  };

  const onForget = async (peer: SyncPeer) => {
    clearTimeout(forgetTimer.current);
    if (forgetKey !== peer.key) {
      setForgetKey(peer.key);
      forgetTimer.current = setTimeout(() => setForgetKey(null), FORGET_CONFIRM_MS);
      return;
    }
    setForgetKey(null);
    restart(`Forgetting ${peer.name}…`);
    inform(`Removing this device from ${peer.name} first…`);
    setForgetting(peer.key);
    try {
      const forgot = await forgetDevice(peer.key, note);
      inform(
        forgot === 'both'
          ? `Forgot ${peer.name} on both devices.`
          : `${peer.name} no longer had this device as paired. Forgot it here too.`,
      );
      refresh();
    } catch (error) {
      failWith(
        `${errorText(error)} ${peer.name} is still paired on both devices: open Sync on it and tap Forget again.`,
        false,
      );
      offerForgetHere(peer);
    } finally {
      setForgetting(null);
    }
  };

  const onForgetHere = async (peer: SyncPeer) => {
    offerForgetHere(null);
    try {
      setStatus(await forgetDeviceHere(peer.key));
      note(`Forgot ${peer.name} on this device only.`);
      inform(
        `Forgot ${peer.name} on this device only. If ${peer.name} still lists this device, it will remove it ` +
          'the next time it tries to sync with this one.',
      );
    } catch (error) {
      failWith(error);
    }
  };

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    if (nameDraft == null) return;
    try {
      setStatus(await renameDevice(nameDraft));
      setNameDraft(null);
    } catch (error) {
      failWith(error);
    }
  };

  const reach = reachText(listening, prefs.autoSync, (status?.peers.length ?? 0) > 0);

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
            one and <strong>Enter a code</strong> on the other (a phone can scan the QR code), then check both show the
            same number. A code works once, for 30 seconds.
          </p>
          <p>
            With <strong>Sync automatically</strong> on, paired devices sync by themselves whenever Mnemax is open on
            both: when it opens, after each round, and every few minutes. On a phone, only while Mnemax is on the
            screen. With it off, a device can only be reached while its Settings tab is open, and you tap{' '}
            <strong>Sync</strong>.
          </p>
          <p>
            Other devices on the network can only see Mnemax while a code is shown or entered. Paired devices find
            each other under names only they can work out, so on a shared Wi-Fi no one else can tell Mnemax is there.
          </p>
          <p>
            <strong>Forget</strong> unpairs a device on both sides: the other device removes this one first, so open
            Mnemax on it before you tap Forget. A device that's lost can be forgotten on this side only.
          </p>
        </>
      }>
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
                onClick={() => setNameDraft(status?.name ?? '')}>
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
            {status?.peers.length ? (
              <>
                <div className="t-small secondary">Paired devices</div>
                {status.peers.map((peer) => (
                  <div key={peer.key} className="row-between">
                    <div>
                      <div className="t-default">{peer.name}</div>
                      <div className="t-small secondary">{lastSyncText(peer)}</div>
                    </div>
                    <div className="sync-peer-actions">
                      <button
                        type="button"
                        className="outline-button accent sync-small-button"
                        disabled={syncing != null || pairing != null || forgetting != null}
                        onClick={() => void syncWithPeer(peer)}>
                        {syncing === peer.key ? 'Syncing…' : 'Sync'}
                      </button>
                      <button
                        type="button"
                        className={forgetKey === peer.key ? 'text-button t-small bad' : 'text-button t-small secondary'}
                        disabled={syncing != null || forgetting != null}
                        onClick={() => onForget(peer)}>
                        {forgetting === peer.key ? 'Forgetting…' : forgetKey === peer.key ? 'Tap again' : 'Forget'}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="t-small secondary">No paired devices. Pair a device to sync with it.</p>
            )}
          </div>

          {pairing == null ? (
            <div className="data-row">
              <button type="button" className="outline-button accent" disabled={syncing != null} onClick={onShowCode}>
                Show a code
              </button>
              <button type="button" className="outline-button accent" disabled={syncing != null} onClick={onEnterCode}>
                Enter a code
              </button>
            </div>
          ) : (
            <PairingStep
              pairing={pairing}
              codeDraft={codeDraft}
              onCodeChange={setCodeDraft}
              onSubmitCode={onSubmitCode}
              onScan={onScan}
              onNewCode={onShowCode}
              onAnswer={onAnswer}
              onCancel={onCancelPairing}
            />
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
          {reach && <p className="t-small secondary">{reach}</p>}
        </div>
      )}
      {!usable && status == null && notice?.kind === 'error' && (
        <button
          type="button"
          className="outline-button accent"
          onClick={() => {
            dismiss();
            refresh();
          }}>
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
          {forgetHere && (
            <div className="sync-forget-here">
              <button
                type="button"
                className="outline-button danger sync-small-button"
                onClick={() => onForgetHere(forgetHere)}>
                Forget {forgetHere.name} only here
              </button>
            </div>
          )}
          <button
            type="button"
            className="text-button secondary sync-dismiss"
            aria-label={notice.kind === 'error' ? 'Dismiss error' : 'Dismiss message'}
            onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {log.lines.length > 1 && <SyncLog start={log.start} lines={log.lines} deviceName={status?.name} />}
      {scanning && <ScanOverlay onCancel={() => void cancelScan().catch(() => {})} />}
    </Section>
  );
}

function PairingStep({
  pairing,
  codeDraft,
  onCodeChange,
  onSubmitCode,
  onScan,
  onNewCode,
  onAnswer,
  onCancel,
}: {
  pairing: Pairing;
  codeDraft: string;
  onCodeChange: (code: string) => void;
  onSubmitCode: (e: FormEvent) => void;
  onScan: () => void;
  onNewCode: () => void;
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
      return <ShowCode pairing={pairing} onNewCode={onNewCode} cancel={cancel} />;
    case 'entering':
    case 'scanning':
      return (
        <form className="card sync-pairing" onSubmit={onSubmitCode}>
          <p className="t-small secondary">On your other device, open Sync and tap Show a code.</p>
          {canScan() && (
            <>
              <button type="button" className="outline-button accent" onClick={onScan}>
                Scan QR code
              </button>
              <p className="t-small secondary sync-or">or type the code</p>
            </>
          )}
          <label className="visually-hidden" htmlFor="sync-code">
            The 6-digit code
          </label>
          <div className="sync-form-row">
            <input
              id="sync-code"
              className="text-field sync-code-field"
              value={codeDraft}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              autoFocus={!canScan()}
              onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="submit" className="outline-button accent sync-small-button" disabled={codeDraft.length !== 6}>
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

/** The code and its QR code, with the seconds it has left; once it has run out, a way to get a new one. */
function ShowCode({
  pairing,
  onNewCode,
  cancel,
}: {
  pairing: Extract<Pairing, { step: 'showing' }>;
  onNewCode: () => void;
  cancel: ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000));
  const expired = pairing.expired || (pairing.shown != null && left === 0);

  if (expired) {
    return (
      <div className="card sync-pairing">
        <p className="t-default">The code ran out.</p>
        <p className="t-small secondary">A code works for 30 seconds, so no one else has time to guess it.</p>
        <button type="button" className="outline-button accent" onClick={onNewCode}>
          New code
        </button>
        {cancel}
      </div>
    );
  }
  return (
    <div className="card sync-pairing">
      <p className="t-small secondary">
        On your other device, open Sync, tap Enter a code, and scan this or type the code.
      </p>
      {pairing.shown && <QrCode qr={pairing.shown.qr} label={`QR code for the pairing code ${pairing.shown.code}`} />}
      <p className="sync-code" aria-live="polite">
        {pairing.shown?.code ?? '…'}
      </p>
      <p className="t-small secondary sync-countdown">
        {pairing.shown ? `Works once, for ${left} more second${left === 1 ? '' : 's'}.` : ''}
      </p>
      {cancel}
    </div>
  );
}

/** Dark modules on a white square with the 4-module quiet zone scanners need, in light and dark mode alike. */
function QrCode({ qr, label }: { qr: Qr; label: string }) {
  const quiet = 4;
  const side = qr.size + quiet * 2;
  let path = '';
  for (let i = 0; i < qr.modules.length; i++) {
    if (qr.modules[i] === '1') path += `M${(i % qr.size) + quiet} ${Math.floor(i / qr.size) + quiet}h1v1h-1z`;
  }
  return (
    <svg className="sync-qr" viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/**
 * While the camera looks for the QR code: the camera shows behind the page, so the page clears its
 * background and shows only a frame to aim with and a way out.
 */
function ScanOverlay({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    document.documentElement.classList.add('scanning');
    return () => document.documentElement.classList.remove('scanning');
  }, []);
  return createPortal(
    <div className="scan-overlay">
      <p className="scan-hint">Point the camera at the QR code on your other device</p>
      <div className="scan-frame" aria-hidden />
      <button type="button" className="outline-button scan-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>,
    document.body,
  );
}

/** The steps of the latest attempt, hidden until asked for, with a way to copy them. */
function SyncLog({ start, lines, deviceName }: { start: number; lines: LogLine[]; deviceName?: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = () =>
    [
      `Mnemax v${__APP_VERSION__} sync log from ${deviceName ?? 'this device'}, ${new Date(start).toISOString()}`,
      `(${navigator.userAgent})`,
      ...lines.map((l) => `${elapsed(l.at - start)}  ${l.text}`),
    ].join('\n');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="sync-log">
      <div className="row-between">
        <button type="button" className="text-button t-small secondary" onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide sync logs' : `Sync logs (${lines.length})`}
        </button>
        {shown && (
          <button type="button" className="text-button t-small secondary" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {shown && (
        <ol className="sync-log-lines">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="sync-log-time">{elapsed(l.at - start)}</span> {l.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** `+1.25 s` */
function elapsed(ms: number): string {
  return `+${(ms / 1000).toFixed(2)} s`;
}

function lastSyncText(peer: SyncPeer): string {
  if (peer.lastSyncAt == null) return 'Not synced yet';
  const when = new Date(peer.lastSyncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `Last synced ${when}`;
}

/** Whether paired devices can reach this one now, and when they can; nothing with no device paired. */
function reachText(listening: boolean, auto: boolean, paired: boolean): string | null {
  if (!paired) return null;
  if (auto) return listening ? 'Syncs by itself while Mnemax is open on both devices.' : 'Syncs when Mnemax is open.';
  return listening ? 'Paired devices can reach this one while Settings is open.' : 'Open Settings on both to sync.';
}
