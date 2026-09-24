export const SPINE_SCHEMA_VERSION = "1.0" as const;

export type SpineRigKind = "body" | "head";
export type SpineAnchorType = "root" | "joint" | "tip";
export interface SpineAnchor { id: string; label: string; x: number; y: number; type: SpineAnchorType; radius: number; weight: number }
export interface SpineBone { id: string; from: string; to: string; parent?: string }
export interface SpineTransform { rotation: number; translateX: number; translateY: number; scale: number }
export interface SpineKeyframe { time: number; anchors: Record<string, SpineTransform> }
export type SpineAnimationPlayback = { mode: "continuous" } | { mode: "random-interval"; minIntervalMs: number; maxIntervalMs: number };
export interface SpineAnimation {
  id: string; name: string; description: string; duration: number; enabled: boolean; intensity: number; speed: number;
  playback: SpineAnimationPlayback; keyframes: SpineKeyframe[];
}
export interface SpineProject {
  schemaVersion: typeof SPINE_SCHEMA_VERSION; sourceSha256: string; sourcePath: string; model: string; imageType: string; description: string;
  kind?: SpineRigKind; anchors: SpineAnchor[]; bones: SpineBone[]; animations: SpineAnimation[]; updatedAt: string;
}
export interface SpineGenerationResult { project: SpineProject; usedFallback: boolean; warning?: string }

export const spineProjectSchema = Object.freeze({
  $id: "https://playtech.github.io/slot-skills/schema/spine-project-v1.json",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "sourceSha256", "sourcePath", "model", "imageType", "description", "anchors", "bones", "animations", "updatedAt"],
  properties: { schemaVersion: { const: SPINE_SCHEMA_VERSION } },
} as const);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, maximum = 400): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be a non-empty printable string of at most ${maximum} characters`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = string(value, label, 64); if (!/^[a-z0-9][a-z0-9-]*$/.test(result)) throw new Error(`${label} must be a lower-case hyphenated id`); return result;
}
function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}`); return value;
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key)); if (extra.length) throw new Error(`${label} contains unsupported fields: ${extra.join(", ")}`);
}

