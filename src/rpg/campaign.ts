import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import { expectedDerivativeFor, type DerivativeSigilId } from '../math/trigDerivatives';
import { LANDMARK_BY_ID } from '../world/SunlitValley';
import { BOSS_RELIC_NAMES, type BossRelics } from './bossRelics';
import type { ProgressionState } from './progressionSystem';

export const RESTORATION_WAVE = 'sin';
export const RESTORATION_SIGIL = expectedDerivativeFor(RESTORATION_WAVE);
export const CAMPAIGN_RELIC_TOTAL = BOSS_ORDER.length;

export interface CampaignObjective {
  title: string;
  next: string;
  recovered: number;
}

export function countCampaignRelics(relics: BossRelics): number {
  return BOSS_ORDER.filter((id) => relics[id]?.collected).length;
}

export function getCampaignObjective(
  state: ProgressionState,
  briefed = false,
  activeBoss: BossId | null = null,
): CampaignObjective {
  const recovered = countCampaignRelics(state.bossRelics);
  if (state.astrolabeRestored) return { title: 'Solstice Haven Restored', next: '', recovered };

  const title = 'Restore the Celestial Astrolabe';
  if (recovered === CAMPAIGN_RELIC_TOTAL) return { title, next: 'Return to the Celestial Astrolabe', recovered };

  const dropped = BOSS_ORDER.find((id) => state.bossRelics[id] && !state.bossRelics[id]?.collected);
  const target = BOSS_ORDER.find((id) => !state.bossRelics[id]);
  let next = 'Talk to Aurelius at the Astrolabe gazebo';
  if (activeBoss && !state.bossRelics[activeBoss]) {
    next = `Defeat ${BOSS_CONFIGS[activeBoss].name}`;
  } else if (dropped) {
    next = `Inspect ${BOSS_RELIC_NAMES[dropped]}`;
  } else if ((briefed || recovered > 0) && target) {
    next = `Find ${BOSS_CONFIGS[target].name} in ${LANDMARK_BY_ID[target].name}`;
  }
  return { title, next, recovered };
}

export function restoreAstrolabe(state: ProgressionState, sigil: DerivativeSigilId): boolean {
  if (state.astrolabeRestored || sigil !== RESTORATION_SIGIL
    || countCampaignRelics(state.bossRelics) !== CAMPAIGN_RELIC_TOTAL) return false;
  state.astrolabeRestored = true;
  return true;
}
