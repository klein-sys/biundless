import { BIOME_LANDMARKS, type BiomeLandmark, WORLD_PLAYABLE_RADIUS } from '../world/SunlitValley';
import type { ProgressionState } from '../rpg/progressionSystem';

export interface MapPoint {
  x: number;
  y: number; // 2D map y corresponds to world z
}

/**
 * Converts world coordinates (x, z) in [-WORLD_PLAYABLE_RADIUS, WORLD_PLAYABLE_RADIUS]
 * into normalized 2D map coordinates in [0, 1].
 */
export function worldToMapNormalized(worldX: number, worldZ: number): { u: number; v: number } {
  const maxR = WORLD_PLAYABLE_RADIUS + 12; // slight padding for margin
  const u = (worldX + maxR) / (maxR * 2);
  const v = (worldZ + maxR) / (maxR * 2);
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

/**
 * Converts normalized map coordinates [0, 1] back into world coordinates (x, z).
 */
export function mapNormalizedToWorld(u: number, v: number): { x: number; z: number } {
  const maxR = WORLD_PLAYABLE_RADIUS + 12;
  return {
    x: u * (maxR * 2) - maxR,
    z: v * (maxR * 2) - maxR,
  };
}

export interface AtlasHandlers {
  onWarp: (landmarkId: 'hub' | 'witch' | 'lich' | 'dragon') => void;
  onClose: () => void;
}

/**
 * InteractiveAtlas: Manages the full-screen fantasy cartographic map of Sunlit Valley.
 */
export class InteractiveAtlas {
  private root: HTMLElement;
  private handlers: AtlasHandlers;
  private selectedLandmark: BiomeLandmark | null = null;
  private isOpen = false;

  constructor(handlers: AtlasHandlers, parent?: HTMLElement) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'atlas-modal';
    this.root.className = 'modal-backdrop hidden atlas-backdrop';
    const mountTarget = parent ?? (typeof document !== 'undefined' && document.body ? document.body : null);
    if (mountTarget && typeof mountTarget.appendChild === 'function') {
      mountTarget.appendChild(this.root);
    }
  }

  public get visible(): boolean {
    return this.isOpen;
  }

  public open(
    playerPos: { x: number; z: number },
    playerYaw: number,
    progression?: ProgressionState,
  ): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.render(playerPos, playerYaw, progression);
  }

  public close(): void {
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.handlers.onClose();
  }

  public updatePlayerLive(playerPos: { x: number; z: number }, playerYaw: number): void {
    if (!this.isOpen) return;
    const pin = this.root.querySelector('#atlas-player-pin') as HTMLElement;
    if (!pin) return;
    const { u, v } = worldToMapNormalized(playerPos.x, playerPos.z);
    pin.style.left = `${(u * 100).toFixed(2)}%`;
    pin.style.top = `${(v * 100).toFixed(2)}%`;
    // Rotate heading pointer (yaw in 3D: Math.PI is facing -Z in world)
    const deg = ((playerYaw * 180) / Math.PI + 180) % 360;
    const cone = pin.querySelector('.player-heading-cone') as HTMLElement;
    if (cone) {
      cone.style.transform = `rotate(${deg}deg)`;
    }
  }

  public render(
    playerPos: { x: number; z: number },
    playerYaw: number,
    progression?: ProgressionState,
  ): void {
    const { u: playerU, v: playerV } = worldToMapNormalized(playerPos.x, playerPos.z);
    const headingDeg = ((playerYaw * 180) / Math.PI + 180) % 360;

    const landmarkCardsHtml = BIOME_LANDMARKS.map((lm) => {
      const { u, v } = worldToMapNormalized(lm.x, lm.z);
      const isDefeated = lm.id !== 'hub' && progression?.defeatedBosses.includes(lm.id as any);
      const isSelected = this.selectedLandmark?.id === lm.id;

      return `
        <div class="atlas-pin-wrapper ${isSelected ? 'selected' : ''}"
             data-landmark-id="${lm.id}"
             style="left: ${(u * 100).toFixed(2)}%; top: ${(v * 100).toFixed(2)}%;">
          <button class="atlas-pin-btn" aria-label="${lm.name}">
            <div class="atlas-pin-pulse" style="border-color: ${lm.accentHex};"></div>
            <div class="atlas-pin-icon" style="background: ${lm.accentHex};">
              ${lm.id === 'hub' ? '🏛️' : lm.id === 'witch' ? '🔮' : lm.id === 'lich' ? '💀' : '🐉'}
            </div>
          </button>
          <div class="atlas-pin-label">
            <span class="pin-title">${lm.name}</span>
            ${isDefeated ? '<span class="pin-status vanquished">✓ VANQUISHED</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    const selectedInfoHtml = this.selectedLandmark
      ? `
        <div class="atlas-detail-card" style="border-color: ${this.selectedLandmark.accentHex};">
          <div class="detail-top">
            <span class="detail-crest">✧ SUNLIT REALM ATLAS ✧</span>
            <h3 class="detail-name" style="color: ${this.selectedLandmark.accentHex};">${this.selectedLandmark.name}</h3>
            <span class="detail-subtitle">${this.selectedLandmark.subtitle}</span>
          </div>
          <div class="detail-meta">
            <div class="meta-pill">Coordinates: <strong>${this.selectedLandmark.x}, ${this.selectedLandmark.z}</strong></div>
            <div class="meta-pill">Elevation: <strong>+${this.selectedLandmark.baseHeight.toFixed(1)}m</strong></div>
          </div>
          <div class="detail-actions">
            <button id="atlas-warp-btn" class="adv-btn primary atlas-btn">
              <span class="btn-icon">⚡</span> Fast Travel to ${this.selectedLandmark.name}
            </button>
          </div>
        </div>
      `
      : `
        <div class="atlas-detail-card empty">
          <span class="detail-hint">✦ Tap any realm landmark pin to inspect or fast travel ✦</span>
        </div>
      `;

    this.root.innerHTML = `
      <div class="atlas-window adventure-modal">
        <div class="atlas-header">
          <div class="atlas-title-group">
            <span class="atlas-kicker">✦ CARTOGRAPHIC CHRONICLES ✦</span>
            <h2 class="atlas-heading">SUNLIT VALLEY ATLAS</h2>
          </div>
          <button id="atlas-close-btn" class="circle-btn close-atlas-btn" title="Close Map (Esc / M)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="atlas-map-canvas-container">
          <!-- Background Illustrated Fantasy Map SVG -->
          <svg class="atlas-svg-backdrop" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <defs>
              <radialGradient id="valleyGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#4ade80" stop-opacity="0.35"/>
                <stop offset="60%" stop-color="#166534" stop-opacity="0.15"/>
                <stop offset="100%" stop-color="#052e16" stop-opacity="0.6"/>
              </radialGradient>
              <filter id="mapGlow">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            <!-- Outer Mountain Boundary -->
            <rect width="1000" height="1000" fill="#0b1320" />
            <circle cx="500" cy="500" r="460" fill="url(#valleyGlow)" stroke="#334155" stroke-width="3" stroke-dasharray="12 6" />

            <!-- Sunlit Brook Channel (Curves across northern valley) -->
            <path d="M 120 420 Q 350 460 500 440 T 880 430" fill="none" stroke="#38bdf8" stroke-width="12" stroke-linecap="round" opacity="0.65" />
            <path d="M 120 420 Q 350 460 500 440 T 880 430" fill="none" stroke="#bae6fd" stroke-width="4" stroke-linecap="round" opacity="0.85" />

            <!-- Trail Paths to Landmarks -->
            <!-- Path to Whispering Glade (SW) -->
            <path d="M 500 500 Q 350 420 210 265" fill="none" stroke="#d97706" stroke-width="4" stroke-dasharray="8 6" opacity="0.75" />
            <!-- Path to Sunken Sun-Ruins (NNE) -->
            <path d="M 500 500 Q 520 650 565 800" fill="none" stroke="#d97706" stroke-width="4" stroke-dasharray="8 6" opacity="0.75" />
            <!-- Path to Skyridge Peak (SE) -->
            <path d="M 500 500 Q 640 400 765 230" fill="none" stroke="#d97706" stroke-width="4" stroke-dasharray="8 6" opacity="0.75" />

            <!-- Solstice Haven Castle Wall Perimeter Ring -->
            <circle cx="500" cy="500" r="75" fill="rgba(245, 238, 222, 0.15)" stroke="#fbbf24" stroke-width="3" />
            <circle cx="500" cy="500" r="14" fill="#60a5fa" />
          </svg>

          <!-- Interactive Landmark Pins -->
          <div class="atlas-pins-layer">
            ${landmarkCardsHtml}
          </div>

          <!-- Real-Time Player GPS Beacon Pin -->
          <div id="atlas-player-pin" class="atlas-player-pin" style="left: ${(playerU * 100).toFixed(2)}%; top: ${(playerV * 100).toFixed(2)}%;">
            <div class="player-heading-cone" style="transform: rotate(${headingDeg}deg);"></div>
            <div class="player-beacon-core"></div>
            <span class="player-beacon-label">YOU</span>
          </div>
        </div>

        <div class="atlas-footer-panel">
          ${selectedInfoHtml}
        </div>
      </div>
    `;

    // Event Bindings
    this.root.querySelector('#atlas-close-btn')?.addEventListener('click', () => {
      this.close();
    });

    this.root.querySelectorAll('[data-landmark-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-landmark-id');
        this.selectedLandmark = BIOME_LANDMARKS.find((lm) => lm.id === id) ?? null;
        this.render(playerPos, playerYaw, progression);
      });
    });

    this.root.querySelector('#atlas-warp-btn')?.addEventListener('click', () => {
      if (this.selectedLandmark) {
        const targetId = this.selectedLandmark.id;
        this.close();
        this.handlers.onWarp(targetId);
      }
    });
  }
}
