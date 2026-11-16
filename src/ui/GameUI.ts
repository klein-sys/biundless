import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import type { BossRuntime } from '../bosses/bossAI';
import type { CameraPOV } from '../camera/DualCameraController';
import type { PlayerState } from '../combat/resonanceCombat';
import { computeEffectiveStat } from '../combat/resonanceCombat';
import {
  PRESET_PROFILES,
  loadSettings,
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
  generateWavePlotData,
  isCriticalPoint,
  SIGIL_BY_ID,
  type DerivativeSigilId,
  type WorkedExampleSnapshot,
} from '../math/trigDerivatives';
import type { BiomeLandmark } from '../world/SunlitValley';
import type { DialogueChoice, DialogueNode } from '../dialogue/dialogueData';
import {
  getInventoryCount,
  getLevelProgressFraction,
  hasSavedProgression,
  getProgressionSummary,
  loadProgression,
  resetProgression,
  type ProgressionState,
} from '../rpg/progressionSystem';
import { InteractiveAtlas, worldToMapNormalized } from './InteractiveAtlas';
import { fullscreenManager } from './FullscreenManager';

export interface TelemetrySnapshot {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

export interface UIHandlers {
  onStartGame: (isNewGame?: boolean) => void;
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
  onInteract?: () => void;
  onSaveProgress?: () => void;
  onReturnToTown?: () => void;
  onQuitToTitle?: () => void;
  onOpenAtlas?: () => void;
  onCloseAtlas?: () => void;
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
  private levelBadge!: HTMLElement;
  private xpFill!: HTMLElement;
  private flaskPill!: HTMLElement;
  private povBtn!: HTMLElement;
  private menuBtn!: HTMLElement;
  private fullscreenBtn!: HTMLElement;
  private fpsBadge!: HTMLElement;

  private interactPrompt!: HTMLElement;
  private interactLabel!: HTMLElement;
  private dialogueCard!: HTMLElement;
  private dialoguePortrait!: HTMLElement;
  private dialogueSpeakerName!: HTMLElement;
  private dialogueSpeakerTitle!: HTMLElement;
  private dialogueLvl!: HTMLElement;
  private dialoguePoints!: HTMLElement;
  private dialogueBody!: HTMLElement;
  private dialogueChoices!: HTMLElement;
  private mTalkBtn!: HTMLElement;

  private bossHud!: HTMLElement;
  private bossNameEl!: HTMLElement;
  private bossStatusEl!: HTMLElement;
  private bossHpFill!: HTMLElement;
  private bossStaggerFill!: HTMLElement;
  private equationRibbon!: HTMLElement;

  private cutsceneOverlay!: HTMLElement;
  private cutsceneBossName!: HTMLElement;
  private cutsceneBossTitle!: HTMLElement;
  private cutsceneBossFormula!: HTMLElement;
  private cutsceneFinishCb: (() => void) | null = null;

  private hudTopLeft!: HTMLElement;
  private hudTopRight!: HTMLElement;
  private hudBottomRight!: HTMLElement;

  private activeSigilPill!: HTMLElement;
  private sigilPipButtons = new Map<DerivativeSigilId, HTMLElement>();

  private toastTimeout: number | null = null;
  private currentRegionId: string | null = null;
  private regionFadeTimeout: number | null = null;

  private titleView: 'main' | 'settings' = 'main';
  private currentSettings: GameSettings;

  private atlas!: InteractiveAtlas;
  private minimapContainer!: HTMLElement;
  private minimapCanvas!: HTMLCanvasElement;
  private mHealBadge!: HTMLElement;
  private lastKnownPlayerPos = { x: 0, z: 0 };
  private lastKnownPlayerYaw = Math.PI;
  private lastKnownProgression?: ProgressionState;

