import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { bookGambleView, bookGambleMarkup, bookGambleStatus } from '../vendor/web-client/src/book-gamble-presentation.ts';
import { bookStyles } from '../vendor/web-client/src/book-presentation.ts';
import { portraitStyles } from '../vendor/web-client/src/book-portrait.ts';

// Source/layout audit plus one executed terminal path. There is no browser in this
// environment, so the geometry below is computed from the shipped declarations
// instead of measured pixels; labels say so.
const source = readFileSync(new URL('../vendor/web-client/src/slot-game.ts', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing source marker: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing source marker: ${to}`);
  return source.slice(start, end);
};

/** Flat leaf rules only: enough to resolve the shipped declarations by selector suffix. */
const leafRules = (styles) => [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim(),
  body,
  declarations: new Map(body.split(';').map((entry) => entry.split(':').map((part) => part.trim())).filter(([name]) => name).map(([name, ...rest]) => [name, rest.join(':')])),
}));
const rulesEndingWith = (styles, suffix) => leafRules(styles).filter((rule) => rule.selector.endsWith(suffix));
const declarationFor = (styles, suffix, property, matches = () => true) => {
  const hits = rulesEndingWith(styles, suffix).filter((rule) => matches(rule.selector) && rule.declarations.has(property));
  return hits.length ? hits[hits.length - 1].declarations.get(property) : undefined;
};

const percentPair = (value) => value.split(/\s+/).map((part) => {
  const match = /^(-?[\d.]+)%$/.exec(part);
  assert.ok(match, `expected a percentage inset, received ${value}`);
  return Number(match[1]) / 100;
});

test('the Gamble surface sits inside the reel presentation area, not over the control band', () => {
  // Desktop classic composition: the panel is inset inside the reel window (.stage).
  const desktopInset = declarationFor(bookStyles, '.bonus.gamble-screen', 'inset', (selector) => !selector.includes('gamble-active') && !selector.includes('reference-state'));
  assert.ok(desktopInset, 'the classic Gamble screen keeps an explicit inset');
  const [top, right, bottom, left] = percentPair(desktopInset);
  for (const [name, value] of [['top', top], ['right', right], ['bottom', bottom], ['left', left]]) {
    assert.ok(value >= 0 && value < 1, `${name} inset keeps the panel inside the reel window`);
  }
  assert.ok(top + bottom < 1 && left + right < 1, 'the panel keeps a visible width and height inside the reel window');

  // The permanent band paints above the reel presentation area, so neither the Gamble
  // surface nor a scaled frame can cover the status strip or the Collect key.
  const bandZIndex = declarationFor(bookStyles, '.console.cabinet', 'z-index', (selector) => selector.includes('[presentation="classic"]'));
  const stageZIndex = /\.stage \{ ?position:relative;[^}]*z-index:(\d+)/.exec(source);
  assert.ok(stageZIndex, 'the reel stage declares its stacking level');
  assert.ok(Number(bandZIndex) > Number(stageZIndex[1]), 'the control band stacks above the reel window');

  // Portrait keeps its existing reflow: the panel is clamped to the stage box.
  assert.match(portraitStyles, /\.bonus\.gamble-screen \{inset:52px 8px 8px;align-items:stretch\}/);
});

test('a live Gamble never re-proportions the cabinet or hides the permanent control band', () => {
  const liveRules = leafRules(bookStyles).filter((rule) => rule.selector.includes('[gamble-active]') && !rule.selector.includes(':not([gamble-active])'));
  assert.ok(liveRules.length, 'the live Gamble state has its own presentation rules');
  const touched = (suffix, property) => liveRules.filter((rule) => rule.selector.endsWith(suffix) && rule.declarations.has(property));

  assert.deepEqual(touched('canvas.reel-canvas', 'aspect-ratio'), [], 'the live Gamble state must keep the reel window proportions');
  assert.deepEqual(touched('.console.cabinet', 'height'), [], 'the live Gamble state must keep the control band height');
  for (const suffix of ['.cab-key', '.cab-meters', '.cab-message', '.win-total', '.meter-adjust']) {
    assert.deepEqual(touched(suffix, 'display'), [], `the live Gamble state must keep ${suffix} visible`);
  }

  // The reviewed desktop proportions (86vh face + 12.5vh controls) stay in force during
  // a live Gamble, so the cabinet never grows past its budget on a wide desktop.
  const desktopFace = rulesEndingWith(bookStyles, 'canvas.reel-canvas').filter((rule) => rule.selector.includes('[base-desktop]') && rule.declarations.has('height'));
  assert.ok(desktopFace.length, 'the reviewed desktop cabinet proportions exist');
  assert.ok(desktopFace.every((rule) => !rule.selector.includes('gamble-active')), 'those proportions must also apply while the Gamble surface is up');
});

test('desktop Gamble geometry keeps status, meters and the Collect key below the panel', () => {
  // Declarations actually in force on the reviewed desktop base capture.
  const faceHeight = declarationFor(bookStyles, 'canvas.reel-canvas', 'height', (selector) => selector.includes('[base-desktop]'));
  const bandHeight = declarationFor(bookStyles, '.console.cabinet', 'height', (selector) => selector.includes('[base-desktop]'));
  const controlTop = declarationFor(bookStyles, '.spin.cab-start', 'top', (selector) => selector.includes('[base-desktop]'));
  const controlHeight = declarationFor(bookStyles, '.spin.cab-start', 'height', (selector) => selector.includes('[base-desktop]'));
  assert.ok(faceHeight?.endsWith('vh') && bandHeight?.endsWith('vh'), 'the desktop cabinet is budgeted in viewport height');
  assert.ok(controlTop?.endsWith('vh') && controlHeight?.endsWith('vh'), 'the desktop control row is budgeted in viewport height');

  const inset = declarationFor(bookStyles, '.bonus.gamble-screen', 'inset', (selector) => !selector.includes('gamble-active') && !selector.includes('reference-state'));
  const [, , panelBottomInset] = percentPair(inset);

  for (const [width, height] of [[1440, 900], [1920, 1080], [1600, 900]]) {
    const cabinet = (Number.parseFloat(faceHeight) / 100) * height;
    const band = (Number.parseFloat(bandHeight) / 100) * height;
    const panelBottom = cabinet * (1 - panelBottomInset);
    const controlBottom = cabinet + (Number.parseFloat(controlTop) / 100) * height + (Number.parseFloat(controlHeight) / 100) * height;

    assert.ok(panelBottom <= cabinet, `${width}x${height}: the panel stays inside the reel window`);
    assert.ok(band <= height * .13, `${width}x${height}: the control band keeps the reviewed height`);
    assert.ok(cabinet + band <= height, `${width}x${height}: face plus control band fit the cabinet budget`);
    assert.ok(controlBottom <= cabinet + band, `${width}x${height}: the Collect key stays inside the control band`);
  }
});

test('the server COLLECT choice drives the permanent key instead of a local rule', () => {
  // Source check (no browser): RED/BLACK stay in the panel row, COLLECT is offered only
  // when the server sends it, and the always-visible key is enabled for it.
  assert.match(source, /if \(classicGamble && !view!\.choices\.includes\(choice\.id as "red" \| "black" \| "collect"\)\) continue;/);
  assert.match(source, /if \(classicGamble && choice\.id === "collect"\) \{ this\.#collectPending = \(\) => void resolveChoice\(choice\.id\); startLabel\.textContent = "Collect"; start\.disabled = false; continue; \}/);
});

/**
 * Executes the real terminal path of #presentGambleResult against a stub shadow DOM.
 * The accepted gamble consumer (bookGambleView/bookGambleMarkup/bookGambleStatus) is
 * the real module, so the view model under test is the shipped one.
 */
const formatMinorUnits = new Function(`${stripTypeScriptTypes(slice('function formatMinorUnits(value: string): string {', 'function clamp('))}; return formatMinorUnits;`)();
const terminalPath = slice('  async #presentGambleResult(result: GameRoundResult): Promise<void> {', '  #reportError(');

const terminalSource = stripTypeScriptTypes(`
class GambleTerminalProbe {
  #autoplay = false;
  #gambleRequestAutoplay = false;
  #collectPending = undefined;
  #choiceBusy = false;
  #winningCells = new Set();
  #displayGrid = [];
  #reducedMotion = false;
  attributes = new Set();
  states = [];
  sounds = [];
  cabinetStatus = [];
  music = [];
  ${terminalPath}
  constructor(overlay, startKey, autoplayKey, output) {
    this.overlay = overlay; this.startKey = startKey; this.autoplayKey = autoplayKey; this.output = output;
    this.shadowRoot = { querySelector: (selector) => selector === '.bonus' ? overlay
      : selector === '.spin' ? startKey
      : selector === '[data-key="autoplay"]' ? autoplayKey
      : selector === '.win-total output' ? output : undefined };
  }
  setAttribute(name) { this.attributes.add(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  #hideWin() {}
  #clearPaylines() {}
  #updateAccessibleGrid() {}
  #setCabinetStatus(text) { this.cabinetStatus.push(text); }
  #playSound(key) { this.sounds.push(key); }
  #setState(value) { this.states.push(value); }
  #playMusic(key) { this.music.push(key); }
  #pause() { return Promise.resolve(); }
  #openBonus() {}
  present(result) { return this.#presentGambleResult(result); }
}
`);

const fakeElement = (classes = []) => {
  const store = new Set(classes);
  const element = {
    classes: store,
    children: [],
    innerHTML: '',
    classList: {
      add: (...names) => names.forEach((name) => store.add(name)),
      remove: (...names) => names.forEach((name) => store.delete(name)),
      contains: (name) => store.has(name),
    },
    replaceChildren: () => { element.children = []; element.innerHTML = ''; },
  };
  return element;
};

const collectedResult = () => ({
  gameId: 'book-of-the-sands',
  complete: true,
  totalWinUnits: '3000',
  finalGrid: [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']],
  events: [{ type: 'choice-resolved', data: { choiceId: 'collect', attempt: 0, winningColour: null, won: null, pendingWinUnits: '3000', settlementUnits: '3000' } }],
  featureState: { bookOfRa: { pendingWin: '3000', gambleAttempts: 0, gambleMaxAttempts: 5, gambleHistory: [] } },
});

test('a collected or terminal Gamble returns the normal control presentation', async () => {
  const overlay = fakeElement(['bonus']);
  const startLabel = { textContent: 'Collect' };
  const startKey = { disabled: true, querySelector: () => startLabel };
  const autoplayKey = { disabled: true };
  const output = { value: '' };
  const GambleTerminalProbe = new Function('document', 'bookGambleView', 'bookGambleMarkup', 'bookGambleStatus', 'formatMinorUnits',
    `${terminalSource}; return GambleTerminalProbe;`)(
    { createElement: () => fakeElement() }, bookGambleView, bookGambleMarkup, bookGambleStatus, formatMinorUnits);

  const probe = new GambleTerminalProbe(overlay, startKey, autoplayKey, output);
  probe.setAttribute('gamble-active');
  overlay.classes.add('gamble-screen');
  overlay.classes.add('active');

  const result = collectedResult();
  await probe.present(result);

  const view = bookGambleView(result, false);
  assert.equal(view.status, 'collected');
  assert.equal(probe.attributes.has('gamble-active'), false, 'the Gamble mode is cleared');
  assert.equal(overlay.classList.contains('active'), false, 'the Gamble surface is closed');
  assert.equal(overlay.classList.contains('gamble-screen'), false, 'the Gamble composition is cleared');
  assert.equal(overlay.innerHTML, '', 'the settled panel is removed');
  assert.equal(startLabel.textContent, 'Start', 'the start key returns to its normal label');
  assert.equal(startKey.disabled, false, 'the start key is usable again');
  assert.equal(autoplayKey.disabled, false, 'autoplay returns');
  assert.ok(probe.states.includes('READY'), 'the cabinet returns to its normal state');
  assert.ok(probe.music.includes('base'), 'base music returns');
  assert.match(probe.cabinetStatus.at(-1), /COLLECTED: 30\.00/);
});
