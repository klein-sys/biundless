import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProceduralAudio } from '../src/audio/ProceduralAudio';

const played: string[] = [];
const loaded = new Map<ArrayBuffer, string>();
let decoded = 0;

class TestAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};

  createGain() {
    return {
      gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }

  createOscillator() {
    return {
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, start() {}, stop() {},
    };
  }

  async decodeAudioData(data: ArrayBuffer) {
    decoded += 1;
    return loaded.get(data);
  }

  createBufferSource() {
    return {
      buffer: '',
      connect() {},
      start() {
        played.push(this.buffer);
      },
    };
  }
}

describe('sampled combat audio', () => {
  beforeEach(() => {
    played.length = 0;
    loaded.clear();
    decoded = 0;
    vi.stubGlobal('window', { AudioContext: TestAudioContext });
    vi.stubGlobal('fetch', async (url: string) => {
      const data = new ArrayBuffer(1);
      loaded.set(data, url);
      return { ok: true, arrayBuffer: async () => data };
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('cycles swing samples in light, reverse, heavy order and picks the critical shatter', async () => {
    const audio = new ProceduralAudio();
    audio.unlock();
    await vi.waitFor(() => expect(decoded).toBe(13));

    [1, 2, 3, 4].forEach((step) => audio.playSlash(step));
    audio.playWardShatter(true);
    expect(played.map((url) => url.split('/').at(-1))).toEqual([
      'sword_swing_light.wav', 'sword_swing_reverse.wav', 'sword_swing_heavy.wav',
      'sword_swing_light.wav', 'ward_shatter_crit.wav',
    ]);
  });

  it('drops cues while muted and plays the next cue after unmuting', async () => {
    const audio = new ProceduralAudio();
    audio.unlock();
    await vi.waitFor(() => expect(decoded).toBe(13));

    audio.setConfig(false, 0.55);
    audio.playCombatSound('vespera_orb_windup');
    expect(played).toHaveLength(0);

    audio.setConfig(true, 0.55);
    audio.playCombatSound('vespera_orb_release');
    expect(played[0]).toMatch(/vespera_orb_release\.wav$/);
    expect(played).toHaveLength(1);
  });
});
