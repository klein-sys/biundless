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
  evaluateNumericDerivative,
  evaluateTrig,
  formatThetaPi,
  isCriticalPoint,
  SIGIL_BY_ID,
  TRIG_DEFINITIONS,
  type DerivativeSigilId,
  type WorkedExampleSnapshot,
} from '../math/trigDerivatives';

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

export class GameUI {
  private readonly root: HTMLElement;
  private readonly handlers: UIHandlers;

  private titleOverlay!: HTMLElement;
  private settingsModal!: HTMLElement;
  private devDrawer!: HTMLElement;
  private workedModal!: HTMLElement;
  private radialWheel!: HTMLElement;
  private mobileControls!: HTMLElement;
  private fpReticle!: HTMLElement;
  private interactBanner!: HTMLElement;
  private combatToast!: HTMLElement;

  private hpFill!: HTMLElement;
  private staminaFill!: HTMLElement;
  private vitalsText!: HTMLElement;
  private povBtn!: HTMLElement;
  private fpsBadge!: HTMLElement;
  private bossHud!: HTMLElement;
  private bossNameEl!: HTMLElement;
  private bossPhaseEl!: HTMLElement;
  private bossHpFill!: HTMLElement;
  private bossStaggerFill!: HTMLElement;
  private mathPlaque!: HTMLElement;
  private sigilButtons = new Map<DerivativeSigilId, HTMLElement>();
  private telemetryEl!: HTMLElement;
  private toastTimeout: number | null = null;
  private devOpen = false;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="fantasy-panel player-vitals">
          <div class="vitals-header">
            <span>ASTRAL KNIGHT</span>
            <span id="flask-count">FLASKS: 3</span>
          </div>
          <div class="bar-track"><div id="hp-fill" class="bar-fill-hp" style="width:100%"></div></div>
          <div class="bar-track sm"><div id="stamina-fill" class="bar-fill-stamina" style="width:100%"></div></div>
          <div id="vitals-text" class="vitals-meta"><span>HP 160/160</span><span>SIGIL: cos θ</span></div>
        </div>

        <div class="top-right-controls interactive">
          <div id="fps-badge" class="fantasy-panel fps-badge">60 FPS</div>
          <button id="btn-pov" class="fantasy-btn icon-btn" title="Toggle 3rd/1st POV (V)">POV: 3RD</button>
          <button id="btn-boss-menu" class="fantasy-btn icon-btn" title="Quick Boss Select">BOSSES</button>
          <button id="btn-settings" class="fantasy-btn icon-btn" title="Graphics & FPS (Esc)">SETTINGS</button>
          <button id="btn-dev" class="fantasy-btn icon-btn" title="Dev & MATH 101 Demo (F9)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17m10-10 2.1-2.1"/>
            </svg>
            DEV
          </button>
        </div>
      </div>

      <div class="center-overlay">
        <svg id="fp-reticle" class="fp-reticle hidden" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="18" fill="none" stroke="#c8a464" stroke-width="1.2" stroke-dasharray="4 3"/>
          <circle cx="32" cy="32" r="2.2" fill="#ece3ce"/>
          <line x1="8" y1="32" x2="22" y2="32" stroke="#c8a464" stroke-width="1.2"/>
          <line x1="42" y1="32" x2="56" y2="32" stroke="#c8a464" stroke-width="1.2"/>
          <line x1="32" y1="8" x2="32" y2="22" stroke="#c8a464" stroke-width="1.2"/>
          <line x1="32" y1="42" x2="32" y2="56" stroke="#c8a464" stroke-width="1.2"/>
        </svg>
      </div>

      <div id="interact-banner" class="fantasy-panel interact-banner hidden"></div>
      <div id="combat-toast" class="fantasy-panel combat-toast"></div>

      <div class="hud-bottom">
        <div id="boss-hud" class="fantasy-panel boss-hud-wrap hidden">
          <div class="boss-title-row">
            <span id="boss-name" class="boss-name"></span>
            <span id="boss-phase" class="boss-phase-tag"></span>
          </div>
          <div class="boss-hp-track"><div id="boss-hp-fill" class="boss-hp-fill" style="width:100%"></div></div>
          <div class="boss-stagger-track"><div id="boss-stagger-fill" class="boss-stagger-fill" style="width:0%"></div></div>
          <div id="math-plaque" class="math-plaque"></div>
        </div>

        <div id="sigil-bar" class="fantasy-panel sigil-bar interactive"></div>
      </div>

