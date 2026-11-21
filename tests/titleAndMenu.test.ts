import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createDefaultProgression,
  hasSavedProgression,
  getProgressionSummary,
  saveProgression,
  resetProgression,
  addXp,
  startQuest,
  completeQuest,
  recordBossDefeat,
} from '../src/rpg/progressionSystem';
import { GameUI, type UIHandlers } from '../src/ui/GameUI';
import { DEFAULT_SETTINGS } from '../src/engine/GraphicsSettings';
import { buildWorkedExample } from '../src/math/trigDerivatives';

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

class MockClassList {
  private set = new Set<string>();
  constructor(initial = '') {
    initial
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.set.add(c));
  }
  add(...tokens: string[]): void {
    tokens.forEach((t) => this.set.add(t));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.set.delete(t));
  }
  toggle(token: string, force?: boolean): boolean {
    if (force !== undefined) {
      if (force) this.set.add(token);
      else this.set.delete(token);
      return force;
    }
    if (this.set.has(token)) {
      this.set.delete(token);
      return false;
    }
    this.set.add(token);
    return true;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
  toString(): string {
    return Array.from(this.set).join(' ');
  }
}

class MockElement {
  public tagName: string;
  public classList: MockClassList;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public _directText: string = '';
  public value: string = '';
  private attributes: Record<string, string> = {};
  private listeners: Record<string, ((e?: any) => void)[]> = {};

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
  }

  get textContent(): string {
    let text = this._directText;
    for (const child of this.children) {
      text += child.textContent;
    }
    return text;
  }
  set textContent(v: string) {
    this._directText = v;
  }

  get id(): string {
    return this.attributes['id'] ?? '';
  }
  set id(v: string) {
    this.attributes['id'] = v;
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(v: string) {
    this.classList = new MockClassList(v);
  }

  focus(): void {}

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'class') {
      this.classList = new MockClassList(value);
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.classList.toString() || null;
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  appendChild<T extends MockElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, fn: (e?: any) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event: { type: string; stopPropagation?: () => void; preventDefault?: () => void }): boolean {
    const list = this.listeners[event.type] || [];
    for (const fn of list) fn(event);
    return true;
  }

  click(): void {
    this.dispatchEvent({ type: 'click', stopPropagation: () => {}, preventDefault: () => {} });
  }

  trigger(event: string, extra: any = {}): void {
    this.dispatchEvent({ type: event, stopPropagation: () => {}, preventDefault: () => {}, ...extra });
  }

  set innerHTML(html: string) {
    this.children = [];
    this.textContent = '';
    parseHtmlInto(html, this);
  }

  get innerHTML(): string {
    return this.children.map((c) => c.toString()).join('');
  }

  querySelector(selector: string): MockElement | null {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    querySelectorAllInternal(this, selector, results);
    return results;
  }

  toString(): string {
    return `<${this.tagName.toLowerCase()}>${this.textContent}</${this.tagName.toLowerCase()}>`;
  }
}

function matchesSimpleSelector(el: MockElement, sel: string): boolean {
  sel = sel.trim();
  if (sel.startsWith('#')) {
    return el.id === sel.slice(1);
  }
  if (sel.startsWith('.')) {
    return el.classList.contains(sel.slice(1));
  }
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const inner = sel.slice(1, -1);
    const eqIdx = inner.indexOf('=');
    if (eqIdx >= 0) {
      const key = inner.slice(0, eqIdx).trim();
      let val = inner.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return el.getAttribute(key) === val;
    }
    return el.hasAttribute(inner);
  }
  if (/^[a-zA-Z0-9-]+$/.test(sel)) {
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }
  return false;
}

