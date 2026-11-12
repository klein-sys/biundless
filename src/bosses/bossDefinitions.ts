import type { TrigFunctionId } from '../math/trigDerivatives';

export type BossId = 'witch' | 'lich' | 'dragon';

export interface BossConfig {
  readonly id: BossId;
  readonly name: string;
  readonly title: string;
  readonly maxHp: number;
  readonly defense: number;
  readonly thetaSpeed: number;
  readonly functions: readonly [TrigFunctionId, TrigFunctionId];
  readonly accentColor: number;
  readonly arenaMoodHex: number;
  readonly fogGatePosition: { readonly x: number; readonly z: number };
  readonly calculusSummary: string;
}

export const BOSS_CONFIGS: Record<BossId, BossConfig> = {
  witch: {
    id: 'witch',
    name: 'Vespera',
    title: 'Witch of the Sine Hollow',
    maxHp: 650,
    defense: 16,
    thetaSpeed: 0.95,
    functions: ['sin', 'cos'],
    accentColor: 0x7fb8d8,
    arenaMoodHex: 0x101828,
    fogGatePosition: { x: -11, z: -12 },
    calculusSummary: 'Oscillating wards modeled by sin(θ) & cos(θ). Shatter with cos(θ) or −sin(θ); strike crests where f′(θ) = 0.',
  },
  lich: {
    id: 'lich',
    name: 'Malakor',
    title: 'Lich of the Asymptote Crypt',
    maxHp: 820,
    defense: 22,
    thetaSpeed: 0.72,
    functions: ['tan', 'cot'],
    accentColor: 0x5ec99a,
    arenaMoodHex: 0x0d1b17,
    fogGatePosition: { x: 0, z: -16 },
    calculusSummary: 'Soul beams surge as tan(θ) & cot(θ) with slopes sec²(θ) & −csc²(θ). Counter before vertical asymptotes erupt.',
  },
  dragon: {
    id: 'dragon',
    name: 'Vaelorath',
    title: 'Wyrm of the Hyperbolic Abyss',
    maxHp: 1050,
    defense: 28,
    thetaSpeed: 0.65,
    functions: ['sec', 'csc'],
    accentColor: 0xe09a52,
    arenaMoodHex: 0x1d110e,
    fogGatePosition: { x: 11, z: -12 },
    calculusSummary: 'Aerial dive arcs governed by sec(θ) & csc(θ). Use 1st-POV to land sec(θ)tan(θ) or −csc(θ)cot(θ) grounding shots.',
  },
};

export const BOSS_ORDER: readonly BossId[] = ['witch', 'lich', 'dragon'];
