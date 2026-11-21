/**
 * Solstice Haven Dialogue & Quest Data
 * Features Archmage Aurelius (Astrolabe Guide Wizard) and village residents.
 * Teaches calculus mechanics (derivatives of trig functions) and drives RPG quests.
 */

export interface DialogueChoice {
  text: string;
  nextNodeId?: string;
  action?: 'accept_quest_1' | 'accept_quest_2' | 'accept_quest_3' | 'claim_quest' | 'open_stats' | 'upgrade_weapon' | 'upgrade_flask' | 'close';
  statToAllocate?: 'vigor' | 'endurance' | 'harmonics';
  requiresQuestState?: { questId: string; state: 'unstarted' | 'active' | 'completed' };
  requiresBossDefeat?: string;
  requiresUnspentStats?: boolean;
}

export interface DialogueNode {
  id: string;
  speakerName: string;
  speakerTitle: string;
  speakerRole: 'aurelius' | 'blacksmith' | 'herbalist' | 'scout';
  text: string;
  voiceId?: string;
  choices: DialogueChoice[];
}

export const AURELIUS_RESTORED_LINE = {
  voiceId: 'aurelius_restored',
  text: 'The Celestial Astrolabe shines again. Solstice Haven is safe, Spellblade.',
};

export interface QuestDefinition {
  id: string;
  title: string;
  bossTargetId: 'witch' | 'lich' | 'dragon';
  requiredDerivative: string;
  description: string;
  rewardXp: number;
  rewardText: string;
}

export const QUESTS: Record<string, QuestDefinition> = {
  quest_sine_ward: {
    id: 'quest_sine_ward',
    title: 'Shatter the Sine Ward',
    bossTargetId: 'witch',
    requiredDerivative: 'd/dθ(sin θ) = cos θ',
    description: 'Travel northwest to the Whispering Glade. Disrupt Vespera\'s oscillating petal wards using the Cosine derivative.',
    rewardXp: 250,
    rewardText: '250 Astral Insight (XP) + 1 Stat Point',
  },
  quest_asymptote: {
    id: 'quest_asymptote',
    title: 'Tame the Asymptote',
    bossTargetId: 'lich',
    requiredDerivative: 'd/dθ(tan θ) = sec² θ',
    description: 'Leave by the south gate and follow the road to the Sunken Sun-Ruins. Malakor\'s energy diverges infinitely at asymptotes; shatter his ward with sec² θ.',
    rewardXp: 400,
    rewardText: '400 Astral Insight (XP) + 1 Stat Point',
  },
  quest_skyridge_wyrm: {
    id: 'quest_skyridge_wyrm',
    title: 'Ground the Skyridge Wyrm',
    bossTargetId: 'dragon',
    requiredDerivative: 'd/dθ(sec θ) = sec θ tan θ',
    description: 'Ascend the northeast crags to Skyridge Peak. Vaelorath soars at hyperbolic speeds; ground him using sec θ tan θ.',
    rewardXp: 600,
    rewardText: '600 Astral Insight (XP) + Master Astrolabe Title',
  },
};

