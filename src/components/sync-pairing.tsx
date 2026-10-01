import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';

import { Icon } from './icon';
import { CameraScan, ScanOverlay } from './sync-scan';
import { ShowCode } from './sync-show-code';
import { useSync } from '@/sync-context';
import { errorText } from '@/sync-messages';
import {
  cancelPairing,
  cancelScan,
  groupCode,
  isPhone,
  joinPairing,
  readPairingText,
  scanQr,
  startPairing,
  typeAddress,
  typeCode,
  type PairEvent,
  type ShownCode,
} from '@/sync';

/** After pressing Pair, how long until it can be pressed again, even when the answer comes back at once. */
const RETRY_AFTER_MS = 1000;

type Step =
  /** This device shows its address and code (null until it has them), until `expiresAt`. */
  | { step: 'showing'; shown: ShownCode | null; expiresAt: number; ended: string | null }
  | { step: 'entering' }
  /** The camera is open, looking for the other device's QR code. */
  | { step: 'scanning' }
  /** Connecting to the device that shows the code. The form stays on screen meanwhile, so nothing jumps. */
  | { step: 'joining' };

/**
 * Pairing a device: `show` shows this device's address and code; `enter` takes the other device's (scanned, or
 * typed). `hint` says what to do on the other device. Ends when paired, cancelled, or the Settings tab closes.
 */
