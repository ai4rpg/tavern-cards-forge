import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';

export function derivePosition(
  leaf: EntryManifestLeaf,
  type: string,
  state: TavernCardsState,
  force?: boolean,
): Partial<EntryManifestLeaf> {
  if (!force && leaf.position) return {};

  const typeLists = state.typeLists;

  if (typeLists.before_char.includes(type)) {
    return {
      position: {
        type: 'before_character_definition',
        order: 0,
      },
    };
  }

  if (typeLists.after_char.includes(type)) {
    return {
      position: {
        type: 'after_character_definition',
        order: 0,
      },
    };
  }

  if (typeLists.depth.includes(type)) {
    return {
      position: {
        type: 'at_depth',
        role: state.depth_defaults?.role ?? 'system',
        depth: state.depth_defaults?.depth ?? 0,
        order: 0,
      },
    };
  }

  if (leaf.rephrase) {
    return {
      position: {
        type: 'at_depth',
        role: state.depth_defaults?.role ?? 'system',
        depth: state.depth_defaults?.depth ?? 0,
        order: 0,
      },
    };
  }

  return {};
}
