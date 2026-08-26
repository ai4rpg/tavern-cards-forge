import type { SillyTavernTavernHelper } from '../type/sillytavern.js';
import type { TavernHelper } from '../type/state.js';

/**
 * SillyTavern 原始格式 → forge 内部 state 格式转换
 *
 * 这些函数处理 ST 角色卡/世界书 JSON 的 wire format（数组、嵌套结构等）
 * 到 forge 扁平化 Record 结构的转换，纯数据变换，无 I/O。
 */

export function convertRegexScriptsToState(raw: any[] | undefined): Record<string, any> | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  const result: Record<string, any> = {};
  for (const s of raw) {
    const { scriptName, ...rest } = s;
    if (rest.minDepth === null) delete rest.minDepth;
    if (rest.maxDepth === null) delete rest.maxDepth;
    const name = scriptName ?? s.id ?? `regex_${raw.indexOf(s)}`;
    result[name] = rest;
  }
  return result;
}

function scriptsArrayToRecord(scripts: Array<Record<string, any>>): TavernHelper['scripts'] {
  const scriptsRecord: Record<string, any> = {};
  for (const s of scripts) {
    const { name, ...rest } = s;
    if (name) scriptsRecord[name] = rest;
  }
  return scriptsRecord as TavernHelper['scripts'];
}

export function convertTavernHelperToState(raw: SillyTavernTavernHelper | undefined): TavernHelper | undefined {
  if (!raw) return undefined;

  const result: TavernHelper = {};

  if (Array.isArray(raw)) {
    for (const section of raw) {
      if (!Array.isArray(section) || section.length < 2) continue;

      const [key, value] = section;
      if (key === 'scripts') {
        result.scripts = scriptsArrayToRecord(value as Array<Record<string, any>>);
      } else if (key === 'variables') {
        result.variables = value as TavernHelper['variables'];
      }
    }
  } else if (typeof raw === 'object') {
    if (Array.isArray(raw.scripts)) {
      result.scripts = scriptsArrayToRecord(raw.scripts);
    }
    if (raw.variables) {
      result.variables = raw.variables as TavernHelper['variables'];
    }
  }

  return result.scripts !== undefined || result.variables !== undefined ? result : undefined;
}

/** tags 规范化: 数组原样(去空串), 逗号分隔字符串按 ST charaFormatData 拆分, 其余为 [] */
function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

export function buildCharacterMeta(data: any): Record<string, any> {
  return {
    description: data.data?.description ?? data.description ?? '',
    personality: data.data?.personality ?? data.personality ?? '',
    scenario: data.data?.scenario ?? data.scenario ?? '',
    first_messages: [
      data.data?.first_mes ?? data.first_mes ?? '',
      ...(data.data?.alternate_greetings ?? []),
    ].filter(g => g && g.trim()),
    mes_example: data.data?.mes_example ?? data.mes_example ?? '',
    // system_prompt / post_history_instructions 按 ST 规范只活在 data.*; 顶层 fallback 只防畸形卡
    system_prompt: data.data?.system_prompt ?? data.system_prompt ?? '',
    post_history_instructions: data.data?.post_history_instructions ?? data.post_history_instructions ?? '',
    tags: normalizeTags(data.data?.tags ?? data.tags),
    creator: data.data?.creator ?? '',
    creator_notes: data.data?.creator_notes ?? data.creatorcomment ?? '',
    version: data.data?.character_version ?? '',
    create_date: data.create_date ?? '',
    extensions: {
      tavern_helper: convertTavernHelperToState(data.data?.extensions?.tavern_helper),
      talkativeness: data.data?.extensions?.talkativeness,
      fav: data.data?.extensions?.fav,
      world: data.data?.extensions?.world,
      depth_prompt: data.data?.extensions?.depth_prompt,
    },
    regex_scripts: convertRegexScriptsToState(data.data?.extensions?.regex_scripts),
  };
}

export function isFlatWorldbookFormat(data: any): boolean {
  if (!data.entries || typeof data.entries !== 'object') return false;
  const firstEntry = Object.values(data.entries)[0] as any;
  return firstEntry && 'order' in firstEntry && !('insertion_order' in firstEntry);
}

export function isCharacterCardJson(data: any): boolean {
  return data.spec && data.spec.startsWith('chara_card') && data.data;
}
