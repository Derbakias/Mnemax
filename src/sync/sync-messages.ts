// What the Sync section tells the person: the latest message (what happened, or what went wrong), and the
// step-by-step log of the latest pairing or sync, for when something fails.

import { useCallback, useState } from 'react';

import type { SyncResult } from '@/sync/sync';
import { MAX_LOG_LINES } from '@/config/sync';
import { syncCopy } from '@/copy/sync';

/** A message under the Sync section. */
export type Notice = { kind: 'info' | 'error'; text: string };

/**
 * A message under one paired device (`key`): how the latest sync with it went. `reconnect`: it couldn't be
 * reached, so pairing again (with its new address) may help.
 */
export type PeerNote = Notice & { key: string; reconnect?: boolean };

export interface LogLine {
  at: number;
  text: string;
}

export function useSyncMessages() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [log, setLog] = useState<{ start: number; lines: LogLine[] }>({ start: Date.now(), lines: [] });

  const note = useCallback((text: string) => {
    setLog((l) => ({ ...l, lines: [...l.lines.slice(-(MAX_LOG_LINES - 1)), { at: Date.now(), text }] }));
  }, []);
  /**
   * Starts the log over: a new attempt. The message stays until the attempt brings its own, so nothing on the
   * page disappears and comes back (which made everything below it jump).
   */
  const restart = useCallback((text: string) => {
    const start = Date.now();
    setLog({ start, lines: [{ at: start, text }] });
  }, []);
  const inform = useCallback((text: string) => setNotice({ kind: 'info', text }), []);
  /** Shows the error, and notes it in the log unless `noteIt` is false (Rust notes its own). */
  const failWith = useCallback(
    (error: unknown, noteIt = true) => {
      const text = errorText(error);
      setNotice({ kind: 'error', text });
      if (noteIt) {
        note(`Failed: ${text}`);
      }
    },
    [note],
  );
  const dismiss = useCallback(() => setNotice(null), []);

  return { notice, log, note, restart, inform, failWith, dismiss };
}

export function syncedText({ added, skipped }: SyncResult): string {
  const got = added > 0 ? syncCopy.messages.synced(added) : syncCopy.messages.nothingNew;
  return skipped > 0 ? `${got} ${syncCopy.messages.skipped(skipped)}` : got;
}

export function errorText(error: unknown): string {
  if (typeof error === 'string' && error) {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  // A failed sync command: see SyncFailure.
  if (typeof error === 'object' && error != null && 'message' in error) {
    return String(error.message);
  }
  return syncCopy.messages.somethingWrong;
}
