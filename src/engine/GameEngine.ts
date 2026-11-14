import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ProceduralAudio } from '../audio/ProceduralAudio';
import { VfxSystem } from './VfxSystem';
import {
  applyDamageToBoss,
  createBossRuntime,
  engageBoss,
  forceBossStagger,
  resetBossToIdle,
  stepBossAI,
  type BossRuntime,
} from '../bosses/bossAI';
import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import { DualCameraController } from '../camera/DualCameraController';
import {
  applyDamageToPlayer,
  applyProgressionToPlayer,
  canSpendResonanceStamina,
  computeEffectiveStat,
  createInitialPlayerState,
  resolveBasicAttack,
  resolveResonanceStrike,
  stepPlayerState,
  tryStartDodge,
  tryUseHealFlask,
  type PlayerState,
} from '../combat/resonanceCombat';
import { InputManager } from '../input/InputManager';
import {
  buildWorkedExample,
  DERIVATIVE_SIGILS,
  evaluateExactDerivative,
  SIGIL_BY_ID,
  type WorkedExampleSnapshot,
} from '../math/trigDerivatives';
import { GameUI, type TelemetrySnapshot } from '../ui/GameUI';
import {
  getRegionAt,
  getTerrainHeight,
  LANDMARK_BY_ID,
  WORLD_PLAYABLE_RADIUS,
} from '../world/SunlitValley';
import {
  loadSettings,
  PRESET_PROFILES,
  saveSettings,
  type GameSettings,
} from './GraphicsSettings';
import {
  createArenaEnvironment,
  createBossModel,
  createPlayerModel,
  createSolsticeHavenVillage,
  createTangentArcVisual,
  type ArenaBundle,
  type BossRig,
  type InteractiveNpcEntity,
  type PlayerRig,
  type SolsticeHavenBundle,
  type TangentArcVisual,
} from './ProceduralModels';
import {
  computeEffectiveStats,
  loadProgression,
  recordBossDefeat,
  resetProgression,
  saveProgression,
  type ProgressionState,
} from '../rpg/progressionSystem';
import { DialogueRunner } from '../dialogue/dialogueRunner';
import type { DialogueChoice } from '../dialogue/dialogueData';

interface ActiveProjectile {
  mesh: THREE.Mesh;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  fromPlayer: boolean;
}

interface ActiveShockwave {
  mesh: THREE.Mesh;
  maxRadius: number;
  life: number;
  maxLife: number;
  damage: number;
  hitPlayer: boolean;
}

