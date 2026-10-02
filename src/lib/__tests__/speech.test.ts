// The clips load in the background; these check that a letter asked for meanwhile plays once, and only the latest.

let started: string[] = [];

class FakeAudioContext {
  state = 'running';
  destination = {};
  createBufferSource() {
    const source = {
      buffer: null as { url: string } | null,
      connect: () => {},
      start: vi.fn(() => {
        started.push(source.buffer?.url ?? '');
      }),
      stop: () => {},
    };
    return source;
  }
  // The fake "decoded" clip is just the url it came from, so the test can tell letters apart.
  async decodeAudioData(data: unknown) {
    return data;
  }
}

async function freshSpeech() {
  vi.resetModules();
  return import('../speech');
}

function finishLoading() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  started = [];
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  vi.stubGlobal('fetch', async (url: string) => ({ arrayBuffer: async () => ({ url }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('speakLetter while the clips are loading', () => {
  it('plays the letter once loading finishes', async () => {
    const { speakLetter } = await freshSpeech();
    speakLetter('H');
    expect(started).toEqual([]);
    await finishLoading();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatch(/H\.wav/);
  });

  it('plays nothing if stopped before loading finishes', async () => {
    const { speakLetter, stopSpeech } = await freshSpeech();
    speakLetter('H');
    stopSpeech();
    await finishLoading();
    expect(started).toEqual([]);
  });

  it('plays only the last of two letters, once', async () => {
    const { speakLetter } = await freshSpeech();
    speakLetter('C');
    speakLetter('H');
    await finishLoading();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatch(/H\.wav/);
  });
});