function matchesCompoundSelector(el: MockElement, compound: string): boolean {
  const re = /(^[a-zA-Z0-9-]+)|(#([a-zA-Z0-9_-]+))|(\.([a-zA-Z0-9_-]+))|(\[([^\]]+)\])/g;
  let match: RegExpExecArray | null;
  let matchedAny = false;
  while ((match = re.exec(compound)) !== null) {
    matchedAny = true;
    if (match[1]) {
      if (el.tagName.toLowerCase() !== match[1].toLowerCase()) return false;
    } else if (match[3]) {
      if (el.id !== match[3]) return false;
    } else if (match[5]) {
      if (!el.classList.contains(match[5])) return false;
    } else if (match[6]) {
      if (!matchesSimpleSelector(el, match[6])) return false;
    }
  }
  return matchedAny;
}

function matchesSelector(el: MockElement, selector: string): boolean {
  const parts = selector.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    if (!matchesCompoundSelector(el, parts[parts.length - 1])) return false;
    let curr: MockElement | null = el.parentNode;
    let pIdx = parts.length - 2;
    while (curr && pIdx >= 0) {
      if (matchesCompoundSelector(curr, parts[pIdx])) {
        pIdx--;
      }
      curr = curr.parentNode;
    }
    return pIdx < 0;
  }
  return matchesCompoundSelector(el, selector);
}

function querySelectorInternal(node: MockElement, selector: string): MockElement | null {
  for (const child of node.children) {
    if (matchesSelector(child, selector)) return child;
    const found = querySelectorInternal(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorAllInternal(node: MockElement, selector: string, results: MockElement[]): void {
  for (const child of node.children) {
    if (matchesSelector(child, selector)) results.push(child);
    querySelectorAllInternal(child, selector, results);
  }
}

function parseHtmlInto(html: string, parent: MockElement): void {
  const stack: MockElement[] = [parent];
  let current = parent;
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*?)(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith('<!--')) continue;
    const isClose = match[1];
    const tagName = match[2];
    const attrsStr = match[3];
    const isSelfClose = match[4];
    const textContent = match[5];

    if (textContent) {
      current.textContent += textContent;
    } else if (isClose) {
      if (stack.length > 1) {
        stack.pop();
        current = stack[stack.length - 1];
      }
    } else if (tagName) {
      const el = new MockElement(tagName);
      if (attrsStr) {
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let aMatch: RegExpExecArray | null;
        while ((aMatch = attrRegex.exec(attrsStr)) !== null) {
          const val = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
          el.setAttribute(aMatch[1], val);
        }
      }
      current.appendChild(el);
      const isVoid = !!isSelfClose || /^(input|img|br|hr|meta|link)$/i.test(tagName);
      if (!isVoid) {
        stack.push(el);
        current = el;
      }
    }
  }
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => new MockElement(tag),
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (globalThis as any).confirm === 'undefined') {
  (globalThis as any).confirm = () => true;
}

describe('Title Screen & Sanctuary Menu Helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports false for hasSavedProgression when localStorage is empty', () => {
    expect(hasSavedProgression()).toBe(false);
  });

  it('reports true when a saved state is stored in localStorage', () => {
    const defaultState = createDefaultProgression();
    saveProgression(defaultState);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has gained XP or leveled up', () => {
    const state = createDefaultProgression();
    addXp(state, 200); // Level 2
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has an active or completed quest', () => {
    const state = createDefaultProgression();
    startQuest(state, 'aurelius_intro');
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('reports true when player has defeated a boss', () => {
    const state = createDefaultProgression();
    recordBossDefeat(state, 'witch');
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);
  });

  it('resets save cleanly with resetProgression()', () => {
    const state = createDefaultProgression();
    addXp(state, 500);
    saveProgression(state);
    expect(hasSavedProgression()).toBe(true);

    resetProgression();
    expect(hasSavedProgression()).toBe(false);
  });

  it('generates a descriptive progression summary for title screen and pause card', () => {
    const state = createDefaultProgression();
    expect(getProgressionSummary(state)).toBe('Level 1 Spellblade');

    startQuest(state, 'aurelius_intro');
    expect(getProgressionSummary(state)).toContain('1 Quest Active');

    completeQuest(state, 'aurelius_intro', 150);
    expect(getProgressionSummary(state)).toContain('1 Quest Done');

    recordBossDefeat(state, 'witch');
    expect(getProgressionSummary(state)).toContain('1 Boss Defeated');
  });
});

