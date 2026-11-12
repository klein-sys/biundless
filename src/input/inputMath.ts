export type GameAction =
  | 'attack'
  | 'castSigil'
  | 'dodge'
  | 'heal'
  | 'togglePov'
  | 'lockOn'
  | 'interact';

export function applyRadialDeadzone(
  rawX: number,
  rawY: number,
  deadzone = 0.18,
  curve = 1.0,
): { x: number; y: number } {
  const mag = Math.hypot(rawX, rawY);
  if (mag <= deadzone || deadzone >= 1) {
    return { x: 0, y: 0 };
  }
  const scaled = Math.min((mag - deadzone) / (1 - deadzone), 1);
  const curved = Math.pow(scaled, curve);
  return {
    x: (rawX / mag) * curved,
    y: (rawY / mag) * curved,
  };
}

export class ActionBuffer {
  private readonly pressedAt = new Map<GameAction, number>();
  private readonly windowSec: number;

  constructor(windowSec = 0.15) {
    this.windowSec = windowSec;
  }

  press(action: GameAction, nowSec: number): void {
    this.pressedAt.set(action, nowSec);
  }

  consume(action: GameAction, nowSec: number): boolean {
    const t = this.pressedAt.get(action);
    if (t === undefined || nowSec - t > this.windowSec) {
      return false;
    }
    this.pressedAt.delete(action);
    return true;
  }

  clear(): void {
    this.pressedAt.clear();
  }
}
