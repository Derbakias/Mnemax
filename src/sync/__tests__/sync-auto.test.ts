import { SYNC_API } from '@/config/sync';
import { syncPlan, type SyncInputs } from '@/sync/sync-auto';
import type { SyncPeer } from '@/sync/sync';

function peer(key: string, address: string | null): SyncPeer {
  return { key, name: key, address, pairedAt: 0, lastSyncAt: null };
}

// A desktop app with one device that connects here and one this device connects to, Sync automatically on.
const base: SyncInputs = {
  available: true,
  status: { api: SYNC_API, name: 'This one', peers: [peer('a', null), peer('b', '192.168.1.2:4000')] },
  settingsReady: true,
  autoSync: true,
  phone: false,
  visible: true,
  playing: false,
  settingsActive: false,
};

describe('when sync runs', () => {
  it('listens and syncs by itself while the app is open', () => {
    expect(syncPlan(base)).toEqual({ listen: true, auto: true });
  });

  it('does neither on a phone in the background, but does on a desktop', () => {
    expect(syncPlan({ ...base, phone: true, visible: false })).toEqual({ listen: false, auto: false });
    expect(syncPlan({ ...base, phone: true, visible: true })).toEqual({ listen: true, auto: true });
    expect(syncPlan({ ...base, visible: false })).toEqual({ listen: true, auto: true });
  });

  it('does neither while a round is played', () => {
    expect(syncPlan({ ...base, playing: true })).toEqual({ listen: false, auto: false });
    expect(syncPlan({ ...base, playing: true, settingsActive: true })).toEqual({ listen: false, auto: false });
  });

  it('with Sync automatically off, only listens while the Settings tab is open', () => {
    expect(syncPlan({ ...base, autoSync: false })).toEqual({ listen: false, auto: false });
    expect(syncPlan({ ...base, autoSync: false, settingsActive: true })).toEqual({ listen: true, auto: false });
  });

  it('only listens with a device that connects here, and only syncs with one it connects to', () => {
    const onlyWaits = { ...base.status!, peers: [peer('a', null)] };
    const onlyConnects = { ...base.status!, peers: [peer('b', '192.168.1.2:4000')] };
    expect(syncPlan({ ...base, status: onlyWaits })).toEqual({ listen: true, auto: false });
    expect(syncPlan({ ...base, status: onlyConnects })).toEqual({ listen: false, auto: true });
  });

  it('does neither before the status and settings are in, in a browser, or when Rust is another version', () => {
    const off = { listen: false, auto: false };
    expect(syncPlan({ ...base, status: null })).toEqual(off);
    expect(syncPlan({ ...base, settingsReady: false })).toEqual(off);
    expect(syncPlan({ ...base, available: false })).toEqual(off);
    expect(syncPlan({ ...base, status: { ...base.status!, api: SYNC_API - 1 } })).toEqual(off);
  });
});
