/**
 * Procedural fallback artwork for the standalone slot client.
 *
 * There are no image files in this project: no third-party art, no provider
 * assets, nothing to license. Every symbol, panel and glow below is drawn into
 * a canvas texture on boot.
 */
import Phaser from 'phaser';
import type { SymbolId } from '../../shared/types';

export const PALETTE = {
  void: 0x0a0713,
  deep: 0x140d26,
  panel: 0x1d1338,
  panelEdge: 0x3b2a6b,
  gold: 0xf5c451,
  goldDeep: 0xb8862b,
  goldPale: 0xfff0c2,
  pyrite: 0xd9b44a,
  marble: 0xe8e3f2,
  win: 0x6ef2c0,
  scatter: 0xff7a45,
  orb: 0xc36bff,
  text: 0xf3eefc,
  dim: 0x8f83b5,
};

export const SYMBOL_META: Record<SymbolId, { name: string; tint: number; tier: 'low' | 'mid' | 'high' | 'special' }> = {
  PYRITE:   { name: 'Pyrite',   tint: 0xd9b44a, tier: 'low' },
  QUARTZ:   { name: 'Quartz',   tint: 0x9fd8e8, tier: 'low' },
  AMETHYST: { name: 'Amethyst', tint: 0xb083f0, tier: 'low' },
  EMERALD:  { name: 'Emerald',  tint: 0x5fd79a, tier: 'low' },
  RING:     { name: 'Ring',     tint: 0xf0a55f, tier: 'mid' },
  CHALICE:  { name: 'Chalice',  tint: 0xf5c451, tier: 'mid' },
  HELM:     { name: 'Helm',     tint: 0xc0cbe8, tier: 'high' },
  LYRE:     { name: 'Lyre',     tint: 0xffd98a, tier: 'high' },
  CROWN:    { name: 'Crown',    tint: 0xffe9a8, tier: 'high' },
  IDOL:     { name: 'Idol',     tint: 0xff7a45, tier: 'special' },
  ORB:      { name: 'Orb',      tint: 0xc36bff, tier: 'special' },
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function shade(color: number, amount: number): string {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (color & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

/** Rounded-rect path helper. */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------------------------------------------------------- shapes */

function drawGem(ctx: CanvasRenderingContext2D, s: number, tint: number, facets: number): void {
  const cx = s / 2, cy = s / 2, r = s * 0.345;
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, shade(tint, 70));
  g.addColorStop(0.5, hex(tint));
  g.addColorStop(1, shade(tint, -70));
  ctx.beginPath();
  for (let i = 0; i < facets; i++) {
    const a = (i / facets) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = shade(tint, 110); ctx.lineWidth = s * 0.018; ctx.stroke();
  // inner facet
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.55);
  ctx.lineTo(cx + r * 0.42, cy);
  ctx.lineTo(cx, cy + r * 0.5);
  ctx.lineTo(cx - r * 0.42, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
  // glint
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.42, r * 0.2, r * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
}

function drawRing(ctx: CanvasRenderingContext2D, s: number, tint: number): void {
  const cx = s / 2, cy = s * 0.56, r = s * 0.24;
  ctx.lineWidth = s * 0.085;
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, shade(tint, 80)); g.addColorStop(0.5, hex(tint)); g.addColorStop(1, shade(tint, -60));
  ctx.strokeStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // set stone
  ctx.beginPath();
  ctx.moveTo(cx, cy - r - s * 0.13);
  ctx.lineTo(cx + s * 0.075, cy - r - s * 0.03);
  ctx.lineTo(cx, cy - r + s * 0.04);
  ctx.lineTo(cx - s * 0.075, cy - r - s * 0.03);
  ctx.closePath();
  ctx.fillStyle = shade(0x9fd8e8, 20); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = s * 0.012; ctx.stroke();
}

function drawChalice(ctx: CanvasRenderingContext2D, s: number, tint: number): void {
  const cx = s / 2;
  const g = ctx.createLinearGradient(cx - s * 0.2, 0, cx + s * 0.2, 0);
  g.addColorStop(0, shade(tint, -50)); g.addColorStop(0.45, shade(tint, 80)); g.addColorStop(1, shade(tint, -60));
  ctx.fillStyle = g;
  // bowl
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.2, s * 0.3);
  ctx.quadraticCurveTo(cx, s * 0.62, cx + s * 0.2, s * 0.3);
  ctx.closePath(); ctx.fill();
  // stem + foot
  ctx.fillRect(cx - s * 0.028, s * 0.52, s * 0.056, s * 0.14);
  ctx.beginPath();
  ctx.ellipse(cx, s * 0.69, s * 0.14, s * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  // rim
  ctx.beginPath();
  ctx.ellipse(cx, s * 0.3, s * 0.2, s * 0.045, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(tint, 110); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = s * 0.012; ctx.stroke();
}

function drawHelm(ctx: CanvasRenderingContext2D, s: number, tint: number): void {
  const cx = s / 2;
  const g = ctx.createLinearGradient(cx - s * 0.2, s * 0.25, cx + s * 0.2, s * 0.7);
  g.addColorStop(0, shade(tint, 60)); g.addColorStop(1, shade(tint, -70));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.19, s * 0.68);
  ctx.lineTo(cx - s * 0.19, s * 0.44);
  ctx.quadraticCurveTo(cx, s * 0.2, cx + s * 0.19, s * 0.44);
  ctx.lineTo(cx + s * 0.19, s * 0.68);
  ctx.lineTo(cx + s * 0.08, s * 0.68);
  ctx.lineTo(cx + s * 0.08, s * 0.52);
  ctx.lineTo(cx - s * 0.08, s * 0.52);
  ctx.lineTo(cx - s * 0.08, s * 0.68);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = shade(tint, 100); ctx.lineWidth = s * 0.016; ctx.stroke();
  // crest
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.02, s * 0.24);
  ctx.quadraticCurveTo(cx + s * 0.16, s * 0.1, cx + s * 0.05, s * 0.36);
  ctx.quadraticCurveTo(cx + s * 0.02, s * 0.28, cx - s * 0.02, s * 0.24);
  ctx.closePath();
  ctx.fillStyle = hex(0xe0564f); ctx.fill();
}

function drawLyre(ctx: CanvasRenderingContext2D, s: number, tint: number): void {
  const cx = s / 2;
  ctx.strokeStyle = shade(tint, 40); ctx.lineWidth = s * 0.05; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.17, s * 0.66);
  ctx.quadraticCurveTo(cx - s * 0.26, s * 0.34, cx - s * 0.1, s * 0.26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.17, s * 0.66);
  ctx.quadraticCurveTo(cx + s * 0.26, s * 0.34, cx + s * 0.1, s * 0.26);
  ctx.stroke();
  // base
  ctx.lineWidth = s * 0.055;
  ctx.beginPath(); ctx.moveTo(cx - s * 0.18, s * 0.66); ctx.lineTo(cx + s * 0.18, s * 0.66); ctx.stroke();
  // strings
  ctx.strokeStyle = 'rgba(255,255,255,0.72)'; ctx.lineWidth = s * 0.012;
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * s * 0.052;
    ctx.beginPath(); ctx.moveTo(x, s * 0.3); ctx.lineTo(x, s * 0.64); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawCrown(ctx: CanvasRenderingContext2D, s: number, tint: number): void {
  const cx = s / 2, base = s * 0.66, top = s * 0.3, w = s * 0.22;
  const g = ctx.createLinearGradient(0, top, 0, base);
  g.addColorStop(0, shade(tint, 90)); g.addColorStop(1, shade(tint, -50));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - w, base);
  ctx.lineTo(cx - w, top + s * 0.06);
  ctx.lineTo(cx - w * 0.5, top + s * 0.16);
  ctx.lineTo(cx, top);
  ctx.lineTo(cx + w * 0.5, top + s * 0.16);
  ctx.lineTo(cx + w, top + s * 0.06);
  ctx.lineTo(cx + w, base);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = shade(tint, 120); ctx.lineWidth = s * 0.016; ctx.stroke();
  // band
  ctx.fillStyle = shade(tint, -30);
  ctx.fillRect(cx - w, base - s * 0.07, w * 2, s * 0.07);
  // jewels
  const jewels = [0x5fd79a, 0xe0564f, 0x9fd8e8];
  jewels.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(cx + (i - 1) * s * 0.13, base - s * 0.035, s * 0.024, 0, Math.PI * 2);
    ctx.fillStyle = hex(c); ctx.fill();
  });
}

