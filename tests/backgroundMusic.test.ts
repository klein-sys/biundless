import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProceduralAudio } from '../src/audio/ProceduralAudio';

class TestAudio {
  static tracks: TestAudio[] = [];
  loop = false;
  paused = true;
  currentTime = 0;

  constructor(readonly src: string) {
    TestAudio.tracks.push(this);
  }

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

class TestAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};

  createGain() {
    return { gain: { value: 0, setTargetAtTime: vi.fn() }, connect() {} };
  }

  createMediaElementSource() {
    return { connect() {} };
  }
}

describe('gameplay soundtrack', () => {
  beforeEach(() => {
    TestAudio.tracks = [];
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
});
