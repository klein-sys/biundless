import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProceduralAudio } from '../src/audio/ProceduralAudio';

class TestAudio extends EventTarget {
  static tracks: TestAudio[] = [];
  loop = false;
  paused = true;
  currentTime = 0;

  constructor(public src: string) {
    super();
    TestAudio.tracks.push(this);
  }

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  load(): void {}
}

class TestAudioContext {
  static gainChanges: ReturnType<typeof vi.fn>[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};

  createGain() {
    const setTargetAtTime = vi.fn();
    TestAudioContext.gainChanges.push(setTargetAtTime);
    return { gain: { value: 0, setTargetAtTime }, connect() {} };
  }

  createMediaElementSource() {
    return { connect() {}, disconnect() {} };
  }
}

describe('gameplay soundtrack', () => {
  beforeEach(() => {
    TestAudio.tracks = [];
    TestAudioContext.gainChanges = [];
    vi.stubGlobal('window', { AudioContext: TestAudioContext });
    vi.stubGlobal('Audio', TestAudio);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loops a single track during gameplay and resets it on returning to title', () => {
    const audio = new ProceduralAudio();
    audio.unlock();
    expect(TestAudio.tracks).toHaveLength(0);

    audio.setMusicActive(true);
    audio.unlock();
    expect(TestAudio.tracks).toHaveLength(1);
    const [track] = TestAudio.tracks;
    expect(track.src).toContain('the-valley-of-turning-stars');
    expect(track.loop).toBe(true);
    expect(track.paused).toBe(false);

    track.currentTime = 42;
    audio.setMusicActive(false);
    audio.unlock();
    expect(track.paused).toBe(true);
    expect(track.currentTime).toBe(0);
  });

  it('honors saved mute on entry and resumes from the same position when unmuted', () => {
    const audio = new ProceduralAudio();
    audio.setConfig(false, 0.55);
    audio.setMusicActive(true);
    expect(TestAudio.tracks).toHaveLength(0);

    audio.setConfig(true, 0.55);
    const [track] = TestAudio.tracks;
    expect(track.paused).toBe(false);

    track.currentTime = 18;
    audio.setConfig(false, 0.55);
    expect(track.paused).toBe(true);

    audio.setConfig(true, 0.55);
    expect(TestAudio.tracks).toHaveLength(1);
    expect(track.paused).toBe(false);
    expect(track.currentTime).toBe(18);
  });

  it('ducks music during a voiced line and keeps the same line from replaying on refresh', () => {
    const audio = new ProceduralAudio();
    audio.setMusicActive(true);
    audio.playDialogue('/aurelius_root.mp3');
    const musicGainChange = TestAudioContext.gainChanges.at(-1)!;
    const voice = TestAudio.tracks.at(-1)!;
    voice.dispatchEvent(new Event('playing'));
    expect(musicGainChange).toHaveBeenLastCalledWith(0.35, 0, expect.any(Number));

    voice.dispatchEvent(new Event('ended'));
    expect(musicGainChange).toHaveBeenLastCalledWith(1, 0, expect.any(Number));
    audio.playDialogue('/aurelius_root.mp3');
    expect(TestAudio.tracks).toHaveLength(2);
    audio.stopDialogue();
    audio.playDialogue('/aurelius_root.mp3');
    expect(TestAudio.tracks).toHaveLength(3);
  });

  it('stops the previous clip on a new line and respects mute and missing clips', () => {
    const audio = new ProceduralAudio();
    audio.playDialogue('/aurelius_root.mp3');
    const first = TestAudio.tracks.at(-1)!;
    audio.playDialogue('/aurelius_calculus_lesson.mp3');
    const second = TestAudio.tracks.at(-1)!;
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
    audio.setConfig(false, 0.55);
    expect(second.paused).toBe(true);
    audio.playDialogue('/blacksmith_root.mp3');
    audio.playDialogue(undefined);
    expect(TestAudio.tracks).toHaveLength(2);
  });
});
