import { AUTO_SYNC_DELAY_MS, AUTO_SYNC_MS, SYNC_API } from '@/config/sync';
import { ROUND_PLAYED_EVENT } from '@/lib/storage';
import { useSettingsStore } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import * as sync from '@/sync/sync';
import { startSyncDriver } from '@/sync/sync-auto';
import type { SyncPeer } from '@/sync/sync';

// The real checks and texts, with the network calls (the Rust side) replaced by fakes.
vi.mock('@/sync/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/sync')>()),
  syncAvailable: () => true,
  isPhone: () => false,
  syncStatus: vi.fn(),
  syncWith: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  updateListeningRounds: vi.fn(),
  saveReceived: vi.fn(),
}));

function peer(key: string, address: string | null): SyncPeer {
  return { key, name: key, address, pairedAt: 0, lastSyncAt: null };
}
const status = (peers: SyncPeer[]) => ({ api: SYNC_API, name: 'This one', peers });
// A device that connects to this one (so this one listens), and one this device connects to (auto-sync).
const waits = status([peer('a', null)]);
const connects = status([peer('b', '192.168.1.2')]);

/** The order the fake Rust side was asked to start and stop listening. */
let calls: string[];
let stopDriver: () => void;

/** Lets the queued starts and stops run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  // No browser page in tests: just enough of one for the events the driver listens to.
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  calls = [];
  vi.mocked(sync.startListening)
    .mockReset()
    .mockImplementation(async () => void calls.push('start'));
  vi.mocked(sync.stopListening)
    .mockReset()
    .mockImplementation(async () => void calls.push('stop'));
  vi.mocked(sync.syncStatus).mockReset().mockResolvedValue(connects);
  vi.mocked(sync.syncWith).mockReset().mockResolvedValue({ added: 0, skipped: 0 });
  useSyncStore.setState({ status: null, listening: false, syncing: null, playing: false, settingsActive: false });
  useSettingsStore.setState((s) => ({ ready: true, prefs: { ...s.prefs, autoSync: true } }));
  stopDriver = startSyncDriver();
});

afterEach(async () => {
  stopDriver();
  await settle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the sync driver', () => {
  it('listens with a device that connects here, stops for a round and starts again after it', async () => {
    useSyncStore.setState({ status: waits });
    await settle();
    expect(useSyncStore.getState().listening).toBe(true);

    useSyncStore.getState().setScreen({ playing: true });
    expect(useSyncStore.getState().listening).toBe(false);
    await settle();
    expect(calls).toEqual(['start', 'stop']);

    useSyncStore.getState().setScreen({ playing: false });
    await settle();
    expect(calls).toEqual(['start', 'stop', 'start']);
    expect(useSyncStore.getState().listening).toBe(true);
  });

  it('a stop while the start is still on its way never says listening, and reaches Rust after it', async () => {
    let finishStart = () => {};
    vi.mocked(sync.startListening).mockImplementation(() => {
      calls.push('start');
      return new Promise<void>((resolve) => (finishStart = resolve));
    });
    useSyncStore.setState({ status: waits });
    await settle();
    useSyncStore.getState().setScreen({ playing: true });
    await settle();
    expect(calls).toEqual(['start']);

    finishStart();
    await settle();
    expect(calls).toEqual(['start', 'stop']);
    expect(useSyncStore.getState().listening).toBe(false);
  });

  it('never starts listening twice without a stop between, however fast things change', async () => {
    useSyncStore.setState({ status: waits });
    for (const playing of [true, false, true, false, true, false]) {
      useSyncStore.getState().setScreen({ playing });
    }
    await settle();
    expect(calls.join(' ')).not.toContain('start start');
    expect(calls.at(-1)).toBe('start');
    expect(useSyncStore.getState().listening).toBe(true);
  });

  it('syncs by itself soon after opening, every few minutes and after a round, but not during one', async () => {
    useSyncStore.setState({ status: connects });
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(sync.syncWith).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_MS);
    expect(sync.syncWith).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event(ROUND_PLAYED_EVENT));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
    expect(sync.syncWith).toHaveBeenCalledTimes(3);

    useSyncStore.getState().setScreen({ playing: true });
    window.dispatchEvent(new Event(ROUND_PLAYED_EVENT));
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_MS * 2);
    expect(sync.syncWith).toHaveBeenCalledTimes(3);
  });
});
