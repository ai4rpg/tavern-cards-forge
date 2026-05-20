import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';
import type { FlatWorldbookEntry } from '../type/entry-flat.js';

const zeroToUndefined = (val: number | null | undefined): number | undefined =>
  val === 0 || val === null ? undefined : val;

const zeroToUndefinedPreserveNull = (val: number | null | undefined): number | null | undefined =>
  val === 0 ? undefined : val;

const POSITION_REVERSE: Record<number, 'before_character_definition' | 'after_character_definition' | 'before_author_note' | 'after_author_note' | 'at_depth' | 'before_example_messages' | 'after_example_messages'> = {
  0: 'before_character_definition',
  1: 'after_character_definition',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
};

const ROLE_REVERSE: Record<number, 'system' | 'user' | 'assistant'> = {
  0: 'system',
  1: 'user',
  2: 'assistant',
};

const SELECTIVE_LOGIC_REVERSE: Record<number, 'and_any' | 'not_all' | 'not_any' | 'and_all'> = {
  0: 'and_any',
  1: 'not_all',
  2: 'not_any',
  3: 'and_all',
};

export function parseFlatEntry(flat: FlatWorldbookEntry, index: number): EntryManifestLeaf {
  const positionType = POSITION_REVERSE[flat.position ?? 1];
  const role = ROLE_REVERSE[flat.role ?? 0] ?? 'system';

  let strategyType: 'constant' | 'selective' | 'vectorized' = 'constant';
  if (flat.vectorized) strategyType = 'vectorized';
  else if (flat.selective && !flat.constant) strategyType = 'selective';

  const hasKeys = flat.key && flat.key.length > 0;
  const hasSecondary = flat.keysecondary && flat.keysecondary.length > 0;

  const recursion: NonNullable<EntryManifestLeaf['recursion']> = {};
  if (flat.excludeRecursion) recursion.prevent_incoming = true;
  if (flat.preventRecursion) recursion.prevent_outgoing = true;
  if (flat.delayUntilRecursion != null && typeof flat.delayUntilRecursion === 'number') {
    recursion.delay_until = zeroToUndefinedPreserveNull(flat.delayUntilRecursion);
  }
  // Omit default recursion (prevent_incoming + prevent_outgoing both true, no delay_until)
  const isDefaultRecursion = recursion.prevent_incoming && recursion.prevent_outgoing && !recursion.delay_until;
  if (isDefaultRecursion) {
    delete recursion.prevent_incoming;
    delete recursion.prevent_outgoing;
  }

  const effect: NonNullable<EntryManifestLeaf['effect']> = {};
  if (flat.sticky) effect.sticky = flat.sticky;
  if (flat.cooldown) effect.cooldown = flat.cooldown;
  if (flat.delay) effect.delay = flat.delay;

  const leaf: EntryManifestLeaf = {
    abstract: '',
    uid: flat.uid ?? index,
    enabled: !(flat.disable ?? false),
    strategy: {
      type: strategyType,
      ...(hasKeys ? { keys: [...flat.key!] } : {}),
      ...(hasSecondary
        ? {
            keys_secondary: {
              logic: SELECTIVE_LOGIC_REVERSE[flat.selectiveLogic ?? 0] ?? 'and_any',
              keys: [...flat.keysecondary!],
            },
          }
        : {}),
      ...(flat.scanDepth !== undefined ? { scan_depth: zeroToUndefined(flat.scanDepth) } : {}),
    },
    position: {
      type: positionType ?? 'after_character_definition',
      order: flat.order ?? 0,
      ...(positionType === 'at_depth' ? { role, depth: flat.depth ?? 0 } : {}),
    },
    display_index: flat.displayIndex,
    ...(flat.probability !== 100 && flat.probability !== undefined ? { probability: flat.probability } : {}),
    ...(Object.keys(recursion).length > 0 ? { recursion } : {}),
    ...(Object.keys(effect).length > 0 ? { effect } : {}),
    keywords: hasKeys ? [...flat.key!] : [],
  };

  const groupStr = flat.group;
  if (groupStr && groupStr.trim()) {
    const labels = groupStr.split(',').map(s => s.trim()).filter(Boolean);
    if (labels.length > 0) {
      leaf.group = {
        labels,
        use_priority: flat.groupOverride ?? false,
        weight: flat.groupWeight ?? 100,
        use_scoring: flat.useGroupScoring ?? false,
      };
    }
  }

  return leaf;
}

export function flatEntriesToState(
  entries: FlatWorldbookEntry[],
  name: string,
  worldbookName: string,
): TavernCardsState {
  const entriesRecord: Record<string, EntryManifestLeaf> = {};
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    const entryName = raw.comment || `entry_${i}`;
    entriesRecord[entryName] = parseFlatEntry(raw, i);
  }

  return {
    projectName: name,
    worldbookName: worldbookName || name,
    form: 'worldbook',
    mvu: false,
    entryManifest: { unknown: entriesRecord },
    typeLists: { before_char: [], after_char: [], depth: [] },
    depth_defaults: { role: 'system', depth: 0 },
    description: '',
    first_messages: [],
    creator: '',
    creator_notes: '',
    version: '1.0',
    create_date: '',
  };
}
