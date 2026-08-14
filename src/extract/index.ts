/**
 * 两类来源的酒馆可导入资源产出：
 * - runExport：forge 项目 state → 世界书 / 正则 / 助手脚本（打包/导出方向）
 * - runSplit ：maturity 角色卡 PNG/JSON → 同上三类（分离方向，无需先建项目）
 *
 * 命令：`forge export`、`forge split`。二者共用本模块的产物落盘逻辑（见 ./build.ts）。
 */
import { resolve, join, basename, dirname, extname, isAbsolute } from 'node:path';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { resolveProject, requireConfiguredProject, ProjectNotFoundError } from '../cli/settings.js';
import { detailedParse } from '../util/prettified_parse.js';
import { readFileText } from '../util/file_io.js';
import { TavernCardsState } from '../type/state.js';
import {
  buildStateWorldInfo,
  buildStateRegexScripts,
  buildStateHelperScripts,
  buildCardHelperScripts,
  characterBookToFlatWorldInfo,
  normalizeRegexScript,
  writeWorldInfo,
  writeRegexScripts,
  writeHelperScripts,
  collectRequestedFilePaths,
  checkMissingFiles,
  parseKinds,
  ALL_KINDS,
  type ResourceKind,
  type ExportSummary,
} from './build.js';
import { extractCharaFromPng } from '../pack/png_encode.js';
import { convertTavernHelperToState, isCharacterCardJson } from '../unpack/from_sillytavern.js';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
//  export：从 forge 项目 state 导出酒馆可导入文件
// ════════════════════════════════════════════════════════════════════════════

export async function runExport(
  project: string,
  opts: { state?: string; output?: string; kind?: string; regex?: string },
) {
  const { statePath, projectFound } = resolveProject(project, { state: opts.state });
  if (!projectFound && !opts.state) {
    requireConfiguredProject(project, projectFound, 'Without a configured project, --state is required.');
  }
  const stateDir = dirname(statePath);

  const stateRaw = JSON.parse(readFileText(statePath));
  const state = detailedParse(TavernCardsState, stateRaw);

  const kinds = parseKinds(opts.kind);
  const kindSet = new Set(kinds);

  // 只校验本次涉及种类的文件路径，避免对无关字段（如 avatar）严格阻断
  const requestedPaths = collectRequestedFilePaths(state, kindSet);
  const missing = checkMissingFiles(stateDir, requestedPaths);
  if (missing.length > 0) {
    throw new Error('Missing files:\n' + missing.map((m) => `  - ${m}`).join('\n'));
  }

  const outDir = resolveOutDir(opts.output, `${state.projectName || state.worldbookName}-resources`);

  const summaries: ExportSummary[] = [];

  if (kindSet.has('worldbook')) {
    const wi = buildStateWorldInfo(state, stateDir);
    summaries.push(writeWorldInfo(outDir, state.worldbookName, wi));
  }
  if (kindSet.has('regex')) {
    const scripts = buildStateRegexScripts(state, stateDir);
    summaries.push(...writeRegexScripts(outDir, scripts));
  }
  if (kindSet.has('helper')) {
    const scripts = buildStateHelperScripts(state, stateDir);
    summaries.push(writeHelperScripts(outDir, scripts));
  }

  printSummaries(`Exported ${state.projectName}`, outDir, summaries);
}

// ════════════════════════════════════════════════════════════════════════════
//  split：从角色卡 PNG/JSON 分离出酒馆可导入文件
// ════════════════════════════════════════════════════════════════════════════

