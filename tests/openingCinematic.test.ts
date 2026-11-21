import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpeningCinematic } from '../src/ui/OpeningCinematic';

class TestElement extends EventTarget {
  children: TestElement[] = [];
  parent?: TestElement;

  setAttribute(): void {}
  removeAttribute(): void {}
  focus(): void {}

  append(...children: TestElement[]): void {
    children.forEach((child) => { child.parent = this; });
    this.children.push(...children);
  }

  remove(): void {
    this.parent!.children = this.parent!.children.filter((child) => child !== this);
  }
}

class TestVideo extends TestElement {
  muted = false;
  currentTime = 0;
  volume = 1;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
}

describe('opening cinematic playback', () => {
  let video: TestVideo;
  let mount: TestElement;
  let cinematic: OpeningCinematic;
  const sound = { audioEnabled: true, audioVolume: 0.4 };

  beforeEach(() => {
    vi.useFakeTimers();
    video = new TestVideo();
    mount = new TestElement();
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'video' ? video : new TestElement() });
    cinematic = new OpeningCinematic(mount as unknown as HTMLElement, 'opening.mp4');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('releases the overlay and disconnects audio only once, even when a late media event arrives', () => {
    const finish = vi.fn();
    const disconnect = vi.fn();
    cinematic.play(sound, () => disconnect, finish);
    expect(cinematic.skip()).toBe(true);
    video.dispatchEvent(new Event('ended'));
    vi.advanceTimersByTime(5000);
    expect(mount.children).toHaveLength(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });

  it('keeps muted playback on screen until media stops progressing for five seconds', () => {
    const finish = vi.fn();
    const connectAudio = vi.fn();
    cinematic.play({ ...sound, audioEnabled: false }, connectAudio, finish);
    expect(video.muted).toBe(true);
    expect(connectAudio).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    video.currentTime = 1;
    video.dispatchEvent(new Event('timeupdate'));
    vi.advanceTimersByTime(4999);
    video.dispatchEvent(new Event('timeupdate'));
    expect(cinematic.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(cinematic.active).toBe(false);
    expect(finish).toHaveBeenCalledOnce();
  });

  it('uses the same gameplay handoff when the browser rejects play', async () => {
    const finish = vi.fn();
    video.play.mockRejectedValueOnce(new Error('Playback blocked'));
    cinematic.play(sound, () => undefined, finish);
    await Promise.resolve();
    expect(video.volume).toBe(0.4);
    expect(cinematic.active).toBe(false);
    expect(finish).toHaveBeenCalledOnce();
  });
});
