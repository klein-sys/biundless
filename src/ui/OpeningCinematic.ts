import type { GameSettings } from '../engine/GraphicsSettings';

const STALL_TIMEOUT_MS = 5000;

export class OpeningCinematic {
  private finish: (() => void) | null = null;

  constructor(private readonly mount: HTMLElement, private readonly url: string) {}

  public get active(): boolean {
    return this.finish !== null;
  }

  public skip(): boolean {
    if (!this.finish) return false;
    this.finish();
    return true;
  }

  public play(
    settings: Pick<GameSettings, 'audioEnabled' | 'audioVolume'>,
    connectAudio: (video: HTMLVideoElement) => (() => void) | undefined,
    onFinish: () => void,
  ): void {
    if (this.active) return;
    const overlay = document.createElement('section');
    overlay.className = 'opening-cinematic';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'The Ward Goes Dark');
    const video = document.createElement('video');
    video.setAttribute('aria-label', 'Opening cinematic with captions');
    video.playsInline = true;
    video.preload = 'auto';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'adv-btn opening-skip';
    skip.textContent = 'Skip intro';
    overlay.append(video, skip);
    this.mount.append(overlay);

    video.muted = !settings.audioEnabled || settings.audioVolume === 0;
    const disconnectAudio = video.muted ? undefined : connectAudio(video);
    if (!disconnectAudio) video.volume = settings.audioVolume;

    const events = new AbortController();
    const { signal } = events;
    let timer: ReturnType<typeof setTimeout>;
    let lastProgress = 0;
    const finish = () => {
      if (this.finish !== finish) return;
      this.finish = null;
      clearTimeout(timer);
      events.abort();
      video.pause();
      disconnectAudio?.();
      video.removeAttribute('src');
      video.load();
      overlay.remove();
      onFinish();
    };
    this.finish = finish;
    const watchProgress = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, STALL_TIMEOUT_MS);
    };
    video.addEventListener('playing', watchProgress, { signal });
    video.addEventListener('timeupdate', () => {
      if (video.currentTime <= lastProgress) return;
      lastProgress = video.currentTime;
      watchProgress();
    }, { signal });
    video.addEventListener('ended', finish, { signal });
    video.addEventListener('error', finish, { signal });
    skip.addEventListener('click', finish, { signal });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        skip.focus();
      }
    }, { signal });
    video.src = this.url;
    skip.focus({ preventScroll: true });
    watchProgress();
    void video.play().catch(finish);
  }
}
