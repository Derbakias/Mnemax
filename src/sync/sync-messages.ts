// What the Sync section tells the person: the latest message (what happened, or what went wrong), and the
// step-by-step log of the latest pairing or sync, for when something fails. They're kept in src/stores/sync.ts.

import type { SyncResult } from '@/sync/sync';
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
