import type { GameConfig } from "@slot-skills/schema";
import type { SpineAnchor, SpineAnimation, SpineProject, SpineTransform } from "./index.js";
import { validateSpineProject } from "./index.js";

interface Vertex { x: number; y: number; ox: number; oy: number; u: number; v: number; weights: Array<Record<string, number>> }
export type SpineTransforms = Record<string, SpineTransform>;
export interface SpineViewport { x: number; y: number; width: number; height: number }

function neutral(): SpineTransform { return { rotation: 0, translateX: 0, translateY: 0, scale: 1 }; }
function smoothstep(value: number): number { return value * value * (3 - 2 * value); }

export function sampleSpineAnimation(animation: SpineAnimation, timeSeconds: number): SpineTransforms {
  const frames = animation.keyframes; if (!frames.length) return {}; const duration = Math.max(0.001, animation.duration); const time = Math.min(duration, Math.max(0, timeSeconds));
  let left = frames[0]!; let right = frames.at(-1)!;
  for (let index = 0; index < frames.length - 1; index += 1) if (time >= frames[index]!.time && time <= frames[index + 1]!.time) { left = frames[index]!; right = frames[index + 1]!; break; }
  const range = right.time - left.time; const amount = smoothstep(range > 0 ? (time - left.time) / range : 0); const output: SpineTransforms = {};
  for (const anchorId of new Set([...Object.keys(left.anchors), ...Object.keys(right.anchors)])) { const a = left.anchors[anchorId] ?? neutral(); const b = right.anchors[anchorId] ?? neutral(); output[anchorId] = { rotation: a.rotation + (b.rotation - a.rotation) * amount, translateX: a.translateX + (b.translateX - a.translateX) * amount, translateY: a.translateY + (b.translateY - a.translateY) * amount, scale: a.scale + (b.scale - a.scale) * amount }; }
  return output;
}

export function combineSpineTransforms(samples: Array<{ transforms: SpineTransforms; intensity: number }>): SpineTransforms {
  const output: SpineTransforms = {};
  for (const sample of samples) for (const [anchorId, transform] of Object.entries(sample.transforms)) { const target = output[anchorId] ??= neutral(); target.rotation += transform.rotation * sample.intensity; target.translateX += transform.translateX * sample.intensity; target.translateY += transform.translateY * sample.intensity; target.scale *= 1 + (transform.scale - 1) * sample.intensity; }
  return output;
}

export class SpinePlaybackScheduler {
  readonly states = new Map<string, { startedAt: number | undefined; nextAt: number }>();
  constructor(public project: SpineProject, readonly random: () => number = Math.random) { this.reset(); }
  reset(now = performance.now()): void { this.states.clear(); for (const animation of this.project.animations) this.states.set(animation.id, { startedAt: undefined, nextAt: now + this.interval(animation) }); }
  setProject(project: SpineProject): void { this.project = project; this.reset(); }
  interval(animation: SpineAnimation): number { if (animation.playback.mode === "continuous") return 0; return animation.playback.minIntervalMs + this.random() * Math.max(0, animation.playback.maxIntervalMs - animation.playback.minIntervalMs); }
  sample(now: number): SpineTransforms {
    const samples: Array<{ transforms: SpineTransforms; intensity: number }> = [];
    for (const animation of this.project.animations) {
      if (!animation.enabled) continue; const state = this.states.get(animation.id) ?? { startedAt: undefined, nextAt: now + this.interval(animation) }; this.states.set(animation.id, state); const speed = Math.max(0.1, animation.speed);
      if (animation.playback.mode === "continuous") { samples.push({ transforms: sampleSpineAnimation(animation, ((now / 1000) * speed) % Math.max(0.001, animation.duration)), intensity: animation.intensity }); continue; }
      if (state.startedAt === undefined && now >= state.nextAt) state.startedAt = now; if (state.startedAt === undefined) continue; const time = ((now - state.startedAt) / 1000) * speed;
      if (time >= animation.duration) { state.startedAt = undefined; state.nextAt = now + this.interval(animation); continue; }
      samples.push({ transforms: sampleSpineAnimation(animation, time), intensity: animation.intensity });
    }
    return combineSpineTransforms(samples);
  }
}

function expand(x: number, y: number, centerX: number, centerY: number): { x: number; y: number } { const dx = x - centerX; const dy = y - centerY; const distance = Math.hypot(dx, dy); return distance > 0.001 ? { x: x + dx / distance * 0.75, y: y + dy / distance * 0.75 } : { x, y }; }

