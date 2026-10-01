import { useEffect, useState, type ReactNode } from 'react';

import { groupCode, type Qr, type ShownCode } from '@/sync';

/**
 * The address, code and QR code, with the seconds left. Once the code can't be used any more (it ran out, or
 * someone tried it and it failed), says why and offers a new one.
 */
export function ShowCode({
  showing,
  onNewCode,
  cancel,
}: {
  showing: { shown: ShownCode | null; expiresAt: number; ended: string | null };
  onNewCode: () => void;
  cancel: ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const { shown } = showing;
  const left = Math.max(0, Math.ceil((showing.expiresAt - now) / 1000));

  const ended = showing.ended ?? (shown != null && left === 0 ? 'The code ran out.' : null);
  if (ended) {
    return (
      <div className="card sync-pairing">
        <p className="t-default" role="alert">
          {ended}
        </p>
        <p className="t-small secondary">A code works once, for one minute, so nobody else has time to guess it.</p>
        <div className="data-row">
          {cancel}
          <button type="button" className="outline-button sync-primary" onClick={onNewCode}>
            New code
          </button>
        </div>
      </div>
    );
  }
  const onCopy = async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="card sync-pairing">
      <ol className="t-small secondary sync-steps">
        <li>On your other device, open Sync and tap Enter a code.</li>
        <li>Scan this QR code with it, or type the address and code below.</li>
      </ol>
      {/* Until the code is ready, an empty square holds its place, so nothing jumps when it comes. */}
      {shown ? (
        <QrCode qr={shown.qr} label={`QR code for the address ${shown.address} and its pairing code`} />
      ) : (
        <div className="sync-qr sync-qr-waiting" aria-hidden />
      )}
      <div className="sync-pair-row">
        <div>
          <p className="t-small secondary">Address</p>
          <p className="sync-value">{shown?.address ?? '…'}</p>
        </div>
        <div>
          <p className="t-small secondary">Code</p>
          <p className="sync-value" aria-live="polite">
            {shown ? groupCode(shown.code) : '…'}
          </p>
        </div>
      </div>
      <p className="t-small secondary sync-or">
        {shown ? `Works once, for ${left} more second${left === 1 ? '' : 's'}.` : '\u00a0'}
      </p>
      <button type="button" className="text-button t-small secondary sync-center" disabled={!shown} onClick={onCopy}>
        {copied ? 'Copied' : 'Copy address and code'}
      </button>
      {cancel}
    </div>
  );
}

/** Dark squares on white, with the blank border scanners need, in light and dark mode alike. */
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
