import { useState } from 'react';

import type { LogLine } from '@/sync/sync-messages';

/** The steps of the latest pairing or sync, hidden until asked for, with a way to copy them. */
export function SyncLog({ start, lines, deviceName }: { start: number; lines: LogLine[]; deviceName?: string }) {
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
          {shown ? 'Hide sync logs' : lines.length > 0 ? `Sync logs (${lines.length})` : 'Sync logs'}
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