export function calculateSpineAnchorWeights(project: SpineProject, u: number, v: number, imageAspect = 1): Record<string, number> {
  const weights: Record<string, number> = {}; let total = 0;
  for (const anchor of project.anchors) {
    const distance = Math.hypot(u - anchor.x, (v - anchor.y) * imageAspect); if (distance >= anchor.radius || anchor.weight <= 0) continue;
    const ratio = distance / anchor.radius; const influence = (1 - ratio) ** 4 * (1 + 4 * ratio) * anchor.weight; if (influence <= 0) continue; weights[anchor.id] = influence; total += influence;
  }
  if (total > 1) for (const id of Object.keys(weights)) weights[id] = weights[id]! / total;
  return weights;
}

export function constrainSpineTransform(anchor: SpineAnchor, transform: SpineTransform): SpineTransform {
  const distance = Math.hypot(transform.translateX, transform.translateY); const maximum = anchor.radius * .75; const ratio = distance > maximum && distance > 0 ? maximum / distance : 1;
  return { rotation: Math.min(45, Math.max(-45, transform.rotation)), translateX: transform.translateX * ratio, translateY: transform.translateY * ratio, scale: Math.min(2, Math.max(.25, transform.scale)) };
}

function coordinateLines(start: number, length: number, segments: number, additions: number[]): number[] {
  const end = start + length; const values = Array.from({ length: segments + 1 }, (_, index) => start + index / segments * length);
  for (const value of additions) if (value > start && value < end) values.push(value);
  return [...new Map(values.sort((left, right) => left - right).map((value) => [value.toFixed(7), value])).values()];
}

export function spineMeshCoordinates(projects: SpineProject[], viewport: SpineViewport, columns: number, rows: number, imageAspect = 1): { u: number[]; v: number[] } {
  const horizontal: number[] = []; const vertical: number[] = [];
  for (const project of projects) {
    if (project.kind !== "head") continue;
    const animated = new Set(project.animations.flatMap((animation) => animation.keyframes.flatMap((frame) => Object.keys(frame.anchors))));
    for (const anchor of project.anchors) {
      if (!animated.has(anchor.id) || anchor.weight <= 0) continue; horizontal.push(anchor.x - anchor.radius, anchor.x - anchor.radius * .5, anchor.x, anchor.x + anchor.radius * .5, anchor.x + anchor.radius); const verticalRadius = anchor.radius / imageAspect; vertical.push(anchor.y - verticalRadius, anchor.y - verticalRadius * .5, anchor.y, anchor.y + verticalRadius * .5, anchor.y + verticalRadius);
    }
  }
  return { u: coordinateLines(viewport.x, viewport.width, columns, horizontal), v: coordinateLines(viewport.y, viewport.height, rows, vertical) };
}

