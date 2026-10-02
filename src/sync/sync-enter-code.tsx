import type { ReactNode, SubmitEvent } from 'react';

import { Icon } from '@/components/ui/icon';
import { syncCopy } from '@/copy/sync';
import { isPhone } from '@/sync/sync';
import { CameraScan, ScanOverlay } from '@/sync/sync-scan';

/**
 * The form for the other device's address and code: scan its QR code, or type them in. Any error from the last
 * try shows under the Pair button.
 */
export function EnterCode({
  hint,
  address,
  code,
  canPair,
  joining,
  scanning,
  error,
  onAddress,
  onCode,
  onScan,
  onScanned,
  onScanFailed,
  onCancelPhoneScan,
  onCloseError,
  onSubmit,
  cancel,
}: {
  hint?: string;
  address: string;
  code: string;
  canPair: boolean;
  joining: boolean;
  scanning: boolean;
  error: string | null;
  onAddress: (value: string) => void;
  onCode: (value: string) => void;
  onScan: () => void;
  onScanned: (text: string | null) => Promise<void>;
  onScanFailed: (e: unknown) => void;
  onCancelPhoneScan: () => void;
  onCloseError: () => void;
  onSubmit: (e: SubmitEvent) => void;
  cancel: ReactNode;
}) {
  return (
    <form className="card sync-pairing" onSubmit={onSubmit}>
      <ol className="t-small secondary sync-steps">
        <li>{hint ?? syncCopy.pairing.stepShowCode}</li>
        <li>{syncCopy.pairing.stepScan}</li>
      </ol>
      <p className="t-small secondary sync-note">{syncCopy.pairing.ownCodeOnly}</p>
      <button type="button" className="outline-button accent" disabled={joining} onClick={onScan}>
        Scan QR code
      </button>
      <p className="t-small secondary sync-or">{syncCopy.pairing.orType}</p>
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
            // TODO: For event listeners like this one we need a function named something like handleAddressInput and place on the top.
            // Check the whole repo for cases like this one.
            onChange={(e) => onAddress(e.target.value)}
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
            onChange={(e) => onCode(e.target.value)}
          />
        </label>
      </div>
      <div className="data-row">
        {cancel}
        <button type="submit" className="outline-button sync-primary" disabled={joining || !canPair}>
          {joining ? 'Connecting…' : 'Pair'}
        </button>
      </div>
      {/* Always there, with room for four lines, so an error coming or going doesn't move anything. */}
      <div className="sync-pair-error" role="alert">
        {error && (
          <>
            <p className="t-small sync-error">
              <strong>{syncCopy.pairing.failedLead}</strong> {error}
            </p>
            <button
              type="button"
              className="text-button secondary sync-error-close"
              aria-label="Close the error"
              onClick={onCloseError}
            >
              <Icon name="close" size={18} />
            </button>
          </>
        )}
      </div>
      {scanning &&
        (isPhone() ? (
          <ScanOverlay hint={syncCopy.pairing.phoneScanHint} onCancel={onCancelPhoneScan} />
        ) : (
          <CameraScan
            onFound={(text) => void onScanned(text)}
            onCancel={() => void onScanned(null)}
            onFail={onScanFailed}
          />
        ))}
    </form>
  );
}
