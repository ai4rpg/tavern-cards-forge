/**
 * 三类酒馆可导入资源（世界书 / 正则 / 助手脚本）的纯数据构建。
 *
 * 格式依据：本机 `/home/lyne7/Games/SillyTavern/`（AGPL 开源，本仓消费其导入端点的格式契约）。
 * 详见 `.pi/blackboard/format-source-notes.md`。
 *
 * 世界书采用 forge 扁平格式（camelCase 条目 + `entries` 对象）——即酒馆可导入格式
 * （ST 导入仅校验 `entries` 存在；本机真实 on-disk WI 亦无顶层 `name`/`originalData`）。
 * 详见 `.pi/blackboard/fix.md` 的三层比对结论。
 *
 * 本模块仅做数据转换 + 文件落盘，不触碰 state 结构与既有 pack/unpack 行为。
 */
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFileText, writeJson } from '../util/file_io.js';
import { resolveFiles } from '../pack/resolve_files.js';
import { buildFlatWorldbook } from '../pack/to_raw.js';
import { prepareZodSync, buildZodScriptEntry } from '../util/mvu_schema.js';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import type { TavernCardsState } from '../type/state.js';

export type ResourceKind = 'worldbook' | 'regex' | 'helper';

export interface HelperScriptEntry {
  /** 脚本名（state Record 的 key；或卡内 name 字段） */
  name: string;
  /** 完整的、含 content 的脚本对象（经 script_file 解析 / Zod 重建） */
  script: Record<string, any>;
}

export interface ExportSummary {
  kind: ResourceKind;
  /** 相对输出目录的路径（worldinfo/regex 是文件；helper 是目录） */
  relPath: string;
  /** 条目/脚本数（worldinfo=entry 数、regex=script 数、helper=script 数） */
  count: number;
  label: string;
}

/** 嵌入式 character_book（spec 数组形态）的极简描述。 */
interface CharacterBook {
  entries: any[];
}

/**
 * 把嵌入式 character_book（snake_case 数组条目）映射为 forge 扁平 World Info（camelCase + entries 对象）。
 *
 * 与 `toFlatWorldbookEntry` 产出同一字段集，确保 export（从 state）与 split（从卡）结构一致。条目以 `id` 作 key。
 */
export function characterBookToFlatWorldInfo(book: CharacterBook): Record<string, any> {
  const entries: Record<string, any> = {};
  book.entries.forEach((entry, index) => {
    const id = entry.id ?? index;
    entries[String(id)] = characterBookEntryToFlat(entry, index);
  });
  return { entries };
}

/** snake_case character_book 条目 → camelCase 扁平条目（字段集与 `toFlatWorldbookEntry` 一致）。 */
function characterBookEntryToFlat(entry: any, index: number): Record<string, any> {
  const ext = entry.extensions ?? {};
  return {
    uid: entry.id ?? index,
    key: entry.keys ?? [],
    keysecondary: entry.secondary_keys ?? [],
    comment: entry.comment ?? '',
    content: entry.content ?? '',
    constant: entry.constant ?? false,
    selective: entry.selective ?? false,
    vectorized: ext.vectorized ?? false,
    selectiveLogic: ext.selectiveLogic ?? 0,
    addMemo: false,
    order: entry.insertion_order,
    position: ext.position ?? (entry.position === 'before_char' ? 0 : 1),
    disable: entry.enabled !== true,
    ignoreBudget: ext.ignore_budget ?? false,
    excludeRecursion: ext.exclude_recursion ?? true,
    preventRecursion: ext.prevent_recursion ?? true,
    delayUntilRecursion: ext.delay_until_recursion ?? false,
    probability: ext.probability ?? 100,
    useProbability: true,
    depth: ext.depth ?? 0,
    outletName: ext.outlet_name ?? '',
    role: ext.role ?? 0,
    group: ext.group ?? '',
    groupOverride: ext.group_override ?? false,
    groupWeight: ext.group_weight ?? 100,
    scanDepth: ext.scan_depth ?? null,
    caseSensitive: ext.case_sensitive ?? null,
    matchWholeWords: ext.match_whole_words ?? null,
    useGroupScoring: ext.use_group_scoring ?? false,
    automationId: ext.automation_id ?? '',
    displayIndex: ext.display_index ?? index,
    sticky: ext.sticky ?? null,
    cooldown: ext.cooldown ?? null,
    delay: ext.delay ?? null,
    matchPersonaDescription: ext.match_persona_description ?? false,
    matchCharacterDescription: ext.match_character_description ?? false,
    matchCharacterPersonality: ext.match_character_personality ?? false,
    matchCharacterDepthPrompt: ext.match_character_depth_prompt ?? false,
    matchScenario: ext.match_scenario ?? false,
    matchCreatorNotes: ext.match_creator_notes ?? false,
    triggers: ext.triggers ?? [],
  };
}

