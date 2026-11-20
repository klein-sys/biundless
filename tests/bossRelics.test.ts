import { describe, expect, it } from 'vitest';
import { buildWorkedExample } from '../src/math/trigDerivatives';
import { collectBossRelic, getRelicWorkedExample, loadBossRelics, recordBossRelic, rememberRelicEvidence } from '../src/rpg/bossRelics';
import { getBossArrivalPoint, WORLD_PLAYABLE_RADIUS } from '../src/world/SunlitValley';

describe('boss relics', () => {
  it('restores an uncollected practice relic for an old victory', () => {
    expect(loadBossRelics(undefined, ['witch', 'other'])).toEqual({
      witch: { ...getBossArrivalPoint('witch'), collected: false },
    });
  });

  it('prefers a recorded ward break to later matches or a sword finish', () => {
    const match = buildWorkedExample('cos', 0.7, 'neg_sin', 'resonance_hit', 3.6);
    const ward = buildWorkedExample('sin', 0.9, 'cos', 'ward_shattered', 3.6);
    const evidence = rememberRelicEvidence(undefined, ward, true);
    expect(rememberRelicEvidence(evidence, match, false)).toBe(evidence);
    const relics = loadBossRelics(undefined, []);
    recordBossRelic(relics, 'witch', { x: -50, z: -40 }, evidence);
    expect(relics.witch?.evidence).toMatchObject({ activeFunction: 'sin', sigil: 'cos', brokeWard: true });
  });

  it('keeps a sword-only or mismatch victory as a practice example', () => {
    const mismatch = buildWorkedExample('sin', 0.8, 'neg_sin', 'guided_mismatch', 0.25);
    const relics = loadBossRelics(undefined, []);
    recordBossRelic(relics, 'witch', { x: -50, z: -40 }, rememberRelicEvidence(undefined, mismatch, false));
    expect(relics.witch?.evidence).toBeUndefined();
    expect(getRelicWorkedExample('witch', relics.witch?.evidence)).toMatchObject({
      functionId: 'sin', chosenSigil: 'cos', isExactMatch: true,
    });
  });

  it('collects once and upgrades a practice relic on rematch without replacing its location', () => {
    const relics = loadBossRelics(undefined, ['dragon']);
    const position = getBossArrivalPoint('dragon');
    expect(collectBossRelic(relics, 'dragon')).toBe(true);
    expect(collectBossRelic(relics, 'dragon')).toBe(false);
    const match = buildWorkedExample('sec', 0.7, 'sec_tan', 'resonance_hit', 3.6);
    recordBossRelic(relics, 'dragon', { x: 35, z: -44 }, rememberRelicEvidence(undefined, match, false));
    const restored = loadBossRelics(JSON.parse(JSON.stringify(relics)), ['dragon']);
    expect(restored.dragon).toMatchObject({ ...position, collected: true, evidence: { sigil: 'sec_tan' } });
  });

  it('places an out-of-bounds drop within walking distance of the playable area', () => {
    const relics = loadBossRelics(undefined, []);
    recordBossRelic(relics, 'lich', { x: 10, z: 150 });
    const drop = relics.lich!;
    expect(Math.hypot(drop.x, drop.z)).toBeLessThan(WORLD_PLAYABLE_RADIUS - 1);
  });
});
