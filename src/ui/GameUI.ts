import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import type { BossRuntime } from '../bosses/bossAI';
import type { CameraPOV } from '../camera/DualCameraController';
import type { PlayerState } from '../combat/resonanceCombat';
import { computeEffectiveStat } from '../combat/resonanceCombat';
import {
  PRESET_PROFILES,
  type ControlSchemeMode,
  type FpsCap,
  type GameSettings,
  type GraphicsPreset,
} from '../engine/GraphicsSettings';
import type { GameAction } from '../input/inputMath';
import {
  DERIVATIVE_SIGILS,
  evaluateExactDerivative,
  evaluateTrig,
  formatThetaPi,
  isCriticalPoint,
  SIGIL_BY_ID,
  type DerivativeSigilId,
  type WorkedExampleSnapshot,
} from '../math/trigDerivatives';
import type { BiomeLandmark } from '../world/SunlitValley';

export interface TelemetrySnapshot {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export interface UIHandlers {
  onStartGame: () => void;
  onWarpBoss: (bossId: BossId | 'hub') => void;
  onSelectSigil: (sigil: DerivativeSigilId) => void;
  onTogglePov: () => void;
  onToggleLockOn: () => void;
  onOpenWheel: () => void;
  onCloseWheel: () => void;
  onTouchAction: (action: GameAction) => void;
  onTouchStick: (nx: number, ny: number) => void;
  onUpdateSettings: (next: GameSettings) => void;
  onToggleGodMode: () => void;
  onToggleInfiniteStamina: () => void;
  onToggleFreezeTheta: () => void;
  onForceStagger: () => void;
  onOpenWorkedExample: () => void;
  onCloseWorkedExample: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

const SIGIL_SVG_PATHS: Record<DerivativeSigilId, string> = {
  cos: 'M4 7 C10 7, 12 21, 16 21 C20 21, 22 7, 28 7',
  neg_sin: 'M4 14 C8 21, 12 21, 16 14 C20 7, 24 7, 28 14',
  sec2: 'M6 7 C12 23, 20 23, 26 7',
  neg_csc2: 'M6 21 C12 5, 20 5, 26 21',
  sec_tan: 'M5 23 C14 21, 18 11, 27 5',
  neg_csc_cot: 'M5 5 C14 7, 18 17, 27 23',
};

export class GameUI {
  private readonly root: HTMLElement;
  private readonly handlers: UIHandlers;

  private titleOverlay!: HTMLElement;
  private settingsModal!: HTMLElement;
  private workedModal!: HTMLElement;
  private radialWheel!: HTMLElement;
  private mobileControls!: HTMLElement;
  private fpReticle!: HTMLElement;
  private regionBanner!: HTMLElement;
  private combatToast!: HTMLElement;
  private pointerHint!: HTMLElement;

  private hpFill!: HTMLElement;
  private staminaFill!: HTMLElement;
  private vitalsHpNum!: HTMLElement;
  private flaskPill!: HTMLElement;
  private povBtn!: HTMLElement;
  private menuBtn!: HTMLElement;
  private fpsBadge!: HTMLElement;

  private bossHud!: HTMLElement;
  private bossNameEl!: HTMLElement;
  private bossStatusEl!: HTMLElement;
  private bossHpFill!: HTMLElement;
  private bossStaggerFill!: HTMLElement;
  private equationRibbon!: HTMLElement;

  private activeSigilPill!: HTMLElement;
  private sigilPipButtons = new Map<DerivativeSigilId, HTMLElement>();

  private toastTimeout: number | null = null;
  private currentRegionId: string | null = null;
  private regionFadeTimeout: number | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <!-- Top Left: Minimal Sleek Vitals & Flask Badge -->
      <div class="hud-top-left interactive">
        <div class="vitals-pod">
          <div class="vitals-row">
            <span class="hero-name">SPELLBLADE</span>
            <span id="hp-num" class="vitals-num">160/160</span>
          </div>
          <div class="bar-pill hp-track"><div id="hp-fill" class="bar-fill hp" style="width:100%"></div></div>
          <div class="bar-pill stam-track"><div id="stamina-fill" class="bar-fill stam" style="width:100%"></div></div>
          <button id="flask-pill" class="flask-pill" title="Heal Flask (R)">
            <svg class="flask-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 2h6v2h-1v2.2l4.8 8.8c.8 1.5-.3 3.3-2 3.3H7.2c-1.7 0-2.8-1.8-2-3.3L10 6.2V4H9V2z"/>
            </svg>
            <span id="flask-label">3</span>
          </button>
        </div>
      </div>

