import {
  DIALOGUE_NODES,
  QUESTS,
  type DialogueChoice,
  type DialogueNode,
} from './dialogueData';
import {
  allocateStatPoint,
  canUpgradeFlask,
  canUpgradeWeapon,
  completeQuest,
  startQuest,
  upgradeFlask,
  upgradeWeapon,
  type ProgressionState
} from '../rpg/progressionSystem';

export interface DialogueRunnerCallbacks {
  onShowToast: (msg: string) => void;
  onStateChanged: () => void;
}

export class DialogueRunner {
  private currentNodeId: string | null = null;
  private activeNpcId: string | null = null;

  constructor(
    private progression: ProgressionState,
    private callbacks: DialogueRunnerCallbacks
  ) {}

  public setProgressionState(progression: ProgressionState): void {
    this.progression = progression;
  }

  public get isOpen(): boolean {
    return this.currentNodeId !== null;
  }

  public get activeNpc(): string | null {
    return this.activeNpcId;
  }

  public startDialogue(npcRole: 'aurelius' | 'blacksmith' | 'herbalist' | 'scout'): DialogueNode | null {
    const rootNodeId = `${npcRole}_root`;
    if (!DIALOGUE_NODES[rootNodeId]) return null;
    this.currentNodeId = rootNodeId;
    this.activeNpcId = npcRole;
    return this.getCurrentNode();
  }

  public closeDialogue(): void {
    if (this.currentNodeId === null && this.activeNpcId === null) return;
    this.currentNodeId = null;
    this.activeNpcId = null;
    this.callbacks.onStateChanged();
  }

  public getCurrentNode(): DialogueNode | null {
    if (!this.currentNodeId) return null;
    const node = DIALOGUE_NODES[this.currentNodeId];
    if (node?.id === 'aurelius_root' && this.progression.astrolabeRestored) {
      return { ...node, text: 'The Celestial Astrolabe shines again. Solstice Haven is safe, Spellblade.' };
    }
    return node ?? null;
  }

  public getAvailableChoices(): DialogueChoice[] {
    const node = this.getCurrentNode();
    if (!node) return [];

    return node.choices.filter((choice) => {
      // Unspent stats requirement
      if (choice.requiresUnspentStats && this.progression.statPoints <= 0) {
        return false;
      }

      // Quest state requirement
      if (choice.requiresQuestState) {
        const { questId, state } = choice.requiresQuestState;
        const currentQuestState = this.progression.quests[questId] ?? 'unstarted';
        if (currentQuestState !== state) return false;
      }

      // Boss defeat requirement
      if (choice.requiresBossDefeat) {
        if (!this.progression.defeatedBosses.includes(choice.requiresBossDefeat)) {
          return false;
        }
      }

      return true;
    });
  }

  public selectChoice(choice: DialogueChoice): { closed: boolean; nextNode: DialogueNode | null } {
    if (choice.action === 'close') {
      this.closeDialogue();
      return { closed: true, nextNode: null };
    }

    if (choice.action === 'accept_quest_1') {
      startQuest(this.progression, 'quest_sine_ward');
      this.callbacks.onShowToast('NEW QUEST: Shatter the Sine Ward (Glade)');
      this.callbacks.onStateChanged();
    } else if (choice.action === 'accept_quest_2') {
      startQuest(this.progression, 'quest_asymptote');
      this.callbacks.onShowToast('NEW QUEST: Tame the Asymptote (Sun-Ruins)');
      this.callbacks.onStateChanged();
    } else if (choice.action === 'accept_quest_3') {
      startQuest(this.progression, 'quest_skyridge_wyrm');
      this.callbacks.onShowToast('NEW QUEST: Ground the Skyridge Wyrm (Peak)');
      this.callbacks.onStateChanged();
    } else if (choice.action === 'claim_quest') {
      // Find eligible active quest whose boss is defeated
      let claimed = false;
      for (const [qId, qDef] of Object.entries(QUESTS)) {
        if (
          this.progression.quests[qId] === 'active' &&
          this.progression.defeatedBosses.includes(qDef.bossTargetId)
        ) {
          completeQuest(this.progression, qId, qDef.rewardXp);
          this.callbacks.onShowToast(`QUEST COMPLETE: ${qDef.title}! (+${qDef.rewardXp} XP)`);
          claimed = true;
          this.callbacks.onStateChanged();
          break;
        }
      }
      if (!claimed) {
        this.callbacks.onShowToast('No completed quests ready for turn-in.');
      }
    } else if (choice.action === 'open_stats' && choice.statToAllocate) {
      const allocated = allocateStatPoint(this.progression, choice.statToAllocate);
      if (allocated) {
        const statName =
          choice.statToAllocate === 'vigor'
            ? 'Vigor (+20 Max HP)'
            : choice.statToAllocate === 'endurance'
            ? 'Endurance (+15 Max Stamina)'
            : 'Harmonics (+0.25x Resonance Multiplier)';
        this.callbacks.onShowToast(`ATTUNED: ${statName}`);
        this.callbacks.onStateChanged();
      }
    } else if (choice.action === 'upgrade_weapon') {
      if (canUpgradeWeapon(this.progression)) {
        upgradeWeapon(this.progression);
        this.callbacks.onShowToast(`SPELLBLADE REFINED! Tier ${this.progression.weaponLevel} (+10% Attack Damage)`);
        this.callbacks.onStateChanged();
      } else {
        const curTier = this.progression.weaponLevel ?? 1;
        if (curTier >= 5) {
          this.callbacks.onShowToast('Spellblade is already at Masterwork Tier 5 (Max)!');
        } else {
          this.callbacks.onShowToast('Need Materials: 2 Mithril Ore & 1 Ancient Bone required.');
        }
      }
    } else if (choice.action === 'upgrade_flask') {
      if (canUpgradeFlask(this.progression)) {
        upgradeFlask(this.progression);
        this.callbacks.onShowToast(`CRIMSON DRAUGHT BREWED! Max Flasks: ${this.progression.maxFlasks}`);
        this.callbacks.onStateChanged();
      } else {
        const curFlasks = this.progression.maxFlasks ?? 3;
        if (curFlasks >= 5) {
          this.callbacks.onShowToast('Crimson Flask satchel is already at Maximum Capacity (5)!');
        } else {
          this.callbacks.onShowToast('Need Materials: 2 Moonbell Flora & 1 Phase Essence required.');
        }
      }
    }

    if (choice.nextNodeId && DIALOGUE_NODES[choice.nextNodeId]) {
      this.currentNodeId = choice.nextNodeId;
      return { closed: false, nextNode: this.getCurrentNode() };
    }

    // Default: remain on current node if it's stats or refresh choices
    return { closed: false, nextNode: this.getCurrentNode() };
  }
}