/**
 * 从 state 构建扁平 World Info（酒馆可导入格式）。
 * 与 `buildWorldbookJson`（pack 的 worldbook form 路径）同源：`resolveFiles` → `buildFlatWorldbook`，
 * 无视 `state.form`，从而允许 charactercard 项目也按需导出世界书。
 */
export function buildStateWorldInfo(
  state: TavernCardsState,
  stateDir: string,
): Record<string, any> {
  const leaves = resolveFiles(state, stateDir);
  return buildFlatWorldbook(leaves);
}

/** 解析 state.regex_scripts 的 replace_file → replaceString。 */
function resolveStateRegexScripts(
  state: TavernCardsState,
  stateDir: string,
): Record<string, any> | undefined {
  const scriptsIn = state.regex_scripts;
  if (!scriptsIn || Object.keys(scriptsIn).length === 0) return undefined;
  const resolved: Record<string, any> = {};
  for (const [name, script] of Object.entries(scriptsIn)) {
    if (script.replace_file) {
      const content = readFileText(resolve(stateDir, script.replace_file));
      const { replace_file, ...rest } = script;
      resolved[name] = { ...rest, replaceString: content };
    } else {
      resolved[name] = script;
    }
  }
  return resolved;
}

/** 把单个正则脚本对象规范化为 SillyTavern RegexScriptData 全字段结构。 */
export function normalizeRegexScript(s: any, fallbackName?: string): Record<string, any> {
  return {
    id: s.id ?? '',
    scriptName: s.scriptName ?? fallbackName ?? '',
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
  };
}

/** 从 state 构建正则脚本数组（一个可导入 JSON 文件的最外层即数组）。 */
export function buildStateRegexScripts(state: TavernCardsState, stateDir: string): Record<string, any>[] {
  const resolved = resolveStateRegexScripts(state, stateDir);
  if (!resolved) return [];
  return Object.entries(resolved).map(([name, s]) => normalizeRegexScript(s, name));
}

/** 解析 state.extensions.tavern_helper.scripts 的 script_file → content，并按需重建 Zod 脚本。 */
function resolveStateHelperScriptsRecord(
  state: TavernCardsState,
  stateDir: string,
): Record<string, Record<string, any>> {
  const scriptsIn = state.extensions?.tavern_helper?.scripts ?? {};
  const resolved: Record<string, Record<string, any>> = {};
  for (const [name, script] of Object.entries(scriptsIn)) {
    if (script.script_file) {
      const content = readFileText(resolve(stateDir, script.script_file));
      const { script_file, ...rest } = script;
      if (content) resolved[name] = { ...rest, content };
    } else if (script.content) {
      resolved[name] = script;
    }
  }
  return resolved;
}

/** 从 state 构建助手脚本列表（每个含 name + content）。Zod 脚本按需重建（与 pack 内嵌行为一致）。 */
export function buildStateHelperScripts(
  state: TavernCardsState,
  stateDir: string,
): HelperScriptEntry[] {
  const scripts = resolveStateHelperScriptsRecord(state, stateDir);

  if (state.zod) {
    const { zodSubject } = prepareZodSync(stateDir, state.zod);
    if (scripts[state.zod.scriptName]) {
      console.warn(
        `⚠ tavern_helper.scripts already has a script named "${state.zod.scriptName}", ` +
        `overridden by state.zod rebuild when exporting`,
      );
    }
    scripts[state.zod.scriptName] = buildZodScriptEntry(state.zod, zodSubject);
    console.log(`✓ Zod script "${state.zod.scriptName}" rebuilt from ${state.zod.schemaPath}`);
  }

  return Object.entries(scripts).map(([name, s]) => ({ name, script: toImportableHelperScript(s, name) }));
}

/**
 * 从卡侧 `extensions.tavern_helper.scripts` 数组（forge 嵌入式或第三方形态）构建助手脚本列表。
 * 兼容 scripts 为 [name-script] 数组、或 [[section,value]] 旧形态（经 from_sillytavern 规整后传入 Record）。
 */
export function buildCardHelperScripts(
  rawScripts: any[] | Record<string, any> | undefined,
): HelperScriptEntry[] {
  if (!rawScripts) return [];

  // 兼容数组（[ {type:'script', name, enabled, ...}, ... ]）与 Record（{name: scriptInfo-without-name}）两种
  const list: { name: string; script: Record<string, any> }[] = Array.isArray(rawScripts)
    ? rawScripts
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({ name: s.name ?? '', script: toImportableHelperScript(s, s.name) }))
    : Object.entries(rawScripts).map(([name, s]) => ({
        name,
        script: toImportableHelperScript(s, name),
      }));

  return list;
}