  constructor(root: HTMLElement, handlers: UIHandlers, initialSettings?: GameSettings) {
    this.root = root;
    this.handlers = handlers;
    this.currentSettings = initialSettings ?? loadSettings();
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <!-- Top Left: Minimap Radar & Minimal Sleek Vitals -->
      <div class="hud-top-left interactive">
        <div id="minimap-container" class="minimap-container" title="Open Sunlit Valley Atlas (M / Tap)">
          <canvas id="minimap-canvas" class="minimap-canvas" width="160" height="160"></canvas>
          <div class="minimap-compass-ring">
            <span class="minimap-compass-n">N</span>
          </div>
          <button id="minimap-expand-btn" class="minimap-expand-btn" aria-label="Expand Atlas">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>
        </div>
        <div class="vitals-pod">
          <div class="vitals-row">
            <span class="hero-name">SPELLBLADE</span>
            <span id="hp-num" class="vitals-num">160/160</span>
          </div>
          <div class="bar-pill hp-track"><div id="hp-fill" class="bar-fill hp" style="width:100%"></div></div>
          <div class="bar-pill stam-track"><div id="stamina-fill" class="bar-fill stam" style="width:100%"></div></div>
          <div class="hero-level-badge">
            <span id="level-badge" class="level-tag">LVL 1</span>
            <div class="xp-mini-track"><div id="xp-fill" class="xp-fill" style="width:0%"></div></div>
          </div>
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

      <!-- Top Right: Icon Buttons + Optional FPS -->
      <div class="hud-top-right interactive">
        <div id="fps-badge" class="fps-pill hidden">60 FPS</div>
        <button id="btn-fullscreen" class="circle-btn" title="Toggle Fullscreen (F11 / Tap)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
          <span class="btn-subtext">FULL</span>
        </button>
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

      <!-- Mobile Touch Controls: MOBA-Inspired Thumb Arc & Utility Bar -->
      <div id="mobile-controls" class="mobile-controls hidden">
        <!-- Left: Compass-Ring Analog Joystick -->
        <div id="touch-stick" class="touch-joystick-zone">
          <div class="joystick-compass-mark n">▲</div>
          <div class="joystick-compass-mark s">▼</div>
          <div class="joystick-compass-mark w">◀</div>
          <div class="joystick-compass-mark e">▶</div>
          <div id="touch-knob" class="touch-joystick-knob">
            <div class="knob-gem"></div>
          </div>
        </div>

        <!-- Bottom Center: Horizontal Utility Bar (Town Warp, Heal, Talk, Sigil Wheel) -->
        <div id="mobile-utility-bar" class="mobile-utility-bar">
          <button id="m-town" class="m-util-btn" aria-label="Return to Solstice Haven">
            <div class="m-util-icon">🏛️</div>
            <span class="m-util-label">TOWN</span>
          </button>
          <button id="m-heal" class="m-util-btn" aria-label="Heal Flask">
            <div class="m-util-icon">🧪</div>
            <span id="m-heal-badge" class="m-util-badge">3</span>
            <span class="m-util-label">HEAL</span>
          </button>
          <button id="m-talk" class="m-util-btn talk hidden" aria-label="Interact / Talk">
            <div class="m-util-icon">💬</div>
            <span class="m-util-label">TALK</span>
          </button>
          <button id="m-wheel" class="m-util-btn" aria-label="Attunement Wheel">
            <div class="m-util-icon">⚙️</div>
            <span class="m-util-label">SIGIL</span>
          </button>
        </div>

        <!-- Bottom Right: Swept Thumb-Arc Cluster -->
        <div id="mobile-combat-arc" class="touch-combat-cluster">
          <!-- Primary Strike: Anchored prominently at right thumb rest -->
          <button id="m-attack" class="touch-arc-btn strike" aria-label="Basic Strike">
            <div class="arc-btn-bg"></div>
            <span class="arc-btn-title">STRIKE</span>
          </button>

          <!-- Swept Radial Orbit: DASH, CAST, JUMP, LOCK -->
          <button id="m-dodge" class="touch-arc-btn dash" aria-label="Dash / Dodge">
            <span class="arc-icon">💨</span>
            <span class="arc-label">DASH</span>
          </button>
          <button id="m-cast" class="touch-arc-btn cast" aria-label="Resonance Burst">
            <span class="arc-icon">⚡</span>
            <span class="arc-label">CAST</span>
          </button>
          <button id="m-jump" class="touch-arc-btn jump" aria-label="Jump">
            <span class="arc-icon">▲</span>
            <span class="arc-label">JUMP</span>
          </button>
          <button id="m-lock" class="touch-arc-btn lock" aria-label="Lock-On Target">
            <span class="arc-icon">🎯</span>
            <span class="arc-label">LOCK</span>
          </button>
        </div>
      </div>

      <!-- Proximity Interaction Prompt -->
      <div id="interact-prompt" class="interact-prompt hidden interactive">
        <span class="key-badge">F</span>
        <span id="interact-label" class="interact-label">Talk</span>
      </div>

      <!-- Interactive Dialogue & Quest Overlay -->
      <div id="dialogue-card" class="dialogue-card hidden interactive">
        <div class="dialogue-top">
          <div id="dialogue-portrait" class="dialogue-portrait">🧙‍♂️</div>
          <div class="dialogue-speaker-meta">
            <span id="dialogue-speaker-name" class="dialogue-speaker-name">Archmage Aurelius</span>
            <span id="dialogue-speaker-title" class="dialogue-speaker-title">Guardian of the Astrolabe</span>
          </div>
          <div id="dialogue-astral-vitals" class="dialogue-astral-vitals">
            <span id="dialogue-lvl" class="astral-badge">Level 1</span>
            <span id="dialogue-points" class="astral-badge">0 Points</span>
          </div>
        </div>
        <div id="dialogue-body" class="dialogue-body"></div>
        <div id="dialogue-choices" class="dialogue-choices"></div>
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

      <!-- Modals: Settings/Menu, Worked Example, Title Sidebar -->
      <div id="settings-modal" class="modal-backdrop hidden"></div>
      <div id="worked-modal" class="modal-backdrop hidden"></div>
      <aside id="title-overlay" class="title-sidebar-overlay"></aside>

      <!-- Cinematic Boss Encounter Cutscene Overlay -->
      <div id="cutscene-overlay" class="cutscene-overlay hidden">
        <div class="cutscene-letterbox top"></div>
        <div class="cutscene-letterbox bottom"></div>
        <div id="boss-cutscene-banner" class="boss-cutscene-banner">
          <div class="cutscene-crest">✧ SANCTUARY DOMAIN BREACHED ✧</div>
          <h1 id="cutscene-boss-name" class="cutscene-boss-name">VESPERA</h1>
          <div id="cutscene-boss-title" class="cutscene-boss-title">Witch of the Sine Hollow · Sovereign of Phase Harmonics</div>
          <div id="cutscene-boss-formula" class="cutscene-boss-formula">Active Harmonic: f(θ) = sin(θ)</div>
          <div class="cutscene-skip-badge">PRESS [SPACE] OR CLICK TO ENGAGE</div>
        </div>
      </div>
    `;

    this.hpFill = this.root.querySelector('#hp-fill')!;
    this.staminaFill = this.root.querySelector('#stamina-fill')!;
    this.vitalsHpNum = this.root.querySelector('#hp-num')!;
    this.levelBadge = this.root.querySelector('#level-badge')!;
    this.xpFill = this.root.querySelector('#xp-fill')!;
    this.flaskPill = this.root.querySelector('#flask-pill')!;
    this.povBtn = this.root.querySelector('#btn-pov')!;
    this.menuBtn = this.root.querySelector('#btn-menu')!;
    this.fullscreenBtn = this.root.querySelector('#btn-fullscreen')!;
    this.fpsBadge = this.root.querySelector('#fps-badge')!;

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => {
        fullscreenManager.toggle();
      });
      fullscreenManager.onChange((isFullscreen) => {
        const sub = this.fullscreenBtn.querySelector('.btn-subtext');
        if (sub) sub.textContent = isFullscreen ? 'EXIT' : 'FULL';
        this.fullscreenBtn.title = isFullscreen ? 'Exit Fullscreen' : 'Toggle Fullscreen (F11 / Tap)';
      });
    }

    this.interactPrompt = this.root.querySelector('#interact-prompt')!;
    this.interactLabel = this.root.querySelector('#interact-label')!;
    this.dialogueCard = this.root.querySelector('#dialogue-card')!;
    this.dialoguePortrait = this.root.querySelector('#dialogue-portrait')!;
    this.dialogueSpeakerName = this.root.querySelector('#dialogue-speaker-name')!;
    this.dialogueSpeakerTitle = this.root.querySelector('#dialogue-speaker-title')!;
    this.dialogueLvl = this.root.querySelector('#dialogue-lvl')!;
    this.dialoguePoints = this.root.querySelector('#dialogue-points')!;
    this.dialogueBody = this.root.querySelector('#dialogue-body')!;
    this.dialogueChoices = this.root.querySelector('#dialogue-choices')!;
    this.mTalkBtn = this.root.querySelector('#m-talk')!;

    this.interactPrompt.addEventListener('click', () => {
      this.handlers.onInteract?.();
    });
    this.mTalkBtn.addEventListener('click', () => {
      this.handlers.onInteract?.();
    });

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

    this.hudTopLeft = this.root.querySelector('.hud-top-left')!;
    this.hudTopRight = this.root.querySelector('.hud-top-right')!;
    this.hudBottomRight = this.root.querySelector('.hud-bottom-right')!;

    this.activeSigilPill = this.root.querySelector('#active-medallion')!;
    this.mobileControls = this.root.querySelector('#mobile-controls')!;
    this.radialWheel = this.root.querySelector('#radial-wheel')!;
    this.settingsModal = this.root.querySelector('#settings-modal')!;
    this.workedModal = this.root.querySelector('#worked-modal')!;
    this.titleOverlay = this.root.querySelector('#title-overlay')!;

    this.cutsceneOverlay = this.root.querySelector('#cutscene-overlay')!;
    this.cutsceneBossName = this.root.querySelector('#cutscene-boss-name')!;
    this.cutsceneBossTitle = this.root.querySelector('#cutscene-boss-title')!;
    this.cutsceneBossFormula = this.root.querySelector('#cutscene-boss-formula')!;
    this.cutsceneOverlay.addEventListener('click', () => {
      this.hideBossCutscene();
    });

    this.minimapContainer = this.root.querySelector('#minimap-container')!;
    this.minimapCanvas = this.root.querySelector('#minimap-canvas')! as HTMLCanvasElement;
    this.mHealBadge = this.root.querySelector('#m-heal-badge')!;

    this.atlas = new InteractiveAtlas(
      {
        onWarp: (landmarkId) => {
          this.handlers.onWarpBoss(landmarkId);
        },
        onClose: () => {
          this.handlers.onCloseAtlas?.();
        },
      },
      this.root,
    );

    const openAtlasFn = () => {
      this.openAtlas(this.lastKnownPlayerPos, this.lastKnownPlayerYaw, this.lastKnownProgression);
    };
    if (this.minimapContainer) {
      this.minimapContainer.addEventListener('click', openAtlasFn);
    }
    const expandBtn = this.root.querySelector('#minimap-expand-btn');
    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAtlasFn();
      });
    }

    this.buildSigilPips();
    this.buildRadialWheel();
    this.buildTitleOverlay();
    this.bindTopControls();
    this.bindMobileControls();
    this.setHUDVisible(false);
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

  public setHUDVisible(visible: boolean): void {
    if (this.hudTopLeft) this.hudTopLeft.classList.toggle('hud-hidden', !visible);
    if (this.hudTopRight) this.hudTopRight.classList.toggle('hud-hidden', !visible);
    if (this.hudBottomRight) this.hudBottomRight.classList.toggle('hud-hidden', !visible);
    if (this.minimapContainer) this.minimapContainer.classList.toggle('hud-hidden', !visible);
    if (this.pointerHint) this.pointerHint.classList.toggle('hidden', !visible);
    if (this.bossHud) this.bossHud.classList.toggle('hud-hidden', !visible);
    if (this.mobileControls) this.mobileControls.classList.toggle('hud-hidden', !visible);
    if (this.regionBanner) this.regionBanner.classList.toggle('hidden', !visible);
    if (this.fpReticle) this.fpReticle.classList.toggle('hidden', !visible);
    if (this.interactPrompt && !visible) this.interactPrompt.classList.add('hidden');
    if (this.combatToast && !visible) this.combatToast.classList.add('hidden');
  }

  public isTitleSettingsOpen(): boolean {
    return !this.titleOverlay.classList.contains('hidden') && this.titleView === 'settings';
  }

  public getTitleView(): 'main' | 'settings' {
    return this.titleView;
  }

  public showTitleMainView(): void {
    this.titleView = 'main';
    this.buildTitleOverlay();
  }

  public openTitleSettings(): void {
    this.titleView = 'settings';
    this.buildTitleOverlay();
  }

  public showTitleOverlay(settings?: GameSettings): void {
    if (settings) {
      this.currentSettings = { ...settings };
    }
    this.setHUDVisible(false);
    this.titleView = 'main';
    this.buildTitleOverlay();
    this.titleOverlay.classList.remove('hidden');
  }

  public syncSettings(settings: GameSettings): void {
    this.currentSettings = { ...settings };
    if (this.titleView === 'settings' && !this.titleOverlay.classList.contains('hidden')) {
      this.renderTitleSettingsView();
    }
  }

  public isWorkedExampleOpen(): boolean {
    return !this.workedModal.classList.contains('hidden');
  }

  public closeWorkedExample(): void {
    this.workedModal.classList.add('hidden');
  }

  public buildTitleOverlay(): void {
    if (this.titleView === 'settings') {
      this.renderTitleSettingsView();
    } else {
      this.renderTitleMainView();
    }
  }

  private renderTitleMainView(): void {
    const hasSave = hasSavedProgression();
    const saveSummary = hasSave ? getProgressionSummary(loadProgression()) : '';

    this.titleOverlay.innerHTML = `
      <div class="title-sidebar-content">
        <div class="title-card sidebar-view-pane">
          <div class="title-crest">✧ SUNLIT CHRONICLES ✧</div>
          <h1 class="title-main">ASHEN TANGENT</h1>
          <p class="title-sub">MATH 101 Differential Calculus Open-World Adventure RPG</p>
          <p class="title-desc">
            Explore the vibrant rolling Sunlit Valley. Bosses channel live trigonometric functions <strong>f(θ)</strong>.
            Attune your blade to their instantaneous derivative <strong>f′(θ)</strong> to break crystalline Phase Wards
            and trigger devastating Critical Staggers.
          </p>
          <div class="controls-cheat">
            <div><strong>Desktop:</strong> WASD Move · Shift Sprint · Space Jump · Ctrl/C Dash · LMB Strike · RMB/E Cast Sigil · 1–6 / Q Wheel · V POV · Esc Menu</div>
            <div><strong>Mobile:</strong> Smooth Left Stick · Right Drag Camera · Responsive Strike / Cast / Jump / Dash buttons</div>
          </div>
          <div class="title-actions">
            ${
              hasSave
                ? `
              <div class="save-status-badge">★ Saved Journey: ${saveSummary}</div>
              <div class="title-main-btns">
                <button id="btn-continue" class="adv-btn primary glow-btn">
                  <span>Continue Adventure</span>
                </button>
                <button id="btn-new-game" class="adv-btn">New Adventure</button>
              </div>
              `
                : `
              <button id="start-hub-btn" class="adv-btn primary glow-btn" style="width:100%;">Enter Sunlit Valley</button>
              `
            }
            <div class="title-quick-warps">
              <span class="warp-label">Quick Waypoints:</span>
              <button id="start-witch-btn" class="adv-btn sm">Whispering Glade (sin/cos)</button>
              <button id="start-lich-btn" class="adv-btn sm">Sunken Sun-Ruins (tan/cot)</button>
              <button id="start-dragon-btn" class="adv-btn sm">Skyridge Peak (sec/csc)</button>
            </div>
            <div class="title-footer-row">
              <button id="btn-title-fullscreen" class="adv-btn text-btn">⛶ Fullscreen View</button>
              <button id="btn-title-controls" class="adv-btn text-btn">📖 Controls Guide</button>
              <button id="btn-title-settings" class="adv-btn text-btn">⚙ Sanctuary Settings</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const titleFsBtn = this.titleOverlay.querySelector('#btn-title-fullscreen');
    if (titleFsBtn) {
      titleFsBtn.addEventListener('click', () => {
        fullscreenManager.toggle();
      });
    }

    const titleControlsBtn = this.titleOverlay.querySelector('#btn-title-controls');
    if (titleControlsBtn) {
      titleControlsBtn.addEventListener('click', () => {
        this.openSettingsModal(this.currentSettings, undefined, undefined, false, undefined, 'controls');
      });
    }

    const startHub = this.titleOverlay.querySelector('#start-hub-btn');
    if (startHub) {
      startHub.addEventListener('click', () => {
        this.titleOverlay.classList.add('hidden');
        this.setHUDVisible(true);
        this.handlers.onStartGame(false);
      });
    }

    const continueBtn = this.titleOverlay.querySelector('#btn-continue');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        this.titleOverlay.classList.add('hidden');
        this.setHUDVisible(true);
        this.handlers.onStartGame(false);
      });
    }

    const newGameBtn = this.titleOverlay.querySelector('#btn-new-game');
    if (newGameBtn) {
      newGameBtn.addEventListener('click', () => {
        if (confirm('Start a new adventure? This will reset your current progress in the Astral Archives.')) {
          resetProgression();
          this.titleOverlay.classList.add('hidden');
          this.setHUDVisible(true);
          this.handlers.onStartGame(true);
        }
      });
    }

    const titleSettingsBtn = this.titleOverlay.querySelector('#btn-title-settings');
    if (titleSettingsBtn) {
      titleSettingsBtn.addEventListener('click', () => {
        this.openTitleSettings();
      });
    }

    for (const id of BOSS_ORDER) {
      this.titleOverlay.querySelector(`#start-${id}-btn`)?.addEventListener('click', () => {
        this.titleOverlay.classList.add('hidden');
        this.setHUDVisible(true);
        this.handlers.onStartGame(false);
        this.handlers.onWarpBoss(id);
      });
    }
  }

  private renderTitleSettingsView(): void {
    const presets: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
    const fpsCaps: FpsCap[] = [30, 60, 120, 0];
    const controls: ControlSchemeMode[] = ['auto', 'desktop', 'mobile'];

    this.titleOverlay.innerHTML = `
      <div class="title-sidebar-content">
        <div class="sidebar-settings-pane sidebar-view-pane">
          <div class="sidebar-top-nav">
            <button id="btn-sidebar-back" class="adv-btn sidebar-back-btn">
              <span class="btn-arrow">←</span> Back to Title
            </button>
          </div>

          <div class="title-crest">✧ SANCTUARY CONFIGURATION ✧</div>
          <h2 class="sidebar-section-title">SANCTUARY SETTINGS</h2>
          <p class="sidebar-section-sub">Audio, visual fidelity & calculus presentation</p>

          <div class="sidebar-settings-list">
            <div class="setting-row">
              <span class="setting-title">Graphics Preset</span>
              <div class="pill-group">
                ${presets
                  .map(
                    (p) =>
                      `<button data-sidebar-preset="${p}" class="pill-btn ${this.currentSettings.preset === p ? 'active' : ''}">${PRESET_PROFILES[p].label}</button>`,
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
                      `<button data-sidebar-fps="${f}" class="pill-btn ${this.currentSettings.fpsCap === f ? 'active' : ''}">${f === 0 ? 'Max' : `${f}`}</button>`,
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
                      `<button data-sidebar-ctrl="${c}" class="pill-btn ${this.currentSettings.controlMode === c ? 'active' : ''}">${c.toUpperCase()}</button>`,
                  )
                  .join('')}
              </div>
            </div>

            <div class="setting-row inline-row">
              <span class="setting-title">Show FPS Overlay</span>
              <button id="sidebar-opt-fps" class="pill-btn ${this.currentSettings.showFps ? 'active' : ''}">
                ${this.currentSettings.showFps ? 'SHOWN' : 'HIDDEN'}
              </button>
            </div>

            <div class="setting-row inline-row">
              <span class="setting-title">Procedural Audio</span>
              <button id="sidebar-opt-audio" class="pill-btn ${this.currentSettings.audioEnabled ? 'active' : ''}">
                ${this.currentSettings.audioEnabled ? 'ON' : 'MUTED'}
              </button>
            </div>

            <div class="setting-row">
              <div class="setting-title-row">
                <span class="setting-title">Camera Sensitivity</span>
                <span id="sidebar-sens-val" class="setting-val-badge">${this.currentSettings.sensitivity.toFixed(1)}×</span>
              </div>
              <input id="sidebar-opt-sens" type="range" min="0.4" max="2.2" step="0.1" value="${this.currentSettings.sensitivity}" class="adv-slider full-width" />
            </div>

            <div class="settings-group sidebar-math-group">
              <label class="setting-label">Calculus Presentation</label>
              <button id="sidebar-btn-worked" class="adv-btn primary" style="width:100%;">
                Open MATH 101 Worked Example
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const backBtn = this.titleOverlay.querySelector('#btn-sidebar-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.showTitleMainView();
      });
    }

    this.titleOverlay.querySelectorAll('[data-sidebar-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const preset = el.getAttribute('data-sidebar-preset') as GraphicsPreset;
        this.currentSettings = { ...this.currentSettings, preset };
        this.handlers.onUpdateSettings(this.currentSettings);
        this.renderTitleSettingsView();
      });
    });

    this.titleOverlay.querySelectorAll('[data-sidebar-fps]').forEach((el) => {
      el.addEventListener('click', () => {
        const fpsCap = Number(el.getAttribute('data-sidebar-fps')) as FpsCap;
        this.currentSettings = { ...this.currentSettings, fpsCap };
        this.handlers.onUpdateSettings(this.currentSettings);
        this.renderTitleSettingsView();
      });
    });

    this.titleOverlay.querySelectorAll('[data-sidebar-ctrl]').forEach((el) => {
      el.addEventListener('click', () => {
        const controlMode = el.getAttribute('data-sidebar-ctrl') as ControlSchemeMode;
        this.currentSettings = { ...this.currentSettings, controlMode };
        this.handlers.onUpdateSettings(this.currentSettings);
        this.renderTitleSettingsView();
      });
    });

    this.titleOverlay.querySelector('#sidebar-opt-fps')?.addEventListener('click', () => {
      this.currentSettings = { ...this.currentSettings, showFps: !this.currentSettings.showFps };
      this.handlers.onUpdateSettings(this.currentSettings);
      this.renderTitleSettingsView();
    });

    this.titleOverlay.querySelector('#sidebar-opt-audio')?.addEventListener('click', () => {
      this.currentSettings = { ...this.currentSettings, audioEnabled: !this.currentSettings.audioEnabled };
      this.handlers.onUpdateSettings(this.currentSettings);
      this.renderTitleSettingsView();
    });

    const sensInput = this.titleOverlay.querySelector('#sidebar-opt-sens') as HTMLInputElement | null;
    const sensVal = this.titleOverlay.querySelector('#sidebar-sens-val');
    if (sensInput) {
      sensInput.addEventListener('input', () => {
        const val = Number(sensInput.value);
        this.currentSettings = { ...this.currentSettings, sensitivity: val };
        if (sensVal) sensVal.textContent = `${val.toFixed(1)}×`;
        this.handlers.onUpdateSettings({ ...this.currentSettings });
      });
    }

    this.titleOverlay.querySelector('#sidebar-btn-worked')?.addEventListener('click', () => {
      this.handlers.onOpenWorkedExample();
    });
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
    mapBtn('#m-town', () => {
      if (this.handlers.onReturnToTown) {
        this.handlers.onReturnToTown();
      } else {
        this.handlers.onWarpBoss('hub');
      }
    });
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
      (this.atlas && this.atlas.visible) ||
      !this.titleOverlay.classList.contains('hidden') ||
      !this.settingsModal.classList.contains('hidden') ||
      !this.workedModal.classList.contains('hidden')
    );
  }

  public isAtlasOpen(): boolean {
    return this.atlas?.visible ?? false;
  }

  public openAtlas(
    playerPos?: { x: number; z: number },
    playerYaw?: number,
    progression?: ProgressionState,
  ): void {
    const pos = playerPos ?? this.lastKnownPlayerPos;
    const yaw = playerYaw ?? this.lastKnownPlayerYaw;
    const prog = progression ?? this.lastKnownProgression;
    this.atlas.open(pos, yaw, prog);
    this.handlers.onOpenAtlas?.();
  }

  public closeAtlas(): void {
    this.atlas.close();
    this.handlers.onCloseAtlas?.();
  }

  public toggleAtlas(
    playerPos?: { x: number; z: number },
    playerYaw?: number,
    progression?: ProgressionState,
  ): void {
    if (this.atlas.visible) {
      this.closeAtlas();
    } else {
      this.openAtlas(playerPos, playerYaw, progression);
    }
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
    initialTab: 'gameplay' | 'dev' | 'controls' = 'gameplay',
    progression?: ProgressionState,
  ): void {
    this.currentSettings = settings;
    this.settingsModal.classList.remove('hidden');
    const presets: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
    const fpsCaps: FpsCap[] = [30, 60, 120, 0];
    const controls: ControlSchemeMode[] = ['auto', 'desktop', 'mobile'];
    const activeTab = initialTab;

    const maxHp = player ? computeEffectiveStat(player, 'maxHp') : 160;
    const maxStam = player ? computeEffectiveStat(player, 'maxStamina') : 100;
    const progSummary = progression ? getProgressionSummary(progression) : 'Adventurer';
    const xpPct = progression ? (getLevelProgressFraction(progression) * 100).toFixed(0) : '0';
    const harmonicsMult = progression ? (1.0 + progression.harmonics * 0.25).toFixed(2) : '1.00';
    const weaponTier = progression?.weaponLevel ?? 1;
    const maxFlasks = progression?.maxFlasks ?? 3;
    const mithrilCount = progression ? getInventoryCount(progression, 'mithrilOre') : 0;
    const moonbellCount = progression ? getInventoryCount(progression, 'moonbell') : 0;
    const essenceCount = progression ? getInventoryCount(progression, 'phaseEssence') : 0;
    const boneCount = progression ? getInventoryCount(progression, 'ancientBone') : 0;
    const scaleCount = progression ? getInventoryCount(progression, 'drakeScale') : 0;

    this.settingsModal.innerHTML = `
      <div class="adventure-modal settings-card pause-modal">
        <div class="modal-tabs">
          <button id="tab-gameplay" class="tab-btn ${activeTab === 'gameplay' ? 'active' : ''}">✧ SANCTUARY RESUME ✧</button>
          <button id="tab-controls" class="tab-btn ${activeTab === 'controls' ? 'active' : ''}">CONTROLS (PC & MOBILE)</button>
          <button id="tab-dev" class="tab-btn ${activeTab === 'dev' ? 'active' : ''}">MATH 101 & DEV</button>
        </div>

        <div id="tab-body-gameplay" class="tab-body ${activeTab === 'gameplay' ? '' : 'hidden'}">
          <!-- Hero Status Card -->
          <div class="hero-pause-card">
            <div class="hero-pause-header">
              <div class="hero-pause-avatar">⚔️</div>
              <div class="hero-pause-meta">
                <div class="hero-pause-title">ASTRAL SPELLBLADE</div>
                <div class="hero-pause-sub">Level ${progression ? progression.level : 1} · ${progSummary}</div>
              </div>
              <div class="hero-pause-badge">SANCTUARY</div>
            </div>

            <div class="hero-pause-stats">
              <div class="stat-pill"><span class="stat-lbl">HP:</span> <strong>${player ? Math.max(0, player.hp) : 160}/${maxHp}</strong></div>
              <div class="stat-pill"><span class="stat-lbl">Stamina:</span> <strong>${player ? Math.round(player.stamina) : 100}/${maxStam}</strong></div>
              <div class="stat-pill"><span class="stat-lbl">Flasks:</span> <strong>${player ? player.flasksRemaining : maxFlasks}/${maxFlasks}</strong></div>
              <div class="stat-pill"><span class="stat-lbl">Harmonics:</span> <strong>${harmonicsMult}×</strong></div>
            </div>

            <div class="hero-xp-section">
              <div class="hero-xp-labels">
                <span>Astral Insight</span>
                <span>${progression ? progression.xp : 0} XP</span>
              </div>
              <div class="bar-pill xp-track-pause">
                <div class="xp-fill" style="width: ${xpPct}%"></div>
              </div>
            </div>
          </div>

          <!-- Adventurer Satchel Card -->
          <div class="satchel-card">
            <div class="satchel-header">
              <div class="satchel-title">🎒 ADVENTURER SATCHEL</div>
              <div class="satchel-tier">Spellblade Tier ${weaponTier} (+${(weaponTier - 1) * 10}% Dmg) · Flasks ${player ? player.flasksRemaining : maxFlasks}/${maxFlasks}</div>
            </div>
            <div class="satchel-grid">
              <div class="satchel-item" title="Mithril Ore Vein">
                <span class="item-icon">⛏️</span>
                <div class="item-info">
                  <span class="item-name">Mithril Ore</span>
                  <span class="item-count">${mithrilCount}</span>
                </div>
              </div>
              <div class="satchel-item" title="Moonbell Flora">
                <span class="item-icon">🌸</span>
                <div class="item-info">
                  <span class="item-name">Moonbell Flora</span>
                  <span class="item-count">${moonbellCount}</span>
                </div>
              </div>
              <div class="satchel-item" title="Phase Wolf Essence">
                <span class="item-icon">🐺</span>
                <div class="item-info">
                  <span class="item-name">Phase Essence</span>
                  <span class="item-count">${essenceCount}</span>
                </div>
              </div>
              <div class="satchel-item" title="Skeletal Ancient Bone">
                <span class="item-icon">💀</span>
                <div class="item-info">
                  <span class="item-name">Ancient Bone</span>
                  <span class="item-count">${boneCount}</span>
                </div>
              </div>
              <div class="satchel-item" title="Drake Wyrmling Scale">
                <span class="item-icon">🐉</span>
                <div class="item-info">
                  <span class="item-name">Drake Scale</span>
                  <span class="item-count">${scaleCount}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Sanctuary Action Buttons -->
          <div class="pause-actions-grid">
            <button id="opt-resume" class="adv-btn primary pause-btn">
              <span class="btn-icon">▶</span> Resume Adventure <span class="kbd-hint">Esc</span>
            </button>
            <button id="opt-fullscreen" class="adv-btn pause-btn">
              <span class="btn-icon">⛶</span> Toggle Fullscreen Mode
            </button>
            <button id="opt-save" class="adv-btn pause-btn">
              <span class="btn-icon">💾</span> Save Progress
            </button>
            <button id="opt-town" class="adv-btn pause-btn">
              <span class="btn-icon">🏛️</span> Return to Solstice Haven
            </button>
            <button id="opt-quit-title" class="adv-btn danger pause-btn">
              <span class="btn-icon">⏏</span> Quit to Title Screen
            </button>
          </div>

          <div class="pause-settings-divider">
            <span>SANCTUARY SETTINGS & WAYPOINTS</span>
          </div>

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

        <!-- Tab: Controls Guide (PC & Mobile) -->
        <div id="tab-body-controls" class="tab-body ${activeTab === 'controls' ? '' : 'hidden'}">
          <div class="controls-guide-hero">
            <div class="guide-hero-title">✦ ASTRAL CONTROLS & NAVIGATION REPERTOIRE ✦</div>
            <p class="guide-hero-sub">Ergonomic key & touch bindings for PC Desktop and Mobile Devices</p>
          </div>

          <div class="controls-guide-grid">
            <!-- Desktop Column -->
            <div class="controls-column desktop-column">
              <div class="controls-col-header">
                <span class="col-icon">🖥️</span>
                <span class="col-title">DESKTOP KEYBOARD & MOUSE</span>
              </div>
              <div class="controls-entries">
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span></div>
                  <span class="entry-desc">Move Spellblade in 3D</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">Shift</span></div>
                  <span class="entry-desc">Sprint (Consumes Stamina)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">Space</span></div>
                  <span class="entry-desc">Jump & Vault</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">C</span><span class="badge-or">/</span><span class="kbd">Ctrl</span></div>
                  <span class="entry-desc">Dash / Dodge (Invulnerability)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">LMB</span></div>
                  <span class="entry-desc">Sword Strike (3-hit combo)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">RMB</span><span class="badge-or">/</span><span class="kbd">E</span></div>
                  <span class="entry-desc">Cast Resonance Burst (Active Sigil)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">1–6</span><span class="badge-or">/</span><span class="kbd">Q</span></div>
                  <span class="entry-desc">Attunement Wheel (0.2× Slow-Mo)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">Tab</span></div>
                  <span class="entry-desc">Lock-On Nearest Boss / Enemy</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">F</span></div>
                  <span class="entry-desc">Interact / Talk / Harvest / Rest</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">M</span></div>
                  <span class="entry-desc">Open Sunlit Valley Atlas & Fast Travel</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">V</span></div>
                  <span class="entry-desc">Toggle 1st / 3rd Person Camera</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="kbd">Esc</span></div>
                  <span class="entry-desc">Sanctuary Menu & Pause</span>
                </div>
              </div>
            </div>

            <!-- Mobile Column -->
            <div class="controls-column mobile-column">
              <div class="controls-col-header">
                <span class="col-icon">📱</span>
                <span class="col-title">MOBILE TOUCH ERGONOMICS</span>
              </div>
              <div class="controls-entries">
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">🕹️ Compass Stick</span></div>
                  <span class="entry-desc">Left thumb: 360° analog walk & run</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge strike">⚔️ STRIKE</span></div>
                  <span class="entry-desc">Right thumb anchor: primary attack combo</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge cast">⚡ CAST</span></div>
                  <span class="entry-desc">Radial sweep: resonant derivative burst</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">💨 DASH</span></div>
                  <span class="entry-desc">Radial sweep: quick mobility evade</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">▲ JUMP</span></div>
                  <span class="entry-desc">Radial sweep: leap over obstacles</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">🎯 LOCK</span></div>
                  <span class="entry-desc">Camera focus lock onto target</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">🏛️ TOWN</span></div>
                  <span class="entry-desc">Bottom bar: quick warp to Solstice Haven</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">🧪 HEAL</span></div>
                  <span class="entry-desc">Bottom bar: drink Crimson Flask (Charges)</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">💬 CONTEXT</span></div>
                  <span class="entry-desc">Contextual prompt: converse with NPCs, harvest flora/ore, read guides, or rest</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">⚙️ SIGIL</span></div>
                  <span class="entry-desc">Bottom bar: open Derivative Wheel</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">🗺️ Radar</span></div>
                  <span class="entry-desc">Top-left: tap minimap for Realm Atlas</span>
                </div>
                <div class="control-entry">
                  <div class="key-badges"><span class="touch-badge">⛶ Fullscreen</span></div>
                  <span class="entry-desc">Top-right: hide mobile address bar</span>
                </div>
              </div>
            </div>
          </div>

          <div class="controls-guide-footer">
            <button id="guide-opt-fullscreen" class="adv-btn primary">
              <span class="btn-icon">⛶</span> Toggle Fullscreen Mode (Hide Browser Search Bar)
            </button>
          </div>
        </div>

        <div id="tab-body-dev" class="tab-body ${activeTab === 'dev' ? '' : 'hidden'}">
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
    const tabControls = this.settingsModal.querySelector('#tab-controls')!;
    const tabDev = this.settingsModal.querySelector('#tab-dev')!;
    const bodyGameplay = this.settingsModal.querySelector('#tab-body-gameplay')!;
    const bodyControls = this.settingsModal.querySelector('#tab-body-controls')!;
    const bodyDev = this.settingsModal.querySelector('#tab-body-dev')!;

    const switchTab = (t: 'gameplay' | 'controls' | 'dev') => {
      tabGameplay.classList.toggle('active', t === 'gameplay');
      tabControls.classList.toggle('active', t === 'controls');
      tabDev.classList.toggle('active', t === 'dev');
      bodyGameplay.classList.toggle('hidden', t !== 'gameplay');
      bodyControls.classList.toggle('hidden', t !== 'controls');
      bodyDev.classList.toggle('hidden', t !== 'dev');
    };

    tabGameplay.addEventListener('click', () => switchTab('gameplay'));
    tabControls.addEventListener('click', () => switchTab('controls'));
    tabDev.addEventListener('click', () => switchTab('dev'));

    this.settingsModal.querySelector('#opt-fullscreen')?.addEventListener('click', () => {
      fullscreenManager.toggle();
    });

    this.settingsModal.querySelector('#guide-opt-fullscreen')?.addEventListener('click', () => {
      fullscreenManager.toggle();
    });

    this.settingsModal.querySelector('#opt-resume')?.addEventListener('click', () => {
      this.closeSettingsModal();
      this.handlers.onCloseSettings();
    });

    this.settingsModal.querySelector('#opt-save')?.addEventListener('click', () => {
      this.handlers.onSaveProgress?.();
    });

    this.settingsModal.querySelector('#opt-town')?.addEventListener('click', () => {
      this.closeSettingsModal();
      this.handlers.onCloseSettings();
      this.handlers.onReturnToTown?.();
    });

    this.settingsModal.querySelector('#opt-quit-title')?.addEventListener('click', () => {
      this.closeSettingsModal();
      this.handlers.onCloseSettings();
      this.handlers.onQuitToTitle?.();
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
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry, 'gameplay', progression);
      });
    });

    this.settingsModal.querySelectorAll('[data-fps]').forEach((el) => {
      el.addEventListener('click', () => {
        const fpsCap = Number(el.getAttribute('data-fps')) as FpsCap;
        const next = { ...settings, fpsCap };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry, 'gameplay', progression);
      });
    });

    this.settingsModal.querySelectorAll('[data-ctrl]').forEach((el) => {
      el.addEventListener('click', () => {
        const controlMode = el.getAttribute('data-ctrl') as ControlSchemeMode;
        const next = { ...settings, controlMode };
        this.handlers.onUpdateSettings(next);
        this.openSettingsModal(next, player, boss, freezeTheta, telemetry, 'gameplay', progression);
      });
    });

    this.settingsModal.querySelector('#opt-fps')!.addEventListener('click', () => {
      const next = { ...settings, showFps: !settings.showFps };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next, player, boss, freezeTheta, telemetry, 'gameplay', progression);
    });

    this.settingsModal.querySelector('#opt-audio')!.addEventListener('click', () => {
      const next = { ...settings, audioEnabled: !settings.audioEnabled };
      this.handlers.onUpdateSettings(next);
      this.openSettingsModal(next, player, boss, freezeTheta, telemetry, 'gameplay', progression);
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

  public isCutsceneActive(): boolean {
    return !this.cutsceneOverlay.classList.contains('hidden');
  }

  public showBossCutscene(bossId: BossId, onFinish?: () => void): void {
    this.setHUDVisible(false);
    const cfg = BOSS_CONFIGS[bossId];
    this.cutsceneBossName.textContent = cfg.name.toUpperCase();
    this.cutsceneBossTitle.textContent = `${cfg.title} · Sovereign of Phase Harmonics`;
    this.cutsceneBossFormula.textContent = `Harmonic Wave: f(θ) = ${cfg.functions[0]}(θ) & ${cfg.functions[1]}(θ)`;
    this.cutsceneFinishCb = onFinish ?? null;
    this.cutsceneOverlay.classList.remove('hidden');
  }

  public hideBossCutscene(): void {
    if (!this.cutsceneOverlay.classList.contains('hidden')) {
      this.cutsceneOverlay.classList.add('hidden');
      this.setHUDVisible(true);
      if (this.cutsceneFinishCb) {
        const cb = this.cutsceneFinishCb;
        this.cutsceneFinishCb = null;
        cb();
      }
    }
  }

  public showWorkedExample(snapshot: WorkedExampleSnapshot): void {
    this.workedModal.classList.remove('hidden');
    const closeLabel = !this.titleOverlay.classList.contains('hidden')
      ? 'Return to Sanctuary Settings'
      : 'Resume Combat';

    const fnId = snapshot.functionId || 'sin';
    const theta = typeof snapshot.thetaRadians === 'number' ? snapshot.thetaRadians : Math.PI / 3;
    const plot = generateWavePlotData(fnId, theta);
    const slopeSign = (snapshot.evaluatedSlope ?? 0.5) >= 0 ? '+' : '';

    this.workedModal.innerHTML = `
      <div class="adventure-modal astrolabe-grimoire">
        <!-- Celestial Filigree Corners -->
        <div class="filigree-corner top-left">✧</div>
        <div class="filigree-corner top-right">✧</div>
        <div class="filigree-corner bottom-left">✧</div>
        <div class="filigree-corner bottom-right">✧</div>

        <div class="grimoire-header">
          <div class="title-crest">✧ CELESTIAL ASTROLABE ✧</div>
          <h2 class="worked-title">THEOREM OF INSTANTANEOUS RESONANCE</h2>
          <p class="worked-sub">Live Harmonic Wave State & Differential Slope Calculation</p>
        </div>

        <!-- Live Interactive SVG Calculus Graph -->
        <div class="astrolabe-plot-box">
          <div class="plot-meta-row">
            <span class="plot-func-tag">Active Wave: <strong>${snapshot.functionFormula}</strong></span>
            <span class="plot-slope-badge">Tangent Slope f′(θ) = <strong>${slopeSign}${snapshot.evaluatedSlope.toFixed(3)}</strong></span>
          </div>

          <svg class="astrolabe-svg-graph" viewBox="0 0 ${plot.width} ${plot.height}">
            <defs>
              <linearGradient id="waveGlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.7"/>
                <stop offset="50%" stop-color="#ffd978" stop-opacity="1"/>
                <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.8"/>
              </linearGradient>
            </defs>

            <!-- Coordinate Axes -->
            <line x1="20" y1="${plot.axisY}" x2="${plot.width - 20}" y2="${plot.axisY}" stroke="rgba(213, 184, 104, 0.4)" stroke-width="1.2" stroke-dasharray="3 3"/>
            
            <!-- Axis Ticks & Radian Labels -->
            ${plot.ticks
              .map(
                (t) => `
              <line x1="${t.x}" y1="${plot.axisY - 4}" x2="${t.x}" y2="${plot.axisY + 4}" stroke="rgba(213, 184, 104, 0.6)" stroke-width="1.2"/>
              <text x="${t.x}" y="${plot.height - 4}" text-anchor="middle" font-size="9" fill="#d5b868" font-family="monospace">${t.label}</text>
            `,
              )
              .join('')}

            <!-- Wave Path f(t) -->
            <path d="${plot.pathData}" fill="none" stroke="url(#waveGlowGrad)" stroke-width="2.6" stroke-linecap="round"/>

            <!-- Instantaneous Tangent Line f'(theta) -->
            <line x1="${plot.tangentLine.x1}" y1="${plot.tangentLine.y1}" x2="${plot.tangentLine.x2}" y2="${plot.tangentLine.y2}" stroke="#fff0a8" stroke-width="2" stroke-dasharray="4 2"/>

            <!-- Tangent Contact Point (theta, f(theta)) -->
            <circle cx="${plot.contactPoint.x}" cy="${plot.contactPoint.y}" r="6" fill="#ffd978" opacity="0.6"/>
            <circle cx="${plot.contactPoint.x}" cy="${plot.contactPoint.y}" r="3.2" fill="#ffffff"/>
          </svg>
        </div>

        <!-- Four Arcane Theorem Plates -->
        <div class="grimoire-plates-grid">
          <div class="grimoire-plate plate-function">
            <div class="plate-label">Plate I · Primordial Wave</div>
            <div class="plate-formula"><strong>${snapshot.functionFormula}</strong></div>
            <div class="plate-desc">Active trigonometric wave channeled by boss.</div>
          </div>

          <div class="grimoire-plate plate-rule">
            <div class="plate-label">Plate II · Derivative Law</div>
            <div class="plate-formula"><strong>${snapshot.derivativeRule}</strong></div>
            <div class="plate-desc">Exact rate of instantaneous slope change.</div>
          </div>

          <div class="grimoire-plate plate-eval">
            <div class="plate-label">Plate III · Tangent Phase Evaluation</div>
            <div class="plate-eval-grid">
              <div>Phase: <code>θ = ${snapshot.thetaPiLabel}</code></div>
              <div>f(θ): <code>${snapshot.evaluatedFunction.toFixed(3)}</code></div>
              <div>f′(θ) Exact: <code>${slopeSign}${snapshot.evaluatedSlope.toFixed(3)}</code></div>
              <div>Numeric Δ: <code>${snapshot.numericSlope.toFixed(3)}</code></div>
            </div>
            ${snapshot.isCriticalPoint ? '<div class="crit-badge">★ CRITICAL INFLECTION POINT: Maximum Stagger Window!</div>' : ''}
            ${snapshot.nearAsymptote ? '<div class="warn-badge">⚠ ASYMPTOTIC VOLATILITY: Wave Velocity Surge!</div>' : ''}
          </div>

          <div class="grimoire-plate plate-combat ${snapshot.isExactMatch ? 'match' : 'mismatch'}">
            <div class="plate-label">Plate IV · Blade Attunement & Combat Resolution</div>
            <div class="plate-combat-row">
              <span class="plate-attuned">Attuned: <strong>${snapshot.chosenSigilLabel}</strong> (${snapshot.isExactMatch ? '✓ HARMONIC MATCH' : '✗ MISMATCH'})</span>
              <span class="plate-mult">Multiplier: <strong>${snapshot.damageMultiplier.toFixed(2)}×</strong></span>
            </div>
            <div class="plate-desc">${snapshot.outcomeSummary}</div>
          </div>
        </div>

        <div class="modal-footer">
          <button id="worked-close" class="adv-btn primary astrolabe-btn">${closeLabel}</button>
        </div>
      </div>
    `;
    this.workedModal.querySelector('#worked-close')!.addEventListener('click', () => {
      this.closeWorkedExample();
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
    progression?: ProgressionState,
  ): void {
    // 1. Vitals
    const maxHp = computeEffectiveStat(player, 'maxHp');
    const maxStam = computeEffectiveStat(player, 'maxStamina');
    this.hpFill.style.width = `${Math.max(0, Math.min(100, (player.hp / maxHp) * 100))}%`;
    this.staminaFill.style.width = `${Math.max(0, Math.min(100, (player.stamina / maxStam) * 100))}%`;
    this.vitalsHpNum.textContent = `${Math.max(0, player.hp)}/${maxHp}`;
    this.root.querySelector('#flask-label')!.textContent = `${player.flasksRemaining}`;
    if (this.mHealBadge) {
      this.mHealBadge.textContent = `${player.flasksRemaining}`;
    }

    if (progression) {
      this.levelBadge.textContent = `LVL ${progression.level}`;
      const xpPct = (getLevelProgressFraction(progression) * 100).toFixed(0);
      this.xpFill.style.width = `${xpPct}%`;
    }

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

  public showInteractPrompt(label: string): void {
    this.interactLabel.textContent = label;
    this.interactPrompt.classList.remove('hidden');

    const mIcon = this.mTalkBtn?.querySelector('.m-util-icon');
    const mLabel = this.mTalkBtn?.querySelector('.m-util-label');
    if (label.startsWith('Harvest')) {
      if (mIcon) mIcon.textContent = label.includes('Ore') ? '⛏️' : '🌸';
      if (mLabel) mLabel.textContent = 'GATHER';
    } else if (label.startsWith('Read')) {
      if (mIcon) mIcon.textContent = '📜';
      if (mLabel) mLabel.textContent = 'READ';
    } else if (label.startsWith('Rest')) {
      if (mIcon) mIcon.textContent = '⛲';
      if (mLabel) mLabel.textContent = 'REST';
    } else {
      if (mIcon) mIcon.textContent = '💬';
      if (mLabel) mLabel.textContent = 'TALK';
    }

    this.mTalkBtn.classList.remove('hidden');
  }

  public hideInteractPrompt(): void {
    this.interactPrompt.classList.add('hidden');
    this.mTalkBtn.classList.add('hidden');
  }

  public get isDialogueOpen(): boolean {
    return !this.dialogueCard.classList.contains('hidden');
  }

  public openDialogue(
    node: DialogueNode,
    choices: DialogueChoice[],
    progression: ProgressionState,
    onSelect: (choice: DialogueChoice) => void,
  ): void {
    const roleIcons: Record<string, string> = {
      aurelius: '🧙‍♂️',
      blacksmith: '⚒️',
      herbalist: '🌿',
      scout: '🏹',
    };
    this.dialoguePortrait.textContent = roleIcons[node.speakerRole] ?? '✧';
    this.dialogueSpeakerName.textContent = node.speakerName;
    this.dialogueSpeakerTitle.textContent = node.speakerTitle;
    this.dialogueLvl.textContent = `Astral Lvl ${progression.level}`;
    if (node.speakerRole === 'blacksmith') {
      const ore = progression.inventory?.['mithrilOre'] ?? 0;
      const bone = progression.inventory?.['ancientBone'] ?? 0;
      this.dialoguePoints.textContent = `Satchel: ${ore} Ore · ${bone} Bone`;
    } else if (node.speakerRole === 'herbalist') {
      const flora = progression.inventory?.['moonbell'] ?? 0;
      const essence = progression.inventory?.['phaseEssence'] ?? 0;
      this.dialoguePoints.textContent = `Satchel: ${flora} Flora · ${essence} Essence`;
    } else {
      this.dialoguePoints.textContent = `${progression.statPoints} Stat Pt${progression.statPoints === 1 ? '' : 's'}`;
    }
    this.dialogueBody.textContent = node.text;

    this.dialogueChoices.innerHTML = '';
    choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.className = 'dialogue-choice-btn';
      btn.innerHTML = `<span>${choice.text}</span><span style="opacity:0.6;font-size:11px;">▸</span>`;
      btn.addEventListener('click', () => {
        onSelect(choice);
      });
      this.dialogueChoices.appendChild(btn);
    });

    this.dialogueCard.classList.remove('hidden');
    this.hideInteractPrompt();
  }

  public closeDialogue(): void {
    this.dialogueCard.classList.add('hidden');
  }

  public updateMinimap(
    playerPos: { x: number; z: number },
    playerYaw: number,
    progression?: ProgressionState,
  ): void {
    this.lastKnownPlayerPos = playerPos;
    this.lastKnownPlayerYaw = playerYaw;
    this.lastKnownProgression = progression;

    if (this.atlas && this.atlas.visible) {
      this.atlas.updatePlayerLive(playerPos, playerYaw);
    }

    if (!this.minimapCanvas) return;
    const ctx = this.minimapCanvas.getContext?.('2d');
    if (!ctx) return;

    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = cx - 2;

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // Circular clip
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Background lush valley terrain
    const bgGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, r);
    bgGrad.addColorStop(0, '#1c3e2b');
    bgGrad.addColorStop(0.7, '#0e2619');
    bgGrad.addColorStop(1, '#05160d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Outer valley ring guideline
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
    ctx.stroke();

    // Sunlit brook channel (curved line with light blue glow)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.42);
    ctx.quadraticCurveTo(cx, h * 0.45, w * 0.9, h * 0.43);
    ctx.stroke();

    // Solstice Haven Town Wall Perimeter Circle (center radius ~15px)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    // Landmark dots
    // Solstice Haven Hub (0, 0)
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Boss Landmarks: Witch (-52, -42), Lich (12, 54), Dragon (48, -48)
    const landmarks = [
      { x: -52, z: -42, color: '#38bdf8' },
      { x: 12, z: 54, color: '#c084fc' },
      { x: 48, z: -48, color: '#f59e0b' },
    ];
    for (const lm of landmarks) {
      const { u, v } = worldToMapNormalized(lm.x, lm.z);
      ctx.fillStyle = lm.color;
      ctx.beginPath();
      ctx.arc(u * w, v * h, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player marker
    const { u: pU, v: pV } = worldToMapNormalized(playerPos.x, playerPos.z);
    const px = pU * w;
    const py = pV * h;

    // Player heading cone
    const coneLen = 14;
    const angle = -playerYaw - Math.PI / 2;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneLen, angle - 0.45, angle + 0.45);
    ctx.closePath();
    ctx.fill();

    // Player beacon core dot
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}
