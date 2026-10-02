import { PREFS_KEY, SETTINGS_KEY } from '@/config/storage';
import { useSettingsStore } from '@/stores/settings';

const mockMemory = new Map<string, string>();

vi.mock('@/lib/kv', () => ({
  getItem: async (key: string) => mockMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockMemory.set(key, value);
  },
  removeItem: async (key: string) => {
    mockMemory.delete(key);
  },
}));

// The store as it starts, put back before each test.
const initial = useSettingsStore.getState();

describe('settings store', () => {
  beforeEach(() => {
    mockMemory.clear();
    useSettingsStore.setState(initial, true);
  });

  it('loads the saved values and marks them ready', async () => {
    mockMemory.set(SETTINGS_KEY, JSON.stringify({ nLevel: 4 }));
    mockMemory.set(PREFS_KEY, JSON.stringify({ dailyTargetMinutes: 30 }));
    await useSettingsStore.getState().load();
    const { settings, prefs, ready } = useSettingsStore.getState();
    expect(ready).toBe(true);
    expect(settings.nLevel).toBe(4);
    expect(prefs.dailyTargetMinutes).toBe(30);
  });

  it('will not turn off the last active stream', () => {
    const { settings, toggleStream } = useSettingsStore.getState();
    const activeStreams = { position: true, color: false, number: false, audio: false };
    useSettingsStore.setState({ settings: { ...settings, activeStreams } });
    toggleStream('position', false);
    expect(useSettingsStore.getState().settings.activeStreams.position).toBe(true);
  });

  it('turns the other tutorial aid on when the last one goes off', () => {
    const { setTutorialAid } = useSettingsStore.getState();
    setTutorialAid('tutorialHistory', false);
    const { prefs } = useSettingsStore.getState();
    expect(prefs.tutorialHistory).toBe(false);
    expect(prefs.tutorialSolution).toBe(true);
  });

  it('swaps keys when the new key is already taken', () => {
    const { prefs, setKeyBinding } = useSettingsStore.getState();
    const oldKey = prefs.keyBindings.position;
    setKeyBinding('position', prefs.keyBindings.color);
    const { keyBindings } = useSettingsStore.getState().prefs;
    expect(keyBindings.position).toBe(prefs.keyBindings.color);
    expect(keyBindings.color).toBe(oldKey);
  });

  it('saves a change through storage', async () => {
    useSettingsStore.getState().setNLevel(3);
    await vi.waitFor(() => expect(JSON.parse(mockMemory.get(SETTINGS_KEY) ?? '{}').nLevel).toBe(3));
  });
});
