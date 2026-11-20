import soundtrackUrl from './the-valley-of-turning-stars.mp3?url';
import malakorBeamRelease from './sfx/malakor_beam_release.wav?url';
import malakorBeamWindup from './sfx/malakor_beam_windup.wav?url';
import vaelorathDiveImpact from './sfx/vaelorath_dive_impact.wav?url';
import vaelorathDiveWarning from './sfx/vaelorath_dive_warning.wav?url';
import vesperaOrbRelease from './sfx/vespera_orb_release.wav?url';
import vesperaOrbWindup from './sfx/vespera_orb_windup.wav?url';
import resonanceCast from './sfx/resonance_cast.wav?url';
import swordHit from './sfx/sword_hit.wav?url';
import swordSwingHeavy from './sfx/sword_swing_heavy.wav?url';
import swordSwingLight from './sfx/sword_swing_light.wav?url';
import swordSwingReverse from './sfx/sword_swing_reverse.wav?url';
import wardShatterCritical from './sfx/ward_shatter_crit.wav?url';
import wardShatterStandard from './sfx/ward_shatter_std.wav?url';

const COMBAT_SOUNDS = {
  malakor_beam_release: malakorBeamRelease,
  malakor_beam_windup: malakorBeamWindup,
  vaelorath_dive_impact: vaelorathDiveImpact,
  vaelorath_dive_warning: vaelorathDiveWarning,
  vespera_orb_release: vesperaOrbRelease,
  vespera_orb_windup: vesperaOrbWindup,
  resonance_cast: resonanceCast,
  sword_hit: swordHit,
  sword_swing_heavy: swordSwingHeavy,
  sword_swing_light: swordSwingLight,
  sword_swing_reverse: swordSwingReverse,
  ward_shatter_crit: wardShatterCritical,
  ward_shatter_std: wardShatterStandard,
};

type CombatSound = keyof typeof COMBAT_SOUNDS;
const SWORD_SWINGS = ['sword_swing_light', 'sword_swing_reverse', 'sword_swing_heavy'] as const;

export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private combatGain: GainNode | null = null;
  private readonly combatBuffers = new Map<CombatSound, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private musicActive = false;
  private enabled = true;
  private volume = 0.55;

  public unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.combatGain = this.ctx.createGain();
      this.combatGain.gain.value = 0.45;
      this.combatGain.connect(this.masterGain);
      for (const cue of Object.keys(COMBAT_SOUNDS) as CombatSound[]) {
        void this.loadCombatSound(this.ctx, cue);
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (this.musicActive) {
      this.playMusic();
    }
  }

  public setMusicActive(active: boolean): void {
    this.musicActive = active;
    if (active) {
      this.unlock();
    } else if (this.music) {
      this.music.pause();
      this.music.currentTime = 0;
    }
  }

  public setConfig(enabled: boolean, volume: number): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.04);
    }
    if (!enabled) {
      this.music?.pause();
    } else if (!wasEnabled && this.musicActive) {
      this.unlock();
    }
  }

  private playMusic(): void {
    if (!this.ctx || !this.masterGain) return;
    if (!this.music) {
      this.music = new Audio(soundtrackUrl);
      this.music.loop = true;
      this.ctx.createMediaElementSource(this.music).connect(this.masterGain);
    }
    if (this.music.paused) {
      // Browsers can block playback until a user gesture. Unlock retries on input.
      void this.music.play().catch(() => {});
    }
  }

  private async loadCombatSound(ctx: AudioContext, cue: CombatSound): Promise<void> {
    try {
      const response = await fetch(COMBAT_SOUNDS[cue]);
      if (!response.ok) return;
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      this.combatBuffers.set(cue, buffer);
    } catch {
      // Other cues and synthesized effects remain available if a clip fails to load.
    }
  }

  public playCombatSound(cue: CombatSound): boolean {
    if (!this.enabled || this.ctx?.state !== 'running' || !this.combatGain) return false;
    const buffer = this.combatBuffers.get(cue);
    if (!buffer) return false;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.combatGain);
    source.start();
    return true;
  }

  public playSlash(comboStep = 1): void {
    const cue = SWORD_SWINGS[(Math.max(1, comboStep) - 1) % SWORD_SWINGS.length];
    if (this.playCombatSound(cue)) return;
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const base = 260 + (comboStep % 3) * 45;
    osc.frequency.setValueAtTime(base * 1.4, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playJump(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.12);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playWardShatter(isCritical: boolean): void {
    if (!this.playCombatSound(isCritical ? 'ward_shatter_crit' : 'ward_shatter_std')) {
      this.playChime(isCritical);
    }
  }

  public playChime(isCritical = false): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freqs = isCritical ? [523.25, 659.25, 783.99, 1046.5] : [440, 587.33, 880];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.03);
      gain.gain.setValueAtTime(0.15, now + idx * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55 + idx * 0.04);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.03);
      osc.stop(now + 0.62 + idx * 0.04);
    });
  }

  public playBacklash(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.32);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  public playDodge(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playHeal(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.06);
      gain.gain.setValueAtTime(0.12, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38 + i * 0.06);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + i * 0.06);
      osc.stop(now + 0.42 + i * 0.06);
    });
  }

  public playBossCue(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [220, 329.63].forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.08);
      gain.gain.setValueAtTime(0.14, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.08);
      osc.stop(now + 0.58);
    });
  }
}
