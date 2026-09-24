import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { portraitLayout as layout, portraitStyles } from '../vendor/web-client/src/book-portrait.ts';
import { bookStyles, bookRailChipCentre, drawBookCabinet } from '../vendor/web-client/src/book-presentation.ts';

const source = readFileSync(new URL('../vendor/web-client/src/slot-game.ts', import.meta.url), 'utf8');
const player = readFileSync(new URL('../../player/index.html', import.meta.url), 'utf8');
// Execute the actual canvas geometry methods at CSS and backing-store sizes.
// This is a source/layout audit, not a browser or pixel comparison.
const geometryMethods = source.slice(source.indexOf('  #reelArea('), source.indexOf('  #drawReel('));
const Geometry = new Function(`${stripTypeScriptTypes(`class Geometry {
  classicPresentation = true; #immersive = false; shadowRoot = null;
  hasAttribute() { return false; } getAttribute() { return '01-base'; }
  #gridShape() { return [3,3,3,3,3]; }
  ${geometryMethods}
  measure(width, height) {
    const canvas = {width, height};
    return {area:this.#reelArea(width,height), cells:Array.from({length:5},(_,reel)=>Array.from({length:3},(_,row)=>this.#cellBox(reel,row,canvas)))};
  }
}`)}; return Geometry;`)();
const geometry = new Geometry();
const inside = (box, width, height) => {
  assert.ok(box.x >= 0 && box.y >= 0);
  assert.ok(box.width > 0 && box.height > 0);
  assert.ok(box.x + box.width <= width + 0.001);
  assert.ok(box.y + box.height <= height + 0.001);
};

for (const [width, height] of [[430, 932], [390, 844]]) {
  test(`${width}x${height}: real 5x3 canvas geometry and ten rail markers fit at DPR 1/2/3`, () => {
    const canvasHeight = width * layout.canvasHeightRatio;
    for (const dpr of [1, 2, 3]) {
      const bounds = geometry.measure(width * dpr, canvasHeight * dpr);
      inside(bounds.area, width * dpr, canvasHeight * dpr);
      assert.equal(bounds.cells.length, 5);
      for (const column of bounds.cells) {
        assert.equal(column.length, 3);
        for (const cell of column) {
          inside(cell, width * dpr, canvasHeight * dpr);
          assert.ok(cell.width / dpr >= 54, 'symbols retain useful CSS-pixel width');
          assert.ok(cell.height / dpr >= 79, 'rows retain useful CSS-pixel height');
        }
      }
    }
    for (const side of ['left', 'right']) for (let index = 0; index < 10; index++) {
      const centre = bookRailChipCentre(index, 10, side);
      const x = centre.x * width / 1255;
      const y = centre.y * canvasHeight / 630;
      assert.ok(x > 0 && x < width && y > 0 && y < canvasHeight);
    }
  });

  test(`${width}x${height}: normal-flow meter/control tracks fit without overlap`, () => {
    const innerWidth = width - layout.padding * 2;
    const keyWidth = (innerWidth - layout.gap) / 2;
    const meterWidth = (innerWidth - 3 * layout.gap) / 4;
    assert.ok(keyWidth >= 180); assert.ok(meterWidth >= 80);
    assert.ok(layout.controlHeight >= 44);
    assert.equal(2 * keyWidth + layout.gap + layout.padding * 2, width);
    assert.equal(4 * meterWidth + layout.gap * 3 + layout.padding * 2, width);
    // Status, meters and the three control rows stack; none use reel-relative y offsets.
    assert.match(portraitStyles, /\.console\.cabinet \{display:grid;gap:8px;height:auto/);
    assert.match(portraitStyles, /\.cab-deck \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(portraitStyles, /\.spin\.cab-start \{grid-column:1\/-1\}/);
    assert.match(portraitStyles, /position:static;inset:auto;top:auto!important;width:100%;min-width:0;height:auto!important;min-height:48px/);
  });

  test(`${width}x${height}: dialog and option tracks fit including padding/borders`, () => {
    const outer = width - 2 * layout.dialogMargin;
    const inner = outer - 2 * (layout.dialogPadding + layout.dialogBorder);
    const option = (inner - layout.gap) / 2;
    assert.ok(option >= 160);
    assert.equal(2 * option + layout.gap + 2 * (layout.dialogPadding + layout.dialogBorder + layout.dialogMargin), width);
    assert.match(portraitStyles, /box-sizing:border-box;inset:0;margin:auto;width:calc\(100% - 24px\)/);
    assert.match(portraitStyles, /max-height:calc\(100dvh - 32px\)/);
    assert.match(portraitStyles, /\.autoplay-options \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(portraitStyles, /dialog table \{table-layout:fixed;width:100%/);
    assert.match(portraitStyles, /\.autoplay-dialog \.autoplay-close \{min-width:44px;min-height:44px\}/);
  });
}

test('Free Games intro/HUD and Gamble fields have portrait visibility and reflow rules', () => {
  for (const selector of ['.free-hud.active {display:flex}', '.free-intro.active {display:flex}']) assert.ok(portraitStyles.includes(selector));
  assert.match(portraitStyles, /\.free-hud \{position:relative;.*flex-wrap:wrap/);
  assert.match(portraitStyles, /\.free-intro \{position:absolute;.*inset:52px 12px 12px/);
  assert.match(portraitStyles, /\.gamble-screen \.bonus-panel \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(portraitStyles, /\.gamble-screen \.bonus-choice \{width:100%;min-width:0;height:auto;min-height:48px/);
  assert.match(portraitStyles, /\.gamble-history>div \{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
});

test('portrait CSS cannot apply at 1440x900; accepted desktop canvas/deck geometry remains', () => {
  assert.equal(layout.breakpoint, 600);
  assert.ok(portraitStyles.trim().startsWith('@media(max-width:600px) {'));
  let depth = 0;
  for (const char of portraitStyles.slice(portraitStyles.indexOf('{'))) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.match(bookStyles, /aspect-ratio:1\/\.502/);
  assert.match(bookStyles, /height:10\.44cqw/);
  assert.match(bookStyles, /left:78\.3%;top:2\.39cqw;width:8\.6%/);
  assert.ok(source.includes('${stylesheet}${bookStyles}${autoplayStyles}${portraitStyles}'));
});

test('title portrait branch preserves image proportions; desktop draw rectangle is unchanged', () => {
  const images = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, name) => name === 'drawImage' ? (...args) => images.push(args)
    : name === 'createLinearGradient' ? () => gradient : () => {}, set: () => true });
  const image = {};
  drawBookCabinet(context, 1255, 630, true, '01-base', image, 10);
  assert.deepEqual(images.pop().slice(5), [364, 2, 385, 76]);
  for (const width of [390, 430]) {
    const height = width * layout.canvasHeightRatio;
    drawBookCabinet(context, width, height, true, '01-base', image, 10, true);
    const [, , , , , x, y, w, h] = images.pop();
    assert.ok(x > 0 && x + w < 1112 && y >= 0 && y + h <= 90);
    const cssWidth = w * width / 1255 * 1127 / 1112;
    const cssHeight = h * height / 630;
    assert.ok(Math.abs(cssWidth / cssHeight - 2144 / 423) < 0.0001);
  }
});

test('preview permits vertical scrolling and clears stale desktop sizing on portrait rotation', () => {
  assert.match(player, /@media\(max-width:600px\).*max-height:none!important;overflow:visible/);
  assert.match(player, /if \(matchMedia\('\(max-width:600px\)'\).matches\) \{\s*document.documentElement.style.removeProperty\('--preview-width'\);\s*document.documentElement.style.removeProperty\('--preview-height'\)/);
  assert.match(source, /if \(!this\.#fitViewport \|\| this.classicPresentation\) \{ reset\(\)/);
});
