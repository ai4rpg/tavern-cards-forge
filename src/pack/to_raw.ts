import type { SillyTavernEntry, SillyTavernCharacter, SillyTavernTavernHelper, SillyTavernRegexScript, NumericPosition, NumericRole, NumericSelectiveLogic } from '../type/sillytavern.js';
import type { EntryManifestLeaf, TavernHelper, RegexScript, TavernCardsState } from '../type/state.js';
import type { CardrcConfig } from '../type/settings.js';
import type { FlatWorldbookEntry } from '../type/entry-flat.js';

const POSITION_MAP: Record<string, NumericPosition> = {
  before_character_definition: 0,
  after_character_definition: 1,
  before_author_note: 2,
  after_author_note: 3,
  at_depth: 4,
  before_example_messages: 5,
  after_example_messages: 6,
};

const ROLE_MAP: Record<string, NumericRole> = { system: 0, user: 1, assistant: 2 };
const SELECTIVE_LOGIC_MAP: Record<string, NumericSelectiveLogic> = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 };

function toSillyTavernRegexScripts(scripts: Record<string, RegexScript>): SillyTavernRegexScript[] {
  return Object.entries(scripts).map(([name, s]) => ({
    id: s.id ?? '',
    scriptName: name,
    findRegex: s.findRegex ?? '',
    replaceString: s.replaceString ?? '',
    trimStrings: s.trimStrings ?? [],
    placement: s.placement ?? [],
    disabled: s.disabled ?? false,
    markdownOnly: s.markdownOnly ?? false,
    promptOnly: s.promptOnly ?? false,
    runOnEdit: s.runOnEdit ?? false,
    substituteRegex: s.substituteRegex ?? 0,
    minDepth: s.minDepth ?? null,
    maxDepth: s.maxDepth ?? null,
  }));
}

function convertTavernHelperToRaw(stateHelper: TavernHelper | undefined): SillyTavernTavernHelper | undefined {
  if (!stateHelper) return undefined;

  const result: SillyTavernTavernHelper = {};

  if (stateHelper.scripts !== undefined) {
    result.scripts = Object.entries(stateHelper.scripts).map(([name, s]) => ({
      type: s.type,
      enabled: s.enabled,
      id: s.id,
      name,
      content: s.content ?? '',
      info: s.info ?? '',
      ...(s.button ? { button: s.button } : {}),
      ...(s.data ? { data: s.data } : {}),
    }));
  }

  if (stateHelper.variables !== undefined) {
    result.variables = stateHelper.variables;
  }

  return result;
}

export function toSillyTavernEntry(
  leaf: EntryManifestLeaf & { name: string; content: string },
  index: number,
  depthDefaults?: CardrcConfig['depth_defaults'],
): SillyTavernEntry {
  const strategy = leaf.strategy ?? { type: 'constant' as const };
  const position = leaf.position ?? { type: 'after_character_definition' as const, order: 0 };
  const isConstant = strategy.type === 'constant';
  const isSelective = strategy.type === 'selective';

  return {
    id: index,
    keys: strategy.keys ?? [],
    secondary_keys: strategy.keys_secondary?.keys ?? [],
    comment: leaf.name,
    content: leaf.content,
    constant: isConstant,
    selective: isSelective,
    insertion_order: position.order,
    enabled: leaf.enabled !== false,
    // 顶层 position 按 CCv2 spec / ST charaFormatData 只区分 before_char / after_char,
    // 完整位置(at_depth 等)在 extensions.position 数字, 与 ST 原生导出一致
    position: position.type === 'before_character_definition' ? 'before_char' : 'after_char',
    use_regex: true,
    extensions: {
      position: POSITION_MAP[position.type] ?? 1,
      exclude_recursion: leaf.recursion?.prevent_incoming ?? true,
      display_index: leaf.display_index ?? index,
      probability: leaf.probability ?? 100,
      useProbability: true,
      depth: position.depth ?? depthDefaults?.depth ?? 0,
      selectiveLogic: SELECTIVE_LOGIC_MAP[strategy.keys_secondary?.logic ?? 'and_any'],
      outlet_name: '',
      group: leaf.group?.labels?.join(',') ?? '',
      group_override: leaf.group?.use_priority ?? false,
      group_weight: leaf.group?.weight ?? 100,
      prevent_recursion: leaf.recursion?.prevent_outgoing ?? true,
      delay_until_recursion: leaf.recursion?.delay_until != null ? leaf.recursion?.delay_until : false,
      scan_depth: strategy.scan_depth === 'same_as_global' || strategy.scan_depth === undefined ? null : strategy.scan_depth,
      match_whole_words: null,
      use_group_scoring: leaf.group?.use_scoring ?? false,
      case_sensitive: null,
      automation_id: '',
      role: ROLE_MAP[position.role ?? 'system'],
      vectorized: strategy.type === 'vectorized',
      sticky: leaf.effect?.sticky !== undefined ? leaf.effect?.sticky : 0,
      cooldown: leaf.effect?.cooldown !== undefined ? leaf.effect?.cooldown : 0,
      delay: leaf.effect?.delay !== undefined ? leaf.effect?.delay : 0,
      match_persona_description: false,
      match_character_description: false,
      match_character_personality: false,
      match_character_depth_prompt: false,
      match_scenario: false,
      match_creator_notes: false,
      triggers: [],
      ignore_budget: false,
    },
  };
}