      <div id="mobile-controls" class="mobile-controls hidden">
        <div id="touch-stick" class="touch-joystick-zone"><div id="touch-knob" class="touch-joystick-knob"></div></div>
        <div class="touch-actions">
          <button id="m-wheel" class="touch-btn">SIGILS</button>
          <button id="m-lock" class="touch-btn">LOCK</button>
          <button id="m-pov" class="touch-btn">POV</button>
          <button id="m-heal" class="touch-btn">HEAL</button>
          <button id="m-dodge" class="touch-btn">DODGE</button>
          <button id="m-cast" class="touch-btn primary">CAST</button>
          <button id="m-interact" class="touch-btn">GATE</button>
          <button id="m-attack" class="touch-btn primary" style="grid-column: span 2; width: 120px; border-radius: 28px;">STRIKE</button>
        </div>
      </div>

      <div id="radial-wheel" class="radial-wheel-backdrop hidden">
        <div id="radial-wheel-inner" class="radial-wheel">
          <div class="radial-center">DERIVATIVE<br/>ATTUNEMENT<br/><small style="color:#a69c86">0.2x Slow-Mo</small></div>
        </div>
      </div>

      <div id="dev-drawer" class="fantasy-panel dev-drawer hidden"></div>
      <div id="settings-modal" class="modal-backdrop hidden"></div>
      <div id="worked-modal" class="modal-backdrop hidden"></div>
      <div id="title-overlay" class="modal-backdrop"></div>
    `;

    this.hpFill = this.root.querySelector('#hp-fill')!;
    this.staminaFill = this.root.querySelector('#stamina-fill')!;
    this.vitalsText = this.root.querySelector('#vitals-text')!;
    this.povBtn = this.root.querySelector('#btn-pov')!;
    this.fpsBadge = this.root.querySelector('#fps-badge')!;
    this.bossHud = this.root.querySelector('#boss-hud')!;
    this.bossNameEl = this.root.querySelector('#boss-name')!;
    this.bossPhaseEl = this.root.querySelector('#boss-phase')!;
    this.bossHpFill = this.root.querySelector('#boss-hp-fill')!;
    this.bossStaggerFill = this.root.querySelector('#boss-stagger-fill')!;
    this.mathPlaque = this.root.querySelector('#math-plaque')!;
    this.fpReticle = this.root.querySelector('#fp-reticle')!;
    this.interactBanner = this.root.querySelector('#interact-banner')!;
    this.combatToast = this.root.querySelector('#combat-toast')!;
    this.mobileControls = this.root.querySelector('#mobile-controls')!;
    this.radialWheel = this.root.querySelector('#radial-wheel')!;
    this.devDrawer = this.root.querySelector('#dev-drawer')!;
    this.settingsModal = this.root.querySelector('#settings-modal')!;
    this.workedModal = this.root.querySelector('#worked-modal')!;
    this.titleOverlay = this.root.querySelector('#title-overlay')!;

    this.buildSigilBar();
    this.buildRadialWheel();
    this.buildTitleOverlay();
    this.bindTopButtons();
    this.bindMobileControls();
  }

  private buildSigilBar(): void {
    const bar = this.root.querySelector('#sigil-bar')!;
    DERIVATIVE_SIGILS.forEach((sigil, idx) => {
      const btn = document.createElement('button');
      btn.className = 'sigil-slot';
      btn.title = `${sigil.label} — ${sigil.hint} (Key ${idx + 1})`;
      btn.innerHTML = `
        <span class="sigil-key">${idx + 1}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${sigil.accentHex}" stroke-width="1.8">
          <path d="M3 16 C7 4, 11 4, 12 12 C13 20, 17 20, 21 8"/>
        </svg>
        <span class="sigil-formula">${sigil.label}</span>
        <span class="sigil-hint">d/dθ(${sigil.sourceFunction})</span>
      `;
      btn.addEventListener('click', () => this.handlers.onSelectSigil(sigil.id));
      bar.appendChild(btn);
      this.sigilButtons.set(sigil.id, btn);
    });
  }

  private buildRadialWheel(): void {
    const inner = this.root.querySelector('#radial-wheel-inner')!;
    const r = 108;
    DERIVATIVE_SIGILS.forEach((sigil, idx) => {
      const angle = (idx / DERIVATIVE_SIGILS.length) * Math.PI * 2 - Math.PI / 2;
      const node = document.createElement('button');
      node.className = 'fantasy-panel fantasy-btn radial-node';
      node.style.left = `${155 + Math.cos(angle) * r}px`;
      node.style.top = `${155 + Math.sin(angle) * r}px`;
      node.innerHTML = `<span style="color:${sigil.accentHex};font-family:var(--font-mono)">${sigil.label}</span><small style="font-size:9px;color:var(--parchment-muted)">d(${sigil.sourceFunction})</small>`;
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
      <div class="fantasy-panel modal-card">
        <h1 class="modal-title">ASHEN TANGENT</h1>
        <p class="modal-subtitle">Chronicles of the Derivative — MATH 101 Differential Calculus RPG</p>
        <p style="font-size:15px;line-height:1.45;color:var(--parchment);margin-bottom:14px;">
          Bosses channel live trigonometric waves <strong>f(θ)</strong>. Attune your Resonance Blade to the matching
          instantaneous derivative <strong>f′(θ)</strong> to shatter Phase Wards and trigger Critical Stagger.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:var(--parchment-muted);margin-bottom:16px;">
          <div><strong style="color:var(--brass)">Desktop:</strong> WASD Move · Mouse Look · LMB Strike · RMB/E Cast Sigil · 1–6 / Q Wheel · V POV · Tab Lock · Space Dodge</div>
          <div><strong style="color:var(--brass)">Mobile:</strong> Left Stick Move · Right Drag Look · Thumb Action Buttons · Sigils Slow-Mo Wheel</div>
        </div>
        <div class="btn-group" style="justify-content:center;">
          <button id="start-hub-btn" class="fantasy-btn active" style="padding:11px 22px;font-size:13px;">Enter Ruined Sanctuary</button>
          <button id="start-witch-btn" class="fantasy-btn">Witch (sin/cos)</button>
          <button id="start-lich-btn" class="fantasy-btn">Lich (tan/cot)</button>
          <button id="start-dragon-btn" class="fantasy-btn">Dragon (sec/csc)</button>
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

  private bindTopButtons(): void {
    this.povBtn.addEventListener('click', () => this.handlers.onTogglePov());
    this.root.querySelector('#btn-dev')!.addEventListener('click', () => this.toggleDevDrawer());
    this.root.querySelector('#btn-settings')!.addEventListener('click', () => {
      if (this.settingsModal.classList.contains('hidden')) {
        this.handlers.onOpenSettings();
      } else {
        this.closeSettingsModal();
        this.handlers.onCloseSettings();
      }
    });
    this.root.querySelector('#btn-boss-menu')!.addEventListener('click', () => {
      this.titleOverlay.classList.toggle('hidden');
    });
  }

  private bindMobileControls(): void {
    const stick = this.root.querySelector('#touch-stick') as HTMLElement;
    const knob = this.root.querySelector('#touch-knob') as HTMLElement;
    let stickTouchId: number | null = null;
    const maxRadius = 46;

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
    mapBtn('#m-heal', () => this.handlers.onTouchAction('heal'));
    mapBtn('#m-pov', () => this.handlers.onTogglePov());
    mapBtn('#m-lock', () => this.handlers.onToggleLockOn());
    mapBtn('#m-interact', () => this.handlers.onTouchAction('interact'));
    mapBtn('#m-wheel', () => this.handlers.onOpenWheel());
  }

  public setMobileControlsVisible(visible: boolean): void {
    this.mobileControls.classList.toggle('hidden', !visible);
  }

  public setRadialWheelVisible(visible: boolean): void {
    this.radialWheel.classList.toggle('hidden', !visible);
  }

  public toggleDevDrawer(): boolean {
    this.devOpen = !this.devOpen;
    this.devDrawer.classList.toggle('hidden', !this.devOpen);
    return this.devOpen;
  }

  public closeSettingsModal(): void {
    this.settingsModal.classList.add('hidden');
  }

  public isModalOpen(): boolean {
    return (
      !this.titleOverlay.classList.contains('hidden') ||
      !this.settingsModal.classList.contains('hidden') ||
      !this.workedModal.classList.contains('hidden')
    );
  }

  public showToast(msg: string): void {
    this.combatToast.textContent = msg;
    this.combatToast.classList.add('visible');
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      this.combatToast.classList.remove('visible');
    }, 1900);
  }

  public openSettingsModal(settings: GameSettings): void {
    this.settingsModal.classList.remove('hidden');
    const presets: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
    const fpsCaps: FpsCap[] = [30, 60, 120, 0];
    const controls: ControlSchemeMode[] = ['auto', 'desktop', 'mobile'];

    this.settingsModal.innerHTML = `
      <div class="fantasy-panel modal-card">
        <h2 class="modal-title" style="font-size:18px;">SANCTUARY SETTINGS</h2>
        <div class="form-row">
          <span>Graphics Quality</span>
          <div class="btn-group">
            ${presets
              .map(
                (p) =>
                  `<button data-preset="${p}" class="fantasy-btn ${settings.preset === p ? 'active' : ''}">${PRESET_PROFILES[p].label}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="form-row">
          <span>Target Frame Rate</span>
          <div class="btn-group">
            ${fpsCaps
              .map(
                (f) =>
                  `<button data-fps="${f}" class="fantasy-btn ${settings.fpsCap === f ? 'active' : ''}">${f === 0 ? 'Unlimited' : `${f} FPS`}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="form-row">
          <span>Control Layout</span>
          <div class="btn-group">
            ${controls
              .map(
                (c) =>
                  `<button data-ctrl="${c}" class="fantasy-btn ${settings.controlMode === c ? 'active' : ''}">${c.toUpperCase()}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="form-row">
          <span>FPS Counter</span>
          <button id="opt-show-fps" class="fantasy-btn ${settings.showFps ? 'active' : ''}">${settings.showFps ? 'SHOWN' : 'HIDDEN'}</button>
        </div>
        <div class="form-row">
          <span>Web Audio Synth</span>
          <button id="opt-audio" class="fantasy-btn ${settings.audioEnabled ? 'active' : ''}">${settings.audioEnabled ? 'ENABLED' : 'MUTED'}</button>
        </div>
        <div class="form-row">
          <span>Camera Sensitivity (${settings.sensitivity.toFixed(1)}x)</span>
          <input id="opt-sens" type="range" min="0.4" max="2.2" step="0.1" value="${settings.sensitivity}" />
        </div>
        <div style="text-align:right;margin-top:16px;">
          <button id="opt-close" class="fantasy-btn active">Resume</button>
        </div>
      </div>
    `;

    this.settingsModal.querySelectorAll('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const preset = el.getAttribute('data-preset') as GraphicsPreset;
        const next = { ...settings, preset };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next);
      });
    });

