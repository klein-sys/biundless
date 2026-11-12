export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type FpsCap = 30 | 60 | 120 | 0; // 0 = Unlimited (VSync)
export type ControlSchemeMode = 'auto' | 'desktop' | 'mobile';

export interface GraphicsProfile {
  readonly label: string;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly maxDpr: number;
  readonly particleCount: number;
  readonly bloomGlow: boolean;
  readonly waveRibbonSegments: number;
}

export interface GameSettings {
  preset: GraphicsPreset;
  fpsCap: FpsCap;
  showFps: boolean;
  controlMode: ControlSchemeMode;
  sensitivity: number;
  shakeStrength: number;
  audioEnabled: boolean;
  audioVolume: number;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'ashen_tangent_settings_v1';

export const PRESET_PROFILES: Record<GraphicsPreset, GraphicsProfile> = {
  low: {
    label: 'Low',
    shadows: false,
    shadowMapSize: 512,
    maxDpr: 0.75,
    particleCount: 40,
    bloomGlow: false,
    waveRibbonSegments: 36,
  },
  medium: {
    label: 'Medium',
    shadows: true,
    shadowMapSize: 1024,
    maxDpr: 1.0,
    particleCount: 90,
    bloomGlow: false,
    waveRibbonSegments: 56,
  },
  high: {
    label: 'High',
    shadows: true,
    shadowMapSize: 2048,
    maxDpr: 1.5,
    particleCount: 160,
    bloomGlow: true,
    waveRibbonSegments: 80,
  },
  ultra: {
    label: 'Ultra',
    shadows: true,
    shadowMapSize: 2048,
    maxDpr: 2.0,
    particleCount: 260,
    bloomGlow: true,
    waveRibbonSegments: 112,
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  preset: 'high',
  fpsCap: 60,
  showFps: true,
  controlMode: 'auto',
  sensitivity: 1.0,
  shakeStrength: 1.0,
  audioEnabled: true,
  audioVolume: 0.55,
};

function defaultBrowserStorage(): StorageAdapter | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: StorageAdapter | null = defaultBrowserStorage()): GameSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const preset: GraphicsPreset =
      parsed.preset && parsed.preset in PRESET_PROFILES ? parsed.preset : DEFAULT_SETTINGS.preset;
    const fpsCap: FpsCap =
      parsed.fpsCap === 30 || parsed.fpsCap === 60 || parsed.fpsCap === 120 || parsed.fpsCap === 0
        ? parsed.fpsCap
        : DEFAULT_SETTINGS.fpsCap;
    const controlMode: ControlSchemeMode =
      parsed.controlMode === 'auto' || parsed.controlMode === 'desktop' || parsed.controlMode === 'mobile'
        ? parsed.controlMode
        : DEFAULT_SETTINGS.controlMode;

    return {
      preset,
      fpsCap,
      showFps: typeof parsed.showFps === 'boolean' ? parsed.showFps : DEFAULT_SETTINGS.showFps,
      controlMode,
      sensitivity:
        typeof parsed.sensitivity === 'number' && parsed.sensitivity > 0.2 && parsed.sensitivity <= 3
          ? parsed.sensitivity
          : DEFAULT_SETTINGS.sensitivity,
      shakeStrength:
        typeof parsed.shakeStrength === 'number' && parsed.shakeStrength >= 0 && parsed.shakeStrength <= 1
          ? parsed.shakeStrength
          : DEFAULT_SETTINGS.shakeStrength,
      audioEnabled:
        typeof parsed.audioEnabled === 'boolean' ? parsed.audioEnabled : DEFAULT_SETTINGS.audioEnabled,
      audioVolume:
        typeof parsed.audioVolume === 'number' && parsed.audioVolume >= 0 && parsed.audioVolume <= 1
          ? parsed.audioVolume
          : DEFAULT_SETTINGS.audioVolume,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: GameSettings,
  storage: StorageAdapter | null = defaultBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota / private mode errors
  }
}