function drawIdol(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2, cy = s / 2;
  // radiant burst
  const rg = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.44);
  rg.addColorStop(0, 'rgba(255,190,110,0.95)');
  rg.addColorStop(0.55, 'rgba(255,122,69,0.35)');
  rg.addColorStop(1, 'rgba(255,122,69,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.2);
    ctx.lineTo(s * 0.028, -s * 0.38);
    ctx.lineTo(-s * 0.028, -s * 0.38);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,214,140,0.85)'; ctx.fill();
  }
  ctx.restore();
  // mask face
  const g = ctx.createLinearGradient(cx, cy - s * 0.2, cx, cy + s * 0.2);
  g.addColorStop(0, shade(0xffd98a, 40)); g.addColorStop(1, shade(0xb8862b, 0));
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.21);
  ctx.quadraticCurveTo(cx + s * 0.17, cy - s * 0.15, cx + s * 0.13, cy + s * 0.08);
  ctx.quadraticCurveTo(cx + s * 0.07, cy + s * 0.23, cx, cy + s * 0.25);
  ctx.quadraticCurveTo(cx - s * 0.07, cy + s * 0.23, cx - s * 0.13, cy + s * 0.08);
  ctx.quadraticCurveTo(cx - s * 0.17, cy - s * 0.15, cx, cy - s * 0.21);
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,240,194,0.9)'; ctx.lineWidth = s * 0.014; ctx.stroke();
  // eyes + mouth
  ctx.fillStyle = 'rgba(40,20,10,0.85)';
  ctx.beginPath(); ctx.ellipse(cx - s * 0.055, cy - s * 0.03, s * 0.026, s * 0.016, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + s * 0.055, cy - s * 0.03, s * 0.026, s * 0.016, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - s * 0.04, cy + s * 0.09, s * 0.08, s * 0.014);
}