export function validateSpineProject(value: unknown, expectedSourceSha256?: string): SpineProject {
  const source = record(value, "Spine project"); exactKeys(source, ["schemaVersion", "sourceSha256", "sourcePath", "model", "imageType", "description", "kind", "anchors", "bones", "animations", "updatedAt"], "Spine project");
  if (source.schemaVersion !== SPINE_SCHEMA_VERSION) throw new Error(`Spine project schemaVersion must be ${SPINE_SCHEMA_VERSION}`);
  const sourceSha256 = string(source.sourceSha256, "sourceSha256", 64); if (!/^[a-f0-9]{64}$/.test(sourceSha256)) throw new Error("sourceSha256 must be a lower-case SHA-256 digest");
  if (expectedSourceSha256 && sourceSha256 !== expectedSourceSha256) throw new Error("The Spine project belongs to a different character reference");
  const kind = source.kind ?? "body"; if (kind !== "body" && kind !== "head") throw new Error("kind must be body or head");
  if (!Array.isArray(source.anchors) || source.anchors.length < 1 || source.anchors.length > 128) throw new Error("anchors must contain 1-128 entries");
  const anchorIds = new Set<string>(); const parsedAnchors = source.anchors.map((entry, index) => {
    const item = record(entry, `anchors[${index}]`); exactKeys(item, ["id", "label", "x", "y", "type", "radius", "weight"], `anchors[${index}]`); const anchorId = id(item.id, `anchors[${index}].id`);
    if (anchorIds.has(anchorId)) throw new Error(`Duplicate anchor id: ${anchorId}`); anchorIds.add(anchorId);
    if (item.type !== "root" && item.type !== "joint" && item.type !== "tip") throw new Error(`anchors[${index}].type is invalid`); const type: SpineAnchorType = item.type;
    return { id: anchorId, label: string(item.label, `anchors[${index}].label`, 80), x: number(item.x, `anchors[${index}].x`, 0, 1), y: number(item.y, `anchors[${index}].y`, 0, 1), type, radius: item.radius === undefined ? undefined : number(item.radius, `anchors[${index}].radius`, .001, .5), weight: item.weight === undefined ? undefined : number(item.weight, `anchors[${index}].weight`, 0, 1) };
  });
  if (!Array.isArray(source.bones) || source.bones.length > 256) throw new Error("bones must contain 0-256 entries");
  const boneIds = new Set<string>(); const bones = source.bones.map((entry, index): SpineBone => {
    const item = record(entry, `bones[${index}]`); exactKeys(item, ["id", "from", "to", "parent"], `bones[${index}]`); const boneId = id(item.id, `bones[${index}].id`); const from = id(item.from, `bones[${index}].from`); const to = id(item.to, `bones[${index}].to`);
    if (boneIds.has(boneId)) throw new Error(`Duplicate bone id: ${boneId}`); boneIds.add(boneId); if (!anchorIds.has(from) || !anchorIds.has(to) || from === to) throw new Error(`bones[${index}] must connect two different known anchors`);
    const parent = item.parent === undefined ? undefined : id(item.parent, `bones[${index}].parent`); return { id: boneId, from, to, ...(parent ? { parent } : {}) };
  });
  for (const bone of bones) if (bone.parent && (!boneIds.has(bone.parent) || bone.parent === bone.id)) throw new Error(`Bone ${bone.id} has an invalid parent`);
  const anchors = parsedAnchors.map((anchor): SpineAnchor => {
    const connectedLengths = bones.filter((bone) => bone.from === anchor.id || bone.to === anchor.id).flatMap((bone) => {
      const otherId = bone.from === anchor.id ? bone.to : bone.from; const other = parsedAnchors.find((candidate) => candidate.id === otherId);
      return other ? [Math.hypot(anchor.x - other.x, anchor.y - other.y)] : [];
    });
    const inferred = connectedLengths.length ? Math.max(...connectedLengths) * (kind === "head" ? 1.25 : 1.5) : kind === "head" ? .02 : .1;
    const radius = anchor.radius ?? Math.min(kind === "head" ? .05 : .25, Math.max(kind === "head" ? .008 : .04, inferred));
    return { id: anchor.id, label: anchor.label, x: anchor.x, y: anchor.y, type: anchor.type, radius, weight: anchor.weight ?? 1 };
  });
  if (!Array.isArray(source.animations) || source.animations.length < 1 || source.animations.length > 32) throw new Error("animations must contain 1-32 entries");
  const animationIds = new Set<string>(); const animations = source.animations.map((entry, index): SpineAnimation => {
    const item = record(entry, `animations[${index}]`); exactKeys(item, ["id", "name", "description", "duration", "enabled", "intensity", "speed", "playback", "keyframes"], `animations[${index}]`); const animationId = id(item.id, `animations[${index}].id`);
    if (animationIds.has(animationId)) throw new Error(`Duplicate animation id: ${animationId}`); animationIds.add(animationId); const duration = number(item.duration, `animations[${index}].duration`, 0.1, 60);
    if (typeof item.enabled !== "boolean") throw new Error(`animations[${index}].enabled must be boolean`);
    const playbackValue = record(item.playback, `animations[${index}].playback`); let playback: SpineAnimationPlayback;
    if (playbackValue.mode === "continuous") { exactKeys(playbackValue, ["mode"], `animations[${index}].playback`); playback = { mode: "continuous" }; }
    else if (playbackValue.mode === "random-interval") { exactKeys(playbackValue, ["mode", "minIntervalMs", "maxIntervalMs"], `animations[${index}].playback`); const minIntervalMs = number(playbackValue.minIntervalMs, `animations[${index}].playback.minIntervalMs`, 100, 600_000); const maxIntervalMs = number(playbackValue.maxIntervalMs, `animations[${index}].playback.maxIntervalMs`, minIntervalMs, 600_000); playback = { mode: "random-interval", minIntervalMs, maxIntervalMs }; }
    else throw new Error(`animations[${index}].playback.mode is invalid`);
    if (!Array.isArray(item.keyframes) || item.keyframes.length < 2 || item.keyframes.length > 256) throw new Error(`animations[${index}].keyframes must contain 2-256 entries`);
    let previous = -1; const keyframes = item.keyframes.map((frame, frameIndex): SpineKeyframe => {
      const frameValue = record(frame, `animations[${index}].keyframes[${frameIndex}]`); exactKeys(frameValue, ["time", "anchors"], `animations[${index}].keyframes[${frameIndex}]`); const time = number(frameValue.time, `animations[${index}].keyframes[${frameIndex}].time`, 0, duration); if (time < previous) throw new Error(`Animation ${animationId} keyframes must be time ordered`); previous = time;
      const supplied = record(frameValue.anchors, `animations[${index}].keyframes[${frameIndex}].anchors`); const transforms: Record<string, SpineTransform> = {};
      for (const [anchorId, transform] of Object.entries(supplied)) { if (!anchorIds.has(anchorId)) throw new Error(`Animation ${animationId} references unknown anchor ${anchorId}`); const current = record(transform, `${animationId}.${anchorId}`); exactKeys(current, ["rotation", "translateX", "translateY", "scale"], `${animationId}.${anchorId}`); transforms[anchorId] = { rotation: number(current.rotation, `${animationId}.${anchorId}.rotation`, -180, 180), translateX: number(current.translateX, `${animationId}.${anchorId}.translateX`, -1, 1), translateY: number(current.translateY, `${animationId}.${anchorId}.translateY`, -1, 1), scale: number(current.scale, `${animationId}.${anchorId}.scale`, 0.01, 10) }; }
      return { time, anchors: transforms };
    });
    if (keyframes[0]!.time !== 0 || keyframes.at(-1)!.time !== duration) throw new Error(`Animation ${animationId} must start at 0 and end at its duration`);
    return { id: animationId, name: string(item.name, `animations[${index}].name`, 80), description: string(item.description, `animations[${index}].description`, 240), duration, enabled: item.enabled, intensity: number(item.intensity, `animations[${index}].intensity`, 0, 5), speed: number(item.speed, `animations[${index}].speed`, 0.1, 3), playback, keyframes };
  });
  return { schemaVersion: SPINE_SCHEMA_VERSION, sourceSha256, sourcePath: string(source.sourcePath, "sourcePath", 240), model: string(source.model, "model", 100), imageType: string(source.imageType, "imageType", 80), description: string(source.description, "description"), kind, anchors, bones, animations, updatedAt: string(source.updatedAt, "updatedAt", 64) };
}