      <!-- Top Center: Subtle Transient Region Banner -->
      <div id="region-banner" class="region-banner">
        <span class="region-crown">✧ SUNLIT VALLEY ✧</span>
        <span id="region-title" class="region-title">Adventurer's Plaza</span>
        <span id="region-sub" class="region-sub">Waypoint Shrine</span>
      </div>

      <!-- Top Right: Exactly 2 Clean Icon Buttons + Optional FPS -->
      <div class="hud-top-right interactive">
        <div id="fps-badge" class="fps-pill hidden">60 FPS</div>
        <button id="btn-pov" class="circle-btn" title="Toggle 3rd / 1st POV (V)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          </svg>
          <span class="btn-subtext">3RD</span>
        </button>
        <button id="btn-menu" class="circle-btn" title="Menu & Settings (Esc / M)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
          <span class="btn-subtext">MENU</span>
        </button>
      </div>

      <!-- Center Screen: Reticle & Transient Toast -->
      <div class="center-crosshair">
        <svg id="fp-reticle" class="fp-reticle hidden" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="16" fill="none" stroke="#d5b868" stroke-width="1.4" stroke-dasharray="4 3"/>
          <circle cx="32" cy="32" r="2.2" fill="#fff7e0"/>
          <line x1="12" y1="32" x2="22" y2="32" stroke="#d5b868" stroke-width="1.4"/>
          <line x1="42" y1="32" x2="52" y2="32" stroke="#d5b868" stroke-width="1.4"/>
          <line x1="32" y1="12" x2="32" y2="22" stroke="#d5b868" stroke-width="1.4"/>
          <line x1="32" y1="42" x2="32" y2="52" stroke="#d5b868" stroke-width="1.4"/>
        </svg>
      </div>

      <div id="combat-toast" class="combat-toast"></div>
      <div id="pointer-hint" class="pointer-hint hidden">Click world to look · Esc for Menu</div>

      <!-- Boss Encounter: Slender Centered Boss HP Bar + Single-Line Math Ribbon -->
      <div id="boss-hud" class="boss-hud hidden">
        <div class="boss-top-row">
          <span id="boss-name" class="boss-name-label">Vespera, Astral Sylvan Witch</span>
          <span id="boss-status" class="boss-status-label">Phase Ward</span>
        </div>
        <div class="boss-bar-shell">
          <div id="boss-hp-fill" class="boss-bar-fill" style="width:100%"></div>
          <div id="boss-stagger-fill" class="boss-stagger-fill" style="width:0%"></div>
        </div>
        <div id="equation-ribbon" class="equation-ribbon"></div>
      </div>

      <!-- Bottom Right: Compact Active Derivative Medallion & Streamlined 6-Pip Selector -->
      <div class="hud-bottom-right interactive">
        <div class="derivative-dock">
          <button id="active-medallion" class="active-medallion" title="Derivative Attunement Wheel (Q / Click)">
            <svg id="medallion-svg" class="medallion-curve" viewBox="0 0 32 28">
              <path d="${SIGIL_SVG_PATHS.cos}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
            </svg>
            <div class="medallion-meta">
              <span id="medallion-label" class="medallion-label">cos θ</span>
              <span class="medallion-hint">d/dθ</span>
            </div>
          </button>
          <div id="sigil-pips" class="sigil-pips-row"></div>
        </div>
      </div>

      <!-- Mobile Touch Controls: Ergonomic Layout -->
      <div id="mobile-controls" class="mobile-controls hidden">
        <div id="touch-stick" class="touch-joystick-zone"><div id="touch-knob" class="touch-joystick-knob"></div></div>
        <div class="touch-actions">
          <button id="m-wheel" class="touch-btn" aria-label="Derivative Wheel">SIGIL</button>
          <button id="m-lock" class="touch-btn" aria-label="Lock target">LOCK</button>
          <button id="m-heal" class="touch-btn" aria-label="Heal">HEAL</button>
          <button id="m-jump" class="touch-btn" aria-label="Jump">JUMP</button>
          <button id="m-dodge" class="touch-btn" aria-label="Dash">DASH</button>
          <button id="m-cast" class="touch-btn cast" aria-label="Cast Resonance">CAST</button>
          <button id="m-attack" class="touch-btn strike" aria-label="Basic Strike">STRIKE</button>
        </div>
      </div>