function drawOrb(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2, cy = s / 2;
  const halo = ctx.createRadialGradient(cx, cy, s * 0.06, cx, cy, s * 0.46);
  halo.addColorStop(0, 'rgba(210,150,255,0.9)');
  halo.addColorStop(0.6, 'rgba(160,90,255,0.3)');
  halo.addColorStop(1, 'rgba(160,90,255,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, s, s);

  const g = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.1, s * 0.03, cx, cy, s * 0.26);
  g.addColorStop(0, '#f3dcff');
  g.addColorStop(0.45, '#c36bff');
  g.addColorStop(1, '#5c1f9e');
  ctx.beginPath(); ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = s * 0.016; ctx.stroke();
  // highlight
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.09, cy - s * 0.11, s * 0.06, s * 0.035, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
}

/* ------------------------------------------------------------- generator */

function symbolCanvas(scene: Phaser.Scene, key: string, size: number, draw: (c: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, size, size);
  draw(ctx);
  tex.refresh();
}

/** Build every symbol texture. Called once from BootScene. */
export function generateSymbolTextures(scene: Phaser.Scene, size = 128): void {
  const m = SYMBOL_META;
  symbolCanvas(scene, 'sym-PYRITE', size, (c) => drawGem(c, size, m.PYRITE.tint, 6));
  symbolCanvas(scene, 'sym-QUARTZ', size, (c) => drawGem(c, size, m.QUARTZ.tint, 8));
  symbolCanvas(scene, 'sym-AMETHYST', size, (c) => drawGem(c, size, m.AMETHYST.tint, 10));
  symbolCanvas(scene, 'sym-EMERALD', size, (c) => drawGem(c, size, m.EMERALD.tint, 4));
  symbolCanvas(scene, 'sym-RING', size, (c) => drawRing(c, size, m.RING.tint));
  symbolCanvas(scene, 'sym-CHALICE', size, (c) => drawChalice(c, size, m.CHALICE.tint));
  symbolCanvas(scene, 'sym-HELM', size, (c) => drawHelm(c, size, m.HELM.tint));
  symbolCanvas(scene, 'sym-LYRE', size, (c) => drawLyre(c, size, m.LYRE.tint));
  symbolCanvas(scene, 'sym-CROWN', size, (c) => drawCrown(c, size, m.CROWN.tint));
  symbolCanvas(scene, 'sym-IDOL', size, (c) => drawIdol(c, size));
  symbolCanvas(scene, 'sym-ORB', size, (c) => drawOrb(c, size));

  // cell backing
  symbolCanvas(scene, 'cell', size, (c) => {
    const g = c.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(58,40,104,0.55)');
    g.addColorStop(1, 'rgba(28,18,56,0.55)');
    rr(c, 3, 3, size - 6, size - 6, size * 0.11);
    c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(126,100,196,0.30)'; c.lineWidth = 2; c.stroke();
  });

  // win glow
  symbolCanvas(scene, 'cellWin', size, (c) => {
    const g = c.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.55);
    g.addColorStop(0, 'rgba(110,242,192,0.55)');
    g.addColorStop(1, 'rgba(110,242,192,0)');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
    rr(c, 3, 3, size - 6, size - 6, size * 0.11);
    c.strokeStyle = 'rgba(160,255,220,0.95)'; c.lineWidth = 4; c.stroke();
  });

  // soft particle
  symbolCanvas(scene, 'spark', 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,240,194,1)');
    g.addColorStop(1, 'rgba(255,196,81,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  });
}