    this.settingsModal.querySelectorAll('[data-fps]').forEach((el) => {
      el.addEventListener('click', () => {
        const fpsCap = Number(el.getAttribute('data-fps')) as FpsCap;
        const next = { ...settings, fpsCap };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next);
      });
    });

    this.settingsModal.querySelectorAll('[data-ctrl]').forEach((el) => {
      el.addEventListener('click', () => {
        const controlMode = el.getAttribute('data-ctrl') as ControlSchemeMode;
        const next = { ...settings, controlMode };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next);
      });
    });

    this.settingsModal.querySelector('#opt-show-fps')!.addEventListener('click', () => {
      const next = { ...settings, showFps: !settings.showFps };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next);
    });

    this.settingsModal.querySelector('#opt-audio')!.addEventListener('click', () => {
      const next = { ...settings, audioEnabled: !settings.audioEnabled };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next);
    });

    const sensInput = this.settingsModal.querySelector('#opt-sens') as HTMLInputElement;
    sensInput.addEventListener('input', () => {
      settings.sensitivity = Number(sensInput.value);
      this.handlers.onUpdateSettings({ ...settings });
    });

    this.settingsModal.querySelector('#opt-close')!.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
      this.handlers.onCloseSettings();
    });
  }

  public showWorkedExample(snapshot: WorkedExampleSnapshot): void {
    this.workedModal.classList.remove('hidden');
    this.workedModal.innerHTML = `
      <div class="fantasy-panel modal-card">
        <h2 class="modal-title" style="font-size:18px;">MATH 101 — WORKED EXAMPLE</h2>
        <p class="modal-subtitle">Live Differential Calculus Evaluation from Combat State</p>
        <div class="worked-step"><strong>1. Active Boss Function:</strong><br/><code>${snapshot.functionFormula}</code></div>
        <div class="worked-step"><strong>2. Derivative Rule Applied:</strong><br/><code>${snapshot.derivativeRule}</code></div>
        <div class="worked-step"><strong>3. Evaluated at Current Angle θ:</strong><br/>
          <code>θ = ${snapshot.thetaPiLabel}</code><br/>
          <code>f(θ) = ${snapshot.evaluatedFunction.toFixed(4)}</code> ·
          <code>f′(θ) exact = ${snapshot.evaluatedSlope.toFixed(4)}</code> ·
          <code>numeric = ${snapshot.numericSlope.toFixed(4)}</code>
          ${snapshot.isCriticalPoint ? '<br/><span class="math-badge-crit">Critical Point: f′(θ) ≈ 0 (Maximum Stagger Window)</span>' : ''}
          ${snapshot.nearAsymptote ? '<br/><span class="math-badge-warn">Near Vertical Asymptote: Rate of change spikes!</span>' : ''}
        </div>
        <div class="worked-step"><strong>4. Player Choice & Gameplay Outcome:</strong><br/>
          Sigil: <code>${snapshot.chosenSigilLabel}</code> (${snapshot.isExactMatch ? 'EXACT MATCH' : 'MISMATCH'}) ·
          Multiplier: <code>${snapshot.damageMultiplier.toFixed(2)}×</code><br/>
          <span>${snapshot.outcomeSummary}</span>
        </div>
        <div style="text-align:right;margin-top:12px;">
          <button id="worked-close" class="fantasy-btn active">Resume Fight</button>
        </div>
      </div>
    `;
    this.workedModal.querySelector('#worked-close')!.addEventListener('click', () => {
      this.workedModal.classList.add('hidden');
      this.handlers.onCloseWorkedExample();
    });
  }

  public renderDevDrawer(
    player: PlayerState,
    boss: BossRuntime | null,
    freezeTheta: boolean,
    telemetry: TelemetrySnapshot,
  ): void {
    if (!this.devOpen) return;

    const fn = boss ? boss.activeFunction : 'sin';
    const theta = boss ? boss.theta : 0;
    const fVal = evaluateTrig(fn, theta).value;
    const dExact = evaluateExactDerivative(fn, theta).value;
    const dNum = evaluateNumericDerivative(fn, theta);

    // Only rebuild structure when closed/opened or periodically; keep telemetry lightweight
    if (!this.telemetryEl || this.devDrawer.children.length === 0) {
      this.devDrawer.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-family:var(--font-display);color:var(--brass);letter-spacing:0.1em;">DEV & DEMO INSPECTOR</strong>
          <button id="dev-close" class="fantasy-btn" style="padding:3px 8px;">✕</button>
        </div>
        <div class="dev-section-title">Arena / Boss Warp</div>
        <div class="btn-group">
          <button data-warp="hub" class="fantasy-btn">Hub</button>
          <button data-warp="witch" class="fantasy-btn">Witch</button>
          <button data-warp="lich" class="fantasy-btn">Lich</button>
          <button data-warp="dragon" class="fantasy-btn">Dragon</button>
        </div>
        <div class="dev-section-title">Combat & Calculus Toggles</div>
        <div class="btn-group">
          <button id="dev-god" class="fantasy-btn">God Mode</button>
          <button id="dev-stam" class="fantasy-btn">Inf Stamina</button>
          <button id="dev-freeze" class="fantasy-btn">Freeze θ</button>
          <button id="dev-stagger" class="fantasy-btn">Force Stagger</button>
        </div>
        <div class="dev-section-title">MATH 101 Class Presentation</div>
        <button id="dev-worked" class="fantasy-btn active" style="width:100%;">Open Worked Example Overlay</button>
        <div class="dev-section-title">Live Telemetry</div>
        <div id="dev-telemetry" class="telemetry-grid"></div>
      `;
      this.telemetryEl = this.devDrawer.querySelector('#dev-telemetry')!;
      this.devDrawer.querySelector('#dev-close')!.addEventListener('click', () => this.toggleDevDrawer());
      this.devDrawer.querySelectorAll('[data-warp]').forEach((b) => {
        b.addEventListener('click', () =>
          this.handlers.onWarpBoss(b.getAttribute('data-warp') as BossId | 'hub'),
        );
      });
      this.devDrawer.querySelector('#dev-god')!.addEventListener('click', () => this.handlers.onToggleGodMode());
      this.devDrawer.querySelector('#dev-stam')!.addEventListener('click', () =>
        this.handlers.onToggleInfiniteStamina(),
      );
      this.devDrawer.querySelector('#dev-freeze')!.addEventListener('click', () =>
        this.handlers.onToggleFreezeTheta(),
      );
      this.devDrawer.querySelector('#dev-stagger')!.addEventListener('click', () =>
        this.handlers.onForceStagger(),
      );
      this.devDrawer.querySelector('#dev-worked')!.addEventListener('click', () =>
        this.handlers.onOpenWorkedExample(),
      );
    }

    this.devDrawer.querySelector('#dev-god')?.classList.toggle('active', player.godMode);
    this.devDrawer.querySelector('#dev-stam')?.classList.toggle('active', player.infiniteStamina);
    this.devDrawer.querySelector('#dev-freeze')?.classList.toggle('active', freezeTheta);

    this.telemetryEl.innerHTML = `
      <div>FPS: ${telemetry.fps.toFixed(0)}</div>
      <div>Frame: ${telemetry.frameMs.toFixed(1)} ms</div>
      <div>Draws: ${telemetry.drawCalls}</div>
      <div>Tris: ${telemetry.triangles}</div>
      <div>f(θ): ${fn}(${theta.toFixed(2)})</div>
      <div>val: ${fVal.toFixed(3)}</div>
      <div>f′ exact: ${dExact.toFixed(3)}</div>
      <div>f′ num: ${dNum.toFixed(3)}</div>
    `;
  }

  public updateHUD(
    player: PlayerState,
    boss: BossRuntime | null,
    pov: CameraPOV,
    settings: GameSettings,
    telemetry: TelemetrySnapshot,
    nearbyGateBoss: BossId | null,
    freezeTheta = false,
  ): void {
    const maxHp = computeEffectiveStat(player, 'maxHp');
    const maxStam = computeEffectiveStat(player, 'maxStamina');
    this.hpFill.style.width = `${(player.hp / maxHp) * 100}%`;
    this.staminaFill.style.width = `${(player.stamina / maxStam) * 100}%`;
    this.root.querySelector('#flask-count')!.textContent = `FLASKS: ${player.flasksRemaining}`;

    const sigilMeta = SIGIL_BY_ID[player.selectedSigil];
    this.vitalsText.innerHTML = `<span>HP ${player.hp}/${maxHp}</span><span style="color:${sigilMeta.accentHex}">SIGIL: ${sigilMeta.label}</span>`;

    this.povBtn.textContent = `POV: ${pov === 'first' ? '1ST' : '3RD'}`;
    this.fpReticle.classList.toggle('hidden', pov !== 'first');

    this.fpsBadge.classList.toggle('hidden', !settings.showFps);
    this.fpsBadge.textContent = `${telemetry.fps.toFixed(0)} FPS · ${PRESET_PROFILES[settings.preset].label.toUpperCase()}`;

    for (const [id, el] of this.sigilButtons) {
      el.classList.toggle('selected', id === player.selectedSigil);
    }

    if (nearbyGateBoss && !boss) {
      const cfg = BOSS_CONFIGS[nearbyGateBoss];
      this.interactBanner.classList.remove('hidden');
      this.interactBanner.innerHTML = `FOG GATE: <strong style="color:var(--brass)">${cfg.name}, ${cfg.title}</strong> — Press <strong>F</strong> or <strong>GATE</strong> to Enter`;
    } else {
      this.interactBanner.classList.add('hidden');
    }

    if (boss) {
      const cfg = BOSS_CONFIGS[boss.id];
      const def = TRIG_DEFINITIONS[boss.activeFunction];
      const fEval = evaluateTrig(boss.activeFunction, boss.theta);
      const dEval = evaluateExactDerivative(boss.activeFunction, boss.theta);
      const crit = isCriticalPoint(boss.activeFunction, boss.theta);

      this.bossHud.classList.remove('hidden');
      this.bossNameEl.textContent = `${cfg.name}, ${cfg.title}`;
      this.bossPhaseEl.textContent = boss.wardActive ? 'PHASE WARD ACTIVE' : boss.phase;
      this.bossHpFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      this.bossStaggerFill.style.width = `${(boss.stagger / boss.maxStagger) * 100}%`;

      this.mathPlaque.innerHTML = `
        <span><strong>${def.formula}</strong></span>
        <span>θ = ${formatThetaPi(boss.theta)}</span>
        <span>f(θ) = ${fEval.value.toFixed(2)}</span>
        <span>f′(θ) = ${dEval.value.toFixed(2)}</span>
        ${
          crit
            ? '<span class="math-badge-crit">CRITICAL POINT (f′≈0): MAX STAGGER!</span>'
            : dEval.nearAsymptote
              ? '<span class="math-badge-warn">ASYMPTOTE SURGE!</span>'
              : ''
        }
      `;
    } else {
      this.bossHud.classList.add('hidden');
    }

    this.renderDevDrawer(player, boss, freezeTheta, telemetry);
  }
}
