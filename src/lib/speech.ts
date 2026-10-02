// Letters are pre-recorded clips (Piper TTS, LibriTTS voice) played through Web Audio.
// Webviews don't reliably offer speechSynthesis (Android WebView has none), and clips
// give the same low, constant latency on every platform.

const CLIP_URLS = import.meta.glob<string>('../assets/letters/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
});

function letterOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.wav'.length);
}

let context: AudioContext | null = null;
let buffers: Map<string, AudioBuffer> | null = null;
let loading: Promise<void> | null = null;
let current: AudioBufferSourceNode | null = null;

/** The letter waiting for the clips to finish loading. A newer letter replaces it; stopping clears it. */
let pendingLetter: string | null = null;

function getContext(): AudioContext | null {
  if (context) {
    return context;
  }
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  context = new Ctor();
  return context;
}

function loadClips(): Promise<void> {
  if (loading) {
    return loading;
  }
  const ctx = getContext();
  if (!ctx) {
    return Promise.resolve();
  }
  loading = Promise.all(
    Object.entries(CLIP_URLS).map(async ([path, url]) => {
      const data = await (await fetch(url)).arrayBuffer();
      return [letterOf(path), await ctx.decodeAudioData(data)] as const;
    }),
  )
    .then((entries) => {
      buffers = new Map(entries);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/**
 * Loads and decodes the clips ahead of time (at app start), so the first trial of the first round has its
 * letter. Decoding works before a user gesture; only playing needs one (see primeSpeech).
 */
export function preloadSpeech(): Promise<void> {
  return loadClips();
}

/** Call from a user gesture (e.g. pressing Play) so audio is allowed to start. */
export function primeSpeech(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  loadClips();
}

export function speakLetter(letter: string): void {
  if (!buffers) {
    // Still loading: play the latest letter once ready, unless the trial was stopped by then.
    pendingLetter = letter;
    loadClips().then(() => {
      if (pendingLetter !== null) {
        const next = pendingLetter;
        pendingLetter = null;
        play(next);
      }
    });
    return;
  }
  pendingLetter = null;
  play(letter);
}

function play(letter: string): void {
  try {
    const ctx = getContext();
    const buffer = buffers?.get(letter);
    if (!ctx || !buffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    current = source;
  } catch {
    // no-op when audio unavailable
  }
}

export function stopSpeech(): void {
  pendingLetter = null;
  try {
    current?.stop();
  } catch {
    // no-op
  }
  current = null;
}
