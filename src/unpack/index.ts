import { detectFileType, extractFromPng, readWorldbookJson } from './extract.js';
import { rawEntriesToState } from './parse_raw.js';
import { flatEntriesToState } from './parse_flat_worldbook.js';
import { buildCharacterMeta, isFlatWorldbookFormat, isCharacterCardJson } from './from_sillytavern.js';
import { readAndValidateOldState, mergeWithExistingState } from './merge.js';
import { detectAndExtractZodFromCard } from './zod_extract.js';
import { writeEntryBody, buildContentLookup, writeStateWithEntries } from './write_entries.js';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { writeJson, writeFileRecursive, sortEntriesForSerialization } from '../util/file_io.js';
import { resolve, dirname, basename, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import type { SillyTavernEntry, FlatWorldbookEntry } from '../type/sillytavern.js';
import { resolveProject, ProjectNotFoundError } from '../cli/settings.js';
import { stripCharaChunks } from '../pack/png_encode.js';
import { detectMvu } from '../util/detect_mvu.js';
import { isMvuZodScript, extractInitvarOverrideFromGreeting } from '../util/mvu_schema.js';

const DIR_ENTRIES = '世界书';
const DIR_REGEX = '正则';
const DIR_SCRIPTS = '脚本';
const DIR_GREETINGS = '开场白';

export async function runUnpack(
  project: string,
  opts: { file?: string; output?: string; state?: string; raw?: boolean; split?: boolean; fresh?: boolean },
) {
  const { artifactPath, statePath, projectFound } = resolveProject(project, { artifact: opts.file });
  if (!projectFound) {
    const missing: string[] = [];
    if (!opts.file) missing.push('--file');
    if (!opts.state && !opts.fresh) missing.push('--state or --fresh');
    // merge 模式: --output 可从 --state 推导（dirname）；fresh 模式: --output 必须显式指定
    if (!opts.output && opts.fresh) missing.push('--output');
    if (missing.length > 0) {
      throw new Error(`Without a configured project, ${missing.join(', ')} are required.`);
    }
  }

  if (!artifactPath) {
    throw new ProjectNotFoundError(project, 'Provide --file to specify input.');
  }

  const cwd = process.cwd();
  let filePath: string;
  let outputDir = opts.output;

  // merge 模式下 --output 未指定时，从 --state 路径推导（state.json 所在目录即 output 目录）
  if (!outputDir && opts.state) {
    outputDir = dirname(resolve(cwd, opts.state));
  }

  if (opts.file) {
    filePath = resolve(cwd, opts.file);
  } else {
    filePath = artifactPath!;
    if (!outputDir) {
      outputDir = dirname(statePath);
    }
  }

  if (!outputDir) {
    outputDir = resolve(cwd, basename(filePath).replace(/\.(png|json)$/i, ''));
  }
  outputDir = resolve(cwd, outputDir);

  const fileType = detectFileType(filePath);

  let rawEntries: SillyTavernEntry[];
  let form: 'charactercard' | 'worldbook';
  let characterMeta: Record<string, any> | null = null;
  let name: string;
  let worldbookName: string;
  let avatarBuffer: Buffer | null = null;

  if (fileType === 'png') {
    const extracted = extractFromPng(filePath);
    const data = extracted.data;
    avatarBuffer = extracted.imageBuffer;
    name = data.name ?? data.data?.name ?? basename(filePath, '.png');
    worldbookName = data.data?.character_book?.name ?? name;
    form = 'charactercard';

    if (data.data?.character_book?.entries) {
      rawEntries = data.data.character_book.entries;
    } else {
      rawEntries = [];
    }

    characterMeta = buildCharacterMeta(data);
  } else {
    const { data } = readWorldbookJson(filePath);

    if (isCharacterCardJson(data)) {
      name = data.name ?? data.data?.name ?? basename(filePath, '.json');
      worldbookName = data.data?.character_book?.name ?? name;
      form = 'charactercard';

      if (data.data?.character_book?.entries) {
        rawEntries = data.data.character_book.entries;
      } else {
        rawEntries = [];
      }

      characterMeta = buildCharacterMeta(data);
    } else if (isFlatWorldbookFormat(data)) {
      name = data.name ?? basename(filePath, '.json');
      worldbookName = name;
      form = 'worldbook';
      const flatEntries = Object.values(data.entries ?? {}) as FlatWorldbookEntry[];
      const state = flatEntriesToState(flatEntries, name, worldbookName);

      // merge 模式：合并已有 state 的分类/路径
      // 注意：worldbook 形式下 form=worldbook，state schema 约束 mvu=false，
      // 因此 Zod 脚本检测和 initvar_override 提取均不适用，无需执行。
      // （charactercard 分支在 merge 前调用 detectAndExtractZodFromCard）
      if (!opts.fresh) {
        const oldStatePath = opts.state ?? statePath;
        if (existsSync(oldStatePath)) {
          const oldState = readAndValidateOldState(oldStatePath);
          const mergedState = mergeWithExistingState(state, oldState);
          Object.assign(state, mergedState);
          console.log(`  Merged with existing state`);
        }
      }

      writeStateWithEntries(state, buildContentLookup(flatEntries), outputDir);
      console.log(`Unpacked ${flatEntries.length} entries → ${outputDir}`);
      return;
    } else {
      name = data.name ?? basename(filePath, '.json');
      worldbookName = name;
      form = 'worldbook';
      rawEntries = Array.isArray(data.entries)
        ? data.entries
        : Object.values(data.entries ?? {}) as SillyTavernEntry[];
    }
  }

  if (opts.raw) {
    writeJson(opts.output ?? resolve(cwd, 'raw.json'), rawEntries);
    console.log(`Raw output → ${opts.output ?? 'raw.json'}`);
    return;
  }

  mkdirSync(outputDir, { recursive: true });

  const state = rawEntriesToState(rawEntries, name, worldbookName, form);

  if (characterMeta) {
    Object.assign(state, {
      description: characterMeta.description,
      first_messages: characterMeta.first_messages,
      creator: characterMeta.creator,
      creator_notes: characterMeta.creator_notes,
      version: characterMeta.version,
      create_date: characterMeta.create_date,
      extensions: characterMeta.extensions,
      regex_scripts: characterMeta.regex_scripts,
    });
  }

  if (detectMvu(state)) {
    state.mvu = true;
  }

  // Zod 脚本检测（在 merge 之前执行，确保从干净角色卡数据提取）
  detectAndExtractZodFromCard(state, outputDir);

  // merge 模式：合并旧 state
  if (!opts.fresh) {
    const oldStatePath = opts.state ?? statePath;
    if (existsSync(oldStatePath)) {
      const oldState = readAndValidateOldState(oldStatePath);
      const mergedState = mergeWithExistingState(state, oldState);
      Object.assign(state, mergedState);
      console.log(`  Merged with existing state`);
    }
  }

  if (avatarBuffer) {
    const avatarRelPath = 'avatar.png';
    const avatarAbsPath = join(outputDir, avatarRelPath);
    const cleanAvatar = stripCharaChunks(avatarBuffer);
    writeFileRecursive(avatarAbsPath, cleanAvatar);
    state.avatar = avatarRelPath;
  }

  // --- 世界书/ : entry content files ---
  const entriesDir = join(outputDir, DIR_ENTRIES);
  mkdirSync(entriesDir, { recursive: true });

  // 按 uid/条目名查找 raw 内容，避免 merge 后位置索引错位
  const contentLookup = buildContentLookup(rawEntries);
  const allLeaves = Object.values(state.entryManifest).flatMap(e => Object.entries(e));
  for (const [entryName, leaf] of allLeaves) {
    const newContent = (leaf.uid != null ? contentLookup.get(leaf.uid) : undefined)
      ?? contentLookup.get(entryName)
      ?? '';
    if (!newContent) {
      if (!leaf.path && !leaf.contents) {
        delete leaf.contents;
        leaf.path = '';
      }
      continue;
    }

    // 统一走 writeEntryBody：根据新内容判定 .yaml/.txt/wrapped 语义，
    // merge 模式下传入旧 path/contents 让 writeEntryBody 保留旧结构（仅调后缀）。
    const oldPath = leaf.path;
    const oldContents = leaf.contents;
    const hadContents = !!oldContents;
    const preserve = (oldPath || oldContents) ? { path: oldPath, contents: oldContents } : undefined;
    writeEntryBody(leaf, entryName, newContent, outputDir, preserve);

    // 检测存储方式变更：writeEntryBody 内部仅对 contents→path 输出警告，
    // 此处补充 path→path 扩展名变更和 path→contents 的警告。
    if (oldPath && oldPath !== leaf.path && !hadContents) {
      // path → path 但扩展名不同（如 .txt → .yaml，preserve 模式下仅后缀校正）
      console.log(`  ⚠ Entry "${entryName}" extension changed: ${oldPath} → ${leaf.path} — old file may be removed manually`);
    } else if (oldPath && !leaf.path && leaf.contents) {
      // path → contents（单文件 → 多片段 wrapped_yaml）
      console.log(`  ⚠ Entry "${entryName}" storage changed: ${oldPath} → contents fragments — old file may be removed manually`);
    }
    // contents → path 的警告已在 writeEntryBody 内部输出，此处不重复
  }

  // --- 正则/ : regex_scripts replaceString ---
  if (state.regex_scripts && Object.keys(state.regex_scripts).length > 0) {
    const regexDir = join(outputDir, DIR_REGEX);
    mkdirSync(regexDir, { recursive: true });

    for (const [scriptName, script] of Object.entries(state.regex_scripts)) {
      const replaceString = script.replaceString;
      if (!replaceString) continue;

      const filename = `${sanitizeFilename(scriptName)}.txt`;
      const relPath = join(DIR_REGEX, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, replaceString);
      script.replace_file = relPath;
      delete script.replaceString;
    }
  }

  // --- 脚本/ : tavern_helper scripts content ---
  // Zod 脚本已在 detectAndExtractZodFromCard 中从 scripts 积除，此处只处理普通脚本
  const tavernHelper = state.extensions?.tavern_helper;
  if (tavernHelper?.scripts && Object.keys(tavernHelper.scripts).length > 0) {
    const scriptsDir = join(outputDir, DIR_SCRIPTS);
    mkdirSync(scriptsDir, { recursive: true });

    for (const [scriptName, script] of Object.entries(tavernHelper.scripts)) {
      const content = script.content;
      if (!content) continue;
      // 兜底：Zod 脚本应由 detectAndExtractZodFromCard 移除，若残留则跳过写入
      if (isMvuZodScript(content)) {
        console.warn(`⚠ Zod script "${scriptName}" still present in scripts after extraction; skipping write (managed by schema.ts + state.zod)`);
        continue;
      }

      const filename = `${sanitizeFilename(scriptName)}.txt`;
      const relPath = join(DIR_SCRIPTS, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, content);
      script.script_file = relPath;
      delete script.content;
    }
  }

  // --- 开场白/ : first_messages ---
  if (state.first_messages && state.first_messages.length > 0) {
    const greetingsDir = join(outputDir, DIR_GREETINGS);
    mkdirSync(greetingsDir, { recursive: true });

    const paths: string[] = [];
    const initvarOverrides: Record<string, string> = {};

    for (let gi = 0; gi < state.first_messages.length; gi++) {
      let content = state.first_messages[gi];

      // MVU: 提取 <UpdateVariable><initvar> 块
      // 对所有开场白检测（包括 gi === 0），只要有块就提取
      if (state.mvu) {
        const extracted = extractInitvarOverrideFromGreeting(content);
        if (extracted) {
          const overrideFilename = `initvar/${gi}.yaml`;
          const overrideRelPath = join(DIR_GREETINGS, overrideFilename);
          const overrideAbsPath = join(outputDir, overrideRelPath);

          mkdirSync(dirname(overrideAbsPath), { recursive: true });
          writeFileRecursive(overrideAbsPath, extracted.initvarYaml);

          const greetingRelPath = join(DIR_GREETINGS, `${gi}.txt`);
          initvarOverrides[greetingRelPath] = overrideRelPath;

          content = extracted.cleanedContent;
          console.log(`  Extracted initvar_override → ${overrideRelPath}`);
        }
      }

      const filename = `${gi}.txt`;
      const relPath = join(DIR_GREETINGS, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, content);
      paths.push(relPath);
    }

    state.first_messages = paths;
    if (Object.keys(initvarOverrides).length > 0) {
      state.initvar_overrides = initvarOverrides;
    }
  }

  writeJson(resolve(outputDir, 'tavern-cards-state.json'), sortEntriesForSerialization(state));
  console.log(`Unpacked ${rawEntries.length} entries → ${outputDir}`);
}