export class SpineRigRenderer {
  readonly context: CanvasRenderingContext2D; readonly baseColumns: number; readonly baseRows: number; readonly viewport: SpineViewport; columns: number; rows: number; projects: SpineProject[]; vertices: Vertex[] = []; triangles: number[] = [];
  constructor(readonly canvas: HTMLCanvasElement, readonly image: CanvasImageSource & { width: number; height: number }, project: SpineProject | SpineProject[], columns?: number, rows?: number, viewport: SpineViewport = { x: 0, y: 0, width: 1, height: 1 }) {
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas rendering is unavailable"); this.context = context; this.projects = Array.isArray(project) ? project : [project]; const detailed = this.projects.some((candidate) => candidate.kind === "head"); this.baseColumns = columns ?? (detailed ? 20 : 10); this.baseRows = rows ?? (detailed ? 30 : 15); this.columns = this.baseColumns; this.rows = this.baseRows; this.viewport = viewport; this.rebuild();
  }
  get project(): SpineProject { return this.projects[0]!; }
  setProject(project: SpineProject): void { this.projects = [project]; this.rebuild(); }
  setProjects(projects: SpineProject[]): void { this.projects = projects; this.rebuild(); }
  screen(x: number, y: number): { x: number; y: number } { return { x: (x - this.viewport.x) / this.viewport.width * this.canvas.width, y: (y - this.viewport.y) / this.viewport.height * this.canvas.height }; }
  imageAspect(): number { const source = this.image as CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }; const width = source.naturalWidth || source.width; const height = source.naturalHeight || source.height; return width > 0 ? height / width : 1; }
  rebuild(): void {
    this.vertices = []; this.triangles = []; const imageAspect = this.imageAspect(); const coordinates = spineMeshCoordinates(this.projects, this.viewport, this.baseColumns, this.baseRows, imageAspect); this.columns = coordinates.u.length - 1; this.rows = coordinates.v.length - 1;
    for (let row = 0; row <= this.rows; row += 1) for (let column = 0; column <= this.columns; column += 1) {
      const u = coordinates.u[column]!; const v = coordinates.v[row]!; const layerWeights = this.projects.map((project) => calculateSpineAnchorWeights(project, u, v, imageAspect)); this.vertices.push({ x: u, y: v, ox: u, oy: v, u, v, weights: layerWeights });
    }
    for (let row = 0; row < this.rows; row += 1) for (let column = 0; column < this.columns; column += 1) { const a = row * (this.columns + 1) + column; const b = a + 1; const c = (row + 1) * (this.columns + 1) + column; const d = c + 1; this.triangles.push(a, b, c, b, d, c); }
  }
  deform(input: SpineTransforms | SpineTransforms[]): void {
    const transforms = Array.isArray(input) ? input : [input]; for (const vertex of this.vertices) { let offsetX = 0; let offsetY = 0; for (let projectIndex = 0; projectIndex < this.projects.length; projectIndex += 1) for (const anchor of this.projects[projectIndex]!.anchors) { const weight = vertex.weights[projectIndex]?.[anchor.id] ?? 0; if (weight < .0001) continue; const transform = constrainSpineTransform(anchor, transforms[projectIndex]?.[anchor.id] ?? neutral()); const radians = transform.rotation * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians); const x = vertex.ox - anchor.x; const y = vertex.oy - anchor.y; offsetX += (anchor.x + (x * cosine - y * sine) * transform.scale + transform.translateX - vertex.ox) * weight; offsetY += (anchor.y + (x * sine + y * cosine) * transform.scale + transform.translateY - vertex.oy) * weight; } vertex.x = vertex.ox + offsetX; vertex.y = vertex.oy + offsetY; }
  }
  render(input: SpineTransforms | SpineTransforms[] = {}, showRig = false): void {
    const transforms = Array.isArray(input) ? input : [input]; this.deform(transforms); const context = this.context; const width = this.canvas.width; const height = this.canvas.height; const sourceWidth = this.image.width; const sourceHeight = this.image.height; context.clearRect(0, 0, width, height);
    for (let index = 0; index < this.triangles.length; index += 3) {
      const a = this.vertices[this.triangles[index]!]!; const b = this.vertices[this.triangles[index + 1]!]!; const c = this.vertices[this.triangles[index + 2]!]!; const ap = this.screen(a.x, a.y); const bp = this.screen(b.x, b.y); const cp = this.screen(c.x, c.y); const ax = ap.x; const ay = ap.y; const bx = bp.x; const by = bp.y; const cx = cp.x; const cy = cp.y; const au = a.u * sourceWidth; const av = a.v * sourceHeight; const bu = b.u * sourceWidth; const bv = b.v * sourceHeight; const cu = c.u * sourceWidth; const cv = c.v * sourceHeight;
      const determinant = (bu - au) * (cv - av) - (cu - au) * (bv - av); if (Math.abs(determinant) < .001) continue; const m11 = ((bx - ax) * (cv - av) - (cx - ax) * (bv - av)) / determinant; const m21 = ((cx - ax) * (bu - au) - (bx - ax) * (cu - au)) / determinant; const m12 = ((by - ay) * (cv - av) - (cy - ay) * (bv - av)) / determinant; const m22 = ((cy - ay) * (bu - au) - (by - ay) * (cu - au)) / determinant; const dx = ax - m11 * au - m21 * av; const dy = ay - m12 * au - m22 * av; const centerX = (ax + bx + cx) / 3; const centerY = (ay + by + cy) / 3; const ea = expand(ax, ay, centerX, centerY); const eb = expand(bx, by, centerX, centerY); const ec = expand(cx, cy, centerX, centerY);
      context.save(); context.beginPath(); context.moveTo(ea.x, ea.y); context.lineTo(eb.x, eb.y); context.lineTo(ec.x, ec.y); context.closePath(); context.clip(); context.setTransform(m11, m12, m21, m22, dx, dy); context.drawImage(this.image, 0, 0); context.restore();
    }
    if (showRig) this.drawRig(transforms);
  }
  drawRig(transforms: SpineTransforms[]): void {
    const context = this.context; context.save(); context.lineWidth = Math.max(1.5, this.canvas.width / 300);
    for (let projectIndex = 0; projectIndex < this.projects.length; projectIndex += 1) { const project = this.projects[projectIndex]!; const currentTransforms = transforms[projectIndex] ?? {}; const point = (anchor: SpineAnchor) => this.screen(anchor.x + (currentTransforms[anchor.id]?.translateX ?? 0), anchor.y + (currentTransforms[anchor.id]?.translateY ?? 0)); context.strokeStyle = project.kind === "head" ? "#ffb45b" : "#f6c75e";
      for (const bone of project.bones) { const from = project.anchors.find((anchor) => anchor.id === bone.from); const to = project.anchors.find((anchor) => anchor.id === bone.to); if (!from || !to) continue; const a = point(from); const b = point(to); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
      for (const anchor of project.anchors) { const current = point(anchor); context.fillStyle = anchor.type === "root" ? "#72e0b6" : anchor.type === "tip" ? "#ff9b62" : "#718cff"; context.beginPath(); context.arc(current.x, current.y, anchor.type === "root" ? 6 : 5, 0, Math.PI * 2); context.fill(); }
    } context.restore();
  }
  drawInfluence(anchor: SpineAnchor): void {
    const center = this.screen(anchor.x, anchor.y); const aspect = this.imageAspect(); const radiusX = anchor.radius / this.viewport.width * this.canvas.width; const radiusY = anchor.radius / aspect / this.viewport.height * this.canvas.height; const context = this.context; context.save(); context.fillStyle = `rgba(113,140,255,${(.06 + anchor.weight * .12).toFixed(3)})`; context.strokeStyle = `rgba(113,140,255,${(.45 + anchor.weight * .5).toFixed(3)})`; context.lineWidth = Math.max(1.5, this.canvas.width / 360); context.setLineDash([7, 5]); context.beginPath(); context.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2); context.fill(); context.stroke(); context.restore();
  }
}