/** Ornate background: marble columns, sky, gold vignette. */
export function generateBackground(scene: Phaser.Scene, w: number, h: number): void {
  symbolCanvas(scene, 'bg', Math.max(w, h), () => { /* replaced below */ });
  if (scene.textures.exists('bg')) scene.textures.remove('bg');
  const tex = scene.textures.createCanvas('bg', w, h);
  if (!tex) return;
  const c = tex.getContext();

  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1b1038');
  sky.addColorStop(0.45, '#241546');
  sky.addColorStop(1, '#0a0713');
  c.fillStyle = sky; c.fillRect(0, 0, w, h);

  // sun disc
  const sun = c.createRadialGradient(w * 0.5, h * 0.26, 10, w * 0.5, h * 0.26, h * 0.42);
  sun.addColorStop(0, 'rgba(255,205,120,0.30)');
  sun.addColorStop(0.5, 'rgba(197,120,255,0.10)');
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sun; c.fillRect(0, 0, w, h);

  // columns
  const colW = w * 0.075;
  for (const cx of [w * 0.085, w * 0.915]) {
    const g = c.createLinearGradient(cx - colW / 2, 0, cx + colW / 2, 0);
    g.addColorStop(0, 'rgba(120,108,158,0.30)');
    g.addColorStop(0.35, 'rgba(216,208,238,0.30)');
    g.addColorStop(1, 'rgba(90,80,126,0.30)');
    c.fillStyle = g;
    c.fillRect(cx - colW / 2, h * 0.12, colW, h * 0.78);
    c.fillStyle = 'rgba(224,216,245,0.26)';
    c.fillRect(cx - colW * 0.62, h * 0.09, colW * 1.24, h * 0.035);
    c.fillRect(cx - colW * 0.62, h * 0.88, colW * 1.24, h * 0.04);
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const x = cx - colW / 2 + (colW / 5) * i;
      c.beginPath(); c.moveTo(x, h * 0.13); c.lineTo(x, h * 0.88); c.stroke();
    }
  }

  // vignette
  const vig = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  c.fillStyle = vig; c.fillRect(0, 0, w, h);

  tex.refresh();
}

/** A reusable rounded panel texture. */
export function generatePanel(
  scene: Phaser.Scene, key: string, w: number, h: number,
  fill = 'rgba(24,15,48,0.88)', edge = 'rgba(160,130,240,0.35)', radius = 18,
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const c = tex.getContext();
  rr(c, 2, 2, w - 4, h - 4, radius);
  c.fillStyle = fill; c.fill();
  c.strokeStyle = edge; c.lineWidth = 2; c.stroke();
  tex.refresh();
}

export { hex };
