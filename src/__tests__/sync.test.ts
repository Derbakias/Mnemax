import { loadRounds } from '../lib/storage';
import {
  SYNC_API,
  apiMismatch,
  groupCode,
  readPairingText,
  saveReceived,
  syncWith,
  typeAddress,
  typeCode,
} from '../sync';
import type { RoundResult } from '../game/types';

const mockMemory = new Map<string, string>();
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  isTauri: () => true,
  Channel: class {
    onmessage: unknown = null;
  },
}));

vi.mock('../lib/kv', () => ({
  getItem: async (key: string) => mockMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockMemory.set(key, value);
  },
  removeItem: async (key: string) => {
    mockMemory.delete(key);
  },
}));

function round(id: string, finishedAt: number): RoundResult {
  return {
    id,
    finishedAt,
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2900,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    },
    trials: [],
  };
}

describe('saveReceived', () => {
  beforeEach(() => mockMemory.clear());

  it('saves the rounds another device sent, checked like an imported file', async () => {
    const good = round('phone-1', Date.UTC(2026, 8, 30));
    const result = await saveReceived([
      good,
      { ...round('phone-2', Date.UTC(2026, 8, 30)), settings: { nLevel: 99 } },
      { ...round('phone-3', Date.UTC(2026, 8, 30)), extra: '<script>' },
      'not a round',
    ]);
    expect(result).toEqual({ added: 2, skipped: 2 });
    const saved = await loadRounds();
    expect(saved.map((r) => r.id).sort()).toEqual(['phone-1', 'phone-3']);
    expect(saved.find((r) => r.id === 'phone-3')).not.toHaveProperty('extra');
  });

  it('adds nothing when the rounds are already here', async () => {
    const r = round('a', Date.UTC(2026, 8, 30));
    await saveReceived([r]);
    await expect(saveReceived([r])).resolves.toEqual({ added: 0, skipped: 0 });
  });
});

describe('readPairingText', () => {
  it('takes the address and code from a Mnemax QR code or the copied text', () => {
    const read = readPairingText('mnemax:pair:192.168.1.20:815307042');
    expect(read).toEqual({ address: '192.168.1.20', code: '815307042' });
    expect(readPairingText(' mnemax:pair:10.0.0.5:000000001\n')).toEqual({ address: '10.0.0.5', code: '000000001' });
  });

  it('turns down any other text', () => {
    for (const text of [
      '815307042',
      '192.168.1.20',
      'https://example.com/mnemax:pair:192.168.1.20:815307042',
      'mnemax:pair:192.168.1.20:81530704',
      'mnemax:pair:192.168.1.20:8153070421',
      'mnemax:pair:192.168.1:815307042',
      'mnemax:pair:evil.example:815307042',
      'mnemax:pair:192.168.1.20:815307042&next=evil',
      'MNEMAX:PAIR:192.168.1.20:815307042',
    ]) {
      expect(readPairingText(text)).toBeNull();
    }
  });

  it('groups a code in threes', () => {
    expect(groupCode('815307042')).toBe('815-307-042');
    expect(groupCode('8153')).toBe('815-3');
  });
});

/** Types `keys` one at a time, the way a person would, through `tidy`. */
function typeKeys(tidy: (before: string, typed: string) => string, keys: string, start = ''): string {
  return [...keys].reduce((text, key) => (key === '⌫' ? tidy(text, text.slice(0, -1)) : tidy(text, text + key)), start);
}

describe('typing an address', () => {
  it('adds the dot by itself once a number is complete', () => {
    expect(typeKeys(typeAddress, '192')).toBe('192.');
    expect(typeKeys(typeAddress, '192168120')).toBe('192.168.120.');
    expect(typeKeys(typeAddress, '19216812')).toBe('192.168.12');
    expect(typeKeys(typeAddress, '26')).toBe('26.');
    expect(typeKeys(typeAddress, '0')).toBe('0.');
  });

  it('works for every kind of home address, with a typed dot where a number could still grow', () => {
    expect(typeKeys(typeAddress, '192168.1.20')).toBe('192.168.1.20');
    expect(typeKeys(typeAddress, '10.0.1.1')).toBe('10.0.1.1');
    expect(typeKeys(typeAddress, '10.01.1')).toBe('10.0.1.1');
    expect(typeKeys(typeAddress, '172.16.05')).toBe('172.16.0.5');
    expect(typeKeys(typeAddress, '10.255.255.254')).toBe('10.255.255.254');
    expect(typeKeys(typeAddress, '10.2.25.5')).toBe('10.2.25.5');
    expect(typeKeys(typeAddress, '192.168.100.200')).toBe('192.168.100.200');
  });

  it('never adds a dot back while deleting, and lets the dot be typed twice without doubling it', () => {
    expect(typeKeys(typeAddress, '192⌫')).toBe('192');
    expect(typeKeys(typeAddress, '192⌫⌫')).toBe('19');
    expect(typeKeys(typeAddress, '192.')).toBe('192.');
    expect(typeKeys(typeAddress, '.1')).toBe('1');
  });

  it('stops after four numbers and takes only digits and dots', () => {
    expect(typeKeys(typeAddress, '192.168.1.205')).toBe('192.168.1.205');
    expect(typeKeys(typeAddress, '192.168.1.2059')).toBe('192.168.1.205');
    expect(typeAddress('', '192.168.1.20.')).toBe('192.168.1.20');
    expect(typeAddress('', '19a2.1x6')).toBe('192.16');
    expect(typeAddress('', '192.168.1.20')).toBe('192.168.1.20');
  });
});

describe('typing a code', () => {
  it('adds the dashes by itself and keeps only 9 digits', () => {
    expect(typeKeys(typeCode, '482')).toBe('482-');
    expect(typeKeys(typeCode, '482913057')).toBe('482-913-057');
    expect(typeKeys(typeCode, '4829130579')).toBe('482-913-057');
    expect(typeCode('', '48a2 91')).toBe('482-91');
  });

  it('deletes normally', () => {
    expect(typeKeys(typeCode, '482⌫')).toBe('482');
    expect(typeKeys(typeCode, '4829⌫')).toBe('482-');
    expect(typeKeys(typeCode, '4829⌫⌫')).toBe('482');
  });
});

describe('talking to the Rust side', () => {
  beforeEach(() => {
    mockMemory.clear();
    mockInvoke.mockReset();
  });

  it('saves the rounds from a sync', async () => {
    mockInvoke.mockResolvedValueOnce({ rounds: [round('a', Date.UTC(2026, 8, 30))] });
    await expect(syncWith('k', () => {})).resolves.toEqual({ added: 1, skipped: 0 });
  });

  it('turns an answer it does not know into an error, not a guess', async () => {
    for (const answer of [[round('a', Date.UTC(2026, 8, 30))], null, 'synced', { kind: 'synced' }]) {
      mockInvoke.mockResolvedValueOnce(answer);
      await expect(syncWith('k', () => {})).rejects.toThrow('Restart the app');
    }
  });

  it('notices a Rust side from another version', () => {
    expect(apiMismatch({ api: SYNC_API, name: 'Laptop', peers: [] })).toBeNull();
    expect(apiMismatch({ name: 'Laptop', peers: [] })).toContain('Restart or update the app');
    expect(apiMismatch({ api: SYNC_API - 1, name: 'Laptop', peers: [] })).toContain('Restart or update the app');
  });
});
