import { DERIVATIVE_SIGILS, type DerivativeSigilId } from '../math/trigDerivatives';
import { ActionBuffer, applyRadialDeadzone, type GameAction } from './inputMath';

export interface InputCallbacks {
  onSelectSigil: (sigil: DerivativeSigilId) => void;
  onToggleWheel: (open: boolean) => void;
  onToggleDev: () => void;
  onTogglePause: () => void;
  onToggleMap?: () => void;
  onFirstUserGesture: () => void;
  onPointerLockChange?: (locked: boolean) => void;
}

export class InputManager {
  public readonly buffer = new ActionBuffer(0.15);
  public isTouchDevice = false;

  private readonly keys = new Set<string>();
  private readonly callbacks: InputCallbacks;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private touchMoveX = 0;
  private touchMoveY = 0;
  private sigilIndex = 0;
  private isDraggingMouse = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lookTouchId: number | null = null;
  private lastLookTouchX = 0;
  private lastLookTouchY = 0;
  private wheelKeyHeld = false;
  private readonly canvas: HTMLCanvasElement;
  private uiBlocked = false;
  private pointerLockAllowed = true;

  constructor(canvas: HTMLCanvasElement, callbacks: InputCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.isTouchDevice =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 840);
    this.bindEvents();
  }

  public setPointerLockAllowed(allowed: boolean): void {
    this.pointerLockAllowed = allowed;
    if (!allowed) {
      this.exitPointerLock();
    }
  }

  public isPointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.canvas;
  }

  public exitPointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement === this.canvas) {
      try {
        document.exitPointerLock?.();
      } catch {
        // Ignore browser exitPointerLock errors
      }
    }
  }

  public requestPointerLockSafe(): void {
    if (!this.pointerLockAllowed || this.uiBlocked || this.isTouchDevice) return;
    if (this.isPointerLocked()) return;
    try {
      const maybePromise = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Pointer lock denied or unavailable; fallback drag remains harmless
        });
      }
    } catch {
      // Ignore pointer lock rejection
    }
  }

  public setUiBlocked(blocked: boolean): void {
    this.uiBlocked = blocked;
    if (blocked) {
      this.keys.clear();
      this.touchMoveX = 0;
      this.touchMoveY = 0;
      this.isDraggingMouse = false;
      this.exitPointerLock();
    }
  }

  public isSprinting(): boolean {
    if (this.uiBlocked) return false;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  public setCurrentSigilIndex(index: number): void {
    this.sigilIndex = ((index % DERIVATIVE_SIGILS.length) + DERIVATIVE_SIGILS.length) % DERIVATIVE_SIGILS.length;
  }

  public setTouchStick(normX: number, normY: number): void {
    const stick = applyRadialDeadzone(normX, normY, 0.16, 1.15);
    this.touchMoveX = stick.x;
    this.touchMoveY = stick.y;
  }

  public triggerAction(action: GameAction, nowSec: number): void {
    this.callbacks.onFirstUserGesture();
    this.buffer.press(action, nowSec);
  }

  public getMoveVector(): { x: number; y: number } {
    let x = this.touchMoveX;
    let y = this.touchMoveY;
    if (!this.uiBlocked) {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  public consumeLookDelta(): { dx: number; dy: number } {
    const out = { dx: this.lookDeltaX, dy: this.lookDeltaY };
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return out;
  }

  private nowSec(): number {
    return performance.now() / 1000;
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      this.callbacks.onFirstUserGesture();
      if (e.code === 'F9' || e.code === 'Backquote') {
        e.preventDefault();
        this.callbacks.onToggleDev();
        return;
      }
      if (e.code === 'KeyM') {
        e.preventDefault();
        if (this.callbacks.onToggleMap) {
          this.callbacks.onToggleMap();
        } else {
          this.callbacks.onTogglePause();
        }
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        this.callbacks.onTogglePause();
        return;
      }
      if (this.uiBlocked) return;

      this.keys.add(e.code);

      if (!e.repeat) {
        if (e.code === 'Space') {
          e.preventDefault();
          this.buffer.press('jump', this.nowSec());
        } else if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') {
          e.preventDefault();
          this.buffer.press('dodge', this.nowSec());
        } else if (e.code === 'KeyE') {
          this.buffer.press('castSigil', this.nowSec());
        } else if (e.code === 'KeyR') {
          this.buffer.press('heal', this.nowSec());
        } else if (e.code === 'KeyF') {
          this.buffer.press('interact', this.nowSec());
        } else if (e.code === 'KeyV') {
          this.buffer.press('togglePov', this.nowSec());
        } else if (e.code === 'Tab') {
          e.preventDefault();
          this.buffer.press('lockOn', this.nowSec());
        } else if (e.code === 'KeyQ') {
          this.wheelKeyHeld = true;
          this.callbacks.onToggleWheel(true);
        } else if (e.code.startsWith('Digit')) {
          const idx = Number(e.code.replace('Digit', '')) - 1;
          if (idx >= 0 && idx < DERIVATIVE_SIGILS.length) {
            this.sigilIndex = idx;
            this.callbacks.onSelectSigil(DERIVATIVE_SIGILS[idx].id);
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyQ' && this.wheelKeyHeld) {
        this.wheelKeyHeld = false;
        this.callbacks.onToggleWheel(false);
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isDraggingMouse = false;
      this.callbacks.onPointerLockChange?.(this.isPointerLocked());
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.callbacks.onFirstUserGesture();
      if (this.uiBlocked) return;

      if (this.isPointerLocked()) {
        if (e.button === 0) {
          this.buffer.press('attack', this.nowSec());
        } else if (e.button === 2) {
          this.buffer.press('castSigil', this.nowSec());
        }
        return;
      }

      // First click on unlocked desktop canvas acquires Pointer Lock cleanly without misfiring an attack
      if (this.pointerLockAllowed && !this.isTouchDevice && e.button === 0) {
        this.isDraggingMouse = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.requestPointerLockSafe();
        return;
      }

      if (e.button === 0) {
        this.isDraggingMouse = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      } else if (e.button === 2) {
        this.buffer.press('castSigil', this.nowSec());
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.isDraggingMouse = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.uiBlocked) return;
      if (this.isPointerLocked()) {
        this.lookDeltaX += e.movementX;
        this.lookDeltaY += e.movementY;
      } else if (this.isDraggingMouse) {
        this.lookDeltaX += e.clientX - this.lastMouseX;
        this.lookDeltaY += e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.uiBlocked) return;
        const dir = e.deltaY > 0 ? 1 : -1;
        this.sigilIndex = (this.sigilIndex + dir + DERIVATIVE_SIGILS.length) % DERIVATIVE_SIGILS.length;
        this.callbacks.onSelectSigil(DERIVATIVE_SIGILS[this.sigilIndex].id);
      },
      { passive: true },
    );

    // Touch camera look on canvas (for mobile right-side drag)
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        this.callbacks.onFirstUserGesture();
        this.isTouchDevice = true;
        if (this.uiBlocked) return;
        for (const t of Array.from(e.changedTouches)) {
          if (this.lookTouchId === null) {
            this.lookTouchId = t.identifier;
            this.lastLookTouchX = t.clientX;
            this.lastLookTouchY = t.clientY;
            break;
          }
        }
      },
      { passive: true },
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        if (this.uiBlocked || this.lookTouchId === null) return;
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.lookTouchId) {
            this.lookDeltaX += (t.clientX - this.lastLookTouchX) * 1.35;
            this.lookDeltaY += (t.clientY - this.lastLookTouchY) * 1.35;
            this.lastLookTouchX = t.clientX;
            this.lastLookTouchY = t.clientY;
          }
        }
      },
      { passive: true },
    );

    const endTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookTouchId) {
          this.lookTouchId = null;
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch, { passive: true });
    this.canvas.addEventListener('touchcancel', endTouch, { passive: true });
  }
}