export const DIALOGUE_NODES: Record<string, DialogueNode> = {
  // ================= Archmage Aurelius =================
  aurelius_root: {
    id: 'aurelius_root',
    speakerName: 'Archmage Aurelius',
    speakerTitle: 'Guardian of the Astrolabe & Guide Wizard',
    speakerRole: 'aurelius',
    text: 'The Celestial Astrolabe shields Solstice Haven, but its light is fading. Recover Vespera’s Prism, Malakor’s Seal, and Vaelorath’s Crest from the three guardians. Start with Vespera in the Whispering Glade to learn how Sine and Cosine work together. Inspect each relic after the fight, then bring all three to the Astrolabe beside me.',
    choices: [
      {
        text: 'How does differential calculus counter monster wards?',
        nextNodeId: 'aurelius_calculus_lesson',
      },
      {
        text: 'Do you have a quest for me, Archmage?',
        nextNodeId: 'aurelius_quest_hub',
      },
      {
        text: 'I wish to attune my Astral Insight (Spend Stat Points).',
        nextNodeId: 'aurelius_stats_hub',
        requiresUnspentStats: true,
      },
      {
        text: 'I must be on my way.',
        action: 'close',
      },
    ],
  },

  aurelius_calculus_lesson: {
    id: 'aurelius_calculus_lesson',
    speakerName: 'Archmage Aurelius',
    speakerTitle: 'Guardian of the Astrolabe & Guide Wizard',
    speakerRole: 'aurelius',
    text: 'When Vespera casts Sine, sin(θ), use Cosine, cos(θ). Cosine gives the slope of Sine, so the matching sigil can break her ward. Guided Math equips it for you. With Guided Math off, press Q or tap Sigils to choose it, then cast at her.',
    choices: [
      {
        text: 'What about tangent and secant?',
        nextNodeId: 'aurelius_advanced_lesson',
      },
      {
        text: 'I understand now. Thank you.',
        nextNodeId: 'aurelius_root',
      },
    ],
  },

  aurelius_advanced_lesson: {
    id: 'aurelius_advanced_lesson',
    speakerName: 'Archmage Aurelius',
    speakerTitle: 'Guardian of the Astrolabe & Guide Wizard',
    speakerRole: 'aurelius',
    text: 'Tan(θ) races towards vertical asymptotes, countered only by sec²(θ). And Vaelorath\'s aerial sec(θ) trajectory requires sec(θ)tan(θ). Master all 6 trigonometric derivatives, and the entire valley will revere your resonance!',
    choices: [
      {
        text: 'Let us discuss quests.',
        nextNodeId: 'aurelius_quest_hub',
      },
      {
        text: 'Return to main options.',
        nextNodeId: 'aurelius_root',
      },
    ],
  },

  aurelius_quest_hub: {
    id: 'aurelius_quest_hub',
    speakerName: 'Archmage Aurelius',
    speakerTitle: 'Guardian of the Astrolabe & Guide Wizard',
    speakerRole: 'aurelius',
    text: 'Three cosmic anomalies threaten the valley. Which undertaking calls to your blade?',
    choices: [
      {
        text: 'Quest 1: Shatter the Sine Ward (Whispering Glade)',
        action: 'accept_quest_1',
        requiresQuestState: { questId: 'quest_sine_ward', state: 'unstarted' },
      },
      {
        text: 'Claim Reward: Sine Ward Shattered!',
        action: 'claim_quest',
        requiresQuestState: { questId: 'quest_sine_ward', state: 'active' },
        requiresBossDefeat: 'witch',
      },
      {
        text: 'Quest 2: Tame the Asymptote (Sunken Sun-Ruins)',
        action: 'accept_quest_2',
        requiresQuestState: { questId: 'quest_asymptote', state: 'unstarted' },
      },
      {
        text: 'Claim Reward: Asymptote Tamed!',
        action: 'claim_quest',
        requiresQuestState: { questId: 'quest_asymptote', state: 'active' },
        requiresBossDefeat: 'lich',
      },
      {
        text: 'Quest 3: Ground the Skyridge Wyrm (Skyridge Peak)',
        action: 'accept_quest_3',
        requiresQuestState: { questId: 'quest_skyridge_wyrm', state: 'unstarted' },
      },
      {
        text: 'Claim Reward: Wyrm Grounded!',
        action: 'claim_quest',
        requiresQuestState: { questId: 'quest_skyridge_wyrm', state: 'active' },
        requiresBossDefeat: 'dragon',
      },
      {
        text: 'Back to conversation.',
        nextNodeId: 'aurelius_root',
      },
    ],
  },

  aurelius_stats_hub: {
    id: 'aurelius_stats_hub',
    speakerName: 'Archmage Aurelius',
    speakerTitle: 'Guardian of the Astrolabe & Guide Wizard',
    speakerRole: 'aurelius',
    text: 'Your Astral Insight resonates deeply. Channel your unspent Stat Points to empower your journey across the valley:',
    choices: [
      {
        text: 'Attune Vigor (+20 Max HP per point)',
        action: 'open_stats',
        statToAllocate: 'vigor',
      },
      {
        text: 'Attune Endurance (+15 Max Stamina per point)',
        action: 'open_stats',
        statToAllocate: 'endurance',
      },
      {
        text: 'Attune Harmonics (+0.25x Resonance Multiplier per point)',
        action: 'open_stats',
        statToAllocate: 'harmonics',
      },
      {
        text: 'Return to main options.',
        nextNodeId: 'aurelius_root',
      },
    ],
  },

  // ================= Townsfolk Barks =================
  blacksmith_root: {
    id: 'blacksmith_root',
    speakerName: 'Theron the Smith',
    speakerTitle: 'Weaponsmith & Ward Refiner',
    speakerRole: 'blacksmith',
    text: 'Welcome to my forge, traveler. A blade is only as sharp as the math behind it. If your strike fails to match the ward\'s derivative, the harmonic backlash will jar your bones! Keep your sigil attuned, and strike true.',
    choices: [
      {
        text: 'Refine Spellblade (Requires 2 Mithril Ore, 1 Ancient Bone) [+10% Damage]',
        action: 'upgrade_weapon',
      },
      {
        text: 'What do you craft here, Theron?',
        nextNodeId: 'blacksmith_lore',
      },
      {
        text: 'Thank you, Theron. Farewell.',
        action: 'close',
      },
    ],
  },

  blacksmith_lore: {
    id: 'blacksmith_lore',
    speakerName: 'Theron the Smith',
    speakerTitle: 'Weaponsmith & Ward Refiner',
    speakerRole: 'blacksmith',
    text: 'I temper steel using ore mined from the Skyridge foothills and cooled in the northern brook. Archmage Aurelius imbues the metal with astrolabe sigils so your blade can slice through trigonometric shields. Bring me 2 Mithril Ore and 1 Ancient Bone from the wilds, and I will temper your Spellblade up to Tier 5 (+10% damage each time).',
    choices: [
      {
        text: 'Refine Spellblade now.',
        action: 'upgrade_weapon',
      },
      {
        text: 'Good to know. Farewell!',
        action: 'close',
      },
    ],
  },

  herbalist_root: {
    id: 'herbalist_root',
    speakerName: 'Lyra the Herbalist',
    speakerTitle: 'Flora Botanist & Potion Brewer',
    speakerRole: 'herbalist',
    text: 'The meadow flowers are blooming with radiant energy today! If you are injured from your travels, drink from your Crimson Flask. Press R on keyboard, or tap the flask icon. You can rest by the town fountain anytime to recover.',
    choices: [
      {
        text: 'Brew Crimson Draught (Requires 2 Moonbell, 1 Phase Essence) [+1 Max Flask]',
        action: 'upgrade_flask',
      },
      {
        text: 'What herbs grow around the valley?',
        nextNodeId: 'herbalist_lore',
      },
      {
        text: 'Safe travels, Lyra.',
        action: 'close',
      },
    ],
  },

  herbalist_lore: {
    id: 'herbalist_lore',
    speakerName: 'Lyra the Herbalist',
    speakerTitle: 'Flora Botanist & Potion Brewer',
    speakerRole: 'herbalist',
    text: 'Cross the north gate bridge and take the left fork to Whispering Glade. Two Moonbell blossoms grow along the trail before Vespera\'s grove. The Phase Wolves there carry Phase Essence. Attune to cos θ to break their sin θ wards. Bring me 2 Moonbell and 1 Phase Essence for another Crimson Flask charge.',
    choices: [
      {
        text: 'Brew Crimson Draught now.',
        action: 'upgrade_flask',
      },
      {
        text: 'Fascinating. Thank you, Lyra.',
        action: 'close',
      },
    ],
  },

  scout_root: {
    id: 'scout_root',
    speakerName: 'Eldrin the Scout',
    speakerTitle: 'Frontier Ranger & Trailhead Guide',
    speakerRole: 'scout',
    text: 'Greetings, traveler! Follow the road through the south gate to the Sunken Sun-Ruins. For Whispering Glade or Skyridge Peak, cross the bridge at the north gate. The left fork leads to the glade, and the right fork climbs to the peak.',
    choices: [
      {
        text: 'Any survival advice for the wilds?',
        nextNodeId: 'scout_advice',
      },
      {
        text: 'Thanks for the directions, Eldrin.',
        action: 'close',
      },
    ],
  },

  scout_advice: {
    id: 'scout_advice',
    speakerName: 'Eldrin the Scout',
    speakerTitle: 'Frontier Ranger & Trailhead Guide',
    speakerRole: 'scout',
    text: 'Monsters telegraph their deadly magic attacks! Look for glowing runic circles forming on the grass under your feet. When the outer ring collapses, sprint ([Shift]), jump ([Space]), or dodge roll ([C]) away before impact!',
    choices: [
      {
        text: 'I will watch my footing. Thanks!',
        action: 'close',
      },
    ],
  },
};