export async function runSplit(
  project: string,
  opts: { file?: string; output?: string; kind?: string; regex?: string },
) {
  const { projectFound, artifactPath } = resolveProject(project, { artifact: opts.file });
  if (!projectFound && !opts.file) {
    requireConfiguredProject(project, projectFound, 'Without a configured project, --file is required.');
  }

  const cwd = process.cwd();
  const filePath = opts.file ? resolve(cwd, opts.file) : (opts.file ?? artifactPath!)!;
  if (!filePath) {
    throw new ProjectNotFoundError(project, 'Provide --file to specify input.');
  }
  if (!existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }

  const kinds = parseKinds(opts.kind);
  const kindSet = new Set(kinds);

  const ext = extname(filePath).toLowerCase();
  let data: any;
  if (ext === '.png') {
    const jsonStr = extractCharaFromPng(readFileSync(filePath));
    if (!jsonStr) throw new Error(`No chara/ccv3 chunk found in ${filePath}`);
    data = JSON.parse(jsonStr);
  } else if (ext === '.json') {
    data = JSON.parse(readFileText(filePath));
  } else {
    throw new Error(`Unsupported file type: ${ext} (expected .png or .json)`);
  }

  // 名称优先级：嵌入式 world 名 → 卡名 → 文件名
  const worldName =
    data?.data?.character_book?.name ??
    data?.data?.name ??
    data?.name ??
    basename(filePath).replace(/\.(png|json)$/i, '');

  const outDir = resolveOutDir(opts.output, `${sanitizeForDir(worldName)}-split`);

  const summaries: ExportSummary[] = [];

  if (kindSet.has('worldbook')) {
    const wi = buildCardWorldInfo(data);
    if (wi) summaries.push(writeWorldInfo(outDir, worldName, wi));
    else console.warn(`⚠ No embedded world info found in ${basename(filePath)}; skipped world book`);
  }
  if (kindSet.has('regex')) {
    const rawArr = data?.data?.extensions?.regex_scripts;
    const scripts: any[] = Array.isArray(rawArr)
      ? rawArr.filter((s) => s && typeof s === 'object').map((s) => normalizeRegexScript(s))
      : [];
    summaries.push(...writeRegexScripts(outDir, scripts));
  }
  if (kindSet.has('helper')) {
    const rawHelper = data?.data?.extensions?.tavern_helper;
    const helperState = convertTavernHelperToState(rawHelper);
    const scripts = buildCardHelperScripts(helperState?.scripts as any);
    summaries.push(writeHelperScripts(outDir, scripts));
  }

  printSummaries(`Split ${worldName}`, outDir, summaries);
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

/** 从角色卡数据构建扁平 World Info（酒馆可导入格式）。兼容嵌入式 character_book、顶层数组、以及已是扁平/on-disk 的独立 WI。 */
function buildCardWorldInfo(data: any): Record<string, any> | null {
  const book = data?.data?.character_book;
  if (book && (Array.isArray(book.entries) || book.entries === undefined)) {
    const entries = Array.isArray(book.entries) ? book.entries : [];
    return characterBookToFlatWorldInfo({ entries });
  }
  // 角色卡但无 character_book
  if (isCharacterCardJson(data)) {
    return { entries: {} };
  }
  // 已是扁平 / on-disk 独立 WI（entries 为 object）—— 即酒馆可导入格式，原样落盘
  if (data && data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
    return data;
  }
  // entries 为数组（spec 顶层平铺）—— 按嵌入式 book 转扁平
  if (data && Array.isArray(data.entries)) {
    return characterBookToFlatWorldInfo({ entries: data.entries });
  }
  return null;
}

function sanitizeForDir(name: string): string {
  return (name || 'card').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'card';
}

function resolveOutDir(output: string | undefined, defaultBasename: string): string {
  const dir = output
    ? (isAbsolute(output) ? output : resolve(process.cwd(), output))
    : resolve(process.cwd(), defaultBasename);
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    throw new Error(`Output path exists and is not a directory: ${dir}`);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function printSummaries(header: string, outDir: string, summaries: ExportSummary[]) {
  if (summaries.length === 0) {
    console.log(`${header} → ${outDir} (nothing to write)`);
    return;
  }
  console.log(`${header} → ${outDir}`);
  for (const s of summaries) {
    const noun =
      s.kind === 'worldbook' ? `${s.count} entr${s.count === 1 ? 'y' : 'ies'}` : `${s.count} script${s.count === 1 ? '' : 's'}`;
    console.log(`  ${s.label}: ${s.relPath} (${noun})`);
  }
}
