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
    }
  }

  return state;
}