export class GameEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly timer = new THREE.Timer();
  private readonly arena: ArenaBundle;
  private readonly village: SolsticeHavenBundle;
  private readonly vfx: VfxSystem;
  private readonly playerRig: PlayerRig;
  private readonly tangentArc: TangentArcVisual;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly bossLight: THREE.PointLight;
  private readonly audio = new ProceduralAudio();
  private readonly cameraCtrl = new DualCameraController();
  private readonly input: InputManager;
  private readonly ui: GameUI;

  private settings: GameSettings;
  private player: PlayerState = createInitialPlayerState();
  private progression: ProgressionState;
  private dialogueRunner: DialogueRunner;
  private nearbyNpc: InteractiveNpcEntity | null = null;
  private playerPos = new THREE.Vector3(0, 0, 4);
  private playerVelocityY = 0;
  private isGrounded = true;
  private playerYaw = Math.PI;

  // Open-World Boss Entities (living simultaneously across their 3 biomes)
  private readonly bossRuntimes: Record<BossId, BossRuntime>;
  private readonly bossRigs: Record<BossId, BossRig>;
  private activeBossId: BossId | null = null;
  private lastWorkedExample: WorkedExampleSnapshot | null = null;

  private readonly projectiles: ActiveProjectile[] = [];
  private readonly shockwaves: ActiveShockwave[] = [];
  private readonly forwardVec = new THREE.Vector2();
  private readonly rightVec = new THREE.Vector2();

  private started = false;
  private paused = false;
  private wheelSlowMo = false;
  private freezeTheta = false;
  private hitStopRemaining = 0;
  private timeScale = 1;
  private totalTime = 0;
  private walkCyclePhase = 0;
  private bladeSwingTimer = 0;
  private bloomEnabled = true;

  private fpsAccumulator = 0;
  private lastFrameTimestamp = performance.now();
  private smoothedFps = 60;
  private smoothedFrameMs = 16.6;
  private uiUpdateCooldown = 0;

  // Boss Encounter Cinematic Cutscenes
  private isCutscenePlaying = false;
  private cutsceneTime = 0;
  private readonly cutsceneDuration = 3.8;
  private cutsceneBossId: BossId | null = null;
  private readonly seenBossCutscenes = new Set<BossId>();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    // Radiant daylight azure sky & soft horizon haze
    this.scene.background = new THREE.Color(0x9bd8ff);
    this.scene.fog = new THREE.FogExp2(0xbbe7ff, 0.0072);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 260);
    this.camera.add(new THREE.Object3D());

    // Post-processing pipeline (subtle daylight bloom for magic effects and sun glints)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.28,
      0.35,
      0.82,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Three.js r187 Daylight Sun & Sky Lighting Rig
    const hemi = new THREE.HemisphereLight(0xdcf2ff, 0x628e52, 1.25);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xfffaec, 2.8);
    this.keyLight.position.set(28, 48, -36);
    this.scene.add(this.keyLight.target);
    const cam = this.keyLight.shadow.camera;
    cam.near = 5;
    cam.far = 120;
    cam.left = -38;
    cam.right = 38;
    cam.top = 38;
    cam.bottom = -38;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0xa5daf8, 0.95);
    this.rimLight.position.set(-28, 24, 28);
    this.scene.add(this.rimLight);

    this.bossLight = new THREE.PointLight(0xffe292, 3.2, 36);
    this.bossLight.position.set(0, 8, -50);
    this.scene.add(this.bossLight);

    this.arena = createArenaEnvironment();
    this.scene.add(this.arena.group);

    this.village = createSolsticeHavenVillage();
    this.scene.add(this.village.group);

    this.progression = loadProgression();
    applyProgressionToPlayer(this.player, computeEffectiveStats(this.progression));

    this.dialogueRunner = new DialogueRunner(this.progression, {
      onShowToast: (msg) => this.ui.showToast(msg),
      onStateChanged: () => {
        applyProgressionToPlayer(this.player, computeEffectiveStats(this.progression));
        saveProgression(this.progression);
        if (!this.dialogueRunner.isOpen) {
          this.ui.closeDialogue();
        }
      },
    });

    this.vfx = new VfxSystem(this.scene);

    // Initial player placement in Adventurer's Plaza
    this.playerPos.y = getTerrainHeight(this.playerPos.x, this.playerPos.z);
    this.playerRig = createPlayerModel();
    this.playerRig.root.position.copy(this.playerPos);
    this.playerRig.setSigilAccent(SIGIL_BY_ID[this.player.selectedSigil].accentHex);
    this.scene.add(this.playerRig.root);
    this.scene.add(this.camera);
    this.camera.add(this.playerRig.firstPersonBlade);

    this.tangentArc = createTangentArcVisual();
    this.tangentArc.group.visible = false;
    this.scene.add(this.tangentArc.group);

    // Instantiate all 3 Bosses at their respective open-world biomes
    this.bossRuntimes = {
      witch: createBossRuntime('witch', {
        homeX: LANDMARK_BY_ID.witch.x,
        homeY: LANDMARK_BY_ID.witch.baseHeight,
        homeZ: LANDMARK_BY_ID.witch.z,
        startIdle: true,
      }),
      lich: createBossRuntime('lich', {
        homeX: LANDMARK_BY_ID.lich.x,
        homeY: LANDMARK_BY_ID.lich.baseHeight,
        homeZ: LANDMARK_BY_ID.lich.z,
        startIdle: true,
      }),
      dragon: createBossRuntime('dragon', {
        homeX: LANDMARK_BY_ID.dragon.x,
        homeY: LANDMARK_BY_ID.dragon.baseHeight,
        homeZ: LANDMARK_BY_ID.dragon.z,
        startIdle: true,
      }),
    };

    this.bossRigs = {
      witch: createBossModel('witch'),
      lich: createBossModel('lich'),
      dragon: createBossModel('dragon'),
    };

    for (const id of BOSS_ORDER) {
      const rig = this.bossRigs[id];
      const rt = this.bossRuntimes[id];
      rig.root.position.set(rt.x, rt.y, rt.z);
      this.scene.add(rig.root);
    }

    this.input = new InputManager(canvas, {
      onSelectSigil: (sigil) => {
        this.player.selectedSigil = sigil;
        this.playerRig.setSigilAccent(SIGIL_BY_ID[sigil].accentHex);
        this.audio.unlock();
        this.ui.showToast(`ATTUNED: ${SIGIL_BY_ID[sigil].label}`);
      },
      onToggleWheel: (open) => {
        this.wheelSlowMo = open;
        this.ui.setRadialWheelVisible(open);
      },
      onToggleDev: () => {
        if (!this.started) return;
        this.paused = !this.paused;
        this.syncPauseState('dev');
      },
      onTogglePause: () => {
        if (this.isCutscenePlaying) {
          this.endBossCutscene();
          return;
        }
        if (this.ui.isWorkedExampleOpen()) {
          this.ui.closeWorkedExample();
          this.input.setUiBlocked(!this.started);
          this.input.setPointerLockAllowed(this.started);
          this.paused = false;
          return;
        }
        if (!this.started) {
          if (this.ui.isTitleSettingsOpen()) {
            this.ui.showTitleMainView();
          }
          return;
        }
        this.paused = !this.paused;
        this.syncPauseState('gameplay');
      },
      onFirstUserGesture: () => {
        this.audio.unlock();
      },
      onPointerLockChange: (locked) => {
        this.ui.setPointerHintVisible(
          this.started && !this.paused && !this.ui.isModalOpen() && !this.isMobileUiActive() && !locked,
        );
      },
    });

    this.ui = new GameUI(uiRoot, {
      onStartGame: (isNewGame) => {
        if (isNewGame) {
          this.progression = resetProgression();
          applyProgressionToPlayer(this.player, computeEffectiveStats(this.progression));
          this.seenBossCutscenes.clear();
          this.warpToLandmark('hub');
        }
        this.started = true;
        this.paused = false;
        this.cameraCtrl.resetSmoothing(this.playerPos, this.playerYaw);
        this.input.setUiBlocked(false);
        this.input.setPointerLockAllowed(true);
        this.audio.unlock();
        this.syncControlVisibility();
        this.ui.setPointerHintVisible(!this.isMobileUiActive() && !this.input.isPointerLocked());
      },
      onSaveProgress: () => {
        saveProgression(this.progression);
        this.ui.showToast('★ PROGRESS SAVED TO ASTRAL ARCHIVES');
      },
      onReturnToTown: () => {
        this.warpToLandmark('hub');
        this.paused = false;
        this.syncPauseState();
        this.ui.showToast('WARPED TO SOLSTICE HAVEN');
      },
      onQuitToTitle: () => {
        saveProgression(this.progression);
        this.started = false;
        this.paused = false;
        this.input.setUiBlocked(true);
        this.input.setPointerLockAllowed(false);
        this.clearCombatEntities();
        this.activeBossId = null;
        this.tangentArc.group.visible = false;
        this.cameraCtrl.lockedOn = false;
        this.playerPos.set(0, getTerrainHeight(0, 4), 4);
        this.playerYaw = Math.PI;
        this.playerRig.root.position.copy(this.playerPos);
        this.cameraCtrl.resetSmoothing(this.playerPos, this.playerYaw);
        this.syncControlVisibility();
        this.ui.showTitleOverlay(this.settings);
        this.ui.showToast('SAVED & RETURNED TO TITLE');
      },
      onWarpBoss: (target) => {
        this.warpToLandmark(target);
      },
      onSelectSigil: (sigil) => {
        this.player.selectedSigil = sigil;
        this.playerRig.setSigilAccent(SIGIL_BY_ID[sigil].accentHex);
        const idx = DERIVATIVE_SIGILS.findIndex((s) => s.id === sigil);
        if (idx >= 0) this.input.setCurrentSigilIndex(idx);
        this.audio.unlock();
      },
      onTogglePov: () => this.handleTogglePov(),
      onToggleLockOn: () => this.handleToggleLockOn(),
      onOpenWheel: () => {
        this.wheelSlowMo = true;
        this.ui.setRadialWheelVisible(true);
      },
      onCloseWheel: () => {
        this.wheelSlowMo = false;
        this.ui.setRadialWheelVisible(false);
      },
      onTouchAction: (action) => this.input.triggerAction(action, performance.now() / 1000),
      onTouchStick: (nx, ny) => this.input.setTouchStick(nx, ny),
      onUpdateSettings: (next) => {
        this.settings = next;
        saveSettings(next);
        this.applyGraphicsSettings();
        this.syncControlVisibility();
        this.ui.syncSettings(next);
      },
      onToggleGodMode: () => {
        this.player.godMode = !this.player.godMode;
        this.ui.showToast(`GOD MODE: ${this.player.godMode ? 'ON' : 'OFF'}`);
      },
      onToggleInfiniteStamina: () => {
        this.player.infiniteStamina = !this.player.infiniteStamina;
        this.ui.showToast(`INFINITE STAMINA: ${this.player.infiniteStamina ? 'ON' : 'OFF'}`);
      },
      onToggleFreezeTheta: () => {
        this.freezeTheta = !this.freezeTheta;
        this.ui.showToast(`FREEZE θ: ${this.freezeTheta ? 'ON' : 'OFF'}`);
      },
      onForceStagger: () => {
        const activeBoss = this.getActiveBoss();
        if (activeBoss) {
          forceBossStagger(activeBoss);
          this.ui.showToast('DEV: BOSS STAGGERED');
        } else {
          this.ui.showToast('NO ACTIVE BOSS IN RANGE');
        }
      },
      onOpenWorkedExample: () => {
        this.paused = true;
        this.input.setUiBlocked(true);
        this.input.setPointerLockAllowed(false);
        const activeBoss = this.getActiveBoss();
        const snap =
          this.lastWorkedExample ??
          buildWorkedExample(
            activeBoss ? activeBoss.activeFunction : 'sin',
            activeBoss ? activeBoss.theta : Math.PI / 3,
            this.player.selectedSigil,
            'resonance_hit',
            3.25,
          );
        this.ui.showWorkedExample(snap);
      },
      onCloseWorkedExample: () => {
        this.paused = false;
        this.input.setUiBlocked(!this.started);
        this.input.setPointerLockAllowed(this.started);
      },
      onOpenSettings: () => {
        if (!this.started) {
          this.ui.openTitleSettings();
          return;
        }
        this.paused = true;
        this.syncPauseState();
      },
      onCloseSettings: () => {
        this.paused = false;
        this.syncPauseState();
      },
      onInteract: () => {
        this.handleInteract();
      },
    }, this.settings);

    this.input.setUiBlocked(true);
    this.input.setPointerLockAllowed(false);

    this.applyGraphicsSettings();
    this.syncControlVisibility();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());

    this.timer.connect(document);
    Object.assign(window, {
      renderer: this.renderer,
      scene: this.scene,
      __GAME__: this,
    });
  }

  public start(): void {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private syncPauseState(initialTab: 'gameplay' | 'dev' = 'gameplay'): void {
    if (this.paused) {
      this.input.setUiBlocked(true);
      this.input.setPointerLockAllowed(false);
      this.ui.setPointerHintVisible(false);
      this.ui.openSettingsModal(
        this.settings,
        this.player,
        this.getActiveBoss(),
        this.freezeTheta,
        this.getTelemetry(),
        initialTab,
        this.progression,
      );
    } else {
      this.ui.closeSettingsModal();
      this.input.setUiBlocked(false);
      this.input.setPointerLockAllowed(true);
      this.ui.setPointerHintVisible(!this.isMobileUiActive() && !this.input.isPointerLocked());
    }
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    this.syncControlVisibility();
  }

  private applyGraphicsSettings(): void {
    const profile = PRESET_PROFILES[this.settings.preset];
    const dpr = Math.min(window.devicePixelRatio || 1, profile.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);
    this.bloomEnabled = profile.bloomGlow;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.keyLight.castShadow = profile.shadows;
    if (this.keyLight.shadow.mapSize.width !== profile.shadowMapSize) {
      this.keyLight.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    this.arena.setEmberCount(profile.particleCount);
    this.audio.setConfig(this.settings.audioEnabled, this.settings.audioVolume);
  }

  private isMobileUiActive(): boolean {
    const mode = this.settings.controlMode;
    return mode === 'mobile' || (mode === 'auto' && this.input.isTouchDevice);
  }

  private syncControlVisibility(): void {
    this.ui.setMobileControlsVisible(this.started && this.isMobileUiActive());
  }

  public getActiveBoss(): BossRuntime | null {
    if (!this.activeBossId) return null;
    return this.bossRuntimes[this.activeBossId] ?? null;
  }

  private warpToLandmark(target: BossId | 'hub'): void {
    const lm = LANDMARK_BY_ID[target];
    const targetX = target === 'hub' ? 0 : lm.x;
    const targetZ = target === 'hub' ? 4 : lm.z + 10;
    const targetY = getTerrainHeight(targetX, targetZ);

    this.playerPos.set(targetX, targetY, targetZ);
    this.playerVelocityY = 0;
    this.isGrounded = true;
    this.playerYaw = target === 'hub' ? Math.PI : Math.atan2(lm.x - targetX, lm.z - targetZ);

    this.cameraCtrl.resetSmoothing(this.playerPos, this.playerYaw);
    this.clearCombatEntities();

    if (target === 'hub') {
      if (this.isCutscenePlaying) {
        this.endBossCutscene();
      }
      this.activeBossId = null;
      this.tangentArc.group.visible = false;
      this.cameraCtrl.lockedOn = false;
      this.ui.showToast("WARPED: ADVENTURER'S PLAZA");
    } else {
      this.activeBossId = target;
      const boss = this.bossRuntimes[target];
      if (boss.phase === 'DEFEATED') {
        // Respawn boss cleanly when explicitly warped to from Waypoint menu
        const fresh = createBossRuntime(target, {
          homeX: lm.x,
          homeY: lm.baseHeight,
          homeZ: lm.z,
          startIdle: false,
        });
        Object.assign(boss, fresh);
        this.bossRigs[target].root.scale.setScalar(1);
      }
      this.audio.playBossCue();
      if (!this.seenBossCutscenes.has(target)) {
        this.triggerBossCutscene(target);
      } else {
        engageBoss(boss);
        this.tangentArc.group.visible = true;
        this.cameraCtrl.lockedOn = true;
        this.ui.showToast(`WARPED: ${lm.name.toUpperCase()}`);
      }
    }
  }

  private clearCombatEntities(): void {
    this.vfx.clear();
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    for (const s of this.shockwaves) this.scene.remove(s.mesh);
    this.shockwaves.length = 0;
  }

  private handleTogglePov(): void {
    const next = this.cameraCtrl.togglePov();
    this.playerRig.setFirstPersonHidden(next === 'first');
    this.ui.showToast(next === 'first' ? '1ST-PERSON ASTROLABE POV' : '3RD-PERSON COMBAT POV');
  }

  private handleToggleLockOn(): void {
    const activeBoss = this.getActiveBoss();
    if (!activeBoss || activeBoss.phase === 'IDLE_GUARD') return;
    this.cameraCtrl.lockedOn = !this.cameraCtrl.lockedOn;
    this.ui.showToast(this.cameraCtrl.lockedOn ? 'TARGET LOCKED' : 'LOCK RELEASED');
  }

  private tick(): void {
    this.timer.update();
    const rawRealDt = Math.min(Math.max(this.timer.getDelta(), 0), 0.1);

    if (this.settings.fpsCap > 0) {
      this.fpsAccumulator += rawRealDt;
      const targetStep = 1 / this.settings.fpsCap;
      if (this.fpsAccumulator < targetStep * 0.96) {
        return;
      }
      this.fpsAccumulator %= targetStep;
    }

    const now = performance.now();
    const renderedDt = Math.max(0.001, (now - this.lastFrameTimestamp) / 1000);
    this.lastFrameTimestamp = now;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + renderedDt * 1000 * 0.1;
    this.smoothedFps = this.smoothedFps * 0.9 + (1 / renderedDt) * 0.1;

    const modalOpen = this.paused || this.ui.isModalOpen();
    if (!modalOpen && this.started) {
      if (this.isCutscenePlaying) {
        this.stepCutscene(renderedDt);
        return;
      }
      this.stepSimulation(renderedDt);
    } else {
      this.totalTime += renderedDt;
      this.stepEnvironmentVisuals();
      if (!this.started) {
        const orbitRadius = 24;
        const orbitSpeed = 0.08;
        const camX = Math.cos(this.totalTime * orbitSpeed) * orbitRadius;
        const camZ = Math.sin(this.totalTime * orbitSpeed) * orbitRadius;
        const camY = getTerrainHeight(camX, camZ) + 8.5;
        this.camera.position.set(camX, camY, camZ);
        this.camera.lookAt(0, 3, 0);
      } else {
        this.cameraCtrl.update(
          this.camera,
          this.playerPos,
          null,
          renderedDt,
          renderedDt,
          this.settings.shakeStrength,
        );
      }
    }

    // Keep key sunlight shadow frustum centered around player
    this.keyLight.position.set(this.playerPos.x + 28, 48, this.playerPos.z - 36);
    this.keyLight.target.position.set(this.playerPos.x, this.playerPos.y, this.playerPos.z);
    this.keyLight.target.updateMatrixWorld();

    this.renderer.info.reset();
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public triggerBossCutscene(bossId: BossId): void {
    this.isCutscenePlaying = true;
    this.cutsceneTime = 0;
    this.cutsceneBossId = bossId;
    this.seenBossCutscenes.add(bossId);
    this.activeBossId = bossId;
    this.cameraCtrl.lockedOn = false;

    // Face player toward boss
    const boss = this.bossRuntimes[bossId];
    this.playerYaw = Math.atan2(boss.homeX - this.playerPos.x, boss.homeZ - this.playerPos.z);
    this.playerRig.root.rotation.y = this.playerYaw;

    this.audio.playBossCue();
    this.ui.showBossCutscene(bossId, () => {
      this.endBossCutscene();
    });
  }

  public endBossCutscene(): void {
    if (!this.isCutscenePlaying) return;
    this.isCutscenePlaying = false;
    this.ui.hideBossCutscene();
    if (this.cutsceneBossId) {
      const boss = this.bossRuntimes[this.cutsceneBossId];
      engageBoss(boss);
      this.tangentArc.group.visible = true;
      this.cameraCtrl.lockedOn = true;
      this.cameraCtrl.resetSmoothing(this.playerPos, this.playerYaw);
      this.ui.showToast(`ENGAGED: ${BOSS_CONFIGS[this.cutsceneBossId].name.toUpperCase()}`);
    }
  }

  private stepCutscene(dt: number): void {
    this.totalTime += dt;
    this.stepEnvironmentVisuals();

    if (!this.cutsceneBossId) {
      this.endBossCutscene();
      return;
    }

    const nowSec = performance.now() / 1000;
    if (
      this.input.buffer.consume('jump', nowSec) ||
      this.input.buffer.consume('attack', nowSec) ||
      this.input.buffer.consume('castSigil', nowSec)
    ) {
      this.endBossCutscene();
      return;
    }

    this.cutsceneTime += dt;
    if (this.cutsceneTime >= this.cutsceneDuration) {
      this.endBossCutscene();
      return;
    }

    const boss = this.bossRuntimes[this.cutsceneBossId];
    const bossRig = this.bossRigs[this.cutsceneBossId];

    // Smooth cubic ease: 0 to 1
    const t = Math.min(1, this.cutsceneTime / this.cutsceneDuration);
    const smoothT = t * t * (3 - 2 * t);

    // Sweeping cinematic camera arc focusing on the majestic boss and sanctuary
    const camAngle = this.playerYaw + 0.35 + smoothT * 1.05;
    const camDist = 14.5 - smoothT * 4.0;
    const camY = boss.homeY + 1.2 + smoothT * 2.5;
    const camX = boss.homeX + Math.sin(camAngle) * camDist;
    const camZ = boss.homeZ + Math.cos(camAngle) * camDist;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(boss.homeX, boss.homeY + 2.5, boss.homeZ);

    // Roar/surge animation for boss
    bossRig.root.position.set(
      boss.homeX,
      boss.homeY + Math.sin(this.cutsceneTime * 3) * 0.25,
      boss.homeZ,
    );
    bossRig.root.lookAt(this.playerPos.x, boss.homeY, this.playerPos.z);
    bossRig.wardMesh.visible = true;
    bossRig.coreMesh.scale.setScalar(1.2 + Math.sin(this.cutsceneTime * 8) * 0.3);

    if (bossRig.wingLeft && bossRig.wingRight) {
      bossRig.wingLeft.rotation.z = 0.85 + Math.sin(this.cutsceneTime * 6) * 0.45;
      bossRig.wingRight.rotation.z = -0.85 - Math.sin(this.cutsceneTime * 6) * 0.45;
    }
    bossRig.orbitParts.forEach((p, idx) => {
      const a = this.cutsceneTime * 3.5 + (idx * Math.PI * 2) / bossRig.orbitParts.length;
      p.position.set(Math.cos(a) * 3.4, 2.5 + Math.sin(a * 2) * 0.5, Math.sin(a) * 3.4);
      p.rotation.y = a;
    });

    // Shadow light on boss
    this.keyLight.position.set(boss.homeX + 28, boss.homeY + 48, boss.homeZ - 36);
    this.keyLight.target.position.set(boss.homeX, boss.homeY, boss.homeZ);
    this.keyLight.target.updateMatrixWorld();

    // Render
    this.renderer.info.reset();
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private stepSimulation(realDt: number): void {
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining = Math.max(0, this.hitStopRemaining - realDt);
      this.timeScale = 0.06;
    } else if (this.wheelSlowMo) {
      this.timeScale = 0.2;
    } else {
      this.timeScale = 1.0;
    }

    const dt = realDt * this.timeScale;
    this.totalTime += dt;
    const nowSec = performance.now() / 1000;

    // Camera Look
    const look = this.input.consumeLookDelta();
    this.cameraCtrl.applyLookDelta(look.dx, look.dy, this.settings.sensitivity);

    // Discrete Inputs
    if (this.input.buffer.consume('togglePov', nowSec)) {
      this.handleTogglePov();
    }
    if (this.input.buffer.consume('lockOn', nowSec)) {
      this.handleToggleLockOn();
    }
    if (this.input.buffer.consume('interact', nowSec)) {
      this.handleInteract();
    }
    if (this.input.buffer.consume('heal', nowSec) && tryUseHealFlask(this.player)) {
      this.audio.playHeal();
      this.vfx.spawnBurst(
        new THREE.Vector3(this.playerPos.x, this.playerPos.y + 1.2, this.playerPos.z),
        0xf2c864,
        18,
        4.2,
        0.48,
      );
      this.ui.showToast('CRIMSON FLASK RESTORED HP');
    }

    // Jump Input
    if (this.input.buffer.consume('jump', nowSec) && this.isGrounded) {
      this.playerVelocityY = 9.8;
      this.isGrounded = false;
      this.audio.playJump();
    }

    // Movement & Sprint
    const move = this.input.getMoveVector();
    this.cameraCtrl.getForwardXZ(this.forwardVec);
    this.cameraCtrl.getRightXZ(this.rightVec);

    const worldMoveX = this.rightVec.x * move.x - this.forwardVec.x * move.y;
    const worldMoveZ = this.rightVec.y * move.x - this.forwardVec.y * move.y;

    if (this.input.buffer.consume('dodge', nowSec)) {
      if (tryStartDodge(this.player, { x: worldMoveX, z: worldMoveZ })) {
        this.audio.playDodge();
        this.vfx.spawnBurst(
          new THREE.Vector3(this.playerPos.x, this.playerPos.y + 0.7, this.playerPos.z),
          new THREE.Color(SIGIL_BY_ID[this.player.selectedSigil].accentHex).getHex(),
          12,
          4.5,
          0.38,
        );
      }
    }

    stepPlayerState(this.player, dt);

    let isMoving = false;
    const isSprinting = this.input.isSprinting();
    const moveSpeed = isSprinting ? 11.2 : 7.2;

    if (this.player.dodgeTimer > 0) {
      const dodgeSpeed = 14.5;
      this.playerPos.x += this.player.dodgeDirX * dodgeSpeed * dt;
      this.playerPos.z += this.player.dodgeDirZ * dodgeSpeed * dt;
      this.playerRig.bodyMeshGroup.rotation.x = 0.52;
    } else {
      this.playerRig.bodyMeshGroup.rotation.x = 0;
      if (Math.hypot(worldMoveX, worldMoveZ) > 0.05) {
        isMoving = true;
        this.playerPos.x += worldMoveX * moveSpeed * dt;
        this.playerPos.z += worldMoveZ * moveSpeed * dt;
        const targetYaw = Math.atan2(worldMoveX, worldMoveZ);
        let diff = targetYaw - this.playerYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.playerYaw += diff * Math.min(1, 14 * dt);
      }
    }

    // Terrain height following & jump gravity
    const groundY = getTerrainHeight(this.playerPos.x, this.playerPos.z);
    const gravity = -24.0;
    this.playerVelocityY += gravity * dt;
    this.playerPos.y += this.playerVelocityY * dt;

    if (this.playerPos.y <= groundY) {
      this.playerPos.y = groundY;
      this.playerVelocityY = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    // Articulated walk / run / idle / cape animation
    const animRate = isSprinting ? 15.5 : 11.5;
    if (isMoving) {
      this.walkCyclePhase += dt * animRate;
      const stride = Math.sin(this.walkCyclePhase);
      this.playerRig.legLeft.rotation.x = stride * (isSprinting ? 0.78 : 0.62);
      this.playerRig.legRight.rotation.x = -stride * (isSprinting ? 0.78 : 0.62);
      this.playerRig.armLeft.rotation.x = -stride * 0.45;
      if (this.bladeSwingTimer <= 0) {
        this.playerRig.armRight.rotation.x = stride * 0.35;
      }
      this.playerRig.bodyMeshGroup.position.y = Math.abs(Math.cos(this.walkCyclePhase)) * 0.06;
      this.playerRig.cloakPivot.rotation.x = (isSprinting ? 0.45 : 0.25) + Math.abs(stride) * 0.15;
    } else if (this.player.dodgeTimer <= 0) {
      this.playerRig.legLeft.rotation.x *= 0.82;
      this.playerRig.legRight.rotation.x *= 0.82;
      this.playerRig.armLeft.rotation.x *= 0.82;
      if (this.bladeSwingTimer <= 0) {
        this.playerRig.armRight.rotation.x = Math.sin(this.totalTime * 2.2) * 0.04;
      }
      this.playerRig.bodyMeshGroup.position.y = Math.sin(this.totalTime * 2.2) * 0.02;
      this.playerRig.cloakPivot.rotation.x = 0.06 + Math.sin(this.totalTime * 2.8) * 0.05;
    }

    // Keep player inside expansive playable valley boundary
    const pr = Math.hypot(this.playerPos.x, this.playerPos.z);
    if (pr > WORLD_PLAYABLE_RADIUS - 1.5) {
      const s = (WORLD_PLAYABLE_RADIUS - 1.5) / pr;
      this.playerPos.x *= s;
      this.playerPos.z *= s;
    }

    // Collision against Solstice Haven village structures (cottages, fountain, gazebo)
    for (const obs of this.village.obstacles) {
      const dx = this.playerPos.x - obs.x;
      const dz = this.playerPos.z - obs.z;
      const d = Math.hypot(dx, dz);
      const minD = obs.radius + 0.65;
      if (d < minD && d > 0.001) {
        this.playerPos.x = obs.x + (dx / d) * minD;
        this.playerPos.z = obs.z + (dz / d) * minD;
      }
    }

    // Update Solstice Haven Village animations
    this.village.update(dt);

    // Check NPC interaction proximity
    let foundNpc: InteractiveNpcEntity | null = null;
    for (const npc of this.village.interactiveNpcs) {
      const dist = this.playerPos.distanceTo(npc.position);
      if (dist <= npc.interactionRadius) {
        foundNpc = npc;
        break;
      }
    }
    this.nearbyNpc = foundNpc;
    if (this.nearbyNpc && !this.dialogueRunner.isOpen) {
      this.ui.showInteractPrompt(`Talk to ${this.nearbyNpc.name}`);
    } else if (!this.nearbyNpc && !this.dialogueRunner.isOpen) {
      this.ui.hideInteractPrompt();
    }

    // Combat actions
    if (this.input.buffer.consume('attack', nowSec) && this.player.attackCooldown <= 0) {
      this.performBasicAttack();
    }
    if (this.input.buffer.consume('castSigil', nowSec) && this.player.resonanceCooldown <= 0) {
      this.performResonanceCast();
    }

    // Blade swing animation
    if (this.bladeSwingTimer > 0) {
      this.bladeSwingTimer = Math.max(0, this.bladeSwingTimer - dt);
      const swing = Math.sin((this.bladeSwingTimer / 0.25) * Math.PI);
      this.playerRig.armRight.rotation.x = -swing * 1.15;
      this.playerRig.bladePivot.rotation.x = -swing * 1.25;
      this.playerRig.firstPersonBlade.rotation.x = -swing * 0.78;
      this.playerRig.firstPersonBlade.rotation.z = swing * 0.25;
    } else {
      this.playerRig.bladePivot.rotation.x = 0;
      this.playerRig.firstPersonBlade.rotation.x = Math.sin(this.totalTime * 2.4) * 0.015;
      this.playerRig.firstPersonBlade.rotation.z = 0;
    }

    this.playerRig.root.position.copy(this.playerPos);
    this.playerRig.root.rotation.y =
      this.cameraCtrl.pov === 'first' ? this.cameraCtrl.yaw + Math.PI : this.playerYaw;
    this.playerRig.astrolabeRing.rotation.z += dt * 1.15;
    this.playerRig.outerHaloRing.rotation.z -= dt * 0.72;
    this.playerRig.fpAstrolabeRing.rotation.z += dt * 1.5;
    this.playerRig.fpAstrolabeRing.rotation.y += dt * 0.8;

    // Open-world boss territory encounter detection
    this.stepProximityBossEncounters();

    // Step AI & models for all bosses
    let lockTarget: THREE.Vector3 | null = null;
    for (const id of BOSS_ORDER) {
      const boss = this.bossRuntimes[id];
      const bossRig = this.bossRigs[id];

      if (boss.phase === 'DEFEATED') {
        if (this.activeBossId === id) {
          this.activeBossId = null;
          this.tangentArc.group.visible = false;
          this.cameraCtrl.lockedOn = false;
          this.vfx.spawnBurst(new THREE.Vector3(boss.x, boss.y + 1.8, boss.z), 0xffe49c, 32, 9.0, 0.65);
          this.audio.playWardShatter(true);
          this.ui.showToast(`${BOSS_CONFIGS[id].name.toUpperCase()} VANQUISHED!`);
        }
        bossRig.root.scale.setScalar(0.01);
        continue;
      }

      const events = stepBossAI(
        boss,
        dt,
        { x: this.playerPos.x, z: this.playerPos.z },
        this.freezeTheta,
        getTerrainHeight,
      );
      if (this.activeBossId === id) {
        this.handleBossEvents(events, boss);
      }

      bossRig.root.position.set(boss.x, boss.y, boss.z);
      bossRig.root.rotation.y = boss.facingYaw;
      bossRig.bodyGroup.position.y = Math.sin(this.totalTime * 2.1) * 0.12;
      bossRig.coreMesh.rotation.y += dt * 1.8;
      bossRig.wardMesh.visible = boss.wardActive;

      const slopeMag = Math.abs(evaluateExactDerivative(boss.activeFunction, boss.theta).value);
      bossRig.wardMat.uniforms.uTime.value = this.totalTime;
      bossRig.wardMat.uniforms.uPulse.value = Math.min(1.65, 0.4 + slopeMag * 0.25);

      const orbitSpeed = 1.5 + Math.min(3.5, slopeMag * 0.25);
      bossRig.orbitParts.forEach((p, idx) => {
        const a = this.totalTime * orbitSpeed + (idx * Math.PI * 2) / bossRig.orbitParts.length;
        p.position.set(Math.cos(a) * 2.15, 2.25 + Math.sin(a * 2) * 0.35, Math.sin(a) * 2.15);
        p.rotation.y = -a;
      });

      if (bossRig.wingLeft && bossRig.wingRight) {
        const flap = Math.sin(this.totalTime * 5.8) * 0.42;
        bossRig.wingLeft.rotation.z = flap;
        bossRig.wingRight.rotation.z = -flap;
      }
      if (bossRig.tailSegments) {
        bossRig.tailSegments.forEach((seg, idx) => {
          seg.rotation.y = Math.sin(this.totalTime * 3.4 - idx * 0.55) * 0.18;
        });
      }
      if (bossRig.neckSegments) {
        bossRig.neckSegments.forEach((seg, idx) => {
          seg.rotation.x = Math.sin(this.totalTime * 2.3 - idx * 0.4) * 0.08;
        });
      }
      if (bossRig.veilRibbons) {
        bossRig.veilRibbons.forEach((rib, idx) => {
          rib.rotation.x = 0.18 + Math.sin(this.totalTime * 3.0 + idx) * 0.14;
        });
      }

      if (this.activeBossId === id) {
        const profile = PRESET_PROFILES[this.settings.preset];
        this.tangentArc.group.visible = true;
        this.tangentArc.updateCurve(
          boss.activeFunction,
          boss.theta,
          bossRig.root.position,
          BOSS_CONFIGS[boss.id].accentColor,
          profile.waveRibbonSegments,
        );

        this.bossLight.position.set(boss.x, boss.y + 3.2, boss.z);
        this.bossLight.color.setHex(BOSS_CONFIGS[boss.id].accentColor);
        lockTarget = new THREE.Vector3(boss.x, boss.y + 1.8, boss.z);
      }
    }

    if (!this.activeBossId) {
      this.tangentArc.group.visible = false;
    }

    this.stepProjectilesAndShockwaves(dt);
    this.vfx.step(dt);
    this.stepEnvironmentVisuals();

    this.cameraCtrl.update(
      this.camera,
      this.playerPos,
      lockTarget,
      dt,
      realDt,
      this.settings.shakeStrength,
    );

    if (this.player.hp <= 0) {
      this.ui.showToast('RESONANCE SHATTERED — RESTORED AT ADVENTURER’S PLAZA');
      this.warpToLandmark('hub');
      this.player.hp = computeEffectiveStat(this.player, 'maxHp');
      this.player.stamina = computeEffectiveStat(this.player, 'maxStamina');
      this.player.flasksRemaining = 3;
    }

    this.uiUpdateCooldown -= realDt;
    if (this.uiUpdateCooldown <= 0) {
      this.uiUpdateCooldown = 0.05;
      const currentRegion = getRegionAt(this.playerPos.x, this.playerPos.z);
      this.ui.updateHUD(
        this.player,
        this.getActiveBoss(),
        this.cameraCtrl.pov,
        this.settings,
        this.getTelemetry(),
        currentRegion,
        this.progression,
      );
    }
  }

  private stepProximityBossEncounters(): void {
    let closestBossId: BossId | null = null;
    let closestDist = Infinity;

    for (const id of BOSS_ORDER) {
      const boss = this.bossRuntimes[id];
      if (boss.phase === 'DEFEATED') continue;
      const d = Math.hypot(this.playerPos.x - boss.homeX, this.playerPos.z - boss.homeZ);
      if (d < closestDist) {
        closestDist = d;
        closestBossId = id;
      }
    }

    if (closestBossId && closestDist <= BOSS_CONFIGS[closestBossId].territoryRadius) {
      if (this.activeBossId !== closestBossId) {
        if (!this.seenBossCutscenes.has(closestBossId)) {
          this.triggerBossCutscene(closestBossId);
        } else {
          this.activeBossId = closestBossId;
          const b = this.bossRuntimes[closestBossId];
          engageBoss(b);
          this.audio.playBossCue();
          this.ui.showToast(`ENTERING: ${BOSS_CONFIGS[closestBossId].name.toUpperCase()} TERRITORY`);
        }
      }
    } else if (this.activeBossId) {
      const current = this.bossRuntimes[this.activeBossId];
      const d = Math.hypot(this.playerPos.x - current.homeX, this.playerPos.z - current.homeZ);
      if (d > BOSS_CONFIGS[this.activeBossId].territoryRadius + 6) {
        resetBossToIdle(current);
        this.activeBossId = null;
        this.tangentArc.group.visible = false;
        this.cameraCtrl.lockedOn = false;
        this.ui.showToast('LEAVING BOSS TERRITORY');
      }
    }
  }

  private performBasicAttack(): void {
    this.player.attackCooldown = 0.34;
    this.player.comboStep += 1;
    this.bladeSwingTimer = 0.25;
    this.audio.playSlash(this.player.comboStep);

    const sigilHex = new THREE.Color(SIGIL_BY_ID[this.player.selectedSigil].accentHex).getHex();
    const slashYaw = this.cameraCtrl.pov === 'first' ? this.cameraCtrl.yaw + Math.PI : this.playerYaw;
    this.vfx.spawnSlashArc(this.playerPos, slashYaw, this.player.comboStep, sigilHex);

    const activeBoss = this.getActiveBoss();
    if (!activeBoss || activeBoss.phase === 'DEFEATED' || activeBoss.phase === 'IDLE_GUARD') return;
    const dist = Math.hypot(activeBoss.x - this.playerPos.x, activeBoss.z - this.playerPos.z);
    if (dist > 5.5) return;

    const cfg = BOSS_CONFIGS[activeBoss.id];
    const res = resolveBasicAttack(this.player, {
      activeFunction: activeBoss.activeFunction,
      theta: activeBoss.theta,
      wardActive: activeBoss.wardActive,
      bossDefense: cfg.defense,
    });
    this.lastWorkedExample = res.workedExample;
    applyDamageToBoss(activeBoss, res.damage, res.staggerGain, false);
    if (activeBoss.hp <= 0 || (activeBoss.phase as string) === 'DEFEATED') {
      recordBossDefeat(this.progression, activeBoss.id, 250);
      applyProgressionToPlayer(this.player, computeEffectiveStats(this.progression));
      saveProgression(this.progression);
      this.ui.showToast(`BOSS DEFEATED! +250 XP · ASTRAL LEVEL ${this.progression.level}`);
    }
    this.vfx.spawnBurst(
      new THREE.Vector3(activeBoss.x, activeBoss.y + 1.6, activeBoss.z),
      0xf5d48a,
      10,
      5.2,
      0.38,
    );
    this.cameraCtrl.addTrauma(0.2);
    this.ui.showToast(`STRIKE: ${res.damage}`);
  }

  private performResonanceCast(): void {
    if (!canSpendResonanceStamina(this.player)) {
      this.ui.showToast('INSUFFICIENT STAMINA');
      return;
    }
    this.player.resonanceCooldown = 0.55;
    this.bladeSwingTimer = 0.25;

    const sigilMeta = SIGIL_BY_ID[this.player.selectedSigil];
    const color = new THREE.Color(sigilMeta.accentHex).getHex();

    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(this.playerPos.x, this.playerPos.y + 1.5, this.playerPos.z);
    this.scene.add(mesh);

    let dirX = -Math.sin(this.cameraCtrl.yaw);
    let dirZ = -Math.cos(this.cameraCtrl.yaw);
    const activeBoss = this.getActiveBoss();
    if (activeBoss && activeBoss.phase !== 'DEFEATED' && activeBoss.phase !== 'IDLE_GUARD') {
      const dx = activeBoss.x - this.playerPos.x;
      const dz = activeBoss.z - this.playerPos.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      dirX = dx / len;
      dirZ = dz / len;
    }

    this.projectiles.push({
      mesh,
      vx: dirX * 28,
      vz: dirZ * 28,
      life: 1.5,
      damage: 0,
      fromPlayer: true,
    });
    this.audio.playSlash(2);
  }

  private resolvePlayerProjectileHit(boss: BossRuntime): void {
    const cfg = BOSS_CONFIGS[boss.id];
    const res = resolveResonanceStrike(this.player, {
      activeFunction: boss.activeFunction,
      theta: boss.theta,
      wardActive: boss.wardActive,
      bossDefense: cfg.defense,
      chosenSigil: this.player.selectedSigil,
      firstPersonAim: this.cameraCtrl.pov === 'first',
    });

    this.lastWorkedExample = res.workedExample;
    applyDamageToBoss(boss, res.damage, res.staggerGain, res.wardShattered);
    if (boss.hp <= 0 || (boss.phase as string) === 'DEFEATED') {
      recordBossDefeat(this.progression, boss.id, 250);
      applyProgressionToPlayer(this.player, computeEffectiveStats(this.progression));
      saveProgression(this.progression);
      this.ui.showToast(`BOSS DEFEATED! +250 XP · ASTRAL LEVEL ${this.progression.level}`);
    }
    const hitOrigin = new THREE.Vector3(boss.x, boss.y + 1.8, boss.z);
    const sigilHex = new THREE.Color(SIGIL_BY_ID[this.player.selectedSigil].accentHex).getHex();

    if (res.triggerBacklash) {
      this.audio.playBacklash();
      this.cameraCtrl.addTrauma(0.45);
      this.vfx.spawnBurst(hitOrigin, 0xc9323c, 16, 6.2, 0.45);
      this.spawnShockwave(boss.x, boss.z, 9.0, 16, 0xc9323c);
      this.ui.showToast(`MISMATCH! BACKLASH (${res.damage})`);
    } else if (res.outcomeKind === 'critical_stagger') {
      this.audio.playWardShatter(true);
      this.cameraCtrl.addTrauma(0.85);
      this.hitStopRemaining = 0.1;
      this.vfx.spawnBurst(hitOrigin, 0xffe49c, 28, 8.5, 0.58);
      this.ui.showToast(`CRITICAL TANGENT f′≈0! ${res.multiplier}× (${res.damage})`);
    } else if (res.wardShattered) {
      this.audio.playWardShatter(false);
      this.cameraCtrl.addTrauma(0.68);
      this.hitStopRemaining = 0.08;
      this.vfx.spawnBurst(hitOrigin, sigilHex, 24, 7.6, 0.52);
      this.ui.showToast(`WARD SHATTERED! ${res.multiplier}× (${res.damage})`);
    } else {
      this.audio.playWardShatter(false);
      this.cameraCtrl.addTrauma(0.42);
      this.vfx.spawnBurst(hitOrigin, sigilHex, 15, 6.0, 0.44);
      this.ui.showToast(`RESONANCE HIT! ${res.multiplier}× (${res.damage})`);
    }
  }

  private handleBossEvents(events: ReturnType<typeof stepBossAI>, boss: BossRuntime): void {
    const cfg = BOSS_CONFIGS[boss.id];
    for (const ev of events) {
      if (ev.kind === 'projectile_orb') {
        // Telegraphed 0.8s ground runic circle under player for magic volleys
        this.vfx.spawnGroundTelegraph(this.playerPos.x, this.playerPos.z, 2.2, 0.8, cfg.accentColor);

        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.38, 10, 8),
          new THREE.MeshBasicMaterial({ color: cfg.accentColor }),
        );
        orb.position.set(ev.originX, boss.y + 1.2, ev.originZ);
        this.scene.add(orb);
        this.projectiles.push({
          mesh: orb,
          vx: ev.dirX * ev.speed,
          vz: ev.dirZ * ev.speed,
          life: 3.2,
          damage: ev.damage,
          fromPlayer: false,
        });
      } else if (ev.kind === 'wave_pulse') {
        // 0.8s telegraphed expanding runic warning before shockwave detonation
        this.vfx.spawnGroundTelegraph(ev.originX, ev.originZ, ev.radius, 0.8, cfg.accentColor, () => {
          this.spawnShockwave(ev.originX, ev.originZ, ev.radius, ev.damage, cfg.accentColor);
        });
      } else if (ev.kind === 'beam_sweep') {
        const dirX = Math.sin(ev.angle);
        const dirZ = Math.cos(ev.angle);
        // Telegraph upcoming laser furrow
        this.vfx.spawnGroundTelegraph(boss.x + dirX * 6, boss.z + dirZ * 6, 1.8, 0.65, cfg.accentColor);

        const bolt = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.35, 1.8),
          new THREE.MeshBasicMaterial({ color: cfg.accentColor }),
        );
        bolt.position.set(boss.x, boss.y + 1.2, boss.z);
        bolt.lookAt(boss.x + dirX, boss.y + 1.2, boss.z + dirZ);
        this.scene.add(bolt);
        this.projectiles.push({
          mesh: bolt,
          vx: dirX * 16,
          vz: dirZ * 16,
          life: 2.2,
          damage: ev.damage,
          fromPlayer: false,
        });
      } else if (ev.kind === 'dive_slam') {
        // 0.85s telegraphed impact circle before dive shockwave
        this.vfx.spawnGroundTelegraph(ev.targetX, ev.targetZ, ev.radius, 0.85, cfg.accentColor, () => {
          this.spawnShockwave(ev.targetX, ev.targetZ, ev.radius, ev.damage, cfg.accentColor);
        });
      }
    }
  }

  private handleInteract(): void {
    if (this.dialogueRunner.isOpen) {
      this.dialogueRunner.closeDialogue();
      this.ui.closeDialogue();
      return;
    }
    if (!this.nearbyNpc) return;

    const node = this.dialogueRunner.startDialogue(this.nearbyNpc.role);
    if (!node) return;

    const choices = this.dialogueRunner.getAvailableChoices();
    this.ui.openDialogue(node, choices, this.progression, (choice) => {
      this.handleDialogueChoice(choice);
    });
  }

  private handleDialogueChoice(choice: DialogueChoice): void {
    const res = this.dialogueRunner.selectChoice(choice);
    if (res.closed || !res.nextNode) {
      this.ui.closeDialogue();
    } else {
      const nextChoices = this.dialogueRunner.getAvailableChoices();
      this.ui.openDialogue(res.nextNode, nextChoices, this.progression, (c) => {
        this.handleDialogueChoice(c);
      });
    }
  }

  private spawnShockwave(x: number, z: number, maxRadius: number, damage: number, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 1.0, 36),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, getTerrainHeight(x, z) + 0.15, z);
    this.scene.add(ring);
    this.shockwaves.push({
      mesh: ring,
      maxRadius,
      life: 0,
      maxLife: 0.78,
      damage,
      hitPlayer: false,
    });
  }

  private stepProjectilesAndShockwaves(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.y += dt * 6;

      if (Math.random() < 0.4) {
        const col = (p.mesh.material as THREE.MeshBasicMaterial).color.getHex();
        this.vfx.spawnTrail(p.mesh.position, col, p.fromPlayer ? 0.34 : 0.28);
      }

      let remove = p.life <= 0;
      const activeBoss = this.getActiveBoss();
      if (p.fromPlayer && activeBoss && activeBoss.phase !== 'DEFEATED' && activeBoss.phase !== 'IDLE_GUARD') {
        const d = Math.hypot(p.mesh.position.x - activeBoss.x, p.mesh.position.z - activeBoss.z);
        if (d < 2.5) {
          this.resolvePlayerProjectileHit(activeBoss);
          remove = true;
        }
      } else if (!p.fromPlayer) {
        const d = Math.hypot(p.mesh.position.x - this.playerPos.x, p.mesh.position.z - this.playerPos.z);
        if (d < 1.1) {
          const dealt = applyDamageToPlayer(this.player, p.damage);
          if (dealt > 0) this.cameraCtrl.addTrauma(0.35);
          remove = true;
        }
      }

      if (remove) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      const t = Math.min(1, sw.life / sw.maxLife);
      const radius = 0.8 + (sw.maxRadius - 0.8) * t;
      sw.mesh.scale.setScalar(radius);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;

      if (!sw.hitPlayer) {
        const dist = Math.hypot(sw.mesh.position.x - this.playerPos.x, sw.mesh.position.z - this.playerPos.z);
        if (Math.abs(dist - radius) < 1.1) {
          sw.hitPlayer = true;
          const dealt = applyDamageToPlayer(this.player, sw.damage);
          if (dealt > 0) this.cameraCtrl.addTrauma(0.42);
        }
      }

      if (sw.life >= sw.maxLife) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        (sw.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  private stepEnvironmentVisuals(): void {
    this.arena.skyMat.uniforms.uTime.value = this.totalTime;
    this.arena.waterMat.uniforms.uTime.value = this.totalTime;

    // Hover and rotate floating waypoints
    this.arena.waypoints.forEach((wp, idx) => {
      wp.mesh.rotation.y += 0.015;
      wp.mesh.position.y = 2.05 + Math.sin(this.totalTime * 2.2 + idx * 1.5) * 0.14;
    });

    // Sway wind chimes & rings
    this.arena.windChimes.forEach((c, idx) => {
      c.rotation.z = Math.sin(this.totalTime * 2.4 + idx) * 0.08;
    });

    // Sunlit pollen / blossom motes
    const posAttr = this.arena.emberPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = this.arena.emberBasePositions;
    for (let i = 0; i < posAttr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      const ground = getTerrainHeight(bx, bz);
      const y = ground + 0.4 + ((by + this.totalTime * 0.35) % 6.0);
      posAttr.setXYZ(i, bx + Math.sin(this.totalTime * 0.8 + i) * 0.35, y, bz + Math.cos(this.totalTime * 0.6 + i) * 0.35);
    }
    posAttr.needsUpdate = true;
  }

  private getTelemetry(): TelemetrySnapshot {
    return {
      fps: this.smoothedFps,
      frameMs: this.smoothedFrameMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
