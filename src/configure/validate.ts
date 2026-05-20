import type { TavernCardsState, EntryManifestLeaf } from '../type/state.js';

export interface ValidateResult {
  errors: string[];
  warnings: string[];
}

export function validateState(
  state: TavernCardsState,
): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifestTypes = new Set(Object.keys(state.entryManifest));

  validateTypeLists(state, manifestTypes, errors);
  validateStrategyThresholds(state, manifestTypes, errors);
  validatePartOrder(state, manifestTypes, errors);

  return { errors, warnings };
}

function validateTypeLists(
  state: TavernCardsState,
  manifestTypes: Set<string>,
  errors: string[],
): void {
  const listedTypes = new Set([
    ...state.typeLists.before_char,
    ...state.typeLists.after_char,
    ...state.typeLists.depth,
  ]);

  if (listedTypes.size === 0) {
    errors.push('state.typeLists 为空，请先运行 init 命令');
    return;
  }

  const missingTypes = Array.from(manifestTypes).filter(t => !listedTypes.has(t));
  if (missingTypes.length > 0) {
    if (missingTypes.includes('unknown')) {
      const unknownCount = Object.keys(state.entryManifest['unknown'] || {}).length;
      errors.push('发现 ' + unknownCount + ' 条未分类条目 (类型: unknown)，请在 entryManifest 中整理条目类型');
      const otherMissing = missingTypes.filter(t => t !== 'unknown');
      if (otherMissing.length > 0) {
        errors.push('typeLists 缺少以下类型: ' + otherMissing.join(', '));
      }
    } else {
      errors.push('typeLists 缺少以下类型: ' + missingTypes.join(', '));
    }
  }
}

function validateStrategyThresholds(
  state: TavernCardsState,
  manifestTypes: Set<string>,
  errors: string[],
): void {
  if (!state.strategyThresholds || Object.keys(state.strategyThresholds).length === 0) {
    errors.push('state.strategyThresholds 为空，请先运行 init 命令');
    return;
  }

  for (const typeName of Array.from(manifestTypes)) {
    if (typeName === 'unknown') continue;

    const threshold = state.strategyThresholds[typeName];

    if (threshold === undefined) {
      errors.push('strategyThresholds 缺少类型 "' + typeName + '" 的阈值配置');
      continue;
    }

    if (threshold === null || typeof threshold === 'string') continue;

    if (typeof threshold === 'object' && !Array.isArray(threshold)) {
      const parts = collectParts(state.entryManifest[typeName] || {});
      const thresholdParts = new Set(Object.keys(threshold));

      const missingParts = Array.from(parts).filter(p => !thresholdParts.has(p));
      if (missingParts.length > 0) {
        errors.push('strategyThresholds[' + typeName + '] 缺少以下 part: ' + missingParts.join(', '));
      }
    }
  }
}

function validatePartOrder(
  state: TavernCardsState,
  manifestTypes: Set<string>,
  errors: string[],
): void {
  for (const typeName of Array.from(manifestTypes)) {
    const entries = state.entryManifest[typeName] || {};
    const parts = collectParts(entries);

    if (parts.size === 0) continue;

    const partOrder = state.partOrder?.[typeName];
    if (!partOrder) {
      errors.push('partOrder 缺少类型 "' + typeName + '" 的 part 排序配置');
      continue;
    }

    const orderedParts = new Set(partOrder);
    const missingParts = Array.from(parts).filter(p => !orderedParts.has(p));
    if (missingParts.length > 0) {
      errors.push('partOrder[' + typeName + '] 缺少以下 part: ' + missingParts.join(', '));
    }
  }
}

function collectParts(entries: Record<string, EntryManifestLeaf>): Set<string> {
  const parts = new Set<string>();
  for (const leaf of Object.values(entries)) {
    if (leaf.part) {
      parts.add(leaf.part);
    }
  }
  return parts;
}