/** 把单条 script 对象规范化为 Tavern Helper 可导入的 Script 全字段结构。 */
function toImportableHelperScript(s: any, name: string): Record<string, any> {
  const buttons = s?.button?.buttons ?? [];
  return {
    type: 'script',
    enabled: s?.enabled ?? false,
    name: s?.name ?? name,
    id: s?.id ?? '',
    content: s?.content ?? '',
    info: s?.info ?? '',
    button: {
      enabled: s?.button?.enabled ?? true,
      buttons: Array.isArray(buttons)
        ? buttons.map((b: any) => ({ name: b?.name ?? '', visible: b?.visible ?? true }))
        : [],
    },
    data: s?.data ?? {},
    // Tavern Helper 的 Script.export_with 字段；缺省时给默认 {data:true, button:true}（与 ST 扩展 prefault 一致），
    // 已存在则原样保留（卡内可能按需关掉 data/button 的再导出）
    export_with: s?.export_with ?? { data: true, button: true },
  };
}

// ─── 落盘 ────────────────────────────────────────────────────────────────────

function worldInfoEntryCount(wi: { entries: Record<string, any> }): number {
  return Object.keys(wi.entries).length;
}

export function writeWorldInfo(outDir: string, worldName: string, wi: any): ExportSummary {
  const file = `${sanitizeFilename(worldName)}.json`;
  writeJson(join(outDir, file), wi);
  return { kind: 'worldbook', relPath: file, count: worldInfoEntryCount(wi), label: 'world book' };
}

/**
 * 落盘正则脚本：置于 `regex-scripts/` 目录（与 `helper-scripts/` 并列），每个正则一个单对象文件，
 * 形态与 ST 自家导出一致，可逐文件导入。返回多份 summary（逐文件一行）。
 */
export function writeRegexScripts(outDir: string, scripts: any[]): ExportSummary[] {
  const regexDir = join(outDir, 'regex-scripts');
  const used = new Set<string>();
  const out: ExportSummary[] = [];
  for (const s of scripts) {
    let stem = sanitizeFilename(s.scriptName || '') || 'script';
    let file = `${stem}.json`;
    let n = 1;
    while (used.has(file)) {
      file = `${stem}_${n}.json`;
      n++;
    }
    used.add(file);
    writeJson(join(regexDir, file), s);
    out.push({ kind: 'regex', relPath: `regex-scripts/${file}`, count: 1, label: 'regex script' });
  }
  return out;
}

export function writeHelperScripts(outDir: string, scripts: HelperScriptEntry[]): ExportSummary {
  const helperDir = join(outDir, 'helper-scripts');
  const used = new Set<string>();
  for (const entry of scripts) {
    let stem = sanitizeFilename(entry.name) || 'script';
    let file = `${stem}.json`;
    let n = 1;
    while (used.has(file)) {
      file = `${stem}_${n}.json`;
      n++;
    }
    used.add(file);
    writeJson(join(helperDir, file), entry.script);
  }
  return { kind: 'helper', relPath: 'helper-scripts/', count: scripts.length, label: 'helper scripts' };
}

/** 检查给定相对路径是否存在；返回缺失列表。仅用于给出可读报错。 */
export function checkMissingFiles(stateDir: string, relPaths: string[]): string[] {
  return relPaths.filter((p) => !existsSync(resolve(stateDir, p)));
}

/** 按所选种类收集 state 中应校验存在性的文件路径（避免对与本次无关的字段过度严格）。 */
export function collectRequestedFilePaths(
  state: TavernCardsState,
  kinds: Set<ResourceKind>,
): string[] {
  const paths: string[] = [];
  if (kinds.has('worldbook')) {
    for (const entries of Object.values(state.entryManifest)) {
      for (const leaf of Object.values(entries)) {
        if (leaf.path) paths.push(leaf.path);
        if (leaf.contents) {
          for (const frag of leaf.contents) if (frag.file) paths.push(frag.file);
        }
      }
    }
  }
  if (kinds.has('regex') && state.regex_scripts) {
    for (const s of Object.values(state.regex_scripts)) if (s.replace_file) paths.push(s.replace_file);
  }
  if (kinds.has('helper')) {
    const scripts = state.extensions?.tavern_helper?.scripts;
    if (scripts) {
      for (const s of Object.values(scripts)) if (s.script_file) paths.push(s.script_file);
    }
    if (state.zod) paths.push(state.zod.schemaPath);
  }
  return paths;
}

export const ALL_KINDS: ResourceKind[] = ['worldbook', 'regex', 'helper'];

export function parseKinds(value: string | undefined): ResourceKind[] {
  if (!value || value === 'all') return [...ALL_KINDS];
  const listed = value
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean) as ResourceKind[];
  const invalid = listed.filter((k) => !ALL_KINDS.includes(k));
  if (invalid.length > 0) {
    throw new Error(`Unknown --kind value(s): ${invalid.join(', ')}. Valid: worldbook, regex, helper, all`);
  }
  if (listed.length === 0) return [...ALL_KINDS];
  return listed;
}
