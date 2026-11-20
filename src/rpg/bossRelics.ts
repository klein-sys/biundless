import { BOSS_CONFIGS, BOSS_ORDER, type BossId } from '../bosses/bossDefinitions';
import { buildWorkedExample, expectedDerivativeFor, type DerivativeSigilId, type TrigFunctionId, type WorkedExampleSnapshot } from '../math/trigDerivatives';
import { getBossArrivalPoint, WORLD_PLAYABLE_RADIUS } from '../world/SunlitValley';

export const BOSS_RELIC_NAMES: Record<BossId, string> = {
  witch: 'Vespera’s Prism',
  lich: 'Malakor’s Seal',
  dragon: 'Vaelorath’s Crest',
};

export interface RelicEvidence {
  activeFunction: TrigFunctionId;
  theta: number;
  sigil: DerivativeSigilId;
  multiplier: number;
  brokeWard: boolean;
}

export interface BossRelic {
  x: number;
  z: number;
  collected: boolean;
  evidence?: RelicEvidence;
}

export type BossRelics = Partial<Record<BossId, BossRelic>>;

export function rememberRelicEvidence(
  previous: RelicEvidence | undefined,
  example: WorkedExampleSnapshot,
  brokeWard: boolean,
): RelicEvidence | undefined {
  if (!example.isExactMatch || previous?.brokeWard) return previous;
  return {
    activeFunction: example.functionId,
    theta: example.thetaRadians,
    sigil: example.chosenSigil,
    multiplier: example.damageMultiplier,
    brokeWard,
  };
}

export function recordBossRelic(
  relics: BossRelics,
  id: BossId,
  position: { x: number; z: number },
  evidence?: RelicEvidence,
): void {
  const existing = relics[id];
  if (existing) {
    if (!existing.evidence && evidence) existing.evidence = evidence;
    return;
  }
  const scale = Math.min(1, (WORLD_PLAYABLE_RADIUS - 1.5) / Math.hypot(position.x, position.z));
  relics[id] = { x: position.x * scale, z: position.z * scale, collected: false };
  if (evidence) relics[id].evidence = evidence;
}

export function collectBossRelic(relics: BossRelics, id: BossId): boolean {
  const relic = relics[id];
  if (!relic || relic.collected) return false;
  relic.collected = true;
  return true;
}

export function loadBossRelics(raw: unknown, defeated: readonly string[]): BossRelics {
  const saved = raw && typeof raw === 'object' ? raw as BossRelics : {};
  const relics: BossRelics = {};
  for (const id of BOSS_ORDER) {
    if (!defeated.includes(id)) continue;
    const entry = saved[id];
    const validPosition = entry && Number.isFinite(entry.x) && Number.isFinite(entry.z);
    const evidence = entry?.evidence;
    const validEvidence = evidence && BOSS_CONFIGS[id].functions.includes(evidence.activeFunction)
      && expectedDerivativeFor(evidence.activeFunction) === evidence.sigil
      && Number.isFinite(evidence.theta) && Number.isFinite(evidence.multiplier)
      && typeof evidence.brokeWard === 'boolean';
    recordBossRelic(relics, id, validPosition ? entry : getBossArrivalPoint(id), validEvidence ? evidence : undefined);
    if (entry?.collected === true) collectBossRelic(relics, id);
  }
  return relics;
}

export function getRelicWorkedExample(id: BossId, evidence?: RelicEvidence): WorkedExampleSnapshot {
  const fn = evidence?.activeFunction ?? BOSS_CONFIGS[id].functions[0];
  return buildWorkedExample(
    fn,
    evidence?.theta ?? Math.PI / 3,
    evidence?.sigil ?? expectedDerivativeFor(fn),
    evidence?.brokeWard ? 'ward_shattered' : 'resonance_hit',
    evidence?.multiplier ?? 1,
  );
}
