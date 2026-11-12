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
  forceBossStagger,
  stepBossAI,
  type BossRuntime,
} from '../bosses/bossAI';
import { BOSS_CONFIGS, type BossId } from '../bosses/bossDefinitions';
import { DualCameraController } from '../camera/DualCameraController';
import {
  applyDamageToPlayer,
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
  loadSettings,
  PRESET_PROFILES,
  saveSettings,
  type GameSettings,
} from './GraphicsSettings';
import {
  ARENA_RADIUS,
  createArenaEnvironment,
  createBossModel,
  createPlayerModel,
  createTangentArcVisual,
  type ArenaBundle,
  type BossRig,
  type PlayerRig,
  type TangentArcVisual,
} from './ProceduralModels';

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
  private playerPos = new THREE.Vector3(0, 0, 8);
  private playerYaw = Math.PI;
  private boss: BossRuntime | null = null;
  private bossRig: BossRig | null = null;
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
  private bossVictoryPendingTimer = 0;
  private bloomEnabled = true;

  private fpsAccumulator = 0;
  private lastFrameTimestamp = performance.now();
  private smoothedFps = 60;
  private smoothedFrameMs = 16.6;
  private uiUpdateCooldown = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d16);
    this.scene.fog = new THREE.FogExp2(0x101320, 0.017);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 160);
    this.camera.add(new THREE.Object3D());

    // Post-processing pipeline (UnrealBloomPass enabled on High/Ultra presets)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.52, // subtle luminous dark fantasy bloom
      0.45,
      0.72,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Three.js r187 dark-fantasy 3-point lighting rig
    const hemi = new THREE.HemisphereLight(0x88a4d8, 0x2b2019, 1.15);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xf6dec0, 2.8);
    this.keyLight.position.set(12, 20, 11);
    const cam = this.keyLight.shadow.camera;
    cam.near = 2;
    cam.far = 55;
    cam.left = -24;
    cam.right = 24;
    cam.top = 24;
    cam.bottom = -24;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x6d92d8, 1.35);
    this.rimLight.position.set(-14, 11, -16);
    this.scene.add(this.rimLight);

    this.bossLight = new THREE.PointLight(0xc8a464, 4.2, 26);
    this.bossLight.position.set(0, 4, -8);
    this.scene.add(this.bossLight);

    this.arena = createArenaEnvironment();
    this.scene.add(this.arena.group);

    this.vfx = new VfxSystem(this.scene);

    this.playerRig = createPlayerModel();
    this.playerRig.root.position.copy(this.playerPos);
    this.playerRig.setSigilAccent(SIGIL_BY_ID[this.player.selectedSigil].accentHex);
    this.scene.add(this.playerRig.root);
    this.scene.add(this.camera);
    this.camera.add(this.playerRig.firstPersonBlade);

    this.tangentArc = createTangentArcVisual();
    this.tangentArc.group.visible = false;
    this.scene.add(this.tangentArc.group);

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
        this.ui.toggleDevDrawer();
      },
      onTogglePause: () => {
        if (!this.started) return;
        this.paused = !this.paused;
        if (this.paused) {
          this.ui.openSettingsModal(this.settings);
        } else {
          this.ui.closeSettingsModal();
        }
        this.input.setUiBlocked(this.paused);
      },
      onFirstUserGesture: () => {
        this.audio.unlock();
      },
    });

    this.ui = new GameUI(uiRoot, {
      onStartGame: () => {
        this.started = true;
        this.paused = false;
        this.input.setUiBlocked(false);
        this.audio.unlock();
        this.syncControlVisibility();
      },
      onWarpBoss: (target) => {
        if (target === 'hub') {
          this.enterHub();
        } else {
          this.enterBossFight(target);
        }
      },
      onSelectSigil: (sigil) => {
        this.player.selectedSigil = sigil;
        this.playerRig.setSigilAccent(SIGIL_BY_ID[sigil].accentHex);
        const idx = DERIVATIVE_SIGILS.findIndex((s) => s.id === sigil);
        if (idx >= 0) this.input.setCurrentSigilIndex(idx);
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
      },
      onToggleGodMode: () => {
        this.player.godMode = !this.player.godMode;
      },
      onToggleInfiniteStamina: () => {
        this.player.infiniteStamina = !this.player.infiniteStamina;
      },
      onToggleFreezeTheta: () => {
        this.freezeTheta = !this.freezeTheta;
      },
      onForceStagger: () => {
        if (this.boss) {
          forceBossStagger(this.boss);
          this.ui.showToast('DEV: BOSS STAGGERED');
        }
      },
      onOpenWorkedExample: () => {
        this.paused = true;
        this.input.setUiBlocked(true);
        const snap =
          this.lastWorkedExample ??
          buildWorkedExample(
            this.boss ? this.boss.activeFunction : 'sin',
            this.boss ? this.boss.theta : Math.PI / 3,
            this.player.selectedSigil,
            'resonance_hit',
            3.25,
          );
        this.ui.showWorkedExample(snap);
      },
      onCloseWorkedExample: () => {
        this.paused = false;
        this.input.setUiBlocked(false);
      },
      onOpenSettings: () => {
        this.paused = true;
        this.input.setUiBlocked(true);
        this.ui.openSettingsModal(this.settings);
      },
      onCloseSettings: () => {
        this.paused = false;
        this.input.setUiBlocked(false);
      },
    });

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

  private syncControlVisibility(): void {
    const mode = this.settings.controlMode;
    const showMobile = mode === 'mobile' || (mode === 'auto' && this.input.isTouchDevice);
    this.ui.setMobileControlsVisible(showMobile);
  }

  private enterHub(): void {
    this.clearCombatEntities();
    this.boss = null;
    if (this.bossRig) {
      this.scene.remove(this.bossRig.root);
      this.bossRig = null;
    }
    this.tangentArc.group.visible = false;
    this.cameraCtrl.lockedOn = false;
    this.playerPos.set(0, 0, 8);
    this.player = createInitialPlayerState();
    this.playerRig.setSigilAccent(SIGIL_BY_ID[this.player.selectedSigil].accentHex);
    this.scene.background = new THREE.Color(0x0b0d16);
    (this.scene.fog as THREE.FogExp2).color.setHex(0x101320);
    this.arena.setSkyMood(0x0b1024, 0x1a1528, 0xe8c174);
    this.rimLight.color.setHex(0x6d92d8);
    for (const fg of this.arena.fogGates) fg.group.visible = true;
    this.ui.showToast('SANCTUARY HUB — APPROACH A FOG GATE');
  }

  private enterBossFight(id: BossId): void {
    this.clearCombatEntities();
    if (this.bossRig) {
      this.scene.remove(this.bossRig.root);
    }
    const cfg = BOSS_CONFIGS[id];
    this.boss = createBossRuntime(id);
    this.bossRig = createBossModel(id);
    this.scene.add(this.bossRig.root);

    this.player.hp = computeEffectiveStat(this.player, 'maxHp');
    this.player.stamina = computeEffectiveStat(this.player, 'maxStamina');
    this.player.flasksRemaining = 3;
    this.playerPos.set(0, 0, 10);
    this.cameraCtrl.yaw = 0;
    this.cameraCtrl.lockedOn = true;
    this.bossVictoryPendingTimer = 0;

    for (const fg of this.arena.fogGates) fg.group.visible = false;
    this.tangentArc.group.visible = true;

    this.scene.background = new THREE.Color(cfg.arenaMoodHex);
    (this.scene.fog as THREE.FogExp2).color.setHex(cfg.arenaMoodHex);
    const zenith = id === 'witch' ? 0x0c132d : id === 'lich' ? 0x081a14 : 0x1e0d0c;
    this.arena.setSkyMood(zenith, cfg.arenaMoodHex, cfg.accentColor);
    this.rimLight.color.setHex(cfg.accentColor);
    this.bossLight.color.setHex(cfg.accentColor);
    this.audio.playBossCue();
    this.ui.showToast(`${cfg.name.toUpperCase()} — ${cfg.title.toUpperCase()}`);
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
    if (!this.boss) return;
    this.cameraCtrl.lockedOn = !this.cameraCtrl.lockedOn;
    this.ui.showToast(this.cameraCtrl.lockedOn ? 'TARGET LOCKED' : 'LOCK RELEASED');
  }

  private nearbyFogGate(): BossId | null {
    if (this.boss) return null;
    for (const fg of this.arena.fogGates) {
      if (this.playerPos.distanceTo(fg.position) < 4.0) {
        return fg.bossId;
      }
    }
    return null;
  }

  private tick(): void {
    this.timer.update();
    const rawRealDt = Math.min(Math.max(this.timer.getDelta(), 0), 0.1);

    // Optional FPS Cap via accumulator
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
      this.stepSimulation(renderedDt);
    } else {
      // Gently animate sanctuary fog gates, braziers, sky & slow camera orbit on title screen
      this.totalTime += renderedDt;
      this.stepEnvironmentVisuals();
      if (!this.started) {
        this.cameraCtrl.yaw = Math.sin(this.totalTime * 0.14) * 0.45;
      }
      this.cameraCtrl.update(
        this.camera,
        this.playerPos,
        null,
        renderedDt,
        renderedDt,
        this.settings.shakeStrength,
      );
    }

    this.renderer.info.reset();
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private stepSimulation(realDt: number): void {
    // Hit-stop & Radial Wheel slow-mo time scaling
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

    // Discrete buffered inputs
    if (this.input.buffer.consume('togglePov', nowSec)) {
      this.handleTogglePov();
    }
    if (this.input.buffer.consume('lockOn', nowSec)) {
      this.handleToggleLockOn();
    }
    if (this.input.buffer.consume('heal', nowSec) && tryUseHealFlask(this.player)) {
      this.audio.playHeal();
      this.vfx.spawnBurst(
        new THREE.Vector3(this.playerPos.x, 1.1, this.playerPos.z),
        0xf2c864,
        18,
        4.2,
        0.48,
      );
      this.ui.showToast('CRIMSON FLASK RESTORED HP');
    }

    const nearGate = this.nearbyFogGate();
    if (nearGate && this.input.buffer.consume('interact', nowSec)) {
      this.enterBossFight(nearGate);
      return;
    }

    // Player movement & dodge
    const move = this.input.getMoveVector();
    this.cameraCtrl.getForwardXZ(this.forwardVec);
    this.cameraCtrl.getRightXZ(this.rightVec);

    const worldMoveX = this.rightVec.x * move.x - this.forwardVec.x * move.y;
    const worldMoveZ = this.rightVec.y * move.x - this.forwardVec.y * move.y;

    if (this.input.buffer.consume('dodge', nowSec)) {
      if (tryStartDodge(this.player, { x: worldMoveX, z: worldMoveZ })) {
        this.audio.playDodge();
        this.vfx.spawnBurst(
          new THREE.Vector3(this.playerPos.x, 0.7, this.playerPos.z),
          new THREE.Color(SIGIL_BY_ID[this.player.selectedSigil].accentHex).getHex(),
          12,
          4.5,
          0.38,
        );
      }
    }

    stepPlayerState(this.player, dt);

    let isMoving = false;
    if (this.player.dodgeTimer > 0) {
      const dodgeSpeed = 13.5;
      this.playerPos.x += this.player.dodgeDirX * dodgeSpeed * dt;
      this.playerPos.z += this.player.dodgeDirZ * dodgeSpeed * dt;
      this.playerRig.bodyMeshGroup.rotation.x = 0.52;
      this.playerRig.bodyMeshGroup.position.y = -0.15;
    } else {
      this.playerRig.bodyMeshGroup.rotation.x = 0;
      if (Math.hypot(worldMoveX, worldMoveZ) > 0.05) {
        isMoving = true;
        const moveSpeed = 6.8;
        this.playerPos.x += worldMoveX * moveSpeed * dt;
        this.playerPos.z += worldMoveZ * moveSpeed * dt;
        const targetYaw = Math.atan2(worldMoveX, worldMoveZ);
        let diff = targetYaw - this.playerYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.playerYaw += diff * Math.min(1, 14 * dt);
      }
    }

    // Articulated walk / idle / cape animation
    if (isMoving) {
      this.walkCyclePhase += dt * 11.5;
      const stride = Math.sin(this.walkCyclePhase);
      this.playerRig.legLeft.rotation.x = stride * 0.62;
      this.playerRig.legRight.rotation.x = -stride * 0.62;
      this.playerRig.armLeft.rotation.x = -stride * 0.45;
      if (this.bladeSwingTimer <= 0) {
        this.playerRig.armRight.rotation.x = stride * 0.35;
      }
      this.playerRig.bodyMeshGroup.position.y = Math.abs(Math.cos(this.walkCyclePhase)) * 0.06;
      this.playerRig.cloakPivot.rotation.x = 0.25 + Math.abs(stride) * 0.14;
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

    // Keep player inside sanctuary boundary
    const pr = Math.hypot(this.playerPos.x, this.playerPos.z);
    if (pr > ARENA_RADIUS - 1.1) {
      const s = (ARENA_RADIUS - 1.1) / pr;
      this.playerPos.x *= s;
      this.playerPos.z *= s;
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

    // Step Boss & VFX
    let lockTarget: THREE.Vector3 | null = null;
    if (this.boss && this.bossRig) {
      if (this.boss.phase === 'DEFEATED') {
        this.bossVictoryPendingTimer += realDt;
        this.bossRig.root.scale.setScalar(Math.max(0.01, 1 - this.bossVictoryPendingTimer * 0.5));
        if (this.bossVictoryPendingTimer > 2.4) {
          this.ui.showToast('BOSS VANQUISHED — RETURNING TO SANCTUARY');
          this.enterHub();
        }
      } else {
        const events = stepBossAI(
          this.boss,
          dt,
          { x: this.playerPos.x, z: this.playerPos.z },
          this.freezeTheta,
        );
        this.handleBossEvents(events);

        this.bossRig.root.position.set(this.boss.x, this.boss.y, this.boss.z);
        this.bossRig.root.rotation.y = this.boss.facingYaw;
        this.bossRig.bodyGroup.position.y = Math.sin(this.totalTime * 2.1) * 0.14;
        this.bossRig.coreMesh.rotation.y += dt * 1.8;
        this.bossRig.wardMesh.visible = this.boss.wardActive;
        const slopeMag = Math.abs(
          evaluateExactDerivative(this.boss.activeFunction, this.boss.theta).value,
        );
        this.bossRig.wardMat.uniforms.uTime.value = this.totalTime;
        this.bossRig.wardMat.uniforms.uPulse.value = Math.min(1.65, 0.4 + slopeMag * 0.25);

        const orbitSpeed = 1.5 + Math.min(3.5, slopeMag * 0.25);
        this.bossRig.orbitParts.forEach((p, idx) => {
          const a = this.totalTime * orbitSpeed + (idx * Math.PI * 2) / this.bossRig!.orbitParts.length;
          p.position.set(Math.cos(a) * 2.15, 2.25 + Math.sin(a * 2) * 0.35, Math.sin(a) * 2.15);
          p.rotation.y = -a;
        });
        if (this.bossRig.wingLeft && this.bossRig.wingRight) {
          const flap = Math.sin(this.totalTime * 5.8) * 0.42;
          this.bossRig.wingLeft.rotation.z = flap;
          this.bossRig.wingRight.rotation.z = -flap;
        }
        if (this.bossRig.tailSegments) {
          this.bossRig.tailSegments.forEach((seg, idx) => {
            seg.rotation.y = Math.sin(this.totalTime * 3.4 - idx * 0.55) * 0.18;
          });
        }
        if (this.bossRig.neckSegments) {
          this.bossRig.neckSegments.forEach((seg, idx) => {
            seg.rotation.x = Math.sin(this.totalTime * 2.3 - idx * 0.4) * 0.08;
          });
        }
        if (this.bossRig.veilRibbons) {
          this.bossRig.veilRibbons.forEach((rib, idx) => {
            rib.rotation.x = 0.18 + Math.sin(this.totalTime * 3.0 + idx) * 0.14;
          });
        }

        const profile = PRESET_PROFILES[this.settings.preset];
        this.tangentArc.updateCurve(
          this.boss.activeFunction,
          this.boss.theta,
          this.bossRig.root.position,
          BOSS_CONFIGS[this.boss.id].accentColor,
          profile.waveRibbonSegments,
        );

        this.bossLight.position.set(this.boss.x, this.boss.y + 2.5, this.boss.z);
        lockTarget = new THREE.Vector3(this.boss.x, this.boss.y + 1.8, this.boss.z);
      }
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
      this.ui.showToast('RESONANCE SHATTERED — RESTORED AT SANCTUARY');
      this.enterHub();
    }

    this.uiUpdateCooldown -= realDt;
    if (this.uiUpdateCooldown <= 0) {
      this.uiUpdateCooldown = 0.05; // 20 Hz UI updates (smooth & low DOM churn)
      this.ui.updateHUD(
        this.player,
        this.boss,
        this.cameraCtrl.pov,
        this.settings,
        this.getTelemetry(),
        nearGate,
        this.freezeTheta,
      );
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

    if (!this.boss || this.boss.phase === 'DEFEATED') return;
    const dist = Math.hypot(this.boss.x - this.playerPos.x, this.boss.z - this.playerPos.z);
    if (dist > 4.8) return;

    const cfg = BOSS_CONFIGS[this.boss.id];
    const res = resolveBasicAttack(this.player, {
      activeFunction: this.boss.activeFunction,
      theta: this.boss.theta,
      wardActive: this.boss.wardActive,
      bossDefense: cfg.defense,
    });
    this.lastWorkedExample = res.workedExample;
    applyDamageToBoss(this.boss, res.damage, res.staggerGain, false);
    this.vfx.spawnBurst(
      new THREE.Vector3(this.boss.x, this.boss.y + 1.6, this.boss.z),
      0xf5d48a,
      10,
      5.2,
      0.38,
    );
    this.cameraCtrl.addTrauma(0.22);
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

    // Launch glowing Resonance Projectile toward boss or camera aim
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(this.playerPos.x, 1.5, this.playerPos.z);
    this.scene.add(mesh);

    let dirX = -Math.sin(this.cameraCtrl.yaw);
    let dirZ = -Math.cos(this.cameraCtrl.yaw);
    if (this.boss && this.boss.phase !== 'DEFEATED') {
      const dx = this.boss.x - this.playerPos.x;
      const dz = this.boss.z - this.playerPos.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      dirX = dx / len;
      dirZ = dz / len;
    }

    this.projectiles.push({
      mesh,
      vx: dirX * 26,
      vz: dirZ * 26,
      life: 1.4,
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
    const hitOrigin = new THREE.Vector3(boss.x, boss.y + 1.8, boss.z);
    const sigilHex = new THREE.Color(SIGIL_BY_ID[this.player.selectedSigil].accentHex).getHex();

    if (res.triggerBacklash) {
      this.audio.playBacklash();
      this.cameraCtrl.addTrauma(0.5);
      this.vfx.spawnBurst(hitOrigin, 0xc9323c, 16, 6.2, 0.45);
      this.spawnShockwave(this.boss!.x, this.boss!.z, 9.0, 16, 0xc9323c);
      this.ui.showToast(`DERIVATIVE MISMATCH! BACKLASH (${res.damage})`);
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
      this.cameraCtrl.addTrauma(0.45);
      this.vfx.spawnBurst(hitOrigin, sigilHex, 15, 6.0, 0.44);
      this.ui.showToast(`RESONANCE HIT! ${res.multiplier}× (${res.damage})`);
    }
  }

  private handleBossEvents(events: ReturnType<typeof stepBossAI>): void {
    if (!this.boss) return;
    const cfg = BOSS_CONFIGS[this.boss.id];
    for (const ev of events) {
      if (ev.kind === 'projectile_orb') {
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.38, 10, 8),
          new THREE.MeshBasicMaterial({ color: cfg.accentColor }),
        );
        orb.position.set(ev.originX, 1.5, ev.originZ);
        this.scene.add(orb);
        this.projectiles.push({
          mesh: orb,
          vx: ev.dirX * ev.speed,
          vz: ev.dirZ * ev.speed,
          life: 3.0,
          damage: ev.damage,
          fromPlayer: false,
        });
      } else if (ev.kind === 'wave_pulse') {
        this.spawnShockwave(ev.originX, ev.originZ, ev.radius, ev.damage, cfg.accentColor);
      } else if (ev.kind === 'beam_sweep') {
        const dirX = Math.sin(ev.angle);
        const dirZ = Math.cos(ev.angle);
        const bolt = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.35, 1.8),
          new THREE.MeshBasicMaterial({ color: cfg.accentColor }),
        );
        bolt.position.set(this.boss.x, 1.4, this.boss.z);
        bolt.lookAt(this.boss.x + dirX, 1.4, this.boss.z + dirZ);
        this.scene.add(bolt);
        this.projectiles.push({
          mesh: bolt,
          vx: dirX * 15,
          vz: dirZ * 15,
          life: 2.2,
          damage: ev.damage,
          fromPlayer: false,
        });
      } else if (ev.kind === 'dive_slam') {
        this.spawnShockwave(ev.targetX, ev.targetZ, ev.radius, ev.damage, cfg.accentColor);
      }
    }
  }

  private spawnShockwave(x: number, z: number, maxRadius: number, damage: number, color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 1.0, 36),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.14, z);
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
      if (Math.random() < 0.45) {
        const col = (p.mesh.material as THREE.MeshBasicMaterial).color.getHex();
        this.vfx.spawnTrail(p.mesh.position, col, p.fromPlayer ? 0.34 : 0.28);
      }

      let remove = p.life <= 0;
      if (p.fromPlayer && this.boss && this.boss.phase !== 'DEFEATED') {
        const d = Math.hypot(p.mesh.position.x - this.boss.x, p.mesh.position.z - this.boss.z);
        if (d < 2.2) {
          this.resolvePlayerProjectileHit(this.boss);
          remove = true;
        }
      } else if (!p.fromPlayer) {
        const d = Math.hypot(p.mesh.position.x - this.playerPos.x, p.mesh.position.z - this.playerPos.z);
        if (d < 1.1) {
          const dealt = applyDamageToPlayer(this.player, p.damage);
          if (dealt > 0) this.cameraCtrl.addTrauma(0.38);
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
        if (Math.abs(dist - radius) < 1.05) {
          sw.hitPlayer = true;
          const dealt = applyDamageToPlayer(this.player, sw.damage);
          if (dealt > 0) this.cameraCtrl.addTrauma(0.45);
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
    for (const fg of this.arena.fogGates) {
      fg.curtainMat.uniforms.uTime.value = this.totalTime;
    }
    this.arena.brazierFlames.forEach((flame, idx) => {
      const flicker = 0.88 + Math.sin(this.totalTime * 11.5 + idx * 2.1) * 0.14;
      flame.scale.set(flicker, 0.9 + Math.cos(this.totalTime * 14.0 + idx) * 0.18, flicker);
    });

    const posAttr = this.arena.emberPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = this.arena.emberBasePositions;
    for (let i = 0; i < posAttr.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      const y = ((by + this.totalTime * 0.45) % 8.5) + 0.2;
      posAttr.setXYZ(i, bx + Math.sin(this.totalTime + i) * 0.22, y, bz);
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
