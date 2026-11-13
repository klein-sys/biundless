import type { TrigFunctionId } from '../math/trigDerivatives';

export type BossId = 'witch' | 'lich' | 'dragon';

export interface BossConfig {
  readonly id: BossId;
  readonly name: string;
  readonly title: string;
  readonly biomeName: string;
  readonly maxHp: number;
  readonly defense: number;
  readonly thetaSpeed: number;
  readonly functions: readonly [TrigFunctionId, TrigFunctionId];
  readonly accentColor: number;
  readonly arenaMoodHex: number;
  readonly fogGatePosition: { readonly x: number; readonly z: number };
  readonly biomePosition: { readonly x: number; readonly z: number };
  readonly territoryRadius: number;
  readonly calculusSummary: string;
}

export const BOSS_CONFIGS: Record<BossId, BossConfig> = {
  witch: {
    id: 'witch',
    name: 'Vespera',
    title: 'Astral Sylvan Witch',
    biomeName: 'Whispering Glade',
    maxHp: 650,
    defense: 16,
    thetaSpeed: 0.95,
    functions: ['sin', 'cos'],
    accentColor: 0x5ca9e6,
    arenaMoodHex: 0x8ccdf7,
    fogGatePosition: { x: -44, z: -36 },
    biomePosition: { x: -44, z: -36 },
    territoryRadius: 26,
    calculusSummary:
      'Oscillating wards modeled by sin(θ) & cos(θ). Shatter with cos(θ) or −sin(θ); strike crests where f′(θ) = 0.',
  },
  lich: {
    id: 'lich',
    name: 'Malakor',
    title: 'Ancient Ruin Lich',
    biomeName: 'Sunken Sun-Ruins',
    maxHp: 820,
    defense: 22,
    thetaSpeed: 0.72,
    functions: ['tan', 'cot'],
    accentColor: 0x38c793,
    arenaMoodHex: 0x94d9ec,
    fogGatePosition: { x: 0, z: -54 },
    biomePosition: { x: 0, z: -54 },
    territoryRadius: 26,
    calculusSummary:
      'Arcane sun-beams surge as tan(θ) & cot(θ) with slopes sec²(θ) & −csc²(θ). Counter before vertical asymptotes erupt.',
  },
  dragon: {
    id: 'dragon',
    name: 'Vaelorath',
    title: 'Skyridge Wyrm',
    biomeName: 'Skyridge Peak',
    maxHp: 1050,
    defense: 28,
    thetaSpeed: 0.65,
    functions: ['sec', 'csc'],
    accentColor: 0xe88b3a,
    arenaMoodHex: 0xaad8f5,
    fogGatePosition: { x: 46, z: -34 },
    biomePosition: { x: 46, z: -34 },
    territoryRadius: 26,
    calculusSummary:
      'Soaring dive arcs governed by sec(θ) & csc(θ). Use 1st-POV to land sec(θ)tan(θ) or −csc(θ)cot(θ) grounding shots.',
  },
};

export const BOSS_ORDER: readonly BossId[] = ['witch', 'lich', 'dragon'];
