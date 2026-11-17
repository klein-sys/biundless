import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  worldToMapNormalized,
  mapNormalizedToWorld,
  InteractiveAtlas,
} from '../src/ui/InteractiveAtlas';
import { GameUI, type UIHandlers } from '../src/ui/GameUI';
import { DEFAULT_SETTINGS } from '../src/engine/GraphicsSettings';
import { createDefaultProgression } from '../src/rpg/progressionSystem';

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
  public width = 160;
  public height = 160;
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

  getContext(type: string): any {
    if (type === '2d') {
      return {
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        clip: vi.fn(),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillRect: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      };
    }
    return null;
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
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
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
      if (matchesCompoundSelector(curr, parts[pIdx])) pIdx--;
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
    body: new MockElement('body'),
  };
}

describe('Minimap & Atlas Cartographic System', () => {
  it('maps center world coordinate (0, 0) to normalized center (0.5, 0.5)', () => {
    const { u, v } = worldToMapNormalized(0, 0);
    expect(u).toBeCloseTo(0.5, 2);
    expect(v).toBeCloseTo(0.5, 2);
  });

  it('clamps coordinates beyond playable radius to [0, 1]', () => {
    const farNegative = worldToMapNormalized(-300, -300);
    expect(farNegative.u).toBe(0);
    expect(farNegative.v).toBe(0);

    const farPositive = worldToMapNormalized(300, 300);
    expect(farPositive.u).toBe(1);
    expect(farPositive.v).toBe(1);
  });

  it('supports roundtrip conversion between world and normalized map coordinates', () => {
    const worldX = 42.5;
    const worldZ = -30.2;
    const { u, v } = worldToMapNormalized(worldX, worldZ);
    const converted = mapNormalizedToWorld(u, v);
    expect(converted.x).toBeCloseTo(worldX, 1);
    expect(converted.z).toBeCloseTo(worldZ, 1);
  });

  it('manages InteractiveAtlas modal visibility and warp handlers', () => {
    const warpSpy = vi.fn();
    const closeSpy = vi.fn();
    const atlas = new InteractiveAtlas({
      onWarp: warpSpy,
      onClose: closeSpy,
    });

    expect(atlas.visible).toBe(false);

    atlas.open({ x: 0, z: 0 }, Math.PI, createDefaultProgression());
    expect(atlas.visible).toBe(true);

    atlas.close();
    expect(atlas.visible).toBe(false);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GameUI Mobile Ergonomics & Atlas Integration', () => {
  let root: HTMLElement;
  let handlers: UIHandlers;
  let ui: GameUI;

  beforeEach(() => {
    root = new MockElement('div') as any;
    handlers = {
      onStartGame: vi.fn(),
      onWarpBoss: vi.fn(),
      onSelectSigil: vi.fn(),
      onTogglePov: vi.fn(),
      onToggleLockOn: vi.fn(),
      onOpenWheel: vi.fn(),
      onCloseWheel: vi.fn(),
      onTouchAction: vi.fn(),
      onTouchStick: vi.fn(),
      onUpdateSettings: vi.fn(),
      onToggleGodMode: vi.fn(),
      onToggleInfiniteStamina: vi.fn(),
      onToggleFreezeTheta: vi.fn(),
      onForceStagger: vi.fn(),
      onOpenWorkedExample: vi.fn(),
      onCloseWorkedExample: vi.fn(),
      onOpenSettings: vi.fn(),
      onCloseSettings: vi.fn(),
      onReturnToTown: vi.fn(),
      onOpenAtlas: vi.fn(),
      onCloseAtlas: vi.fn(),
    };
    ui = new GameUI(root, handlers, DEFAULT_SETTINGS);
  });

  it('initializes atlas and toggles atlas visibility', () => {
    expect(ui.isAtlasOpen()).toBe(false);

    ui.openAtlas({ x: 0, z: 0 }, Math.PI);
    expect(ui.isAtlasOpen()).toBe(true);
    expect(handlers.onOpenAtlas).toHaveBeenCalled();

    ui.closeAtlas();
    expect(ui.isAtlasOpen()).toBe(false);
    expect(handlers.onCloseAtlas).toHaveBeenCalled();

    ui.toggleAtlas({ x: 0, z: 0 }, Math.PI);
    expect(ui.isAtlasOpen()).toBe(true);
  });

  it('reports isModalOpen true when atlas is open', () => {
    ui.openAtlas({ x: 0, z: 0 }, Math.PI);
    expect(ui.isModalOpen()).toBe(true);

    ui.closeAtlas();
    ui.setHUDVisible(true);
    expect(ui.isAtlasOpen()).toBe(false);
  });

  it('updates minimap safely without throwing', () => {
    expect(() => {
      ui.updateMinimap({ x: 10, z: -15 }, Math.PI * 0.5, createDefaultProgression());
    }).not.toThrow();
  });

  it('contains the new MOBA mobile controls and utility bar buttons', () => {
    const stick = root.querySelector('#touch-stick');
    expect(stick).not.toBeNull();

    const mTown = root.querySelector('#m-town');
    expect(mTown).not.toBeNull();

    const mHeal = root.querySelector('#m-heal');
    expect(mHeal).not.toBeNull();

    const mAttack = root.querySelector('#m-attack');
    expect(mAttack).not.toBeNull();

    const mDodge = root.querySelector('#m-dodge');
    expect(mDodge).not.toBeNull();

    const mCast = root.querySelector('#m-cast');
    expect(mCast).not.toBeNull();

    const mJump = root.querySelector('#m-jump');
    expect(mJump).not.toBeNull();

    const mLock = root.querySelector('#m-lock');
    expect(mLock).not.toBeNull();

    const minimap = root.querySelector('#minimap-container');
    expect(minimap).not.toBeNull();
  });

  it('contains the fullscreen HUD button and title screen controls shortcuts', () => {
    const fsBtn = root.querySelector('#btn-fullscreen');
    expect(fsBtn).not.toBeNull();

    ui.showTitleOverlay();
    const titleFsBtn = root.querySelector('#btn-title-fullscreen');
    expect(titleFsBtn).not.toBeNull();

    const titleControlsBtn = root.querySelector('#btn-title-controls');
    expect(titleControlsBtn).not.toBeNull();
  });

  it('renders the PC & Mobile Controls Guide tab in the Sanctuary modal', () => {
    ui.openSettingsModal(DEFAULT_SETTINGS, undefined, undefined, false, undefined, 'controls');

    const tabControls = root.querySelector('#tab-controls');
    expect(tabControls).not.toBeNull();
    expect(tabControls!.classList.contains('active')).toBe(true);

    const bodyControls = root.querySelector('#tab-body-controls');
    expect(bodyControls).not.toBeNull();
    expect(bodyControls!.classList.contains('hidden')).toBe(false);

    const desktopCol = root.querySelector('.desktop-column');
    expect(desktopCol).not.toBeNull();

    const mobileCol = root.querySelector('.mobile-column');
    expect(mobileCol).not.toBeNull();

    const guideFs = root.querySelector('#guide-opt-fullscreen');
    expect(guideFs).not.toBeNull();
  });
});
