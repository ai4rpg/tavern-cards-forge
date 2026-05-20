import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';
import { deriveStrategy } from './thresholds.js';
import { derivePosition } from './positions.js';
import { allocateOrder } from './order.js';

export function configureState(
  state: TavernCardsState,
  force?: boolean,
): TavernCardsState {
  const orderMap = allocateOrder(state);

  for (const [typeName, entries] of Object.entries(state.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(entries)) {

      const strategyUpdate = deriveStrategy(entryName, leaf, typeName, entries, state, force);
      Object.assign(leaf, strategyUpdate);

      const positionUpdate = derivePosition(leaf, typeName, state, force);
      Object.assign(leaf, positionUpdate);

      if (leaf.position && orderMap.has(entryName)) {
        leaf.position = { ...leaf.position, order: orderMap.get(entryName)! };
      }

      if (force || leaf.uid === undefined) {
        leaf.uid = allocateUid(state);
      }
    }
  }

  return state;
}

let uidCounter = 0;

function allocateUid(state: TavernCardsState): number {
  const usedUids = new Set<number>();
  for (const entries of Object.values(state.entryManifest)) {
    for (const leaf of Object.values(entries)) {
      if (leaf.uid !== undefined) usedUids.add(leaf.uid);
    }
  }

  let uid = uidCounter;
  while (usedUids.has(uid)) uid++;
  uidCounter = uid + 1;
  return uid;
}
