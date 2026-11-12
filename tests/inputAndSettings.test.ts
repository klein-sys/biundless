import { describe, expect, it } from 'vitest';
import { ActionBuffer, applyRadialDeadzone } from '../src/input/inputMath';
import {
  DEFAULT_SETTINGS,
  PRESET_PROFILES,
  loadSettings,
  saveSettings,
  type StorageAdapter,
} from '../src/engine/GraphicsSettings';

describe('inputMath seam', () => {
  it('zeros stick vectors inside radial deadzone and clamps diagonals to magnitude <= 1', () => {
    expect(applyRadialDeadzone(0.1, -0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const diag = applyRadialDeadzone(0.95, 0.95, 0.2);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 4);
    expect(diag.x).toBeGreaterThan(0);
    expect(diag.y).toBeGreaterThan(0);
  });

  it('buffers discrete actions for 0.15s and consumes each press once', () => {
    const buffer = new ActionBuffer(0.15);
    buffer.press('dodge', 1.0);
    expect(buffer.consume('dodge', 1.1)).toBe(true);
    expect(buffer.consume('dodge', 1.11)).toBe(false); // already consumed

    buffer.press('attack', 2.0);
    expect(buffer.consume('attack', 2.25)).toBe(false); // expired
  });
});

describe('GraphicsSettings seam', () => {
  it('provides distinct GPU budgets for Low, Medium, High, and Ultra presets', () => {
    expect(PRESET_PROFILES.low.shadows).toBe(false);
    expect(PRESET_PROFILES.low.maxDpr).toBeLessThan(1.0);
    expect(PRESET_PROFILES.medium.shadows).toBe(true);
    expect(PRESET_PROFILES.high.bloomGlow).toBe(true);
    expect(PRESET_PROFILES.ultra.shadowMapSize).toBeGreaterThanOrEqual(2048);
  });

  it('round-trips settings via storage adapter and falls back safely on corrupt JSON', () => {
    const map = new Map<string, string>();
    const storage: StorageAdapter = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
    };

    const custom = { ...DEFAULT_SETTINGS, preset: 'ultra' as const, fpsCap: 120 as const };
    saveSettings(custom, storage);
    expect(loadSettings(storage)).toEqual(custom);

    map.set('ashen_tangent_settings_v1', '{broken-json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

