/**
 * Solstice Haven Dialogue & Quest Data
 * Features Archmage Aurelius (Astrolabe Guide Wizard) and village residents.
 * Teaches calculus mechanics (derivatives of trig functions) and drives RPG quests.
 */

export interface DialogueChoice {
  text: string;
  nextNodeId?: string;
  action?: 'accept_quest_1' | 'accept_quest_2' | 'accept_quest_3' | 'claim_quest' | 'open_stats' | 'close';
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
  choices: DialogueChoice[];
}

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
    description: 'Cross the arched bridge north to the Sunken Sun-Ruins. Malakor\'s energy diverges infinitely at asymptotes; shatter his ward with sec² θ.',
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
    text: 'Greetings, seeker of resonance. The celestial astrolabe spins above Solstice Haven. The ancient bosses across our valley are manifestations of differential harmonics. What guidance do you seek?',
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
    text: 'Every boss channels a fundamental trigonometric function: f(θ). Their wards shield against ordinary strikes, but a Resonance Strike matching the EXACT derivative f\'(θ) shatters their barrier! For example, when Vespera channels sin(θ), the rate of change is cos(θ). Striking at the critical slope (f\'(θ) = 0) delivers a catastrophic Critical Stagger!',
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
    text: 'Clang and resonance! Welcome to my forge, traveler. A blade is only as sharp as the math behind it. If your strike fails to match the ward\'s derivative, the harmonic backlash will jar your bones! Keep your sigil attuned, and strike true.',
    choices: [
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
    text: 'I temper steel using ore mined from the Skyridge foothills and cooled in the northern brook. Archmage Aurelius imbues the metal with astrolabe sigils so your blade can slice through trigonometric shields.',
    choices: [
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
    text: 'The meadow flowers are blooming with radiant energy today! If you are injured from your travels, drink from your Crimson Flask ([R] on keyboard or the flask icon). You can rest by the town fountain anytime to recover.',
    choices: [
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
    text: 'In the Whispering Glade to the northwest, moonlit bellflowers blossom in harmonic waves. Malakor\'s crypt to the north has sun-ruin moss, and near the dragon crags you can find amber sun-petals.',
    choices: [
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
    text: 'Hail, adventurer! I scout the valley perimeter. The cobblestone trails lead directly from this plaza to all three boss landmarks. Follow the northwest path for the witch, the northern bridge path for the lich, and the northeast uphill trail for the dragon.',
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
