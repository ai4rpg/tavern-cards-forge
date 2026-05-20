import type { SillyTavernEntry } from '../type/sillytavern.js';
import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';

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

export function parseRawEntry(raw: SillyTavernEntry, index: number): EntryManifestLeaf {
  const ext = raw.extensions;
  const positionType = POSITION_REVERSE[ext.position];
  const role = ROLE_REVERSE[ext.role] ?? 'system';

  let strategyType: 'constant' | 'selective' | 'vectorized' = 'constant';
  if (ext.vectorized) strategyType = 'vectorized';
  else if (raw.selective && !raw.constant) strategyType = 'selective';

  const hasKeys = raw.keys && raw.keys.length > 0;
  const hasSecondary = raw.secondary_keys && raw.secondary_keys.length > 0;

  const recursion: NonNullable<EntryManifestLeaf['recursion']> = {};
  if (ext.exclude_recursion) recursion.prevent_incoming = true;
  if (ext.prevent_recursion) recursion.prevent_outgoing = true;
  if (typeof ext.delay_until_recursion === 'number') recursion.delay_until = ext.delay_until_recursion;
  // Omit default recursion (prevent_incoming + prevent_outgoing both true, no delay_until)
  const isDefaultRecursion = recursion.prevent_incoming && recursion.prevent_outgoing && !recursion.delay_until;
  if (isDefaultRecursion) {
    delete recursion.prevent_incoming;
    delete recursion.prevent_outgoing;
  }

  const effect: NonNullable<EntryManifestLeaf['effect']> = {};
  if (ext.sticky) effect.sticky = ext.sticky;
  if (ext.cooldown) effect.cooldown = ext.cooldown;
  if (ext.delay) effect.delay = ext.delay;

  const leaf: EntryManifestLeaf = {
    abstract: '',
    uid: raw.id ?? index,
    enabled: raw.enabled,
    strategy: {
      type: strategyType,
      ...(hasKeys ? { keys: [...raw.keys] } : {}),
      ...(hasSecondary
        ? {
            keys_secondary: {
              logic: SELECTIVE_LOGIC_REVERSE[ext.selectiveLogic] ?? 'and_any',
              keys: [...raw.secondary_keys],
            },
          }
        : {}),
      ...(ext.scan_depth != null ? { scan_depth: ext.scan_depth } : {}),
    },
    position: {
      type: positionType ?? 'after_character_definition',
      order: raw.insertion_order,
      ...(positionType === 'at_depth' ? { role, depth: ext.depth } : {}),
    },
    display_index: ext.display_index,
    ...(ext.probability !== 100 ? { probability: ext.probability } : {}),
    ...(Object.keys(recursion).length > 0 ? { recursion } : {}),
    ...(Object.keys(effect).length > 0 ? { effect } : {}),
    keywords: hasKeys ? [...raw.keys] : [],
  };

  const groupStr = ext.group;
  if (groupStr && groupStr.trim()) {
    leaf.group = {
      labels: groupStr.split(',').map(s => s.trim()).filter(Boolean),
      use_priority: ext.group_override ?? false,
      weight: ext.group_weight ?? 100,
      use_scoring: ext.use_group_scoring ?? false,
    };
  }

  return leaf;
}

export function rawEntriesToState(
  entries: SillyTavernEntry[],
  name: string,
  worldbookName: string,
  form: 'charactercard' | 'worldbook',
): TavernCardsState {
  const entriesRecord: Record<string, EntryManifestLeaf> = {};
  
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    const entryName = raw.comment || `entry_${i}`;
    entriesRecord[entryName] = parseRawEntry(raw, i);
  }

  return {
    projectName: name,
    worldbookName: worldbookName || name,
    form,
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