export function Pairing({
  how,
  hint,
  active,
  onEnd,
}: {
  how: 'show' | 'enter';
  hint?: string;
  active: boolean;
  onEnd: () => void;
}) {
  const { note, restart, inform, failWith, refresh } = useSync();
  const [step, setStep] = useState<Step>({ step: 'entering' });
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  /** Why the last try to pair didn't work: shown right under the Pair button. */
  const [error, setError] = useState<string | null>(null);
  const showError = useCallback(
    (text: string) => {
      note(`Failed: ${text}`);
      setError(text);
    },
    [note],
  );
  const scanningRef = useRef(false);
  scanningRef.current = step.step === 'scanning';
  /** Counts phone scans, so one that was cancelled can't answer later. */
  const scanId = useRef(0);
  // When Pair was last pressed, and the wait before the button comes back.
  const triedAt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  /** A try that didn't work: once a second has passed since Pair was pressed, shows why and brings Pair back. */
  const tryFailed = useCallback((text: string) => {
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(
      () => {
        setError(text);
        // Only the device that pressed Pair goes back to the form; one showing a code keeps saying why it ended.
        setStep((s) => (s.step === 'joining' ? { step: 'entering' } : s));
      },
      Math.max(0, triedAt.current + RETRY_AFTER_MS - Date.now()),
    );
  }, []);

  const end = useCallback(() => {
    scanId.current++;
    if (scanningRef.current && isPhone()) void cancelScan().catch(() => {});
    void cancelPairing().catch(() => {});
    onEnd();
  }, [onEnd]);
  // Leaving the Settings tab ends the pairing. (The Sync section also ends any pairing when it goes away.)
  useEffect(() => {
    if (!active) end();
  }, [active, end]);

  const onPair = useCallback(
    (event: PairEvent) => {
      if (event.kind === 'step') {
        note(event.text);
      } else if (event.kind === 'paired') {
        inform(`Paired with ${event.peer.name}.`);
        refresh();
        onEnd();
      } else if (event.kind === 'expired') {
        setStep((s) => (s.step === 'showing' ? { ...s, ended: 'The code ran out.' } : s));
      } else {
        // On the device showing the code, a failed try has used it up.
        setStep((s) => (s.step === 'showing' ? { ...s, ended: event.message } : s));
        tryFailed(event.message);
      }
    },
    [note, inform, refresh, onEnd, tryFailed],
  );

  const showCode = useCallback(async () => {
    restart('Making a pairing code…');
    setStep({ step: 'showing', shown: null, expiresAt: 0, ended: null });
    try {
      const shown = await startPairing(onPair);
      const expiresAt = Date.now() + shown.seconds * 1000;
      setStep((s) => (s.step === 'showing' ? { step: 'showing', shown, expiresAt, ended: null } : s));
    } catch (error) {
      failWith(error);
      onEnd();
    }
  }, [restart, onPair, failWith, onEnd]);

  // Only once, when it opens. (In development React runs this twice, which would make two codes.)
  const started = useRef(false);
  useEffect(() => {
    if (how === 'show' && !started.current) {
      started.current = true;
      void showCode();
    }
  }, []);

  const join = async (toAddress: string, withCode: string, from: string) => {
    // The last error stays until this try has its own result, so nothing jumps.
    restart(`Pairing with the address and code ${from}…`);
    triedAt.current = Date.now();
    setStep({ step: 'joining' });
    try {
      await joinPairing(toAddress, withCode, onPair);
    } catch (e) {
      note(`Failed: ${errorText(e)}`);
      tryFailed(errorText(e));
    }
  };

  // Phones scan with the system's scanner; computers in the page (CameraScan, below).
  const onScan = () => {
    restart('Opening the camera…');
    setStep({ step: 'scanning' });
    if (!isPhone()) return;
    const id = ++scanId.current;
    scanQr().then(
      (text) => {
        if (id === scanId.current) void onScanned(text);
      },
      (e) => {
        if (id === scanId.current) onScanFailed(e);
      },
    );
  };
  // Doesn't wait for the scanner to answer: on Android its cancel never does (the plugin forgets the scan
  // before turning it down), which left the page stuck on the scan frame.
  const cancelPhoneScan = () => {
    scanId.current++;
    void cancelScan().catch(() => {});
    void onScanned(null);
  };
  /** The text in the QR code, or null if the scan was cancelled. */
  const onScanned = async (text: string | null) => {
    if (text == null) {
      note('Scan cancelled.');
      setStep((s) => (s.step === 'scanning' ? { step: 'entering' } : s));
      return;
    }
    const read = readPairingText(text);
    if (read == null) {
      setStep({ step: 'entering' });
      showError("That isn't a Mnemax pairing code. Scan the one under Show a code on your other device.");
      return;
    }
    // Shown in the boxes too, so it's clear where it's connecting, and easy to try again.
    setAddress(read.address);
    setCode(groupCode(read.code));
    await join(read.address, read.code, 'from the QR code');
  };
  const onScanFailed = (e: unknown) => {
    setStep({ step: 'entering' });
    showError(`Couldn't scan: ${errorText(e)}`);
  };

  // Pasting the copied text into either field fills both.
  const onType = (value: string, set: (value: string) => void) => {
    setError(null);
    const pasted = readPairingText(value);
    if (pasted) {
      setAddress(pasted.address);
      setCode(groupCode(pasted.code));
    } else {
      set(value);
    }
  };
  const digits = code.replace(/\D/g, '');

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    void join(address, digits, 'typed in');
  };

  const cancel = (
    <button
      type="button"
      className="outline-button secondary"
      onClick={() => {
        note('Cancelled on this device.');
        end();
      }}>
      Cancel
    </button>
  );

  if (step.step === 'showing') return <ShowCode showing={step} onNewCode={showCode} cancel={cancel} />;
  const joining = step.step === 'joining';
  return (
    <form className="card sync-pairing" onSubmit={onSubmit}>
      <ol className="t-small secondary sync-steps">
        <li>{hint ?? 'On your other device, open Sync and tap Show a code.'}</li>
        <li>Scan the QR code it shows, or type its address and code and tap Pair.</li>
      </ol>
      <p className="t-small secondary sync-note">
        Only use a code from your own device: a code from someone else's device would send them your rounds.
      </p>
      <button type="button" className="outline-button accent" disabled={joining} onClick={onScan}>
        Scan QR code
      </button>
      <p className="t-small secondary sync-or">or type what it shows</p>
      <div className="sync-pair-row">
        <label className="sync-field">
          <span className="t-small secondary">Address</span>
          <input
            className="text-field sync-code-field"
            value={address}
            inputMode="decimal"
            placeholder="192.168.1.20"
            autoFocus={!isPhone()}
            readOnly={joining}
            onChange={(e) => onType(e.target.value, (v) => setAddress(typeAddress(address, v)))}
          />
        </label>
        <label className="sync-field">
          <span className="t-small secondary">Code</span>
          <input
            className="text-field sync-code-field"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000-000-000"
            readOnly={joining}
            onChange={(e) => onType(e.target.value, (v) => setCode(typeCode(code, v)))}
          />
        </label>
      </div>
      <div className="data-row">
        {cancel}
        <button
          type="submit"
          className="outline-button sync-primary"
          disabled={joining || address === '' || digits.length !== 9}>
          {joining ? 'Connecting…' : 'Pair'}
        </button>
      </div>
      {/* Always there, with room for four lines, so an error coming or going doesn't move anything. */}
      <div className="sync-pair-error" role="alert">
        {error && (
          <>
            <p className="t-small sync-error">
              <strong>Didn't pair:</strong> {error}
            </p>
            <button
              type="button"
              className="text-button secondary sync-error-close"
              aria-label="Close the error"
              onClick={() => setError(null)}>
              <Icon name="close" size={18} />
            </button>
          </>
        )}
      </div>
      {step.step === 'scanning' &&
        (isPhone() ? (
          <ScanOverlay hint="Point the camera at the QR code on your other device" onCancel={cancelPhoneScan} />
        ) : (
          <CameraScan onFound={(text) => void onScanned(text)} onCancel={() => void onScanned(null)} onFail={onScanFailed} />
        ))}
    </form>
  );
}