export interface SpineCharacterHost { shadowRoot: ShadowRoot | null; assetBaseUrl: string; isConnected: boolean }

/** Replace idle character pixels with Spine mesh playback while retaining normal reaction-pose images. */
export async function installCharacterSpine(host: SpineCharacterHost, game: GameConfig): Promise<void> {
  if (host.shadowRoot?.querySelector("canvas.spine-runtime-character")) return;
  const bodyAsset = game.assets.find((asset) => asset.role === "character-spine" || asset.role === "character-spine-body"); const headAsset = game.assets.find((asset) => asset.role === "character-spine-head"); const rigAssets = [bodyAsset, headAsset].filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)); const idleAsset = game.assets.find((asset) => asset.role === "character" && (asset.id === "character-idle" || !asset.id.includes("win") && !asset.id.includes("bonus"))); const character = host.shadowRoot?.querySelector<HTMLImageElement>("img.character"); if (!rigAssets.length || !idleAsset || !character || !host.shadowRoot) return;
  const projects = (await Promise.all(rigAssets.map(async (asset) => { const response = await fetch(new URL(asset.path, host.assetBaseUrl)); return response.ok ? validateSpineProject(await response.json()) : undefined; }))).filter((project): project is SpineProject => Boolean(project)); if (!projects.length || !character.isConnected) return; const image = new Image(); image.decoding = "async"; image.src = new URL(idleAsset.path, host.assetBaseUrl).href; await image.decode(); if (!image.naturalWidth || !character.isConnected) return;
  const canvas = document.createElement("canvas"); canvas.className = "character spine-runtime-character"; canvas.dataset.pose = "idle"; canvas.dataset.rigCount = String(projects.length); canvas.dataset.rigs = projects.map((project) => project.kind ?? "body").join(","); canvas.setAttribute("aria-hidden", "true"); canvas.width = 512; canvas.height = Math.max(512, Math.round(512 * image.naturalHeight / image.naturalWidth)); canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
  const style = document.createElement("style"); style.dataset.spineRuntime = ""; style.textContent = `.spine-runtime-character{width:auto!important;aspect-ratio:${canvas.width}/${canvas.height}!important;visibility:hidden}.spine-runtime-character[data-active="true"]{visibility:visible}`; host.shadowRoot.append(style); character.after(canvas);
  const renderer = new SpineRigRenderer(canvas, image, projects); const schedulers = projects.map((project) => new SpinePlaybackScheduler(project)); const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sync = () => { const idle = (character.dataset.pose ?? "idle") === "idle"; canvas.dataset.active = String(idle); character.style.visibility = idle ? "hidden" : "visible"; }; const observer = new MutationObserver(sync); observer.observe(character, { attributes: true, attributeFilter: ["data-pose", "src"] }); sync();
  const draw = (now: number) => { if (!canvas.isConnected || !host.isConnected) { observer.disconnect(); character.style.visibility = ""; return; } renderer.render(reducedMotion ? projects.map(() => ({})) : schedulers.map((scheduler) => scheduler.sample(now))); requestAnimationFrame(draw); }; renderer.render(projects.map(() => ({}))); requestAnimationFrame(draw);
}
