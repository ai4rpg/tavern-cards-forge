import type { EntryManifestLeaf, TavernCardsState, StrategyThresholdValue, PartThresholdValue } from '../type/state.js';

export function deriveStrategy(
  entryName: string,
  leaf: EntryManifestLeaf,
  typeName: string,
  entries: Record<string, EntryManifestLeaf>,
  state: TavernCardsState,
  force?: boolean,
): Partial<EntryManifestLeaf> {
  if (leaf.enabled === false) return {};
  if (!force && leaf.strategy) return {};

  const thresholdConfig = resolveThreshold(typeName, state);

  if (thresholdConfig === undefined || thresholdConfig === null) {
    return { enabled: false };
  }

  if (thresholdConfig === 'Infinity') {
    return {
      enabled: true,
      strategy: { type: 'constant' },
    };
  }

  const isNested = typeof thresholdConfig === 'object' && thresholdConfig !== null && !Array.isArray(thresholdConfig);

  if (isNested) {
    const partMap = thresholdConfig as Record<string, PartThresholdValue>;
    const partConfig = leaf.part ? partMap[leaf.part] : undefined;
    if (!partConfig) return {};

    if (partConfig.threshold === 'Infinity') {
      return { enabled: true, strategy: { type: 'constant' } };
    }

    const count = resolveNestedCount(entries, partMap, typeName);

    return deriveFromThreshold(partConfig.threshold, count, leaf);
  }

  const simpleThreshold = normalizeThreshold(thresholdConfig);
  if (simpleThreshold === null) {
    return { enabled: false };
  }

  const allEntries = Object.values(entries).filter(e => e.scope !== 'catalog');
  const count = countForThreshold(allEntries, null);

  return deriveFromThreshold(simpleThreshold, count, leaf);
}

function resolveThreshold(
  type: string,
  state: TavernCardsState,
): StrategyThresholdValue | undefined {
  if (state.strategyThresholds && type in state.strategyThresholds) {
    return state.strategyThresholds[type];
  }
  return undefined;
}

function resolveNestedCount(
  entries: Record<string, EntryManifestLeaf>,
  partMap: Record<string, PartThresholdValue>,
  typeName: string,
): number {
  const requiredParts = Object.entries(partMap).filter(([, v]) => v.required);

  if (requiredParts.length === 0) {
    // No required parts: count all non-catalog entries in the type
    const allEntries = Object.values(entries).filter(e => e.scope !== 'catalog');
    return countForThreshold(allEntries, null);
  }

  const counts = requiredParts.map(([partName, partConfig]) => {
    const partEntries = Object.values(entries).filter(e => e.part === partName && e.scope !== 'catalog');
    return countForThreshold(partEntries, partConfig);
  });

  const first = counts[0];
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] !== first) {
      throw new Error(
        `类型 "${typeName}" 的 required part 条目数不一致: ${requiredParts.map(([p], i) => `${p}=${counts[i]}`).join(', ')}`,
      );
    }
  }

  return first;
}

function normalizeThreshold(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value === 'Infinity') return Infinity;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isEjsEntry(leaf: EntryManifestLeaf): boolean {
  if (!leaf.contents || leaf.contents.length === 0) return false;
  const first = leaf.contents[0];
  return !!(first.content && first.content.startsWith('@@if '));
}

function countForThreshold(
  entries: EntryManifestLeaf[],
  partConfig: PartThresholdValue | null,
): number {
  const nonRephrase = entries.filter(e => !e.rephrase);

  const nonEjsCount = nonRephrase.filter(e => !isEjsEntry(e)).length;
  const hasEjs = nonRephrase.some(e => isEjsEntry(e));
  const ejsCount = hasEjs ? 1 : 0;

  if (partConfig?.required) {
    return nonEjsCount;
  }

  return nonEjsCount + ejsCount;
}

function deriveFromThreshold(
  threshold: number | null,
  count: number,
  leaf: EntryManifestLeaf,
): Partial<EntryManifestLeaf> {
  if (leaf.scope === 'catalog') {
    return {
      enabled: true,
      strategy: { type: 'constant' },
    };
  }

  if (threshold === null) {
    return { enabled: false };
  }

  if (threshold === Infinity || threshold === -1) {
    return {
      enabled: true,
      strategy: { type: 'constant' },
    };
  }

  // Conditional threshold: warn if scope is not set
  if (leaf.scope === undefined && !leaf.rephrase) {
    console.warn(`Entry "${leaf.abstract || ''}" has conditional threshold (${threshold}) but no scope set`);
  }

  if (count >= threshold) {
    if (leaf.keywords.length === 0) {
      throw new Error('Selective entry has no keywords');
    }
    return {
      enabled: true,
      strategy: { type: 'selective', keys: leaf.keywords },
    };
  }

  return {
    enabled: true,
    strategy: { type: 'constant' },
  };
}