describe('GameUI Title Screen Sidebar & In-Sidebar Settings Switch', () => {
  let root: MockElement;
  let handlers: UIHandlers;
  let startGameSpy: any;
  let warpBossSpy: any;
  let updateSettingsSpy: any;
  let openWorkedSpy: any;

  beforeEach(() => {
    localStorage.clear();
    root = new MockElement('div');
    startGameSpy = vi.fn();
    warpBossSpy = vi.fn();
    updateSettingsSpy = vi.fn();
    openWorkedSpy = vi.fn();

    handlers = {
      onStartGame: startGameSpy,
      onWarpBoss: warpBossSpy,
      onSelectSigil: vi.fn(),
      onTogglePov: vi.fn(),
      onToggleLockOn: vi.fn(),
      onOpenSigilPicker: vi.fn(),
      onCloseSigilPicker: vi.fn(),
      onTouchAction: vi.fn(),
      onTouchStick: vi.fn(),
      onUpdateSettings: updateSettingsSpy,
      onToggleGodMode: vi.fn(),
      onToggleInfiniteStamina: vi.fn(),
      onToggleFreezeTheta: vi.fn(),
      onForceStagger: vi.fn(),
      onOpenWorkedExample: openWorkedSpy,
      onCloseWorkedExample: vi.fn(),
      onOpenSettings: vi.fn(),
      onCloseSettings: vi.fn(),
    };
  });

  it('renders title screen as an elegant left-docked sidebar drawer', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);

    const titleOverlay = root.querySelector('#title-overlay');
    expect(titleOverlay).not.toBeNull();
    expect(titleOverlay!.classList.contains('title-sidebar-overlay')).toBe(true);
    expect(titleOverlay!.classList.contains('hidden')).toBe(false);

    // Initial state
    expect(ui.getTitleView()).toBe('main');
    expect(ui.isTitleSettingsOpen()).toBe(false);

    // Header, logo, crest, subtitle
    const titleMain = root.querySelector('.title-main');
    expect(titleMain).not.toBeNull();
    expect(titleMain!.textContent).toContain('ASHEN TANGENT');

    const titleCrest = root.querySelector('.title-crest');
    expect(titleCrest!.textContent).toContain('SUNLIT CHRONICLES');

    const controlsCheat = root.querySelector('.controls-cheat');
    expect(controlsCheat).not.toBeNull();
    expect(controlsCheat!.textContent).toContain('WASD Move');

    // Quick Waypoints
    expect(root.querySelector('#start-witch-btn')).not.toBeNull();
    expect(root.querySelector('#start-lich-btn')).not.toBeNull();
    expect(root.querySelector('#start-dragon-btn')).not.toBeNull();

    // Settings entry point
    expect(root.querySelector('#btn-title-settings')).not.toBeNull();
  });

  it('displays continue adventure button and saved journey badge when save exists', () => {
    const state = createDefaultProgression();
    addXp(state, 200); // Level 2
    saveProgression(state);

    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    expect(ui.getTitleView()).toBe('main');
    const saveBadge = root.querySelector('.save-status-badge');
    expect(saveBadge).not.toBeNull();
    expect(saveBadge!.textContent).toContain('Saved Journey: Level 2 Spellblade');

    const continueBtn = root.querySelector('#btn-continue');
    expect(continueBtn).not.toBeNull();
    expect(root.querySelector('#btn-new-game')).not.toBeNull();

    // Clicking Continue starts game without reset and hides sidebar
    continueBtn!.click();
    expect(startGameSpy).toHaveBeenCalledWith(false);
    expect(root.querySelector('#title-overlay')!.classList.contains('hidden')).toBe(true);
  });

  it('clicking ⚙ Sanctuary Settings flips sidebar to in-drawer settings without opening pause modal (Bugfix)', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);

    const settingsModal = root.querySelector('#settings-modal')!;
    expect(settingsModal.classList.contains('hidden')).toBe(true);

    const titleSettingsBtn = root.querySelector('#btn-title-settings')!;
    titleSettingsBtn.click();

    // View switched to settings inside sidebar
    expect(ui.getTitleView()).toBe('settings');
    expect(ui.isTitleSettingsOpen()).toBe(true);

    // BUGFIX VERIFICATION: The in-game pause modal remains HIDDEN
    expect(settingsModal.classList.contains('hidden')).toBe(true);

    // Prominent '← Back to Title' button
    const backBtn = root.querySelector('#btn-sidebar-back');
    expect(backBtn).not.toBeNull();
    expect(backBtn!.textContent).toContain('Back to Title');

    // Settings controls are present in the sidebar
    expect(root.querySelector('[data-sidebar-preset="ultra"]')).not.toBeNull();
    expect(root.querySelector('[data-sidebar-fps="120"]')).not.toBeNull();
    expect(root.querySelector('[data-sidebar-ctrl="mobile"]')).not.toBeNull();
    expect(root.querySelector('#sidebar-opt-fps')).not.toBeNull();
    expect(root.querySelector('#sidebar-opt-audio')).not.toBeNull();
    expect(root.querySelector('#sidebar-opt-sens')).not.toBeNull();
    expect(root.querySelector('#sidebar-btn-worked')).not.toBeNull();
  });

  it('clicking ← Back to Title restores main title view', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.openTitleSettings();
    expect(ui.getTitleView()).toBe('settings');

    const backBtn = root.querySelector('#btn-sidebar-back')!;
    backBtn.click();

    expect(ui.getTitleView()).toBe('main');
    expect(ui.isTitleSettingsOpen()).toBe(false);
    expect(root.querySelector('.title-main')).not.toBeNull();
  });

  it('adjusting settings in sidebar updates state and triggers onUpdateSettings', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.openTitleSettings();

    // 1. Change Preset to Ultra
    const ultraBtn = root.querySelector('[data-sidebar-preset="ultra"]')!;
    ultraBtn.click();
    expect(updateSettingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: 'ultra' }),
    );

    // 2. Change Target FPS to 120
    const fpsBtn = root.querySelector('[data-sidebar-fps="120"]')!;
    fpsBtn.click();
    expect(updateSettingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ fpsCap: 120 }),
    );

    // 3. Change Controls Mode to mobile
    const ctrlBtn = root.querySelector('[data-sidebar-ctrl="mobile"]')!;
    ctrlBtn.click();
    expect(updateSettingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ controlMode: 'mobile' }),
    );

    // 4. Toggle Audio
    const audioBtn = root.querySelector('#sidebar-opt-audio')!;
    audioBtn.click();
    expect(updateSettingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ audioEnabled: false }),
    );

    // 5. Open Worked Example
    const workedBtn = root.querySelector('#sidebar-btn-worked')!;
    workedBtn.click();
    expect(openWorkedSpy).toHaveBeenCalled();
  });

  it('starts game and warps when waypoint buttons are clicked', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    expect(ui.getTitleView()).toBe('main');
    const witchBtn = root.querySelector('#start-witch-btn')!;
    witchBtn.click();

    expect(startGameSpy).toHaveBeenCalledWith(false);
    expect(warpBossSpy).toHaveBeenCalledWith('witch');
    expect(root.querySelector('#title-overlay')!.classList.contains('hidden')).toBe(true);
  });

  it('handles New Adventure with confirm true vs confirm false', () => {
    const state = createDefaultProgression();
    addXp(state, 500);
    saveProgression(state);

    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    expect(ui.getTitleView()).toBe('main');
    const newGameBtn = root.querySelector('#btn-new-game')!;

    // Case 1: Cancel confirmation
    (globalThis as any).confirm = () => false;
    newGameBtn.click();
    expect(hasSavedProgression()).toBe(true);
    expect(startGameSpy).not.toHaveBeenCalled();
    expect(root.querySelector('#title-overlay')!.classList.contains('hidden')).toBe(false);

    // Case 2: Confirm reset
    (globalThis as any).confirm = () => true;
    newGameBtn.click();
    expect(hasSavedProgression()).toBe(false);
    expect(startGameSpy).toHaveBeenCalledWith(true);
    expect(root.querySelector('#title-overlay')!.classList.contains('hidden')).toBe(true);
  });

  it('updates camera sensitivity on slider input and updates readout label', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.openTitleSettings();

    const sensInput = root.querySelector('#sidebar-opt-sens') as MockElement;
    const sensVal = root.querySelector('#sidebar-sens-val')!;
    expect(sensInput).not.toBeNull();
    expect(sensVal.textContent).toContain('1.0×');

    sensInput.value = '1.8';
    sensInput.trigger('input');

    expect(updateSettingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ sensitivity: 1.8 }),
    );
    expect(sensVal.textContent).toBe('1.8×');
  });

  it('resets to main title view when showTitleOverlay is called from quit to title', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.openTitleSettings();
    expect(ui.getTitleView()).toBe('settings');

    ui.showTitleOverlay();
    expect(ui.getTitleView()).toBe('main');
    expect(ui.isTitleSettingsOpen()).toBe(false);
    expect(root.querySelector('.title-main')).not.toBeNull();
  });

  it('supports in-game pause modal via openSettingsModal while keeping gameplay controls', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    const settingsModal = root.querySelector('#settings-modal')!;

    ui.openSettingsModal(DEFAULT_SETTINGS);
    expect(settingsModal.classList.contains('hidden')).toBe(false);
    expect(settingsModal.querySelector('#opt-resume')).not.toBeNull();
    expect(settingsModal.querySelector('#opt-quit-title')).not.toBeNull();

    ui.closeSettingsModal();
    expect(settingsModal.classList.contains('hidden')).toBe(true);
  });

  it('handles worked example modal open/close and dynamic button label depending on title state', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    const dummySnapshot = {
      functionFormula: 'f(θ) = sin(θ)',
      derivativeRule: "d/dθ[sin(θ)] = cos(θ)",
      thetaPiLabel: 'π/3',
      evaluatedFunction: 0.866,
      evaluatedSlope: 0.5,
      numericSlope: 0.5,
      chosenSigilLabel: 'cos(θ)',
      isExactMatch: true,
      damageMultiplier: 3.25,
      isCriticalPoint: false,
      nearAsymptote: false,
      outcomeSummary: 'Phase Ward shattered cleanly',
    };

    // 1. Opened from title screen
    ui.openTitleSettings();
    ui.showWorkedExample(dummySnapshot as any);
    expect(ui.isWorkedExampleOpen()).toBe(true);

    const workedModal = root.querySelector('#worked-modal')!;
    expect(workedModal.classList.contains('hidden')).toBe(false);

    const closeBtn = root.querySelector('#worked-close')!;
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.textContent).toBe('Return to Sanctuary Settings');

    closeBtn.click();
    expect(ui.isWorkedExampleOpen()).toBe(false);
    expect(workedModal.classList.contains('hidden')).toBe(true);

    // 2. Opened in combat (title overlay hidden)
    root.querySelector('#title-overlay')!.classList.add('hidden');
    ui.showWorkedExample(dummySnapshot as any);
    expect(ui.isWorkedExampleOpen()).toBe(true);

    const inGameCloseBtn = root.querySelector('#worked-close')!;
    expect(inGameCloseBtn.textContent).toBe('Resume Combat');

    ui.closeWorkedExample();
    expect(ui.isWorkedExampleOpen()).toBe(false);
  });

  it('shows the substituted derivative, matching sigil, and recorded combat result', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.showWorkedExample(buildWorkedExample('sin', Math.PI / 3, 'cos', 'ward_shattered', 3.6));

    const worked = root.querySelector('#worked-modal')!;
    const fight = worked.querySelector('#worked-fight')!;
    expect(fight.classList.contains('hidden')).toBe(true);
    worked.querySelector('#worked-fight-view')!.click();
    expect(fight.classList.contains('hidden')).toBe(false);
    expect(fight.querySelector('.solution-steps')!.textContent).toContain('f′(θ₀) ≈ cos(1.047198) ≈ 0.500');
    expect(fight.querySelector('.solution-steps')!.textContent).toContain('Equip Cosine');
    expect(fight.querySelector('.solution-outcome')!.textContent).toContain('3.60× damage');
    worked.querySelector('#worked-practice-view')!.click();
    expect(fight.classList.contains('hidden')).toBe(true);
  });

  it('keeps an undefined combat slope in the fight view and starts with usable practice numbers', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.showWorkedExample(buildWorkedExample('tan', Math.PI / 2, 'sec2', 'resonance_hit', 1));

    const worked = root.querySelector('#worked-modal')!;
    expect(worked.querySelector('#worked-practice')!.textContent).toContain('Slope = 2 × 4 = 8');
    worked.querySelector('#worked-fight-view')!.click();
    const fight = worked.querySelector('#worked-fight')!;
    expect(fight.querySelector('.solution-steps')!.textContent).toContain('cos(θ₀) = 0, so f′(θ₀) is undefined');
    expect(fight.querySelector('.solution-tangent')).toBeNull();
  });

  it('lets a practice-only lesson switch to a different numerical example', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.showWorkedExample(buildWorkedExample('sin', Math.PI / 3, 'cos', 'resonance_hit', 1), true);

    const worked = root.querySelector('#worked-modal')!;
    const picker = worked.querySelector('#practice-example')!;
    picker.value = 'tan';
    picker.trigger('change');
    expect(worked.querySelector('#practice-work')!.textContent).toContain('y′ = 2 × sec²(2x)');
    expect(worked.querySelector('#practice-work')!.textContent).toContain('Slope = 2 × 4 = 8');
    expect(worked.querySelector('#worked-fight')).toBeNull();
  });

  it('allows a retry or guidance and completes the restoration only after confirmation', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    const submit = vi.fn(() => true);
    const close = vi.fn();
    ui.showRestoration(submit, close);
    const confirm = root.querySelector('#restoration-confirm')!;

    root.querySelector('[data-restoration-sigil="neg_sin"]')!.click();
    confirm.click();
    expect(submit).not.toHaveBeenCalled();
    expect(root.querySelector('#restoration-feedback')!.textContent).toContain('Try again');

    root.querySelector('#restoration-guide')!.click();
    expect(root.querySelector('[data-restoration-sigil="cos"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#restoration-feedback')!.textContent).toContain('cos(π/3) = 1/2');
    expect(submit).not.toHaveBeenCalled();
    confirm.click();
    expect(submit).toHaveBeenCalledWith('cos');
    expect(ui.isRestorationOpen()).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('syncSettings updates currentSettings and re-renders active pills in title settings view', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);
    ui.openTitleSettings();

    // Verify initial preset pill is high (default)
    expect(root.querySelector('[data-sidebar-preset="high"]')!.classList.contains('active')).toBe(true);

    // Synchronize settings from outside (e.g. engine or in-game pause)
    ui.syncSettings({
      ...DEFAULT_SETTINGS,
      preset: 'ultra',
      fpsCap: 120,
      controlMode: 'mobile',
      showFps: true,
      audioEnabled: false,
      sensitivity: 1.9,
    });

    expect(root.querySelector('[data-sidebar-preset="ultra"]')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-sidebar-fps="120"]')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('[data-sidebar-ctrl="mobile"]')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('#sidebar-opt-fps')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('#sidebar-opt-audio')!.textContent).toContain('MUTED');
    expect(root.querySelector('#sidebar-sens-val')!.textContent).toBe('1.9×');
  });

  it('showTitleOverlay accepts fresh settings upon returning from active journey', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);

    const customSettings = {
      ...DEFAULT_SETTINGS,
      preset: 'low' as const,
      sensitivity: 1.5,
      audioEnabled: false,
    };

    ui.showTitleOverlay(customSettings);
    expect(ui.getTitleView()).toBe('main');

    ui.openTitleSettings();
    expect(root.querySelector('[data-sidebar-preset="low"]')!.classList.contains('active')).toBe(true);
    expect(root.querySelector('#sidebar-sens-val')!.textContent).toBe('1.5×');
    expect(root.querySelector('#sidebar-opt-audio')!.textContent).toContain('MUTED');
  });

  it('simulates keyboard Esc flow: closes worked example first, then navigates to title main', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);

    const dummySnapshot = {
      functionFormula: 'f(θ) = sin(θ)',
      derivativeRule: "d/dθ[sin(θ)] = cos(θ)",
      thetaPiLabel: 'π/3',
      evaluatedFunction: 0.866,
      evaluatedSlope: 0.5,
      numericSlope: 0.5,
      chosenSigilLabel: 'cos(θ)',
      isExactMatch: true,
      damageMultiplier: 3.25,
      isCriticalPoint: false,
      nearAsymptote: false,
      outcomeSummary: 'Phase Ward shattered cleanly',
    };

    // Helper simulating engine onTogglePause
    let started = false;
    let paused = false;
    const handleEsc = () => {
      if (ui.isWorkedExampleOpen()) {
        ui.closeWorkedExample();
        paused = false;
        return;
      }
      if (!started) {
        if (ui.isTitleSettingsOpen()) {
          ui.showTitleMainView();
        }
        return;
      }
      paused = !paused;
    };

    // Open settings and worked example on title screen
    ui.openTitleSettings();
    ui.showWorkedExample(dummySnapshot as any);
    expect(ui.isWorkedExampleOpen()).toBe(true);
    expect(ui.isTitleSettingsOpen()).toBe(true);

    // Esc 1: Closes worked example, title settings remains open
    handleEsc();
    expect(ui.isWorkedExampleOpen()).toBe(false);
    expect(ui.isTitleSettingsOpen()).toBe(true);
    expect(ui.getTitleView()).toBe('settings');

    // Esc 2: Navigates back to title main
    handleEsc();
    expect(ui.isTitleSettingsOpen()).toBe(false);
    expect(ui.getTitleView()).toBe('main');

    // Esc 3: Main title view remains unaffected
    handleEsc();
    expect(ui.getTitleView()).toBe('main');
  });

  it('manages boss cutscene overlay state, banner data, and finish callbacks', () => {
    const ui = new GameUI(root as any, handlers, DEFAULT_SETTINGS);

    expect(ui.isCutsceneActive()).toBe(false);

    let finished = false;
    ui.showBossCutscene('witch', () => {
      finished = true;
    });

    expect(ui.isCutsceneActive()).toBe(true);

    // Verify HUD is hidden during boss cutscene for immersion
    const topLeft = root.querySelector('.hud-top-left')!;
    const topRight = root.querySelector('.hud-top-right')!;
    const bottomRight = root.querySelector('.hud-bottom-right')!;
    expect(topLeft.classList.contains('hud-hidden')).toBe(true);
    expect(topRight.classList.contains('hud-hidden')).toBe(true);
    expect(bottomRight.classList.contains('hud-hidden')).toBe(true);

    const nameEl = root.querySelector('#cutscene-boss-name')!;
    expect(nameEl.textContent).toBe('VESPERA');

    const bannerEl = root.querySelector('#boss-cutscene-banner')!;
    expect(bannerEl).not.toBeNull();

    // Hide cutscene (skip or finished) - restores HUD visibility
    ui.hideBossCutscene();
    expect(ui.isCutsceneActive()).toBe(false);
    expect(finished).toBe(true);
    expect(topLeft.classList.contains('hud-hidden')).toBe(false);
    expect(topRight.classList.contains('hud-hidden')).toBe(false);
    expect(bottomRight.classList.contains('hud-hidden')).toBe(false);
  });
});