      <!-- Slow-Mo Radial Wheel -->
      <div id="radial-wheel" class="radial-wheel-backdrop hidden">
        <div id="radial-wheel-inner" class="radial-wheel">
          <div class="radial-center">
            <span class="radial-title">ATTUNE</span>
            <span class="radial-sub">0.2× Slow-Mo</span>
          </div>
        </div>
      </div>

      <!-- Modals: Settings/Menu, Worked Example, Title -->
      <div id="settings-modal" class="modal-backdrop hidden"></div>
      <div id="worked-modal" class="modal-backdrop hidden"></div>
      <div id="title-overlay" class="modal-backdrop"></div>
    `;

    this.hpFill = this.root.querySelector('#hp-fill')!;
    this.staminaFill = this.root.querySelector('#stamina-fill')!;
    this.vitalsHpNum = this.root.querySelector('#hp-num')!;
    this.flaskPill = this.root.querySelector('#flask-pill')!;
    this.povBtn = this.root.querySelector('#btn-pov')!;
    this.menuBtn = this.root.querySelector('#btn-menu')!;
    this.fpsBadge = this.root.querySelector('#fps-badge')!;

    this.regionBanner = this.root.querySelector('#region-banner')!;
    this.combatToast = this.root.querySelector('#combat-toast')!;
    this.pointerHint = this.root.querySelector('#pointer-hint')!;
    this.fpReticle = this.root.querySelector('#fp-reticle')!;

    this.bossHud = this.root.querySelector('#boss-hud')!;
    this.bossNameEl = this.root.querySelector('#boss-name')!;
    this.bossStatusEl = this.root.querySelector('#boss-status')!;
    this.bossHpFill = this.root.querySelector('#boss-hp-fill')!;
    this.bossStaggerFill = this.root.querySelector('#boss-stagger-fill')!;
    this.equationRibbon = this.root.querySelector('#equation-ribbon')!;

    this.activeSigilPill = this.root.querySelector('#active-medallion')!;
    this.mobileControls = this.root.querySelector('#mobile-controls')!;
    this.radialWheel = this.root.querySelector('#radial-wheel')!;
    this.settingsModal = this.root.querySelector('#settings-modal')!;
    this.workedModal = this.root.querySelector('#worked-modal')!;
    this.titleOverlay = this.root.querySelector('#title-overlay')!;

    this.buildSigilPips();
    this.buildRadialWheel();
    this.buildTitleOverlay();
    this.bindTopControls();
    this.bindMobileControls();
  }

  private buildSigilPips(): void {
    const row = this.root.querySelector('#sigil-pips')!;
    DERIVATIVE_SIGILS.forEach((sigil, idx) => {
      const pip = document.createElement('button');
      pip.className = 'sigil-pip';
      pip.title = `${sigil.label} — ${sigil.hint} (Key ${idx + 1})`;
      pip.innerHTML = `
        <span class="pip-key">${idx + 1}</span>
        <svg class="pip-curve" viewBox="0 0 32 28">
          <path d="${SIGIL_SVG_PATHS[sigil.id]}" fill="none" stroke="${sigil.accentHex}" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
        <span class="pip-name">${sigil.label}</span>
      `;
      pip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onSelectSigil(sigil.id);
      });
      row.appendChild(pip);
      this.sigilPipButtons.set(sigil.id, pip);
    });
  }

  private buildRadialWheel(): void {
    const inner = this.root.querySelector('#radial-wheel-inner')!;
    const r = 110;
    DERIVATIVE_SIGILS.forEach((sigil, idx) => {
      const angle = (idx / DERIVATIVE_SIGILS.length) * Math.PI * 2 - Math.PI / 2;
      const node = document.createElement('button');
      node.className = 'radial-node';
      node.style.left = `${155 + Math.cos(angle) * r}px`;
      node.style.top = `${155 + Math.sin(angle) * r}px`;
      node.innerHTML = `
        <svg class="radial-svg" viewBox="0 0 32 28">
          <path d="${SIGIL_SVG_PATHS[sigil.id]}" fill="none" stroke="${sigil.accentHex}" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
        <span style="color:${sigil.accentHex}">${sigil.label}</span>
      `;
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onSelectSigil(sigil.id);
        this.handlers.onCloseWheel();
      });
      inner.appendChild(node);
    });

    this.radialWheel.addEventListener('click', () => this.handlers.onCloseWheel());
  }

  private buildTitleOverlay(): void {
    this.titleOverlay.innerHTML = `
      <div class="adventure-modal title-card">
        <div class="title-crest">✧ SUNLIT CHRONICLES ✧</div>
        <h1 class="title-main">ASHEN TANGENT</h1>
        <p class="title-sub">MATH 101 Differential Calculus Open-World Adventure RPG</p>
        <p class="title-desc">
          Explore the vibrant rolling Sunlit Valley. Bosses channel live trigonometric functions <strong>f(θ)</strong>.
          Attune your blade to their instantaneous derivative <strong>f′(θ)</strong> to break crystalline Phase Wards
          and trigger devastating Critical Staggers.
        </p>
        <div class="controls-cheat">
          <div><strong>Desktop:</strong> WASD Move · Shift Sprint · Space Jump · Ctrl/C Dash · LMB Strike · RMB/E Cast Sigil · 1–6 / Q Wheel · V POV</div>
          <div><strong>Mobile:</strong> Smooth Left Stick · Right Drag Camera · Responsive Strike / Cast / Jump / Dash buttons</div>
        </div>
        <div class="title-actions">
          <button id="start-hub-btn" class="adv-btn primary">Enter Sunlit Valley</button>
          <div class="title-quick-warps">
            <span class="warp-label">Quick Waypoint:</span>
            <button id="start-witch-btn" class="adv-btn sm">Whispering Glade (sin/cos)</button>
            <button id="start-lich-btn" class="adv-btn sm">Sunken Sun-Ruins (tan/cot)</button>
            <button id="start-dragon-btn" class="adv-btn sm">Skyridge Peak (sec/csc)</button>
          </div>
        </div>
      </div>
    `;

    this.titleOverlay.querySelector('#start-hub-btn')!.addEventListener('click', () => {
      this.titleOverlay.classList.add('hidden');
      this.handlers.onStartGame();
    });
    for (const id of BOSS_ORDER) {
      this.titleOverlay.querySelector(`#start-${id}-btn`)!.addEventListener('click', () => {
        this.titleOverlay.classList.add('hidden');
        this.handlers.onStartGame();
        this.handlers.onWarpBoss(id);
      });
    }
  }

  private bindTopControls(): void {
    this.povBtn.addEventListener('click', () => this.handlers.onTogglePov());
    this.menuBtn.addEventListener('click', () => {
      if (this.settingsModal.classList.contains('hidden')) {
        this.handlers.onOpenSettings();
      } else {
        this.closeSettingsModal();
        this.handlers.onCloseSettings();
      }
    });

    this.flaskPill.addEventListener('click', () => {
      this.handlers.onTouchAction('heal');
    });

    this.activeSigilPill.addEventListener('click', () => {
      this.handlers.onOpenWheel();
    });
  }

  private bindMobileControls(): void {
    const stick = this.root.querySelector('#touch-stick') as HTMLElement;
    const knob = this.root.querySelector('#touch-knob') as HTMLElement;
    let stickTouchId: number | null = null;
    const maxRadius = 48;

    const updateKnob = (clientX: number, clientY: number) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.handlers.onTouchStick(dx / maxRadius, dy / maxRadius);
    };

    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (t) {
        stickTouchId = t.identifier;
        updateKnob(t.clientX, t.clientY);
      }
    });

    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickTouchId) updateKnob(t.clientX, t.clientY);
      }
    });

    const resetStick = () => {
      stickTouchId = null;
      knob.style.transform = 'translate(0px, 0px)';
      this.handlers.onTouchStick(0, 0);
    };
    stick.addEventListener('touchend', resetStick);
    stick.addEventListener('touchcancel', resetStick);

    const mapBtn = (id: string, fn: () => void) => {
      const el = this.root.querySelector(id)!;
      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        fn();
      });
      el.addEventListener('click', fn);
    };

    mapBtn('#m-attack', () => this.handlers.onTouchAction('attack'));
    mapBtn('#m-cast', () => this.handlers.onTouchAction('castSigil'));
    mapBtn('#m-dodge', () => this.handlers.onTouchAction('dodge'));
    mapBtn('#m-jump', () => this.handlers.onTouchAction('jump'));
    mapBtn('#m-heal', () => this.handlers.onTouchAction('heal'));
    mapBtn('#m-lock', () => this.handlers.onToggleLockOn());
    mapBtn('#m-wheel', () => this.handlers.onOpenWheel());
  }

  public setMobileControlsVisible(visible: boolean): void {
    this.mobileControls.classList.toggle('hidden', !visible);
  }

  public setPointerHintVisible(visible: boolean): void {
    this.pointerHint.classList.toggle('hidden', !visible);
  }

  public setRadialWheelVisible(visible: boolean): void {
    this.radialWheel.classList.toggle('hidden', !visible);
  }

  public isModalOpen(): boolean {
    return (
      !this.titleOverlay.classList.contains('hidden') ||
      !this.settingsModal.classList.contains('hidden') ||
      !this.workedModal.classList.contains('hidden')
    );
  }

  public closeSettingsModal(): void {
    this.settingsModal.classList.add('hidden');
  }

  public showToast(msg: string): void {
    this.combatToast.textContent = msg;
    this.combatToast.classList.add('visible');
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      this.combatToast.classList.remove('visible');
    }, 1850);
  }

  public updateRegion(landmark: BiomeLandmark | null, bossEngaged: boolean = false): void {
    if (bossEngaged) {
      this.regionBanner.classList.remove('visible');
      if (this.regionFadeTimeout !== null) {
        window.clearTimeout(this.regionFadeTimeout);
        this.regionFadeTimeout = null;
      }
      return;
    }
    const id = landmark ? landmark.id : null;
    if (id === this.currentRegionId) return;
    this.currentRegionId = id;

    if (!landmark) {
      this.regionBanner.classList.remove('visible');
      return;
    }

    const titleEl = this.regionBanner.querySelector('#region-title') as HTMLElement;
    const subEl = this.regionBanner.querySelector('#region-sub') as HTMLElement;
    titleEl.textContent = landmark.name;
    subEl.textContent = landmark.subtitle;
    this.regionBanner.classList.add('visible');

    if (this.regionFadeTimeout !== null) window.clearTimeout(this.regionFadeTimeout);
    this.regionFadeTimeout = window.setTimeout(() => {
      this.regionBanner.classList.remove('visible');
    }, 4200);
  }

  public openSettingsModal(
    settings: GameSettings,
    player?: PlayerState,
    boss?: BossRuntime | null,
    freezeTheta?: boolean,
    telemetry?: TelemetrySnapshot,
    initialTab: 'gameplay' | 'dev' = 'gameplay',
  ): void {
    this.settingsModal.classList.remove('hidden');
    const presets: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
    const fpsCaps: FpsCap[] = [30, 60, 120, 0];
    const controls: ControlSchemeMode[] = ['auto', 'desktop', 'mobile'];
    const isDev = initialTab === 'dev';

    this.settingsModal.innerHTML = `
      <div class="adventure-modal settings-card">
        <div class="modal-tabs">
          <button id="tab-gameplay" class="tab-btn ${!isDev ? 'active' : ''}">SANCTUARY SETTINGS</button>
          <button id="tab-dev" class="tab-btn ${isDev ? 'active' : ''}">DEV & MATH 101 DEMO</button>
        </div>

        <div id="tab-body-gameplay" class="tab-body ${isDev ? 'hidden' : ''}">
          <div class="settings-group">
            <label class="setting-label">Waypoint Quick-Travel</label>
            <div class="btn-grid-4">
              <button data-warp="hub" class="adv-btn sm">Adventurer's Plaza</button>
              <button data-warp="witch" class="adv-btn sm">Whispering Glade</button>
              <button data-warp="lich" class="adv-btn sm">Sunken Sun-Ruins</button>
              <button data-warp="dragon" class="adv-btn sm">Skyridge Peak</button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-title">Graphics Preset</span>
            <div class="pill-group">
              ${presets
                .map(
                  (p) =>
                    `<button data-preset="${p}" class="pill-btn ${settings.preset === p ? 'active' : ''}">${PRESET_PROFILES[p].label}</button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-title">Target Frame Rate</span>
            <div class="pill-group">
              ${fpsCaps
                .map(
                  (f) =>
                    `<button data-fps="${f}" class="pill-btn ${settings.fpsCap === f ? 'active' : ''}">${f === 0 ? 'Max' : `${f}`}</button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-title">Controls Mode</span>
            <div class="pill-group">
              ${controls
                .map(
                  (c) =>
                    `<button data-ctrl="${c}" class="pill-btn ${settings.controlMode === c ? 'active' : ''}">${c.toUpperCase()}</button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-title">Show FPS Overlay</span>
            <button id="opt-fps" class="pill-btn ${settings.showFps ? 'active' : ''}">${settings.showFps ? 'SHOWN' : 'HIDDEN'}</button>
          </div>

          <div class="setting-row">
            <span class="setting-title">Procedural Audio</span>
            <button id="opt-audio" class="pill-btn ${settings.audioEnabled ? 'active' : ''}">${settings.audioEnabled ? 'ON' : 'MUTED'}</button>
          </div>

          <div class="setting-row">
            <span class="setting-title">Camera Sensitivity (${settings.sensitivity.toFixed(1)}×)</span>
            <input id="opt-sens" type="range" min="0.4" max="2.2" step="0.1" value="${settings.sensitivity}" class="adv-slider" />
          </div>
        </div>

        <div id="tab-body-dev" class="tab-body ${isDev ? '' : 'hidden'}">
          <div class="settings-group">
            <label class="setting-label">Class Presentation Overlay</label>
            <button id="dev-worked" class="adv-btn primary" style="width:100%;">Open MATH 101 Worked Example</button>
          </div>

          <div class="settings-group">
            <label class="setting-label">Live Calculus Toggles</label>
            <div class="btn-grid-4">
              <button id="dev-god" class="adv-btn sm ${player?.godMode ? 'active' : ''}">God Mode</button>
              <button id="dev-stam" class="adv-btn sm ${player?.infiniteStamina ? 'active' : ''}">Inf Stamina</button>
              <button id="dev-freeze" class="adv-btn sm ${freezeTheta ? 'active' : ''}">Freeze θ</button>
              <button id="dev-stagger" class="adv-btn sm">Stagger Boss</button>
            </div>
          </div>

          ${
            telemetry
              ? `
            <div class="telemetry-box">
              <div>FPS: ${telemetry.fps.toFixed(0)}</div>
              <div>Frame: ${telemetry.frameMs.toFixed(1)}ms</div>
              <div>Draw Calls: ${telemetry.drawCalls}</div>
              <div>Triangles: ${telemetry.triangles}</div>
              <div>Boss: ${boss ? boss.id : 'none'}</div>
              <div>θ: ${boss ? formatThetaPi(boss.theta) : '0'}</div>
            </div>
          `
              : ''
          }
        </div>

        <div class="modal-footer">
          <button id="opt-close" class="adv-btn primary">Resume Adventure</button>
        </div>
      </div>
    `;

    const tabGameplay = this.settingsModal.querySelector('#tab-gameplay')!;
    const tabDev = this.settingsModal.querySelector('#tab-dev')!;
    const bodyGameplay = this.settingsModal.querySelector('#tab-body-gameplay')!;
    const bodyDev = this.settingsModal.querySelector('#tab-body-dev')!;

    tabGameplay.addEventListener('click', () => {
      tabGameplay.classList.add('active');
      tabDev.classList.remove('active');
      bodyGameplay.classList.remove('hidden');
      bodyDev.classList.add('hidden');
    });

    tabDev.addEventListener('click', () => {
      tabDev.classList.add('active');
      tabGameplay.classList.remove('active');
      bodyDev.classList.remove('hidden');
      bodyGameplay.classList.add('hidden');
    });

    this.settingsModal.querySelectorAll('[data-warp]').forEach((el) => {
      el.addEventListener('click', () => {
        const target = el.getAttribute('data-warp') as BossId | 'hub';
        this.closeSettingsModal();
        this.handlers.onCloseSettings();
        this.handlers.onWarpBoss(target);
      });
    });

    this.settingsModal.querySelectorAll('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const preset = el.getAttribute('data-preset') as GraphicsPreset;
        const next = { ...settings, preset };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry);
      });
    });

    this.settingsModal.querySelectorAll('[data-fps]').forEach((el) => {
      el.addEventListener('click', () => {
        const fpsCap = Number(el.getAttribute('data-fps')) as FpsCap;
        const next = { ...settings, fpsCap };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry);
      });
    });

    this.settingsModal.querySelectorAll('[data-ctrl]').forEach((el) => {
      el.addEventListener('click', () => {
        const controlMode = el.getAttribute('data-ctrl') as ControlSchemeMode;
        const next = { ...settings, controlMode };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry);
      });
    });

    this.settingsModal.querySelector('#opt-fps')!.addEventListener('click', () => {
      const next = { ...settings, showFps: !settings.showFps };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next, player, boss, freezeTheta, telemetry);
    });

    this.settingsModal.querySelector('#opt-audio')!.addEventListener('click', () => {
      const next = { ...settings, audioEnabled: !settings.audioEnabled };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next, player, boss, freezeTheta, telemetry);
    });

    const sensInput = this.settingsModal.querySelector('#opt-sens') as HTMLInputElement;
    sensInput.addEventListener('input', () => {
      settings.sensitivity = Number(sensInput.value);
      this.handlers.onUpdateSettings({ ...settings });
    });

    this.settingsModal.querySelector('#dev-worked')?.addEventListener('click', () => {
      this.closeSettingsModal();
      this.handlers.onCloseSettings();
      this.handlers.onOpenWorkedExample();
    });
    this.settingsModal.querySelector('#dev-god')?.addEventListener('click', () => this.handlers.onToggleGodMode());
    this.settingsModal.querySelector('#dev-stam')?.addEventListener('click', () => this.handlers.onToggleInfiniteStamina());
    this.settingsModal.querySelector('#dev-freeze')?.addEventListener('click', () => this.handlers.onToggleFreezeTheta());
    this.settingsModal.querySelector('#dev-stagger')?.addEventListener('click', () => this.handlers.onForceStagger());

    this.settingsModal.querySelector('#opt-close')!.addEventListener('click', () => {
      this.closeSettingsModal();
      this.handlers.onCloseSettings();
    });
  }

  public showWorkedExample(snapshot: WorkedExampleSnapshot): void {
    this.workedModal.classList.remove('hidden');
    this.workedModal.innerHTML = `
      <div class="adventure-modal worked-card">
        <div class="title-crest">✧ DIFFERENTIAL CALCULUS ✧</div>
        <h2 class="worked-title">MATH 101 — LIVE WORKED EXAMPLE</h2>
        <p class="worked-sub">Computed live from current trigonometric wave state</p>
        <div class="worked-step">
          <span class="step-num">Step 1 · Active Boss Function</span>
          <code>${snapshot.functionFormula}</code>
        </div>
        <div class="worked-step">
          <span class="step-num">Step 2 · Exact Derivative Rule</span>
          <code>${snapshot.derivativeRule}</code>
        </div>
        <div class="worked-step">
          <span class="step-num">Step 3 · Evaluated at Angle θ</span>
          <div class="step-details">
            <code>θ = ${snapshot.thetaPiLabel}</code>
            <code>f(θ) = ${snapshot.evaluatedFunction.toFixed(3)}</code>
            <code>f′(θ) exact = ${snapshot.evaluatedSlope.toFixed(3)}</code>
            <code>numeric = ${snapshot.numericSlope.toFixed(3)}</code>
          </div>
          ${snapshot.isCriticalPoint ? '<div class="crit-badge">★ CRITICAL POINT f′(θ) ≈ 0: Maximum Stagger Window!</div>' : ''}
          ${snapshot.nearAsymptote ? '<div class="warn-badge">⚠ NEAR VERTICAL ASYMPTOTE: Extreme wave surge!</div>' : ''}
        </div>
        <div class="worked-step">
          <span class="step-num">Step 4 · Chosen Sigil & Strike Resolution</span>
          <div>Attuned Sigil: <strong>${snapshot.chosenSigilLabel}</strong> (${snapshot.isExactMatch ? 'MATCH' : 'MISMATCH'})</div>
          <div>Damage Multiplier: <strong>${snapshot.damageMultiplier.toFixed(2)}×</strong></div>
          <div style="font-size:13px;color:var(--adv-text-muted);margin-top:4px;">${snapshot.outcomeSummary}</div>
        </div>
        <div class="modal-footer">
          <button id="worked-close" class="adv-btn primary">Resume Combat</button>
        </div>
      </div>
    `;
    this.workedModal.querySelector('#worked-close')!.addEventListener('click', () => {
      this.workedModal.classList.add('hidden');
      this.handlers.onCloseWorkedExample();
    });
  }

  public updateHUD(
    player: PlayerState,
    boss: BossRuntime | null,
    pov: CameraPOV,
    settings: GameSettings,
    telemetry: TelemetrySnapshot,
    landmark: BiomeLandmark | null,
  ): void {
    // 1. Vitals
    const maxHp = computeEffectiveStat(player, 'maxHp');
    const maxStam = computeEffectiveStat(player, 'maxStamina');
    this.hpFill.style.width = `${Math.max(0, Math.min(100, (player.hp / maxHp) * 100))}%`;
    this.staminaFill.style.width = `${Math.max(0, Math.min(100, (player.stamina / maxStam) * 100))}%`;
    this.vitalsHpNum.textContent = `${Math.max(0, player.hp)}/${maxHp}`;
    this.root.querySelector('#flask-label')!.textContent = `${player.flasksRemaining}`;

    // 2. POV & FPS
    const povLabel = this.povBtn.querySelector('.btn-subtext') as HTMLElement;
    povLabel.textContent = pov === 'first' ? '1ST' : '3RD';
    this.fpReticle.classList.toggle('hidden', pov !== 'first');

    this.fpsBadge.classList.toggle('hidden', !settings.showFps);
    this.fpsBadge.textContent = `${telemetry.fps.toFixed(0)} FPS · ${PRESET_PROFILES[settings.preset].label}`;

    // 3. Active Sigil Medallion & 6-Pip Row
    const sigilMeta = SIGIL_BY_ID[player.selectedSigil];
    const medLabel = this.activeSigilPill.querySelector('#medallion-label') as HTMLElement;
    medLabel.textContent = sigilMeta.label;
    const medPath = this.activeSigilPill.querySelector('path') as SVGPathElement;
    medPath.setAttribute('d', SIGIL_SVG_PATHS[player.selectedSigil]);
    medPath.setAttribute('stroke', sigilMeta.accentHex);

    for (const [id, btn] of this.sigilPipButtons) {
      btn.classList.toggle('active', id === player.selectedSigil);
    }

    // 4. Region Banner update
    const isBossEngaged = !!boss && boss.phase !== 'IDLE_GUARD' && boss.phase !== 'DEFEATED';
    this.updateRegion(landmark, isBossEngaged);

    // 5. Boss Fight HUD
    if (isBossEngaged) {
      const cfg = BOSS_CONFIGS[boss.id];
      const fEval = evaluateTrig(boss.activeFunction, boss.theta);
      const dEval = evaluateExactDerivative(boss.activeFunction, boss.theta);
      const crit = isCriticalPoint(boss.activeFunction, boss.theta);

      this.bossHud.classList.remove('hidden');
      this.bossNameEl.textContent = `${cfg.name} · ${cfg.title}`;

      let statusText = 'Attuned Combat';
      if (boss.wardActive) statusText = 'Phase Ward Active';
      else if (boss.phase === 'STAGGERED') statusText = 'Staggered (Crest Shatter)';
      else if (boss.phase === 'ASYMPTOTE_SURGE') statusText = 'Asymptote Surge!';
      this.bossStatusEl.textContent = statusText;

      this.bossHpFill.style.width = `${Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100))}%`;
      this.bossStaggerFill.style.width = `${Math.max(0, Math.min(100, (boss.stagger / boss.maxStagger) * 100))}%`;

      const sign = dEval.value >= 0 ? '+' : '';
      this.equationRibbon.innerHTML = `
        <span class="eq-term">f(θ) = <strong>${boss.activeFunction}(θ)</strong></span>
        <span class="eq-sep">·</span>
        <span class="eq-term">θ = <strong>${formatThetaPi(boss.theta).split(' ')[0]}</strong></span>
        <span class="eq-sep">·</span>
        <span class="eq-term">f(θ) = <strong>${fEval.value.toFixed(2)}</strong></span>
        <span class="eq-sep">·</span>
        <span class="eq-term highlight">f′(θ) = <strong>${sign}${dEval.value.toFixed(2)}</strong></span>
        ${crit ? '<span class="eq-tag crit">★ f′≈0 CRITICAL</span>' : ''}
        ${dEval.nearAsymptote ? '<span class="eq-tag warn">⚠ ASYMPTOTE</span>' : ''}
      `;
    } else {
      this.bossHud.classList.add('hidden');
    }
  }
}