export function buildSillyTavernCharacter(
  state: Pick<TavernCardsState,
    | 'projectName' | 'worldbookName'
    | 'description' | 'personality' | 'scenario' | 'first_messages' | 'mes_example'
    | 'system_prompt' | 'post_history_instructions' | 'tags'
    | 'creator' | 'creator_notes' | 'version' | 'create_date'
    | 'extensions' | 'regex_scripts'
  >,
  leaves: Array<EntryManifestLeaf & { name: string; content: string }>,
  depthDefaults?: CardrcConfig['depth_defaults'],
): SillyTavernCharacter {
  const entries = leaves.map((leaf, i) => toSillyTavernEntry(leaf, i, depthDefaults));
  const firstMes = state.first_messages[0] ?? '';
  const altGreetings = state.first_messages.slice(1);

  // system_prompt / post_history_instructions 仅写 data.*: ST spec 顶层没有这两项, 也不提升
  // 可选元数据缺省时按 ''/[] 写入卡内, 与 ST charaFormatData 两侧都写的行为一致
  return {
    name: state.projectName,
    description: state.description,
    personality: state.personality ?? '',
    scenario: state.scenario ?? '',
    first_mes: firstMes,
    mes_example: state.mes_example ?? '',
    creatorcomment: state.creator_notes,
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: state.tags ?? [],
    spec: 'chara_card_v3',
    spec_version: '3.0',
    create_date: state.create_date ?? '',
    data: {
      name: state.projectName,
      description: state.description,
      personality: state.personality ?? '',
      scenario: state.scenario ?? '',
      first_mes: firstMes,
      mes_example: state.mes_example ?? '',
      creator_notes: state.creator_notes,
      creator: state.creator,
      character_version: state.version,
      alternate_greetings: altGreetings,
      system_prompt: state.system_prompt ?? '',
      post_history_instructions: state.post_history_instructions ?? '',
      tags: state.tags ?? [],
      extensions: {
        world: state.worldbookName,
        regex_scripts: state.regex_scripts ? toSillyTavernRegexScripts(state.regex_scripts) : [],
        tavern_helper: convertTavernHelperToRaw(state.extensions?.tavern_helper),
        talkativeness: '0.5',
        fav: false,
        depth_prompt: { prompt: '', depth: 4, role: 'system' },
        ...(state.extensions ? omitKeys(state.extensions, 'tavern_helper', 'regex_scripts') : {}),
      },
      character_book: {
        name: state.worldbookName,
        entries,
      },
    },
  };
}

function omitKeys(obj: Record<string, any>, ...keys: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) result[key] = obj[key];
  }
  return result;
}

export function toFlatWorldbookEntry(
  leaf: EntryManifestLeaf & { name: string; content: string },
  index: number,
): FlatWorldbookEntry {
  const strategy = leaf.strategy ?? { type: 'constant' as const };
  const position = leaf.position ?? { type: 'after_character_definition' as const, order: 0 };
  const isConstant = strategy.type === 'constant';
  const isSelective = strategy.type === 'selective';

  return {
    uid: index,
    key: strategy.keys ?? [],
    keysecondary: strategy.keys_secondary?.keys ?? [],
    comment: leaf.name,
    content: leaf.content,
    constant: isConstant,
    selective: isSelective,
    vectorized: strategy.type === 'vectorized',
    selectiveLogic: SELECTIVE_LOGIC_MAP[strategy.keys_secondary?.logic ?? 'and_any'],
    addMemo: false,
    order: position.order,
    position: POSITION_MAP[position.type] ?? 1,
    disable: leaf.enabled === false,
    ignoreBudget: false,
    excludeRecursion: leaf.recursion?.prevent_incoming ?? true,
    preventRecursion: leaf.recursion?.prevent_outgoing ?? true,
    delayUntilRecursion: leaf.recursion?.delay_until ?? false,
    probability: leaf.probability ?? 100,
    useProbability: true,
    depth: position.depth ?? 0,
    outletName: '',
    role: ROLE_MAP[position.role ?? 'system'],
    group: leaf.group?.labels?.join(',') ?? '',
    groupOverride: leaf.group?.use_priority ?? false,
    groupWeight: leaf.group?.weight ?? 100,
    scanDepth: strategy.scan_depth === 'same_as_global' || strategy.scan_depth === undefined ? null : strategy.scan_depth,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: leaf.group?.use_scoring ?? false,
    automationId: '',
    displayIndex: leaf.display_index ?? index,
    sticky: leaf.effect?.sticky ?? null,
    cooldown: leaf.effect?.cooldown ?? null,
    delay: leaf.effect?.delay ?? null,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    triggers: [],
  };
}

export function buildFlatWorldbook(
  leaves: Array<EntryManifestLeaf & { name: string; content: string }>,
): { entries: Record<string, FlatWorldbookEntry> } {
  const entries: Record<string, FlatWorldbookEntry> = {};
  for (let i = 0; i < leaves.length; i++) {
    entries[i.toString()] = toFlatWorldbookEntry(leaves[i], i);
  }
  return { entries };
}
