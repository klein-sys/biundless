import { describe, it, expect, beforeEach } from 'vitest';
import { DialogueRunner } from '../src/dialogue/dialogueRunner';
import { createDefaultProgression, recordBossDefeat } from '../src/rpg/progressionSystem';

describe('Dialogue & Quest System', () => {
  let toasts: string[] = [];
  let stateChanges = 0;

  beforeEach(() => {
    toasts = [];
    stateChanges = 0;
  });

  function createTestRunner(prog = createDefaultProgression()) {
    return new DialogueRunner(prog, {
      onShowToast: (msg) => toasts.push(msg),
      onStateChanged: () => {
        stateChanges++;
      },
    });
  }

  it('initiates conversation with Archmage Aurelius and returns root node', () => {
    const runner = createTestRunner();
    const node = runner.startDialogue('aurelius');
    expect(node).not.toBeNull();
    expect(node?.speakerName).toBe('Archmage Aurelius');
    expect(node?.speakerRole).toBe('aurelius');
    expect(runner.isOpen).toBe(true);

    const choices = runner.getAvailableChoices();
    expect(choices.length).toBeGreaterThanOrEqual(2);
    // Unspent stat point choice should be hidden when statPoints === 0
    const statChoice = choices.find((c) => c.nextNodeId === 'aurelius_stats_hub');
    expect(statChoice).toBeUndefined();
  });

  it('displays stat allocation options when player has unspent stat points', () => {
    const prog = createDefaultProgression();
    prog.statPoints = 2;
    const runner = createTestRunner(prog);
    runner.startDialogue('aurelius');

    const choices = runner.getAvailableChoices();
    const statChoice = choices.find((c) => c.nextNodeId === 'aurelius_stats_hub');
    expect(statChoice).toBeDefined();

    // Navigate to stats hub
    const res = runner.selectChoice(statChoice!);
    expect(res.nextNode?.id).toBe('aurelius_stats_hub');

    // Allocate 1 point to Vigor
    const vigorChoice = runner.getAvailableChoices().find((c) => c.statToAllocate === 'vigor');
    expect(vigorChoice).toBeDefined();
    runner.selectChoice(vigorChoice!);

    expect(prog.vigor).toBe(1);
    expect(prog.statPoints).toBe(1);
    expect(toasts.some((t) => t.includes('Vigor'))).toBe(true);
  });

  it('navigates calculus derivative guidance dialogue', () => {
    const runner = createTestRunner();
    runner.startDialogue('aurelius');

    const lessonChoice = runner.getAvailableChoices().find((c) => c.nextNodeId === 'aurelius_calculus_lesson');
    expect(lessonChoice).toBeDefined();

    const lessonNode = runner.selectChoice(lessonChoice!).nextNode;
    expect(lessonNode?.id).toBe('aurelius_calculus_lesson');
    expect(lessonNode?.text).toContain("sin(θ)");
    expect(lessonNode?.text).toContain("cos(θ)");
  });

  it('handles quest acceptance, completion with boss defeat, and reward claiming', () => {
    const prog = createDefaultProgression();
    const runner = createTestRunner(prog);
    runner.startDialogue('aurelius');

    // Go to quest hub
    const hubChoice = runner.getAvailableChoices().find((c) => c.nextNodeId === 'aurelius_quest_hub');
    expect(hubChoice).toBeDefined();
    runner.selectChoice(hubChoice!);

    // Accept Quest 1
    const q1Choice = runner.getAvailableChoices().find((c) => c.action === 'accept_quest_1');
    expect(q1Choice).toBeDefined();
    runner.selectChoice(q1Choice!);

    expect(prog.quests['quest_sine_ward']).toBe('active');
    expect(toasts.some((t) => t.includes('NEW QUEST'))).toBe(true);

    // Defeat Vespera (witch)
    recordBossDefeat(prog, 'witch', 200);
    expect(prog.defeatedBosses).toContain('witch');

    // Claim Quest
    const claimChoice = runner.getAvailableChoices().find((c) => c.action === 'claim_quest');
    expect(claimChoice).toBeDefined();
    runner.selectChoice(claimChoice!);

    expect(prog.quests['quest_sine_ward']).toBe('completed');
    expect(toasts.some((t) => t.includes('QUEST COMPLETE'))).toBe(true);
  });

  it('provides lore and barks for townsfolk (blacksmith, herbalist, scout)', () => {
    const runner = createTestRunner();

    const blacksmith = runner.startDialogue('blacksmith');
    expect(blacksmith?.speakerName).toBe('Theron the Smith');
    expect(runner.getAvailableChoices().length).toBeGreaterThan(0);

    const herbalist = runner.startDialogue('herbalist');
    expect(herbalist?.speakerName).toBe('Lyra the Herbalist');

    const scout = runner.startDialogue('scout');
    expect(scout?.speakerName).toBe('Eldrin the Scout');
  });
});
