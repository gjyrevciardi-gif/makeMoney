import type { ComponentManifest, EvaluatorKind, FeatureSelection } from "./types.js";

export interface CompatibilityResult {
  compatible: boolean;
  errors: string[];
  capabilities: string[];
}

export function resolveCompatibility(
  selections: FeatureSelection[],
  evaluator: EvaluatorKind,
  catalog: readonly ComponentManifest[],
  release: boolean,
): CompatibilityResult {
  const errors: string[] = [];
  const selectedIds = new Set(selections.filter((item) => item.enabled).map((item) => item.id));
  const manifests = new Map(catalog.map((item) => [item.id, item]));
  const capabilities = new Set<string>([`evaluator:${evaluator}`]);
  for (const id of selectedIds) {
    const manifest = manifests.get(id);
    if (!manifest) {
      errors.push(`Unknown component: ${id}`);
      continue;
    }
    manifest.provides.forEach((capability) => capabilities.add(capability));
  }
  for (const id of selectedIds) {
    const manifest = manifests.get(id);
    if (!manifest) continue;
    if (release && manifest.status !== "implemented") errors.push(`${id} is ${manifest.status} and cannot be released`);
    if (manifest.evaluators && !manifest.evaluators.includes(evaluator)) {
      errors.push(`${id} does not support evaluator ${evaluator}`);
    }
    for (const conflict of manifest.conflicts ?? []) {
      if (selectedIds.has(conflict) || capabilities.has(conflict)) errors.push(`${id} conflicts with ${conflict}`);
    }
    for (const requirement of manifest.requires ?? []) {
      if (!selectedIds.has(requirement) && !capabilities.has(requirement)) errors.push(`${id} requires ${requirement}`);
    }
  }
  return { compatible: errors.length === 0, errors, capabilities: [...capabilities].sort() };
}
