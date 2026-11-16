/**
 * FullscreenManager: Cross-browser fullscreen API wrapper with mobile orientation lock support.
 */
export type FullscreenChangeListener = (isFullscreen: boolean) => void;

export class FullscreenManager {
  private listeners = new Set<FullscreenChangeListener>();

  constructor() {
    if (typeof document !== 'undefined') {
      const handler = () => {
        const active = this.isFullscreen();
        this.listeners.forEach((fn) => fn(active));
      };
      document.addEventListener('fullscreenchange', handler);
      document.addEventListener('webkitfullscreenchange', handler);
    }
  }

  public isFullscreen(): boolean {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  }

  public isSupported(): boolean {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    return Boolean(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.mozFullScreenEnabled ||
      doc.msFullscreenEnabled
    );
  }

  public async request(element: HTMLElement = document.documentElement): Promise<boolean> {
    if (typeof document === 'undefined') return false;
    const el = element as any;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.mozRequestFullScreen) {
        await el.mozRequestFullScreen();
      } else if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
      }

      // Attempt to lock mobile screen orientation to landscape
      if (typeof screen !== 'undefined' && (screen as any).orientation?.lock) {
        try {
          await (screen as any).orientation.lock('landscape');
        } catch {
          // Some browsers only allow orientation lock in installed PWAs; ignore failure gracefully
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public async exit(): Promise<boolean> {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    try {
      if (doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        await doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        await doc.msExitFullscreen();
      }

      // Unlock screen orientation if locked
      if (typeof screen !== 'undefined' && (screen as any).orientation?.unlock) {
        try {
          (screen as any).orientation.unlock();
        } catch {
          // Ignore
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public async toggle(element?: HTMLElement): Promise<boolean> {
    if (this.isFullscreen()) {
      await this.exit();
      return false;
    } else {
      await this.request(element);
      return true;
    }
  }

  public onChange(listener: FullscreenChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const fullscreenManager = new FullscreenManager();
