import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';

interface OrderEntry {
  name: string;
  leaf: EntryManifestLeaf;
  typeName: string;
  positionZone: 'before_char' | 'after_char' | 'depth';
  hasPart: boolean;
}

export function allocateOrder(
  state: TavernCardsState,
): Map<string, number> {
  const typeLists = state.typeLists;
  const orderMap = new Map<string, number>();
  const allEntries = collectOrderedEntries(state, typeLists);

  let currentOrder = 10;
  let prevTypeName: string | null = null;
  let prevRephrase: boolean | null = null;
  const rephraseEntries: OrderEntry[] = [];
  let accTokens = new Set<string>();
  let prevPart: string | null = null;

  for (const entry of allEntries) {
    const { name, leaf, typeName, hasPart } = entry;

    if (leaf.rephrase) {
      rephraseEntries.push(entry);
      continue;
    }

    // Cross typeName boundary → new tens block, reset accumulation
    if (prevTypeName !== null && typeName !== prevTypeName) {
      currentOrder = nextTens(currentOrder);
      accTokens = new Set<string>();
      prevPart = null;
    }

    if (hasPart) {
      const entryTokens = getEntryTokens(name, leaf);
      const currentPart = leaf.part ?? null;

      if (currentPart === prevPart) {
        // Same part: check overlap but don't accumulate
        if (!hasOverlap(accTokens, entryTokens)) {
          currentOrder = nextTens(currentOrder);
          accTokens = entryTokens;
        }
      } else {
        // Different part or first entry with part
        if (prevPart !== null && !hasOverlap(accTokens, entryTokens)) {
          currentOrder = nextTens(currentOrder);
          accTokens = entryTokens;
        } else {
          accTokens = union(accTokens, entryTokens);
        }
      }

      prevPart = currentPart;
    } else {
      // No part: pure typeName grouping, same typeName → same tens block
      // Reset part tracking since this type doesn't use parts
      prevPart = null;
      accTokens = new Set<string>();
    }

    orderMap.set(name, currentOrder);
    currentOrder += 1;
    prevTypeName = typeName;
    prevRephrase = false;
  }

  if (rephraseEntries.length > 0) {
    currentOrder = nextTens(currentOrder);
    prevTypeName = null;
    accTokens = new Set<string>();
    prevPart = null;
    const sorted = [...rephraseEntries].reverse();

    for (const entry of sorted) {
      const { name, leaf, typeName, hasPart } = entry;

      if (prevTypeName !== null && typeName !== prevTypeName) {
        currentOrder = nextTens(currentOrder);
        accTokens = new Set<string>();
        prevPart = null;
      }

      if (hasPart) {
        const entryTokens = getEntryTokens(name, leaf);
        const currentPart = leaf.part ?? null;

        if (currentPart === prevPart) {
          if (!hasOverlap(accTokens, entryTokens)) {
            currentOrder = nextTens(currentOrder);
            accTokens = entryTokens;
          }
        } else {
          if (prevPart !== null && !hasOverlap(accTokens, entryTokens)) {
            currentOrder = nextTens(currentOrder);
            accTokens = entryTokens;
          } else {
            accTokens = union(accTokens, entryTokens);
          }
        }

        prevPart = currentPart;
      } else {
        prevPart = null;
        accTokens = new Set<string>();
      }

      orderMap.set(name, currentOrder);
      currentOrder += 1;
      prevTypeName = typeName;
    }
  }

  return orderMap;
}

const SEPARATOR_RE = /[-_\s/]+/;

function tokenize(name: string): string[] {
  return name.split(SEPARATOR_RE).filter(Boolean);
}

function getEntryTokens(name: string, leaf: EntryManifestLeaf): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(name)) tokens.add(t);
  for (const k of leaf.keywords) tokens.add(k);
  return tokens;
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const item of b) {
    if (a.has(item)) return true;
  }
  return false;
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set(a);
  for (const item of b) result.add(item);
  return result;
}

function collectOrderedEntries(
  state: TavernCardsState,
  typeLists: { before_char: string[]; after_char: string[]; depth: string[] },
): OrderEntry[] {
  const entries: OrderEntry[] = [];
  const seen = new Set<string>();

  // Pre-compute which types have any entry with a part field
  const typesWithParts = new Set<string>();
  for (const [typeName, typeEntries] of Object.entries(state.entryManifest)) {
    for (const leaf of Object.values(typeEntries)) {
      if (leaf.part) {
        typesWithParts.add(typeName);
        break;
      }
    }
  }

  for (const zone of ['before_char', 'after_char', 'depth'] as const) {
    for (const typeName of typeLists[zone]) {
      const typeEntries = state.entryManifest[typeName];
      if (!typeEntries) continue;
      for (const [name, leaf] of Object.entries(typeEntries)) {
        if (!seen.has(name)) {
          entries.push({ name, leaf, typeName, positionZone: zone, hasPart: typesWithParts.has(typeName) });
          seen.add(name);
        }
      }
    }
  }

  for (const [typeName, typeEntries] of Object.entries(state.entryManifest)) {
    for (const [name, leaf] of Object.entries(typeEntries)) {
      if (!seen.has(name)) {
        entries.push({ name, leaf, typeName, positionZone: 'depth', hasPart: typesWithParts.has(typeName) });
        seen.add(name);
      }
    }
  }

  return entries;
}

function nextTens(n: number): number {
  return Math.floor((n - 1) / 10) * 10 + 10;
}
